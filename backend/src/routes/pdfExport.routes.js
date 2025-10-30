// backend/src/routes/pdfExport.routes.js
// Routes pour l'export PDF
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler.middleware');
const accExportService = require('../services/accExport.service');
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
