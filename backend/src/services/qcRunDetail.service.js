// src/services/qcRunDetail.service.js
// Détail d'un run QC pour consultation UI (lot 1) et fiche Excel (lot 2).
// Lecture seule : pas de recalcul de statut, pas d'écriture.

const logger = require('../config/logger');
const qcProjectConfigService = require('./qcProjectConfig.service');

/** Titres de section alignés sur le registre UI (qcTheme SECTION_TITLES). */
const SECTION_TITLES = {
  1: '1. Fichier',
  2: '2. Positionnement',
  3: '3. Contenu de la modélisation',
  4: '4. Organisation Revit',
  5: '5. Paramètres',
  6: '6. Export et métadonnées',
};

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function sectionKeyFromCode(code) {
  const n = parseInt(String(code || '').replace(/^G/i, ''), 10);
  if (!Number.isFinite(n)) return 99;
  if (n >= 100 && n < 200) return 1;
  if (n >= 200 && n < 300) return 2;
  if (n >= 300 && n < 400) return 3;
  if (n >= 400 && n < 500) return 4;
  if (n >= 500 && n < 600) return 5;
  if (n >= 600 && n < 700) return 6;
  return 99;
}

function controlNum(code) {
  const n = parseInt(String(code || '').replace(/^G/i, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function durationMs(startedAtUtc, endedAtUtc) {
  if (!startedAtUtc || !endedAtUtc) return null;
  const ms = new Date(endedAtUtc) - new Date(startedAtUtc);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

class QcRunDetailService {
  getModels() {
    // Chargé après sync() — même règle que qcRun.service
    return require('../models/qc');
  }

  /**
   * Charge un run + résultats + warnings, enrichi catalogue / projet / job.
   * @param {string} runId
   * @returns {Promise<object>} payload data
   */
  async getRunDetail(runId) {
    const id = String(runId || '').trim();
    if (!id) throw httpError(400, 'Identifiant de run requis');

    const { QCRun, QCControlResult, QCWarning, QCJob, QCProject } = this.getModels();

    const run = await QCRun.findByPk(id, {
      include: [
        {
          model: QCControlResult,
          as: 'controlResults',
          include: [
            {
              model: QCWarning,
              as: 'warnings',
              attributes: [
                'id',
                'severity',
                'criticite',
                'description',
                'elementIds',
                'createdAt',
              ],
            },
          ],
        },
        {
          model: QCJob,
          as: 'job',
          attributes: ['id', 'name', 'modelName', 'projectId', 'hubId'],
          required: false,
        },
      ],
    });

    if (!run) throw httpError(404, 'Run introuvable');

    const plain = run.toJSON();
    const stats = plain.stats && typeof plain.stats === 'object' ? plain.stats : {};

    let projectId = plain.job?.projectId || null;
    let hubId = plain.job?.hubId || null;
    let projectName = null;
    try {
      const proj = await QCProject.findOne({
        where: { accProjectGuid: String(plain.accProjectGuid).toLowerCase() },
      });
      if (proj) {
        projectId = projectId || proj.projectId;
        projectName = proj.projectName || null;
      }
    } catch (e) {
      logger.warn(`[QC] getRunDetail: lookup qc.projects: ${e.message}`);
    }

    const catalogMeta = qcProjectConfigService.getCibleDescriptions();
    const byCode = new Map((catalogMeta.controles || []).map((c) => [c.code, c]));
    const catalogFull = qcProjectConfigService.loadCatalog()?.controles || {};

    const resultsRaw = Array.isArray(plain.controlResults) ? plain.controlResults : [];
    const results = resultsRaw
      .map((cr) => {
        const meta = byCode.get(cr.controlCode) || {};
        const full = catalogFull[cr.controlCode] || {};
        const sectionKey = sectionKeyFromCode(cr.controlCode);
        const desc = meta.descriptionCible || {};
        const catalogUnite =
          full.unite ||
          desc.unite ||
          (cr.valeur_json && typeof cr.valeur_json === 'object' ? cr.valeur_json.unite : null) ||
          null;

        const warnings = Array.isArray(cr.warnings)
          ? cr.warnings.map((w) => ({
              id: w.id,
              severity: w.severity,
              criticite: w.criticite,
              description: w.description,
              elementIds: Array.isArray(w.elementIds) ? w.elementIds : [],
              createdAt: w.createdAt,
            }))
          : [];

        return {
          id: cr.id,
          controlCode: cr.controlCode,
          libelle: meta.libelle || cr.controlCode,
          sectionKey,
          section: SECTION_TITLES[sectionKey] || `Section ${sectionKey}`,
          cibleIntitule: desc.libelle || null,
          forme: meta.forme || full.forme || null,
          unite: catalogUnite,
          valeur_num: cr.valeur_num != null ? Number(cr.valeur_num) : null,
          valeur_text: cr.valeur_text ?? null,
          valeur_json: cr.valeur_json ?? null,
          etat_extraction: cr.etat_extraction,
          erreur_extraction: cr.erreur_extraction ?? null,
          statut: cr.statut ?? null,
          warnings,
        };
      })
      .sort((a, b) => {
        if (a.sectionKey !== b.sectionKey) return a.sectionKey - b.sectionKey;
        return controlNum(a.controlCode) - controlNum(b.controlCode);
      });

    let extraits = 0;
    let echecsExtraction = 0;
    let conformes = 0;
    let nonConformes = 0;
    let sansVerdict = 0;
    for (const r of results) {
      if (r.etat_extraction === 'echec') echecsExtraction += 1;
      else extraits += 1;
      if (r.statut === 'conforme') conformes += 1;
      else if (r.statut === 'non_conforme') nonConformes += 1;
      else sansVerdict += 1;
    }

    const startedAtUtc = plain.startedAtUtc || null;
    const endedAtUtc = plain.endedAtUtc || null;

    return {
      run: {
        id: plain.id,
        status: plain.status,
        runType: plain.runType,
        message: plain.message || null,
        startedAtUtc,
        endedAtUtc,
        durationMs: durationMs(startedAtUtc, endedAtUtc),
        projectId,
        projectName,
        hubId,
        accProjectGuid: plain.accProjectGuid,
        modelName: plain.job?.modelName || stats.fileName || null,
        accModelGuid: plain.accModelGuid,
        modelVersion: plain.modelVersion ?? null,
        versionUrn: plain.versionUrn || null,
        revitVersion: plain.revitVersion || null,
        executedByName: plain.executedByName || null,
        executedByAutodeskId: plain.executedByAutodeskId || null,
        jobId: plain.jobId || plain.job?.id || null,
        jobName: plain.job?.name || null,
        daWorkitemId: plain.daWorkitemId || null,
        region: plain.region || null,
      },
      summary: {
        total: results.length,
        extraits,
        echecsExtraction,
        conformes,
        nonConformes,
        sansVerdict,
      },
      results,
    };
  }
}

module.exports = new QcRunDetailService();
