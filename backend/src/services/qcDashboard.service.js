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

function parsePercentToken(text) {
  const m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(String(m[1]).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Cible de taux lue dans le catalogue ou la config projet — jamais inventée dans la page.
 * - pourcentage (G314) : controles[code].cible|seuil du projet, sinon absente
 * - couverture : défaut de la porte (catalogue activationPorte.defaut)
 * - règle / aide catalogue contenant « N % » (copie-contrôle, axes…)
 * - etatReference documenté « tolérance zéro » → 100 % de conformes (scoreur : 0 fautif)
 */
function resolveCiblePourcent(entry, projetCtrl) {
  const forme = entry?.forme;
  const dc = entry?.descriptionCible || {};
  if (forme === 'pourcentage') {
    return numOrNull(projetCtrl?.cible ?? projetCtrl?.seuil);
  }
  if (forme === 'couverture') {
    return numOrNull(dc.activationPorte?.defaut);
  }
  const parsed = parsePercentToken(dc.regle) ?? parsePercentToken(dc.aide);
  if (parsed != null) return parsed;
  if (
    forme === 'etatReference' &&
    /tol[eé]rance z[eé]ro/i.test(`${dc.regle || ''} ${dc.aide || ''}`)
  ) {
    return 100;
  }
  return null;
}

function metaForCodes(codes, projectControles) {
  const catalog = qcProjectConfigService.loadCatalog();
  const byCode = projectControles && typeof projectControles === 'object' ? projectControles : {};
  return codes.map((code) => {
    const entry = catalog.controles?.[code] || {};
    const unite =
      entry.forme === 'etatReference' ? 'pourcentage' : unitOf(code, entry);
    return {
      code,
      libelle: entry.libelle || code,
      unite,
      section: qcProjectConfigService.sectionOf(code),
      sensSouhaitable: desiredSenseOf(entry),
      forme: entry.forme || null,
      typeWidget: entry.descriptionCible?.typeWidget || null,
      attendCibleProjet: attendCibleProjet(entry),
      ciblePourcent: resolveCiblePourcent(entry, byCode[code]),
    };
  });
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundPercent(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Compte de fautifs + population → % de conformes (affichage / delta / séries). */
function slimHasFaultPopulation(json) {
  if (!json || typeof json !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(json, 'nbNiveaux')
    || Object.prototype.hasOwnProperty.call(json, 'nbAxes');
}

function percentConformesFromFaultCounts(json) {
  if (!json || typeof json !== 'object') return null;
  const nbFautifs = numOrNull(json.nbFautifs);
  const total = numOrNull(json.nbNiveaux) ?? numOrNull(json.nbAxes);
  if (nbFautifs == null || total == null || total <= 0) return null;
  return roundPercent(((total - nbFautifs) / total) * 100);
}

/** G102 : les runs anciens ont stocké des octets dans valeur_num ; l’unité catalogue est Mo. */
function valeurNumSuivie(code, row) {
  const json = row?.valeurJsonSlim;
  // Ne pas retomber sur valeur_num (fautifs) : cela mélangerait les unités avec le %.
  if (slimHasFaultPopulation(json)) {
    return percentConformesFromFaultCounts(json);
  }
  const n = numOrNull(row?.valeurNum);
  if (code === 'G102') {
    const mo = numOrNull(json?.mo);
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
      showPercent: true,
    };
  }
  if (code === 'G508') {
    const g = json.global && typeof json.global === 'object' ? json.global : {};
    return {
      aucunParametre: json.aucunParametre === true,
      rempli: numOrNull(g.rempli),
      total: numOrNull(g.total),
      numerateur: numOrNull(g.rempli),
      denominateur: numOrNull(g.total),
      pourcentage: numOrNull(g.pourcentage),
      ratioNoun: 'valeurs renseignées',
      showPercent: true,
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
  return extrasFromShape(json);
}

/**
 * Extras d'affichage dérivés de la forme JSON, pas du code.
 * Compte/total, pourcentage naturel, écart, coordonnées, vacuité.
 */
function extrasFromShape(json) {
  if (!json || typeof json !== 'object') return null;
  const out = {};
  if (json.vacuite === true) out.vacuite = true;

  const nbNiveaux = numOrNull(json.nbNiveaux);
  const nbAxes = numOrNull(json.nbAxes);
  const nbFautifs = numOrNull(json.nbFautifs);
  if (nbNiveaux != null && nbFautifs != null) {
    out.fautifs = nbFautifs;
    out.total = nbNiveaux;
    out.totalNoun = 'niveaux';
    out.numerateur = Math.max(0, nbNiveaux - nbFautifs);
    out.denominateur = nbNiveaux;
    out.pourcentage = nbNiveaux > 0 ? roundPercent(((nbNiveaux - nbFautifs) / nbNiveaux) * 100) : null;
    out.ratioNoun = 'niveaux verrouillés';
    out.showPercent = true;
  } else if (nbAxes != null && nbFautifs != null) {
    out.fautifs = nbFautifs;
    out.total = nbAxes;
    out.totalNoun = 'axes';
    out.numerateur = Math.max(0, nbAxes - nbFautifs);
    out.denominateur = nbAxes;
    out.pourcentage = nbAxes > 0 ? roundPercent(((nbAxes - nbFautifs) / nbAxes) * 100) : null;
    out.ratioNoun = 'axes verrouillés';
    out.showPercent = true;
  }

  const g = json.global && typeof json.global === 'object' ? json.global : null;
  if (g && g.soumisAudit != null) {
    out.numerateur = numOrNull(g.monitores);
    out.denominateur = numOrNull(g.soumisAudit);
    out.pourcentage = numOrNull(g.pourcentage);
    out.ratioNoun = 'éléments monitorés';
    out.showPercent = true;
  }

  const conformes = numOrNull(json.conformes);
  const evaluables = numOrNull(json.evaluables);
  if (conformes != null && evaluables != null) {
    out.numerateur = conformes;
    out.denominateur = evaluables;
    out.pourcentage = numOrNull(json.pourcentageConformite);
    out.ratioNoun = 'éléments rattachés';
    out.showPercent = true;
    const fautifsCount = numOrNull(
      typeof json.fautifs === 'number' ? json.fautifs : json.fautifsDetail?.total
    );
    if (fautifsCount != null) out.fautifsCount = fautifsCount;
  }

  const ecartMaxAbs = numOrNull(json.ecartMaxAbs);
  if (ecartMaxAbs != null) out.ecartMaxAbs = ecartMaxAbs;
  if (json.ecart && typeof json.ecart === 'object') out.ecart = json.ecart;
  if (json.surveyPoint && typeof json.surveyPoint === 'object') out.surveyPoint = json.surveyPoint;
  const angle = numOrNull(json.angleNordProjet);
  if (angle != null) out.angleNordProjet = angle;
  const axesCmp = Array.isArray(json.coordonnees?.axes) ? json.coordonnees.axes : [];
  const contreTolerance = axesCmp
    .map((a) => {
      if (!a || typeof a !== 'object') return null;
      const tolerance = numOrNull(a.tolerance);
      if (tolerance == null) return null;
      return {
        axe: typeof a.axe === 'string' ? a.axe : null,
        releve: numOrNull(a.releve),
        attendu: numOrNull(a.attendu),
        ecart: numOrNull(a.ecart),
        tolerance,
      };
    })
    .filter(Boolean);
  if (contreTolerance.length) out.contreTolerance = contreTolerance;

  return Object.keys(out).length ? out : null;
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
    let projectControles = {};
    try {
      const cfg = await qcProjectConfigService.getProjectConfig(projectKey);
      projectControles = cfg?.config?.controles || {};
    } catch (err) {
      logger.warn(`[QC][Dashboard] lecture config projet ignorée: ${err.message}`);
    }
    const controls = metaForCodes(codes, projectControles);

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
                WHEN cr."controlCode" = 'G200' THEN jsonb_build_object(
                  'unite', cr.valeur_json->'unite',
                  'ecart', cr.valeur_json->'ecart',
                  'ecartMaxAbs', cr.valeur_json->'ecartMaxAbs'
                )
                WHEN cr."controlCode" = 'G201' THEN jsonb_build_object(
                  'unite', cr.valeur_json->'unite',
                  'surveyPoint', cr.valeur_json->'surveyPoint',
                  'coordonnees', cr.valeur_json->'coordonnees'
                )
                WHEN cr."controlCode" = 'G202' THEN jsonb_build_object(
                  'unite', cr.valeur_json->'unite',
                  'angleNordProjet', cr.valeur_json->'angleNordProjet'
                )
                WHEN cr."controlCode" = 'G203' THEN jsonb_build_object(
                  'vacuite', cr.valeur_json->'vacuite',
                  'nbNiveaux', cr.valeur_json->'nbNiveaux',
                  'nbFautifs', cr.valeur_json->'nbFautifs'
                )
                WHEN cr."controlCode" = 'G205' THEN jsonb_build_object(
                  'vacuite', cr.valeur_json->'vacuite',
                  'nbAxes', cr.valeur_json->'nbAxes',
                  'nbFautifs', cr.valeur_json->'nbFautifs'
                )
                WHEN cr."controlCode" = 'G210' THEN jsonb_build_object(
                  'vacuite', cr.valeur_json->'vacuite',
                  'global', cr.valeur_json->'global'
                )
                WHEN cr."controlCode" = 'G314' THEN jsonb_build_object(
                  'conformes', cr.valeur_json->'conformes',
                  'fautifs', cr.valeur_json->'fautifs',
                  'evaluables', cr.valeur_json->'evaluables',
                  'pourcentageConformite', cr.valeur_json->'pourcentageConformite',
                  'fautifsDetail', jsonb_build_object(
                    'total', cr.valeur_json#>'{fautifsDetail,total}'
                  )
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
module.exports.extrasFromShape = extrasFromShape;
module.exports.resolveCiblePourcent = resolveCiblePourcent;
