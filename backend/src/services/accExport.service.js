'use strict';

const axios = require('axios');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs').promises;

const logger = require('../config/logger');
const apsAuthService = require('./apsAuth.service');

class ACCExportService {
  /**
   * Export des sheets et vues 2D d'un ou plusieurs fichiers Revit en PDFs
   */
  async exportRevitToPDFs(projectId, fileUrns, options = {}) {
    try {
      const {
        userId,
        uploadToACC = false,
        accFolderId = null,
      } = options;

      if (!projectId) {
        throw new Error('projectId requis pour lancer un export ACC');
      }

      if (!Array.isArray(fileUrns) || fileUrns.length === 0) {
        throw new Error('Aucun fichier Revit fourni pour export');
      }

      logger.info(`[ACCExport] Démarrage export PDF pour ${fileUrns.length} fichier(s)`);

      // 1. Obtenir le token d'accès
      const accessToken = await apsAuthService.ensureValidToken(userId);
      logger.info(`[ACCExport] Token utilisateur obtenu`);

      // 2. Lancer l'export
      const exportJob = await this.startExport(projectId, fileUrns, accessToken);
      logger.info(`[ACCExport] Job lancé: ${exportJob.id}`);

      // 3. Attendre la completion (polling)
      const result = await this.waitForCompletion(projectId, exportJob.id, accessToken);

      // Extraire le signed URL de la réponse
      const signedUrl = result?.signedUrl || result?.output?.signedUrl;

      if (!signedUrl) {
        logger.error('[ACCExport] ❌ Aucun signedUrl trouvé dans:', JSON.stringify(result, null, 2));
        throw new Error('Résultat export invalide: URL de téléchargement manquante');
      }

      logger.info(`[ACCExport] ✅ SignedUrl trouvé`);

      // 4. Télécharger le ZIP
      const zipBuffer = await this.downloadZip(signedUrl);
      logger.info(`[ACCExport] ZIP téléchargé: ${zipBuffer.length} bytes`);

      // 5. Extraire les PDFs individuels
      const pdfs = this.extractPDFsFromZip(zipBuffer);
      logger.info(`[ACCExport] ${pdfs.length} PDF(s) extrait(s) du ZIP`);

      // 6. Upload vers ACC si demandé
      const uploadResults = [];
      if (uploadToACC && accFolderId) {
        logger.info(`[ACCExport] Démarrage upload des PDFs vers ACC`);
        const accUploadResults = await this.uploadPDFsToACC(projectId, accFolderId, pdfs, accessToken);
        uploadResults.push(...accUploadResults);
      }

      return {
        success: true,
        method: 'acc-export',
        jobId: exportJob.id,
        pdfs: pdfs.map((p) => ({
          name: p.name,
          size: p.buffer.length,
        })),
        uploadResults: uploadResults.length > 0 ? uploadResults : null,
      };
    } catch (error) {
      logger.error(`[ACCExport] Erreur: ${error.message}`);
      throw error;
    }
  }

  /**
   * Lance l'export PDF via l'API ACC
   */
  async startExport(projectId, fileUrns, accessToken) {
    const cleanProjectId = projectId.replace(/^b\./, '');

    logger.info(`[ACCExport] projectId nettoyé: ${cleanProjectId}`);
    logger.info(`[ACCExport] fileUrns: ${JSON.stringify(fileUrns)}`);

    const url = `https://developer.api.autodesk.com/construction/files/v1/projects/${cleanProjectId}/exports`;

    const body = {
      options: {
        standardMarkups: {
          includePublishedMarkups: true,
          includeUnpublishedMarkups: false,
          includeMarkupLinks: false,
        },
      },
      fileVersions: fileUrns,
    };

    try {
      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(
          `[ACCExport] Erreur API: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
        throw new Error(
          `API ACC Export: ${error.response.data.message || error.response.statusText}`
        );
      }
      throw error;
    }
  }

  /**
   * Polling pour attendre la completion de l'export
   */
  async waitForCompletion(projectId, jobId, accessToken, maxWaitMs = 300000) {
    const cleanProjectId = projectId.replace(/^b\./, '');
    const startTime = Date.now();
    const pollInterval = 5000; // 5 secondes

    logger.info(`[ACCExport] Attente completion du job ${jobId}...`);
    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.checkStatus(cleanProjectId, jobId, accessToken);

      logger.debug(`[ACCExport] Status: ${status.status}`);

      if (status.status === 'successful') {
        logger.info('[ACCExport] ✅ Job terminé avec succès');
        return status.result;
      }

      if (status.status === 'failed') {
        const errorMsg = status.error || status.result?.error || 'Erreur inconnue';
        logger.error(`[ACCExport] ❌ Job échoué: ${errorMsg}`);
        throw new Error(`Export PDF échoué: ${errorMsg}`);
      }

      if (status.status === 'partialSuccess') {
        logger.warn('[ACCExport] ⚠️ Job partiellement réussi');
        return status.result;
      }

      if (['processing', 'inProgress', 'pending'].includes(status.status)) {
        await this.sleep(pollInterval);
        continue;
      }

      logger.error(`[ACCExport] Status inconnu: ${status.status}`);
      throw new Error(`Status export inconnu: ${status.status}`);
    }

    throw new Error(`Export PDF timeout après ${maxWaitMs}ms`);
  }

  /**
   * Vérifie le statut d'un job d'export
   */
  async checkStatus(projectId, jobId, accessToken) {
    const cleanProjectId = projectId.replace(/^b\./, '');
    const url = `https://developer.api.autodesk.com/construction/files/v1/projects/${cleanProjectId}/exports/${jobId}`;

    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`[ACCExport] Erreur check status: ${error.response.status}`);
        throw new Error(`Impossible de vérifier le status: ${error.response.statusText}`);
      }
      throw error;
    }
  }

  /**
   * Télécharge le ZIP depuis l'URL signée
   */
  async downloadZip(signedUrl) {
    try {
      const response = await axios.get(signedUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });
      return Buffer.from(response.data);
    } catch (error) {
      logger.error(`[ACCExport] Erreur téléchargement ZIP: ${error.message}`);
      throw new Error(`Impossible de télécharger le ZIP: ${error.message}`);
    }
  }

  /**
   * Extrait les PDFs individuels d'un ZIP
   */
  extractPDFsFromZip(zipBuffer) {
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      const pdfs = [];
      for (const entry of entries) {
        if (entry.entryName.toLowerCase().endsWith('.pdf') && !entry.isDirectory) {
          pdfs.push({
            name: path.basename(entry.entryName),
            path: entry.entryName,
            buffer: entry.getData(),
            size: entry.header.size,
          });
        }
      }
      return pdfs;
    } catch (error) {
      logger.error(`[ACCExport] Erreur extraction ZIP: ${error.message}`);
      throw new Error(`Impossible d'extraire les PDFs du ZIP: ${error.message}`);
    }
  }

  /**
   * Upload les PDFs vers ACC (nouvelle approche avec OSS)
   */
  async uploadPDFsToACC(projectId, targetFolderId, pdfFiles, accessToken) {
    const cleanProjectId = projectId.replace(/^b\./, '');
    const results = [];

    for (const pdfFile of pdfFiles) {
      try {
        logger.info(`[ACCExport] Upload PDF: ${pdfFile.name}`);

        // 1. Créer l'objet storage
        const storage = await this.createStorageObject(
          cleanProjectId,
          targetFolderId,
          pdfFile.name,
          accessToken
        );

        const objectId = storage.data?.id;
        if (!objectId) {
          throw new Error(`Pas d'objectId dans la réponse storage`);
        }

        logger.debug(`[ACCExport] Storage créé: ${objectId}`);

        // 2. Parser l'objectId pour obtenir bucket et object key
        const objectIdParts = objectId.split(':');
        const bucketAndObject = objectIdParts[objectIdParts.length - 1]; // ex: "wip.dm.prod/abc.pdf"
        const [bucketKey, ...objectKeyParts] = bucketAndObject.split('/');
        const objectKey = objectKeyParts.join('/');

        if (!bucketKey || !objectKey) {
          throw new Error(
            `Impossible de parser l'objectId: bucketKey=${bucketKey}, objectKey=${objectKey}`
          );
        }

        logger.debug(`[ACCExport] Bucket: ${bucketKey}, Object: ${objectKey}`);

        // 3. Obtenir l'URL signée S3 pour upload
        const signedS3 = await this.getSignedS3Upload(bucketKey, objectKey, accessToken);
        logger.debug(`[ACCExport] Signed S3 response:`, JSON.stringify(signedS3, null, 2));

        const uploadUrl = signedS3.urls?.[0] || signedS3.url;
        const uploadKey = signedS3.uploadKey;

        if (!uploadUrl) {
          throw new Error(`Pas d'URL d'upload dans la réponse: ${JSON.stringify(signedS3)}`);
        }

        logger.debug(`[ACCExport] Upload URL reçue (${uploadUrl.length} chars)`);

        // 4. Upload le PDF vers S3
        logger.debug(`[ACCExport] Upload PDF vers S3 (${pdfFile.buffer.length} bytes)`);
        await this.uploadFileToS3(uploadUrl, pdfFile.buffer);
        logger.info(`[ACCExport] ✅ PDF uploadé vers S3`);

        // 5. Finaliser l'upload si uploadKey fourni
        if (uploadKey) {
          logger.debug(`[ACCExport] Finalisation upload avec key: ${uploadKey}`);
          await this.completeS3Upload(bucketKey, objectKey, uploadKey, accessToken);
        }

        // 6. Créer l'item/version dans ACC
        logger.debug(`[ACCExport] Création de l'item dans ACC`);
        const fileVersion = await this.createFileVersion(
          cleanProjectId,
          targetFolderId,
          pdfFile.name,
          objectId,
          accessToken
        );

        logger.info(`[ACCExport] ✅ PDF ${pdfFile.name} uploadé avec succès`);

        results.push({
          pdfName: pdfFile.name,
          objectId,
          success: true,
        });
      } catch (error) {
        logger.error(`[ACCExport] ❌ Erreur upload ${pdfFile.name}: ${error.message}`);
        results.push({
          pdfName: pdfFile.name,
          error: error.message,
          success: false,
        });
      }
    }

    return results;
  }

  /**
   * Crée un objet storage dans ACC
   */
  async createStorageObject(projectId, folderId, fileName, accessToken) {
    const url = `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/storage`;

    const body = {
      jsonapi: { version: '1.0' },
      data: {
        type: 'objects',
        attributes: {
          name: fileName,
        },
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
      if (error.response) {
        logger.error(`[ACCExport] createStorageObject error: ${error.response.status}`);
      }
      throw new Error(`Erreur création storage: ${error.message}`);
    }
  }

  /**
   * Obtient une URL signée S3 pour upload
   */
  async getSignedS3Upload(bucketKey, objectKey, accessToken) {
    const url = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`;

    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`[ACCExport] getSignedS3Upload error: ${error.response.status}`);
        logger.error(`[ACCExport] Response:`, JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Erreur obtention URL S3: ${error.message}`);
    }
  }

  /**
   * Upload le fichier vers S3
   */
  async uploadFileToS3(uploadUrl, fileBuffer) {
    try {
      const response = await axios.put(uploadUrl, fileBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileBuffer.length,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      return response.status;
    } catch (error) {
      logger.error(`[ACCExport] S3 upload error: ${error.message}`);
      throw new Error(`Erreur upload S3: ${error.message}`);
    }
  }

  /**
   * Complète l'upload S3
   */
  async completeS3Upload(bucketKey, objectKey, uploadKey, accessToken) {
    const url = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`;

    const body = {
      uploadKey: uploadKey,
    };

    try {
      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`[ACCExport] completeS3Upload error: ${error.response.status}`);
      }
      throw new Error(`Erreur finalisation S3: ${error.message}`);
    }
  }

  /**
   * Crée un item/version dans ACC
   */
  async createFileVersion(projectId, folderId, fileName, objectId, accessToken) {
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
          tip: {
            data: {
              type: 'versions',
              id: '1',
            },
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
              type: 'versions:autodesk.core:File',
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

    try {
      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/vnd.api+json',
        },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`[ACCExport] createFileVersion error: ${error.response.status}`);
        logger.error(`[ACCExport] Response:`, JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Erreur création file version: ${error.message}`);
    }
  }

  /**
   * Utilitaire: sleep
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new ACCExportService();
