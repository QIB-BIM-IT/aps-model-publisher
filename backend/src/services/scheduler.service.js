// src/services/scheduler.service.js
// Planifie et exécute les jobs (Publish + PDF Export), avec protections :
// - pas d'exécutions concurrentes pour un même job
// - "crash safety" : marque les runs "running" comme "failed" au démarrage
// - logs explicites

const cron = require('node-cron');
const logger = require('../config/logger');
const { PublishJob, PublishRun, PDFExportJob, PDFExportRun, User } = require('../models');
const apsPublishService = require('./apsPublish.service');
const pdfExportSchedulerService = require('./pdfExportScheduler.service');
const emailService = require('./email.service');

// Map<jobId, CronTask>
const TASKS = new Map();
// Set<jobId> des jobs en cours d'exécution pour éviter les overlaps
const RUNNING = new Set();

function unscheduleJob(jobId) {
  const t = TASKS.get(String(jobId));
  if (t) {
    try {
      t.stop();
    } catch {}
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
      async () => {
        await runJob(job.id, job);
      },
      { scheduled: true, timezone: job.timezone || 'UTC' }
    );
    TASKS.set(String(job.id), task);
    logger.info(`[Scheduler] Job ${job.id} planifié (${job.cronExpression} ${job.timezone})`);
  } catch (e) {
    logger.error(`[Scheduler] Impossible de planifier job ${job.id}: ${e.message}`);
  }
}

/**
 * Détermine le type de job (publish ou pdf-export)
 */
function getJobType(job) {
  if (job.constructor.name === 'PDFExportJob') return 'pdf-export';
  if (job.constructor.name === 'PublishJob') return 'publish';
  // Fallback: vérifier les champs
  if (job.fileUrn && job.selectionMode) return 'pdf-export';
  if (job.models && Array.isArray(job.models)) return 'publish';
  return null;
}

async function runJob(jobId, jobInstance = null, options = {}) {
  const key = String(jobId);
  const skipBegin = options.skipBegin === true;
  let job = jobInstance || options.job || null;
  let run = options.run || null;
  let jobType = null;

  if (!skipBegin) {
    if (RUNNING.has(key)) {
      logger.warn(`[Scheduler] Job ${jobId} déjà en cours, on ignore ce tick`);
      return null;
    }

    RUNNING.add(key);
    try {
      // Chercher d'abord comme PDFExportJob
      job = await PDFExportJob.findByPk(jobId);
      if (!job) {
        // Sinon comme PublishJob
        job = await PublishJob.findByPk(jobId);
      }

      if (!job) {
        logger.warn(`[Scheduler] Job ${jobId} introuvable`);
        RUNNING.delete(key);
        return null;
      }

      jobType = getJobType(job);
      if (!jobType) {
        logger.error(`[Scheduler] Impossible de déterminer le type du job ${jobId}`);
        RUNNING.delete(key);
        return null;
      }

      logger.info(`[Scheduler] Exécution job ${jobId} (type=${jobType})`);

      job.status = 'running';
      job.lastRun = new Date();
      await job.save();

      // Créer le run selon le type
      if (jobType === 'pdf-export') {
        run = await pdfExportSchedulerService.startRun(job);
      } else {
        run = await apsPublishService.startRun(job);
      }
    } catch (e) {
      RUNNING.delete(key);
      logger.error(`[Scheduler] Erreur initialisation job ${jobId}: ${e.message}`);
      throw e;
    }
  } else {
    if (!job || !run) {
      logger.error(`[Scheduler] runJob skipBegin sans job/run pour ${jobId}`);
      return null;
    }
    jobType = getJobType(job);
    if (!RUNNING.has(key)) {
      RUNNING.add(key);
    }
  }

  try {
    let summary = null;

    // Exécuter selon le type
    if (jobType === 'pdf-export') {
      summary = await pdfExportSchedulerService.executeRun(run);
    } else {
      summary = await apsPublishService.executeRun(run);
    }

    // Finaliser selon le type
    let finishedRun = null;
    if (jobType === 'pdf-export') {
      finishedRun = await pdfExportSchedulerService.finishRun(run, summary);
    } else {
      finishedRun = await apsPublishService.finishRun(run, {
        status: 'success',
        results: summary.results,
        durationMs: summary.durationMs,
      });
    }

    job.status = 'idle';
    job.statistics = {
      ...(job.statistics || {}),
      last: {
        at: new Date(),
        durationMs: summary.durationMs,
        ok: finishedRun.status === 'success' || finishedRun.status === 'partial',
      },
    };
    job.history = [
      ...(job.history || []),
      {
        at: new Date(),
        status: finishedRun.status || 'done',
        durationMs: summary.durationMs,
      },
    ];
    await job.save();

    logger.info(
      `[Scheduler] Job ${job.id} exécuté (type=${jobType}, status=${finishedRun.status})`
    );

    // Vérifier si le run a échoué (failed, error, ou partial avec des échecs) et envoyer une notification si nécessaire
    if (finishedRun && (finishedRun.status === 'failed' || finishedRun.status === 'error')) {
      await sendFailureEmailIfNeeded(job, finishedRun, jobType);
    } else if (finishedRun && finishedRun.status === 'partial') {
      // Pour les échecs partiels, vérifier s'il y a des échecs
      const stats = finishedRun.stats || {};
      const failCount = stats.failCount || stats.failed || 0;
      if (failCount > 0) {
        await sendFailureEmailIfNeeded(job, finishedRun, jobType);
      }
    }

    return run;
  } catch (e) {
    logger.error(`[Scheduler] Echec job ${jobId}: ${e.message}`);
    let failedRun = null;
    try {
      if (run) {
        const finishOptions = {
          status: 'failed',
          results: run?.results || [],
          durationMs: run?.startedAt ? Date.now() - new Date(run.startedAt).getTime() : undefined,
          message: e.message,
        };

        if (jobType === 'pdf-export') {
          failedRun = await pdfExportSchedulerService.finishRun(run, finishOptions);
        } else {
          failedRun = await apsPublishService.finishRun(run, finishOptions);
        }
      }
    } catch {}

    try {
      if (job) {
        job.status = 'error';
        job.history = [
          ...(job.history || []),
          { at: new Date(), status: 'error', message: e.message },
        ];
        await job.save();
      }
    } catch {}

    // Envoyer une notification d'échec si nécessaire
    if (failedRun) {
      await sendFailureEmailIfNeeded(job, failedRun, jobType);
    }

    return run;
  } finally {
    RUNNING.delete(key);
  }
}

async function runJobNow(jobId, options = {}) {
  const key = String(jobId);

  if (RUNNING.has(key)) {
    logger.warn(`[Scheduler] Job ${jobId} déjà en cours, lancement immédiat ignoré`);
    return { run: null, alreadyRunning: true };
  }

  let job = options.job || null;
  if (!job) {
    // Chercher comme PDFExportJob d'abord
    job = await PDFExportJob.findByPk(jobId);
    if (!job) {
      // Sinon comme PublishJob
      job = await PublishJob.findByPk(jobId);
    }
  }

  if (!job) {
    logger.warn(`[Scheduler] Job ${jobId} introuvable`);
    return { run: null, alreadyRunning: false };
  }

  RUNNING.add(key);
  try {
    job.status = 'running';
    job.lastRun = new Date();
    await job.save();

    const jobType = getJobType(job);
    let run = null;

    if (jobType === 'pdf-export') {
      run = await pdfExportSchedulerService.startRun(job);
    } else {
      run = await apsPublishService.startRun(job);
    }

    runJob(jobId, job, { run, skipBegin: true }).catch((e) =>
      logger.error(`[Scheduler] runJobNow error: ${e.message}`)
    );

    return { run, alreadyRunning: false };
  } catch (e) {
    RUNNING.delete(key);
    logger.error(`[Scheduler] runJobNow error: ${e.message}`);
    throw e;
  }
}

async function init() {
  // Crash safety pour PublishRun
  try {
    const hangingPublish = await PublishRun.findAll({ where: { status: 'running' } });
    for (const r of hangingPublish) {
      r.status = 'failed';
      r.message = 'Process restart while running';
      r.endedAt = new Date();
      await r.save();
    }
    if (hangingPublish.length) {
      logger.warn(
        `[Scheduler] ${hangingPublish.length} PublishRun(s) marqués failed (crash) au démarrage`
      );
    }
  } catch (e) {
    logger.error(`[Scheduler] Crash-safety PublishRun error: ${e.message}`);
  }

  // Crash safety pour PDFExportRun
  try {
    const hangingPDF = await PDFExportRun.findAll({ where: { status: 'running' } });
    for (const r of hangingPDF) {
      r.status = 'failed';
      r.message = 'Process restart while running';
      r.endedAt = new Date();
      await r.save();
    }
    if (hangingPDF.length) {
      logger.warn(
        `[Scheduler] ${hangingPDF.length} PDFExportRun(s) marqués failed (crash) au démarrage`
      );
    }
  } catch (e) {
    logger.error(`[Scheduler] Crash-safety PDFExportRun error: ${e.message}`);
  }

  // Au boot: planifie tous les jobs actifs (Publish + PDF Export)
  try {
    const publishJobs = await PublishJob.findAll({
      where: { scheduleEnabled: true },
      order: [['createdAt', 'ASC']],
    });
    for (const j of publishJobs) scheduleJob(j);
    logger.info(`[Scheduler] ${publishJobs.length} PublishJob(s) planifié(s) au démarrage`);
  } catch (e) {
    logger.error(`[Scheduler] Erreur init PublishJobs: ${e.message}`);
  }

  try {
    const pdfJobs = await PDFExportJob.findAll({
      where: { scheduleEnabled: true },
      order: [['createdAt', 'ASC']],
    });
    for (const j of pdfJobs) scheduleJob(j);
    logger.info(`[Scheduler] ${pdfJobs.length} PDFExportJob(s) planifié(s) au démarrage`);
  } catch (e) {
    logger.error(`[Scheduler] Erreur init PDFExportJobs: ${e.message}`);
  }
}

/**
 * Envoie un email de notification si la tâche a échoué et que les notifications sont activées
 */
async function sendFailureEmailIfNeeded(job, run, jobType) {
  try {
    // Vérifier si les notifications sont activées pour cet échec
    if (!job.notifyOnFailure) {
      logger.debug(`[Scheduler] Notifications désactivées pour job ${job.id}`);
      return;
    }

    // Récupérer les destinataires
    let recipients = [];
    
    // Si des destinataires sont spécifiés dans le job, les utiliser
    if (job.notificationRecipients && Array.isArray(job.notificationRecipients) && job.notificationRecipients.length > 0) {
      recipients = job.notificationRecipients.filter(email => email && typeof email === 'string');
    }
    
    // Sinon, utiliser l'email de l'utilisateur propriétaire du job
    if (recipients.length === 0 && job.userId) {
      const user = await User.findByPk(job.userId);
      if (user && user.email) {
        recipients = [user.email];
      }
    }

    if (recipients.length === 0) {
      logger.warn(`[Scheduler] Aucun destinataire trouvé pour notification job ${job.id}`);
      return;
    }

    // Préparer les détails du job selon le type
    const jobDetails = {
      projectName: job.projectName || 'N/A',
      hubName: job.hubName || 'N/A',
    };

    if (jobType === 'pdf-export') {
      jobDetails.fileName = job.fileName || job.fileUrn || 'N/A';
      jobDetails.fileUrn = job.fileUrn;
    }

    // Préparer les détails du run
    const runDetails = {
      stats: run.stats || {},
      results: run.results || [],
      items: run.items || [],
    };

    // Envoyer l'email
    await emailService.sendFailureNotification({
      jobName: job.name || 'Tâche sans nom',
      jobType: jobType,
      jobId: job.id,
      runId: run.id,
      errorMessage: run.message || 'Erreur inconnue',
      runDetails,
      recipients,
      jobDetails,
    });
  } catch (error) {
    logger.error(`[Scheduler] Erreur envoi notification email: ${error.message}`);
  }
}

module.exports = {
  init,
  scheduleJob,
  unscheduleJob,
  runJobNow,
};
