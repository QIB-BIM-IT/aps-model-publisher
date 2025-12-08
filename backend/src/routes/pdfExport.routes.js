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

// Middleware pour les routes internes (scheduler) - vérifie seulement le token APS
async function authenticateInternalOrToken(req, res, next) {
  // Express normalise les headers en minuscules, mais vérifions les deux cas
  const internalHeader = req.headers['x-internal-request'] || req.headers['X-Internal-Request'];
  const userTokenHeader = req.headers['x-user-token'] || req.headers['X-User-Token'];
  const userIdHeader = req.headers['x-user-id'] || req.headers['X-User-Id'];
  
  // Si c'est une requête interne (avec header spécial), on skip le JWT
  const isInternal = internalHeader === 'true';
  
  logger.info(`[Auth] Headers reçus: x-internal-request=${internalHeader}, x-user-token=${userTokenHeader ? 'présent' : 'absent'}, x-user-id=${userIdHeader || 'absent'}, path=${req.path}`);
  
  if (isInternal && userTokenHeader) {
    // Pour les requêtes internes, on vérifie seulement le token APS
    const userToken = userTokenHeader;
    if (!userToken) {
      logger.error('[Auth] Requête interne mais token APS manquant');
      return res.status(401).json({ success: false, message: 'Token APS manquant pour requête interne' });
    }
    
    // Si un userId est fourni dans le header, on l'utilise
    if (userIdHeader) {
      req.userId = userIdHeader;
      // On définit aussi req.user pour compatibilité
      const { User } = require('../models');
      const user = await User.findByPk(userIdHeader);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          autodeskId: user.autodeskId,
          permissions: user.permissions || ['read'],
        };
      } else {
        logger.warn(`[Auth] User ${userIdHeader} introuvable en DB`);
      }
    }
    
    logger.info(`[Auth] Requête interne acceptée pour userId=${req.userId || 'unknown'}`);
    return next();
  }
  
  // Sinon, on utilise l'authentification JWT normale
  logger.info(`[Auth] Requête normale, authentification JWT requise pour ${req.path}`);
  return authenticateToken(req, res, next);
}

router.use(authenticateInternalOrToken);

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

  // 🆕 FIX: Les PDFs de l'API ACC Export qui commencent par "Feuilles-" ou "Sheets-"
  // sont TOUJOURS des sheets publiées, même s'ils contiennent "vue", "plan", etc.
  // Ces mots font partie du TITRE de la sheet, pas du type de document
  const isAccSheetExport = /^feuilles?[-_]/i.test(original) || /^sheets?[-_]/i.test(original);
  
  if (isAccSheetExport) {
    // C'est une sheet exportée depuis ACC, toujours type 'sheet'
    return 'sheet';
  }

  const isMarkup = /markup|annotation|commentaire/.test(normalized);
  
  // Seulement classifier comme view2d si ce n'est PAS une sheet ACC
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
  let itemUrn = null;

  // 🆕 FIX: Pour les dm.version: URN, on doit d'abord récupérer l'item parent
  // puis résoudre vers la DERNIÈRE version (tip) au lieu d'utiliser la version stockée
  if (lowerUrn.includes('dm.version:')) {
    logger.info(`[URNResolve] Version URN détecté: ${inputUrn.substring(0, 60)}... - résolution vers la dernière version`);
    
    // Récupérer les détails de cette version pour trouver l'item parent
    const versionUrl = `${baseUrl}/projects/${encodeURIComponent(cleanProjectId)}/versions/${encodeURIComponent(inputUrn)}`;
    try {
      const versionResponse = await axios.get(versionUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      // L'item parent est dans relationships.item.data.id
      itemUrn = versionResponse.data?.data?.relationships?.item?.data?.id;
      
      if (itemUrn) {
        logger.info(`[URNResolve] Item parent trouvé: ${itemUrn.substring(0, 60)}...`);
      } else {
        // Fallback: si pas d'item trouvé, utiliser la version directement (ancien comportement)
        logger.warn(`[URNResolve] Item parent non trouvé pour ${inputUrn}, utilisation de la version stockée`);
        versionUrn = inputUrn;
      }
    } catch (error) {
      const status = error?.response?.status;
      logger.warn(`[URNResolve] Impossible de récupérer l'item parent (${status || 'n/a'}), utilisation de la version stockée`);
      versionUrn = inputUrn;
    }
  } else if (lowerUrn.includes('viewing:')) {
    derivativeUrn = inputUrn;
  } else {
    // Pour lineage URN ou fs.file URN, c'est notre item
    itemUrn = inputUrn;
  }

  // Si on a un itemUrn, résoudre vers la dernière version (tip)
  if (itemUrn && !versionUrn) {
    const itemUrl = `${baseUrl}/projects/${encodeURIComponent(cleanProjectId)}/items/${encodeURIComponent(itemUrn)}`;
    let itemResponse;

    try {
      itemResponse = await axios.get(itemUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { include: 'tip' },
      });
    } catch (error) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.errors?.[0]?.detail || error?.message;
      logger.error(`[URNResolve] Item lookup failed (${status || 'n/a'}) pour ${itemUrn}: ${detail}`);
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
    
    // Log si la version a changé par rapport à l'input
    if (lowerUrn.includes('dm.version:') && versionUrn !== inputUrn) {
      logger.info(`[URNResolve] ✅ Version mise à jour: ancienne=${inputUrn.substring(0, 50)}... → nouvelle=${versionUrn.substring(0, 50)}...`);
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
    // 🆕 Retourner aussi l'itemUrn (lineage) pour l'API ACC Export
    itemUrn: itemUrn || inputUrn,
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

    // 🆕 FIX: L'API ACC Export ne supporte que:
    // - urn:adsk.wipprod:fs.file:vf.xxx?version=N (versionedFileUrn)
    // - urn:adsk.wipprod:dm.lineage:xxx (lineageUrn)
    // Elle ne supporte PAS dm.version: ! On doit donc utiliser le lineageUrn (itemUrn)
    
    const isLineageUrn = fileUrn.toLowerCase().includes('dm.lineage:');
    let urnForExport = fileUrn;
    let versionUrn = null;
    let derivativeUrn = null;
    let itemUrn = null;

    if (!isLineageUrn) {
      // Résoudre pour obtenir l'itemUrn (lineage) et la version actuelle
      const resolved = await resolveModelUrns(fileUrn, projectId, userToken);
      versionUrn = resolved.versionUrn;
      derivativeUrn = resolved.derivativeUrn;
      itemUrn = resolved.itemUrn;
      
      // 🆕 IMPORTANT: Utiliser l'itemUrn (lineage) pour l'API ACC Export, pas le versionUrn !
      // L'API ACC Export gère elle-même la résolution vers la dernière version publiée
      urnForExport = itemUrn || fileUrn;
      
      logger.info(
        `[ExportWithCache] URNs résolus: item=${itemUrn?.substring(0, 50)}... | version=${versionUrn?.substring(0, 50)}...`
      );
      logger.info(`[ExportWithCache] URN utilisé pour ACC Export: ${urnForExport.substring(0, 60)}...`);
    } else {
      // Pour les lineageUrn, on les envoie directement
      logger.info(`[ExportWithCache] Utilisation directe du lineageUrn: ${fileUrn}`);
      versionUrn = fileUrn;
      derivativeUrn = fileUrn;
      itemUrn = fileUrn;
    }

    const jobId = await accExportService.exportPDFs(
      [urnForExport],
      projectId,
      userToken,
      { includeMarkups: true },
    );

    logger.info(`[ExportWithCache] Job lancé: ${jobId}`);

    let jobResult;
    try {
      jobResult = await accExportService.waitForJobCompletion(jobId, userToken);
    } catch (error) {
      logger.error(`[ExportWithCache] ❌ Erreur lors de l'attente du job: ${error.message}`);
      logger.error(`[ExportWithCache] Stack: ${error.stack}`);
      throw error;
    }

    const jobStatus = jobResult?.status;
    if (jobStatus && jobStatus !== 'successful' && jobStatus !== 'partialSuccess') {
      logger.error(`[ExportWithCache] ❌ Job terminé avec status invalide: ${jobStatus}`);
      logger.error(`[ExportWithCache] jobResult: ${JSON.stringify(jobResult, null, 2)}`);
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

    const classifiedPdfs = extractedPdfs.map((pdf) => {
      const pdfName = pdf.name || pdf.filename;
      const pdfType = classifyPdf(pdfName);
      return {
        name: pdfName,
        size: pdf.size || pdf.buffer.length,
        type: pdfType,
        buffer: pdf.buffer,
      };
    });

    // 🔍 DEBUG: Logger chaque PDF avec sa classification
    logger.info(`[ExportWithCache] 📋 Classification des PDFs:`);
    classifiedPdfs.forEach((pdf, i) => {
      logger.info(`[ExportWithCache]   ${i + 1}. "${pdf.name}" → type=${pdf.type} (${pdf.size} bytes)`);
    });

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
    
    // 🔍 DEBUG: Résumé de la classification
    logger.info(`[ExportWithCache] 📊 Résumé: ${sheets.length} sheets, ${views2D.length} views2D, ${markups.length} markups sur ${classifiedPdfs.length} total`);

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
      if (resolved.itemUrn !== urn) {
        logger.info(
          `[PDFExport] URN ${urn.substring(0, 60)}... → item=${resolved.itemUrn?.substring(0, 60)}...`
        );
      }
      return resolved;
    })
  );

  // 🆕 FIX: Utiliser itemUrn (lineage) pour l'API ACC Export, pas versionUrn
  const itemUrns = resolvedUrns.map((entry) => entry.itemUrn || entry.inputUrn);
  logger.info(`[PDFExport] ${itemUrns.length} item(s) prêts pour export PDF`);

  // Lancer l'export avec les URNs d'items (lineage) résolus
  const result = await accExportService.exportRevitToPDFs(
    projectId,
    itemUrns,
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
      item: entry.itemUrn,
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

    // Normaliser les noms sélectionnés (supprimer préfixes comme "Feuilles -")
    const selectedNamesNormalized = new Set(
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

    // Filtrer les PDFs en utilisant une comparaison flexible (nom exact ou normalisé)
    const selectedPdfs = cachedPdfs.filter((pdf) => {
      const pdfName = pdf.name || pdf.filename || '';
      
      // Vérifier correspondance exacte
      if (selectedNamesNormalized.has(pdfName)) {
        return true;
      }
      
      // Normaliser le nom du PDF (supprimer préfixes comme "Feuilles -")
      const pdfNameNormalized = stripPdfName(pdfName);
      // Aussi supprimer le préfixe "Feuilles" comme dans le frontend
      const pdfNameCleaned = pdfName.replace(/^Feuilles\s*[-_]?\s*/i, '').trim();
      
      // Vérifier correspondance normalisée
      for (const selectedName of selectedNamesNormalized) {
        const selectedNameTrimmed = selectedName.trim();
        const selectedNameNormalized = stripPdfName(selectedNameTrimmed);
        
        // Correspondance exacte avec nom nettoyé
        if (pdfNameCleaned === selectedNameTrimmed || pdfName === selectedNameTrimmed) {
          return true;
        }
        
        // Correspondance normalisée
        if (pdfNameNormalized === selectedNameNormalized) {
          return true;
        }
        
        // Vérifier si le nom normalisé contient le nom sélectionné (ou vice versa)
        if (pdfNameNormalized.includes(selectedNameNormalized) || selectedNameNormalized.includes(pdfNameNormalized)) {
          return true;
        }
        
        // Correspondance avec nom nettoyé
        if (pdfNameCleaned.includes(selectedNameTrimmed) || selectedNameTrimmed.includes(pdfNameCleaned)) {
          return true;
        }
      }
      
      return false;
    });

    if (selectedPdfs.length === 0) {
      logger.warn(`[ExportFromCache] Aucun PDF trouvé. Noms demandés: ${Array.from(selectedNamesNormalized).join(', ')}`);
      logger.warn(`[ExportFromCache] PDFs disponibles dans le cache: ${cachedPdfs.map((p) => p.name || p.filename).join(', ')}`);
      throw new Error('Aucun PDF trouvé correspondant à la sélection');
    }

    logger.info(`[ExportFromCache] ${selectedPdfs.length} PDF(s) sélectionné(s)`);

    // Trier les PDFs dans l'ordre demandé par selectedSheetNames
    // Créer un Map pour retrouver rapidement l'index d'un nom de sheet
    const sheetNameToIndex = new Map();
    selectedSheetNames.forEach((name, index) => {
      const normalized = stripPdfName(String(name || '').trim());
      sheetNameToIndex.set(normalized, index);
      // Aussi stocker le nom original pour correspondance exacte
      sheetNameToIndex.set(String(name || '').trim(), index);
    });

    // Trier les PDFs selon l'ordre des sheets demandés
    const sortedPdfs = selectedPdfs.sort((a, b) => {
      const nameA = a.name || a.filename || '';
      const nameB = b.name || b.filename || '';
      
      // Nettoyer les noms (supprimer "Feuilles -" etc.)
      const cleanA = nameA.replace(/^Feuilles\s*[-_]?\s*/i, '').trim();
      const cleanB = nameB.replace(/^Feuilles\s*[-_]?\s*/i, '').trim();
      
      // Normaliser les noms
      const normA = stripPdfName(nameA);
      const normB = stripPdfName(nameB);
      
      // Trouver les index dans selectedSheetNames
      const indexA = sheetNameToIndex.get(cleanA) ?? sheetNameToIndex.get(normA) ?? sheetNameToIndex.get(nameA) ?? 999999;
      const indexB = sheetNameToIndex.get(cleanB) ?? sheetNameToIndex.get(normB) ?? sheetNameToIndex.get(nameB) ?? 999999;
      
      return indexA - indexB;
    });

    logger.info(`[ExportFromCache] PDFs triés dans l'ordre demandé`);

    const userToken = await apsAuthService.ensureValidToken(req.userId);

    const uploadResults = [];
    const uploadErrors = [];

    if (exportMode === 'combined') {
      const sanitizedName = pdfUploadService.ensurePdfExtension(
        pdfUploadService.sanitizeFileName(String(combinedFileName || '').trim())
      );

      try {
        logger.info(`[ExportFromCache] Fusion de ${sortedPdfs.length} PDFs...`);
        const mergedBuffer = await pdfUploadService.mergePDFs(
          sortedPdfs.map((pdf) => pdf.buffer),
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
          mergedCount: sortedPdfs.length,
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
      for (const pdf of sortedPdfs) {
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

    // 🆕 Métriques de temps détaillées
    const timing = {
      startTime: Date.now(),
      resolveStart: null,
      resolveEnd: null,
      exportStart: null,
      exportEnd: null,
      downloadStart: null,
      downloadEnd: null,
      processStart: null,
      processEnd: null,
      uploadStart: null,
      uploadEnd: null,
    };

    logger.info(
      `[ExportAndSave] Démarrage export + upload pour: ${fileUrn} (filters: sheets=${includeSheets}, views=${includeViews2D}, markups=${includeMarkups}, mode=${selectionMode}, exportMode=${exportMode})`
    );

    logger.info('[ExportAndSave] 1/2 - Export des PDFs...');

    const clientResolved = req.body?.resolvedUrns || {};
    let exportVersionUrn = clientResolved.version;
    let exportDerivativeUrn = clientResolved.derivative;
    let exportItemUrn = clientResolved.item;

    // 🆕 FIX: L'API ACC Export ne supporte que:
    // - urn:adsk.wipprod:fs.file:vf.xxx?version=N (versionedFileUrn)
    // - urn:adsk.wipprod:dm.lineage:xxx (lineageUrn)
    // Elle ne supporte PAS dm.version: ! On doit donc utiliser le lineageUrn (itemUrn)
    
    const isLineageUrn = fileUrn.toLowerCase().includes('dm.lineage:');
    let urnForExport = fileUrn; // Par défaut, utiliser l'URN d'entrée directement

    if (!isLineageUrn) {
      // Si ce n'est pas un lineageUrn, on doit résoudre pour obtenir l'itemUrn (lineage)
      if (!exportItemUrn) {
        timing.resolveStart = Date.now();
        const resolved = await resolveModelUrns(fileUrn, projectId, userToken);
        timing.resolveEnd = Date.now();
        
        exportVersionUrn = resolved.versionUrn;
        exportDerivativeUrn = resolved.derivativeUrn;
        exportItemUrn = resolved.itemUrn;
        
        // 🆕 IMPORTANT: Utiliser l'itemUrn (lineage) pour l'API ACC Export, pas le versionUrn !
        urnForExport = resolved.itemUrn || fileUrn;
        
        logger.info(
          `[ExportAndSave] URN converti → item=${resolved.itemUrn?.substring(0, 50)}... | version=${resolved.versionUrn?.substring(0, 50)}...`
        );
        logger.info(`[ExportAndSave] URN utilisé pour ACC Export: ${urnForExport.substring(0, 60)}...`);
      } else {
        urnForExport = exportItemUrn;
        logger.info(`[ExportAndSave] ItemUrn fourni par le client utilisé pour l\'export: ${urnForExport.substring(0, 60)}...`);
      }
    } else {
      // Pour les lineageUrn, on les envoie directement à l'API ACC Export
      // L'API gère automatiquement la résolution vers la dernière version publiée
      logger.info(`[ExportAndSave] Utilisation directe du lineageUrn: ${fileUrn}`);
    }

    timing.exportStart = Date.now();
    const jobId = await accExportService.exportPDFs(
      [urnForExport],
      projectId,
      userToken,
      { includeMarkups }
    );

    const jobResult = await accExportService.waitForJobCompletion(jobId, userToken);
    timing.exportEnd = Date.now();

    const jobStatus = jobResult?.status;
    if (jobStatus && jobStatus !== 'successful' && jobStatus !== 'partialSuccess') {
      throw new Error(`Export échoué: ${jobStatus}`);
    }

    const signedUrl = jobResult?.signedUrl || jobResult?.output?.signedUrl;

    if (!signedUrl) {
      logger.error('[ExportAndSave] jobResult structure:', JSON.stringify(jobResult, null, 2));
      throw new Error('Export terminé mais aucune URL de téléchargement trouvée');
    }

    timing.downloadStart = Date.now();
    const zipBuffer = await accExportService.downloadZip(signedUrl);
    timing.downloadEnd = Date.now();
    
    timing.processStart = Date.now();
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

      // Trier les PDFs matched selon l'ordre des customSheets
      const sheetIndexMap = new Map();
      customSheets.forEach((sheet, index) => {
        if (sheet?.name) {
          sheetIndexMap.set(sheet.name, index);
          sheetIndexMap.set(stripPdfName(sheet.name), index);
        }
        if (sheet?.number) {
          sheetIndexMap.set(sanitizeString(sheet.number), index);
        }
      });

      matched.sort((a, b) => {
        const sheetA = a.matchedSheet;
        const sheetB = b.matchedSheet;
        
        const indexA = sheetIndexMap.get(sheetA?.name) ?? sheetIndexMap.get(stripPdfName(sheetA?.name)) ?? 999999;
        const indexB = sheetIndexMap.get(sheetB?.name) ?? sheetIndexMap.get(stripPdfName(sheetB?.name)) ?? 999999;
        
        return indexA - indexB;
      });

      selectedPdfs = matched;
      unmatchedSheets = notMatched;
    } else {
      // Mode "all": trier les PDFs par nom de façon naturelle (numérique + alphabétique)
      selectedPdfs.sort((a, b) => {
        const nameA = a.originalName || '';
        const nameB = b.originalName || '';
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });
      logger.info('[ExportAndSave] PDFs triés par ordre naturel (mode "all")');
    }

    logger.info(
      `[ExportAndSave] PDFs retenus pour upload: ${selectedPdfs.length}/${filteredPdfs.length} (extraits=${extractedPdfs.length})`
    );

    timing.processEnd = Date.now();
    
    logger.info('[ExportAndSave] 2/2 - Upload sur ACC...');
    timing.uploadStart = Date.now();
    const uploadResults = [];
    const uploadErrors = [];

    if (exportMode === 'combined') {
      const targetName = pdfUploadService.ensurePdfExtension(
        pdfUploadService.sanitizeFileName(combinedFileName.trim())
      );

      try {
        logger.info('[ExportAndSave] PDFs triés dans l\'ordre demandé pour la fusion');
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

    timing.uploadEnd = Date.now();
    
    // Calculer le nombre réel de sheets exportées
    // Mode individual: 1 PDF = 1 sheet, donc sheetCount = uploaded
    // Mode combined: additionner les mergedCount de chaque résultat
    const sheetCount = exportMode === 'combined'
      ? uploadResults.reduce((sum, r) => sum + (r.mergedCount || 1), 0)
      : uploadResults.length;

    // 🆕 Calculer les métriques de temps détaillées
    const timingStats = {
      totalMs: timing.uploadEnd - timing.startTime,
      resolveMs: timing.resolveEnd && timing.resolveStart ? timing.resolveEnd - timing.resolveStart : 0,
      exportMs: timing.exportEnd && timing.exportStart ? timing.exportEnd - timing.exportStart : 0,
      downloadMs: timing.downloadEnd && timing.downloadStart ? timing.downloadEnd - timing.downloadStart : 0,
      processMs: timing.processEnd && timing.processStart ? timing.processEnd - timing.processStart : 0,
      uploadMs: timing.uploadEnd && timing.uploadStart ? timing.uploadEnd - timing.uploadStart : 0,
    };
    
    // Calculer la taille totale des PDFs
    const totalSizeBytes = extractedPdfs.reduce((sum, pdf) => sum + (pdf.size || pdf.buffer?.length || 0), 0);

    const response = {
      success: uploadResults.length > 0 && uploadErrors.length === 0,
      exported: extractedPdfs.length,
      processed: filteredPdfs.length,
      uploaded: uploadResults.length,
      failed: uploadErrors.length,
      sheetCount, // Nombre réel de sheets exportées
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
      // 🆕 Métriques de temps et taille
      timing: timingStats,
      size: {
        totalBytes: totalSizeBytes,
        totalMB: Math.round(totalSizeBytes / 1024 / 1024 * 100) / 100,
        avgPerPdfBytes: extractedPdfs.length > 0 ? Math.round(totalSizeBytes / extractedPdfs.length) : 0,
      },
    };

    logger.info(
      `[ExportAndSave] ✅ Terminé: uploaded=${uploadResults.length}, failed=${uploadErrors.length}, processed=${filteredPdfs.length}, totalTime=${timingStats.totalMs}ms`
    );
    logger.info(
      `[ExportAndSave] 📊 Timing: resolve=${timingStats.resolveMs}ms, export=${timingStats.exportMs}ms, download=${timingStats.downloadMs}ms, process=${timingStats.processMs}ms, upload=${timingStats.uploadMs}ms`
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
