// src/routes/publish.direct.routes.js
// Routes de TEST publish "direct" (sans scheduler/DB):
// - POST /api/publish/direct/resolve { projectId, urn, regionHint? } -> { versionUrn, region }
// - POST /api/publish/direct/run { projectId, urn | versionUrn, regionHint? } -> publish immédiat

const express = require('express');
const router = express.Router();

const axios = require('axios');
const logger = require('../config/logger');
const { authenticateToken } = require('../middleware/auth.middleware'); // ✅ CORRIGÉ
const apsAuthService = require('../services/apsAuth.service');
const { apsConfig } = require('../config/aps.config');
const apsPublishService = require('../services/apsPublish.service');

const ENABLE_REAL = String(process.env.ENABLE_REAL_PUBLISH || 'false').toLowerCase() === 'true';
const ITEM_TIMEOUT_MS = parseInt(process.env.PUBLISH_ITEM_TIMEOUT_MS || '120000', 10);
const PUBLISH_COMMAND = String(process.env.PUBLISH_COMMAND || 'PublishModel');

const REGIONS = ['us', 'eu'];

function apiBase() {
  return apsConfig?.apis?.baseUrl || 'https://developer.api.autodesk.com';
}
function dataBase(region) {
  if (region) return `${apiBase()}/data/v2/regions/${region}`;
  return `${apiBase()}/data/v2`;
}

function safeBody(b) { try { return JSON.stringify(b).slice(0, 1000); } catch { return '<unserializable>'; } }
function isLineageUrn(urn) { return /^urn:adsk\.wipprod:dm\.lineage:[A-Za-z0-9\-_]+$/i.test(String(urn)); }
function isVersionUrn(urn) { return /^urn:adsk\.wipprod:fs\.file:vf\.[^?]+\?version=\d+$/i.test(String(urn)); }
function cleanId(id) { return (typeof id === 'string' && id.startsWith('b.')) ? id.substring(2) : id; }

async function tryWithAndWithoutPrefix(axiosConfig, originalId) {
  let resp = await axios(axiosConfig);
  if (resp.status === 404 && typeof originalId === 'string' && originalId.startsWith('b.')) {
    const cleaned = cleanId(originalId);
    const newUrl = axiosConfig.url.replace(encodeURIComponent(originalId), encodeURIComponent(cleaned));
    resp = await axios({ ...axiosConfig, url: newUrl });
  }
  return resp;
}

async function detectProjectRegion(projectId, accessToken) {
  for (const region of REGIONS) {
    const url = `${dataBase(region)}/projects/${encodeURIComponent(projectId)}`;
    const resp = await tryWithAndWithoutPrefix({
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 5000,
      validateStatus: () => true,
    }, projectId);
    if (resp.status === 200) return region;
  }
  return null;
}

async function verifyItemExists(region, projectId, itemUrn, accessToken) {
  const url = `${dataBase(region)}/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemUrn)}`;
  const resp = await tryWithAndWithoutPrefix({
    method: 'HEAD',
    url,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 5000,
    validateStatus: () => true,
  }, projectId);
  return resp.status === 200;
}

async function findItemRegion(projectId, itemUrn, accessToken, regionHint = null) {
  const order = regionHint ? [regionHint, ...REGIONS.filter(r => r !== regionHint)] : REGIONS.slice();
  for (const r of order) {
    if (await verifyItemExists(r, projectId, itemUrn, accessToken)) return r;
  }
  return null;
}

async function getTipVersionFromItems(region, projectId, itemUrn, accessToken) {
  const url = `${dataBase(region)}/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemUrn)}`;
  const resp = await tryWithAndWithoutPrefix({
    method: 'GET',
    url,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: ITEM_TIMEOUT_MS,
    validateStatus: () => true,
  }, projectId);
  if (resp.status !== 200) throw new Error(`items GET ${region} ${resp.status}: ${safeBody(resp.data)}`);

  const tip = resp?.data?.data?.relationships?.tip?.data;
  if (tip?.id) return tip.id;

  const included = Array.isArray(resp?.data?.included) ? resp.data.included : [];
  const ver = included.find(x => x?.type === 'versions' && x?.id);
  if (ver?.id) return ver.id;

  throw new Error('Tip version introuvable');
}

async function getLatestVersionFromVersions(region, projectId, itemUrn, accessToken) {
  const url = `${dataBase(region)}/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemUrn)}/versions`;
  const resp = await tryWithAndWithoutPrefix({
    method: 'GET',
    url,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: ITEM_TIMEOUT_MS,
    validateStatus: () => true,
  }, projectId);
  if (resp.status !== 200) throw new Error(`versions GET ${region} ${resp.status}: ${safeBody(resp.data)}`);

  const arr = Array.isArray(resp?.data?.data) ? resp.data.data : [];
  if (!arr.length) throw new Error('Aucune version');

  return arr[0].id; // souvent la plus récente d'abord
}

// ------------------- ROUTES -------------------

// Résolution SANS publier (debug ciblé)
router.post('/direct/resolve', authenticateToken, async (req, res) => { // ✅ CORRIGÉ
  try {
    const { projectId, urn, regionHint } = req.body || {};
    if (!projectId || !urn) return res.status(400).json({ success: false, message: 'projectId et urn requis' });

    const accessToken = await apsAuthService.ensureValidToken(req.user.id);

    // Si déjà version -> on renvoie direct
    if (isVersionUrn(urn)) {
      const region = regionHint || (await detectProjectRegion(projectId, accessToken));
      return res.json({ success: true, projectId, input: urn, versionUrn: urn, region });
    }

    if (!isLineageUrn(urn)) {
      return res.status(400).json({ success: false, message: 'URN inattendu (ni lineage ni version).' });
    }

    const prjRegion = regionHint || (await detectProjectRegion(projectId, accessToken));
    const itemRegion = await findItemRegion(projectId, urn, accessToken, prjRegion);
    if (!itemRegion) return res.status(404).json({ success: false, message: 'Item introuvable (US/EU)' });

    let versionUrn;
    try {
      versionUrn = await getTipVersionFromItems(itemRegion, projectId, urn, accessToken);
    } catch {
      versionUrn = await getLatestVersionFromVersions(itemRegion, projectId, urn, accessToken);
    }

    return res.json({ success: true, projectId, input: urn, versionUrn, region: itemRegion });
  } catch (e) {
    logger.error(`[PublishDirect][resolve] ${e.message}`);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// Publish IMMÉDIAT (sans job)
router.post('/direct/run', authenticateToken, async (req, res) => { // ✅ CORRIGÉ
  try {
    const { projectId, urn, regionHint } = req.body || {};
    if (!projectId || !urn) return res.status(400).json({ success: false, message: 'projectId et urn requis' });
    if (!ENABLE_REAL) return res.status(400).json({ success: false, message: 'ENABLE_REAL_PUBLISH=false' });

    // On délègue la logique au service existant (qui gère résolution + régions + logs).
    const { results, durationMs } = await apsPublishService.executeRun({
      id: 'direct',
      userId: req.user.id,
      projectId,
      items: [urn]
    });

    return res.json({
      success: true,
      mode: 'REAL',
      command: PUBLISH_COMMAND,
      projectId,
      durationMs,
      results
    });
  } catch (e) {
    logger.error(`[PublishDirect][run] ${e.message}`);
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
