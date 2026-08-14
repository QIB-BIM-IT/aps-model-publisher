// src/services/qcViewer.service.js
// Contexte Viewer pour un run QC : URN de la version AUDITÉE + état de traduction.
// Lecture seule. Jeton viewables:read (apsAuth.getViewerToken), jamais le 3-legged large.

const axios = require('axios');
const { apsConfig } = require('../config/aps.config');
const apsAuthService = require('./apsAuth.service');
const logger = require('../config/logger');

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function encodeVersionUrn(versionUrn) {
  return Buffer.from(String(versionUrn), 'utf8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function documentIdFromVersionUrn(versionUrn) {
  return `urn:${encodeVersionUrn(versionUrn)}`;
}

function manifestPath(encoded, region) {
  const eu = String(region || '').toUpperCase() === 'EMEA';
  return eu
    ? `/modelderivative/v2/regions/eu/designdata/${encoded}/manifest`
    : `/modelderivative/v2/designdata/${encoded}/manifest`;
}

function walkHas3d(node) {
  if (!node || typeof node !== 'object') return false;
  if (String(node.role || '').toLowerCase() === '3d') return true;
  const kids = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.derivatives)
      ? node.derivatives
      : [];
  return kids.some(walkHas3d);
}

function translationFromManifest(httpStatus, body) {
  if (httpStatus === 404) {
    return {
      status: 'missing',
      progress: null,
      has3d: false,
      message:
        'Cette maquette n’a pas de vue 3D consultable (traduction absente). Le tableau reste disponible.',
    };
  }
  if (httpStatus >= 400 || !body) {
    return {
      status: 'error',
      progress: null,
      has3d: false,
      message: 'Impossible de vérifier si la maquette est visualisable pour le moment.',
    };
  }
  const st = String(body.status || '').toLowerCase();
  const progress = body.progress || null;
  const has3d = walkHas3d(body);
  if (st === 'failed' || st === 'timeout') {
    return {
      status: 'failed',
      progress,
      has3d: false,
      message:
        'La traduction 3D de cette maquette a échoué. Elle n’est pas visualisable ici.',
    };
  }
  if (st === 'pending' || st === 'inprogress') {
    return {
      status: 'pending',
      progress,
      has3d: false,
      message: 'La vue 3D de cette maquette n’est pas encore prête. Réessayez dans quelques minutes.',
    };
  }
  if (st === 'success') {
    if (!has3d) {
      return {
        status: 'no3d',
        progress,
        has3d: false,
        message: 'Cette maquette n’a pas de vue 3D (feuilles ou vues 2D seulement).',
      };
    }
    return { status: 'ready', progress, has3d: true, message: null };
  }
  return {
    status: 'error',
    progress,
    has3d: false,
    message: 'Impossible de vérifier si la maquette est visualisable pour le moment.',
  };
}

class QcViewerService {
  getModels() {
    return require('../models/qc');
  }

  async getViewerTokenPayload() {
    const tok = await apsAuthService.getViewerToken();
    return {
      accessToken: tok.access_token,
      expiresIn: tok.expires_in,
      expiresAt: new Date(tok.expires_at).toISOString(),
      scope: tok.scope,
    };
  }

  async getRunViewerContext(runId) {
    const id = String(runId || '').trim();
    if (!id) throw httpError(400, 'Identifiant de run requis');
    const { QCRun, QCJob } = this.getModels();
    const run = await QCRun.findByPk(id, {
      include: [{ model: QCJob, as: 'job', attributes: ['modelName'], required: false }],
    });
    if (!run) throw httpError(404, 'Run introuvable');
    const plain = run.toJSON();
    const stats = plain.stats && typeof plain.stats === 'object' ? plain.stats : {};
    const versionUrn = plain.versionUrn || null;
    const region = String(plain.region || 'US').toUpperCase();

    const base = {
      runId: plain.id,
      modelName: plain.job?.modelName || stats.fileName || null,
      modelVersion: plain.modelVersion ?? null,
      revitVersion: plain.revitVersion || null,
      region,
      versionUrn,
      documentUrn: versionUrn ? documentIdFromVersionUrn(versionUrn) : null,
      viewerApi: region === 'EMEA' ? 'streamingV2_EU' : 'streamingV2',
    };

    if (!versionUrn) {
      return {
        ...base,
        translation: {
          status: 'missing',
          progress: null,
          has3d: false,
          message: 'Ce run n’a pas d’identifiant de version ACC : la maquette ne peut pas être affichée.',
        },
      };
    }

    const encoded = encodeVersionUrn(versionUrn);
    const tok = await apsAuthService.getViewerToken();
    const url = `${apsConfig.apis.baseUrl}${manifestPath(encoded, region)}`;
    let httpStatus = 0;
    let body = null;
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${tok.access_token}` },
        validateStatus: () => true,
        timeout: 30_000,
      });
      httpStatus = res.status;
      body = res.data;
    } catch (e) {
      logger.warn(`[QC][Viewer] manifeste run ${id}: ${e.message}`);
      httpStatus = e.response?.status || 0;
      body = e.response?.data || null;
    }

    return {
      ...base,
      translation: translationFromManifest(httpStatus, body),
    };
  }
}

module.exports = new QcViewerService();
module.exports.encodeVersionUrn = encodeVersionUrn;
module.exports.documentIdFromVersionUrn = documentIdFromVersionUrn;
