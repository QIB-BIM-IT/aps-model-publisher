'use strict';

const axios = require('axios');
const { PDFDocument } = require('pdf-lib');
const logger = require('../config/logger');

class PDFUploadService {
  constructor() {
    this.baseUrl = 'https://developer.api.autodesk.com';
  }

  /**
   * Nettoie le nom de fichier en retirant le préfixe « Feuilles- »
   */
  sanitizeFileName(name) {
    if (!name) {
      return 'document.pdf';
    }

    const trimmed = name.toString().trim();
    const cleaned = trimmed.replace(/^Feuilles-/i, '').trim();
    if (!cleaned) {
      return trimmed || 'document.pdf';
    }

    return cleaned;
  }

  /**
   * Fusionne plusieurs buffers PDF en un seul fichier
   */
  async mergePDFs(pdfBuffers, outputName = 'merged.pdf') {
    try {
      logger.info(`[PDFUpload] Fusion de ${pdfBuffers.length} PDF(s)...`);

      const mergedPdf = await PDFDocument.create();

      for (const buffer of pdfBuffers) {
        const pdf = await PDFDocument.load(buffer);
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedBytes = await mergedPdf.save();
      const mergedBuffer = Buffer.from(mergedBytes);

      logger.info(`[PDFUpload] ✅ PDFs fusionnés: ${mergedBuffer.length} bytes`);
      return mergedBuffer;
    } catch (error) {
      logger.error(`[PDFUpload] Erreur fusion PDF: ${error.message}`);
      throw new Error(`Impossible de fusionner les PDFs: ${error.message}`);
    }
  }

  /**
   * Upload complet d'un PDF sur ACC (création ou versionning automatique)
   */
  async uploadPDFToACC(arg1, arg2, arg3, arg4, arg5) {
    let projectId;
    let folderId;
    let pdfBuffer;
    let fileName;
    let accessToken;

    if (arg1 && typeof arg1 === 'object' && !Buffer.isBuffer(arg1) && !(arg1 instanceof Uint8Array)) {
      const pdf = arg1;
      projectId = arg2;
      folderId = arg3;
      accessToken = arg4;
      pdfBuffer = pdf.buffer || pdf.data || pdf.fileBuffer;
      fileName = pdf.filename || pdf.name || pdf.fileName;
    } else {
      projectId = arg1;
      folderId = arg2;
      pdfBuffer = arg3;
      fileName = arg4;
      accessToken = arg5;
    }

    if (!Buffer.isBuffer(pdfBuffer)) {
      if (pdfBuffer instanceof Uint8Array) {
        pdfBuffer = Buffer.from(pdfBuffer);
      } else if (Array.isArray(pdfBuffer)) {
        pdfBuffer = Buffer.from(pdfBuffer);
      } else {
        throw new Error('pdfBuffer doit être un Buffer');
      }
    }

    if (!projectId || !folderId) {
      throw new Error('projectId et folderId requis pour upload');
    }

    const cleanProjectId = projectId.replace(/^b\./, '');
    const sanitizedName = this.ensurePdfExtension(this.sanitizeFileName(fileName || 'document.pdf'));

    try {
      logger.info(`[PDFUpload] Upload PDF sur ACC: ${sanitizedName}`);

      // 1. Créer storage object
      const storageData = await this.createStorageObject(
        cleanProjectId,
        folderId,
        sanitizedName,
        accessToken
      );

      const objectId = storageData?.data?.id;
      if (!objectId) {
        throw new Error('Pas d\'objectId retourné');
      }

      const { bucketKey, objectKey } = this.parseObjectId(objectId);

      // 2. Obtenir URL signée S3
      const signedS3Data = await this.getSignedS3Upload(bucketKey, objectKey, accessToken);
      const uploadUrl = signedS3Data?.urls?.[0];
      const uploadKey = signedS3Data?.uploadKey;

      if (!uploadUrl) {
        throw new Error('Pas d\'URL S3 retournée');
      }

      // 3. Upload vers S3
      await this.uploadToS3(uploadUrl, pdfBuffer);
      logger.info(`[PDFUpload] ✅ PDF uploadé vers S3 (${sanitizedName})`);

      // 4. Finaliser upload si nécessaire
      if (uploadKey) {
        await this.completeS3Upload(bucketKey, objectKey, uploadKey, accessToken);
        logger.debug('[PDFUpload] Upload S3 finalisé');
      }

      // 5. Détection d'un item existant
      const existingItem = await this.findExistingItem(
        cleanProjectId,
        folderId,
        sanitizedName,
        accessToken
      );

      let action = 'create-item';
      let responseData;

      if (existingItem) {
        logger.info(`[PDFUpload] Item existant trouvé (${existingItem.id}), création nouvelle version...`);
        action = 'create-version';
        responseData = await this.createVersion(
          cleanProjectId,
          existingItem,
          objectId,
          sanitizedName,
          accessToken
        );
      } else {
        logger.info('[PDFUpload] Aucun item existant, création d\'un nouvel item...');
        responseData = await this.createItem(
          cleanProjectId,
          folderId,
          objectId,
          sanitizedName,
          accessToken
        );
      }

      const versionId = this.extractVersionId(responseData);
      const itemId = existingItem?.id || responseData?.data?.id;

      return {
        success: true,
        fileName: sanitizedName,
        itemId,
        versionId,
        action,
      };
    } catch (error) {
      logger.error(`[PDFUpload] ❌ Erreur upload ${sanitizedName}: ${error.message}`);
      throw error;
    }
  }

  ensurePdfExtension(name) {
    if (!name.toLowerCase().endsWith('.pdf')) {
      return `${name}.pdf`;
    }
    return name;
  }

  parseObjectId(objectId) {
    const objectIdParts = objectId.split(':');
    const bucketAndObject = objectIdParts[objectIdParts.length - 1];
    const [bucketKey, ...objectKeyParts] = bucketAndObject.split('/');
    const objectKey = objectKeyParts.join('/');

    return { bucketKey, objectKey };
  }

  extractVersionId(responseData) {
    if (!responseData) return null;
    if (responseData?.data?.type === 'versions') {
      return responseData.data.id;
    }

    const includedVersions = Array.isArray(responseData?.included)
      ? responseData.included.filter((inc) => inc.type === 'versions')
      : [];

    if (includedVersions.length > 0) {
      return includedVersions[0].id;
    }

    return responseData?.data?.relationships?.tip?.data?.id || null;
  }

  /**
   * Recherche un item existant dans un dossier ACC
   */
  async findExistingItem(projectId, folderId, fileName, accessToken) {
    const url = `${this.baseUrl}/data/v1/projects/b.${projectId}/folders/${encodeURIComponent(folderId)}/contents`;

    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const response = await axios.get(url, {
        headers,
        params: {
          'filter[displayName]': fileName,
          'page[limit]': 50,
        },
      });

      let items = Array.isArray(response.data?.data) ? response.data.data : [];

      if (!items.length) {
        const fallback = await axios.get(url, {
          headers,
          params: { 'page[limit]': 200 },
        });
        items = Array.isArray(fallback.data?.data) ? fallback.data.data : [];
      }

      return items.find((item) => {
        const displayName = item?.attributes?.displayName || '';
        return displayName.localeCompare(fileName, undefined, { sensitivity: 'accent' }) === 0;
      }) || null;
    } catch (error) {
      logger.warn(
        `[PDFUpload] Impossible de vérifier l\'existence de ${fileName}: ${error.response?.status || error.message}`
      );
      return null;
    }
  }

  /**
   * Crée une nouvelle version pour un item existant
   */
  async createVersion(projectId, item, objectId, fileName, accessToken) {
    const itemId = item?.id || item?.data?.id;
    if (!itemId) {
      throw new Error('Item existant sans identifiant');
    }

    const url = `${this.baseUrl}/data/v1/projects/b.${projectId}/versions`;

    const payload = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'versions',
        attributes: {
          name: fileName,
          extension: {
            type: 'versions:autodesk.bim360:File',
            version: '1.0',
          },
        },
        relationships: {
          item: {
            data: { type: 'items', id: itemId },
          },
          storage: {
            data: { type: 'objects', id: objectId },
          },
        },
      },
    };

    logger.debug(`[PDFUpload] createVersion payload: ${JSON.stringify(payload, null, 2)}`);

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
      });

      return response.data;
    } catch (error) {
      logger.error(`[PDFUpload] createVersion error: ${error.response?.status}`);
      throw new Error(`Erreur createVersion: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Crée un storage object
   */
  async createStorageObject(projectId, folderId, fileName, accessToken) {
    const url = `${this.baseUrl}/data/v1/projects/b.${projectId}/storage`;

    const body = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'objects',
        attributes: { name: fileName },
        relationships: {
          target: {
            data: {
              type: 'folders',
              id: folderId,
            },
          },
        },
      },
    };

    try {
      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/vnd.api+json',
        },
      });
      return response.data;
    } catch (error) {
      logger.error(`[PDFUpload] createStorageObject error: ${error.response?.status}`);
      throw new Error(`Storage creation failed: ${error.message}`);
    }
  }

  /**
   * Obtient URL signée S3
   */
  async getSignedS3Upload(bucketKey, objectKey, accessToken) {
    const url = `${this.baseUrl}/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`;

    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return response.data;
    } catch (error) {
      logger.error(`[PDFUpload] getSignedS3Upload error: ${error.response?.status}`);
      throw new Error(`Signed URL generation failed: ${error.message}`);
    }
  }

  /**
   * Upload vers S3
   */
  async uploadToS3(uploadUrl, pdfBuffer) {
    try {
      await axios.put(uploadUrl, pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': pdfBuffer.length,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    } catch (error) {
      logger.error(`[PDFUpload] S3 upload failed: ${error.message}`);
      throw new Error(`S3 upload failed: ${error.message}`);
    }
  }

  /**
   * Finalise l'upload S3
   */
  async completeS3Upload(bucketKey, objectKey, uploadKey, accessToken) {
    const url = `${this.baseUrl}/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`;

    try {
      await axios.post(
        url,
        { uploadKey },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
    } catch (error) {
      logger.error(`[PDFUpload] S3 complete failed: ${error.response?.status}`);
      throw new Error(`S3 completion failed: ${error.message}`);
    }
  }

  /**
   * Crée un item dans ACC
   */
  async createItem(projectId, folderId, objectId, fileName, accessToken) {
    const url = `${this.baseUrl}/data/v1/projects/b.${projectId}/items`;

    const payload = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'items',
        attributes: {
          displayName: fileName,
          extension: {
            type: 'items:autodesk.bim360:File',
            version: '1.0',
          },
        },
        relationships: {
          tip: {
            data: { type: 'versions', id: '1' },
          },
          parent: {
            data: {
              type: 'folders',
              id: folderId,
            },
          },
        },
      },
      included: [
        {
          type: 'versions',
          id: '1',
          attributes: {
            name: fileName,
            extension: {
              type: 'versions:autodesk.bim360:File',
              version: '1.0',
            },
          },
          relationships: {
            storage: {
              data: {
                type: 'objects',
                id: objectId,
              },
            },
          },
        },
      ],
    };

    logger.debug(`[PDFUpload] 🔍 DEBUG createItem payload: ${JSON.stringify(payload, null, 2)}`);

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
      });

      return response.data;
    } catch (error) {
      logger.error('[PDFUpload] 🔍 DEBUG createItem error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers,
      });

      if (error.response?.status === 403) {
        const detail =
          error.response?.data?.errors?.[0]?.detail ||
          error.response?.data?.message ||
          'Détails inconnus';
        throw new Error(`Permission denied: ${detail}`);
      }

      const errorMsg =
        error.response?.data?.errors?.[0]?.detail ||
        error.response?.data?.message ||
        error.message ||
        'Erreur inconnue';
      throw new Error(`Erreur createItem: ${errorMsg}`);
    }
  }
}

module.exports = new PDFUploadService();
