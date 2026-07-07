// src/routes/qc.routes.js
// Routes du module QC BIM (tranche verticale G408).
//
// ⚠️ Ce fichier est requis par server.js AVANT connectDB()/sync() : il ne doit requérir
// AUCUN modèle qc au chargement (qcRun.service charge ses modèles paresseusement).
//
// Routes :
//  - POST /api/qc/runs           (auth JWT) lance un run QC manuel
//  - GET  /api/qc/runs           (auth JWT) liste les runs récents
//  - GET  /api/qc/runs/:id       (auth JWT) détail d'un run + résultats + warnings
//  - POST /api/qc/da-callback    (jeton HMAC dans l'URL) complétion onComplete de DA

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { authenticateToken } = require('../middleware/auth.middleware');
const qcRunService = require('../services/qcRun.service');

function notReady(res) {
  return res.status(503).json({
    success: false,
    message: 'Module QC non initialisé (voir logs serveur). Les fonctionnalités existantes ne sont pas affectées.',
  });
}

function httpStatus(err) {
  return Number.isInteger(err?.statusCode) ? err.statusCode : 500;
}

/**
 * POST /api/qc/runs
 * Body: { region: 'US'|'EMEA', projectGuid, modelGuid, runType?: 'quotidien'|'jalon',
 *         projectId?: 'b.xxx', itemUrn?: 'urn:adsk.wipprod:dm.lineage:...', jobId? }
 */
router.post('/runs', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const { region, projectGuid, modelGuid, runType, projectId, itemUrn, jobId } = req.body || {};
    const run = await qcRunService.startRun({
      user: req.user,
      region,
      projectGuid,
      modelGuid,
      runType: runType || 'quotidien',
      projectId: projectId || null,
      itemUrn: itemUrn || null,
      jobId: jobId || null,
    });
    return res.status(202).json({ success: true, run });
  } catch (err) {
    logger.error(`[QC] POST /runs: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/qc/runs?limit=20
 */
router.get('/runs', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const { QCRun } = qcRunService.getModels();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    const runs = await QCRun.findAll({ order: [['createdAt', 'DESC']], limit });
    return res.json({ success: true, runs });
  } catch (err) {
    logger.error(`[QC] GET /runs: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/qc/runs/:id — run + control_results + warnings
 */
router.get('/runs/:id', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const { QCRun, QCControlResult, QCWarning } = qcRunService.getModels();
    const run = await QCRun.findByPk(req.params.id, {
      include: [
        {
          model: QCControlResult,
          as: 'controlResults',
          include: [{ model: QCWarning, as: 'warnings' }],
        },
      ],
    });
    if (!run) return res.status(404).json({ success: false, message: 'Run introuvable' });
    return res.json({ success: true, run });
  } catch (err) {
    logger.error(`[QC] GET /runs/:id: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/qc/da-callback?runId=...&sig=...
 * Callback onComplete de Design Automation. DA ne signe pas ses callbacks : l'URL porte
 * un jeton HMAC lié au runId. On répond 200 immédiatement puis on finalise en asynchrone ;
 * la finalisation re-vérifie TOUJOURS le statut réel du workitem (jamais confiance au body),
 * et le verrou de complétion est en base (update conditionnel) — le polling reste le secours.
 */
router.post('/da-callback', express.json({ limit: '1mb' }), async (req, res) => {
  const { runId, sig } = req.query || {};

  if (!qcRunService.isReady()) return res.status(503).json({ success: false });
  if (!runId || !qcRunService.verifyCallbackSignature(runId, sig)) {
    logger.warn(`[QC] Callback DA rejeté (signature invalide) runId=${runId || 'n/a'}`);
    return res.status(401).json({ success: false, message: 'Signature invalide' });
  }

  // Répondre tout de suite à DA, finaliser en tâche de fond
  res.status(200).json({ success: true });

  qcRunService
    .handleCompletion(runId, 'callback')
    .then((r) => logger.info(`[QC] Callback DA runId=${runId}: handled=${r.handled} (${r.reason || r.status || ''})`))
    .catch((e) => logger.error(`[QC] Callback DA runId=${runId} erreur: ${e.message}`));
});

module.exports = router;
