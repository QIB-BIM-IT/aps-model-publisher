// src/services/qcDashboard.service.js
// Agrégation en lecture seule pour les tableaux de bord QC thématiques.
// Générique : paramétrée par une liste de codes (hygiène, puis d'autres regroupements).
// Réutilise resolveProjectScope (derniers runs réussis) — ne le duplique pas.
// Résolution projet : resolvePrefixedProjectId via ce scope (b.<guid> ET GUID ACC, PR #202).

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const logger = require('../config/logger');
const qcProjectConfigService = require('./qcProjectConfig.service');
const qcDesignatedElementsQueryService = require('./qcDesignatedElementsQuery.service');

const CODE_RE = /^G\d{3}$/i;
const MAX_CODES = 40;
const NIL_GUID = '00000000-0000-0000-0000-000000000000';

function emptyPayload(project = null, controls = [], models = []) {
  return {
    project,
    controls,
    models,
    current: [],
    series: [],
    seriesByVersion: [],
    warningBreakdown: [],
  };
}

function parseControlCodes(raw) {
  const parts = String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => CODE_RE.test(s));
  const seen = new Set();
  const out = [];
  for (const c of parts) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= MAX_CODES) break;
  }
  return out;
}

function unitOf(code, entry) {
  if (entry?.unite) return entry.unite;
  if (entry?.descriptionCible?.unite) return entry.descriptionCible.unite;
  if (code === 'G408') return 'avertissements';
  return null;
}

/** Métadonnée d'affichage du delta. Distincte de `sens` (min/max) consommé par le scoring. */
const DESIRED_SENSE = new Set(['baisse', 'hausse', 'aucun']);

function desiredSenseOf(entry) {
  const v = entry?.sensSouhaitable;
  return DESIRED_SENSE.has(v) ? v : 'aucun';
}

/**
 * Affichage seulement : ce contrôle attend-il une cible / liste projet pour un verdict ?
 * Faux pour les contrôles indicatifs par nature et pour les règles maison
 * (G408, G412, G210…) — on n'invite pas à « configurer » ce qui n'a pas de cible.
 */
function attendCibleProjet(entry) {
  const tw = entry?.descriptionCible?.typeWidget;
  if (tw === 'indicatif' || tw === 'regleMaisonLectureSeule') return false;
  if (tw === 'parametreUniformat') return true;
  const cle = entry?.descriptionCible?.cleConfig;
  return cle != null && String(cle).trim() !== '';
}

function metaForCodes(codes) {
  const catalog = qcProjectConfigService.loadCatalog();
  return codes.map((code) => {
    const entry = catalog.controles?.[code] || {};
    return {
      code,
      libelle: entry.libelle || code,
      unite: unitOf(code, entry),
      section: qcProjectConfigService.sectionOf(code),
      sensSouhaitable: desiredSenseOf(entry),
      forme: entry.forme || null,
      typeWidget: entry.descriptionCible?.typeWidget || null,
      attendCibleProjet: attendCibleProjet(entry),
    };
  });
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** G102 : les runs anciens ont stocké des octets dans valeur_num ; l’unité catalogue est Mo. */
function valeurNumSuivie(code, row) {
  const n = numOrNull(row?.valeurNum);
  if (code === 'G102') {
    const mo = numOrNull(row?.valeurJsonSlim?.mo);
    if (mo != null) return mo;
    if (n != null && n >= 1048576) return Math.round((n / 1048576) * 100) / 100;
  }
  return n;
}

function extrasFromSlim(code, json) {
  if (!json || typeof json !== 'object') return null;
  if (code === 'G408') {
    const par = json.parNiveau && typeof json.parNiveau === 'object' ? json.parNiveau : {};
    return {
      total: numOrNull(json.total),
      critique: numOrNull(par.critique ?? json.critical),
      faible: numOrNull(par.faible),
    };
  }
  if (code === 'G412') {
    return {
      famillesInPlace: numOrNull(json.nbFamillesInPlace),
      typesGroupes: numOrNull(json.nbTypesGroupes),
    };
  }
  if (code === 'G504') {
    const c = json.couverture && typeof json.couverture === 'object' ? json.couverture : {};
    return {
      numerateur: numOrNull(c.numerateur),
      denominateur: numOrNull(c.denominateur),
      pourcentage: numOrNull(c.pourcentage),
      nature: typeof c.nature === 'string' ? c.nature : null,
      aucunElementDesign: json.aucunElementDesign === true,
      nbEntitesFautives: numOrNull(json.nbEntitesFautives),
      nbInstancesConcernees: numOrNull(json.nbInstancesConcernees),
    };
  }
  if (code === 'G508') {
    const g = json.global && typeof json.global === 'object' ? json.global : {};
    return {
      aucunParametre: json.aucunParametre === true,
      rempli: numOrNull(g.rempli),
      total: numOrNull(g.total),
      pourcentage: numOrNull(g.pourcentage),
    };
  }
  if (code === 'G507') {
    return {
      aucunParametre: json.aucunParametre === true,
      nbAttendus: numOrNull(json.nbAttendus),
      nbPresents: numOrNull(json.nbPresents),
      nbAbsents: numOrNull(json.nbAbsents),
    };
  }
  return null;
}

function valuePayload(row, code) {
  if (!row) {
    return {
      valeurNum: null,
      etatExtraction: null,
      statut: null,
      extras: null,
    };
  }
  const failed = row.etatExtraction === 'echec';
  return {
    valeurNum: failed ? null : valeurNumSuivie(code, row),
    etatExtraction: row.etatExtraction,
    statut: failed ? null : row.statut || null,
    extras: failed ? null : extrasFromSlim(code, row.valeurJsonSlim),
  };
}

const TREND_MAX_POINTS = 8;

function trendFromPoints(points) {
  return (points || []).slice(-TREND_MAX_POINTS).map((p) => ({
    at: p.at || null,
    modelVersion: p.modelVersion ?? null,
    valeurNum: p.valeurNum ?? null,
  }));
}

/**
 * Delta face à la version ACC précédente (dernier run retenu de cette version).
 * Fait numérique uniquement : aucun verdict, aucun seuil.
 */
function deltaFromPoints(currentVal, points) {
  const last = points.length ? points[points.length - 1] : null;
  const prev = points.length >= 2 ? points[points.length - 2] : null;
  const base = {
    available: false,
    reason: null,
    currentVersion: last?.modelVersion ?? null,
    currentAt: last?.at ?? null,
    previousVersion: prev?.modelVersion ?? null,
    previousAt: prev?.at ?? null,
    previousValeurNum: prev?.valeurNum ?? null,
    abs: null,
    rel: null,
  };

  if (currentVal?.etatExtraction === 'echec') {
    return { ...base, reason: 'extraction_failed' };
  }
  if (!prev) {
    return { ...base, reason: 'no_previous_version' };
  }

  const currN = currentVal?.valeurNum;
  const prevN = prev.valeurNum;
  if (currN == null || prevN == null) {
    return { ...base, reason: 'no_numeric' };
  }

  const abs = Math.round((currN - prevN) * 1e6) / 1e6;
  const rel = prevN === 0 ? null : abs / prevN;
  return {
    ...base,
    available: true,
    previousValeurNum: prevN,
    abs,
    rel,
  };
}

function attachCurrentDelta(current, seriesByVersion, codes) {
  const byKey = new Map();
  for (const s of seriesByVersion) {
    byKey.set(`${String(s.accModelGuid).toLowerCase()}|${s.controlCode}`, s.points || []);
  }
  for (const m of current) {
    const guid = String(m.accModelGuid).toLowerCase();
    if (!m.values) m.values = {};
    for (const code of codes) {
      if (!m.values[code]) m.values[code] = valuePayload(null, code);
      const points = byKey.get(`${guid}|${code}`) || [];
      m.values[code].trend = trendFromPoints(points);
      m.values[code].delta = deltaFromPoints(m.values[code], points);
    }
  }
}

class QcDashboardService {
  async getDashboard({ projectKey, controlsRaw, accModelGuid }) {
    const t0 = Date.now();
    const codes = parseControlCodes(controlsRaw);
    const controls = metaForCodes(codes);

    const scope = await qcDesignatedElementsQueryService.resolveProjectScope(
      projectKey,
      accModelGuid
    );

    const allModels = (scope.models || []).map((m) => ({
      accModelGuid: m.accModelGuid,
      modelName: m.modelName,
    }));

    if (!scope.project?.accProjectGuid) {
      return emptyPayload(scope.project, controls, allModels);
    }

    const filterGuid = accModelGuid ? String(accModelGuid).trim().toLowerCase() : '';
    const currentModels = filterGuid
      ? scope.models.filter((m) => String(m.accModelGuid).toLowerCase() === filterGuid)
      : scope.models;

    if (!currentModels.length) {
      return emptyPayload(scope.project, controls, allModels);
    }

    const guid = String(scope.project.accProjectGuid).toLowerCase();
    const historySql = `
      SELECT r.id AS "runId",
             r."accModelGuid" AS "accModelGuid",
             r."modelVersion" AS "modelVersion",
             r."startedAtUtc" AS "startedAtUtc",
             r."endedAtUtc" AS "endedAtUtc",
             COALESCE(j."modelName", NULLIF(r.stats->>'fileName', '')) AS "modelName"
      FROM qc.runs r
      LEFT JOIN qc.jobs j ON j.id = r."jobId"
      WHERE lower(r."accProjectGuid"::text) = :guid
        AND r.status = 'success'
        AND r."accModelGuid" <> :nil
        ${filterGuid ? 'AND lower(r."accModelGuid"::text) = :model' : ''}
      ORDER BY r."accModelGuid",
               COALESCE(r."endedAtUtc", r."startedAtUtc", r."createdAt") ASC`;

    const history = await sequelize.query(historySql, {
      replacements: {
        guid,
        nil: NIL_GUID,
        ...(filterGuid ? { model: filterGuid } : {}),
      },
      type: QueryTypes.SELECT,
    });

    const allRunIds = history.map((r) => r.runId);
    if (!allRunIds.length || !codes.length) {
      return {
        ...emptyPayload(scope.project, controls, allModels),
        current: currentModels.map((m) => ({
          accModelGuid: m.accModelGuid,
          modelName: m.modelName,
          runId: m.runId,
          modelVersion: m.modelVersion,
          startedAtUtc: m.startedAtUtc,
          endedAtUtc: m.endedAtUtc,
          values: {},
        })),
      };
    }

    // JSON allégé : ne pas remonter les listes (G410, G412, G402…).
    const results = await sequelize.query(
      `SELECT cr."runId" AS "runId",
              cr."controlCode" AS "controlCode",
              cr.valeur_num AS "valeurNum",
              cr.statut AS statut,
              cr.etat_extraction AS "etatExtraction",
              CASE
                WHEN cr."controlCode" = 'G408' THEN jsonb_build_object(
                  'total', cr.valeur_json->'total',
                  'critical', cr.valeur_json->'critical',
                  'parNiveau', cr.valeur_json->'parNiveau'
                )
                WHEN cr."controlCode" = 'G412' THEN jsonb_build_object(
                  'nbFamillesInPlace', cr.valeur_json#>'{famillesInPlace,nbFamillesInPlace}',
                  'nbTypesGroupes', cr.valeur_json#>'{groupes,nbTypesGroupes}'
                )
                WHEN cr."controlCode" = 'G102' THEN jsonb_build_object(
                  'mo', cr.valeur_json->'mo',
                  'octets', cr.valeur_json->'octets'
                )
                WHEN cr."controlCode" = 'G504' THEN jsonb_build_object(
                  'couverture', cr.valeur_json->'couverture',
                  'aucunElementDesign', cr.valeur_json->'aucunElementDesign',
                  'nbEntitesFautives', cr.valeur_json->'nbEntitesFautives',
                  'nbInstancesConcernees', cr.valeur_json->'nbInstancesConcernees'
                )
                WHEN cr."controlCode" = 'G508' THEN jsonb_build_object(
                  'aucunParametre', cr.valeur_json->'aucunParametre',
                  'global', cr.valeur_json->'global'
                )
                WHEN cr."controlCode" = 'G507' THEN jsonb_build_object(
                  'aucunParametre', cr.valeur_json->'aucunParametre',
                  'nbAttendus', cr.valeur_json->'nbAttendus',
                  'nbPresents', cr.valeur_json->'nbPresents',
                  'nbAbsents', cr.valeur_json->'nbAbsents'
                )
                ELSE NULL
              END AS "valeurJsonSlim"
       FROM qc.control_results cr
       WHERE cr."runId" IN (:runIds)
         AND cr."controlCode" IN (:codes)`,
      { replacements: { runIds: allRunIds, codes }, type: QueryTypes.SELECT }
    );

    const byRunCode = new Map();
    for (const row of results) {
      byRunCode.set(`${row.runId}|${row.controlCode}`, row);
    }

    const currentRunIds = currentModels.map((m) => m.runId);
    const warningByRun = new Map();
    if (codes.includes('G408') && currentRunIds.length) {
      const wrows = await sequelize.query(
        `SELECT "runId",
                COUNT(*)::int AS total,
                COUNT(*) FILTER (
                  WHERE criticite = 'critique'
                     OR (criticite IS NULL AND severity = 'critical')
                )::int AS critique,
                COUNT(*) FILTER (
                  WHERE criticite = 'faible'
                     OR (criticite IS NULL AND severity = 'warning')
                )::int AS faible
         FROM qc.warnings
         WHERE "runId" IN (:runIds)
         GROUP BY "runId"`,
        { replacements: { runIds: currentRunIds }, type: QueryTypes.SELECT }
      );
      for (const w of wrows) warningByRun.set(String(w.runId), w);
    }

    const current = currentModels.map((m) => {
      const values = {};
      for (const code of codes) {
        values[code] = valuePayload(byRunCode.get(`${m.runId}|${code}`), code);
      }
      return {
        accModelGuid: m.accModelGuid,
        modelName: m.modelName,
        runId: m.runId,
        modelVersion: m.modelVersion,
        startedAtUtc: m.startedAtUtc,
        endedAtUtc: m.endedAtUtc,
        values,
      };
    });

    const warningBreakdown = codes.includes('G408')
      ? currentModels.map((m) => {
          const row = byRunCode.get(`${m.runId}|G408`);
          const extras = extrasFromSlim('G408', row?.valeurJsonSlim);
          const fromJson =
            extras &&
            (extras.critique != null || extras.faible != null || extras.total != null);
          const fromTable = warningByRun.get(String(m.runId));
          return {
            accModelGuid: m.accModelGuid,
            runId: m.runId,
            total: fromJson ? extras.total ?? numOrNull(row?.valeurNum) : fromTable?.total ?? null,
            critique: fromJson ? extras.critique : fromTable?.critique ?? null,
            faible: fromJson ? extras.faible : fromTable?.faible ?? null,
            source: fromJson ? 'valeur_json' : fromTable ? 'warnings' : null,
          };
        })
      : [];

    const nameByModel = new Map();
    for (const m of currentModels) {
      if (m.modelName) nameByModel.set(String(m.accModelGuid).toLowerCase(), m.modelName);
    }
    for (const h of history) {
      const key = String(h.accModelGuid).toLowerCase();
      if (h.modelName && !nameByModel.has(key)) nameByModel.set(key, h.modelName);
    }

    const modelsInHistory = [];
    const seenModel = new Set();
    for (const h of history) {
      const key = String(h.accModelGuid).toLowerCase();
      if (seenModel.has(key)) continue;
      seenModel.add(key);
      modelsInHistory.push(key);
    }

    function pointFromRun(h, code) {
      const row = byRunCode.get(`${h.runId}|${code}`);
      const failed = row?.etatExtraction === 'echec';
      return {
        runId: h.runId,
        at: h.endedAtUtc || h.startedAtUtc,
        modelVersion: h.modelVersion,
        valeurNum: failed || !row ? null : valeurNumSuivie(code, row),
        etatExtraction: row?.etatExtraction || null,
        runCount: 1,
      };
    }

    function pointsByVersion(runs, code) {
      const groups = new Map();
      for (const h of runs) {
        const key = h.modelVersion == null ? '∅' : String(h.modelVersion);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(h);
      }
      const points = [];
      for (const group of groups.values()) {
        const last = group[group.length - 1];
        points.push({
          ...pointFromRun(last, code),
          runCount: group.length,
        });
      }
      points.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
      return points;
    }

    const seriesByVersion = [];
    for (const modelGuid of modelsInHistory) {
      const runs = history.filter((h) => String(h.accModelGuid).toLowerCase() === modelGuid);
      const modelName = nameByModel.get(modelGuid) || null;
      for (const code of codes) {
        // Un point par version ACC (dernier run réussi de la version).
        // Le jeu « un point par run » n'est plus calculé : aucun consommateur
        // hors de l'ancien basculement d'interface, retiré.
        seriesByVersion.push({
          accModelGuid: modelGuid,
          modelName,
          controlCode: code,
          points: pointsByVersion(runs, code),
        });
      }
    }

    attachCurrentDelta(current, seriesByVersion, codes);

    const ms = Date.now() - t0;
    const logLine =
      `[QC][Dashboard] agrégation ${ms}ms project=${guid} runs=${allRunIds.length}` +
      ` codes=${codes.length}${filterGuid ? ` model=${filterGuid}` : ''}`;
    if (ms > 400) logger.warn(logLine);
    else logger.info(logLine);

    return {
      project: scope.project,
      controls,
      models: allModels,
      current,
      series: [],
      seriesByVersion,
      warningBreakdown,
    };
  }
}

module.exports = new QcDashboardService();
