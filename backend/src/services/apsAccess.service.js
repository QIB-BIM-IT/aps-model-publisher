// backend/src/services/apsAccess.service.js
// Service pour vérifier l'accès des utilisateurs aux projets APS/ACC

const axios = require('axios');
const logger = require('../config/logger');
const apsAuthService = require('./apsAuth.service');

class APSAccessService {
  constructor() {
    // Cache des vérifications d'accès (TTL: 5 minutes)
    this.accessCache = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Vérifie si un utilisateur a accès à un projet APS/ACC
   * @param {string} userId - UUID de l'utilisateur
   * @param {string} projectId - URN du projet APS
   * @param {string} hubId - URN du hub APS (optionnel, sera extrait du projectId si absent)
   * @returns {Promise<boolean>} true si l'utilisateur a accès, false sinon
   */
  async checkUserProjectAccess(userId, projectId, hubId = null) {
    if (!userId || !projectId) {
      logger.warn('[APSAccess] userId ou projectId manquant');
      return false;
    }

    // Vérifier le cache
    const cacheKey = `${userId}:${projectId}`;
    const cached = this.accessCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      logger.debug(`[APSAccess] Cache hit pour ${cacheKey}: ${cached.hasAccess}`);
      return cached.hasAccess;
    }

    try {
      // Récupérer le token de l'utilisateur
      const userToken = await apsAuthService.ensureValidToken(userId);
      
      // Utiliser le hubId fourni ou l'extraire du projectId
      const effectiveHubId = hubId || projectId;
      
      // Essayer de lister les top folders du projet
      // Si ça réussit, l'utilisateur a accès
      const hubIdEncoded = encodeURIComponent(effectiveHubId);
      const projectIdEncoded = encodeURIComponent(projectId);
      const url = `https://developer.api.autodesk.com/project/v1/hubs/${hubIdEncoded}/projects/${projectIdEncoded}/topFolders`;
      
      logger.debug(`[APSAccess] Vérification d'accès: ${url}`);
      
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${userToken}` },
        timeout: 10000
      });

      const hasAccess = data && data.data && data.data.length >= 0;
      
      // Mettre en cache
      this.accessCache.set(cacheKey, {
        hasAccess,
        timestamp: Date.now()
      });

      logger.info(`[APSAccess] Utilisateur ${userId} ${hasAccess ? 'a accès' : 'n\'a pas accès'} au projet ${projectId}`);
      return hasAccess;

    } catch (error) {
      const status = error.response?.status;
      
      if (status === 403 || status === 404 || status === 401) {
        // L'utilisateur n'a pas accès
        logger.info(`[APSAccess] Utilisateur ${userId} n'a pas accès au projet ${projectId} (status: ${status})`);
        
        // Mettre en cache la non-accessibilité
        this.accessCache.set(cacheKey, {
          hasAccess: false,
          timestamp: Date.now()
        });
        
        return false;
      }

      // Autre erreur (timeout, réseau, etc.)
      logger.error(`[APSAccess] Erreur lors de la vérification d'accès: ${error.message}`);
      
      // En cas d'erreur technique, on ne cache pas et on retourne false par sécurité
      return false;
    }
  }

  /**
   * Vérifie si un utilisateur a accès à un hub APS/ACC
   * @param {string} userId - UUID de l'utilisateur
   * @param {string} hubId - URN du hub APS
   * @returns {Promise<boolean>}
   */
  async checkUserHubAccess(userId, hubId) {
    if (!userId || !hubId) {
      return false;
    }

    try {
      const userToken = await apsAuthService.ensureValidToken(userId);
      const hubIdEncoded = encodeURIComponent(hubId);
      const url = `https://developer.api.autodesk.com/project/v1/hubs/${hubIdEncoded}`;
      
      await axios.get(url, {
        headers: { Authorization: `Bearer ${userToken}` },
        timeout: 10000
      });

      return true;

    } catch (error) {
      const status = error.response?.status;
      if (status === 403 || status === 404 || status === 401) {
        return false;
      }
      logger.error(`[APSAccess] Erreur vérification hub: ${error.message}`);
      return false;
    }
  }

  /**
   * Invalide le cache pour un utilisateur/projet spécifique
   */
  invalidateCache(userId, projectId) {
    const cacheKey = `${userId}:${projectId}`;
    this.accessCache.delete(cacheKey);
    logger.debug(`[APSAccess] Cache invalidé pour ${cacheKey}`);
  }

  /**
   * Nettoie le cache (expire les entrées anciennes)
   */
  cleanCache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.accessCache.entries()) {
      if (now - value.timestamp >= this.CACHE_TTL) {
        this.accessCache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug(`[APSAccess] Cache nettoyé: ${cleaned} entrées expirées`);
    }
  }
}

/**
 * Extrait le hubId d'un projectId
 * Ex: b.xxx -> xxx
 */
function extractHubId(projectId) {
  // Format typique: b.PROJECT_ID ou urn:adsk.wipprod:dm.project:xxxxx
  if (projectId.startsWith('b.')) {
    // Extraire la partie après b.
    return projectId.substring(2);
  }
  
  // Si c'est un URN, on suppose que le hub est encodé dans le même format
  // Pour ACC, on utilise généralement le même préfixe
  return projectId;
}

// Instance singleton
const apsAccessService = new APSAccessService();

// Nettoyer le cache toutes les 10 minutes
setInterval(() => {
  apsAccessService.cleanCache();
}, 10 * 60 * 1000);

module.exports = apsAccessService;

