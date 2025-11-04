// backend/src/routes/pdfExport.routes.js
// Routes pour l'export PDF
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler.middleware');
const accExportService = require('../services/accExport.service');
const apsAuthService = require('../services/apsAuth.service');
const pdfUploadService = require('../services/pdfUpload.service');
const logger = require('../config/logger');

router.use(authenticateToken);

function sanitizeString(value = '') {
  return value
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripPdfName(name = '') {
  return sanitizeString(name.replace(/\.pdf$/i, '').replace(/^feuilles?[-_\s]+/i, ''));
}

function matchesSheet(pdfName, sheet) {
  const normalizedPdf = stripPdfName(pdfName);
  if (!sheet) {
    return false;
  }

  const candidates = new Set();
  if (sheet.number) {
    candidates.add(sanitizeString(sheet.number));
    candidates.add(sanitizeString(sheet.number.replace(/[^a-z0-9]/gi, '')));
  }
  if (sheet.name) {
    candidates.add(sanitizeString(sheet.name));
  }
  if (sheet.number && sheet.name) {
    candidates.add(sanitizeString(`${sheet.number} ${sheet.name}`));
  }
  if (sheet.id) {
    candidates.add(sanitizeString(sheet.id.toString()));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (normalizedPdf.includes(candidate)) {
      return true;
    }
  }

  return false;
}

function classifyPdf(name = '') {
  const normalized = stripPdfName(name);
  const original = name.toLowerCase();

  const isMarkup = /markup|annotation|commentaire/.test(normalized);
  const isView =
    /view|vue|coupe|section|elevation|detail/.test(normalized) ||
    /view|vue/.test(original);

  let type = 'sheet';
  if (isMarkup) {
    type = 'markup';
  } else if (isView) {
    type = 'view2d';
  }

  return type;
}

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
 * POST /api/pdf-export/list-sheets
 * Récupère la liste des sheets et vues 2D d'un fichier Revit
 */
router.post('/list-sheets', asyncHandler(async (req, res) => {
  const { fileUrn, projectId } = req.body;

  if (!fileUrn || !projectId) {
    throw new ValidationError('fileUrn et projectId requis');
  }

  const userToken = req.headers['x-user-token'];
  if (!userToken) {
    return res.status(401).json({ error: 'Missing user token' });
  }

  logger.info(`[ListSheets] Récupération sheets pour: ${fileUrn}`);

  try {
    const urnBase64 = Buffer.from(fileUrn)
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const metadataUrl = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urnBase64}/metadata`;

    const metadataResponse = await axios.get(metadataUrl, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    const guid = metadataResponse.data?.data?.metadata?.[0]?.guid;
    if (!guid) {
      throw new Error('Impossible de récupérer le GUID du modèle');
    }

    const propsUrl = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urnBase64}/metadata/${guid}/properties`;
    const propsResponse = await axios.get(propsUrl, {
      headers: { Authorization: `Bearer ${userToken}` },
      params: { forceget: true }
    });

    const objects = propsResponse.data?.data?.collection || [];
    const sheets = [];
    const views2D = [];

    objects.forEach((obj) => {
      const props = obj.properties || {};
      const name = props.name || obj.name || 'Sans nom';
      const category = props.Category || props.category || '';
      const type = props.Type || props.type || '';
      const normalizedCategory = category.toLowerCase();
      const normalizedType = type.toLowerCase();

      if (
        normalizedCategory.includes('sheet') ||
        normalizedCategory.includes('feuille') ||
        normalizedType.includes('sheet')
      ) {
        sheets.push({
          id: obj.objectid,
          name,
          number: props['Sheet Number'] || props.Number || props['SheetNumber'] || '',
          category,
        });
        return;
      }

      const is2DView =
        (normalizedCategory.includes('view') || normalizedType.includes('view')) &&
        !normalizedCategory.includes('3d') &&
        !normalizedType.includes('3d');

      if (is2DView) {
        views2D.push({
          id: obj.objectid,
          name,
          type: props.Type || category,
          category,
        });
      }
    });

    logger.info(`[ListSheets] Trouvé ${sheets.length} sheets et ${views2D.length} vues 2D`);

    res.json({
      success: true,
      fileUrn,
      sheets: sheets.sort((a, b) => {
        if (a.number && b.number) {
          return a.number.localeCompare(b.number, undefined, { numeric: true });
        }
        return a.name.localeCompare(b.name);
      }),
      views2D: views2D.sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    const status = error.response?.status;
    const details = error.response?.data;
    const detailMessage = typeof details === 'string'
      ? details
      : details?.message || details?.error || '';

    const logParts = [`[ListSheets] Erreur`];
    if (status) logParts.push(`status=${status}`);
    logParts.push(`message=${error.message}`);
    if (detailMessage) logParts.push(`details=${detailMessage}`);

    logger.error(logParts.join(' | '));

    res.status(status === 404 ? 404 : 500).json({
      success: false,
      error: 'Failed to list sheets',
      message: detailMessage || error.message,
    });
  }
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
    const {
      fileUrn,
      projectId,
      folderId,
      filters = {},
      selectionMode = 'filters',
      customSheets = [],
      exportMode = 'individual',
      combinedFileName,
    } = req.body;

    if (!fileUrn || !projectId || !folderId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['fileUrn', 'projectId', 'folderId']
      });
    }

    if (selectionMode === 'custom' && (!Array.isArray(customSheets) || customSheets.length === 0)) {
      return res.status(400).json({
        error: 'No sheets selected',
        message: 'Veuillez sélectionner au moins une feuille pour un export personnalisé',
      });
    }

    if (exportMode === 'combined' && (!combinedFileName || !combinedFileName.trim())) {
      return res.status(400).json({
        error: 'Missing combined file name',
        message: 'Un nom de fichier est requis pour la fusion des PDFs',
      });
    }

    const userToken = req.headers['x-user-token'];
    if (!userToken) {
      return res.status(401).json({ error: 'Missing user token' });
    }

    const includeSheets = filters.includeSheets !== false;
    const includeViews2D = filters.includeViews2D !== false;
    const includeMarkups = filters.includeMarkups !== false;

    logger.info(
      `[ExportAndSave] Démarrage export + upload pour: ${fileUrn} (filters: sheets=${includeSheets}, views=${includeViews2D}, markups=${includeMarkups}, mode=${selectionMode}, exportMode=${exportMode})`
    );

    logger.info('[ExportAndSave] 1/2 - Export des PDFs...');
    const jobId = await accExportService.exportPDFs(
      [fileUrn],
      projectId,
      userToken,
      { includeMarkups }
    );

    const jobResult = await accExportService.waitForJobCompletion(jobId, userToken);

    if (jobResult.status !== 'successful' && jobResult.status !== 'partialSuccess') {
      throw new Error(`Export échoué: ${jobResult.status}`);
    }

    if (!jobResult.signedUrl) {
      throw new Error('Export terminé mais aucune URL de téléchargement trouvée');
    }

    const zipBuffer = await accExportService.downloadZip(jobResult.signedUrl);
    const extractedPdfs = await accExportService.extractPDFsFromZip(zipBuffer);

    logger.info(`[ExportAndSave] ✅ ${extractedPdfs.length} PDF(s) extraits`);

    const filteredPdfs = extractedPdfs
      .map((pdf) => ({
        ...pdf,
        originalName: pdf.filename || pdf.name || 'document.pdf',
        type: classifyPdf(pdf.filename || pdf.name || ''),
      }))
      .filter((pdf) => {
        if (pdf.type === 'sheet') {
          return includeSheets;
        }
        if (pdf.type === 'view2d') {
          return includeViews2D;
        }
        if (pdf.type === 'markup') {
          return includeMarkups;
        }
        return true;
      });

    if (filteredPdfs.length === 0) {
      return res.status(400).json({
        error: 'No PDFs after filtering',
        message: 'Aucun PDF disponible avec les filtres sélectionnés',
      });
    }

    let selectedPdfs = filteredPdfs;
    let unmatchedSheets = [];

    if (selectionMode === 'custom') {
      const matched = [];
      const notMatched = [];

      filteredPdfs.forEach((pdf) => {
        const match = customSheets.find((sheet) => matchesSheet(pdf.originalName, sheet));
        if (match) {
          matched.push({ ...pdf, matchedSheet: match });
        }
      });

      const matchedIds = new Set(matched.map((pdf) => pdf.matchedSheet?.id));
      customSheets.forEach((sheet) => {
        if (!matchedIds.has(sheet.id)) {
          notMatched.push(sheet);
        }
      });

      if (matched.length === 0) {
        return res.status(400).json({
          error: 'No matching PDFs',
          message: 'Impossible de trouver des PDFs correspondant aux sheets sélectionnées',
          unmatchedSheets: notMatched,
        });
      }

      selectedPdfs = matched;
      unmatchedSheets = notMatched;
    }

    logger.info(
      `[ExportAndSave] PDFs retenus pour upload: ${selectedPdfs.length}/${filteredPdfs.length} (extraits=${extractedPdfs.length})`
    );

    logger.info('[ExportAndSave] 2/2 - Upload sur ACC...');
    const uploadResults = [];
    const uploadErrors = [];

    if (exportMode === 'combined') {
      const targetName = pdfUploadService.ensurePdfExtension(
        pdfUploadService.sanitizeFileName(combinedFileName.trim())
      );

      try {
        const mergedBuffer = await pdfUploadService.mergePDFs(
          selectedPdfs.map((pdf) => pdf.buffer),
          targetName
        );

        const result = await pdfUploadService.uploadPDFToACC(
          { buffer: mergedBuffer, filename: targetName },
          projectId,
          folderId,
          userToken
        );

        uploadResults.push({
          filename: targetName,
          success: true,
          itemId: result.itemId,
          versionId: result.versionId,
          mergedCount: selectedPdfs.length,
        });
      } catch (error) {
        logger.error(`[ExportAndSave] Erreur fusion/upload combiné: ${error.message}`);
        uploadErrors.push({
          filename: combinedFileName,
          error: error.message,
        });
      }
    } else {
      for (const pdf of selectedPdfs) {
        const sanitizedName = pdfUploadService.ensurePdfExtension(
          pdfUploadService.sanitizeFileName(pdf.originalName)
        );

        try {
          const result = await pdfUploadService.uploadPDFToACC(
            { buffer: pdf.buffer, filename: sanitizedName },
            projectId,
            folderId,
            userToken
          );

          uploadResults.push({
            filename: sanitizedName,
            success: true,
            itemId: result.itemId,
            versionId: result.versionId,
          });
        } catch (error) {
          logger.error(`[ExportAndSave] Erreur upload ${sanitizedName}: ${error.message}`);
          uploadErrors.push({
            filename: sanitizedName,
            error: error.message,
          });
        }
      }
    }

    const response = {
      success: uploadResults.length > 0 && uploadErrors.length === 0,
      exported: extractedPdfs.length,
      processed: filteredPdfs.length,
      uploaded: uploadResults.length,
      failed: uploadErrors.length,
      results: uploadResults,
      errors: uploadErrors.length > 0 ? uploadErrors : undefined,
      filters: {
        includeSheets,
        includeViews2D,
        includeMarkups,
        selectionMode,
        selectedSheetCount: customSheets.length,
        exportMode,
      },
      unmatchedSheets: unmatchedSheets.length > 0 ? unmatchedSheets : undefined,
    };

    logger.info(
      `[ExportAndSave] ✅ Terminé: uploaded=${uploadResults.length}, failed=${uploadErrors.length}, processed=${filteredPdfs.length}`
    );

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
