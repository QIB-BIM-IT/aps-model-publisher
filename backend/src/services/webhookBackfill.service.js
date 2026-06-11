// src/services/webhookBackfill.service.js
// Enregistre/maintient automatiquement les webhooks pour TOUS les projets ayant
// des tâches (Publish / PDF / Copie), en arrière-plan. S'exécute au démarrage
// (différé) puis périodiquement. Idempotent et tolérant aux erreurs.
//
// Chaque cible est enregistrée sous le token de l'utilisateur PROPRIÉTAIRE de la
// tâche : cela règle naturellement les accès (un projet auquel un utilisateur n'a
// pas droit sera enregistré dès qu'un collègue ayant accès aura une tâche dessus).

const logger = require('../config/logger');
const apsAuthService = require('./apsAuth.service');
const webhookRegistrationService = require('./webhookRegistration.service');
const {
  PublishJob,
  CopyJob,
  PDFExportJob,
  WebhookRegistration,
} = require('../models');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class WebhookBackfillService {
  constructor() {
    this.intervalMs = Number(process.env.WEBHOOK_BACKFILL_INTERVAL_MS || 6 * 60 * 60 * 1000); // 6h
    this.startupDelayMs = Number(process.env.WEBHOOK_BACKFILL_STARTUP_DELAY_MS || 45 * 1000);
    this.throttleMs = Number(process.env.WEBHOOK_BACKFILL_THROTTLE_MS || 1500);
    this.running = false;
    this.timer = null;
  }

  start() {
    if (!webhookRegistrationService.isConfigured()) {
      logger.info('[WebhookBackfill] Webhooks non configurés, backfill désactivé');
      return;
    }
    setTimeout(() => {
      this.runOnce().catch((e) => logger.error(`[WebhookBackfill] Erreur passage initial: ${e.message}`));
    }, this.startupDelayMs);
    this.timer = setInterval(() => {
      this.runOnce().catch((e) => logger.error(`[WebhookBackfill] Erreur passage périodique: ${e.message}`));
    }, this.intervalMs);
    logger.info(`[WebhookBackfill] Planifié (démarrage dans ${Math.round(this.startupDelayMs / 1000)}s, puis toutes les ${Math.round(this.intervalMs / 3600000)}h)`);
  }

  /**
   * Rassemble les cibles distinctes à enregistrer.
   * - Publish : niveau projet (hubId connu).
   * - PDF     : niveau dossier (folderId).
   * - Copie   : niveau dossier destination (destinationFolderId).
   */
  async _collectTargets() {
    const byKey = new Map();
    const add = (key, target) => { if (!byKey.has(key)) byKey.set(key, target); };

    const publishJobs = await PublishJob.findAll({ attributes: ['userId', 'projectId', 'hubId'] });
    for (const j of publishJobs) {
      if (j.projectId && j.hubId && j.userId) {
        add(`project:${j.projectId}`, { kind: 'project', userId: j.userId, projectId: j.projectId, hubId: j.hubId });
      }
    }

    const pdfJobs = await PDFExportJob.findAll({ attributes: ['userId', 'projectId', 'folderId'] });
    for (const j of pdfJobs) {
      if (j.projectId && j.folderId && j.userId) {
        add(`folder:${j.folderId}`, { kind: 'folder', userId: j.userId, projectId: j.projectId, folderUrn: j.folderId, hubId: null });
      }
    }

    const copyJobs = await CopyJob.findAll({ attributes: ['userId', 'destinationProjectId', 'destinationFolderId', 'hubId'] });
    for (const j of copyJobs) {
      if (j.destinationProjectId && j.destinationFolderId && j.userId) {
        add(`folder:${j.destinationFolderId}`, { kind: 'folder', userId: j.userId, projectId: j.destinationProjectId, folderUrn: j.destinationFolderId, hubId: j.hubId || null });
      }
    }

    return [...byKey.values()];
  }

  async _alreadyRegistered(target) {
    if (target.kind === 'folder') {
      const r = await WebhookRegistration.findOne({
        where: { scopeType: 'folder', scopeValue: target.folderUrn, status: 'active' },
      });
      return !!r;
    }
    // project : on considère couvert s'il existe au moins un hook actif pour ce projet
    const r = await WebhookRegistration.findOne({
      where: { projectId: target.projectId, status: 'active' },
    });
    return !!r;
  }

  async runOnce() {
    if (this.running) {
      logger.debug('[WebhookBackfill] Passage déjà en cours, ignoré');
      return;
    }
    if (!webhookRegistrationService.isConfigured()) return;
    this.running = true;
    const summary = { total: 0, skipped: 0, registered: 0, failed: 0 };
    try {
      const targets = await this._collectTargets();
      summary.total = targets.length;
      logger.info(`[WebhookBackfill] ${targets.length} cible(s) distincte(s) à vérifier`);

      for (const t of targets) {
        try {
          if (await this._alreadyRegistered(t)) {
            summary.skipped++;
            continue;
          }
          const token = await apsAuthService.ensureValidToken(t.userId).catch(() => null);
          if (!token) {
            summary.failed++;
            logger.debug(`[WebhookBackfill] Token indisponible pour user ${String(t.userId).slice(0, 8)}, cible ignorée`);
            continue;
          }

          if (t.kind === 'project') {
            await webhookRegistrationService.ensureProjectWebhook(token, t.projectId, t.hubId);
          } else {
            await webhookRegistrationService.ensureFolderWebhookAnyRegion(token, t.folderUrn, t.projectId, t.hubId);
          }
          summary.registered++;
        } catch (e) {
          summary.failed++;
          logger.debug(`[WebhookBackfill] Échec cible ${t.kind} ${t.projectId}: ${e.message}`);
        }
        await sleep(this.throttleMs);
      }

      logger.info(`[WebhookBackfill] Terminé — total:${summary.total} enregistrés:${summary.registered} déjà-ok:${summary.skipped} échecs:${summary.failed}`);
    } finally {
      this.running = false;
    }
    return summary;
  }
}

module.exports = new WebhookBackfillService();
