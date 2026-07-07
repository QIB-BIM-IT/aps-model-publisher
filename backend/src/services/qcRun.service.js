// src/services/qcRun.service.js
// Orchestration des runs QC : création du run, soumission du workitem DA4R,
// complétion par double canal (callback onComplete + polling de secours),
// écriture des résultats G408 (control_results + warnings).
//
// Règles clés :
//  - Modèles qc chargés PARESSEUSEMENT (jamais avant sequelize.sync()) — voir getModels().
//  - Verrou de complétion EN BASE (update conditionnel sur status), jamais en mémoire :
//    le callback et le polling peuvent arriver sur des instances différentes.
//  - Token 3 legs rafraîchi via apsAuthService.ensureValidToken JUSTE AVANT le submit.
//  - Montée progressive code:all : un token 3 legs sans ce scope => erreur explicite
//    invitant l'utilisateur à se reconnecter ; aucune session existante n'est cassée.

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../config/logger');
const apsAuthService = require('./apsAuth.service');
const qcDa = require('./qcDesignAutomation.service');
const { apsConfig } = require('../config/aps.config');

const POLL_INTERVAL_MS = parseInt(process.env.QC_POLL_INTERVAL_MS || '30000', 10);
const POLL_TIMEOUT_MS = parseInt(process.env.QC_POLL_TIMEOUT_MS || '1200000', 10); // 20 min
const CONTROL_CODE = 'G408';
const REVIT_VERSION = '2024'; // engine unique de cette tranche (Autodesk.Revit+2024)

// Régions supportées par l'ouverture cloud directe (Q3 : pilote US/EMEA ;
// le repli download+copie détachée pour CAN se branchera dans l'addin, pas ici).
const SUPPORTED_REGIONS = ['US', 'EMEA'];

class QcRunService {
  constructor() {
    this._ready = false;
    this._models = null;
    this._pollTimers = new Map(); // Map<runId, Timeout> — confort local, PAS un verrou
  }

  // ======== Initialisation (appelée par server.js APRÈS connectDB/sync) ========

  async init() {
    const qcMigrator = require('../config/qcMigrator');
    const applied = await qcMigrator.migrateUp();
    if (applied.length) {
      logger.info(`[QC] Migrations appliquées: ${applied.join(', ')}`);
    }

    // Chargement des modèles qc — volontairement APRÈS sync() (échappent au sync du public)
    this._models = require('../models/qc');
    this._ready = true;
    logger.info('[QC] Module QC initialisé (schéma qc à jour, modèles chargés)');

    if (!qcDa.isConfigured()) {
      // Mode dégradé assumé : le module vit, mais les runs renverront une erreur explicite.
      logger.warn(`[QC] ⚠️ ${qcDa.configurationHint()}`);
    }

    // Reprise après crash/redémarrage : les runs en vol reprennent leur polling,
    // ceux jamais soumis sont marqués failed.
    await this._recoverInFlightRuns().catch((e) =>
      logger.warn(`[QC] Reprise des runs en vol échouée: ${e.message}`)
    );
  }

  isReady() {
    return this._ready;
  }

  getModels() {
    if (!this._models) {
      throw new Error('Module QC non initialisé (modèles qc non chargés)');
    }
    return this._models;
  }

  async _recoverInFlightRuns() {
    const { QCRun } = this.getModels();
    const { Op } = require('sequelize');

    const orphans = await QCRun.findAll({
      where: { status: 'queued', daWorkitemId: { [Op.is]: null } },
    });
    for (const run of orphans) {
      await run.update({
        status: 'failed',
        endedAtUtc: new Date(),
        message: 'Run interrompu avant soumission du workitem (redémarrage du serveur)',
      });
      logger.warn(`[QC] Run orphelin marqué failed: ${run.id}`);
    }

    const inFlight = await QCRun.findAll({
      where: { status: ['queued', 'submitted'], daWorkitemId: { [Op.not]: null } },
    });
    for (const run of inFlight) {
      logger.info(`[QC] Reprise du polling pour run ${run.id} (workitem=${run.daWorkitemId})`);
      this._startPolling(run.id, run.daWorkitemId);
    }
  }

  // ======== Vérification du scope code:all (montée progressive Q4) ========

  /**
   * Décode le payload JWT du token APS sans vérification de signature (lecture seule).
   * Retourne true/false, ou null si le token n'est pas décodable (on laisse alors DA trancher).
   */
  tokenHasCodeAll(accessToken) {
    try {
      const payload = JSON.parse(Buffer.from(String(accessToken).split('.')[1], 'base64url').toString('utf8'));
      const scopes = Array.isArray(payload.scope) ? payload.scope : String(payload.scope || '').split(/\s+/);
      return scopes.includes('code:all');
    } catch {
      return null;
    }
  }

  // ======== Lancement d'un run ========

  /**
   * @param {object} p
   * @param {object} p.user      - contexte du token 3 legs (req.user) : {id, name, autodeskId}
   * @param {string} p.region    - 'US' | 'EMEA'
   * @param {string} p.projectGuid - GUID ACC nu du projet
   * @param {string} p.modelGuid   - GUID ACC nu du modèle
   * @param {string} [p.runType]   - 'quotidien' (défaut) | 'jalon'
   * @param {string} [p.projectId] - id Data Management (b.xxx) pour résoudre la version (optionnel)
   * @param {string} [p.itemUrn]   - lineage URN pour résoudre la version (optionnel)
   * @param {string} [p.jobId]     - job qc à rattacher (optionnel)
   */
  async startRun({ user, region, projectGuid, modelGuid, runType = 'quotidien', projectId = null, itemUrn = null, jobId = null }) {
    if (!this._ready) throw this._err(503, 'Module QC non initialisé');
    if (!qcDa.isConfigured()) throw this._err(503, qcDa.configurationHint());

    const normRegion = String(region || '').toUpperCase();
    if (!SUPPORTED_REGIONS.includes(normRegion)) {
      throw this._err(
        400,
        `Région "${region}" non supportée dans cette tranche (attendu: ${SUPPORTED_REGIONS.join(' ou ')}). ` +
          'Le repli pour la région Canada sera branché ultérieurement dans l\'addin (IModelSource).'
      );
    }
    if (!this._isGuid(projectGuid) || !this._isGuid(modelGuid)) {
      throw this._err(400, 'projectGuid et modelGuid doivent être des GUID ACC valides');
    }
    if (!['quotidien', 'jalon'].includes(runType)) {
      throw this._err(400, `runType invalide: "${runType}" (attendu: quotidien | jalon)`);
    }

    // Token 3 legs frais, rafraîchi JUSTE AVANT le submit (maximise sa durée de vie dans DA)
    const accessToken = await apsAuthService.ensureValidToken(user.id);

    // Montée progressive code:all : erreur explicite, aucune reconnexion forcée globale
    if (this.tokenHasCodeAll(accessToken) === false) {
      throw this._err(
        403,
        'Votre session Autodesk ne porte pas le scope code:all requis par le contrôle qualité. ' +
          'Déconnectez-vous puis reconnectez-vous à l\'application pour l\'activer. ' +
          'Les autres fonctionnalités (publish, PDF) ne sont pas affectées.'
      );
    }

    const { QCRun } = this.getModels();

    // Résolution best-effort de la version courante du modèle (non bloquante)
    const versionInfo = await this._resolveTipVersion(projectId, itemUrn, accessToken, normRegion).catch((e) => {
      logger.warn(`[QC] Résolution de version impossible (non bloquant): ${e.message}`);
      return null;
    });

    const run = await QCRun.create({
      jobId,
      userId: user.id,
      executedByName: user.name || null,
      executedByAutodeskId: user.autodeskId || null,
      runType,
      startedAtUtc: new Date(),
      revitVersion: REVIT_VERSION,
      region: normRegion,
      accProjectGuid: projectGuid,
      accModelGuid: modelGuid,
      modelVersion: versionInfo?.versionNumber ?? null,
      versionUrn: versionInfo?.versionUrn ?? null,
      status: 'queued',
      stats: {},
    });

    try {
      await qcDa.ensureBucket();
      const objectKey = `qc-result-${run.id}.json`;
      const resultUrl = await qcDa.createSignedResultUrl(objectKey);

      const onCompleteUrl = this._buildCallbackUrl(run.id);

      const workitemId = await qcDa.submitWorkitem({
        inputParams: {
          controlCode: CONTROL_CODE,
          region: normRegion,
          projectGuid,
          modelGuid,
        },
        resultUrl,
        threeLeggedToken: accessToken,
        onCompleteUrl,
      });

      await run.update({
        daWorkitemId: workitemId,
        status: 'submitted',
        stats: { ...run.stats, resultObjectKey: objectKey, resultUrl },
      });

      this._startPolling(run.id, workitemId);

      logger.info(`[QC] Run ${run.id} soumis (workitem=${workitemId}, region=${normRegion}, type=${runType})`);
      return run;
    } catch (e) {
      await run
        .update({ status: 'failed', endedAtUtc: new Date(), message: `Soumission workitem échouée: ${e.message}` })
        .catch(() => {});
      throw e;
    }
  }

  // ======== Complétion (double canal, verrou EN BASE) ========

  /**
   * Point d'entrée unique de finalisation — appelé par le callback onComplete ET par le polling.
   * Le verrou est un update conditionnel : seul l'appelant qui fait passer le run de
   * queued/submitted à running possède la finalisation. Les autres sortent sans rien faire.
   */
  async handleCompletion(runId, source = 'poll') {
    const { QCRun } = this.getModels();

    const run = await QCRun.findByPk(runId);
    if (!run || !run.daWorkitemId) return { handled: false, reason: 'run inconnu ou sans workitem' };
    if (['success', 'failed'].includes(run.status)) return { handled: false, reason: 'déjà finalisé' };

    // Ne jamais faire confiance au callback : on relit le statut réel du workitem.
    const workitem = await qcDa.getWorkitem(run.daWorkitemId);
    const wiStatus = String(workitem.status || '').toLowerCase();

    if (['pending', 'inprogress'].includes(wiStatus)) {
      return { handled: false, reason: `workitem encore ${wiStatus}` };
    }

    // Verrou de complétion en base (update conditionnel) — jamais en mémoire
    const [claimed] = await QCRun.update(
      { status: 'running' },
      { where: { id: runId, status: ['queued', 'submitted'] } }
    );
    if (claimed !== 1) {
      return { handled: false, reason: 'finalisation déjà en cours ailleurs' };
    }

    this._stopPolling(runId);
    logger.info(`[QC] Finalisation du run ${runId} (source=${source}, workitem status=${wiStatus})`);

    try {
      if (wiStatus === 'success') {
        await this._finalizeSuccess(run, workitem);
      } else {
        await run.update({
          status: 'failed',
          endedAtUtc: new Date(),
          message: `Workitem DA terminé en ${wiStatus}`,
          stats: { ...run.stats, reportUrl: workitem.reportUrl || null, daStats: workitem.stats || null },
        });
        logger.warn(`[QC] Run ${runId} échoué (workitem ${wiStatus}) — report: ${workitem.reportUrl || 'n/a'}`);
      }
      return { handled: true, status: wiStatus };
    } catch (e) {
      await run
        .update({ status: 'failed', endedAtUtc: new Date(), message: `Finalisation échouée: ${e.message}` })
        .catch(() => {});
      logger.error(`[QC] Finalisation du run ${runId} échouée: ${e.message}`);
      return { handled: true, status: 'failed', error: e.message };
    }
  }

  async _finalizeSuccess(run, workitem) {
    const { sequelize } = require('../config/database');
    const { QCRun, QCControlResult, QCWarning } = this.getModels();

    const resultUrl = run.stats?.resultUrl;
    if (!resultUrl) throw new Error('URL du résultat absente des stats du run');

    const result = await qcDa.downloadResult(resultUrl);
    if (!result || typeof result.total !== 'number') {
      throw new Error('result.json invalide (champ total manquant)');
    }

    // Un run automatique : signature humaine (controleur, date_controle, regle) laissée à NULL.
    await sequelize.transaction(async (t) => {
      const controlResult = await QCControlResult.create(
        {
          runId: run.id,
          controlCode: CONTROL_CODE,
          valeur_num: result.total,
          valeur_json: { total: result.total, critical: result.critical ?? 0 },
        },
        { transaction: t }
      );

      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      if (warnings.length) {
        await QCWarning.bulkCreate(
          warnings.map((w) => ({
            controlResultId: controlResult.id,
            runId: run.id,
            severity: w.severity === 'critical' ? 'critical' : 'warning',
            description: String(w.description || '(sans description)'),
            elementIds: Array.isArray(w.elementIds) ? w.elementIds : [],
            raw: w,
          })),
          { transaction: t }
        );
      }

      await QCRun.update(
        {
          status: 'success',
          endedAtUtc: new Date(),
          message: null,
          stats: {
            ...run.stats,
            total: result.total,
            critical: result.critical ?? 0,
            warningsCount: warnings.length,
            reportUrl: workitem.reportUrl || null,
          },
        },
        { where: { id: run.id }, transaction: t }
      );
    });

    logger.info(
      `[QC] ✅ Run ${run.id} succès: G408 total=${result.total} critical=${result.critical ?? 0} warnings=${(result.warnings || []).length}`
    );
  }

  // ======== Polling de secours ========

  _startPolling(runId, workitemId) {
    this._stopPolling(runId);
    const startedAt = Date.now();

    const tick = async () => {
      this._pollTimers.delete(runId);
      try {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          const { QCRun } = this.getModels();
          const [claimed] = await QCRun.update(
            {
              status: 'failed',
              endedAtUtc: new Date(),
              message: `Timeout: workitem ${workitemId} sans complétion après ${Math.round(POLL_TIMEOUT_MS / 60000)} min`,
            },
            { where: { id: runId, status: ['queued', 'submitted'] } }
          );
          if (claimed === 1) logger.error(`[QC] ⏱️ Run ${runId} timeout de polling`);
          return;
        }

        const { handled } = await this.handleCompletion(runId, 'poll');
        if (handled) return;

        // Le run est-il encore en vol ? (le callback a pu finaliser entre-temps)
        const { QCRun } = this.getModels();
        const run = await QCRun.findByPk(runId, { attributes: ['status'] });
        if (!run || ['success', 'failed'].includes(run.status)) return;
      } catch (e) {
        logger.warn(`[QC] Polling run ${runId}: ${e.message}`);
      }
      this._pollTimers.set(runId, setTimeout(tick, POLL_INTERVAL_MS));
    };

    this._pollTimers.set(runId, setTimeout(tick, POLL_INTERVAL_MS));
  }

  _stopPolling(runId) {
    const timer = this._pollTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this._pollTimers.delete(runId);
    }
  }

  // ======== Callback HMAC ========

  _callbackSecret() {
    return process.env.QC_CALLBACK_SECRET || process.env.WEBHOOK_SECRET || process.env.JWT_SECRET;
  }

  signCallback(runId) {
    return crypto.createHmac('sha256', this._callbackSecret()).update(String(runId)).digest('hex');
  }

  verifyCallbackSignature(runId, signature) {
    try {
      const expected = Buffer.from(this.signCallback(runId), 'hex');
      const given = Buffer.from(String(signature || ''), 'hex');
      return expected.length === given.length && crypto.timingSafeEqual(expected, given);
    } catch {
      return false;
    }
  }

  _buildCallbackUrl(runId) {
    // Base publique du callback DA. En local (Autodesk ne peut pas nous joindre),
    // laisser vide : le polling de secours assure la complétion.
    const base = process.env.QC_CALLBACK_BASE_URL || null;
    if (!base) return null;
    const sig = this.signCallback(runId);
    return `${base.replace(/\/+$/, '')}/api/qc/da-callback?runId=${encodeURIComponent(runId)}&sig=${sig}`;
  }

  // ======== Résolution de version DM (best-effort) ========

  async _resolveTipVersion(projectId, itemUrn, accessToken, region) {
    if (!projectId || !itemUrn) return null;
    const url = `${apsConfig.apis.baseUrl}/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemUrn)}/tip`;
    const headers = { Authorization: `Bearer ${accessToken}` };
    if (region && region !== 'US') headers['x-ads-region'] = region;
    const { data } = await axios.get(url, { headers, timeout: 30_000 });
    return {
      versionNumber: data?.data?.attributes?.versionNumber ?? null,
      versionUrn: data?.data?.id ?? null,
    };
  }

  // ======== Utils ========

  _isGuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  }

  _err(statusCode, message) {
    const e = new Error(message);
    e.statusCode = statusCode;
    return e;
  }
}

module.exports = new QcRunService();
