// src/services/qcDesignatedElementsQuery.service.js
// Lecture paginée / filtrable de qc.designated_elements.
// Brique 2 : filtre runId. Brique 3 : filtre projectId = derniers runs réussis
// par maquette. Même fonction list(), aucune duplication de requête.

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const qcProjectConfigService = require('./qcProjectConfig.service');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_COPY = 50000;
const NIL_GUID = '00000000-0000-0000-0000-000000000000';

const SORTABLE = new Set([
  'controlCode',
  'label',
  'category',
  'familyName',
  'typeName',
  'levelName',
  'revitElementId',
]);

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function catalogByCode() {
  const meta = qcProjectConfigService.getCibleDescriptions();
  return new Map((meta.controles || []).map((c) => [c.code, c.libelle || c.code]));
}

function libelleOf(code, map) {
  return map.get(code) || code;
}

function parsePage(q) {
  const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(q.pageSize || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function escapeLike(s) {
  return String(s).replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

function runIdWhere(runIds) {
  if (!runIds?.length) return null;
  if (runIds.length === 1) return { runId: runIds[0] };
  return { runId: { [Op.in]: runIds } };
}

function buildWhere({ runIds, controlCode, category, level, q }) {
  const where = { ...runIdWhere(runIds) };
  if (controlCode) where.controlCode = String(controlCode).trim();
  if (category) where.category = String(category);
  if (level) where.levelName = String(level);
  const needle = q != null ? String(q).trim() : '';
  if (needle) {
    const like = `%${escapeLike(needle)}%`;
    where[Op.or] = [
      { label: { [Op.iLike]: like } },
      { typeName: { [Op.iLike]: like } },
      { familyName: { [Op.iLike]: like } },
    ];
  }
  return where;
}

function orderFor(sortBy, sortDir) {
  const dir = String(sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const col = SORTABLE.has(sortBy) ? sortBy : null;
  const order = [];
  if (col) order.push([col, dir]);
  if (col !== 'controlCode') order.push(['controlCode', 'ASC']);
  if (col !== 'label') order.push(['label', 'ASC']);
  order.push(['id', 'ASC']);
  return order;
}

class QcDesignatedElementsQueryService {
  getModels() {
    return require('../models/qc');
  }

  async loadRunHeader(runId) {
    const id = String(runId || '').trim();
    if (!id) throw httpError(400, 'Identifiant de run requis');
    const { QCRun, QCJob, QCProject } = this.getModels();
    const run = await QCRun.findByPk(id, {
      include: [
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
        hubId = hubId || proj.hubId || null;
      }
    } catch (_) {
      /* lookup optionnel */
    }
    return {
      id: plain.id,
      startedAtUtc: plain.startedAtUtc || null,
      projectId,
      projectName,
      hubId,
      accModelGuid: plain.accModelGuid || null,
      modelName: plain.job?.modelName || stats.fileName || null,
      modelVersion: plain.modelVersion ?? null,
      revitVersion: plain.revitVersion || null,
      jobName: plain.job?.name || null,
    };
  }

  /**
   * Dernier run réussi par maquette du projet.
   * Résout b.<guid> ET accProjectGuid via resolvePrefixedProjectId (PR #202).
   * Projet inconnu / sans run réussi → scope vide (pas d'erreur).
   */
  async resolveProjectScope(projectKey, accModelGuidFilter) {
    let resolved;
    try {
      resolved = await qcProjectConfigService.resolvePrefixedProjectId(projectKey);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 400) {
        return { project: null, models: [], runIds: [] };
      }
      throw err;
    }
    if (!resolved?.accProjectGuid) {
      return {
        project: {
          projectId: resolved?.projectId || null,
          projectName: resolved?.projectName || null,
          hubId: null,
        },
        models: [],
        runIds: [],
      };
    }

    const guid = String(resolved.accProjectGuid).toLowerCase();
    const rows = await sequelize.query(
      `SELECT DISTINCT ON (r."accModelGuid")
         r.id AS "runId",
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
       ORDER BY r."accModelGuid",
                COALESCE(r."endedAtUtc", r."startedAtUtc", r."createdAt") DESC`,
      { replacements: { guid, nil: NIL_GUID }, type: QueryTypes.SELECT }
    );

    const { QCJob, QCProject } = this.getModels();
    const missingGuids = rows.filter((r) => !r.modelName).map((r) => r.accModelGuid);
    let nameByModel = new Map();
    if (missingGuids.length) {
      const jobs = await QCJob.findAll({
        where: { accModelGuid: { [Op.in]: missingGuids }, modelName: { [Op.ne]: null } },
        attributes: ['accModelGuid', 'modelName'],
        order: [['updatedAt', 'DESC']],
      });
      for (const j of jobs) {
        const key = String(j.accModelGuid);
        if (!nameByModel.has(key) && j.modelName) nameByModel.set(key, j.modelName);
      }
    }

    let hubId = null;
    try {
      const proj = await QCProject.findOne({
        where: { accProjectGuid: guid },
        attributes: ['hubId', 'projectName', 'projectId'],
      });
      hubId = proj?.hubId || null;
      if (proj?.projectName && !resolved.projectName) resolved.projectName = proj.projectName;
    } catch (_) {
      /* optionnel */
    }

    const models = rows.map((r) => ({
      runId: r.runId,
      accModelGuid: r.accModelGuid,
      modelName: r.modelName || nameByModel.get(String(r.accModelGuid)) || null,
      modelVersion: r.modelVersion ?? null,
      startedAtUtc: r.startedAtUtc || null,
      endedAtUtc: r.endedAtUtc || null,
    }));

    const filterGuid = accModelGuidFilter ? String(accModelGuidFilter).trim().toLowerCase() : '';
    const scoped = filterGuid
      ? models.filter((m) => String(m.accModelGuid).toLowerCase() === filterGuid)
      : models;

    return {
      project: {
        projectId: resolved.projectId,
        projectName: resolved.projectName || null,
        hubId,
        accProjectGuid: guid,
      },
      models,
      runIds: scoped.map((m) => m.runId),
    };
  }

  emptyList({ run = null, project = null, byModel = [] } = {}) {
    return {
      run,
      project,
      items: [],
      total: 0,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      pageCount: 0,
      byControl: [],
      byModel,
      facets: { categories: [], levels: [] },
    };
  }

  /**
   * @param {object} filters
   * @param {string} [filters.runId]
   * @param {string} [filters.projectId]
   * @param {string} [filters.accModelGuid]
   * @param {string} [filters.controlCode]
   * @param {string} [filters.category]
   * @param {string} [filters.level]
   * @param {string} [filters.q]
   * @param {string|number} [filters.page]
   * @param {string|number} [filters.pageSize]
   * @param {string} [filters.sortBy]
   * @param {string} [filters.sortDir]
   * @param {boolean} [filters.idsOnly]
   */
  async list(filters = {}) {
    const { QCDesignatedElement } = this.getModels();
    const labels = catalogByCode();

    let run = null;
    let project = null;
    let scopeModels = [];
    let runIds = [];

    if (filters.runId) {
      run = await this.loadRunHeader(filters.runId);
      runIds = [run.id];
    } else if (filters.projectId) {
      const scope = await this.resolveProjectScope(filters.projectId, filters.accModelGuid);
      project = scope.project;
      scopeModels = scope.models;
      runIds = scope.runIds;
      if (!runIds.length) {
        if (filters.idsOnly) {
          return { run: null, project, total: 0, truncated: false, revitElementIds: [], labels: [] };
        }
        return this.emptyList({ project, byModel: scopeModels.map((m) => ({ ...m, count: 0 })) });
      }
    } else {
      throw httpError(400, 'Identifiant de run ou de projet requis');
    }

    const where = buildWhere({ ...filters, runIds });
    const scopeWhere = runIdWhere(runIds);

    if (filters.idsOnly) {
      const rows = await QCDesignatedElement.findAll({
        where,
        attributes: ['revitElementId', 'label'],
        order: orderFor(filters.sortBy, filters.sortDir),
        limit: MAX_COPY,
      });
      return {
        run,
        project,
        total: rows.length,
        truncated: rows.length >= MAX_COPY,
        revitElementIds: rows
          .map((r) => r.revitElementId)
          .filter((id) => id != null && id !== '')
          .map((id) => String(id)),
        labels: rows.map((r) => r.label).filter((x) => x != null && String(x).trim() !== ''),
      };
    }

    const { page, pageSize, offset } = parsePage(filters);
    const order = orderFor(filters.sortBy, filters.sortDir);
    const facetWhere = {
      ...scopeWhere,
      ...(filters.controlCode ? { controlCode: String(filters.controlCode).trim() } : {}),
    };

    const [total, rows, byControlRaw, categories, levels, byRunRaw] = await Promise.all([
      QCDesignatedElement.count({ where }),
      QCDesignatedElement.findAll({
        where,
        order,
        limit: pageSize,
        offset,
        attributes: [
          'id',
          'runId',
          'controlCode',
          'revitElementId',
          'category',
          'familyName',
          'typeName',
          'levelName',
          'label',
          'kind',
          'details',
        ],
      }),
      QCDesignatedElement.findAll({
        where: scopeWhere,
        attributes: ['controlCode', [sequelize.literal('COUNT(*)'), 'count']],
        group: ['controlCode'],
        raw: true,
      }),
      QCDesignatedElement.findAll({
        where: { ...facetWhere, category: { [Op.ne]: null } },
        attributes: ['category'],
        group: ['category'],
        raw: true,
        order: [['category', 'ASC']],
      }),
      QCDesignatedElement.findAll({
        where: { ...facetWhere, levelName: { [Op.ne]: null } },
        attributes: ['levelName'],
        group: ['levelName'],
        raw: true,
        order: [['levelName', 'ASC']],
      }),
      project
        ? QCDesignatedElement.findAll({
            where: { runId: { [Op.in]: scopeModels.map((m) => m.runId) } },
            attributes: ['runId', [sequelize.literal('COUNT(*)'), 'count']],
            group: ['runId'],
            raw: true,
          })
        : Promise.resolve([]),
    ]);

    const byControl = (byControlRaw || [])
      .map((r) => ({
        controlCode: r.controlCode,
        libelle: libelleOf(r.controlCode, labels),
        count: Number(r.count) || 0,
      }))
      .sort((a, b) => a.controlCode.localeCompare(b.controlCode));

    const countByRun = new Map((byRunRaw || []).map((r) => [r.runId, Number(r.count) || 0]));
    const byModel = scopeModels
      .map((m) => ({
        accModelGuid: m.accModelGuid,
        modelName: m.modelName,
        runId: m.runId,
        modelVersion: m.modelVersion,
        startedAtUtc: m.startedAtUtc,
        endedAtUtc: m.endedAtUtc,
        count: countByRun.get(m.runId) || 0,
      }))
      .sort((a, b) => String(a.modelName || '').localeCompare(String(b.modelName || ''), 'fr'));

    const metaByRun = new Map();
    if (run) {
      metaByRun.set(run.id, run);
    }
    for (const m of scopeModels) {
      metaByRun.set(m.runId, m);
    }

    const items = rows.map((r) => {
      const plain = r.toJSON();
      const meta = metaByRun.get(plain.runId) || {};
      return {
        id: plain.id,
        runId: plain.runId,
        controlCode: plain.controlCode,
        libelle: libelleOf(plain.controlCode, labels),
        revitElementId: plain.revitElementId != null ? String(plain.revitElementId) : null,
        category: plain.category || null,
        familyName: plain.familyName || null,
        typeName: plain.typeName || null,
        levelName: plain.levelName || null,
        label: plain.label || null,
        kind: plain.kind,
        details: plain.details && typeof plain.details === 'object' ? plain.details : {},
        modelName: meta.modelName || null,
        accModelGuid: meta.accModelGuid || null,
        modelVersion: meta.modelVersion ?? null,
        startedAtUtc: meta.startedAtUtc || null,
      };
    });

    return {
      run,
      project,
      items,
      total,
      page,
      pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / pageSize),
      byControl,
      byModel,
      facets: {
        categories: categories.map((c) => c.category).filter(Boolean),
        levels: levels.map((l) => l.levelName).filter(Boolean),
      },
    };
  }
}

module.exports = new QcDesignatedElementsQueryService();
