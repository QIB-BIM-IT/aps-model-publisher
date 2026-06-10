// src/routes/webhooks.routes.js
// Endpoints pour recevoir les webhooks Autodesk APS
// ⚠️ Désactivés par défaut - activer avec WEBHOOKS_ENABLED=true

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const webhooksService = require('../services/webhooks.service');
const webhookRegistrationService = require('../services/webhookRegistration.service');
const apsAuthService = require('../services/apsAuth.service');
const { authenticateToken } = require('../middleware/auth.middleware');
const {
  asyncHandler,
  ValidationError,
} = require('../middleware/errorHandler.middleware');

// Middleware pour parser le body en string (pour vérification signature)
const rawBodyParser = express.raw({ type: 'application/json', limit: '2mb' });

/**
 * POST /api/webhooks/aps
 * Endpoint principal pour recevoir les webhooks Autodesk APS
 * 
 * Format attendu par Autodesk:
 * - Header: X-Webhook-Signature (signature HMAC-SHA256)
 * - Body: JSON avec payload contenant l'événement
 */
router.post('/aps', rawBodyParser, asyncHandler(async (req, res) => {
  // Vérifier si les webhooks sont activés
  if (!webhooksService.isEnabled()) {
    logger.debug('[Webhooks] Webhooks désactivés, requête ignorée');
    return res.status(503).json({
      success: false,
      message: 'Webhooks désactivés. Activez avec WEBHOOKS_ENABLED=true',
    });
  }

  // Autodesk APS envoie la signature dans le header x-adsk-signature
  // (on garde les anciens noms en repli au cas ou)
  const signature = req.headers['x-adsk-signature']
    || req.headers['x-webhook-signature']
    || req.headers['x-autodesk-signature'];
  const payloadString = req.body.toString('utf8');

  if (!signature) {
    logger.warn('[Webhooks] ⚠️ Requête sans signature');
    return res.status(401).json({
      success: false,
      message: 'Signature manquante',
    });
  }

  // Vérifier la signature
  const isValid = webhooksService.verifySignature(payloadString, signature);
  if (!isValid) {
    logger.warn('[Webhooks] ⚠️ Signature invalide');
    return res.status(401).json({
      success: false,
      message: 'Signature invalide',
    });
  }

  // Parser le payload JSON
  let event;
  try {
    event = JSON.parse(payloadString);
  } catch (error) {
    logger.error(`[Webhooks] Erreur parsing JSON: ${error.message}`);
    return res.status(400).json({
      success: false,
      message: 'Payload JSON invalide',
    });
  }

  logger.info(`[Webhooks] ✅ Webhook reçu et validé: ${event?.payload?.eventType || 'unknown'}`);

  // Traiter l'événement de manière asynchrone (ne pas bloquer la réponse)
  webhooksService.handleEvent(event).catch((error) => {
    logger.error(`[Webhooks] Erreur traitement événement: ${error.message}`);
  });

  // Répondre immédiatement à Autodesk (200 OK)
  res.status(200).json({
    success: true,
    message: 'Webhook reçu',
  });
}));

/**
 * GET /api/webhooks/status
 * Vérifier le statut des webhooks (activés/désactivés)
 */
router.get('/status', asyncHandler(async (req, res) => {
  const enabled = webhooksService.isEnabled();
  const hasSecret = !!process.env.WEBHOOK_SECRET;
  const callbackUrl = process.env.WEBHOOK_CALLBACK_URL;

  res.json({
    success: true,
    enabled,
    configured: hasSecret && !!callbackUrl,
    callbackUrl: callbackUrl || null,
    message: enabled
      ? 'Webhooks activés et prêts'
      : 'Webhooks désactivés. Activez avec WEBHOOKS_ENABLED=true',
  });
}));

/**
 * POST /api/webhooks/test
 * Endpoint de test (développement uniquement)
 * Permet de tester la logique sans passer par Autodesk
 */
router.post('/test', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw new ValidationError('Endpoint de test non disponible en production');
  }

  const { event } = req.body;

  if (!event || !event.payload) {
    throw new ValidationError('Format invalide: { event: { payload: {...} } }');
  }

  logger.info('[Webhooks] 🧪 Test webhook (mode développement)');

  try {
    await webhooksService.handleEvent(event);
    res.json({
      success: true,
      message: 'Événement de test traité',
    });
  } catch (error) {
    logger.error(`[Webhooks] Erreur test: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}));

// ========== ROUTES AUTHENTIFIÉES (gestion des webhooks) ==========

/**
 * GET /api/webhooks/registrations
 * Liste tous les webhooks enregistrés
 */
router.get('/registrations', authenticateToken, asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const webhooks = await webhookRegistrationService.listWebhooks(projectId || null);
  
  res.json({
    success: true,
    data: webhooks,
    configured: webhookRegistrationService.isConfigured(),
  });
}));

/**
 * POST /api/webhooks/registrations/sync
 * Synchronise les webhooks existants côté Autodesk avec notre base
 */
router.post('/registrations/sync', authenticateToken, asyncHandler(async (req, res) => {
  if (!webhookRegistrationService.isConfigured()) {
    throw new ValidationError('Webhooks non configurés. Définissez WEBHOOKS_ENABLED, WEBHOOK_SECRET et WEBHOOK_CALLBACK_URL');
  }

  const accessToken = await apsAuthService.ensureValidToken(req.userId);
  const { projectId } = req.body;
  
  await webhookRegistrationService.syncExistingWebhooks(accessToken, projectId || null);
  const webhooks = await webhookRegistrationService.listWebhooks(projectId || null);
  
  res.json({
    success: true,
    message: 'Synchronisation terminée',
    data: webhooks,
  });
}));

/**
 * POST /api/webhooks/registrations/project
 * Créer manuellement un webhook pour un projet
 */
router.post('/registrations/project', authenticateToken, asyncHandler(async (req, res) => {
  if (!webhookRegistrationService.isConfigured()) {
    throw new ValidationError('Webhooks non configurés. Définissez WEBHOOKS_ENABLED, WEBHOOK_SECRET et WEBHOOK_CALLBACK_URL');
  }

  const { projectId, hubId, region } = req.body;
  if (!projectId) {
    throw new ValidationError('projectId requis');
  }

  const accessToken = await apsAuthService.ensureValidToken(req.userId);
  try {
    const webhook = await webhookRegistrationService.ensureProjectWebhook(accessToken, projectId, hubId, region || null);

    if (!webhook) {
      throw new ValidationError('Impossible de créer le webhook');
    }

    res.json({
      success: true,
      message: 'Webhook créé',
      data: webhook,
    });
  } catch (err) {
    // Exposer le vrai message d'erreur APS (le errorHandler global est désactivé)
    logger.error(`[Webhooks] Echec enregistrement projet ${projectId}: ${err.message}`);
    return res.status(err.apsStatus || 502).json({
      success: false,
      message: err.message,
      aps: err.apsBody || null,
    });
  }
}));

/**
 * DELETE /api/webhooks/registrations/:id
 * Supprimer un webhook
 */
router.delete('/registrations/:id', authenticateToken, asyncHandler(async (req, res) => {
  const accessToken = await apsAuthService.ensureValidToken(req.userId);
  const deleted = await webhookRegistrationService.deleteWebhook(accessToken, req.params.id);
  
  if (!deleted) {
    throw new ValidationError('Webhook introuvable');
  }

  res.json({
    success: true,
    message: 'Webhook supprimé',
  });
}));

module.exports = router;

