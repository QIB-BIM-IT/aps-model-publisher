// src/routes/webhooks.routes.js
// Endpoints pour recevoir les webhooks Autodesk APS
// ⚠️ Désactivés par défaut - activer avec WEBHOOKS_ENABLED=true

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const webhooksService = require('../services/webhooks.service');
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

  const signature = req.headers['x-webhook-signature'] || req.headers['x-autodesk-signature'];
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

module.exports = router;

