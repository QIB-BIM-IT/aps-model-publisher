// src/services/scheduler.service.js
// Planifie et exécute les jobs (Publish + PDF Export), avec protections :
// - pas d'exécutions concurrentes pour un même job
// - "crash safety" : marque les runs "running" comme "failed" au démarrage
// - logs explicites

const cron = require('node-cron');
const cronParser = require('cron-parser');
const { Op } = require('sequelize');
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
        // Recalculer nextRun même en cas d'échec (sinon l'heure affichée reste figée dans le passé)
        if (job.scheduleEnabled) {
          const nextRun = calculateNextRun(job.cronExpression, job.timezone || 'UTC');
          if (nextRun) job.nextRun = nextRun;
        }
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

  // Crash safety pour les JOBS : un job resté en 'running' après un redémarrage
  // est forcément orphelin (aucune exécution en mémoire après reboot). On le
  // réinitialise à 'idle' pour qu'il ne reste pas bloqué à l'affichage et qu'il
  // puisse être replanifié normalement.
  try {
    const jobModels = [
      { Model: PublishJob, label: 'PublishJob' },
      { Model: PDFExportJob, label: 'PDFExportJob' },
      { Model: CopyJob, label: 'CopyJob' },
    ];
    for (const { Model, label } of jobModels) {
      const stuckJobs = await Model.findAll({ where: { status: 'running' } });
      for (const j of stuckJobs) {
        j.status = 'idle';
        j.history = [
          ...(j.history || []),
          { at: new Date(), status: 'recovered', message: 'Statut "running" orphelin réinitialisé après redémarrage serveur' },
        ];
        await j.save();
      }
      if (stuckJobs.length) {
        logger.warn(`[Scheduler] ${stuckJobs.length} ${label}(s) 'running' orphelin(s) réinitialisé(s) à 'idle' au démarrage`);
      }
    }
  } catch (e) {
    logger.error(`[Scheduler] Crash-safety jobs error: ${e.message}`);
  }

  // 🆕 Détecter les créneaux planifiés MANQUÉS pendant un downtime (déploiement,
  // changement de variable d'env, crash...). node-cron ne rattrape jamais une
  // occurrence ratée. On lit nextRun AVANT de replanifier (scheduleJob le
  // recalcule vers le futur), et on relancera les jobs dont le créneau est
  // dépassé mais encore dans la fenêtre de grâce.
  const missedJobIds = [];
  try {
    const graceMin = Math.max(1, parseFloat(process.env.MISSED_RUN_GRACE_MIN || '120') || 120);
    const graceMs = graceMin * 60 * 1000;
    const now = Date.now();
    const jobModels = [PublishJob, PDFExportJob, CopyJob];
    for (const Model of jobModels) {
      let jobs = [];
      try {
        jobs = await Model.findAll({ where: { scheduleEnabled: true } });
      } catch { continue; }
      for (const job of jobs) {
        if (!job.nextRun) continue;
        const next = new Date(job.nextRun).getTime();
        if (next >= now) continue;             // créneau dans le futur → pas manqué
        if ((now - next) > graceMs) continue;  // trop ancien → on ignore (pas de rattrapage massif)
        const last = job.lastRun ? new Date(job.lastRun).getTime() : 0;
        if (last >= next) continue;            // déjà exécuté pour ce créneau
        missedJobIds.push(job.id);
      }
    }
    if (missedJobIds.length) {
      logger.warn(`[Scheduler] ${missedJobIds.length} créneau(x) planifié(s) manqué(s) détecté(s) (grâce ${graceMin} min) — rattrapage au démarrage`);
    }
  } catch (e) {
    logger.error(`[Scheduler] Erreur détection créneaux manqués: ${e.message}`);
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

  // Démarrer la surveillance des tâches bloquées / trop longues
  startStuckWatchdog();

  // 🆕 Rattrapage des créneaux manqués, échelonné (5s entre chaque) pour éviter
  // une rafale d'exécutions simultanées au démarrage. Le lock projet sérialise
  // déjà les jobs d'un même projet.
  if (missedJobIds.length) {
    missedJobIds.forEach((jobId, i) => {
      setTimeout(() => {
        logger.info(`[Scheduler] Rattrapage du créneau manqué pour job ${jobId}`);
        runJobNow(jobId).catch((e) => logger.error(`[Scheduler] Rattrapage job ${jobId} échec: ${e.message}`));
      }, i * 5000);
    });
  }
}

/**
 * Envoie un email d'alerte (échec ou tâche bloquée) au propriétaire de la tâche.
 * Gating "niveau A" : on envoie par défaut, sauf si le propriétaire a désactivé
 * la préférence globale `preferences.notificationEmail`.
 * @param {'failed'|'stuck'} reason
 */
async function sendFailureEmailIfNeeded(job, run, jobType, reason = 'failed') {
  try {
    if (!emailService.isEnabled()) return; // service ACS non configuré → on ne fait rien

    // Récupérer le propriétaire de la tâche
    let owner = null;
    if (job.userId) {
      try { owner = await User.findByPk(job.userId); } catch {}
    }

    // Préférence globale du propriétaire (défaut: activé)
    const ownerOptedOut = owner && owner.preferences && owner.preferences.notificationEmail === false;
    if (ownerOptedOut) {
      logger.debug(`[Scheduler] Notifications email désactivées par le propriétaire (job ${job.id})`);
      return;
    }

    // Destinataires : override explicite par tâche, sinon l'email du propriétaire
    let recipients = [];
    if (Array.isArray(job.notificationRecipients) && job.notificationRecipients.length > 0) {
      recipients = job.notificationRecipients.filter((email) => email && typeof email === 'string');
    } else if (owner && owner.email) {
      recipients = [owner.email];
    }

    if (recipients.length === 0) {
      logger.warn(`[Scheduler] Aucun destinataire trouvé pour notification job ${job.id}`);
      return;
    }

    const jobDetails = {
      projectName: job.projectName || 'N/A',
      hubName: job.hubName || 'N/A',
    };
    if (jobType === 'pdf-export') {
      jobDetails.fileName = job.fileName || job.fileUrn || 'N/A';
    }

    await emailService.sendTaskAlert({
      reason,
      jobName: job.name || 'Tâche sans nom',
      jobType,
      jobId: job.id,
      runId: run?.id,
      errorMessage: run?.message || (reason === 'stuck' ? "Délai d'exécution dépassé." : 'Erreur inconnue'),
      occurredAt: run?.endedAt || new Date(),
      recipients,
      jobDetails,
    });
  } catch (error) {
    logger.error(`[Scheduler] Erreur envoi notification email: ${error.message}`);
  }
}

// ===== Watchdog : détection des tâches "bloquées" / trop longues =====
// Un run resté en 'running' au-delà du seuil est considéré bloqué : on le marque
// 'failed' et on envoie une alerte 'stuck' au propriétaire.
// Seuil en minutes (accepte les décimales, ex: 0.1 = 6s pour tester). Plancher 0.05 min (3s).
const STUCK_THRESHOLD_MIN = Math.max(0.05, parseFloat(process.env.STUCK_RUN_THRESHOLD_MIN || '120') || 120);
const STUCK_THRESHOLD_MS = STUCK_THRESHOLD_MIN * 60 * 1000;
// Cadence de vérification adaptée au seuil (bornée entre 10s et 5min) : un petit seuil → vérifs fréquentes.
const STUCK_CHECK_INTERVAL_MS = Math.min(5 * 60 * 1000, Math.max(10 * 1000, Math.floor(STUCK_THRESHOLD_MS / 2)));
let stuckTimer = null;

async function checkStuckRuns() {
  const now = Date.now();
  const cutoff = new Date(now - STUCK_THRESHOLD_MS);
  const configs = [
    { RunModel: PublishRun, JobModel: PublishJob, jobType: 'publish' },
    { RunModel: PDFExportRun, JobModel: PDFExportJob, jobType: 'pdf-export' },
    { RunModel: CopyRun, JobModel: CopyJob, jobType: 'file-copy' },
  ];

  for (const { RunModel, JobModel, jobType } of configs) {
    let stuckRuns = [];
    try {
      stuckRuns = await RunModel.findAll({
        where: { status: 'running', startedAt: { [Op.lt]: cutoff } },
      });
    } catch (e) {
      logger.error(`[Watchdog] Erreur recherche runs bloqués (${jobType}): ${e.message}`);
      continue;
    }

    for (const run of stuckRuns) {
      try {
        const mins = Math.round((now - new Date(run.startedAt).getTime()) / 60000);
        run.status = 'failed';
        run.endedAt = new Date();
        run.message = `Tâche bloquée : aucune fin après ${mins} min (seuil ${STUCK_THRESHOLD_MS / 60000} min). Interrompue automatiquement.`;
        await run.save();

        let job = null;
        try { job = await JobModel.findByPk(run.jobId); } catch {}
        if (job) {
          try {
            job.status = 'error';
            job.history = [
              ...(job.history || []),
              { at: new Date(), status: 'stuck', message: run.message },
            ];
            await job.save();
          } catch {}
          await sendFailureEmailIfNeeded(job, run, jobType, 'stuck');
        }
        logger.warn(`[Watchdog] Run ${run.id} (${jobType}) marqué 'failed' (bloqué ${mins} min)`);
      } catch (e) {
        logger.error(`[Watchdog] Erreur traitement run bloqué ${run?.id}: ${e.message}`);
      }
    }

    // Filet : jobs restés 'running' mais sans run actif (orphelins, ex. crash
    // entre la fin/échec du run et la mise à jour du statut du job).
    let orphanJobs = [];
    try {
      orphanJobs = await JobModel.findAll({
        where: { status: 'running', lastRun: { [Op.lt]: cutoff } },
      });
    } catch (e) {
      logger.error(`[Watchdog] Erreur recherche jobs orphelins (${jobType}): ${e.message}`);
      continue;
    }

    for (const job of orphanJobs) {
      // Ne pas toucher si la tâche tourne réellement dans ce process, ou si un run est encore actif.
      if (RUNNING.has(String(job.id))) continue;
      let activeRun = null;
      try {
        activeRun = await RunModel.findOne({ where: { jobId: job.id, status: 'running' } });
      } catch {}
      if (activeRun) continue;
      try {
        job.status = 'idle';
        job.history = [
          ...(job.history || []),
          { at: new Date(), status: 'recovered', message: "Statut 'running' orphelin réinitialisé (aucun run actif)" },
        ];
        await job.save();
        logger.warn(`[Watchdog] Job ${job.id} (${jobType}) 'running' orphelin réinitialisé à 'idle'`);
      } catch (e) {
        logger.error(`[Watchdog] Erreur réinitialisation job orphelin ${job?.id}: ${e.message}`);
      }
    }
  }
}

function startStuckWatchdog() {
  if (stuckTimer) return;
  stuckTimer = setInterval(() => {
    checkStuckRuns().catch((e) => logger.error(`[Watchdog] ${e.message}`));
  }, STUCK_CHECK_INTERVAL_MS);
  // Première vérification rapide après le démarrage
  setTimeout(() => checkStuckRuns().catch(() => {}), Math.min(60 * 1000, STUCK_CHECK_INTERVAL_MS));
  logger.info(`[Watchdog] Surveillance des tâches bloquées active (seuil ${STUCK_THRESHOLD_MIN} min, vérif ${Math.round(STUCK_CHECK_INTERVAL_MS / 1000)}s)`);
}

module.exports = {
  init,
  scheduleJob,
  unscheduleJob,
  runJobNow,
  calculateNextRun,  // 🆕 Exporté pour les routes
};
