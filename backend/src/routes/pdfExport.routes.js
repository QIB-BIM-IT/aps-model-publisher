// backend/src/routes/pdfExport.routes.js
// Routes pour l'export PDF
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler.middleware');
const accExportService = require('../services/accExport.service');
const apsAuthService = require('../services/apsAuth.service');
const pdfUploadService = require('../services/pdfUpload.service');
const logger = require('../config/logger');

router.use(authenticateToken);

/**
 * GET /api/pdf-export/download/:jobId/:fileName
 * Télécharge un PDF depuis le cache
 */
router.get('/download/:jobId/:fileName', asyncHandler(async (req, res) => {
  const { jobId, fileName } = req.params;

  logger.debug(`[PDFExport] Download demandé: jobId=${jobId}, fileName=${fileName}`);

  // Récupérer du cache
  const pdfCache = global.pdfCache || {};
  const pdfs = pdfCache[jobId];

  if (!pdfs || !Array.isArray(pdfs)) {
    logger.warn(`[PDFExport] Cache expiré ou vide pour jobId=${jobId}`);
    return res.status(404).json({ success: false, message: 'PDF cache expired' });
  }

  // Trouver le PDF
  const decodedFileName = decodeURIComponent(fileName);
  const pdf = pdfs.find((p) => p.name === decodedFileName);

  if (!pdf) {
    logger.warn(`[PDFExport] PDF non trouvé: ${decodedFileName}`);
    return res.status(404).json({ success: false, message: 'PDF not found' });
  }

  logger.info(`[PDFExport] ✅ Envoi du PDF: ${decodedFileName} (${pdf.buffer.length} bytes)`);

  // Envoyer le PDF
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${decodedFileName}"`);
  res.setHeader('Content-Length', pdf.buffer.length);

  res.send(pdf.buffer);
}));

/**
 * POST /api/pdf-export/export
 * Lance un export PDF manuel
 */
router.post('/export', asyncHandler(async (req, res) => {
  const {
    projectId,
    fileUrns,
    uploadToACC = false,
    accFolderId = null,
  } = req.body;

  // Validation
  if (!projectId) {
    throw new ValidationError('projectId requis');
  }
  if (!Array.isArray(fileUrns) || fileUrns.length === 0) {
    throw new ValidationError('fileUrns requis (array non vide)');
  }
  if (uploadToACC && !accFolderId) {
    throw new ValidationError('accFolderId requis si uploadToACC=true');
  }

  logger.info(`[PDFExport] Export demandé par user ${req.userId} pour ${fileUrns.length} fichier(s)`);

  // Lancer l'export
  const result = await accExportService.exportRevitToPDFs(
    projectId,
    fileUrns,
    {
      userId: req.userId,
      uploadToACC,
      accFolderId,
    }
  );

  res.json({
    success: true,
    data: result
  });
}));

/**
 * POST /api/pdf-export/save-to-acc
 * Merge + Upload des PDFs sur ACC
 */
router.post('/save-to-acc', asyncHandler(async (req, res) => {
  const {
    jobId,
    projectId,
    folderId,
    fileName,
    pdfNames,
    mergeAll = false,
  } = req.body;

  // Validation
  if (!jobId) throw new ValidationError('jobId requis');
  if (!projectId) throw new ValidationError('projectId requis');
  if (!folderId) throw new ValidationError('folderId requis');
  if (!Array.isArray(pdfNames) || pdfNames.length === 0) {
    throw new ValidationError('Au moins un PDF requis');
  }
  if (mergeAll && !fileName) {
    throw new ValidationError('fileName requis quand mergeAll=true');
  }

  logger.info(`[PDFUpload] Save-to-ACC demandé: jobId=${jobId}, merge=${mergeAll}`);

  // Récupérer PDFs du cache
  const pdfCache = global.pdfCache || {};
  const pdfs = pdfCache[jobId];

  if (!pdfs) {
    throw new ValidationError('PDFs cache expiré');
  }

  // Filtrer les PDFs demandés
  const selectedPdfs = pdfs.filter((p) => pdfNames.includes(p.name));

  if (selectedPdfs.length === 0) {
    throw new ValidationError('Aucun PDF sélectionné');
  }

  // Obtenir token
  const accessToken = await apsAuthService.ensureValidToken(req.userId);

  try {
    const uploadResults = [];

    if (mergeAll && selectedPdfs.length > 1) {
      // Fusionner tous les PDFs
      logger.info(`[PDFUpload] Fusion de ${selectedPdfs.length} PDFs...`);
      const pdfBuffers = selectedPdfs.map((p) => p.buffer);
      const mergedBuffer = await pdfUploadService.mergePDFs(pdfBuffers, fileName);

      // Upload le PDF fusionné
      const result = await pdfUploadService.uploadPDFToACC(
        { buffer: mergedBuffer, filename: fileName },
        projectId,
        folderId,
        accessToken
      );

      uploadResults.push(result);
      logger.info(`[PDFUpload] ✅ PDF fusionné uploadé: ${fileName}`);
    } else {
      // Upload individuels
      for (const pdf of selectedPdfs) {
        logger.info(`[PDFUpload] Upload: ${pdf.name}`);
        const result = await pdfUploadService.uploadPDFToACC(
          { buffer: pdf.buffer, filename: pdf.name },
          projectId,
          folderId,
          accessToken
        );
        uploadResults.push(result);
      }
    }

    res.json({
      success: true,
      message: `${uploadResults.length} PDF(s) uploadé(s) sur ACC`,
      uploads: uploadResults,
    });
  } catch (error) {
    logger.error(`[PDFUpload] Erreur: ${error.message}`);
    throw error;
  }
}));

/**
 * POST /api/pdf-export/export-and-save
 * Endpoint combiné: Export + Upload en une seule action
 */
router.post('/export-and-save', async (req, res) => {
  try {
    const { fileUrn, projectId, folderId } = req.body;

    if (!fileUrn || !projectId || !folderId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['fileUrn', 'projectId', 'folderId']
      });
    }

    const userToken = req.headers['x-user-token'];
    if (!userToken) {
      return res.status(401).json({ error: 'Missing user token' });
    }

    logger.info(`[ExportAndSave] Démarrage export + upload pour: ${fileUrn}`);

    // ÉTAPE 1: Export PDF
    logger.info('[ExportAndSave] 1/2 - Export des PDFs...');
    const jobId = await accExportService.exportPDFs([fileUrn], projectId, userToken);

    const jobResult = await accExportService.waitForJobCompletion(jobId, userToken);

    if (jobResult.status !== 'successful' && jobResult.status !== 'partialSuccess') {
      throw new Error(`Export échoué: ${jobResult.status}`);
    }

    if (!jobResult.signedUrl) {
      throw new Error('Export terminé mais aucune URL de téléchargement trouvée');
    }

    const zipBuffer = await accExportService.downloadZip(jobResult.signedUrl);
    const pdfs = await accExportService.extractPDFsFromZip(zipBuffer);

    logger.info(`[ExportAndSave] ✅ ${pdfs.length} PDF(s) extraits`);

    // ÉTAPE 2: Upload direct sur ACC
    logger.info('[ExportAndSave] 2/2 - Upload sur ACC...');
    const uploadResults = [];
    const uploadErrors = [];

    for (const pdf of pdfs) {
      const originalName = pdf.filename || pdf.name || 'document.pdf';
      try {
        const result = await pdfUploadService.uploadPDFToACC(
          { buffer: pdf.buffer, filename: originalName },
          projectId,
          folderId,
          userToken
        );

        uploadResults.push({
          filename: originalName.replace(/^Feuilles-/i, ''),
          success: true,
          itemId: result.itemId,
          versionId: result.versionId,
        });
      } catch (error) {
        logger.error(`[ExportAndSave] Erreur upload ${originalName}: ${error.message}`);
        uploadErrors.push({
          filename: originalName,
          error: error.message,
        });
      }
    }

    const response = {
      success: uploadResults.length > 0,
      exported: pdfs.length,
      uploaded: uploadResults.length,
      failed: uploadErrors.length,
      results: uploadResults,
      errors: uploadErrors.length > 0 ? uploadErrors : undefined,
    };

    logger.info(`[ExportAndSave] ✅ Terminé: ${uploadResults.length}/${pdfs.length} PDFs sur ACC`);

    res.json(response);
  } catch (error) {
    logger.error(`[ExportAndSave] Erreur: ${error.message}`);
    res.status(500).json({
      error: 'Export and save failed',
      message: error.message,
    });
  }
});

/**
 * GET /api/pdf-export/check-readiness
 * Point de terminaison conservé pour compatibilité mais toujours prêt côté ACC Export.
 */
router.get('/check-readiness', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      ready: true,
      status: 'managed_by_acc_export',
      message: "L'ACC Export API gère automatiquement la préparation des fichiers.",
    },
  });
}));

/**
 * GET /api/pdf-export/test
 * Route de test (à supprimer en prod)
 */
router.get('/test', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    message: 'PDF Export API fonctionnelle',
    endpoints: {
      export: 'POST /api/pdf-export/export',
      checkReadiness: 'GET /api/pdf-export/check-readiness'
    }
  });
}));

/**
 * Cleanup: Nettoyer le cache après 1 heure
 */
setInterval(() => {
  const pdfCache = global.pdfCache || {};

  // Implémenter avec timestamps si besoin de TTL stricte
  // Pour l'instant, on garde tout en mémoire
  logger.debug(`[PDFExport] Cache cleanup: ${Object.keys(pdfCache).length} jobs en cache`);
}, 60 * 60 * 1000); // Toutes les heures

module.exports = router;
