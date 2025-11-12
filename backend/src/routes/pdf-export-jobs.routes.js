// src/routes/pdf-export-jobs.routes.js
// CRUD des jobs d'export PDF + endpoints d'historique

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const cron = require('node-cron');
const { authenticateToken } = require('../middleware/auth.middleware');
const { PDFExportJob, PDFExportRun, User } = require('../models');
const scheduler = require('../services/scheduler.service');

const {
  asyncHandler,
  ValidationError,
  NotFoundError,
} = require('../middleware/errorHandler.middleware');

// ============= HELPERS =============

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
  out.projectId = String(body.projectId || '').trim();
  out.projectName = body.projectName == null ? null : String(body.projectName).trim() || null;
  out.folderId = String(body.folderId || '').trim();
  out.folderName = body.folderName == null ? null : String(body.folderName).trim() || null;
  out.fileUrn = String(body.fileUrn || '').trim();
  out.fileName = body.fileName == null ? null : String(body.fileName).trim() || null;
  
  out.scheduleEnabled = body.scheduleEnabled !== false;
  out.cronExpression = String(body.cronExpression || '0 2 * * *').trim();
  out.timezone = String(body.timezone || 'UTC').trim();
  
  out.selectionMode = String(body.selectionMode || 'all').trim();
  out.selectedSheets = Array.isArray(body.selectedSheets) ? body.selectedSheets : [];
  
  out.includeSheets = body.includeSheets !== false;
  out.includeViews2D = body.includeViews2D !== false;
  out.includeMarkups = body.includeMarkups !== false;
  
  out.exportMode = String(body.exportMode || 'individual').trim();
  out.mergedFileName = body.mergedFileName == null ? null : String(body.mergedFileName).trim() || null;
  
  out.notificationsEnabled = !!body.notificationsEnabled;
  out.notifyOnSuccess = !!body.notifyOnSuccess;
  out.notifyOnFailure = body.notifyOnFailure !== false;
  out.notificationRecipients = Array.isArray(body.notificationRecipients)
    ? body.notificationRecipients
    : [];
  
  return out;
}

function validateJobPayload(p) {
  if (!p.projectId) return 'projectId requis';
  if (!p.folderId) return 'folderId requis';
  if (!p.fileUrn) return 'fileUrn requis';
  if (!cron.validate(p.cronExpression)) return 'cronExpression invalide';
  if (!validTz(p.timezone)) return 'timezone invalide';
  if (!['all', 'custom'].includes(p.selectionMode)) return 'selectionMode invalide (all|custom)';
  if (!['individual', 'combined'].includes(p.exportMode)) return 'exportMode invalide (individual|combined)';
  if (p.exportMode === 'combined' && !p.mergedFileName) return 'mergedFileName requis quand exportMode=combined';
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

// ============= JOBS CRUD =============

router.post('/jobs', rateLimit, asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId);
  if (!user) throw new NotFoundError('Utilisateur');

  const payload = normalizeJobInput(req.body);
  const err = validateJobPayload(payload);
  if (err) throw new ValidationError(err);

  // Idempotence check
  const existing = await PDFExportJob.findAll({
    where: {
      userId: user.id,
      projectId: payload.projectId,
      folderId: payload.folderId,
      fileUrn: payload.fileUrn,
      cronExpression: payload.cronExpression,
    },
  });
  if (existing.length > 0) {
    throw new ValidationError('Job identique déjà existant');
  }

  const job = await PDFExportJob.create({
    userId: user.id,
    projectId: payload.projectId,
    projectName: payload.projectName,
    folderId: payload.folderId,
    folderName: payload.folderName,
    fileUrn: payload.fileUrn,
    fileName: payload.fileName,
    scheduleEnabled: payload.scheduleEnabled,
    cronExpression: payload.cronExpression,
    timezone: payload.timezone,
    selectionMode: payload.selectionMode,
    selectedSheets: payload.selectedSheets,
    includeSheets: payload.includeSheets,
    includeViews2D: payload.includeViews2D,
    includeMarkups: payload.includeMarkups,
    exportMode: payload.exportMode,
    mergedFileName: payload.mergedFileName,
    notificationsEnabled: payload.notificationsEnabled,
    notifyOnSuccess: payload.notifyOnSuccess,
    notifyOnFailure: payload.notifyOnFailure,
    notificationRecipients: payload.notificationRecipients,
    status: 'idle',
    statistics: {},
    history: [],
  });

  if (job.scheduleEnabled) scheduler.scheduleJob(job);

  logger.info(`[PDFExportJobs] Job créé: ${job.id}`);
  return res.json({ success: true, data: job });
}));

router.get('/jobs', asyncHandler(async (req, res) => {
  const where = { userId: req.userId };
  if (req.query.projectId) where.projectId = String(req.query.projectId);
  if (req.query.status) where.status = String(req.query.status);
  if (String(req.query.active || '').length) {
    where.scheduleEnabled = String(req.query.active).toLowerCase() === 'true';
  }

  const jobs = await PDFExportJob.findAll({
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

  return res.json({ success: true, data: jobsWithUser });
}));

router.patch('/jobs/:id', rateLimit, asyncHandler(async (req, res) => {
  const job = await PDFExportJob.findByPk(req.params.id);
  if (!job || job.userId !== req.userId) {
    throw new NotFoundError('Job');
  }

  const merged = normalizeJobInput({ ...job.toJSON(), ...req.body });
  const err = validateJobPayload(merged);
  if (err) throw new ValidationError(err);

  job.projectId = merged.projectId;
  job.projectName = merged.projectName;
  job.folderId = merged.folderId;
  job.folderName = merged.folderName;
  job.fileUrn = merged.fileUrn;
  job.fileName = merged.fileName;
  job.scheduleEnabled = merged.scheduleEnabled;
  job.cronExpression = merged.cronExpression;
  job.timezone = merged.timezone;
  job.selectionMode = merged.selectionMode;
  job.selectedSheets = merged.selectedSheets;
  job.includeSheets = merged.includeSheets;
  job.includeViews2D = merged.includeViews2D;
  job.includeMarkups = merged.includeMarkups;
  job.exportMode = merged.exportMode;
  job.mergedFileName = merged.mergedFileName;
  job.notificationsEnabled = merged.notificationsEnabled;
  job.notifyOnSuccess = merged.notifyOnSuccess;
  job.notifyOnFailure = merged.notifyOnFailure;
  job.notificationRecipients = merged.notificationRecipients;

  await job.save();

  if (job.scheduleEnabled) scheduler.scheduleJob(job);
  else scheduler.unscheduleJob(job.id);

  logger.info(`[PDFExportJobs] Job modifié: ${job.id}`);
  return res.json({ success: true, data: job });
}));

router.delete('/jobs/:id', rateLimit, asyncHandler(async (req, res) => {
  const job = await PDFExportJob.findByPk(req.params.id);
  if (!job || job.userId !== req.userId) {
    throw new NotFoundError('Job');
  }

  scheduler.unscheduleJob(job.id);
  await job.destroy();

  logger.info(`[PDFExportJobs] Job supprimé: ${job.id}`);
  return res.json({ success: true });
}));

router.post('/jobs/:id/run', rateLimit, asyncHandler(async (req, res) => {
  const job = await PDFExportJob.findByPk(req.params.id);
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

  logger.info(`[PDFExportJobs] Job lancé maintenant: ${job.id}`);
  return res.json({ success: true, data: run });
}));

// ============= RUNS (HISTORIQUE) =============

router.get('/runs', asyncHandler(async (req, res) => {
  const where = { userId: req.userId };
  if (req.query.jobId) where.jobId = String(req.query.jobId);
  if (req.query.projectId) where.projectId = String(req.query.projectId);
  if (req.query.status) where.status = String(req.query.status);
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

  const runs = await PDFExportRun.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
  });

  return res.json({ success: true, data: runs });
}));

router.get('/jobs/:id/runs', asyncHandler(async (req, res) => {
  const job = await PDFExportJob.findByPk(req.params.id);
  if (!job || job.userId !== req.userId) {
    throw new NotFoundError('Job');
  }

  const runs = await PDFExportRun.findAll({
    where: { jobId: job.id, userId: req.userId },
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(req.query.limit || '50', 10), 200),
  });

  return res.json({ success: true, data: runs });
}));

module.exports = router;
