// src/services/qcDesignatedElementsQuery.service.js
// Lecture paginée / filtrable de qc.designated_elements.
// Conçu pour la page par run (brique 2) ET la future vue par projet (brique 3) :
// les filtres runId et projectId sont optionnels côté service ; la route run
// impose runId. Aucun recalcul de verdict.

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const qcProjectConfigService = require('./qcProjectConfig.service');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_COPY = 50000;

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
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(q.pageSize || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function escapeLike(s) {
  return String(s).replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

function buildWhere({ runId, projectId, controlCode, category, level, q }) {
  const where = {};
  if (runId) where.runId = runId;
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
  if (projectId && !runId) {
    where.runId = {
      [Op.in]: sequelize.literal(
        `(SELECT r.id FROM qc.runs r
          LEFT JOIN qc.projects p ON p."accProjectGuid" = r."accProjectGuid"
          WHERE p."projectId" = ${sequelize.escape(String(projectId))}
             OR r."accProjectGuid"::text = ${sequelize.escape(String(projectId).replace(/^b\./i, ''))})`
      ),
    };
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
      modelName: plain.job?.modelName || stats.fileName || null,
      modelVersion: plain.modelVersion ?? null,
      revitVersion: plain.revitVersion || null,
      jobName: plain.job?.name || null,
    };
  }

  /**
   * @param {object} filters
   * @param {string} [filters.runId]
   * @param {string} [filters.projectId] — réservé brique 3
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
    const run = filters.runId ? await this.loadRunHeader(filters.runId) : null;
    const runId = run?.id || null;
    const where = buildWhere({ ...filters, runId });
    const labels = catalogByCode();

    if (filters.idsOnly) {
      const rows = await QCDesignatedElement.findAll({
        where,
        attributes: ['revitElementId', 'label'],
        order: orderFor(filters.sortBy, filters.sortDir),
        limit: MAX_COPY,
      });
      return {
        run,
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

    const [total, rows, byControlRaw, categories, levels] = await Promise.all([
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
        where: runId ? { runId } : where,
        attributes: [
          'controlCode',
          [sequelize.literal('COUNT(*)'), 'count'],
        ],
        group: ['controlCode'],
        raw: true,
      }),
      QCDesignatedElement.findAll({
        where: {
          ...(runId ? { runId } : {}),
          ...(filters.controlCode ? { controlCode: String(filters.controlCode).trim() } : {}),
          category: { [Op.ne]: null },
        },
        attributes: ['category'],
        group: ['category'],
        raw: true,
        order: [['category', 'ASC']],
      }),
      QCDesignatedElement.findAll({
        where: {
          ...(runId ? { runId } : {}),
          ...(filters.controlCode ? { controlCode: String(filters.controlCode).trim() } : {}),
          levelName: { [Op.ne]: null },
        },
        attributes: ['levelName'],
        group: ['levelName'],
        raw: true,
        order: [['levelName', 'ASC']],
      }),
    ]);

    const byControl = (byControlRaw || [])
      .map((r) => ({
        controlCode: r.controlCode,
        libelle: libelleOf(r.controlCode, labels),
        count: Number(r.count) || 0,
      }))
      .sort((a, b) => a.controlCode.localeCompare(b.controlCode));

    const items = rows.map((r) => {
      const plain = r.toJSON();
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
      };
    });

    return {
      run,
      items,
      total,
      page,
      pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / pageSize),
      byControl,
      facets: {
        categories: categories.map((c) => c.category).filter(Boolean),
        levels: levels.map((l) => l.levelName).filter(Boolean),
      },
    };
  }
}

module.exports = new QcDesignatedElementsQueryService();
