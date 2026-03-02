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
    // Step 1: Get the tip (latest version) of the source file to obtain its storageId
    logger.info(`[FileCopy] Step 1 - Get tip: project=${sourceProjectId} item=${sourceFileUrn}`);
    const tipUrl = `${BASE_URL}/data/v1/projects/${encodeURIComponent(sourceProjectId)}/items/${encodeURIComponent(sourceFileUrn)}/tip`;
    let tipData;
    try {
      const tipResp = await axios.get(tipUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      tipData = tipResp.data?.data;
    } catch (e) {
      const status = e.response?.status || 'unknown';
      const body = JSON.stringify(e.response?.data || {}).substring(0, 300);
      throw new Error(`Step 1 échoué (GET tip) HTTP ${status}: ${body}`);
    }

    if (!tipData) throw new Error('Step 1: Impossible de récupérer la version source');

    const sourceStorageId = tipData.relationships?.storage?.data?.id;
    if (!sourceStorageId) throw new Error('Step 1: Storage introuvable pour le fichier source');

    const displayName = fileName || tipData.attributes?.displayName || 'file';
    logger.info(`[FileCopy] Step 1 OK - name=${displayName} sourceStorageId=${sourceStorageId}`);

    // Step 2: Check if file already exists in destination
    let existingItemId = null;
    logger.info(`[FileCopy] Step 2 - Check existing: folder=${destinationFolderId} name=${displayName}`);
    existingItemId = await this._findExistingItem(accessToken, destinationProjectId, destinationFolderId, displayName);
    logger.info(`[FileCopy] Step 2 OK - existingItemId=${existingItemId || 'none (new file)'}`);

    // Step 3: Create item or new version referencing the SOURCE storageId directly
    // No binary transfer needed - ACC reuses the existing storage object (server-side copy)
    if (existingItemId) {
      logger.info(`[FileCopy] Step 3 - Create new version for existing item: ${existingItemId}`);
      return await this._createNewVersion(accessToken, destinationProjectId, existingItemId, displayName, sourceStorageId);
    } else {
      logger.info(`[FileCopy] Step 3 - Create new item in folder: ${destinationFolderId}`);
      return await this._createNewItem(accessToken, destinationProjectId, destinationFolderId, displayName, sourceStorageId);
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

  async _createNewItem(accessToken, projectId, folderId, displayName, storageId) {
    const headers = this._headers(accessToken);
    const url = `${BASE_URL}/data/v1/projects/${encodeURIComponent(projectId)}/items`;

    const fileType = this._getFileExtensionType(displayName);

    const payload = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'items',
        attributes: {
          displayName,
          extension: { type: fileType.item, version: '1.0' },
        },
        relationships: {
          tip: { data: { type: 'versions', id: '1' } },
          parent: { data: { type: 'folders', id: folderId } },
        },
      },
      included: [
        {
          type: 'versions',
          id: '1',
          attributes: {
            name: displayName,
            extension: { type: fileType.version, version: '1.0' },
          },
          relationships: {
            storage: { data: { type: 'objects', id: storageId } },
          },
        },
      ],
    };

    try {
      const resp = await axios.post(url, payload, { headers });
      logger.info(`[FileCopy] Step 3 OK - item created: ${resp.data?.data?.id}`);
      return { action: 'created', itemId: resp.data?.data?.id };
    } catch (e) {
      const status = e.response?.status || 'unknown';
      const body = JSON.stringify(e.response?.data || {}).substring(0, 500);
      throw new Error(`Step 3 échoué (POST items) HTTP ${status}: ${body}`);
    }
  }

  async _createNewVersion(accessToken, projectId, itemId, displayName, storageId) {
    const headers = this._headers(accessToken);
    const url = `${BASE_URL}/data/v1/projects/${encodeURIComponent(projectId)}/versions`;

    const fileType = this._getFileExtensionType(displayName);

    const payload = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'versions',
        attributes: {
          name: displayName,
          extension: { type: fileType.version, version: '1.0' },
        },
        relationships: {
          item: { data: { type: 'items', id: itemId } },
          storage: { data: { type: 'objects', id: storageId } },
        },
      },
    };

    try {
      const resp = await axios.post(url, payload, { headers });
      logger.info(`[FileCopy] Step 3 OK - version created: ${resp.data?.data?.id}`);
      return { action: 'versioned', versionId: resp.data?.data?.id };
    } catch (e) {
      const status = e.response?.status || 'unknown';
      const body = JSON.stringify(e.response?.data || {}).substring(0, 500);
      throw new Error(`Step 3 échoué (POST versions) HTTP ${status}: ${body}`);
    }
  }

  _getFileExtensionType(displayName) {
    return {
      item: 'items:autodesk.core:File',
      version: 'versions:autodesk.core:File',
    };
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
