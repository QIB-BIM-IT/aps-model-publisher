// src/routes/publish.routes.js
// CRUD des jobs + endpoints d'historique, avec :
// - validation d'entrée (cron, timezone, urns)
// - petit rate limit en mémoire pour /jobs (create) et /jobs/:id/run

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const cron = require('node-cron');
const { authenticateToken } = require('../middleware/auth.middleware');
const { PublishJob, PublishRun, User } = require('../models');
const scheduler = require('../services/scheduler.service');

// ------------- helpers -------------
const ENABLE_REAL = String(process.env.ENABLE_REAL_PUBLISH || 'false').toLowerCase() === 'true';

// Très simple validation d’URN lineage
const URN_RE = /^urn:adsk\.wipprod:dm\.lineage:[A-Za-z0-9\-_]+$/i;
function validUrn(u) { return URN_RE.test(String(u || '')); }

// Timezone check : si Node supporte Intl.supportedValuesOf, on vérifie, sinon fallback simple.
let KNOWN_TZ = null;
try {
  if (typeof Intl.supportedValuesOf === 'function') {
    KNOWN_TZ = new Set(Intl.supportedValuesOf('timeZone') || []);
  }
} catch (_) {}
function validTz(tz) {
  if (!tz) return false;
  if (KNOWN_TZ) return KNOWN_TZ.has(tz);
  // Fallback permissif (ex: "America/Toronto")
  return /^[A-Za-z]+\/[A-Za-z_\-]+$/.test(tz);
}

function normalizeJobInput(body) {
  const out = {};
  out.hubId = String(body.hubId || '').trim();
  out.projectId = String(body.projectId || '').trim();

  // items (URN lineage)
  const items = Array.isArray(body.items) ? body.items : [];
  out.models = items.filter(Boolean).map(String);

  out.scheduleEnabled = body.scheduleEnabled !== false;
  out.cronExpression = String(body.cronExpression || '0 2 * * *').trim();
  out.timezone = String(body.timezone || 'UTC').trim();

  out.outputFormat = body.outputFormat || 'default';
  out.publishViews = !!body.publishViews;
  out.publishSheets = !!body.publishSheets;
  out.includeLinkedModels = !!body.includeLinkedModels;
  out.publishOptions = body.publishOptions || {};

  out.notificationsEnabled = !!body.notificationsEnabled;
  out.notifyOnSuccess = !!body.notifyOnSuccess;
  out.notifyOnFailure = body.notifyOnFailure !== false;
  out.notificationRecipients = Array.isArray(body.notificationRecipients)
    ? body.notificationRecipients : [];

  return out;
}

function validateJobPayload(p) {
  if (!p.hubId) return 'hubId requis';
  if (!p.projectId) return 'projectId requis';
  if (!Array.isArray(p.models) || p.models.length === 0) return 'items (models) requis';
  if (!cron.validate(p.cronExpression)) return 'cronExpression invalide';
  if (!validTz(p.timezone)) return 'timezone invalide';
  const bad = p.models.find(u => !validUrn(u));
  if (bad) return `URN invalide: ${bad}`;
  return null;
}

// ----- rate limiting léger (en mémoire) -----
const RATE_BUCKETS = new Map(); // key -> {count, reset}
const RATE_WINDOW_MS = 15_000;
const RATE_LIMIT = 10;

function keyFromReq(req) {
  // par user si dispo, sinon IP
  return req.userId || req.ip || 'unknown';
}
function rateLimit(req, res, next) {
  const key = keyFromReq(req);
  const now = Date.now();
  let b = RATE_BUCKETS.get(key);
  if (!b || b.reset < now) {
    b = { count: 0, reset: now + RATE_WINDOW_MS };
    RATE_BUCKETS.set(key, b);
  }
  b.count++;
  if (b.count > RATE_LIMIT) {
    const wait = Math.max(0, b.reset - now);
    return res.status(429).json({ success: false, message: `Trop de requêtes, réessaie dans ${Math.ceil(wait/1000)}s` });
  }
  next();
}

// Toutes les routes nécessitent un JWT app
router.use(authenticateToken);

// ---------- JOBS ----------
router.post('/jobs', rateLimit, async (req, res) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) return res.status(401).json({ success: false, message: 'Utilisateur introuvable' });

    const payload = normalizeJobInput(req.body);
    const err = validateJobPayload(payload);
    if (err) return res.status(400).json({ success: false, message: err });

    // Idempotence simple: existe-t-il un job identique ? (même user/hub/project/models/cron/tz)
    const existing = await PublishJob.findAll({
      where: {
        userId: user.id,
        hubId: payload.hubId,
        projectId: payload.projectId,
        cronExpression: payload.cronExpression,
        timezone: payload.timezone,
      },
    });
    if (existing.some(j => JSON.stringify(j.models || []) === JSON.stringify(payload.models || []))) {
      return res.status(409).json({ success: false, message: 'Job identique déjà existant' });
    }

    const job = await PublishJob.create({
      userId: user.id,
      hubId: payload.hubId,
      projectId: payload.projectId,
      models: payload.models,

      scheduleEnabled: payload.scheduleEnabled,
      cronExpression: payload.cronExpression,
      timezone: payload.timezone,

      outputFormat: payload.outputFormat,
      publishViews: payload.publishViews,
      publishSheets: payload.publishSheets,
      includeLinkedModels: payload.includeLinkedModels,
      publishOptions: payload.publishOptions,

      notificationsEnabled: payload.notificationsEnabled,
      notifyOnSuccess: payload.notifyOnSuccess,
      notifyOnFailure: payload.notifyOnFailure,
      notificationRecipients: payload.notificationRecipients,

      status: 'idle',
      statistics: {},
      webhooks: {},
      history: [],
    });

    if (job.scheduleEnabled) scheduler.scheduleJob(job);

    return res.json({ success: true, data: job, realPublishEnabled: ENABLE_REAL });
  } catch (err) {
    logger.error(`POST /api/publish/jobs error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Erreur création de job' });
  }
});

router.get('/jobs', async (req, res) => {
  try {
    const where = { userId: req.userId };
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (req.query.hubId) where.hubId = String(req.query.hubId);
    if (String(req.query.active || '').length)
      where.scheduleEnabled = String(req.query.active).toLowerCase() === 'true';

    const jobs = await PublishJob.findAll({ where, order: [['createdAt', 'DESC']] });
    return res.json({ success: true, data: jobs, realPublishEnabled: ENABLE_REAL });
  } catch (err) {
    logger.error(`GET /api/publish/jobs error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Erreur lecture jobs' });
  }
});

router.patch('/jobs/:id', rateLimit, async (req, res) => {
  try {
    const job = await PublishJob.findByPk(req.params.id);
    if (!job || job.userId !== req.userId) {
      return res.status(404).json({ success: false, message: 'Job introuvable' });
    }

    const merged = normalizeJobInput({ ...job.toJSON(), ...req.body });
    const err = validateJobPayload(merged);
    if (err) return res.status(400).json({ success: false, message: err });

    job.hubId = merged.hubId;
    job.projectId = merged.projectId;
    job.models = merged.models;

    job.scheduleEnabled = merged.scheduleEnabled;
    job.cronExpression = merged.cronExpression;
    job.timezone = merged.timezone;

    job.outputFormat = merged.outputFormat;
    job.publishViews = merged.publishViews;
    job.publishSheets = merged.publishSheets;
    job.includeLinkedModels = merged.includeLinkedModels;
    job.publishOptions = merged.publishOptions;

    job.notificationsEnabled = merged.notificationsEnabled;
    job.notifyOnSuccess = merged.notifyOnSuccess;
    job.notifyOnFailure = merged.notifyOnFailure;
    job.notificationRecipients = merged.notificationRecipients;

    await job.save();

    if (job.scheduleEnabled) scheduler.scheduleJob(job);
    else scheduler.unscheduleJob(job.id);

    return res.json({ success: true, data: job });
  } catch (err) {
    logger.error(`PATCH /api/publish/jobs/:id error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Erreur mise à jour job' });
  }
});

router.delete('/jobs/:id', rateLimit, async (req, res) => {
  try {
    const job = await PublishJob.findByPk(req.params.id);
    if (!job || job.userId !== req.userId) {
      return res.status(404).json({ success: false, message: 'Job introuvable' });
    }
    scheduler.unscheduleJob(job.id);
    await job.destroy();
    return res.json({ success: true });
  } catch (err) {
    logger.error(`DELETE /api/publish/jobs/:id error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Erreur suppression job' });
  }
});

router.post('/jobs/:id/run', rateLimit, async (req, res) => {
  try {
    const job = await PublishJob.findByPk(req.params.id);
    if (!job || job.userId !== req.userId) {
      return res.status(404).json({ success: false, message: 'Job introuvable' });
    }
    scheduler.runJobNow(job.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error(`POST /api/publish/jobs/:id/run error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Erreur lancement job' });
  }
});

// ---------- RUNS (historique) ----------
router.get('/runs', async (req, res) => {
  try {
    const where = { userId: req.userId };
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (req.query.jobId) where.jobId = String(req.query.jobId);
    if (req.query.status) where.status = String(req.query.status);

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const runs = await PublishRun.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
    });
    return res.json({ success: true, data: runs });
  } catch (err) {
    logger.error(`GET /api/publish/runs error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Erreur lecture runs' });
  }
});

router.get('/jobs/:id/runs', async (req, res) => {
  try {
    const job = await PublishJob.findByPk(req.params.id);
    if (!job || job.userId !== req.userId) {
      return res.status(404).json({ success: false, message: 'Job introuvable' });
    }
    const runs = await PublishRun.findAll({
      where: { jobId: job.id, userId: req.userId },
      order: [['createdAt', 'DESC']],
      limit: Math.min(parseInt(req.query.limit || '50', 10), 200),
    });
    return res.json({ success: true, data: runs });
  } catch (err) {
    logger.error(`GET /api/publish/jobs/:id/runs error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Erreur lecture runs du job' });
  }
});

module.exports = router;
