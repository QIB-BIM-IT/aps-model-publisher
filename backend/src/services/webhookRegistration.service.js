// src/services/webhookRegistration.service.js
// Service pour enregistrer automatiquement les webhooks APS

const axios = require('axios');
const logger = require('../config/logger');
const { apsConfig } = require('../config/aps.config');
const { WebhookRegistration } = require('../models');

const APS_WEBHOOKS_BASE = 'https://developer.api.autodesk.com/webhooks/v1';

class WebhookRegistrationService {
  constructor() {
    this.enabled = String(process.env.WEBHOOKS_ENABLED || 'false').toLowerCase() === 'true';
    this.callbackUrl = process.env.WEBHOOK_CALLBACK_URL;
    this.secret = process.env.WEBHOOK_SECRET;
    // Region(s) ou le secret HMAC a deja ete enregistre cote Autodesk
    this.secretRegisteredRegions = new Set();
  }

  /**
   * Vérifie si les webhooks sont configurés correctement
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.enabled && this.callbackUrl && this.secret);
  }

  /**
   * Enregistre le secret HMAC auprès d'Autodesk (une seule fois)
   * @param {string} accessToken - Token 2-legged ou 3-legged
   */
  async registerSecret(accessToken, region = null) {
    if (!this.secret) {
      return;
    }
    // Le secret doit etre enregistre dans la meme region que le hook
    const regionKey = region || 'US';
    if (this.secretRegisteredRegions.has(regionKey)) {
      return;
    }

    try {
      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };
      if (region) headers['x-ads-region'] = region;

      await axios.post(
        `${APS_WEBHOOKS_BASE}/tokens`,
        { token: this.secret },
        { headers }
      );
      this.secretRegisteredRegions.add(regionKey);
      logger.info(`[WebhookRegistration] ✅ Secret HMAC enregistré auprès d'Autodesk (région ${regionKey})`);
    } catch (error) {
      // 409 Conflict = secret déjà enregistré, c'est OK
      if (error.response?.status === 409) {
        this.secretRegisteredRegions.add(regionKey);
        logger.debug('[WebhookRegistration] Secret déjà enregistré');
      } else {
        logger.warn(`[WebhookRegistration] ⚠️ Erreur enregistrement secret: ${error.response?.data?.message || error.message}`);
      }
    }
  }

  /**
   * Vérifie si un webhook existe déjà pour un scope donné
   * @param {string} scopeType - 'folder' ou 'project'
   * @param {string} scopeValue - URN du folder ou ID du projet
   * @param {string} eventType - Type d'événement (ex: dm.version.added)
   */
  async findExistingWebhook(scopeType, scopeValue, eventType = 'dm.version.added') {
    return WebhookRegistration.findOne({
      where: {
        scopeType,
        scopeValue,
        eventType,
        status: 'active',
      },
    });
  }

  /**
   * Enregistre un webhook pour un projet (scope project)
   * Surveille TOUTES les versions créées dans le projet
   * @param {string} accessToken - Token Autodesk
   * @param {string} projectId - ID du projet (ex: b.xxxxx)
   * @param {string} hubId - ID du hub (optionnel)
   */
  async ensureProjectWebhook(accessToken, projectId, hubId = null, region = null) {
    if (!this.isConfigured()) {
      logger.debug('[WebhookRegistration] Webhooks non configurés, skip');
      return null;
    }

    const eventType = 'dm.version.added';
    const scopeType = 'project';
    const scopeValue = projectId;

    // Vérifier si existe déjà
    const existing = await this.findExistingWebhook(scopeType, scopeValue, eventType);
    if (existing) {
      logger.debug(`[WebhookRegistration] Webhook déjà existant pour projet ${projectId}`);
      return existing;
    }

    // Enregistrer le secret si pas encore fait (dans la meme region que le hook)
    await this.registerSecret(accessToken, region);

    try {
      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };
      if (region) headers['x-ads-region'] = region;

      // Créer le webhook via l'API Autodesk
      const response = await axios.post(
        `${APS_WEBHOOKS_BASE}/systems/data/events/${eventType}/hooks`,
        {
          callbackUrl: this.callbackUrl,
          scope: {
            project: projectId,
          },
          hookAttribute: {
            projectId: projectId,
            hubId: hubId,
            source: 'aps-model-publisher',
          },
          autoReactivateHook: true,
        },
        { headers }
      );

      const hookData = response.data;
      logger.info(`[WebhookRegistration] ✅ Webhook créé pour projet ${projectId}: ${hookData.hookId}`);

      // Sauvegarder en base
      const registration = await WebhookRegistration.create({
        apsHookId: hookData.hookId,
        scopeType,
        scopeValue,
        projectId,
        hubId,
        eventType,
        callbackUrl: this.callbackUrl,
        status: 'active',
        metadata: {
          urn: hookData.urn,
          createdBy: hookData.createdBy,
          system: hookData.system,
          region: region || 'US',
        },
      });

      return registration;
    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.message || error.response?.data?.detail || error.message;
      logger.error(`[WebhookRegistration] ❌ Erreur création webhook projet ${projectId}: ${status || ''} ${errorMsg}`);

      // Si le webhook existe déjà côté Autodesk (409), essayer de le récupérer
      if (status === 409) {
        logger.info('[WebhookRegistration] Webhook existe déjà côté Autodesk, récupération...');
        return this.syncExistingWebhooks(accessToken, projectId);
      }

      // 🆕 Propager l'erreur reelle pour que la route puisse l'exposer (au lieu d'un 500 opaque)
      const err = new Error(`APS ${status || 'error'}: ${errorMsg}`);
      err.apsStatus = status;
      err.apsBody = error.response?.data || null;
      throw err;
    }
  }

  /**
   * Enregistre un webhook pour un dossier spécifique
   * @param {string} accessToken - Token Autodesk
   * @param {string} folderUrn - URN du dossier
   * @param {string} projectId - ID du projet
   * @param {string} hubId - ID du hub (optionnel)
   */
  async ensureFolderWebhook(accessToken, folderUrn, projectId, hubId = null) {
    if (!this.isConfigured()) {
      logger.debug('[WebhookRegistration] Webhooks non configurés, skip');
      return null;
    }

    const eventType = 'dm.version.added';
    const scopeType = 'folder';
    const scopeValue = folderUrn;

    // Vérifier si existe déjà
    const existing = await this.findExistingWebhook(scopeType, scopeValue, eventType);
    if (existing) {
      logger.debug(`[WebhookRegistration] Webhook déjà existant pour dossier ${folderUrn}`);
      return existing;
    }

    // Enregistrer le secret si pas encore fait
    await this.registerSecret(accessToken);

    try {
      // Créer le webhook via l'API Autodesk
      const response = await axios.post(
        `${APS_WEBHOOKS_BASE}/systems/data/events/${eventType}/hooks`,
        {
          callbackUrl: this.callbackUrl,
          scope: {
            folder: folderUrn,
          },
          hookAttribute: {
            projectId: projectId,
            hubId: hubId,
            folderUrn: folderUrn,
            source: 'aps-model-publisher',
          },
          autoReactivateHook: true,
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const hookData = response.data;
      logger.info(`[WebhookRegistration] ✅ Webhook créé pour dossier: ${hookData.hookId}`);

      // Sauvegarder en base
      const registration = await WebhookRegistration.create({
        apsHookId: hookData.hookId,
        scopeType,
        scopeValue,
        projectId,
        hubId,
        eventType,
        callbackUrl: this.callbackUrl,
        status: 'active',
        metadata: {
          urn: hookData.urn,
          createdBy: hookData.createdBy,
          system: hookData.system,
        },
      });

      return registration;
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.response?.data?.detail || error.message;
      logger.error(`[WebhookRegistration] ❌ Erreur création webhook dossier: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Synchronise les webhooks existants côté Autodesk avec notre base
   * @param {string} accessToken - Token Autodesk
   * @param {string} projectId - ID du projet (optionnel, pour filtrer)
   */
  async syncExistingWebhooks(accessToken, projectId = null) {
    try {
      const response = await axios.get(
        `${APS_WEBHOOKS_BASE}/systems/data/hooks`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      const hooks = response.data?.data || [];
      logger.info(`[WebhookRegistration] ${hooks.length} webhooks trouvés côté Autodesk`);

      for (const hook of hooks) {
        // Filtrer par projectId si spécifié
        if (projectId && hook.hookAttribute?.projectId !== projectId) {
          continue;
        }

        // Vérifier si on a déjà ce webhook en base
        const existing = await WebhookRegistration.findOne({
          where: { apsHookId: hook.hookId },
        });

        if (!existing) {
          // Déterminer le scope
          const scopeType = hook.scope?.folder ? 'folder' : 'project';
          const scopeValue = hook.scope?.folder || hook.scope?.project;

          if (scopeValue) {
            await WebhookRegistration.create({
              apsHookId: hook.hookId,
              scopeType,
              scopeValue,
              projectId: hook.hookAttribute?.projectId || projectId,
              hubId: hook.hookAttribute?.hubId,
              eventType: hook.event || 'dm.version.added',
              callbackUrl: hook.callbackUrl,
              status: hook.status === 'active' ? 'active' : 'inactive',
              metadata: {
                urn: hook.urn,
                createdBy: hook.createdBy,
                system: hook.system,
              },
            });
            logger.info(`[WebhookRegistration] Webhook synchronisé: ${hook.hookId}`);
          }
        }
      }

      // Retourner le webhook pour le projet demandé
      if (projectId) {
        return WebhookRegistration.findOne({
          where: { projectId, status: 'active' },
        });
      }

      return null;
    } catch (error) {
      logger.error(`[WebhookRegistration] Erreur synchronisation: ${error.message}`);
      return null;
    }
  }

  /**
   * Supprime un webhook
   * @param {string} accessToken - Token Autodesk
   * @param {string} registrationId - ID de notre enregistrement
   */
  async deleteWebhook(accessToken, registrationId) {
    const registration = await WebhookRegistration.findByPk(registrationId);
    if (!registration) {
      return false;
    }

    try {
      await axios.delete(
        `${APS_WEBHOOKS_BASE}/systems/data/events/${registration.eventType}/hooks/${registration.apsHookId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );
      logger.info(`[WebhookRegistration] ✅ Webhook supprimé: ${registration.apsHookId}`);
    } catch (error) {
      // 404 = déjà supprimé, c'est OK
      if (error.response?.status !== 404) {
        logger.warn(`[WebhookRegistration] ⚠️ Erreur suppression webhook: ${error.message}`);
      }
    }

    // Supprimer de notre base dans tous les cas
    await registration.destroy();
    return true;
  }

  /**
   * Liste tous les webhooks enregistrés
   */
  async listWebhooks(projectId = null) {
    const where = {};
    if (projectId) {
      where.projectId = projectId;
    }

    return WebhookRegistration.findAll({
      where,
      order: [['createdAt', 'DESC']],
    });
  }
}

module.exports = new WebhookRegistrationService();
