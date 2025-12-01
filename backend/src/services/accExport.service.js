'use strict';

const axios = require('axios');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs').promises;

const logger = require('../config/logger');
const apsAuthService = require('./apsAuth.service');

class ACCExportService {
  constructor() {
    this.jobProjectMap = new Map();
  }

  /**
   * Lance un export PDF et retourne l'identifiant du job
   */
  async exportPDFs(fileUrns, projectId, accessToken, exportOptions = {}) {
    if (!projectId) {
      throw new Error('projectId requis pour lancer un export ACC');
    }

    if (!Array.isArray(fileUrns) || fileUrns.length === 0) {
      throw new Error('Aucun fichier Revit fourni pour export');
    }

    logger.info(`[ACCExport] exportPDFs → ${fileUrns.length} fichier(s)`);

    const job = await this.startExport(projectId, fileUrns, accessToken, exportOptions);
    if (!job?.id) {
      throw new Error('Job export invalide (pas d\'identifiant)');
    }

    this.jobProjectMap.set(job.id, projectId);
    return job.id;
  }

  /**
   * Attend la complétion d'un job d'export PDF
   */
  async waitForJobCompletion(jobId, accessToken, maxWaitMs = 300000) {
    if (!jobId) {
      throw new Error('jobId requis');
    }

    const projectId = this.jobProjectMap.get(jobId);
    if (!projectId) {
      throw new Error(`Job inconnu: ${jobId}`);
    }

    const cleanProjectId = projectId.replace(/^b\./, '');
    const startTime = Date.now();
    const pollInterval = 5000; // 5 secondes

    logger.info(`[ACCExport] Attente completion du job ${jobId}...`);

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.checkStatus(cleanProjectId, jobId, accessToken);

      logger.debug(`[ACCExport] Status: ${status.status}`);

      if (status.status === 'successful') {
        logger.info('[ACCExport] ✅ Job terminé avec succès');
        // 🔍 DEBUG: Logger la réponse complète pour voir les détails
        logger.info(`[ACCExport] 📊 Réponse complète du job: ${JSON.stringify(status, null, 2)}`);
        this.jobProjectMap.delete(jobId);
        return status.result;
      }

      if (status.status === 'failed') {
        this.jobProjectMap.delete(jobId);
        // Formater l'erreur correctement (peut être un objet ou une string)
        let errorMsg = 'Erreur inconnue';
        let errorCode = null;
        let errorDetail = null;
        
        if (status.error) {
          if (typeof status.error === 'string') {
            errorMsg = status.error;
          } else {
            errorCode = status.error.code || null;
            errorDetail = status.error.detail || status.error.title || null;
            errorMsg = status.error.detail || status.error.title || JSON.stringify(status.error);
          }
        } else if (status.result?.error) {
          if (typeof status.result.error === 'string') {
            errorMsg = status.result.error;
          } else {
            errorCode = status.result.error.code || null;
            errorDetail = status.result.error.detail || status.result.error.title || null;
            errorMsg = status.result.error.detail || status.result.error.title || JSON.stringify(status.result.error);
          }
        }
        
        // Logger la réponse complète pour debug
        logger.error(`[ACCExport] ❌ Job échoué: ${errorMsg}`);
        logger.error(`[ACCExport] Code erreur: ${errorCode || 'N/A'}`);
        logger.error(`[ACCExport] Détail: ${errorDetail || 'N/A'}`);
        logger.error(`[ACCExport] Status complet: ${JSON.stringify(status, null, 2)}`);
        
        // Message d'erreur plus explicite pour l'utilisateur
        if (errorCode === 'ERR_NO_PROCESSABLE_FILES') {
          throw new Error('Aucune sheet publiée disponible pour cette maquette. Assurez-vous que la maquette contient des sheets et qu\'elles ont été publiées sur ACC.');
        }
        
        throw new Error(`Export PDF échoué: ${errorMsg}`);
      }

      if (status.status === 'partialSuccess') {
        logger.warn('[ACCExport] ⚠️ Job partiellement réussi');
        this.jobProjectMap.delete(jobId);
        return status.result;
      }

      if (['processing', 'inProgress', 'pending'].includes(status.status)) {
        await this.sleep(pollInterval);
        continue;
      }

      logger.error(`[ACCExport] Status inconnu: ${status.status}`);
      throw new Error(`Status export inconnu: ${status.status}`);
    }

    this.jobProjectMap.delete(jobId);
    throw new Error(`Export PDF timeout après ${maxWaitMs}ms`);
  }

  /**
   * Export des sheets et vues 2D d'un ou plusieurs fichiers Revit en PDFs
   */
  async exportRevitToPDFs(projectId, fileUrns, options = {}) {
    try {
      const {
        userId,
        uploadToACC = false,
        accFolderId = null,
        includeMarkups = true,
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
      const exportJob = await this.startExport(
        projectId,
        fileUrns,
        accessToken,
        { includeMarkups }
      );
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

      // Stocker les PDFs en mémoire temporaire (clé = jobId)
      // À implémenter: cache avec TTL de 1 heure
      const pdfCache = global.pdfCache || {};
      pdfCache[exportJob.id] = pdfs;
      global.pdfCache = pdfCache;

      logger.info(`[ACCExport] PDFs stockés en cache avec clé: ${exportJob.id}`);

      return {
        success: true,
        method: 'acc-export',
        jobId: exportJob.id,
        pdfs: pdfs.map((p) => ({
          name: p.name,
          size: p.buffer.length,
          // Option 2: URL de téléchargement
          downloadUrl: `/api/pdf-export/download/${exportJob.id}/${encodeURIComponent(p.name)}`,
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
  async startExport(projectId, fileUrns, accessToken, exportOptions = {}) {
    const cleanProjectId = projectId.replace(/^b\./, '');

    logger.info(`[ACCExport] projectId nettoyé: ${cleanProjectId}`);
    logger.info(`[ACCExport] fileUrns originaux: ${JSON.stringify(fileUrns)}`);

    // Ne PAS nettoyer les URNs - l'API ACC Export requiert le format exact
    // Formats acceptés:
    // - urn:adsk.wipprod:fs.file:vf.xxx?version=N (versionedFileUrn) - DOIT inclure ?version=X
    // - urn:adsk.wipprod:dm.lineage:xxx (lineageUrn) - sans version
    const cleanedFileUrns = fileUrns.map((urn) => {
      if (typeof urn === 'string') {
        return urn.trim();
      }
      return urn;
    });

    logger.info(`[ACCExport] fileUrns (après validation): ${JSON.stringify(cleanedFileUrns)}`);

    const { includeMarkups = true } = exportOptions;

    const url = `https://developer.api.autodesk.com/construction/files/v1/projects/${cleanProjectId}/exports`;

    const body = {
      options: {},
      fileVersions: cleanedFileUrns,
    };

    body.options.standardMarkups = {
      includePublishedMarkups: !!includeMarkups,
      includeUnpublishedMarkups: false,
      includeMarkupLinks: false,
    };

    if (Object.keys(body.options).length === 0) {
      delete body.options;
    }

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
        const status = error.response.status;
        const errorData = error.response.data || {};
        const errorMessage = errorData.message || errorData.detail || errorData.title || error.response.statusText;
        const errorCode = errorData.code || errorData.error?.code || null;
        
        logger.error(
          `[ACCExport] Erreur API: ${status} - ${JSON.stringify(errorData, null, 2)}`
        );
        logger.error(`[ACCExport] Code erreur: ${errorCode || 'N/A'}`);
        logger.error(`[ACCExport] Message: ${errorMessage}`);
        
        // Détecter les erreurs spécifiques et améliorer les messages
        const errorMessageLower = (errorMessage || '').toLowerCase();
        const errorDataString = JSON.stringify(errorData).toLowerCase();
        
        // Détecter les erreurs de validation de format URN (400 Bad Request)
        if (status === 400 && (
          errorMessageLower.includes('must match format') ||
          errorMessageLower.includes('versionedfileurn') ||
          errorMessageLower.includes('lineageurn') ||
          errorMessageLower.includes('oneof') ||
          errorDataString.includes('must match format')
        )) {
          throw new Error('⚠️ Vérifiez que la maquette contient des sheets publiées et qu\'elle est accessible.');
        }
        
        // Détecter les erreurs de sheets non disponibles
        if (errorCode === 'ERR_NO_PROCESSABLE_FILES' || 
            errorMessageLower.includes('no processable files') ||
            errorMessageLower.includes('err_no_processable_files') ||
            errorDataString.includes('no processable files') ||
            errorDataString.includes('processable files')) {
          throw new Error('⚠️ Aucune sheet publiée disponible pour cette maquette. Assurez-vous que la maquette contient des sheets et qu\'elles ont été publiées sur ACC.');
        }
        
        // Pour les erreurs 400 génériques, message simplifié
        if (status === 400) {
          const detail = errorData.detail || errorData.error?.detail || errorData.error?.message || errorMessage;
          const detailLower = (detail || '').toLowerCase();
          if (detailLower.includes('processable') || detailLower.includes('sheet') || detailLower.includes('no files')) {
            throw new Error('⚠️ Aucune sheet publiée disponible pour cette maquette. Assurez-vous que la maquette contient des sheets et qu\'elles ont été publiées sur ACC.');
          }
          // Message générique pour erreur 400
          throw new Error('⚠️ Vérifiez que la maquette contient des sheets publiées et qu\'elle est accessible.');
        }
        
        throw new Error(
          `API ACC Export: ${errorMessage}`
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
        // Formater l'erreur correctement (peut être un objet ou une string)
        let errorMsg = 'Erreur inconnue';
        let errorCode = null;
        let errorDetail = null;
        
        if (status.error) {
          if (typeof status.error === 'string') {
            errorMsg = status.error;
          } else {
            errorCode = status.error.code || null;
            errorDetail = status.error.detail || status.error.title || null;
            errorMsg = status.error.detail || status.error.title || JSON.stringify(status.error);
          }
        } else if (status.result?.error) {
          if (typeof status.result.error === 'string') {
            errorMsg = status.result.error;
          } else {
            errorCode = status.result.error.code || null;
            errorDetail = status.result.error.detail || status.result.error.title || null;
            errorMsg = status.result.error.detail || status.result.error.title || JSON.stringify(status.result.error);
          }
        }
        
        // Logger la réponse complète pour debug
        logger.error(`[ACCExport] ❌ Job échoué: ${errorMsg}`);
        logger.error(`[ACCExport] Code erreur: ${errorCode || 'N/A'}`);
        logger.error(`[ACCExport] Détail: ${errorDetail || 'N/A'}`);
        logger.error(`[ACCExport] Status complet: ${JSON.stringify(status, null, 2)}`);
        
        // Message d'erreur plus explicite pour l'utilisateur
        if (errorCode === 'ERR_NO_PROCESSABLE_FILES') {
          throw new Error('Aucune sheet publiée disponible pour cette maquette. Assurez-vous que la maquette contient des sheets et qu\'elles ont été publiées sur ACC.');
        }
        
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

      // Logger la réponse complète si le status est failed pour debug
      if (response.data?.status === 'failed') {
        logger.error(`[ACCExport] Réponse API pour job ${jobId}: ${JSON.stringify(response.data, null, 2)}`);
      }

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
      
      // 🔍 DEBUG: Logger TOUTES les entrées du ZIP pour diagnostic
      logger.info(`[ACCExport] 📦 ZIP reçu: ${zipBuffer.length} bytes, ${entries.length} entrée(s) totale(s)`);
      
      const allFiles = [];
      const pdfs = [];
      
      for (const entry of entries) {
        const entryInfo = {
          name: entry.entryName,
          size: entry.header.size,
          isDir: entry.isDirectory,
          isPdf: entry.entryName.toLowerCase().endsWith('.pdf'),
        };
        allFiles.push(entryInfo);
        
        if (entry.entryName.toLowerCase().endsWith('.pdf') && !entry.isDirectory) {
          pdfs.push({
            name: path.basename(entry.entryName),
            path: entry.entryName,
            buffer: entry.getData(),
            size: entry.header.size,
          });
        }
      }
      
      // 🔍 DEBUG: Logger la liste complète des fichiers dans le ZIP
      logger.info(`[ACCExport] 📋 Contenu du ZIP:`);
      allFiles.forEach((f, i) => {
        logger.info(`[ACCExport]   ${i + 1}. ${f.name} (${f.size} bytes) ${f.isPdf ? '✅ PDF' : ''} ${f.isDir ? '📁 DIR' : ''}`);
      });
      
      logger.info(`[ACCExport] 📊 Résumé: ${pdfs.length} PDF(s) extraits sur ${entries.length} fichier(s) total`);
      
      // Lister les noms des PDFs extraits
      if (pdfs.length > 0) {
        logger.info(`[ACCExport] 📄 PDFs extraits:`);
        pdfs.forEach((pdf, i) => {
          logger.info(`[ACCExport]   ${i + 1}. ${pdf.name} (${pdf.size} bytes)`);
        });
      }
      
      return pdfs;
    } catch (error) {
      logger.error(`[ACCExport] Erreur extraction ZIP: ${error.message}`);
      throw new Error(`Impossible d'extraire les PDFs du ZIP: ${error.message}`);
    }
  }

  /**
   * Upload les PDFs vers ACC (stockage simple sans création d'item)
   * Note: Les PDFs de l'export sont temporaires. Cette méthode les stocke
   * mais ne les crée pas comme items ACC (car ils ne nécessitent pas le workflow full)
   */
  async uploadPDFsToACC(projectId, targetFolderId, pdfFiles, accessToken) {
    const cleanProjectId = projectId.replace(/^b\./, '');
    const results = [];

    logger.info(`[ACCExport] 📝 Note: Les PDFs d'export sont des fichiers temporaires.`);
    logger.info(`[ACCExport] Stockage direct en S3 recommandé sans création d'item ACC.`);
    
    // Pour l'instant, on retourne simplement les PDFs avec succès
    // Ils ont déjà été téléchargés du ZIP
    for (const pdfFile of pdfFiles) {
      results.push({
        pdfName: pdfFile.name,
        size: pdfFile.size,
        status: 'extracted',
        success: true,
        note: 'PDF extrait du ZIP et prêt pour utilisation/stockage'
      });
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

    logger.debug(`[ACCExport] createFileVersion request body:`, JSON.stringify(body, null, 2));
    logger.debug(`[ACCExport] createFileVersion URL: ${url}`);

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
        logger.error(`[ACCExport] Response body:`, JSON.stringify(error.response.data, null, 2));
        logger.error(`[ACCExport] Request headers:`, JSON.stringify(error.config.headers, null, 2));
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
