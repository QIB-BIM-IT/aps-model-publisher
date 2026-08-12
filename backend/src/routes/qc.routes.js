// src/routes/qc.routes.js
// Routes du module QC BIM (tranche verticale G408).
//
// ⚠️ Ce fichier est requis par server.js AVANT connectDB()/sync() : il ne doit requérir
// AUCUN modèle qc au chargement (qcRun.service / qcProjectConfig.service chargent
// leurs modèles paresseusement).
//
// Routes :
//  - POST /api/qc/runs           (auth JWT) lance un run QC manuel
//  - GET  /api/qc/runs           (auth JWT) liste les runs récents
//  - GET  /api/qc/runs/:id       (auth JWT) détail d'un run + résultats + warnings
//  - POST /api/qc/da-callback    (jeton HMAC dans l'URL) complétion onComplete de DA
//  - GET  /api/qc/controls/cible-descriptions  (auth JWT) catalogue formulaire (lot 1)
//  - GET  /api/qc/projects/:projectKey/config  (auth JWT) lecture config projet
//  - PUT|POST /api/qc/projects/:projectKey/config (auth JWT) écriture merge + validation
//  - POST/GET/PATCH/DELETE /api/qc/jobs[/:id] (auth JWT) CRUD tâches QC
//  - POST /api/qc/jobs/:id/run (auth JWT) Run Now — scheduler async B2.2

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { authenticateToken } = require('../middleware/auth.middleware');
const qcRunService = require('../services/qcRun.service');
const qcProjectConfigService = require('../services/qcProjectConfig.service');
const qcJobService = require('../services/qcJob.service');

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
 * Extrait la désignation lisible du modèle depuis le body (aucun GUID codé en dur) :
 *  { accUrl }                                        — URL ACC Docs du fichier
 *  { hubName|hubId, projectName|projectId, fileName }— identifiants lisibles
 *  { projectId, itemUrn }                            — identifiants directs DM
 */
function extractDesignation(body) {
  const { accUrl, hubId, hubName, projectId, projectName, fileName, itemUrn } = body || {};
  return { accUrl, hubId, hubName, projectId, projectName, fileName, itemUrn };
}

/**
 * POST /api/qc/runs
 * Body: désignation (voir extractDesignation) + { runType?: 'quotidien'|'jalon', jobId? }
 * La version Revit et la garde workshared sont résolues par métadonnée DM (un seul GET,
 * sans ouverture) ; routage vers l'activity 2024 ou 2025 selon la version résolue.
 */
router.post('/runs', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const { runType, jobId, simulerEchec } = req.body || {};
    const run = await qcRunService.startRun({
      user: req.user,
      designation: extractDesignation(req.body),
      runType: runType || 'quotidien',
      jobId: jobId || null,
      simulerEchec: simulerEchec || null, // TEST uniquement (isolation des extracteurs)
    });
    // Un run refusé par une garde est créé failed sans workitem : 200 avec le run,
    // le client lit run.status / run.message.
    return res.status(202).json({ success: true, run });
  } catch (err) {
    logger.error(`[QC] POST /runs: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/qc/resolve — résolution SEULE, lecture DM uniquement.
 * Aucun run créé, aucun workitem soumis. Sert au diagnostic et aux tests
 * (version annoncée, statut workshared, GUIDs, région).
 */
router.post('/resolve', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const apsAuthService = require('../services/apsAuth.service');
    const resolver = require('../services/qcModelResolver.service');
    const accessToken = await apsAuthService.ensureValidToken(req.userId);
    const ref = await resolver.resolveDesignation(extractDesignation(req.body), accessToken);
    const resolved = await resolver.resolveModel(ref, accessToken);
    return res.json({ success: true, resolved });
  } catch (err) {
    logger.error(`[QC] POST /resolve: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/qc/runs?limit=20&projectId=b.<guid>|accProjectGuid
 * Filtre optionnel : id DM `b.<guid>` OU GUID ACC nu (ou `b.<accGuid>`).
 * Résolution via qc.projects (même mapping que resolvePrefixedProjectId / scoring) —
 * le strip naïf de `b.` ne matche PAS accProjectGuid C4R (souvent un autre UUID).
 */
router.get('/runs', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const { QCRun, QCJob } = qcRunService.getModels();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    const where = {};
    if (req.query.projectId) {
      const pid = String(req.query.projectId).trim();
      try {
        // Log explicite si pas de ligne qc.projects pour un id DM (fallback strip dans resolve).
        if (/^b\./i.test(pid)) {
          const { QCProject } = qcRunService.getModels();
          const mapped = await QCProject.findOne({ where: { projectId: pid } });
          if (!mapped?.accProjectGuid) {
            logger.warn(
              `[QC] GET /runs: aucun mapping qc.projects pour projectId=${pid} — fallback strip b. (peut rester vide)`
            );
          }
        }
        const resolved = await qcProjectConfigService.resolvePrefixedProjectId(pid);
        if (!resolved.accProjectGuid) {
          logger.warn(`[QC] GET /runs: accProjectGuid non résolu pour projectId=${pid} — liste vide`);
          return res.json({ success: true, runs: [] });
        }
        where.accProjectGuid = String(resolved.accProjectGuid).toLowerCase();
      } catch (resolveErr) {
        // Guid nu sans ligne qc.projects → 404 côté resolve : liste vide, pas 500.
        if (resolveErr.statusCode === 404) {
          logger.warn(`[QC] GET /runs: ${resolveErr.message}`);
          return res.json({ success: true, runs: [] });
        }
        if (resolveErr.statusCode === 400) {
          return res.status(400).json({ success: false, message: resolveErr.message });
        }
        throw resolveErr;
      }
    }
    const runs = await QCRun.findAll({
      where,
      include: [
        {
          model: QCJob,
          as: 'job',
          attributes: ['id', 'name', 'modelName'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
    });
    return res.json({ success: true, runs });
  } catch (err) {
    logger.error(`[QC] GET /runs: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/qc/runs/:id — détail run + résultats enrichis (catalogue) + warnings G408.
 * Lecture seule ; même forme pour UI et fiche Excel (lot 2).
 */
router.get('/runs/:id', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const qcRunDetailService = require('../services/qcRunDetail.service');
    const data = await qcRunDetailService.getRunDetail(req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) logger.error(`[QC] GET /runs/:id: ${err.message}`);
    else logger.warn(`[QC] GET /runs/:id: ${err.message}`);
    return res.status(status).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/qc/runs/:id/fiche — téléchargement fiche de contrôle Excel (gabarit rempli).
 * Réutilise qcRunDetail.service ; gabarit en lecture seule.
 */
router.get('/runs/:id/fiche', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const qcFicheExcelService = require('../services/qcFicheExcel.service');
    const { buffer, fileName, meta } = await qcFicheExcelService.buildFiche(req.params.id);
    logger.info(
      `[QC] Fiche Excel run=${meta.runId} file=${fileName} OK=${meta.okCount} àRéviser=${meta.aReviserCount}` +
        (meta.missingInTemplate?.length ? ` missing=${meta.missingInTemplate.join(',')}` : '')
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) logger.error(`[QC] GET /runs/:id/fiche: ${err.message}`);
    else logger.warn(`[QC] GET /runs/:id/fiche: ${err.message}`);
    return res.status(status).json({ success: false, message: err.message });
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

// ---------------------------------------------------------------------------
// Lot 1 — formulaire de configuration (couche données uniquement)
// Clé project_config = projectId PRÉFIXÉ "b.<guid>" (voir qcProjectConfig.service).
// ---------------------------------------------------------------------------

/**
 * GET /api/qc/controls/cible-descriptions
 * Métadonnées formulaire par contrôle actif (descriptionCible, nature Auto/Mixte/Manuel).
 * N'expose pas les détails techniques d'extraction inutiles au rendu.
 */
router.get('/controls/cible-descriptions', authenticateToken, async (req, res) => {
  try {
    const payload = qcProjectConfigService.getCibleDescriptions();
    return res.json({ success: true, ...payload });
  } catch (err) {
    logger.error(`[QC] GET /controls/cible-descriptions: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/qc/projects/:projectKey/config
 * projectKey = "b.<guid>" OU accProjectGuid nu (résolu comme le scoreur).
 * Aucune ligne créée en lecture ; config absente → { controles: {}, criticite: null }.
 */
router.get('/projects/:projectKey/config', authenticateToken, async (req, res) => {
  try {
    const result = await qcProjectConfigService.getProjectConfig(req.params.projectKey);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`[QC] GET /projects/:projectKey/config: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * PUT|POST /api/qc/projects/:projectKey/config
 * Body: { controles?: { [code]: object|null }, criticite?: object|null }
 * Validation dérivée du catalogue (descriptionCible.validation) avant écriture.
 * Merge au niveau controles[code] ; upsert sous projectId préfixé.
 */
async function writeProjectConfig(req, res) {
  try {
    const result = await qcProjectConfigService.upsertProjectConfig(req.params.projectKey, req.body);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`[QC] ${req.method} /projects/:projectKey/config: ${err.message}`);
    const body = { success: false, message: err.message };
    if (Array.isArray(err.errors)) body.errors = err.errors;
    return res.status(httpStatus(err)).json(body);
  }
}

router.put('/projects/:projectKey/config', authenticateToken, writeProjectConfig);
router.post('/projects/:projectKey/config', authenticateToken, writeProjectConfig);

// ---------------------------------------------------------------------------
// CRUD tâches QC (qc.jobs) + Run Now (B2.2)
// Planification via scheduler (async DA, sans lock projet).
// ⚠️ Ne pas requérir les modèles qc au chargement de ce fichier (lazy via service).
// ---------------------------------------------------------------------------

/**
 * POST /api/qc/jobs
 * Body: name?, projectId (b.<guid>), projectName?, hubId?, modelUrn (ou itemUrn),
 *       modelName?, region?, accProjectGuid?, accModelGuid?,
 *       scheduleEnabled? (défaut false), cronExpression?, timezone?
 */
router.post('/jobs', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const job = await qcJobService.createJob(req.userId, req.body || {});
    return res.status(201).json({ success: true, data: job });
  } catch (err) {
    logger.error(`[QC] POST /jobs: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/qc/jobs?projectId=&active=
 * Liste globale (comme Publish) ; filtre optionnel projectId (b.<guid>).
 */
router.get('/jobs', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const jobs = await qcJobService.listJobs({
      projectId: req.query.projectId,
      active: req.query.active,
    });
    return res.json({ success: true, data: jobs });
  } catch (err) {
    logger.error(`[QC] GET /jobs: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/qc/jobs/:id
 */
router.get('/jobs/:id', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const job = await qcJobService.getJobById(req.params.id);
    return res.json({ success: true, data: job });
  } catch (err) {
    logger.error(`[QC] GET /jobs/:id: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * PATCH /api/qc/jobs/:id
 * Persiste name/cron/timezone/cibles/scheduleEnabled (+ replanifie si besoin).
 */
router.patch('/jobs/:id', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const job = await qcJobService.updateJob(req.params.id, req.body || {});
    return res.json({ success: true, data: job });
  } catch (err) {
    logger.error(`[QC] PATCH /jobs/:id: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/qc/jobs/:id
 * Les runs liés gardent jobId NULL (ON DELETE SET NULL) — preuve conservée.
 */
router.delete('/jobs/:id', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    await qcJobService.deleteJob(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    logger.error(`[QC] DELETE /jobs/:id: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/qc/jobs/:id/run — Run Now (B2.2)
 * Branche scheduler QC async : soumet DA et rend la main (pas de lock projet).
 */
router.post('/jobs/:id/run', authenticateToken, async (req, res) => {
  if (!qcRunService.isReady()) return notReady(res);
  try {
    const run = await qcJobService.runJobNow(req.params.id);
    return res.status(202).json({ success: true, data: run });
  } catch (err) {
    logger.error(`[QC] POST /jobs/:id/run: ${err.message}`);
    return res.status(httpStatus(err)).json({ success: false, message: err.message });
  }
});

module.exports = router;
