const axios = require('axios');
const logger = require('../config/logger');
const { apsConfig } = require('../config/aps.config');
const apsAuthService = require('./apsAuth.service');
const { CopyRun } = require('../models');

const BASE_URL = apsConfig.apis.baseUrl;

class FileCopyService {
  _headers(accessToken) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.api+json',
    };
  }

  async startRun(job) {
    const run = await CopyRun.create({
      jobId: job.id,
      userId: job.userId,
      projectId: job.projectId,
      destinationProjectId: job.destinationProjectId,
      destinationFolderId: job.destinationFolderId,
      items: job.files || [],
      status: 'running',
      startedAt: new Date(),
      results: [],
      stats: {},
    });

    logger.info(`[FileCopy] Run créé: ${run.id} pour job ${job.id} (${(job.files || []).length} fichier(s))`);
    return run;
  }

  async executeRun(run) {
    const started = Date.now();
    const accessToken = await apsAuthService.ensureValidToken(run.userId);
    const items = run.items || [];
    const results = [];
    let okCount = 0;
    let failCount = 0;

    const { CopyJob } = require('../models');
    const job = await CopyJob.findByPk(run.jobId);
    if (!job) throw new Error(`Job ${run.jobId} introuvable`);

    for (const file of items) {
      try {
        logger.info(`[FileCopy] Copie: ${file.name || file.urn} -> ${job.destinationFolderName || job.destinationFolderId}`);

        const result = await this._copyFile({
          accessToken,
          sourceProjectId: job.projectId,
          sourceFileUrn: file.urn,
          fileName: file.name,
          destinationProjectId: job.destinationProjectId,
          destinationFolderId: job.destinationFolderId,
          overwriteExisting: job.overwriteExisting,
        });

        results.push({ urn: file.urn, name: file.name, status: 'success', ...result });
        okCount++;
      } catch (e) {
        logger.error(`[FileCopy] Erreur copie ${file.name}: ${e.message}`);
        results.push({ urn: file.urn, name: file.name, status: 'failed', error: e.message });
        failCount++;
      }
    }

    return {
      results,
      okCount,
      failCount,
      durationMs: Date.now() - started,
    };
  }

  async _copyFile({ accessToken, sourceProjectId, sourceFileUrn, fileName, destinationProjectId, destinationFolderId, overwriteExisting }) {
    const headers = this._headers(accessToken);
    const displayName = fileName || 'file';

    // Step 1: Check if file already exists in destination (for overwrite → new version)
    let existingItemId = null;
    if (overwriteExisting) {
      logger.info(`[FileCopy] Step 1 - Check existing: folder=${destinationFolderId} name=${displayName}`);
      existingItemId = await this._findExistingItem(accessToken, destinationProjectId, destinationFolderId, displayName);
      logger.info(`[FileCopy] Step 1 OK - existingItemId=${existingItemId || 'none (new file)'}`);
    }

    if (existingItemId) {
      // Overwrite: get the tip versionId of the source, then POST /versions?copyFrom=versionId
      logger.info(`[FileCopy] Step 2 - Get source tip version for overwrite`);
      const tipUrl = `${BASE_URL}/data/v1/projects/${encodeURIComponent(sourceProjectId)}/items/${encodeURIComponent(sourceFileUrn)}/tip`;
      let sourceVersionId;
      try {
        const tipResp = await axios.get(tipUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        sourceVersionId = tipResp.data?.data?.id;
      } catch (e) {
        const status = e.response?.status || 'unknown';
        const body = JSON.stringify(e.response?.data || {}).substring(0, 300);
        throw new Error(`Step 2 échoué (GET tip) HTTP ${status}: ${body}`);
      }
      if (!sourceVersionId) throw new Error('Step 2: Impossible de récupérer le versionId source');
      logger.info(`[FileCopy] Step 2 OK - sourceVersionId=${sourceVersionId}`);

      // Step 3: Create new version via copyFrom
      logger.info(`[FileCopy] Step 3 - POST /versions?copyFrom for existing item: ${existingItemId}`);
      const url = `${BASE_URL}/data/v2/projects/${encodeURIComponent(destinationProjectId)}/versions`;
      const payload = {
        jsonapi: { version: '1.0' },
        data: {
          type: 'versions',
          attributes: {
            name: displayName,
          },
          relationships: {
            item: { data: { type: 'items', id: existingItemId } },
          },
        },
      };
      try {
        const resp = await axios.post(url, payload, {
          headers,
          params: { copyFrom: sourceVersionId },
        });
        logger.info(`[FileCopy] Step 3 OK - version created: ${resp.data?.data?.id}`);
        return { action: 'versioned', versionId: resp.data?.data?.id };
      } catch (e) {
        const status = e.response?.status || 'unknown';
        const body = JSON.stringify(e.response?.data || {}).substring(0, 500);
        throw new Error(`Step 3 échoué (POST versions copyFrom) HTTP ${status}: ${body}`);
      }
    } else {
      // New file: POST /items?copyFrom=sourceItemId
      logger.info(`[FileCopy] Step 2 - POST /items?copyFrom to folder: ${destinationFolderId}`);
      const url = `${BASE_URL}/data/v2/projects/${encodeURIComponent(destinationProjectId)}/items`;
      const payload = {
        jsonapi: { version: '1.0' },
        data: {
          type: 'items',
          attributes: {
            displayName,
          },
          relationships: {
            parent: {
              data: { type: 'folders', id: destinationFolderId },
            },
          },
        },
      };
      try {
        const resp = await axios.post(url, payload, {
          headers,
          params: { copyFrom: sourceFileUrn },
        });
        logger.info(`[FileCopy] Step 2 OK - item created: ${resp.data?.data?.id}`);
        return { action: 'created', itemId: resp.data?.data?.id };
      } catch (e) {
        const status = e.response?.status || 'unknown';
        const body = JSON.stringify(e.response?.data || {}).substring(0, 500);
        throw new Error(`Step 2 échoué (POST items copyFrom) HTTP ${status}: ${body}`);
      }
    }
  }

  async _findExistingItem(accessToken, projectId, folderId, fileName) {
    try {
      const url = `${BASE_URL}/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`;
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const items = resp.data?.data || [];
      const match = items.find(
        (item) => item.type === 'items' && item.attributes?.displayName === fileName
      );
      return match ? match.id : null;
    } catch (e) {
      logger.debug(`[FileCopy] findExistingItem: ${e.message}`);
      return null;
    }
  }

  async finishRun(run, summary) {
    const results = summary.results || [];
    const okCount = summary.okCount || 0;
    const failCount = summary.failCount || 0;

    let finalStatus = 'success';
    if (failCount > 0 && okCount === 0) finalStatus = 'failed';
    else if (failCount > 0 && okCount > 0) finalStatus = 'partial';

    run.status = finalStatus;
    run.endedAt = new Date();
    run.results = results;
    run.stats = {
      ...(run.stats || {}),
      durationMs: summary.durationMs,
      okCount,
      failCount,
      total: okCount + failCount,
    };

    if (summary.message) run.message = summary.message;

    await run.save();
    logger.info(`[FileCopy] Run terminé: ${run.id} status=${run.status} ok=${okCount} fail=${failCount}`);
    return run;
  }
}

module.exports = new FileCopyService();
