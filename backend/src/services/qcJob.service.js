// src/services/qcJob.service.js
// CRUD des tâches QC planifiables (qc.jobs) — étape B1.
//
// B2.2 : scheduleEnabled branché sur scheduler.initQcSchedule / scheduleJob
// (exécution async fire-and-forget, sans lock projet). Run now : POST /api/qc/jobs/:id/run.
//
// ⚠️ Modèles qc chargés PARESSEUSEMENT (jamais avant sequelize.sync()) — voir getModels().
//
// Clé projectId : toujours le format PRÉFIXÉ "b.<guid>" (même convention que
// qc.project_config / PublishJob). accProjectGuid nu peut être stocké EN PLUS.

const cron = require('node-cron');
const logger = require('../config/logger');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID_PREFIXED_RE = /^b\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_URN_PATTERNS = [
  /^urn:adsk\.wip[a-z0-9]+:dm\.lineage:[A-Za-z0-9_-]+$/i,
  /^urn:adsk\.wip[a-z0-9]+:fs\.file:vf\.[A-Za-z0-9_-]+/i,
];

let KNOWN_TZ = null;
try {
  if (typeof Intl.supportedValuesOf === 'function') {
    KNOWN_TZ = new Set(Intl.supportedValuesOf('timeZone') || []);
  }
} catch (_) {}

function validTz(tz) {
  if (!tz) return false;
  // UTC/GMT souvent absents de Intl.supportedValuesOf('timeZone') selon la plateforme
  if (tz === 'UTC' || tz === 'GMT' || tz === 'Etc/UTC' || tz === 'Etc/GMT') return true;
  if (KNOWN_TZ) return KNOWN_TZ.has(tz);
  return /^[A-Za-z]+\/[A-Za-z_\-/]+$/.test(tz);
}

function validUrn(u) {
  const value = String(u || '').trim();
  if (!value) return false;
  return VALID_URN_PATTERNS.some((pattern) => pattern.test(value));
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

class QcJobService {
  getModels() {
    return require('../models/qc');
  }

  /**
   * Normalise le corps de requête vers les colonnes qc.jobs.
   * projectId doit rester préfixé b.<guid> ; guid nu refusé (pas de conversion silencieuse
   * en clé projectId — on peut seulement remplir accProjectGuid en plus).
   */
  normalizeInput(body = {}, { partial = false } = {}) {
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

    if (!partial || has('name')) {
      out.name = String(body.name || '').trim() || 'Contrôle qualité';
    }
    if (!partial || has('hubId')) {
      out.hubId = body.hubId == null || body.hubId === '' ? null : String(body.hubId).trim();
    }
    if (!partial || has('hubName')) {
      // hubName n'existe pas en colonne — ignoré volontairement (pas de migration B1)
    }
    if (!partial || has('projectId')) {
      out.projectId = String(body.projectId || '').trim();
    }
    if (!partial || has('projectName')) {
      out.projectName =
        body.projectName == null || body.projectName === ''
          ? null
          : String(body.projectName).trim();
    }
    if (!partial || has('region')) {
      out.region =
        body.region == null || body.region === '' ? null : String(body.region).trim().toUpperCase();
    }
    if (!partial || has('accProjectGuid')) {
      const raw = body.accProjectGuid;
      out.accProjectGuid =
        raw == null || raw === '' ? null : String(raw).trim().toLowerCase();
    }
    if (!partial || has('accModelGuid')) {
      const raw = body.accModelGuid;
      out.accModelGuid =
        raw == null || raw === '' ? null : String(raw).trim().toLowerCase();
    }
    // Cible modèle unique (schéma qc.jobs) — accepte modelUrn ou itemUrn alias
    if (!partial || has('modelUrn') || has('itemUrn')) {
      const urn = body.modelUrn != null ? body.modelUrn : body.itemUrn;
      out.modelUrn = urn == null || urn === '' ? null : String(urn).trim();
    }
    if (!partial || has('modelName') || has('fileName')) {
      const nm = body.modelName != null ? body.modelName : body.fileName;
      out.modelName = nm == null || nm === '' ? null : String(nm).trim();
    }
    if (!partial || has('scheduleEnabled')) {
      // Défaut B1 / schéma : false (contrairement à Publish qui défaut true)
      out.scheduleEnabled = body.scheduleEnabled === true || body.scheduleEnabled === 'true';
    }
    if (!partial || has('cronExpression')) {
      if (body.cronExpression == null || body.cronExpression === '') {
        out.cronExpression = null;
      } else {
        out.cronExpression = String(body.cronExpression).trim();
      }
    }
    if (!partial || has('timezone')) {
      out.timezone = String(body.timezone || 'UTC').trim() || 'UTC';
    }

    // Si projectId préfixé fourni et pas d'accProjectGuid, dériver le guid nu EN PLUS
    if (out.projectId && PROJECT_ID_PREFIXED_RE.test(out.projectId)) {
      if (!partial || has('projectId')) {
        if (out.accProjectGuid == null && (!partial || !has('accProjectGuid'))) {
          out.accProjectGuid = out.projectId.slice(2).toLowerCase();
        }
      }
    }

    return out;
  }

  /**
   * @param {object} p - payload normalisé
   * @param {{ partial?: boolean }} opts
   * @returns {string|null} message d'erreur ou null si OK
   */
  validatePayload(p, { partial = false } = {}) {
    if (!partial || p.projectId !== undefined) {
      if (!p.projectId) return 'projectId requis';
      if (!PROJECT_ID_PREFIXED_RE.test(p.projectId)) {
        return 'projectId invalide : attendu format préfixé b.<guid> (ex. b.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)';
      }
    }

    if (p.accProjectGuid != null && p.accProjectGuid !== undefined) {
      if (!GUID_RE.test(p.accProjectGuid)) return 'accProjectGuid invalide (UUID nu attendu)';
    }
    if (p.accModelGuid != null && p.accModelGuid !== undefined) {
      if (!GUID_RE.test(p.accModelGuid)) return 'accModelGuid invalide (UUID nu attendu)';
    }

    if (!partial || p.modelUrn !== undefined) {
      if (!p.modelUrn) return 'modelUrn requis (URN lineage du modèle à contrôler)';
      if (!validUrn(p.modelUrn)) return `modelUrn invalide: ${p.modelUrn}`;
    }

    if (!partial || p.timezone !== undefined) {
      if (!validTz(p.timezone)) return 'timezone invalide';
    }

    if (!partial || p.cronExpression !== undefined || p.scheduleEnabled !== undefined) {
      const enabled = p.scheduleEnabled === true;
      const expr = p.cronExpression;
      if (enabled) {
        if (!expr) return 'cronExpression requis lorsque scheduleEnabled=true';
        if (!cron.validate(expr)) return 'cronExpression invalide';
      } else if (expr != null && expr !== '') {
        if (!cron.validate(expr)) return 'cronExpression invalide';
      }
    }

    if (p.region != null && p.region !== '') {
      if (!['US', 'EMEA', 'CAN', 'AUS', 'APAC', 'FED'].includes(p.region)) {
        // Souple : regions connues + laisser passer codes courts
        if (!/^[A-Z]{2,8}$/.test(p.region)) return 'region invalide';
      }
    }

    return null;
  }

  serializeJob(job) {
    const data = typeof job.toJSON === 'function' ? job.toJSON() : { ...job };
    const user = data.user;
    return {
      ...data,
      userName: user?.name || user?.email || 'Utilisateur inconnu',
      // B2.2 : le scheduler planifie les QCJob scheduleEnabled (async, sans lock projet)
      schedulingActive: data.scheduleEnabled === true,
      schedulingNote: data.scheduleEnabled
        ? 'Planification active (soumission DA async ; finalisation via callback/poll).'
        : 'Planification inactive (scheduleEnabled=false).',
    };
  }

  _scheduler() {
    return require('./scheduler.service');
  }

  async _applySchedule(job) {
    const scheduler = this._scheduler();
    if (job.scheduleEnabled) await scheduler.scheduleJob(job);
    else scheduler.unscheduleJob(job.id);
  }

  async createJob(userId, body) {
    const { QCJob } = this.getModels();
    const payload = this.normalizeInput(body, { partial: false });
    // Défauts création
    if (body.scheduleEnabled === undefined) payload.scheduleEnabled = false;
    if (!payload.timezone) payload.timezone = 'UTC';

    const err = this.validatePayload(payload, { partial: false });
    if (err) throw httpError(400, err);

    const job = await QCJob.create({
      userId,
      name: payload.name,
      hubId: payload.hubId,
      projectId: payload.projectId,
      projectName: payload.projectName,
      region: payload.region,
      accProjectGuid: payload.accProjectGuid,
      accModelGuid: payload.accModelGuid,
      modelUrn: payload.modelUrn,
      modelName: payload.modelName,
      scheduleEnabled: payload.scheduleEnabled === true,
      cronExpression: payload.cronExpression,
      timezone: payload.timezone || 'UTC',
      status: 'idle',
    });

    await this._applySchedule(job);
    logger.info(
      `[QC][Jobs] Créé id=${job.id} projectId=${job.projectId} scheduleEnabled=${job.scheduleEnabled}`
    );
    return this.getJobById(job.id);
  }

  async listJobs({ projectId, active } = {}) {
    const { QCJob } = this.getModels();
    const User = require('../models/User');
    const where = {};
    if (projectId) {
      const pid = String(projectId).trim();
      if (!PROJECT_ID_PREFIXED_RE.test(pid)) {
        throw httpError(400, 'projectId filtre invalide : attendu b.<guid>');
      }
      where.projectId = pid;
    }
    if (active !== undefined && active !== null && String(active).length) {
      where.scheduleEnabled = String(active).toLowerCase() === 'true';
    }

    const jobs = await QCJob.findAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    return jobs.map((j) => this.serializeJob(j));
  }

  async getJobById(id) {
    const { QCJob } = this.getModels();
    const User = require('../models/User');
    const job = await QCJob.findByPk(id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
    });
    if (!job) throw httpError(404, 'Tâche QC introuvable');
    return this.serializeJob(job);
  }

  async updateJob(id, body) {
    const { QCJob } = this.getModels();
    const job = await QCJob.findByPk(id);
    if (!job) throw httpError(404, 'Tâche QC introuvable');

    const patch = this.normalizeInput(body, { partial: true });
    // Pour validation cron/schedule, fusionner avec l'existant
    const merged = {
      projectId: patch.projectId !== undefined ? patch.projectId : job.projectId,
      modelUrn: patch.modelUrn !== undefined ? patch.modelUrn : job.modelUrn,
      timezone: patch.timezone !== undefined ? patch.timezone : job.timezone,
      cronExpression:
        patch.cronExpression !== undefined ? patch.cronExpression : job.cronExpression,
      scheduleEnabled:
        patch.scheduleEnabled !== undefined ? patch.scheduleEnabled : job.scheduleEnabled,
      accProjectGuid:
        patch.accProjectGuid !== undefined ? patch.accProjectGuid : job.accProjectGuid,
      accModelGuid: patch.accModelGuid !== undefined ? patch.accModelGuid : job.accModelGuid,
      region: patch.region !== undefined ? patch.region : job.region,
    };
    const err = this.validatePayload(merged, { partial: false });
    if (err) throw httpError(400, err);

    const fields = [
      'name',
      'hubId',
      'projectId',
      'projectName',
      'region',
      'accProjectGuid',
      'accModelGuid',
      'modelUrn',
      'modelName',
      'scheduleEnabled',
      'cronExpression',
      'timezone',
    ];
    for (const f of fields) {
      if (patch[f] !== undefined) job[f] = patch[f];
    }

    // Si projectId mis à jour sans accProjectGuid explicite, dériver
    if (patch.projectId && PROJECT_ID_PREFIXED_RE.test(patch.projectId) && patch.accProjectGuid === undefined) {
      job.accProjectGuid = patch.projectId.slice(2).toLowerCase();
    }

    await job.save();
    await this._applySchedule(job);
    logger.info(
      `[QC][Jobs] Modifié id=${job.id} scheduleEnabled=${job.scheduleEnabled}`
    );
    return this.getJobById(job.id);
  }

  async deleteJob(id) {
    const { QCJob } = this.getModels();
    const job = await QCJob.findByPk(id);
    if (!job) throw httpError(404, 'Tâche QC introuvable');
    try {
      this._scheduler().unscheduleJob(job.id);
    } catch (_) {}
    await job.destroy();
    logger.info(`[QC][Jobs] Supprimé id=${id}`);
    return true;
  }

  /**
   * Run Now — délègue au scheduler (branche QC async, sans lock projet).
   */
  async runJobNow(id) {
    const { QCJob } = this.getModels();
    const job = await QCJob.findByPk(id);
    if (!job) throw httpError(404, 'Tâche QC introuvable');
    const { run, alreadyRunning, projectBusy } = await this._scheduler().runJobNow(job.id, { job });
    if (alreadyRunning) {
      const err = httpError(409, 'Cette tâche QC est déjà en cours');
      throw err;
    }
    if (projectBusy) {
      // Ne devrait pas arriver pour QC (pas de lock projet) — garde défensive
      throw httpError(503, 'Projet occupé');
    }
    return run;
  }
}

module.exports = new QcJobService();
