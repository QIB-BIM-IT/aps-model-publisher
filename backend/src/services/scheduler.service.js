// src/services/scheduler.service.js
// Planifie et exécute les jobs (Publish + PDF Export), avec protections :
// - pas d'exécutions concurrentes pour un même job
// - "crash safety" : marque les runs "running" comme "failed" au démarrage
// - logs explicites

const cron = require('node-cron');
const cronParser = require('cron-parser');
const logger = require('../config/logger');
const { PublishJob, PublishRun, PDFExportJob, PDFExportRun, CopyJob, CopyRun, User } = require('../models');
const apsPublishService = require('./apsPublish.service');
const pdfExportSchedulerService = require('./pdfExportScheduler.service');
const fileCopyService = require('./fileCopy.service');
const emailService = require('./email.service');

// Map<jobId, CronTask>
const TASKS = new Map();
// Set<jobId> des jobs en cours d'exécution pour éviter les overlaps
const RUNNING = new Set();
// 🆕 Set<projectId> des projets en cours d'exécution pour éviter les conflits d'accès concurrent
const RUNNING_PROJECTS = new Set();
// 🆕 File d'attente par projet: Map<projectId, Array<{jobId, resolve, reject}>>
const PROJECT_QUEUES = new Map();
// 🆕 Délai d'attente entre les tentatives de lock projet (ms)
const PROJECT_LOCK_RETRY_DELAY = 3000;
const PROJECT_LOCK_MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes max d'attente dans la file

/**
 * Calcule la prochaine exécution d'une expression cron avec timezone
 * @param {string} cronExpression - Expression cron (5 champs)
 * @param {string} timezone - Timezone (ex: 'America/Montreal', 'UTC')
 * @returns {Date|null} - Date de la prochaine exécution ou null si erreur
 */
function calculateNextRun(cronExpression, timezone = 'UTC') {
  try {
    const interval = cronParser.parse(cronExpression, {
      tz: timezone,
      currentDate: new Date(),
    });
    return interval.next().toDate();
  } catch (e) {
    logger.warn(`[Scheduler] Impossible de calculer nextRun pour "${cronExpression}" (tz=${timezone}): ${e.message}`);
    return null;
  }
}

/**
 * Met à jour le champ nextRun d'un job
 */
async function updateJobNextRun(job) {
  if (!job || !job.scheduleEnabled) return;
  
  try {
    const nextRun = calculateNextRun(job.cronExpression, job.timezone || 'UTC');
    if (nextRun) {
      job.nextRun = nextRun;
      await job.save();
      logger.debug(`[Scheduler] nextRun mis à jour pour job ${job.id}: ${nextRun.toISOString()}`);
    }
  } catch (e) {
    logger.warn(`[Scheduler] Erreur mise à jour nextRun pour job ${job.id}: ${e.message}`);
  }
}

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

async function scheduleJob(job) {
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
    
    // 🆕 Calculer et sauvegarder nextRun
    await updateJobNextRun(job);
    
    logger.info(`[Scheduler] Job ${job.id} planifié (${job.cronExpression} ${job.timezone}) - nextRun: ${job.nextRun?.toISOString() || 'N/A'}`);
  } catch (e) {
    logger.error(`[Scheduler] Impossible de planifier job ${job.id}: ${e.message}`);
  }
}

/**
 * Détermine le type de job (publish ou pdf-export)
 */
function getJobType(job) {
  if (job.constructor.name === 'CopyJob') return 'file-copy';
  if (job.constructor.name === 'PDFExportJob') return 'pdf-export';
  if (job.constructor.name === 'PublishJob') return 'publish';
  if (job.destinationFolderId && job.files) return 'file-copy';
  if (job.fileUrn && job.selectionMode) return 'pdf-export';
  if (job.models && Array.isArray(job.models)) return 'publish';
  return null;
}

/**
 * 🆕 Tente d'acquérir un lock sur un projet avec système de file d'attente
 * Si le projet est occupé, le job attend son tour dans la file
 * @param {string} projectId - ID du projet
 * @param {string} jobId - ID du job (pour les logs)
 * @returns {Promise<boolean>} - true si lock acquis, false si timeout
 */
async function acquireProjectLock(projectId, jobId = 'unknown') {
  // Si le projet n'est pas occupé, acquérir le lock immédiatement
  if (!RUNNING_PROJECTS.has(projectId)) {
    RUNNING_PROJECTS.add(projectId);
    logger.debug(`[Scheduler] Lock projet acquis immédiatement: ${projectId} (job=${jobId})`);
    return true;
  }
  
  // Sinon, ajouter à la file d'attente et attendre
  logger.info(`[Scheduler] 📋 Job ${jobId} ajouté à la file d'attente pour projet ${projectId}`);
  
  // Initialiser la file si nécessaire
  if (!PROJECT_QUEUES.has(projectId)) {
    PROJECT_QUEUES.set(projectId, []);
  }
  const queue = PROJECT_QUEUES.get(projectId);
  
  // Compter la position dans la file
  const position = queue.length + 1;
  logger.info(`[Scheduler] 📋 Position dans la file: ${position} (projet=${projectId})`);
  
  // Créer une promesse qui sera résolue quand ce sera notre tour
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const queueEntry = {
      jobId,
      resolve: (success) => {
        // Retirer de la file
        const idx = queue.indexOf(queueEntry);
        if (idx !== -1) queue.splice(idx, 1);
        resolve(success);
      },
      startTime,
    };
    
    queue.push(queueEntry);
    
    // Timeout de sécurité
    const timeoutId = setTimeout(() => {
      logger.warn(`[Scheduler] ⏱️ Timeout file d'attente pour job ${jobId} (projet=${projectId})`);
      queueEntry.resolve(false);
    }, PROJECT_LOCK_MAX_WAIT_MS);
    
    // Modifier resolve pour annuler le timeout
    const originalResolve = queueEntry.resolve;
    queueEntry.resolve = (success) => {
      clearTimeout(timeoutId);
      originalResolve(success);
    };
  });
}

/**
 * 🆕 Libère le lock d'un projet et passe au job suivant dans la file
 */
function releaseProjectLock(projectId) {
  RUNNING_PROJECTS.delete(projectId);
  logger.debug(`[Scheduler] Lock projet libéré: ${projectId}`);
  
  // Vérifier s'il y a des jobs en attente
  const queue = PROJECT_QUEUES.get(projectId);
  if (queue && queue.length > 0) {
    const nextEntry = queue[0];
    logger.info(`[Scheduler] 📋 Passage au job suivant dans la file: ${nextEntry.jobId} (projet=${projectId}, attente=${Math.round((Date.now() - nextEntry.startTime) / 1000)}s)`);
    
    // Acquérir le lock pour le prochain job
    RUNNING_PROJECTS.add(projectId);
    nextEntry.resolve(true);
  }
}

/**
 * 🆕 Retourne le nombre de jobs en attente pour un projet
 */
function getQueueLength(projectId) {
  const queue = PROJECT_QUEUES.get(projectId);
  return queue ? queue.length : 0;
}

async function runJob(jobId, jobInstance = null, options = {}) {
  const key = String(jobId);
  const skipBegin = options.skipBegin === true;
  let job = jobInstance || options.job || null;
  let run = options.run || null;
  let jobType = null;
  let projectId = null;
  let hasProjectLock = false;

  if (!skipBegin) {
    if (RUNNING.has(key)) {
      logger.warn(`[Scheduler] Job ${jobId} déjà en cours, on ignore ce tick`);
      return null;
    }

    RUNNING.add(key);
    try {
      // Chercher dans tous les types de job
      job = await PDFExportJob.findByPk(jobId);
      if (!job) job = await CopyJob.findByPk(jobId);
      if (!job) job = await PublishJob.findByPk(jobId);

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
      
      // 🆕 Acquérir un lock sur le projet pour éviter les accès concurrents
      projectId = job.projectId;
      const queueStartTime = Date.now(); // 🆕 Temps où le job entre dans la file
      if (projectId) {
        // 🆕 Le job attend son tour dans la file d'attente si le projet est occupé
        hasProjectLock = await acquireProjectLock(projectId, jobId);
        if (!hasProjectLock) {
          logger.warn(`[Scheduler] Job ${jobId} timeout: a attendu trop longtemps dans la file d'attente`);
          RUNNING.delete(key);
          return null;
        }
      }
      const queueEndTime = Date.now(); // 🆕 Temps où le job sort de la file (lock acquis)
      const queueWaitMs = queueEndTime - queueStartTime;

      logger.info(`[Scheduler] Exécution job ${jobId} (type=${jobType}, project=${projectId}, queueWait=${queueWaitMs}ms)`);

      job.status = 'running';
      job.lastRun = new Date();
      await job.save();

      // 🆕 Pour les jobs schedulés, capturer le moment prévu d'exécution
      const scheduledStartTime = job.nextRun ? new Date(job.nextRun) : null;

      // Créer le run selon le type
      if (jobType === 'file-copy') {
        run = await fileCopyService.startRun(job);
      } else if (jobType === 'pdf-export') {
        run = await pdfExportSchedulerService.startRun(job);
      } else {
        run = await apsPublishService.startRun(job);
      }
      
      // 🆕 Stocker les métriques de file d'attente et timing dans le run
      if (run) {
        run.stats = {
          ...(run.stats || {}),
          queueWaitMs: queueWaitMs > 0 ? queueWaitMs : 0,
        };
        
        if (queueWaitMs > 0) {
          run.stats.queueStartTime = new Date(queueStartTime).toISOString();
          run.stats.queueEndTime = new Date(queueEndTime).toISOString();
        }
        
        if (scheduledStartTime) {
          run.stats.scheduledStartTime = scheduledStartTime.toISOString();
        }
        
        await run.save();
      }
    } catch (e) {
      RUNNING.delete(key);
      if (hasProjectLock && projectId) releaseProjectLock(projectId);
      logger.error(`[Scheduler] Erreur initialisation job ${jobId}: ${e.message}`);
      throw e;
    }
  } else {
    if (!job || !run) {
      logger.error(`[Scheduler] runJob skipBegin sans job/run pour ${jobId}`);
      return null;
    }
    jobType = getJobType(job);
    projectId = job.projectId;
    // Pour skipBegin, on suppose que le lock projet a déjà été acquis
    hasProjectLock = projectId ? RUNNING_PROJECTS.has(projectId) : false;
    if (!RUNNING.has(key)) {
      RUNNING.add(key);
    }
  }

  try {
    let summary = null;

    // Exécuter selon le type
    if (jobType === 'file-copy') {
      summary = await fileCopyService.executeRun(run);
    } else if (jobType === 'pdf-export') {
      summary = await pdfExportSchedulerService.executeRun(run);
    } else {
      summary = await apsPublishService.executeRun(run);
    }

    // Finaliser selon le type
    let finishedRun = null;
    if (jobType === 'file-copy') {
      finishedRun = await fileCopyService.finishRun(run, summary);
    } else if (jobType === 'pdf-export') {
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
    
    // 🆕 Mettre à jour nextRun pour la prochaine exécution
    if (job.scheduleEnabled) {
      const nextRun = calculateNextRun(job.cronExpression, job.timezone || 'UTC');
      if (nextRun) {
        job.nextRun = nextRun;
      }
    }
    
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

        if (jobType === 'file-copy') {
          failedRun = await fileCopyService.finishRun(run, finishOptions);
        } else if (jobType === 'pdf-export') {
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
    // 🆕 Libérer le lock projet
    if (hasProjectLock && projectId) {
      releaseProjectLock(projectId);
    }
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
    job = await PDFExportJob.findByPk(jobId);
    if (!job) job = await CopyJob.findByPk(jobId);
    if (!job) job = await PublishJob.findByPk(jobId);
  }

  if (!job) {
    logger.warn(`[Scheduler] Job ${jobId} introuvable`);
    return { run: null, alreadyRunning: false };
  }

  // 🆕 Acquérir le lock projet avec file d'attente
  const projectId = job.projectId;
  let hasProjectLock = false;
  if (projectId) {
    const queueLength = getQueueLength(projectId);
    if (queueLength > 0 || RUNNING_PROJECTS.has(projectId)) {
      logger.info(`[Scheduler] runJobNow: job ${jobId} attend son tour (${queueLength} job(s) en attente)`);
    }
    hasProjectLock = await acquireProjectLock(projectId, jobId);
    if (!hasProjectLock) {
      logger.warn(`[Scheduler] runJobNow: timeout, projet ${projectId} occupé trop longtemps`);
      return { run: null, alreadyRunning: false, projectBusy: true };
    }
  }

  RUNNING.add(key);
  try {
    job.status = 'running';
    job.lastRun = new Date();
    await job.save();

    const jobType = getJobType(job);
    let run = null;

    if (jobType === 'file-copy') {
      run = await fileCopyService.startRun(job);
    } else if (jobType === 'pdf-export') {
      run = await pdfExportSchedulerService.startRun(job);
    } else {
      run = await apsPublishService.startRun(job);
    }

    // Note: le lock projet sera libéré dans runJob via le finally block
    runJob(jobId, job, { run, skipBegin: true }).catch((e) =>
      logger.error(`[Scheduler] runJobNow error: ${e.message}`)
    );

    return { run, alreadyRunning: false };
  } catch (e) {
    RUNNING.delete(key);
    if (hasProjectLock && projectId) releaseProjectLock(projectId);
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

  // Crash safety pour CopyRun
  try {
    const hangingCopy = await CopyRun.findAll({ where: { status: 'running' } });
    for (const r of hangingCopy) {
      r.status = 'failed';
      r.message = 'Process restart while running';
      r.endedAt = new Date();
      await r.save();
    }
    if (hangingCopy.length) {
      logger.warn(`[Scheduler] ${hangingCopy.length} CopyRun(s) marqués failed (crash) au démarrage`);
    }
  } catch (e) {
    logger.error(`[Scheduler] Crash-safety CopyRun error: ${e.message}`);
  }

  // Au boot: planifie tous les jobs actifs (Publish + PDF Export + Copy)
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

  try {
    const copyJobs = await CopyJob.findAll({
      where: { scheduleEnabled: true },
      order: [['createdAt', 'ASC']],
    });
    for (const j of copyJobs) scheduleJob(j);
    logger.info(`[Scheduler] ${copyJobs.length} CopyJob(s) planifié(s) au démarrage`);
  } catch (e) {
    logger.error(`[Scheduler] Erreur init CopyJobs: ${e.message}`);
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
  calculateNextRun,  // 🆕 Exporté pour les routes
};
