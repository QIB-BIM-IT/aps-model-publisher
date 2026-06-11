const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const cron = require('node-cron');
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth.middleware');
const { CopyJob, CopyRun, User } = require('../models');
const scheduler = require('../services/scheduler.service');
const apsAuthService = require('../services/apsAuth.service');
const webhookRegistrationService = require('../services/webhookRegistration.service');

const {
  asyncHandler,
  ValidationError,
  NotFoundError,
} = require('../middleware/errorHandler.middleware');

// 🆕 Construit un filtre Sequelize sur createdAt a partir de query params from/to (ISO)
function buildDateRange(from, to) {
  const range = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range[Op.gte] = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) range[Op.lte] = d;
  }
  return Object.getOwnPropertySymbols(range).length > 0 ? range : null;
}

function validTz(tz) {
  if (!tz) return false;
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      const tzSet = new Set(Intl.supportedValuesOf('timeZone') || []);
      return tzSet.has(tz);
    }
  } catch (_) {}
  return /^[A-Za-z]+\/[A-Za-z_\-]+$/.test(tz);
}

function normalizeJobInput(body) {
  const out = {};
  out.name = String(body.name || '').trim() || 'Tâche sans nom';

  out.hubId = body.hubId == null ? null : String(body.hubId).trim() || null;
  out.hubName = body.hubName == null ? null : String(body.hubName).trim() || null;

  out.projectId = String(body.projectId || '').trim();
  out.projectName = body.projectName == null ? null : String(body.projectName).trim() || null;
  out.sourceFolderId = String(body.sourceFolderId || '').trim();
  out.sourceFolderName = body.sourceFolderName == null ? null : String(body.sourceFolderName).trim() || null;

  out.files = Array.isArray(body.files) ? body.files : [];

  out.destinationProjectId = String(body.destinationProjectId || '').trim();
  out.destinationProjectName = body.destinationProjectName == null ? null : String(body.destinationProjectName).trim() || null;
  out.destinationFolderId = String(body.destinationFolderId || '').trim();
  out.destinationFolderName = body.destinationFolderName == null ? null : String(body.destinationFolderName).trim() || null;

  out.overwriteExisting = body.overwriteExisting !== false;

  out.scheduleEnabled = body.scheduleEnabled !== false;
  out.cronExpression = String(body.cronExpression || '0 2 * * *').trim();
  out.timezone = String(body.timezone || 'UTC').trim();

  out.notificationsEnabled = !!body.notificationsEnabled;
  out.notifyOnSuccess = !!body.notifyOnSuccess;
  out.notifyOnFailure = !!body.notifyOnFailure;
  out.notificationRecipients = Array.isArray(body.notificationRecipients)
    ? body.notificationRecipients
    : [];

  return out;
}

function validateJobPayload(p) {
  if (!p.projectId) return 'projectId requis';
  if (!p.sourceFolderId) return 'sourceFolderId requis';
  if (!p.files || p.files.length === 0) return 'Au moins un fichier requis';
  if (!p.destinationProjectId) return 'destinationProjectId requis';
  if (!p.destinationFolderId) return 'destinationFolderId requis';
  if (!cron.validate(p.cronExpression)) return 'cronExpression invalide';
  if (!validTz(p.timezone)) return 'timezone invalide';
  return null;
}

const RATE_BUCKETS = new Map();
const RATE_WINDOW_MS = 15_000;
const RATE_LIMIT = 10;

function rateLimit(req, res, next) {
  const key = req.userId || req.ip || 'unknown';
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

// ============= JOBS CRUD =============

router.post('/jobs', rateLimit, asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId);
  if (!user) throw new NotFoundError('Utilisateur');

  const payload = normalizeJobInput(req.body);
  const err = validateJobPayload(payload);
  if (err) throw new ValidationError(err);

  const job = await CopyJob.create({
    userId: user.id,
    ...payload,
    status: 'idle',
    statistics: {},
    history: [],
  });

  if (job.scheduleEnabled) await scheduler.scheduleJob(job);

  // 🆕 Auto-enregistrement webhook sur le dossier de destination (non bloquant)
  // La nouvelle version (fichier copié) apparaît dans le dossier destination.
  (async () => {
    try {
      if (webhookRegistrationService.isConfigured() && job.destinationFolderId && job.destinationProjectId) {
        const token = await apsAuthService.ensureValidToken(user.id);
        await webhookRegistrationService.ensureFolderWebhookAnyRegion(token, job.destinationFolderId, job.destinationProjectId, job.hubId || null);
        logger.info(`[CopyJobs] Webhook auto-enregistré pour dossier destination ${job.destinationFolderId}`);
      }
    } catch (e) {
      logger.warn(`[CopyJobs] Auto-enregistrement webhook échoué: ${e.message}`);
    }
  })();

  logger.info(`[CopyJobs] Job créé: ${job.id} - ${(payload.files || []).length} fichier(s)`);
  return res.json({ success: true, data: job });
}));

router.get('/jobs', asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.projectId) where.projectId = String(req.query.projectId);
  if (req.query.status) where.status = String(req.query.status);
  if (String(req.query.active || '').length) {
    where.scheduleEnabled = String(req.query.active).toLowerCase() === 'true';
  }

  const jobs = await CopyJob.findAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
    order: [['createdAt', 'DESC']],
  });

  const jobsWithUser = jobs.map((job) => {
    const d = job.toJSON();
    return { ...d, userName: d.user?.name || d.user?.email || 'Utilisateur inconnu' };
  });

  return res.json({ success: true, data: jobsWithUser });
}));

router.patch('/jobs/:id', rateLimit, asyncHandler(async (req, res) => {
  const job = await CopyJob.findByPk(req.params.id);
  if (!job) throw new NotFoundError('Job');

  const merged = normalizeJobInput({ ...job.toJSON(), ...req.body });
  const err = validateJobPayload(merged);
  if (err) throw new ValidationError(err);

  Object.assign(job, merged);
  await job.save();

  if (job.scheduleEnabled) await scheduler.scheduleJob(job);
  else scheduler.unscheduleJob(job.id);

  logger.info(`[CopyJobs] Job modifié: ${job.id}`);
  return res.json({ success: true, data: job });
}));

router.delete('/jobs/:id', rateLimit, asyncHandler(async (req, res) => {
  const job = await CopyJob.findByPk(req.params.id);
  if (!job) throw new NotFoundError('Job');

  scheduler.unscheduleJob(job.id);
  await job.destroy();

  logger.info(`[CopyJobs] Job supprimé: ${job.id}`);
  return res.json({ success: true });
}));

router.post('/jobs/:id/run', rateLimit, asyncHandler(async (req, res) => {
  const job = await CopyJob.findByPk(req.params.id);
  if (!job) throw new NotFoundError('Job');

  const { run, alreadyRunning, projectBusy } = await scheduler.runJobNow(job.id, { job });
  if (alreadyRunning) throw new ValidationError('Job déjà en cours');
  if (projectBusy) throw new ValidationError('Un autre job est en cours sur ce projet. Veuillez réessayer.');
  if (!run) throw new Error('Impossible de lancer le job');

  logger.info(`[CopyJobs] Job lancé maintenant: ${job.id}`);
  return res.json({ success: true, data: run });
}));

// ============= RUNS =============

router.get('/runs', asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.jobId) where.jobId = String(req.query.jobId);
  if (req.query.projectId) where.projectId = String(req.query.projectId);
  if (req.query.status) where.status = String(req.query.status);

  // 🆕 Filtrage par plage de dates (createdAt) pour les metriques du Dashboard
  const createdAt = buildDateRange(req.query.from, req.query.to);
  if (createdAt) where.createdAt = createdAt;

  const maxLimit = createdAt ? 5000 : 200;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), maxLimit);

  const runs = await CopyRun.findAll({ where, order: [['createdAt', 'DESC']], limit });
  return res.json({ success: true, data: runs });
}));

router.get('/jobs/:id/runs', asyncHandler(async (req, res) => {
  const job = await CopyJob.findByPk(req.params.id);
  if (!job) throw new NotFoundError('Job');

  const runs = await CopyRun.findAll({
    where: { jobId: job.id },
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(req.query.limit || '50', 10), 200),
  });

  return res.json({ success: true, data: runs });
}));

module.exports = router;
