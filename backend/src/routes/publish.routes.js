// src/routes/publish.routes.js
// CRUD des jobs + endpoints d'historique, avec gestion d'erreurs améliorée
const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const cron = require('node-cron');
const { authenticateToken } = require('../middleware/auth.middleware');
const { PublishJob, PublishRun, User } = require('../models');
const scheduler = require('../services/scheduler.service');
const apsAccessService = require('../services/apsAccess.service');
const webhookRegistrationService = require('../services/webhookRegistration.service');
const apsAuthService = require('../services/apsAuth.service');

// ✅ Import error handler
const {
  asyncHandler,
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require('../middleware/errorHandler.middleware');

// ------------- helpers -------------
const ENABLE_REAL = String(process.env.ENABLE_REAL_PUBLISH || 'false').toLowerCase() === 'true';

// URN valides pour toutes les régions APS/ACC :
// US (wipprod), CAN (wipcan), EMEA (wipemea), GBR (wipgbr), DEU (wipdeu), JPN (wipjpn), IND (wipind), AUS (wipaus)
const VALID_URN_PATTERNS = [
  // Lineage URNs (items)
  /^urn:adsk\.wip(prod|emea|can|gbr|deu|jpn|ind|aus):dm\.lineage:[A-Za-z0-9_-]+$/i,
  // Versioned file URNs
  /^urn:adsk\.wip(prod|emea|can|gbr|deu|jpn|ind|aus):fs\.file:vf\.[A-Za-z0-9_-]+/i,
];

function validUrn(u) {
  const value = String(u || '').trim();
  if (!value) return false;
  return VALID_URN_PATTERNS.some((pattern) => pattern.test(value));
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
  out.name = String(body.name || '').trim() || 'Tâche sans nom';
  out.hubId = String(body.hubId || '').trim();
  const rawHubName = body.hubName;
  out.hubName = rawHubName == null ? null : String(rawHubName).trim() || null;
  out.projectId = String(body.projectId || '').trim();
  const rawProjectName = body.projectName;
  out.projectName = rawProjectName == null ? null : String(rawProjectName).trim() || null;
  
  // Traiter les items (modèles)
  const items = Array.isArray(body.items) ? body.items : [];
  
  // Si items contient des objets {urn, name}, les garder
  // Sinon, juste convertir en strings
  out.models = items.filter(Boolean).map(item => {
    if (typeof item === 'object' && item.urn) {
      return { urn: String(item.urn), name: item.name || 'Maquette' };
    }
    return String(item);
  });
  
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
  out.notifyOnFailure = !!body.notifyOnFailure;
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
  
  // Valider les URNs (qui peuvent être des strings ou des objets {urn, name})
  const bad = p.models.find((model) => {
    const urn = typeof model === 'string' ? model : model.urn;
    return !validUrn(urn);
  });
  
  if (bad) {
    const badUrn = typeof bad === 'string' ? bad : bad.urn;
    return `URN invalide: ${badUrn}`;
  }
  
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
    name: payload.name,
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

  if (job.scheduleEnabled) await scheduler.scheduleJob(job);

  // 🆕 Créer automatiquement le webhook pour ce projet (si webhooks activés)
  let webhookCreated = false;
  try {
    if (webhookRegistrationService.isConfigured()) {
      const accessToken = await apsAuthService.ensureValidToken(user.id);
      const webhook = await webhookRegistrationService.ensureProjectWebhook(
        accessToken,
        payload.projectId,
        payload.hubId
      );
      webhookCreated = !!webhook;
      if (webhookCreated) {
        logger.info(`[Publish] Webhook automatiquement créé/vérifié pour projet ${payload.projectId}`);
      }
    }
  } catch (webhookError) {
    // Ne pas bloquer la création du job si le webhook échoue
    logger.warn(`[Publish] Impossible de créer le webhook: ${webhookError.message}`);
  }

  return res.json({ success: true, data: job, realPublishEnabled: ENABLE_REAL, webhookCreated });
}));

router.get('/jobs', asyncHandler(async (req, res) => {
  // 🆕 Lecture globale : tous les utilisateurs voient toutes les tâches
  const where = {};
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
    
    // Normaliser les models pour assurer qu'ils sont tous au format {urn, name}
    const normalizedModels = (jobData.models || []).map((model) => {
      if (typeof model === 'string') {
        // Ancien format : juste l'URN
        return { urn: model, name: 'Maquette' };
      } else if (typeof model === 'object' && model.urn) {
        // Nouveau format : objet avec urn et name
        return { urn: model.urn, name: model.name || 'Maquette' };
      }
      return model;
    });
    
    return {
      ...jobData,
      models: normalizedModels,
      userName: jobData.user?.name || jobData.user?.email || 'Utilisateur inconnu',
    };
  });

  return res.json({ success: true, data: jobsWithUser, realPublishEnabled: ENABLE_REAL });
}));

router.patch('/jobs/:id', rateLimit, asyncHandler(async (req, res) => {
  const job = await PublishJob.findByPk(req.params.id);
  if (!job) {
    throw new NotFoundError('Job');
  }

  // 🆕 Vérification d'accès au projet APS (Option B)
  // L'utilisateur peut modifier s'il a accès au projet dans ACC
  const hasAccess = await apsAccessService.checkUserProjectAccess(req.userId, job.projectId, job.hubId);
  if (!hasAccess) {
    throw new ForbiddenError('Vous n\'avez pas accès au projet de cette planification');
  }

  const merged = normalizeJobInput({ ...job.toJSON(), ...req.body });
  const err = validateJobPayload(merged);
  if (err) throw new ValidationError(err);

  job.name = merged.name;
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

  // Invalider le cache d'accès après modification réussie
  apsAccessService.invalidateCache(req.userId, job.projectId);

  if (job.scheduleEnabled) await scheduler.scheduleJob(job);
  else scheduler.unscheduleJob(job.id);

  return res.json({ success: true, data: job });
}));

router.delete('/jobs/:id', rateLimit, asyncHandler(async (req, res) => {
  const job = await PublishJob.findByPk(req.params.id);
  if (!job) {
    throw new NotFoundError('Job');
  }

  // 🆕 Vérification d'accès au projet APS (Option B)
  const hasAccess = await apsAccessService.checkUserProjectAccess(req.userId, job.projectId, job.hubId);
  if (!hasAccess) {
    throw new ForbiddenError('Vous n\'avez pas accès au projet de cette planification');
  }

  scheduler.unscheduleJob(job.id);
  await job.destroy();

  return res.json({ success: true });
}));

router.post('/jobs/:id/run', rateLimit, asyncHandler(async (req, res) => {
  const job = await PublishJob.findByPk(req.params.id);
  if (!job) {
    throw new NotFoundError('Job');
  }

  // 🆕 Vérification d'accès au projet APS
  const hasAccess = await apsAccessService.checkUserProjectAccess(req.userId, job.projectId, job.hubId);
  if (!hasAccess) {
    throw new ForbiddenError('Vous n\'avez pas accès au projet de cette planification');
  }

  const { run, alreadyRunning, projectBusy } = await scheduler.runJobNow(job.id, { job });
  if (alreadyRunning) {
    throw new ValidationError('Job déjà en cours');
  }
  if (projectBusy) {
    throw new ValidationError('Un autre job est en cours sur ce projet. Veuillez réessayer dans quelques minutes.');
  }
  if (!run) {
    throw new Error('Impossible de lancer le job');
  }

  return res.json({ success: true, data: run });
}));

// ---------- RUNS (historique) ----------
router.get('/runs', asyncHandler(async (req, res) => {
  // 🆕 Lecture globale : tous voient tous les runs
  const where = {};
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
  if (!job) {
    throw new NotFoundError('Job');
  }

  // 🆕 Tous peuvent voir les runs de tous les jobs
  const runs = await PublishRun.findAll({
    where: { jobId: job.id },
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(req.query.limit || '50', 10), 200),
  });

  return res.json({ success: true, data: runs });
}));

module.exports = router;
