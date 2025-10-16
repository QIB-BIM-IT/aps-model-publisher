// src/routes/publish.routes.js
// CRUD des jobs + endpoints d'historique, avec gestion d'erreurs améliorée
const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const cron = require('node-cron');
const { authenticateToken } = require('../middleware/auth.middleware');
const { PublishJob, PublishRun, User } = require('../models');
const scheduler = require('../services/scheduler.service');

// ✅ Import error handler
const {
  asyncHandler,
  ValidationError,
  NotFoundError,
} = require('../middleware/errorHandler.middleware');

// ------------- helpers -------------
const ENABLE_REAL = String(process.env.ENABLE_REAL_PUBLISH || 'false').toLowerCase() === 'true';

const VALID_URN_PREFIXES = [
  'urn:adsk.wipprod:dm.lineage:',
  'urn:adsk.wipprod:fs.file:vf.',
];

function validUrn(u) {
  const value = String(u || '').trim();
  if (!value) return false;
  const lowerValue = value.toLowerCase();
  return VALID_URN_PREFIXES.some((prefix) => {
    if (!lowerValue.startsWith(prefix)) return false;
    return value.length > prefix.length;
  });
}

let KNOWN_TZ = null;
try {
  if (typeof Intl.supportedValuesOf === 'function') {
    KNOWN_TZ = new Set(Intl.supportedValuesOf('timeZone') || []);
  }
} catch (_) {}

function validTz(tz) {
  if (!tz) return false;
  if (KNOWN_TZ) return KNOWN_TZ.has(tz);
  return /^[A-Za-z]+\/[A-Za-z_\-]+$/.test(tz);
}

function normalizeJobInput(body) {
  const out = {};
  out.hubId = String(body.hubId || '').trim();
  const rawHubName = body.hubName;
  out.hubName = rawHubName == null ? null : String(rawHubName).trim() || null;
  out.projectId = String(body.projectId || '').trim();
  const rawProjectName = body.projectName;
  out.projectName = rawProjectName == null ? null : String(rawProjectName).trim() || null;
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
    ? body.notificationRecipients
    : [];
  return out;
}

function validateJobPayload(p) {
  if (!p.hubId) return 'hubId requis';
  if (!p.projectId) return 'projectId requis';
  if (!Array.isArray(p.models) || p.models.length === 0) return 'items (models) requis';
  if (!cron.validate(p.cronExpression)) return 'cronExpression invalide';
  if (!validTz(p.timezone)) return 'timezone invalide';
  const bad = p.models.find((u) => !validUrn(u));
  if (bad) return `URN invalide: ${bad}`;
  return null;
}

// Rate limiting léger
const RATE_BUCKETS = new Map();
const RATE_WINDOW_MS = 15_000;
const RATE_LIMIT = 10;

function keyFromReq(req) {
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
    return res.status(429).json({
      success: false,
      message: `Trop de requêtes, réessaie dans ${Math.ceil(wait / 1000)}s`,
    });
  }
  next();
}

router.use(authenticateToken);

// ✅ Toutes les routes utilisent asyncHandler (plus besoin de try-catch!)
// ---------- JOBS ----------
router.post('/jobs', rateLimit, asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId);
  if (!user) throw new NotFoundError('Utilisateur');

  logger.debug('POST /api/publish/jobs body', { body: req.body });

  const payload = normalizeJobInput(req.body);
  const err = validateJobPayload(payload);
  if (err) throw new ValidationError(err);

  // Idempotence check
  const existing = await PublishJob.findAll({
    where: {
      userId: user.id,
      hubId: payload.hubId,
      projectId: payload.projectId,
      cronExpression: payload.cronExpression,
      timezone: payload.timezone,
    },
  });
  if (existing.some((j) => JSON.stringify(j.models || []) === JSON.stringify(payload.models || []))) {
    throw new ValidationError('Job identique déjà existant');
  }

  const job = await PublishJob.create({
    userId: user.id,
    hubId: payload.hubId,
    hubName: payload.hubName,
    projectId: payload.projectId,
    projectName: payload.projectName,
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
}));

router.get('/jobs', asyncHandler(async (req, res) => {
  const where = { userId: req.userId };
  if (req.query.projectId) where.projectId = String(req.query.projectId);
  if (req.query.hubId) where.hubId = String(req.query.hubId);
  if (String(req.query.active || '').length) {
    where.scheduleEnabled = String(req.query.active).toLowerCase() === 'true';
  }

  const jobs = await PublishJob.findAll({
    where,
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email'],
      },
    ],
    order: [['createdAt', 'DESC']],
  });

  const jobsWithUser = jobs.map((job) => {
    const jobData = job.toJSON();
    return {
      ...jobData,
      userName: jobData.user?.name || jobData.user?.email || 'Utilisateur inconnu',
    };
  });

  return res.json({ success: true, data: jobsWithUser, realPublishEnabled: ENABLE_REAL });
}));

router.patch('/jobs/:id', rateLimit, asyncHandler(async (req, res) => {
  const job = await PublishJob.findByPk(req.params.id);
  if (!job || job.userId !== req.userId) {
    throw new NotFoundError('Job');
  }

  const merged = normalizeJobInput({ ...job.toJSON(), ...req.body });
  const err = validateJobPayload(merged);
  if (err) throw new ValidationError(err);

  job.hubId = merged.hubId;
  job.hubName = merged.hubName;
  job.projectId = merged.projectId;
  job.projectName = merged.projectName;
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
}));

router.delete('/jobs/:id', rateLimit, asyncHandler(async (req, res) => {
  const job = await PublishJob.findByPk(req.params.id);
  if (!job || job.userId !== req.userId) {
    throw new NotFoundError('Job');
  }

  scheduler.unscheduleJob(job.id);
  await job.destroy();

  return res.json({ success: true });
}));

router.post('/jobs/:id/run', rateLimit, asyncHandler(async (req, res) => {
  const job = await PublishJob.findByPk(req.params.id);
  if (!job || job.userId !== req.userId) {
    throw new NotFoundError('Job');
  }

  const { run, alreadyRunning } = await scheduler.runJobNow(job.id, { job });
  if (alreadyRunning) {
    throw new ValidationError('Job déjà en cours');
  }
  if (!run) {
    throw new Error('Impossible de lancer le job');
  }

  return res.json({ success: true, data: run });
}));

// ---------- RUNS (historique) ----------
router.get('/runs', asyncHandler(async (req, res) => {
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
}));

router.get('/jobs/:id/runs', asyncHandler(async (req, res) => {
  const job = await PublishJob.findByPk(req.params.id);
  if (!job || job.userId !== req.userId) {
    throw new NotFoundError('Job');
  }

  const runs = await PublishRun.findAll({
    where: { jobId: job.id, userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(req.query.limit || '50', 10), 200),
  });

  return res.json({ success: true, data: runs });
}));

module.exports = router;
