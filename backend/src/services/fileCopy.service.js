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

    // Step 1: Get the tip (latest version) of the source file
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

    const storageId = tipData.relationships?.storage?.data?.id;
    if (!storageId) throw new Error('Step 1: Storage introuvable pour le fichier source');

    const displayName = fileName || tipData.attributes?.displayName || 'file';
    const { bucket: sourceBucket, objectKey: sourceObjectKey } = this._parseStorageId(storageId);
    if (!sourceBucket || !sourceObjectKey) throw new Error(`Step 1: Format storageId invalide: ${storageId}`);
    logger.info(`[FileCopy] Step 1 OK - source: bucket=${sourceBucket} key=${sourceObjectKey} name=${displayName} storageId=${storageId}`);

    // Step 2: Check if file already exists in destination
    let existingItemId = null;
    if (overwriteExisting) {
      logger.info(`[FileCopy] Step 2 - Check existing: folder=${destinationFolderId} name=${displayName}`);
      existingItemId = await this._findExistingItem(accessToken, destinationProjectId, destinationFolderId, displayName);
      logger.info(`[FileCopy] Step 2 OK - existingItemId=${existingItemId || 'none (new file)'}`);
    }

    // Step 3: Create storage in destination folder
    logger.info(`[FileCopy] Step 3 - Create dest storage: project=${destinationProjectId} folder=${destinationFolderId}`);
    const storageUrl = `${BASE_URL}/data/v1/projects/${encodeURIComponent(destinationProjectId)}/storage`;
    const storagePayload = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'objects',
        attributes: { name: displayName },
        relationships: {
          target: {
            data: { type: 'folders', id: destinationFolderId },
          },
        },
      },
    };

    let targetStorageId;
    try {
      const storageResp = await axios.post(storageUrl, storagePayload, { headers });
      targetStorageId = storageResp.data?.data?.id;
    } catch (e) {
      const status = e.response?.status || 'unknown';
      const body = JSON.stringify(e.response?.data || {}).substring(0, 300);
      throw new Error(`Step 3 échoué (POST storage) HTTP ${status}: ${body}`);
    }
    if (!targetStorageId) throw new Error('Step 3: Impossible de créer le storage de destination');

    const { bucket: destBucket, objectKey: destObjectKey } = this._parseStorageId(targetStorageId);
    if (!destBucket || !destObjectKey) throw new Error(`Step 3: Format targetStorageId invalide: ${targetStorageId}`);
    logger.info(`[FileCopy] Step 3 OK - dest: bucket=${destBucket} key=${destObjectKey} targetStorageId=${targetStorageId}`);

    // Step 4: Transfer binary via signed S3 URLs (required since legacy OSS endpoints are deprecated)
    logger.info(`[FileCopy] Step 4 - Transfer binary via signed S3 URLs`);
    try {
      const authHeader = { Authorization: `Bearer ${accessToken}` };

      // 4a: Get signed download URL for source
      const signedDownloadUrl = `${BASE_URL}/oss/v2/buckets/${encodeURIComponent(sourceBucket)}/objects/${encodeURIComponent(sourceObjectKey)}/signeds3download`;
      logger.info(`[FileCopy] Step 4a - Getting signed download URL: bucket=${sourceBucket} key=${sourceObjectKey}`);
      const signedDownloadResp = await axios.get(signedDownloadUrl, {
        headers: authHeader,
        params: { minutesExpiration: 10 },
      });
      const downloadUrl = signedDownloadResp.data?.url;
      if (!downloadUrl) {
        logger.error(`[FileCopy] Step 4a - Response: ${JSON.stringify(signedDownloadResp.data).substring(0, 500)}`);
        throw new Error('Step 4a: Signed download URL introuvable dans la réponse');
      }
      logger.info(`[FileCopy] Step 4a OK - signed download URL obtained (status=${signedDownloadResp.data?.status})`);

      // 4b: Get signed upload URL for destination (no body for initiation, only query params)
      const signedUploadUrl = `${BASE_URL}/oss/v2/buckets/${encodeURIComponent(destBucket)}/objects/${encodeURIComponent(destObjectKey)}/signeds3upload`;
      logger.info(`[FileCopy] Step 4b - Getting signed upload URL: bucket=${destBucket} key=${destObjectKey}`);
      const signedUploadResp = await axios.post(signedUploadUrl, null, {
        headers: authHeader,
        params: { minutesExpiration: 10, parts: 1 },
      });
      const uploadUrl = signedUploadResp.data?.urls?.[0];
      const uploadKey = signedUploadResp.data?.uploadKey;
      if (!uploadUrl || !uploadKey) {
        logger.error(`[FileCopy] Step 4b - Response: ${JSON.stringify(signedUploadResp.data).substring(0, 500)}`);
        throw new Error('Step 4b: Signed upload URL ou uploadKey introuvable');
      }
      logger.info(`[FileCopy] Step 4b OK - signed upload URL obtained (uploadKey=${uploadKey.substring(0, 20)}...)`);

      // 4c: Download content from signed S3 URL (no auth header needed)
      logger.info(`[FileCopy] Step 4c - Downloading binary from S3...`);
      const downloadResp = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        maxContentLength: Infinity,
        maxRedirects: 5,
      });
      const contentLength = downloadResp.data.length;
      logger.info(`[FileCopy] Step 4c OK - downloaded ${(contentLength / 1024 / 1024).toFixed(2)} MB`);

      // 4d: Upload content to signed S3 URL (no auth header needed)
      logger.info(`[FileCopy] Step 4d - Uploading ${(contentLength / 1024 / 1024).toFixed(2)} MB to S3...`);
      await axios.put(uploadUrl, downloadResp.data, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': contentLength,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      logger.info(`[FileCopy] Step 4d OK - uploaded to S3`);

      // 4e: Complete the upload (tell APS the upload is done)
      logger.info(`[FileCopy] Step 4e - Completing upload...`);
      await axios.post(signedUploadUrl, { uploadKey }, {
        headers: { ...authHeader, 'Content-Type': 'application/json' },
      });
      logger.info(`[FileCopy] Step 4e OK - upload finalized`);
    } catch (e) {
      const status = e.response?.status || 'unknown';
      let body = '';
      if (e.response?.data) {
        if (Buffer.isBuffer(e.response.data) || e.response.data instanceof ArrayBuffer) {
          body = Buffer.from(e.response.data).toString('utf8').substring(0, 300);
        } else {
          body = JSON.stringify(e.response.data).substring(0, 300);
        }
      }
      throw new Error(`Step 4 échoué HTTP ${status}: ${e.message} - ${body}`);
    }

    // Step 5: Create item or new version in destination
    logger.info(`[FileCopy] Step 5 - Create ${existingItemId ? 'new version' : 'new item'}: ${displayName}`);
    if (existingItemId) {
      return await this._createNewVersion(accessToken, destinationProjectId, existingItemId, displayName, targetStorageId);
    } else {
      return await this._createNewItem(accessToken, destinationProjectId, destinationFolderId, displayName, targetStorageId);
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
      logger.info(`[FileCopy] Step 5 OK - item created: ${resp.data?.data?.id}`);
      return { action: 'created', itemId: resp.data?.data?.id };
    } catch (e) {
      const status = e.response?.status || 'unknown';
      const body = JSON.stringify(e.response?.data || {}).substring(0, 500);
      throw new Error(`Step 5 échoué (POST items) HTTP ${status}: ${body}`);
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
      logger.info(`[FileCopy] Step 5 OK - version created: ${resp.data?.data?.id}`);
      return { action: 'versioned', versionId: resp.data?.data?.id };
    } catch (e) {
      const status = e.response?.status || 'unknown';
      const body = JSON.stringify(e.response?.data || {}).substring(0, 500);
      throw new Error(`Step 5 échoué (POST versions) HTTP ${status}: ${body}`);
    }
  }

  _parseStorageId(storageId) {
    if (!storageId) return { bucket: null, objectKey: null };
    const slashIdx = storageId.indexOf('/');
    if (slashIdx === -1) return { bucket: null, objectKey: null };
    const prefix = storageId.substring(0, slashIdx);
    const objectKey = storageId.substring(slashIdx + 1);
    const osObjMarker = ':os.object:';
    const markerIdx = prefix.indexOf(osObjMarker);
    if (markerIdx === -1) return { bucket: null, objectKey: null };
    const bucket = prefix.substring(markerIdx + osObjMarker.length);
    return { bucket, objectKey };
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
