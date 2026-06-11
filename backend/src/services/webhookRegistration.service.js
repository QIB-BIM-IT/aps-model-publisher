// src/services/webhookRegistration.service.js
// Service pour enregistrer automatiquement les webhooks APS

const axios = require('axios');
const logger = require('../config/logger');
const { apsConfig } = require('../config/aps.config');
const { WebhookRegistration } = require('../models');
const apsDataService = require('./apsData.service');

const APS_BASE = 'https://developer.api.autodesk.com';
const APS_WEBHOOKS_BASE = `${APS_BASE}/webhooks/v1`;

// Régions Data Management v2 (ordre d'essai). Doivent matcher l'enum x-ads-region des Webhooks.
// US = USA, CAN = Canada, EMEA = Europe, GBR = UK, DEU = Allemagne, JPN = Japon, IND = Inde, AUS = Australie
const REGIONS = ['us', 'can', 'emea', 'gbr', 'deu', 'jpn', 'ind', 'aus'];

class WebhookRegistrationService {
  constructor() {
    this.enabled = String(process.env.WEBHOOKS_ENABLED || 'false').toLowerCase() === 'true';
    this.callbackUrl = process.env.WEBHOOK_CALLBACK_URL;
    this.secret = process.env.WEBHOOK_SECRET;
    // Region(s) ou le secret HMAC a deja ete enregistre cote Autodesk
    this.secretRegisteredRegions = new Set();
    // Cache projectId -> region (US/EMEA/CAN...) pour eviter de re-sonder a chaque appel
    this.projectRegionCache = new Map();
  }

  /**
   * Détecte la région d'un projet en sondant les endpoints Data Management régionaux.
   * Réutilise la même approche que la publication (GET /data/v2/regions/:region/projects/:id).
   * @param {string} accessToken
   * @param {string} projectId
   * @returns {Promise<string>} region en MAJUSCULES (ex: 'US', 'CAN', 'EMEA'); 'US' par défaut
   */
  async detectProjectRegion(accessToken, projectId) {
    if (this.projectRegionCache.has(projectId)) {
      return this.projectRegionCache.get(projectId);
    }
    for (const region of REGIONS) {
      try {
        const url = `${APS_BASE}/data/v2/regions/${region}/projects/${encodeURIComponent(projectId)}`;
        const resp = await axios.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 8000,
          validateStatus: () => true,
        });
        if (resp.status === 200) {
          const up = region.toUpperCase();
          this.projectRegionCache.set(projectId, up);
          logger.info(`[WebhookRegistration] Région détectée pour ${projectId}: ${up}`);
          return up;
        }
      } catch (_e) {
        // région suivante
      }
    }
    logger.warn(`[WebhookRegistration] Région indéterminée pour ${projectId}, fallback US`);
    this.projectRegionCache.set(projectId, 'US');
    return 'US';
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

    // ⚠️ L'API Webhooks du système "data" n'accepte PAS de scope "project".
    // Le seul scope valide pour dm.version.added est "folder" (récursif sur les
    // sous-dossiers). On couvre donc le projet en enregistrant un hook par
    // top-folder du projet.
    const eventType = 'dm.version.added';

    if (!hubId) {
      const err = new Error('hubId requis pour enregistrer les webhooks du projet (scope folder)');
      err.apsStatus = 400;
      throw err;
    }

    // Récupérer les top-folders du projet en essayant les régions de data residency.
    // On ne se fie pas à un endpoint de sondage: la région qui renvoie réellement
    // des dossiers EST la région du projet (et donc celle des webhooks).
    const hint = region ? String(region).toUpperCase() : null;
    const regionOrder = hint
      ? [hint, ...REGIONS.map((r) => r.toUpperCase()).filter((r) => r !== hint)]
      : REGIONS.map((r) => r.toUpperCase());

    let folders = [];
    let effectiveRegion = 'US';
    let lastError = null;
    for (const r of regionOrder) {
      try {
        const topFolders = await apsDataService.getTopFolders(hubId, projectId, accessToken, r);
        const ids = (Array.isArray(topFolders) ? topFolders : [])
          .map((f) => f && f.id)
          .filter(Boolean);
        if (ids.length > 0) {
          folders = ids;
          effectiveRegion = r;
          this.projectRegionCache.set(projectId, r);
          logger.info(`[WebhookRegistration] Top-folders trouvés pour ${projectId} en région ${r} (${ids.length})`);
          break;
        }
      } catch (error) {
        lastError = error;
        // 404 attendu sur les mauvaises régions: on essaie la suivante.
      }
    }

    if (folders.length === 0) {
      const detail = lastError
        ? (lastError.response?.data?.message || lastError.response?.data?.detail || lastError.message)
        : 'aucune région ne renvoie de dossiers';
      const err = new Error(`Impossible de récupérer les top-folders pour ${projectId} (régions essayées: ${regionOrder.join(',')}): ${detail}`);
      err.apsStatus = lastError?.response?.status || 404;
      err.apsBody = lastError?.response?.data || null;
      throw err;
    }

    const apsRegion = effectiveRegion !== 'US' ? effectiveRegion : null;
    // Enregistrer le secret dans la même région que les hooks.
    await this.registerSecret(accessToken, apsRegion);

    const registrations = [];
    const errors = [];
    for (const folderUrn of folders) {
      try {
        const reg = await this.ensureFolderWebhook(accessToken, folderUrn, projectId, hubId, effectiveRegion);
        if (reg) registrations.push(reg);
      } catch (e) {
        errors.push(`${folderUrn}: ${e.message}`);
      }
    }

    if (registrations.length === 0) {
      const err = new Error(`Aucun webhook folder créé pour ${projectId}. ${errors.join(' | ')}`);
      err.apsStatus = 502;
      throw err;
    }

    logger.info(`[WebhookRegistration] ✅ ${registrations.length}/${folders.length} webhook(s) folder créé(s) pour projet ${projectId} (région ${effectiveRegion || 'US'})`);

    return {
      projectId,
      hubId,
      eventType,
      region: effectiveRegion || 'US',
      folderCount: folders.length,
      registeredCount: registrations.length,
      errors,
      registrations,
    };
  }

  /**
   * Enregistre un webhook pour un dossier spécifique
   * @param {string} accessToken - Token Autodesk
   * @param {string} folderUrn - URN du dossier
   * @param {string} projectId - ID du projet
   * @param {string} hubId - ID du hub (optionnel)
   */
  async ensureFolderWebhook(accessToken, folderUrn, projectId, hubId = null, region = null) {
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

    const effectiveRegion = region ? String(region).toUpperCase() : null;
    const apsRegion = effectiveRegion && effectiveRegion !== 'US' ? effectiveRegion : null;

    // Enregistrer le secret dans la même région que le hook
    await this.registerSecret(accessToken, apsRegion);

    try {
      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };
      if (apsRegion) headers['x-ads-region'] = apsRegion;

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
        { headers }
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
          region: effectiveRegion || 'US',
        },
      });

      return registration;
    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.message || error.response?.data?.detail || error.message;

      // 409 = le hook existe déjà côté Autodesk : objectif atteint (hook actif).
      // On tente de le retrouver pour l'enregistrer en base, sinon on le considère
      // comme déjà actif (résultat non-bloquant).
      if (status === 409) {
        logger.info(`[WebhookRegistration] Webhook dossier déjà existant côté Autodesk (${folderUrn}), synchronisation...`);
        const synced = await this.syncExistingWebhooks(accessToken, projectId, effectiveRegion);
        if (synced) return synced;
        return {
          alreadyExists: true,
          scopeType,
          scopeValue,
          projectId,
          hubId,
          eventType,
          status: 'active',
        };
      }

      logger.error(`[WebhookRegistration] ❌ Erreur création webhook dossier ${folderUrn}: ${status || ''} ${errorMsg}`);
      const err = new Error(`APS ${status || 'error'}: ${errorMsg}`);
      err.apsStatus = status;
      err.apsBody = error.response?.data || null;
      throw err;
    }
  }

  /**
   * Synchronise les webhooks existants côté Autodesk avec notre base
   * @param {string} accessToken - Token Autodesk
   * @param {string} projectId - ID du projet (optionnel, pour filtrer)
   */
  async syncExistingWebhooks(accessToken, projectId = null, region = null) {
    try {
      const headers = { 'Authorization': `Bearer ${accessToken}` };
      const apsRegion = region && String(region).toUpperCase() !== 'US' ? String(region).toUpperCase() : null;
      if (apsRegion) headers['x-ads-region'] = apsRegion;

      const response = await axios.get(
        `${APS_WEBHOOKS_BASE}/systems/data/hooks`,
        { headers }
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
      const headers = { 'Authorization': `Bearer ${accessToken}` };
      const storedRegion = registration.metadata?.region;
      if (storedRegion && String(storedRegion).toUpperCase() !== 'US') {
        headers['x-ads-region'] = String(storedRegion).toUpperCase();
      }
      await axios.delete(
        `${APS_WEBHOOKS_BASE}/systems/data/events/${registration.eventType}/hooks/${registration.apsHookId}`,
        { headers }
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
