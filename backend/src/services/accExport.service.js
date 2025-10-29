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
   *
   * IMPORTANT : l'ACC Export API gère automatiquement la préparation Model Derivative.
   * Aucune vérification de manifest ou déclenchement de traduction n'est nécessaire côté app.
   *
   * @param {string} projectId - ID du projet ACC (format: b.{guid})
   * @param {string[]} fileUrns - URNs des fichiers Revit
   * @param {object} options - Options d'export
   * @returns {Promise<object>} Résultat de l'export
   */
  async exportRevitToPDFs(projectId, fileUrns, options = {}) {
    try {
      const {
        userId,
        uploadToACC = false,
        accFolderId = null,
        downloadLocally = false,
        localPath = null,
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

      logger.info(`[ACCExport] TOKEN COMPLET (à copier): ${accessToken}`);

      logger.info(`[ACCExport] Token utilisateur commence par: ${accessToken.substring(0, 20)}...`);

      try {
        const tokenParts = accessToken.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
          logger.info(`[ACCExport] Scopes du token utilisateur: ${JSON.stringify(payload.scope)}`);
          logger.info(
            `[ACCExport] Token expire à: ${new Date(payload.exp * 1000).toISOString()}`
          );
        }
      } catch (e) {
        logger.warn(`[ACCExport] Impossible de décoder le token: ${e.message}`);
      }

      // 2. Lancer l'export
      const exportJob = await this.startExport(projectId, fileUrns, accessToken);
      logger.info(`[ACCExport] Job lancé: ${exportJob.id}`);

      // 3. Attendre la completion (polling)
      const result = await this.waitForCompletion(projectId, exportJob.id, accessToken);

      if (!result || !result.signedUrl) {
        throw new Error('Résultat export invalide: URL de téléchargement manquante');
      }

      // 4. Télécharger le ZIP
      const zipBuffer = await this.downloadZip(result.signedUrl);
      logger.info(`[ACCExport] ZIP téléchargé: ${zipBuffer.length} bytes`);

      // 5. Extraire les PDFs individuels
      const pdfs = this.extractPDFsFromZip(zipBuffer);
      logger.info(`[ACCExport] ${pdfs.length} PDF(s) extrait(s) du ZIP`);

      // 6. Upload vers ACC si demandé
      const uploadResults = [];
      if (uploadToACC && accFolderId) {
        for (const pdf of pdfs) {
          try {
            const uploaded = await this.uploadPDFToACC(projectId, pdf, accFolderId, accessToken);
            uploadResults.push(uploaded);
            logger.info(`[ACCExport] ✓ Uploadé: ${pdf.name}`);
          } catch (uploadError) {
            logger.error(`[ACCExport] ✗ Erreur upload ${pdf.name}: ${uploadError.message}`);
            uploadResults.push({
              pdfName: pdf.name,
              error: uploadError.message,
              success: false,
            });
          }
        }
      }

      // 7. Sauvegarde locale si demandé
      if (downloadLocally && localPath) {
        await this.savePDFsLocally(pdfs, localPath);
      }

      return {
        success: true,
        method: 'acc-export',
        cost: 0,
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
   * Lance l'export PDF via l'API ACC.
   *
   * IMPORTANT : fournir les VERSION URNs (dm.version).
   */
  async startExport(projectId, fileUrns, accessToken) {
    const cleanProjectId = projectId.replace(/^b\./, '');

    logger.info(`[ACCExport] projectId original: ${projectId}`);
    logger.info(`[ACCExport] projectId nettoyé: ${cleanProjectId}`);
    logger.info(`[ACCExport] fileUrns (version URNs): ${JSON.stringify(fileUrns)}`);

    const url = `https://developer.api.autodesk.com/construction/files/v1/projects/${cleanProjectId}/exports`;

    logger.info(`[ACCExport] URL complète: ${url}`);

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

    logger.info(`[ACCExport] Body envoyé: ${JSON.stringify(body, null, 2)}`);

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
        logger.error(`[ACCExport] Headers response: ${JSON.stringify(error.response.headers)}`);
        // Certains statuts comme 207 (partial success) renvoient quand même un payload exploitable
        if (error.response.status === 200 || error.response.status === 207) {
          return error.response.data;
        }

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

      if (status.status === 'success') {
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
        if (status.result?.failedFiles) {
          status.result.failedFiles.forEach((f) => {
            logger.warn(`[ACCExport]   Fichier échoué: ${f.id} - ${f.reason}`);
          });
        }
        // Retourner quand même le résultat partiel
        return status.result;
      }

      // Stati en cours : 'processing', 'inProgress', 'pending'
      if (['processing', 'inProgress', 'pending'].includes(status.status)) {
        await this.sleep(pollInterval);
        continue;
      }

      // Status inconnu
      logger.warn(`[ACCExport] Status inconnu: ${status.status}`);
      await this.sleep(pollInterval);
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
        timeout: 60000, // 60 secondes
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
        // Filtrer seulement les PDFs (ignorer dossiers et autres fichiers)
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
   * Upload un PDF vers ACC
   */
  async uploadPDFToACC(projectId, pdf, targetFolderId, accessToken) {
    try {
      // 1. Créer le storage location
      const storage = await this.createStorage(projectId, targetFolderId, pdf.name, accessToken);

      // 2. Upload le contenu du PDF
      await this.uploadContent(storage.uploadUrl, pdf.buffer);

      // 3. Créer l'item dans ACC
      const item = await this.createACCItem(projectId, targetFolderId, storage.objectId, pdf.name, accessToken);
      return {
        pdfName: pdf.name,
        accItemId: item.data?.id || null,
        accVersionId: item.included?.[0]?.id || null,
        success: true,
      };
    } catch (error) {
      logger.error(`[ACCExport] Erreur upload ${pdf.name}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Crée un storage location dans ACC
   */
  async createStorage(projectId, folderId, fileName, accessToken) {
    const cleanProjectId = projectId.replace(/^b\./, '');
    const url = `https://developer.api.autodesk.com/data/v1/projects/b.${cleanProjectId}/storage`;

    let response;
    try {
      response = await axios.post(
        url,
        {
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
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/vnd.api+json',
          },
        }
      );
    } catch (error) {
      if (error.response) {
        logger.error(`[ACCExport] Erreur createStorage: ${error.response.status}`);
      }
      throw new Error(`Impossible de créer le storage ACC pour ${fileName}: ${error.message}`);
    }

    const objectId = response.data.data.id;
    const uploadKey = response.data.data.attributes.uploadKey;

    // Construire l'URL d'upload OSS
    const bucketSegment = objectId.split(':')[3] || '';
    const bucketKey = bucketSegment.split('/')[0];
    const derivedObjectKey = bucketSegment.split('/').slice(1).join('/') || objectId.split('/').pop();
    const objectKey = uploadKey || derivedObjectKey;

    if (!bucketKey || !objectKey) {
      throw new Error("Impossible de déterminer l'URL d'upload OSS");
    }

    const uploadUrl = `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}`;

    return {
      objectId,
      uploadUrl,
    };
  }

  /**
   * Upload le contenu vers OSS
   */
  async uploadContent(uploadUrl, buffer) {
    try {
      await axios.put(uploadUrl, buffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': buffer.length,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    } catch (error) {
      logger.error(`[ACCExport] Erreur upload OSS: ${error.message}`);
      throw new Error(`Impossible d'uploader le PDF vers OSS: ${error.message}`);
    }
  }

  /**
   * Crée un item (version) dans ACC
   */
  async createACCItem(projectId, folderId, objectId, fileName, accessToken) {
    const cleanProjectId = projectId.replace(/^b\./, '');
    const url = `https://developer.api.autodesk.com/data/v1/projects/b.${cleanProjectId}/items`;

    try {
      const response = await axios.post(
        url,
        {
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
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/vnd.api+json',
          },
        }
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`[ACCExport] Erreur createACCItem: ${error.response.status}`);
      }
      throw new Error(`Impossible de créer l'item ACC ${fileName}: ${error.message}`);
    }
  }

  /**
   * Sauvegarde les PDFs localement (optionnel)
   */
  async savePDFsLocally(pdfs, localPath) {
    await fs.mkdir(localPath, { recursive: true });
    for (const pdf of pdfs) {
      const filePath = path.join(localPath, pdf.name);
      await fs.writeFile(filePath, pdf.buffer);
      logger.info(`[ACCExport] 💾 Sauvegardé: ${filePath}`);
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
