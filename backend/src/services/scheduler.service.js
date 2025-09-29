// src/services/scheduler.service.js
// Planifie et exécute les jobs, avec protections :
// - pas d’exécutions concurrentes pour un même job
// - "crash safety" : marque les runs "running" comme "failed" au démarrage
// - logs explicites

const cron = require('node-cron');
const logger = require('../config/logger');
const { PublishJob, PublishRun } = require('../models');
const apsPublishService = require('./apsPublish.service');

// Map<jobId, CronTask>
const TASKS = new Map();
// Set<jobId> des jobs en cours d'exécution pour éviter les overlaps
const RUNNING = new Set();

function unscheduleJob(jobId) {
  const t = TASKS.get(String(jobId));
  if (t) {
    try { t.stop(); } catch {}
    TASKS.delete(String(jobId));
    logger.info(`[Scheduler] Job ${jobId} déplanifié`);
  }
}

function scheduleJob(job) {
  unscheduleJob(job.id);
  if (!job.scheduleEnabled) return;

  try {
    const task = cron.schedule(
      job.cronExpression,
      async () => { await runJob(job.id); },
      { scheduled: true, timezone: job.timezone || 'UTC' }
    );
    TASKS.set(String(job.id), task);
    logger.info(`[Scheduler] Job ${job.id} planifié (${job.cronExpression} ${job.timezone})`);
  } catch (e) {
    logger.error(`[Scheduler] Impossible de planifier job ${job.id}: ${e.message}`);
  }
}

async function runJob(jobId) {
  if (RUNNING.has(String(jobId))) {
    logger.warn(`[Scheduler] Job ${jobId} déjà en cours, on ignore ce tick`);
    return;
  }

  RUNNING.add(String(jobId));
  try {
    const job = await PublishJob.findByPk(jobId);
    if (!job) {
      logger.warn(`[Scheduler] Job ${jobId} introuvable`);
      return;
    }

    job.status = 'running';
    job.lastRun = new Date();
    await job.save();

    // 1) créer un run
    const run = await apsPublishService.startRun(job);

    // 2) exécuter (réel ou dry-run selon feature flag)
    const { results, durationMs } = await apsPublishService.executeRun(run);

    // 3) terminer le run + mettre à jour le job
    await apsPublishService.finishRun(run, {
      status: 'success',
      results,
      durationMs,
    });

    job.status = 'idle';
    job.statistics = {
      ...(job.statistics || {}),
      last: {
        at: new Date(),
        durationMs,
        items: results.length,
        ok: true,
      },
    };
    job.history = [
      ...(job.history || []),
      { at: new Date(), status: 'done', durationMs, results },
    ];
    await job.save();

    logger.info(`[Scheduler] Job ${job.id} exécuté (items=${(job.models || []).length})`);
  } catch (e) {
    logger.error(`[Scheduler] Echec job ${jobId}: ${e.message}`);
    try {
      const job = await PublishJob.findByPk(jobId);
      if (job) {
        job.status = 'error';
        job.history = [
          ...(job.history || []),
          { at: new Date(), status: 'error', message: e.message },
        ];
        await job.save();
      }
    } catch {}
  } finally {
    RUNNING.delete(String(jobId));
  }
}

async function runJobNow(jobId) {
  // lancement immédiat (non bloquant pour l'appelant)
  runJob(jobId).catch((e) =>
    logger.error(`[Scheduler] runJobNow error: ${e.message}`)
  );
}

async function init() {
  // Crash safety: tout run resté "running" est marqué "failed (crash)" au démarrage
  try {
    const hanging = await PublishRun.findAll({ where: { status: 'running' } });
    for (const r of hanging) {
      r.status = 'failed';
      r.message = 'Process restart while running';
      r.endedAt = new Date();
      await r.save();
    }
    if (hanging.length) {
      logger.warn(`[Scheduler] ${hanging.length} run(s) marqués failed (crash) au démarrage`);
    }
  } catch (e) {
    logger.error(`[Scheduler] Crash-safety update error: ${e.message}`);
  }

  // Au boot: planifie tous les jobs actifs
  const jobs = await PublishJob.findAll({
    where: { scheduleEnabled: true },
    order: [['createdAt', 'ASC']],
  });
  for (const j of jobs) scheduleJob(j);
  logger.info(`[Scheduler] ${jobs.length} job(s) planifié(s) au démarrage`);
}

module.exports = {
  init,
  scheduleJob,
  unscheduleJob,
  runJobNow,
};
