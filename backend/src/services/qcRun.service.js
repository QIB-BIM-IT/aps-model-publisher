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
const logger = require('../config/logger');
const apsAuthService = require('./apsAuth.service');
const qcDa = require('./qcDesignAutomation.service');

const POLL_INTERVAL_MS = parseInt(process.env.QC_POLL_INTERVAL_MS || '30000', 10);
const POLL_TIMEOUT_MS = parseInt(process.env.QC_POLL_TIMEOUT_MS || '1200000', 10); // 20 min
const CONTROL_CODE = 'G408';

// Régions supportées par l'ouverture cloud directe (le repli download+copie détachée
// pour CAN se branchera dans l'addin via IModelSource, pas ici).
const SUPPORTED_REGIONS = ['US', 'EMEA'];

// Sentinelle pour les runs refusés AVANT identification du modèle cloud (garde
// workshared) : accModelGuid est NOT NULL en base, mais un modèle non workshared
// n'a pas de GUID de modèle cloud. Le contexte réel est dans stats.itemUrn.
const NIL_GUID = '00000000-0000-0000-0000-000000000000';

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

  // ======== Lancement d'un run (désignation lisible → resolver → garde → routage) ========

  /**
   * @param {object} p
   * @param {object} p.user        - contexte du token 3 legs (req.user) : {id, name, autodeskId}
   * @param {object} p.designation - { accUrl } | { hubName|hubId, projectName|projectId, fileName }
   *                                 | { projectId, itemUrn } — aucun GUID codé en dur
   * @param {string} [p.runType]   - 'quotidien' (défaut) | 'jalon'
   * @param {string} [p.jobId]     - job qc à rattacher (optionnel)
   * @param {string} [p.simulerEchec] - TEST UNIQUEMENT : code du contrôle MODÈLE à faire
   *                                    échouer dans l'addin (preuve d'isolation)
   */
  async startRun({ user, designation, runType = 'quotidien', jobId = null, simulerEchec = null }) {
    if (!this._ready) throw this._err(503, 'Module QC non initialisé');
    if (!qcDa.isConfigured()) throw this._err(503, qcDa.configurationHint());
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

    // Résolution : désignation → (projectId, itemUrn) → métadonnée C4RModel (UN GET DM,
    // sans ouverture, sans Model Derivative)
    const resolver = require('./qcModelResolver.service');
    const ref = await resolver.resolveDesignation(designation || {}, accessToken);
    const resolved = await resolver.resolveModel(ref, accessToken);

    if (!SUPPORTED_REGIONS.includes(resolved.region)) {
      throw this._err(
        400,
        `Région "${resolved.region}" non supportée pour l'ouverture cloud (attendu: ${SUPPORTED_REGIONS.join(' ou ')}). ` +
          'Le repli pour la région Canada sera branché ultérieurement dans l\'addin (IModelSource).'
      );
    }

    // GARDE workshared (double signal vérifié) : run failed, AUCUN workitem
    if (!resolved.workshared) {
      return this._createFailedRun({
        user,
        jobId,
        runType,
        resolved,
        message:
          `Hors périmètre CQ : modèle non workshared (extension.type=${resolved.extensionType || 'inconnu'}` +
          `${resolved.modelType ? `, modelType=${resolved.modelType}` : ''}). Aucun workitem soumis.`,
        guard: 'workshared',
      });
    }

    // Routage par version résolue : version hors ensemble configuré → failed, AUCUN workitem
    const version = resolved.revitVersion;
    const activityId = qcDa.activityIdFor(version);
    if (!activityId) {
      return this._createFailedRun({
        user,
        jobId,
        runType,
        resolved,
        message:
          `Version Revit ${version || 'inconnue'} non supportée ` +
          `(activities configurées: ${qcDa.configuredVersions().join(', ') || 'aucune'}). Aucun workitem soumis.`,
        guard: 'version',
      });
    }

    const { QCRun } = this.getModels();
    const run = await QCRun.create({
      jobId,
      userId: user.id,
      executedByName: user.name || null,
      executedByAutodeskId: user.autodeskId || null,
      runType,
      startedAtUtc: new Date(),
      revitVersion: version,
      region: resolved.region,
      accProjectGuid: resolved.projectGuid,
      accModelGuid: resolved.modelGuid,
      modelVersion: resolved.dmVersionNumber,
      versionUrn: resolved.versionUrn,
      status: 'queued',
      stats: {
        itemUrn: resolved.itemUrn,
        fileName: resolved.fileName,
        activityId,
        // Chantier 3 : snapshot métadonnée pour les contrôles MÉTA — calculés tôt,
        // persistés SEULEMENT à la finalisation, avec les lignes MODÈLE (amendement :
        // un run échoué n'a AUCUNE ligne, pas de MÉTA orphelines).
        meta: {
          storageSize: resolved.storageSize ?? null,
          revitVersion: version,
          fileName: resolved.fileName ?? null,
        },
      },
    });

    try {
      await qcDa.ensureBucket();
      const objectKey = `qc-result-${run.id}.json`;
      const resultUrl = await qcDa.createSignedResultUrl(objectKey);

      const onCompleteUrl = this._buildCallbackUrl(run.id);

      // G504/G508/G210/G314 : configs EFFECTIVES résolues ICI et passées à l'addin.
      let uniformat = null;
      let g508 = null;
      let g507 = null;
      let g210 = null;
      let g314 = null;
      let g205 = null;
      let g111 = null;
      try {
        const qcScoring = require('./qcScoring.service');
        const projectConfig = await qcScoring.loadProjectConfig(resolved.projectGuid);
        uniformat = qcScoring.resolveUniformatConfig(projectConfig.controles);
        g508 = qcScoring.resolveG508Config(projectConfig.controles);
        g507 = qcScoring.resolveG507Config(projectConfig.controles);
        g210 = qcScoring.resolveG210Config(projectConfig.controles);
        g314 = qcScoring.resolveG314Config(projectConfig.controles);
        g205 = qcScoring.resolveG205Config(projectConfig.controles);
        g111 = qcScoring.resolveG111Config(projectConfig.controles);
      } catch (e) {
        logger.warn(`[QC] Résolution config UNIFORMAT/G508/G507/G210/G314/G205/G111 échouée (non bloquant): ${e.message}`);
      }

      const workitemId = await qcDa.submitWorkitem({
        activityId,
        inputParams: {
          controlCode: CONTROL_CODE,
          region: resolved.region,
          projectGuid: resolved.projectGuid,
          modelGuid: resolved.modelGuid,
          ...(simulerEchec ? { simulerEchec } : {}),
          ...(uniformat ? { uniformat } : {}),
          ...(g508 ? { g508 } : {}),
          ...(g507 ? { g507 } : {}),
          ...(g210 ? { g210 } : {}),
          ...(g314 ? { g314 } : {}),
          ...(g205 ? { g205 } : {}),
          ...(g111 ? { g111 } : {}),
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

      logger.info(
        `[QC] Run ${run.id} soumis (workitem=${workitemId}, activity=${activityId}, region=${resolved.region}, revit=${version}, type=${runType})`
      );
      return run;
    } catch (e) {
      await run
        .update({ status: 'failed', endedAtUtc: new Date(), message: `Soumission workitem échouée: ${e.message}` })
        .catch(() => {});
      throw e;
    }
  }

  /**
   * Run refusé par une garde AVANT toute soumission : trace ISO 19650 conservée
   * (snapshots, contexte modèle dans stats), daWorkitemId NULL, statut failed.
   */
  async _createFailedRun({ user, jobId, runType, resolved, message, guard }) {
    const { QCRun } = this.getModels();
    // accProjectGuid réel dérivable du projectId DM (b.<guid>) ; accModelGuid n'existe
    // pas pour un non-workshared → sentinelle NIL_GUID (colonnes NOT NULL, zéro ALTER).
    const projectGuidFromDm = String(resolved.projectId || '').replace(/^b\./, '');
    const now = new Date();
    const run = await QCRun.create({
      jobId,
      userId: user.id,
      executedByName: user.name || null,
      executedByAutodeskId: user.autodeskId || null,
      runType,
      startedAtUtc: now,
      endedAtUtc: now,
      revitVersion: resolved.revitVersion || null,
      region: resolved.region,
      accProjectGuid: resolved.projectGuid || (this._isGuid(projectGuidFromDm) ? projectGuidFromDm : NIL_GUID),
      accModelGuid: resolved.modelGuid || NIL_GUID,
      modelVersion: resolved.dmVersionNumber,
      versionUrn: resolved.versionUrn,
      status: 'failed',
      message,
      stats: {
        guard,
        itemUrn: resolved.itemUrn,
        fileName: resolved.fileName,
        extensionType: resolved.extensionType,
        modelType: resolved.modelType,
      },
    });
    logger.warn(`[QC] Run ${run.id} refusé (garde=${guard}): ${message}`);
    return run;
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
        const message = await this._buildFailureMessage(run, workitem, wiStatus);
        await run.update({
          status: 'failed',
          endedAtUtc: new Date(),
          message,
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

  /**
   * Normalise le result.json en liste d'outcomes, quel que soit son schéma :
   *  - v2 (chantier 3) : { schemaVersion: 2, controls: [...] }
   *  - v1 (tranches 1-2, compat retour arrière d'alias bundle) : G408 seul à la racine
   */
  _normalizeResultPayload(result) {
    if (result && Array.isArray(result.controls)) {
      return result.controls;
    }
    if (result && typeof result.total === 'number') {
      return [
        {
          controlCode: result.controlCode || CONTROL_CODE,
          etatExtraction: 'extrait',
          total: result.total,
          critical: result.critical ?? 0,
          warnings: Array.isArray(result.warnings) ? result.warnings : [],
        },
      ];
    }
    throw new Error('result.json invalide (ni payload v2 controls[], ni payload v1 G408)');
  }

  async _finalizeSuccess(run, workitem) {
    const { sequelize } = require('../config/database');
    const { QCRun, QCControlResult, QCWarning } = this.getModels();
    const qcScoring = require('./qcScoring.service');
    const qcMetaControls = require('./qcMetaControls.service');

    const resultUrl = run.stats?.resultUrl;
    if (!resultUrl) throw new Error('URL du résultat absente des stats du run');

    const result = await qcDa.downloadResult(resultUrl);

    // Fusion MÉTA + MODÈLE sous le même runId. AMENDEMENT chantier 3 : TOUT est
    // persisté ici, dans UNE transaction — un run échoué n'a aucune ligne.
    const modelOutcomes = this._normalizeResultPayload(result);
    const metaOutcomes = qcMetaControls.computeMetaControls(run.stats?.meta || {});
    const outcomes = [...metaOutcomes, ...modelOutcomes];

    const projectConfig = await qcScoring.loadProjectConfig(run.accProjectGuid);
    const gridAvailable = qcScoring.isGridAvailable();

    const statsControls = {};
    let g408 = null; // { outcome, scoring } pour les stats du run (compat historique)

    // Un run automatique : signature humaine (controleur, date_controle, regle) laissée à NULL.
    await sequelize.transaction(async (t) => {
      for (const outcome of outcomes) {
        const code = outcome.controlCode || '(inconnu)';

        // RÈGLE ABSOLUE des deux axes : un échec d'extraction ne produit JAMAIS de
        // statut — aucun scoreur n'est appelé, les colonnes de valeur restent vides.
        if (outcome.etatExtraction === 'echec') {
          await QCControlResult.create(
            {
              runId: run.id,
              controlCode: code,
              etat_extraction: 'echec',
              erreur_extraction: String(outcome.erreur || 'Erreur d\'extraction non détaillée'),
              statut: null,
            },
            { transaction: t }
          );
          statsControls[code] = { etat: 'echec' };
          logger.warn(`[QC] Run ${run.id}: contrôle ${code} en échec d'extraction — ${outcome.erreur}`);
          continue;
        }

        if (code === CONTROL_CODE) {
          // G408 — chemin historique INCHANGÉ (scoring par Guid, grille + surcharge)
          const warnings = Array.isArray(outcome.warnings) ? outcome.warnings : [];
          let scoring = null;
          if (gridAvailable) {
            scoring = qcScoring.scoreWarnings(warnings, projectConfig.criticite);
            logger.info(
              `[QC][Scoring] Run ${run.id}: critique=${scoring.counts.critique} faible=${scoring.counts.faible} ` +
                `statut=${scoring.statut}${projectConfig.criticite ? ' (surcharge projet appliquée)' : ''}`
            );
          }
          const criticalCount = scoring ? scoring.critical : outcome.critical ?? 0;

          const controlResult = await QCControlResult.create(
            {
              runId: run.id,
              controlCode: code,
              etat_extraction: 'extrait',
              valeur_num: outcome.total,
              valeur_json: { total: outcome.total, critical: criticalCount, parNiveau: scoring ? scoring.counts : undefined },
              statut: scoring ? scoring.statut : null,
            },
            { transaction: t }
          );

          if (warnings.length) {
            await QCWarning.bulkCreate(
              warnings.map((w, i) => ({
                controlResultId: controlResult.id,
                runId: run.id,
                severity: w.severity === 'critical' ? 'critical' : 'warning',
                criticite: scoring ? scoring.levels[i] : null,
                description: String(w.description || '(sans description)'),
                elementIds: Array.isArray(w.elementIds) ? w.elementIds : [],
                raw: w,
              })),
              { transaction: t }
            );
          }

          g408 = { outcome, criticalCount, scoring };
          statsControls[code] = { etat: 'extrait', statut: scoring ? scoring.statut : null, total: outcome.total };
          continue;
        }

        // Contrôles génériques (MÉTA ou MODÈLE) : scoreur par forme, cible projet
        // exclusivement — pas de cible => statut NULL (valeur relevée, pas de verdict).
        const statut = qcScoring.scoreByForme(code, outcome, projectConfig.controles);

        // Lot NOMMAGE (option A validée) : le détail des noms fautifs est réinjecté
        // dans valeur_json via la méthode PURE evaluerNommage — le contrat de
        // scoreByForme (statut seul) reste intact, aucun effet de bord sur outcome.
        let valeurJson = outcome.valeurJson ?? null;
        const entry = qcScoring.catalogEntry(code);
        let cibleGenerique = projectConfig.controles?.[code]?.cible;
        // G404 : cible EFFECTIVE = norme maison listePrefixes (+ surcharge projet)
        if (entry?.forme === 'nommage' && code === 'G404') {
          cibleGenerique = qcScoring.resolveG404Cible(projectConfig.controles);
        }
        if (entry?.forme === 'nommage' && cibleGenerique != null && statut !== null) {
          const champ = entry.champListe || 'noms';
          const noms = Array.isArray(outcome.valeurJson?.[champ]) ? outcome.valeurJson[champ] : [];
          const { nomsNonConformes } = qcScoring.evaluerNommage(noms, cibleGenerique, code);
          valeurJson = { ...(outcome.valeurJson || {}), nommage: { nomsNonConformes } };
        }
        // Lot COORDONNÉES (option A, comme 'nommage') : le détail par axe (dont l'axe fautif)
        // est réinjecté dans valeur_json via la méthode PURE evaluerCoordonnees — contrat de
        // scoreByForme (statut seul) intact, aucun effet de bord sur outcome.
        if (entry?.forme === 'coordonnees' && cibleGenerique != null && statut !== null) {
          const champ = entry.champObjet || 'coordonnees';
          const releve = outcome.valeurJson?.[champ];
          const { axes, axesHorsTolerance } = qcScoring.evaluerCoordonnees(releve, cibleGenerique, code);
          valeurJson = { ...(outcome.valeurJson || {}), coordonnees: { axes, axesHorsTolerance } };
        }

        await QCControlResult.create(
          {
            runId: run.id,
            controlCode: code,
            etat_extraction: 'extrait',
            valeur_num: Number.isFinite(outcome.valeurNum) ? outcome.valeurNum : null,
            valeur_text: outcome.valeurText ?? null,
            valeur_json: valeurJson,
            statut,
          },
          { transaction: t }
        );
        statsControls[code] = { etat: 'extrait', statut, valeurNum: outcome.valeurNum ?? null };
      }

      await QCRun.update(
        {
          status: 'success',
          endedAtUtc: new Date(),
          message: null,
          stats: {
            ...run.stats,
            // Compat historique : les champs G408 restent au premier niveau des stats
            total: g408?.outcome.total,
            critical: g408?.criticalCount,
            parNiveau: g408?.scoring ? g408.scoring.counts : undefined,
            statut: g408?.scoring ? g408.scoring.statut : undefined,
            warningsCount: g408 ? (g408.outcome.warnings || []).length : undefined,
            controls: statsControls,
            reportUrl: workitem.reportUrl || null,
          },
        },
        { where: { id: run.id }, transaction: t }
      );
    });

    logger.info(
      `[QC] ✅ Run ${run.id} succès: ${outcomes.length} contrôle(s) — ` +
        Object.entries(statsControls)
          .map(([c, s]) => `${c}:${s.etat}${s.statut ? `/${s.statut}` : ''}`)
          .join(' ') +
        (g408 ? ` — G408 total=${g408.outcome.total} critical=${g408.criticalCount}` : '')
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

  // ======== Diagnostic post-mortem d'un workitem échoué ========

  /**
   * Décision #4 (plan approuvé) : si l'engine annoncé refuse l'ouverture pour cause
   * de release (« not saved in current release »), message DÉDIÉ signalant
   * l'incohérence entre revitProjectVersion annoncé et la release réelle.
   * Cas réel confirmé (gabarit 2024). Aucun essai d'engine adjacent, aucune
   * réparation silencieuse — le run reste failed.
   */
  async _buildFailureMessage(run, workitem, wiStatus) {
    const generic = `Workitem DA terminé en ${wiStatus}`;
    const report = await qcDa.downloadReport(workitem.reportUrl);
    if (!report) return generic;

    if (/not saved in current release/i.test(report)) {
      return (
        `Le moteur Revit ${run.revitVersion} a refusé l'ouverture : la release réelle du modèle ` +
        `diffère de revitProjectVersion=${run.revitVersion} annoncé par la métadonnée ACC ` +
        `(incohérence connue, ex. gabarit migré). Aucun autre moteur n'est essayé — corriger le ` +
        `modèle ou sa métadonnée côté ACC.`
      );
    }

    // Sinon, remonter la première exception Revit du report pour un diagnostic direct
    const exLine = report
      .split('\n')
      .find((l) => /Autodesk\.Revit\.Exceptions|System\.[A-Za-z.]*Exception/.test(l));
    if (exLine) {
      return `${generic} — ${exLine.replace(/^\[[^\]]*\]\s*/, '').trim().slice(0, 300)}`;
    }
    return generic;
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
