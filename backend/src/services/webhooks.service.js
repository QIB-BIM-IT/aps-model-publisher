// src/services/webhooks.service.js
// Service pour gérer les webhooks Autodesk APS
// Les webhooks permettent de recevoir des notifications en temps réel
// quand des événements se produisent (publication, export, etc.)

const crypto = require('crypto');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { apsConfig } = require('../config/aps.config');
const { PublishRun, PDFExportRun } = require('../models');

class WebhooksService {
  constructor() {
    this.secret = apsConfig.webhooks.secret;
    this.enabled = String(process.env.WEBHOOKS_ENABLED || 'false').toLowerCase() === 'true';
  }

  /**
   * Vérifie la signature d'un webhook Autodesk
   * @param {string} payload - Corps de la requête (string)
   * @param {string} signature - Signature reçue dans les headers
   * @returns {boolean} - true si signature valide
   */
  verifySignature(payload, signature) {
    if (!this.secret) {
      logger.warn('[Webhooks] ⚠️ WEBHOOK_SECRET non configuré, signature non vérifiée');
      return false;
    }

    if (!signature) {
      logger.warn('[Webhooks] ⚠️ Aucune signature fournie');
      return false;
    }

    try {
      // Autodesk utilise HMAC-SHA256
      const hmac = crypto.createHmac('sha256', this.secret);
      hmac.update(payload);
      const expectedSignature = hmac.digest('hex');
      
      // Comparaison sécurisée (timing-safe)
      const providedSignature = signature.replace(/^sha256=/, ''); // Enlever le préfixe si présent
      
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );
    } catch (error) {
      logger.error(`[Webhooks] Erreur vérification signature: ${error.message}`);
      return false;
    }
  }

  /**
   * Traite un événement webhook de publication
   * @param {object} event - Événement reçu
   * @returns {Promise<void>}
   */
  async handlePublishEvent(event) {
    try {
      const { payload } = event;
      
      // Identifier le run concerné
      // Les webhooks Autodesk incluent généralement un identifiant de job/run
      const runId = payload?.runId || payload?.jobId || payload?.id;
      const projectId = payload?.projectId;
      const itemId = payload?.itemId || payload?.versionId;
      
      if (!runId && !projectId) {
        logger.warn('[Webhooks] Événement publish sans runId ou projectId');
        return;
      }

      // Chercher le run correspondant
      let run = null;
      if (runId) {
        run = await PublishRun.findByPk(runId);
      } else if (projectId && itemId) {
        // Chercher par projet et item
        run = await PublishRun.findOne({
          where: {
            projectId,
            status: 'running',
          },
          order: [['startedAt', 'DESC']],
        });
      }

      if (!run) {
        logger.warn(`[Webhooks] Run introuvable pour événement publish: runId=${runId}, projectId=${projectId}`);
        return;
      }

      // Mettre à jour le run avec les informations du webhook
      const eventType = payload?.eventType || payload?.type || 'unknown';
      const eventTime = payload?.timestamp || payload?.time || new Date().toISOString();
      
      logger.info(`[Webhooks] 📨 Événement publish reçu: type=${eventType}, runId=${run.id}`);

      // Mettre à jour les stats avec le temps réel (quand le document est vraiment publié)
      if (eventType === 'version.created' || eventType === 'item.published' || eventType === 'publish.completed') {
        run.stats = {
          ...(run.stats || {}),
          webhookEndTime: eventTime,
          webhookEventType: eventType,
          webhookReceived: true,
        };
        
        // Calculer le temps réel total (depuis le début jusqu'à la publication réelle)
        let realDurationMs = null;
        if (run.startedAt) {
          realDurationMs = new Date(eventTime) - new Date(run.startedAt);
          run.stats.realDurationMs = realDurationMs;
        }
        
        await run.save();
        if (realDurationMs !== null) {
          logger.info(`[Webhooks] ✅ Run ${run.id} mis à jour avec temps réel: ${realDurationMs}ms`);
        } else {
          logger.info(`[Webhooks] ✅ Run ${run.id} mis à jour (startedAt manquant, temps réel non calculé)`);
        }
      }
    } catch (error) {
      logger.error(`[Webhooks] Erreur traitement événement publish: ${error.message}`);
      throw error;
    }
  }

  /**
   * Traite un événement webhook d'export PDF
   * @param {object} event - Événement reçu
   * @returns {Promise<void>}
   */
  async handlePDFExportEvent(event) {
    try {
      const { payload } = event;
      
      const runId = payload?.runId || payload?.jobId || payload?.id;
      const projectId = payload?.projectId;
      const exportJobId = payload?.exportJobId || payload?.jobId;
      
      if (!runId && !exportJobId) {
        logger.warn('[Webhooks] Événement PDF export sans runId ou exportJobId');
        return;
      }

      // Chercher le run correspondant
      let run = null;
      if (runId) {
        run = await PDFExportRun.findByPk(runId);
      } else if (exportJobId) {
        // Chercher par exportJobId (stocké dans stats.exportJobId)
        const runs = await PDFExportRun.findAll({
          where: {
            status: 'running',
          },
          order: [['startedAt', 'DESC']],
        });
        
        run = runs.find(r => {
          const stats = r.stats || {};
          return stats.exportJobId === exportJobId || stats.jobId === exportJobId;
        });
        
        // Si pas trouvé, chercher dans les runs récents (dernières 24h)
        if (!run) {
          const recentRuns = await PDFExportRun.findAll({
            where: {
              status: ['success', 'partial', 'failed'],
              startedAt: {
                [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000),
              },
            },
            order: [['startedAt', 'DESC']],
            limit: 50,
          });
          
          run = recentRuns.find(r => {
            const stats = r.stats || {};
            return stats.exportJobId === exportJobId || stats.jobId === exportJobId;
          });
        }
      }

      if (!run) {
        logger.warn(`[Webhooks] Run introuvable pour événement PDF: runId=${runId}, exportJobId=${exportJobId}`);
        return;
      }

      const eventType = payload?.eventType || payload?.type || 'unknown';
      const eventTime = payload?.timestamp || payload?.time || new Date().toISOString();
      
      logger.info(`[Webhooks] 📨 Événement PDF export reçu: type=${eventType}, runId=${run.id}`);

      // Mettre à jour avec le temps réel
      if (eventType === 'export.completed' || eventType === 'pdf.uploaded' || eventType === 'export.finished') {
        run.stats = {
          ...(run.stats || {}),
          webhookEndTime: eventTime,
          webhookEventType: eventType,
          webhookReceived: true,
        };
        
        // Calculer le temps réel total (depuis le début jusqu'à l'export réel)
        let realDurationMs = null;
        if (run.startedAt) {
          realDurationMs = new Date(eventTime) - new Date(run.startedAt);
          run.stats.realDurationMs = realDurationMs;
        }
        
        await run.save();
        if (realDurationMs !== null) {
          logger.info(`[Webhooks] ✅ Run ${run.id} mis à jour avec temps réel: ${realDurationMs}ms`);
        } else {
          logger.info(`[Webhooks] ✅ Run ${run.id} mis à jour (startedAt manquant, temps réel non calculé)`);
        }
      }
    } catch (error) {
      logger.error(`[Webhooks] Erreur traitement événement PDF: ${error.message}`);
      throw error;
    }
  }

  /**
   * Traite un événement webhook générique
   * @param {object} event - Événement reçu
   * @returns {Promise<void>}
   */
  async handleEvent(event) {
    const { payload } = event;
    const eventType = payload?.eventType || payload?.type || payload?.event || 'unknown';
    const resourceType = payload?.resourceType || payload?.resource || 'unknown';

    logger.info(`[Webhooks] 📨 Événement reçu: type=${eventType}, resource=${resourceType}`);

    // Router vers le bon handler selon le type
    if (resourceType.includes('publish') || resourceType.includes('version') || resourceType.includes('item')) {
      await this.handlePublishEvent(event);
    } else if (resourceType.includes('pdf') || resourceType.includes('export')) {
      await this.handlePDFExportEvent(event);
    } else {
      logger.warn(`[Webhooks] Type d'événement non géré: ${eventType} (resource=${resourceType})`);
    }
  }

  /**
   * Vérifie si les webhooks sont activés
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }
}

module.exports = new WebhooksService();

