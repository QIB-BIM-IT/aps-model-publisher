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

const PDF_CACHE_TTL_MS = 60 * 60 * 1000; // 1 heure

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

function ensureProjectId(projectId = '') {
  if (!projectId) {
    return projectId;
  }
  return projectId.startsWith('b.') ? projectId : `b.${projectId}`;
}

function sanitizeDerivativeUrn(urn = '') {
  if (typeof urn !== 'string') {
    return urn;
  }

  const trimmed = urn.trim();
  if (!trimmed) {
    return trimmed;
  }

  return trimmed.replace(/\/output\/.*$/i, '');
}

async function resolveModelUrns(fileUrn, projectId, accessToken) {
  if (!fileUrn) {
    throw new ValidationError('fileUrn requis');
  }
  if (!projectId) {
    throw new ValidationError('projectId requis');
  }
  if (!accessToken) {
    throw new ValidationError('Token APS requis pour la résolution des URNs');
  }

  const inputUrn = String(fileUrn);
  const lowerUrn = inputUrn.toLowerCase();
  const cleanProjectId = ensureProjectId(projectId);
  const baseUrl = 'https://developer.api.autodesk.com/data/v1';

  let versionUrn = null;
  let derivativeUrn = null;

  if (lowerUrn.includes('dm.version:')) {
    versionUrn = inputUrn;
  } else if (lowerUrn.includes('viewing:')) {
    derivativeUrn = inputUrn;
  }

  if (!versionUrn) {
    const itemUrl = `${baseUrl}/projects/${encodeURIComponent(cleanProjectId)}/items/${encodeURIComponent(inputUrn)}`;
    let itemResponse;

    try {
      itemResponse = await axios.get(itemUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { include: 'tip' },
      });
    } catch (error) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.errors?.[0]?.detail || error?.message;
      logger.error(`[URNResolve] Item lookup failed (${status || 'n/a'}) pour ${inputUrn}: ${detail}`);
      throw new Error(`Impossible de récupérer l'item ACC (${status || 'erreur'})`);
    }

    versionUrn = itemResponse.data?.data?.relationships?.tip?.data?.id;

    if (!versionUrn && Array.isArray(itemResponse.data?.included)) {
      const versionIncluded = itemResponse.data.included.find((inc) => inc?.type === 'versions' && inc?.id);
      versionUrn = versionIncluded?.id || versionIncluded?.attributes?.urn || null;
    }

    if (!versionUrn) {
      throw new Error("Impossible de déterminer l'URN de version (tip introuvable)");
    }
  }

  if (!derivativeUrn) {
    const versionUrl = `${baseUrl}/projects/${encodeURIComponent(cleanProjectId)}/versions/${encodeURIComponent(versionUrn)}`;
    let versionResponse;

    try {
      versionResponse = await axios.get(versionUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { include: 'derivatives' },
      });
    } catch (error) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.errors?.[0]?.detail || error?.message;
      logger.error(`[URNResolve] Version lookup failed (${status || 'n/a'}) pour ${versionUrn}: ${detail}`);
      throw new Error(`Impossible de récupérer la version ACC (${status || 'erreur'})`);
    }

    derivativeUrn = versionResponse.data?.data?.relationships?.derivatives?.data?.[0]?.id;

    if (!derivativeUrn && Array.isArray(versionResponse.data?.included)) {
      const derivativeIncluded = versionResponse.data.included.find(
        (inc) => inc?.type === 'derivatives' && (inc?.id || inc?.attributes?.urn)
      );
      derivativeUrn = derivativeIncluded?.id || derivativeIncluded?.attributes?.urn || null;
    }

    if (!derivativeUrn && Array.isArray(versionResponse.data?.data?.relationships?.derivatives?.data)) {
      const derivativeEntry = versionResponse.data.data.relationships.derivatives.data.find((entry) => entry?.meta?.urn);
      derivativeUrn = derivativeEntry?.meta?.urn || null;
    }

    if (!derivativeUrn) {
      logger.warn(`[URNResolve] Aucun dérivé direct pour ${versionUrn}, tentative via manifest`);
      const encodedVersionUrn = Buffer.from(versionUrn)
        .toString('base64')
        .replace(/=+$/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      try {
        const manifestUrl = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${encodedVersionUrn}/manifest`;
        const manifestResponse = await axios.get(manifestUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { forceget: true },
        });

        const queue = Array.isArray(manifestResponse.data?.derivatives)
          ? [...manifestResponse.data.derivatives]
          : [];

        while (!derivativeUrn && queue.length) {
          const current = queue.shift();
          if (!current || typeof current !== 'object') {
            continue;
          }

          if (typeof current.urn === 'string' && current.urn.startsWith('urn:')) {
            derivativeUrn = current.urn;
            break;
          }

          if (Array.isArray(current.children)) {
            queue.push(...current.children);
          }
        }

        if (!derivativeUrn) {
          logger.warn(`[URNResolve] Manifest analysé mais aucun URN dérivé trouvé pour ${versionUrn}`);
        }
      } catch (manifestError) {
        const status = manifestError?.response?.status;
        logger.warn(
          `[URNResolve] Impossible de récupérer le manifest pour ${versionUrn} (${status || 'n/a'}): ${manifestError.message}`
        );
      }
    }

    if (!derivativeUrn) {
      logger.warn(`[URNResolve] Fallback vers l'URN de version pour ${versionUrn}`);
      derivativeUrn = versionUrn;
    }
  }

  const sanitizedDerivativeUrn = sanitizeDerivativeUrn(derivativeUrn);
  if (sanitizedDerivativeUrn !== derivativeUrn) {
    logger.warn(
      `[URNResolve] URN dérivé nettoyé: ${derivativeUrn.substring(0, 80)}... → ${sanitizedDerivativeUrn.substring(0, 80)}...`
    );
  }

  return {
    inputUrn,
    projectId: cleanProjectId,
    versionUrn,
    derivativeUrn: sanitizedDerivativeUrn,
  };
}

/**
 * POST /api/pdf-export/export-with-cache
 * Lance un export complet, classe les PDFs et met le résultat en cache
 */
router.post('/export-with-cache', asyncHandler(async (req, res) => {
  const { fileUrn, projectId } = req.body;

  if (!fileUrn || !projectId) {
    throw new ValidationError('fileUrn et projectId requis');
  }

  logger.info(`[ExportWithCache] Démarrage pour: ${fileUrn}`);

  try {
    const userToken = await apsAuthService.ensureValidToken(req.userId);

    const { versionUrn, derivativeUrn } = await resolveModelUrns(
      fileUrn,
      projectId,
      userToken,
    );

    logger.info(
      `[ExportWithCache] URNs résolus: version=${versionUrn.substring(0, 60)}...`
    );

    const jobId = await accExportService.exportPDFs(
      [versionUrn],
      projectId,
      userToken,
      { includeMarkups: true },
    );

    logger.info(`[ExportWithCache] Job lancé: ${jobId}`);

    const jobResult = await accExportService.waitForJobCompletion(jobId, userToken);

    const jobStatus = jobResult?.status;
    if (jobStatus && jobStatus !== 'successful' && jobStatus !== 'partialSuccess') {
      throw new Error(`Export échoué: ${jobStatus}`);
    }

    const signedUrl = jobResult?.signedUrl || jobResult?.output?.signedUrl;

    if (!signedUrl) {
      logger.error('[ExportWithCache] jobResult structure:', JSON.stringify(jobResult, null, 2));
      throw new Error('Export terminé mais aucune URL de téléchargement');
    }

    logger.info('[ExportWithCache] ✅ Export terminé, téléchargement du ZIP...');

    const zipBuffer = await accExportService.downloadZip(signedUrl);
    logger.info(`[ExportWithCache] ZIP téléchargé: ${zipBuffer.length} bytes`);

    const extractedPdfs = await accExportService.extractPDFsFromZip(zipBuffer);
    logger.info(`[ExportWithCache] ${extractedPdfs.length} PDF(s) trouvés dans le ZIP`);

    const classifiedPdfs = extractedPdfs.map((pdf) => ({
      name: pdf.name || pdf.filename,
      size: pdf.size || pdf.buffer.length,
      type: classifyPdf(pdf.name || pdf.filename),
      buffer: pdf.buffer,
    }));

    const cacheKey = `export_${jobId}_${Date.now()}`;
    const pdfCache = global.pdfCache || {};
    pdfCache[cacheKey] = {
      pdfs: classifiedPdfs,
      timestamp: Date.now(),
      fileUrn,
      projectId,
      versionUrn,
      derivativeUrn,
      jobId,
    };
    global.pdfCache = pdfCache;

    logger.info(`[ExportWithCache] ✅ Mis en cache: ${cacheKey}`);

    const sheets = classifiedPdfs.filter((p) => p.type === 'sheet');
    const views2D = classifiedPdfs.filter((p) => p.type === 'view2d');
    const markups = classifiedPdfs.filter((p) => p.type === 'markup');
    const totalSize = classifiedPdfs.reduce((sum, p) => sum + (p.size || 0), 0);

    res.json({
      success: true,
      cacheKey,
      stats: {
        total: classifiedPdfs.length,
        sheets: sheets.length,
        views2D: views2D.length,
        markups: markups.length,
        totalSize,
      },
      sheets: sheets.map(({ name, size, type }) => ({ name, size, type })),
      views2D: views2D.map(({ name, size, type }) => ({ name, size, type })),
      markups: markups.map(({ name, size, type }) => ({ name, size, type })),
      resolvedUrns: {
        input: fileUrn,
        version: versionUrn,
        derivative: derivativeUrn,
      },
    });
  } catch (error) {
    logger.error(`[ExportWithCache] ❌ Erreur: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Export with cache failed',
      message: error.message,
    });
  }
}));

/**
 * GET /api/pdf-export/download/:jobId/:fileName
 * Télécharge un PDF depuis le cache
 */
router.get('/download/:jobId/:fileName', asyncHandler(async (req, res) => {
  const { jobId, fileName } = req.params;

  logger.debug(`[PDFExport] Download demandé: jobId=${jobId}, fileName=${fileName}`);

  // Récupérer du cache
  const pdfCache = global.pdfCache || {};
  const cacheEntry = pdfCache[jobId];
  const pdfs = Array.isArray(cacheEntry) ? cacheEntry : cacheEntry?.pdfs;

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

  const userToken = await apsAuthService.ensureValidToken(req.userId);

  const resolvedUrns = await Promise.all(
    fileUrns.map(async (urn) => {
      const resolved = await resolveModelUrns(urn, projectId, userToken);
      if (resolved.versionUrn !== urn) {
        logger.info(
          `[PDFExport] URN ${urn.substring(0, 60)}... → version=${resolved.versionUrn.substring(0, 60)}...`
        );
      }
      return resolved;
    })
  );

  const versionUrns = resolvedUrns.map((entry) => entry.versionUrn);
  logger.info(`[PDFExport] ${versionUrns.length} version(s) prêtes pour export PDF`);

  // Lancer l'export avec les URNs de version résolus
  const result = await accExportService.exportRevitToPDFs(
    projectId,
    versionUrns,
    {
      userId: req.userId,
      uploadToACC,
      accFolderId,
    }
  );

  res.json({
    success: true,
    data: result,
    resolvedUrns: resolvedUrns.map((entry) => ({
      input: entry.inputUrn,
      version: entry.versionUrn,
      derivative: entry.derivativeUrn,
    })),
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

  let accessToken = await apsAuthService.ensureValidToken(req.userId);
  let using2Legged = false;

  // Inspecter les scopes du token utilisateur pour diagnostiquer les problèmes de droits
  try {
    const tokenParts = String(accessToken || '').split('.');
    if (tokenParts.length === 3) {
      let payloadSegment = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payloadSegment.length % 4 !== 0) {
        payloadSegment += '=';
      }
      const payload = JSON.parse(Buffer.from(payloadSegment, 'base64').toString('utf8'));
      const scopes = Array.isArray(payload.scope)
        ? payload.scope
        : String(payload.scope || '')
            .split(' ')
            .map((scope) => scope.trim())
            .filter(Boolean);

      logger.debug(`[ListSheets] Token scopes: ${JSON.stringify(scopes.length ? scopes : 'NO_SCOPE')}`);

      if (!scopes.includes('viewables:read')) {
        logger.error(`[ListSheets] ⚠️ SCOPE MANQUANT: viewables:read n'est pas dans le token!`);
        return res.status(403).json({
          success: false,
          error: 'Missing scope',
          message: 'Le scope viewables:read est requis pour lister les sheets. Reconnecte-toi.',
        });
      }
    }
  } catch (e) {
    logger.warn(`[ListSheets] Impossible de décoder le token: ${e.message}`);
  }

  logger.info(`[ListSheets] Récupération sheets pour: ${fileUrn}`);

  const fetchSheetsWithToken = async (token) => {
    const { derivativeUrn, versionUrn } = await resolveModelUrns(fileUrn, projectId, token);

    if (derivativeUrn !== fileUrn) {
      logger.info(
        `[ListSheets] URN résolu → version=${versionUrn || 'inconnue'} | derivative=${derivativeUrn.substring(0, 60)}...`
      );
    }

    if (!versionUrn) {
      throw new Error('Impossible de résoudre un URN de version pour le modèle');
    }

    const urnBase64 = Buffer.from(versionUrn)
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const metadataUrl = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urnBase64}/metadata`;

    logger.info(`[ListSheets] Appel metadata avec l'URN de version nettoyé: ${versionUrn}`);

    const metadataResponse = await axios.get(metadataUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const guid = metadataResponse.data?.data?.metadata?.[0]?.guid;
    if (!guid) {
      throw new Error('Impossible de récupérer le GUID du modèle');
    }

    const propsUrl = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urnBase64}/metadata/${guid}/properties`;
    logger.debug(`[ListSheets] Récupération properties (guid=${guid})`);

    const propsResponse = await axios.get(propsUrl, {
      headers: { Authorization: `Bearer ${token}` },
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

    return {
      versionUrn,
      derivativeUrn,
      sheets: sheets.sort((a, b) => {
        if (a.number && b.number) {
          return a.number.localeCompare(b.number, undefined, { numeric: true });
        }
        return a.name.localeCompare(b.name);
      }),
      views2D: views2D.sort((a, b) => a.name.localeCompare(b.name)),
    };
  };

  let result;
  let finalError = null;

  try {
    result = await fetchSheetsWithToken(accessToken);
  } catch (error) {
    if (error.response?.status === 401) {
      logger.warn('[ListSheets] 401 avec token utilisateur → tentative avec token 2-legged');
      try {
        // Token applicatif (2-legged) qui ne dépend pas des permissions utilisateur
        const appToken = await apsAuthService.getTwoLeggedToken(['viewables:read', 'data:read']);
        accessToken = appToken.access_token;
        using2Legged = true;
        result = await fetchSheetsWithToken(accessToken);
      } catch (fallbackError) {
        finalError = fallbackError;
      }
    } else {
      finalError = error;
    }
  }

  if (!finalError && result) {
    return res.json({
      success: true,
      requestedUrn: fileUrn,
      usedAppToken: using2Legged,
      ...result,
    });
  }

  const status = finalError?.response?.status;
  const details = finalError?.response?.data;
  const detailMessage = typeof details === 'string'
    ? details
    : details?.message || details?.error || '';

  const logParts = [`[ListSheets] Erreur`];
  if (status) logParts.push(`status=${status}`);
  logParts.push(`message=${finalError?.message}`);
  if (detailMessage) logParts.push(`details=${detailMessage}`);

  logger.error(logParts.join(' | '));

  if (status === 401) {
    const message = using2Legged
      ? "Le token application APS n'a pas accès au fichier (401). Vérifie les scopes côté app."
      : 'Authentification Autodesk expirée. Merci de te reconnecter.';
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message,
    });
  }

  res.status(status === 404 ? 404 : 500).json({
    success: false,
    error: 'Failed to list sheets',
    message: detailMessage || finalError?.message,
  });
}));

/**
 * POST /api/pdf-export/export-from-cache
 * Utilise les PDFs déjà mis en cache pour les uploader sur ACC
 */
router.post('/export-from-cache', asyncHandler(async (req, res) => {
  const {
    cacheKey,
    projectId,
    folderId,
    selectedSheetNames = [],
    exportMode = 'individual',
    combinedFileName,
  } = req.body;

  if (!cacheKey || !projectId || !folderId) {
    throw new ValidationError('cacheKey, projectId et folderId requis');
  }

  if (!Array.isArray(selectedSheetNames) || selectedSheetNames.length === 0) {
    throw new ValidationError('Aucune sheet sélectionnée');
  }

  if (exportMode === 'combined' && !combinedFileName) {
    throw new ValidationError('combinedFileName requis pour le mode combiné');
  }

  logger.info(`[ExportFromCache] Démarrage: cacheKey=${cacheKey}, mode=${exportMode}`);

  try {
    const pdfCache = global.pdfCache || {};
    const cachedEntry = pdfCache[cacheKey];
    const cachedPdfs = Array.isArray(cachedEntry) ? cachedEntry : cachedEntry?.pdfs;
    const cacheTimestamp = Array.isArray(cachedEntry) ? null : cachedEntry?.timestamp;

    if (!cachedPdfs || cachedPdfs.length === 0) {
      throw new Error('Cache expiré ou introuvable. Recharge les sheets.');
    }

    if (cacheTimestamp) {
      const cacheAge = Date.now() - cacheTimestamp;
      if (cacheAge > PDF_CACHE_TTL_MS) {
        delete pdfCache[cacheKey];
        global.pdfCache = pdfCache;
        throw new Error('Cache expiré (> 1h). Recharge les sheets.');
      }
      logger.info(
        `[ExportFromCache] Cache trouvé: ${cachedPdfs.length} PDFs, age=${Math.round(cacheAge / 1000)}s`
      );
    } else {
      logger.info(`[ExportFromCache] Cache trouvé: ${cachedPdfs.length} PDFs (ancien format)`);
    }

    const selectedNames = new Set(
      selectedSheetNames
        .map((name) => {
          if (typeof name === 'string') {
            return name.trim();
          }
          if (name && typeof name === 'object') {
            return String(name.name || '').trim();
          }
          return '';
        })
        .filter((value) => value.length > 0)
    );
    const selectedPdfs = cachedPdfs.filter((pdf) => selectedNames.has(pdf.name));

    if (selectedPdfs.length === 0) {
      throw new Error('Aucun PDF trouvé correspondant à la sélection');
    }

    logger.info(`[ExportFromCache] ${selectedPdfs.length} PDF(s) sélectionné(s)`);

    const userToken = await apsAuthService.ensureValidToken(req.userId);

    const uploadResults = [];
    const uploadErrors = [];

    if (exportMode === 'combined') {
      const sanitizedName = pdfUploadService.ensurePdfExtension(
        pdfUploadService.sanitizeFileName(String(combinedFileName || '').trim())
      );

      try {
        logger.info(`[ExportFromCache] Fusion de ${selectedPdfs.length} PDFs...`);
        const mergedBuffer = await pdfUploadService.mergePDFs(
          selectedPdfs.map((pdf) => pdf.buffer),
          sanitizedName
        );

        logger.info(`[ExportFromCache] Upload du PDF fusionné: ${sanitizedName}`);
        const result = await pdfUploadService.uploadPDFToACC(
          { buffer: mergedBuffer, filename: sanitizedName },
          projectId,
          folderId,
          userToken
        );

        uploadResults.push({
          filename: sanitizedName,
          success: true,
          itemId: result.itemId,
          versionId: result.versionId,
          mergedCount: selectedPdfs.length,
        });

        logger.info('[ExportFromCache] ✅ PDF fusionné uploadé');
      } catch (error) {
        logger.error(`[ExportFromCache] Erreur fusion/upload: ${error.message}`);
        uploadErrors.push({
          filename: sanitizedName,
          error: error.message,
        });
      }
    } else {
      for (const pdf of selectedPdfs) {
        const sanitizedName = pdfUploadService.ensurePdfExtension(
          pdfUploadService.sanitizeFileName((pdf.name || '').trim())
        );

        try {
          logger.info(`[ExportFromCache] Upload: ${sanitizedName}`);
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

          logger.info(`[ExportFromCache] ✅ ${sanitizedName} uploadé`);
        } catch (error) {
          logger.error(`[ExportFromCache] Erreur upload ${sanitizedName}: ${error.message}`);
          uploadErrors.push({
            filename: sanitizedName,
            error: error.message,
          });
        }
      }
    }

    const responsePayload = {
      success: uploadResults.length > 0 && uploadErrors.length === 0,
      uploaded: uploadResults.length,
      failed: uploadErrors.length,
      results: uploadResults,
      errors: uploadErrors.length > 0 ? uploadErrors : undefined,
      cacheUsed: true,
      exportMode,
    };

    logger.info(
      `[ExportFromCache] ✅ Terminé: uploaded=${uploadResults.length}, failed=${uploadErrors.length}`
    );

    res.json(responsePayload);
  } catch (error) {
    logger.error(`[ExportFromCache] ❌ Erreur: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Export from cache failed',
      message: error.message,
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
  const cacheEntry = pdfCache[jobId];
  const pdfs = Array.isArray(cacheEntry) ? cacheEntry : cacheEntry?.pdfs;

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
      resolvedUrns: {
        input: fileUrn,
        version: exportVersionUrn,
        derivative: exportDerivativeUrn,
      },
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

    const clientResolved = req.body?.resolvedUrns || {};
    let exportVersionUrn = clientResolved.version;
    let exportDerivativeUrn = clientResolved.derivative;

    if (!exportVersionUrn || !exportDerivativeUrn) {
      const resolved = await resolveModelUrns(fileUrn, projectId, userToken);
      exportVersionUrn = resolved.versionUrn;
      exportDerivativeUrn = resolved.derivativeUrn;
      if (resolved.versionUrn !== fileUrn) {
        logger.info(
          `[ExportAndSave] URN converti → version=${resolved.versionUrn.substring(0, 60)}... | derivative=${resolved.derivativeUrn.substring(0, 60)}...`
        );
      }
    } else {
      logger.info('[ExportAndSave] URNs résolus fournis par le client utilisés pour l\'export');
    }

    const jobId = await accExportService.exportPDFs(
      [exportVersionUrn],
      projectId,
      userToken,
      { includeMarkups }
    );

    const jobResult = await accExportService.waitForJobCompletion(jobId, userToken);

    const jobStatus = jobResult?.status;
    if (jobStatus && jobStatus !== 'successful' && jobStatus !== 'partialSuccess') {
      throw new Error(`Export échoué: ${jobStatus}`);
    }

    const signedUrl = jobResult?.signedUrl || jobResult?.output?.signedUrl;

    if (!signedUrl) {
      logger.error('[ExportAndSave] jobResult structure:', JSON.stringify(jobResult, null, 2));
      throw new Error('Export terminé mais aucune URL de téléchargement trouvée');
    }

    const zipBuffer = await accExportService.downloadZip(signedUrl);
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
        const pdfNameCleaned = stripPdfName(pdf.originalName);

        const match = customSheets.find((sheet) => {
          if (!sheet) {
            return false;
          }

          const sheetName = sheet.name || '';
          const sheetNameStripped = stripPdfName(sheetName);

          if (pdf.originalName === sheetName) {
            return true;
          }

          if (pdfNameCleaned === sheetNameStripped) {
            return true;
          }

          if (sheet.number) {
            const numberCleaned = sanitizeString(sheet.number);
            if (numberCleaned && pdfNameCleaned.includes(numberCleaned)) {
              return true;
            }
          }

          return false;
        });

        if (match) {
          matched.push({ ...pdf, matchedSheet: match });
        }
      });

      if (matched.length === 0) {
        logger.warn(`[ExportAndSave] ⚠️ Aucun PDF n'a correspondu aux sheets sélectionnés`);
        logger.warn(`[ExportAndSave] PDFs disponibles:`, filteredPdfs.map((p) => p.originalName));
        logger.warn(`[ExportAndSave] Sheets demandés:`, customSheets.map((s) => s?.name));

        return res.status(400).json({
          error: 'No matching PDFs',
          message: `Aucun PDF trouvé correspondant aux sheets sélectionnés. PDFs: ${filteredPdfs
            .map((p) => p.originalName)
            .join(', ')}`,
          availablePdfs: filteredPdfs.map((p) => p.originalName),
          requestedSheets: customSheets.map((s) => s?.name),
        });
      }

      const matchedIds = new Set(
        matched
          .map((pdf) => pdf.matchedSheet?.id)
          .filter((id) => typeof id === 'string' || typeof id === 'number')
      );

      customSheets.forEach((sheet) => {
        if (sheet?.id) {
          if (!matchedIds.has(sheet.id)) {
            notMatched.push(sheet);
          }
        } else if (!matched.some((pdf) => pdf.matchedSheet === sheet)) {
          notMatched.push(sheet);
        }
      });

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
      resolvedUrns: {
        input: fileUrn,
        version: exportVersionUrn,
        derivative: exportDerivativeUrn,
        providedByClient: Boolean(clientResolved.version && clientResolved.derivative),
      },
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
  const now = Date.now();
  let removed = 0;

  for (const key of Object.keys(pdfCache)) {
    const entry = pdfCache[key];
    const timestamp = entry?.timestamp;

    if (timestamp && now - timestamp > PDF_CACHE_TTL_MS) {
      delete pdfCache[key];
      removed += 1;
    }
  }

  global.pdfCache = pdfCache;
  logger.debug(
    `[PDFExport] Cache cleanup: ${Object.keys(pdfCache).length} jobs en cache (removed=${removed})`
  );
}, PDF_CACHE_TTL_MS); // Toutes les heures

module.exports = router;
