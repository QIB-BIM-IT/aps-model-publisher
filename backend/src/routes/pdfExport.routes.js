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

module.exports = router;
