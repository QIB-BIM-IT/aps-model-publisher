'use strict';

const axios = require('axios');
const logger = require('../config/logger');

// Pour merger les PDFs
const { PDFDocument } = require('pdf-lib');

class PDFUploadService {
  /**
   * Merge plusieurs PDFs en un seul
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
   * Upload un PDF sur ACC
   * Workflow complet: storage → S3 signed URL → upload → finalize → create item
   */
  async uploadPDFToACC(projectId, folderId, pdfBuffer, fileName, accessToken) {
    try {
      logger.info(`[PDFUpload] Upload PDF sur ACC: ${fileName}`);

      const cleanProjectId = projectId.replace(/^b\./, '');

      // 1. Créer storage object
      logger.debug(`[PDFUpload] 1️⃣ Création storage object...`);
      const storageData = await this.createStorageObject(
        cleanProjectId,
        folderId,
        fileName,
        accessToken
      );

      const objectId = storageData.data?.id;
      if (!objectId) {
        throw new Error(`Pas d'objectId retourné`);
      }

      logger.debug(`[PDFUpload] Storage créé: ${objectId}`);

      // 2. Parser l'objectId pour bucket + object key
      const objectIdParts = objectId.split(':');
      const bucketAndObject = objectIdParts[objectIdParts.length - 1];
      const [bucketKey, ...objectKeyParts] = bucketAndObject.split('/');
      const objectKey = objectKeyParts.join('/');

      logger.debug(`[PDFUpload] Bucket: ${bucketKey}, Object: ${objectKey}`);

      // 3. Obtenir URL signée S3
      logger.debug(`[PDFUpload] 2️⃣ Obtention URL signée S3...`);
      const signedS3Data = await this.getSignedS3Upload(bucketKey, objectKey, accessToken);

      const uploadUrl = signedS3Data.urls?.[0];
      const uploadKey = signedS3Data.uploadKey;

      if (!uploadUrl) {
        throw new Error(`Pas d'URL S3 retournée`);
      }

      logger.debug(`[PDFUpload] URL S3 reçue`);

      // 4. Upload vers S3
      logger.debug(`[PDFUpload] 3️⃣ Upload PDF vers S3 (${pdfBuffer.length} bytes)...`);
      await this.uploadToS3(uploadUrl, pdfBuffer);
      logger.info(`[PDFUpload] ✅ PDF uploadé vers S3`);

      // 5. Finaliser upload
      if (uploadKey) {
        logger.debug(`[PDFUpload] 4️⃣ Finalisation upload...`);
        await this.completeS3Upload(bucketKey, objectKey, uploadKey, accessToken);
        logger.debug(`[PDFUpload] Upload finalisé`);
      }

      // 6. Créer item dans ACC
      logger.debug(`[PDFUpload] 5️⃣ Création item dans ACC...`);
      const itemData = await this.createItem(
        cleanProjectId,
        folderId,
        fileName,
        objectId,
        accessToken
      );

      logger.info(`[PDFUpload] ✅ PDF ${fileName} uploadé sur ACC`);

      return {
        success: true,
        fileName,
        itemId: itemData.data?.id,
        versionId: itemData.included?.[0]?.id,
      };
    } catch (error) {
      logger.error(`[PDFUpload] ❌ Erreur upload ${fileName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Crée un storage object
   */
  async createStorageObject(projectId, folderId, fileName, accessToken) {
    const url = `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/storage`;

    const body = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'objects',
        attributes: { name: fileName },
        relationships: {
          target: {
            data: { type: 'folders', id: folderId },
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
    const url = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`;

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
    const url = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`;

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
   * Crée l'item dans ACC
   */
  async createItem(projectId, folderId, fileName, objectId, accessToken) {
    const url = `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/items`;

    const body = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'items',
        attributes: {
          displayName: fileName,
          extension: {
            type: 'items:autodesk.core:File',
            version: '1.0',
          },
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
            name: fileName,
            extension: {
              type: 'versions:autodesk.core:File',
              version: '1.0',
            },
          },
          relationships: {
            storage: {
              data: { type: 'objects', id: objectId },
            },
          },
        },
      ],
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
      if (error.response?.status === 403) {
        logger.error(`[PDFUpload] Permission denied: ${error.response.data?.message}`);
        throw new Error(`Permission denied: Vérifie tes droits sur le dossier ACC`);
      }
      logger.error(`[PDFUpload] Item creation failed: ${error.response?.status}`);
      throw new Error(`Item creation failed: ${error.message}`);
    }
  }
}

module.exports = new PDFUploadService();
