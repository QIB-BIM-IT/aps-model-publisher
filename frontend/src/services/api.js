import axios from 'axios';

// Fonction pour obtenir l'URL de base de l'API
function getApiBaseUrl() {
  const hostname = window.location.hostname;
  
  // Ignorer VITE_API_URL s'il pointe vers localhost mais qu'on est en production
  const envApiUrl = import.meta.env.VITE_API_URL;
  const isEnvLocalhost = envApiUrl && envApiUrl.includes('localhost');
  const isCurrentLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  
  // Si la variable d'env est définie ET cohérente avec l'environnement actuel, l'utiliser
  if (envApiUrl && !isEnvLocalhost) {
    return envApiUrl;
  }
  
  // En développement local (localhost ou 127.0.0.1)
  if (isCurrentLocalhost) {
    return 'http://localhost:3000';
  }
  
  // En production (Azure ou autre), utiliser le même domaine
  return window.location.origin;
}

// URL de base pour axios (URL relative en production)
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = isLocalhost ? 'http://localhost:3000' : '';

export function getToken() { return localStorage.getItem('jwt_token') || ''; }
export function setToken(t) { if (t) localStorage.setItem('jwt_token', t); }
export function clearToken() { localStorage.removeItem('jwt_token'); }

const api = axios.create({ baseURL: API_URL, withCredentials: true });
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export async function me() {
  try { const { data } = await api.get('/api/auth/me'); if (data?.token) setToken(data.token); return data; }
  catch { return null; }
}

export async function updatePreferences(prefs) {
  const { data } = await api.put('/api/auth/preferences', prefs);
  return data?.preferences || null;
}

export async function startLogin(opts = {}) {
  const redirect = window.location.origin + '/callback';
  const force = opts.forceLogin ? '&force=login' : '';
  const apiBase = getApiBaseUrl();
  const loginUrl = `${apiBase}/api/auth/login?redirect=${encodeURIComponent(redirect)}${force}`;
  window.location.href = loginUrl;
}

// ----- APS -----
export async function fetchHubs() { const { data } = await api.get('/api/aps/hubs'); return data?.data || []; }
export async function fetchProjects(hubId) {
  try { const { data } = await api.get('/api/aps/projects', { params: { hubId } }); if (data?.data) return data.data; }
  catch (_) {}
  const { data } = await api.get(`/api/aps/hubs/${encodeURIComponent(hubId)}/projects`);
  return data?.data || [];
}
export async function fetchTopFolders(hubId, projectId) {
  const { data } = await api.get(`/api/aps/projects/${encodeURIComponent(projectId)}/top-folders`, { params: { hubId } });
  return data?.data || [];
}
export async function fetchFolderContents(projectId, folderId) {
  const { data } = await api.get(`/api/aps/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`);
  return data?.data || [];
}

// ----- Publish Jobs -----
export async function createPublishJob(payload) {
  const { data } = await api.post('/api/publish/jobs', payload);
  return data?.data;
}
export async function getPublishJobs(params = {}) {
  const { data } = await api.get('/api/publish/jobs', { params });
  return data?.data || [];
}
export async function patchPublishJob(id, patch) {
  const { data } = await api.patch(`/api/publish/jobs/${encodeURIComponent(id)}`, patch);
  return data?.data;
}
export async function deletePublishJob(id) {
  const { data } = await api.delete(`/api/publish/jobs/${encodeURIComponent(id)}`);
  return data?.success === true;
}
export async function runPublishJobNow(id) {
  try {
    const { data } = await api.post(`/api/publish/jobs/${encodeURIComponent(id)}/run`);
    return data?.data || null;
  } catch (err) {
    const message = err?.response?.data?.message || err?.message || 'Erreur lancement du job';
    const error = new Error(message);
    if (err?.response?.status) error.status = err.response.status;
    throw error;
  }
}

// ----- PDF Export Jobs -----
export async function createPDFExportJob(payload) {
  const { data } = await api.post('/api/pdf-export/jobs', payload);
  return data?.data;
}
export async function getPDFExportJobs(params = {}) {
  const { data } = await api.get('/api/pdf-export/jobs', { params });
  return data?.data || [];
}
export async function patchPDFExportJob(id, patch) {
  const { data } = await api.patch(`/api/pdf-export/jobs/${encodeURIComponent(id)}`, patch);
  return data?.data;
}
export async function deletePDFExportJob(id) {
  const { data } = await api.delete(`/api/pdf-export/jobs/${encodeURIComponent(id)}`);
  return data?.success === true;
}
export async function runPDFExportJobNow(id) {
  try {
    const { data } = await api.post(`/api/pdf-export/jobs/${encodeURIComponent(id)}/run`);
    return data?.data || null;
  } catch (err) {
    const message = err?.response?.data?.message || err?.message || 'Erreur lancement du job';
    const error = new Error(message);
    if (err?.response?.status) error.status = err.response.status;
    throw error;
  }
}

// ----- Copy Jobs -----
export async function createCopyJob(payload) {
  const { data } = await api.post('/api/copy/jobs', payload);
  return data?.data;
}
export async function getCopyJobs(params = {}) {
  const { data } = await api.get('/api/copy/jobs', { params });
  return data?.data || [];
}
export async function patchCopyJob(id, patch) {
  const { data } = await api.patch(`/api/copy/jobs/${encodeURIComponent(id)}`, patch);
  return data?.data;
}
export async function deleteCopyJob(id) {
  const { data } = await api.delete(`/api/copy/jobs/${encodeURIComponent(id)}`);
  return data?.success === true;
}
export async function runCopyJobNow(id) {
  try {
    const { data } = await api.post(`/api/copy/jobs/${encodeURIComponent(id)}/run`);
    return data?.data || null;
  } catch (err) {
    const message = err?.response?.data?.message || err?.message || 'Erreur lancement du job';
    const error = new Error(message);
    if (err?.response?.status) error.status = err.response.status;
    throw error;
  }
}
export async function getCopyRuns(params = {}) {
  const { data } = await api.get('/api/copy/runs', { params });
  return data?.data || [];
}

// ----- Runs -----
export async function getRuns(params = {}) {
  const { data } = await api.get('/api/publish/runs', { params });
  return data?.data || [];
}
export async function getJobRuns(jobId, params = {}) {
  const { data } = await api.get(`/api/publish/jobs/${encodeURIComponent(jobId)}/runs`, { params });
  return data?.data || [];
}
export async function getPDFExportRuns(params = {}) {
  const { data } = await api.get('/api/pdf-export/runs', { params });
  return data?.data || [];
}
export async function getPDFExportJobRuns(jobId, params = {}) {
  const { data } = await api.get(`/api/pdf-export/jobs/${encodeURIComponent(jobId)}/runs`, { params });
  return data?.data || [];
}

/**
 *
 * Export PDF des sheets et vues 2D
 * @param {string} projectId - ID du projet
 * @param {string[]} fileUrns - URNs des fichiers Revit
 * @param {object} options - Options d'export
 * @returns {Promise<object>}
 */
export async function exportPDFs(projectId, fileUrns, options = {}) {
  const response = await api.post('/api/pdf-export/export', {
    projectId,
    fileUrns,
    includeSheets: options.includeSheets !== false,
    includeViews2D: options.includeViews2D !== false,
    includeMarkups: options.includeMarkups !== false,
  });
  return response.data;
}

export async function savePDFsToACC(data) {
  const { data: result } = await api.post('/api/pdf-export/save-to-acc', data);
  return result;
}

export async function listAvailableSheets(fileUrn, projectId) {
  if (!fileUrn || !projectId) {
    throw new Error('fileUrn et projectId requis');
  }

  const { data } = await api.post('/api/pdf-export/list-sheets', { fileUrn, projectId });

  return data;
}

/**
 * Liste les sheets et vues 2D d'un fichier Revit
 * @param {string} fileUrn - URN du fichier
 * @param {string} projectId - ID du projet
 * @returns {Promise<{sheets: Array, views2D: Array}>}
 */
export async function listSheets(fileUrn, projectId) {
  const data = await listAvailableSheets(fileUrn, projectId);

  if (data?.success === false) {
    const error = new Error(data?.message || 'Failed to list sheets');
    error.response = data;
    throw error;
  }

  return {
    sheets: Array.isArray(data?.sheets) ? data.sheets : [],
    views2D: Array.isArray(data?.views2D) ? data.views2D : [],
    versionUrn: data?.versionUrn || null,
    derivativeUrn: data?.derivativeUrn || null,
    requestedUrn: data?.requestedUrn || fileUrn,
  };
}

export async function getUserApsToken() {
  const { data } = await api.get('/api/aps/user-token');
  if (data?.success && data?.token) {
    return data.token;
  }
  throw new Error(data?.message || 'Unable to retrieve APS user token');
}

/**
 * Export PDF avec mise en cache
 * Lance l'export complet, parse le ZIP, et retourne la liste des sheets disponibles
 * Les PDFs restent en cache côté serveur pour un export ultérieur rapide
 *
 * @param {string} fileUrn - URN du fichier Revit
 * @param {string} projectId - ID du projet
 * @returns {Promise<{
 *   cacheKey: string,
 *   sheets: Array<{name: string, size: number, type: string}>,
 *   views2D: Array<{name: string, size: number, type: string}>,
 *   markups: Array<{name: string, size: number, type: string}>,
 *   stats: {total: number, sheets: number, views2D: number, markups: number, totalSize: number},
 *   resolvedUrns: {input: string, version: string, derivative: string}
 * }>}
 */
export async function exportWithCache(fileUrn, projectId) {
  if (!fileUrn || !projectId) {
    throw new Error('fileUrn et projectId requis');
  }

  try {
    const { data } = await api.post('/api/pdf-export/export-with-cache', {
      fileUrn,
      projectId,
    });

    if (!data.success) {
      throw new Error(data.message || 'Export with cache failed');
    }

    return {
      cacheKey: data.cacheKey,
      sheets: data.sheets || [],
      views2D: data.views2D || [],
      markups: data.markups || [],
      stats: data.stats || {},
      resolvedUrns: data.resolvedUrns || {},
    };
  } catch (error) {
    const message = error?.response?.data?.message || error?.message || 'Erreur lors de l\'export avec cache';
    throw new Error(message);
  }
}

/**
 * Export PDFs depuis le cache vers ACC
 * @param {object} params - Paramètres d'export
 * @param {string} params.cacheKey - Clé du cache
 * @param {string} params.projectId - ID du projet
 * @param {string} params.folderId - ID du dossier de destination
 * @param {Array<string>} params.selectedSheetNames - Noms des sheets à exporter
 * @param {string} params.exportMode - Mode d'export ('combined' ou 'individual')
 * @param {string} [params.combinedFileName] - Nom du fichier combiné (si exportMode === 'combined')
 * @param {object} [params.options] - Options d'export
 * @returns {Promise<{uploaded: number, failed: number}>}
 */
export async function exportPDFsFromCache(params) {
  const { cacheKey, projectId, folderId, selectedSheetNames, exportMode, combinedFileName, options = {} } = params;

  if (!cacheKey || !projectId || !folderId || !selectedSheetNames || !Array.isArray(selectedSheetNames)) {
    throw new Error('Paramètres requis manquants');
  }

  try {
    const { data } = await api.post('/api/pdf-export/export-from-cache', {
      cacheKey,
      projectId,
      folderId,
      selectedSheetNames,
      exportMode: exportMode || 'individual',
      combinedFileName,
      options: {
        includeSheets: options.includeSheets !== false,
        includeViews2D: options.includeViews2D !== false,
        includeMarkups: options.includeMarkups !== false,
      },
    });

    if (!data.success) {
      throw new Error(data.message || 'Export from cache failed');
    }

    return {
      uploaded: data.uploaded || 0,
      failed: data.failed || 0,
      results: data.results || [],
    };
  } catch (error) {
    const message = error?.response?.data?.message || error?.message || 'Erreur lors de l\'export depuis le cache';
    throw new Error(message);
  }
}

// ----- QC config (formulaire) -----
/** GET /api/qc/controls/cible-descriptions — métadonnées formulaire (lot 1 API). */
export async function fetchQcCibleDescriptions() {
  const { data } = await api.get('/api/qc/controls/cible-descriptions');
  if (!data?.success) {
    throw new Error(data?.message || 'Échec chargement des descriptions de cible QC');
  }
  return data;
}

/**
 * GET /api/qc/projects/:projectKey/config
 * projectKey = b.<guid> (préféré) ou accProjectGuid nu.
 * @returns {{ projectId, exists, config: { controles, criticite }, ... }}
 */
export async function fetchQcProjectConfig(projectKey) {
  const { data } = await api.get(
    `/api/qc/projects/${encodeURIComponent(projectKey)}/config`
  );
  if (!data?.success) {
    throw new Error(data?.message || 'Échec chargement de la config QC projet');
  }
  return data;
}

/**
 * PUT /api/qc/projects/:projectKey/config
 * Body: { controles?: { [code]: object|null }, criticite?: object|null }
 * Erreurs 400 : err.response.data.errors[] + message.
 */
export async function saveQcProjectConfig(projectKey, payload) {
  const { data } = await api.put(
    `/api/qc/projects/${encodeURIComponent(projectKey)}/config`,
    payload
  );
  if (!data?.success) {
    const err = new Error(data?.message || 'Échec enregistrement config QC');
    if (Array.isArray(data?.errors)) err.errors = data.errors;
    throw err;
  }
  return data;
}

// ----- QC Runs (historique — F1f) -----
/** GET /api/qc/runs?projectId=&limit= — runs QC du projet (statut technique). */
export async function fetchQcRuns(params = {}) {
  const { data } = await api.get('/api/qc/runs', { params });
  if (!data?.success) {
    throw new Error(data?.message || 'Échec chargement des runs QC');
  }
  return Array.isArray(data?.runs) ? data.runs : [];
}

/** GET /api/qc/runs/:runId — détail + résultats enrichis (fiche / UI). */
export async function fetchQcRunDetail(runId) {
  try {
    const { data } = await api.get(`/api/qc/runs/${encodeURIComponent(runId)}`);
    if (!data?.success) {
      throw new Error(data?.message || 'Échec chargement du détail du run QC');
    }
    return data.data;
  } catch (err) {
    const message =
      err?.response?.data?.message || err?.message || 'Erreur chargement du détail du run QC';
    const error = new Error(message);
    if (err?.response?.status) error.status = err.response.status;
    throw error;
  }
}

/**
 * GET /api/qc/runs/:runId/fiche — télécharge la fiche de contrôle Excel.
 * @returns {Promise<{ blob: Blob, fileName: string }>}
 */
export async function downloadQcRunFiche(runId) {
  try {
    const response = await api.get(`/api/qc/runs/${encodeURIComponent(runId)}/fiche`, {
      responseType: 'blob',
    });
    const disposition = response.headers?.['content-disposition'] || '';
    let fileName = `QC_fiche_${runId}.xlsx`;
    const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
    if (utfMatch?.[1]) {
      try {
        fileName = decodeURIComponent(utfMatch[1]);
      } catch {
        fileName = utfMatch[1];
      }
    } else if (plainMatch?.[1]) {
      fileName = plainMatch[1];
    }
    return { blob: response.data, fileName };
  } catch (err) {
    let message = 'Échec du téléchargement de la fiche de contrôle';
    const data = err?.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text);
        if (parsed?.message) message = parsed.message;
      } catch {
        /* ignore */
      }
    } else if (err?.response?.data?.message) {
      message = err.response.data.message;
    } else if (err?.message) {
      message = err.message;
    }
    const error = new Error(message);
    if (err?.response?.status) error.status = err.response.status;
    throw error;
  }
}

// ----- QC Jobs (tâches planifiées — B1/B2) -----
/** POST /api/qc/jobs — crée une tâche QC (1 modelUrn). */
export async function createQcJob(payload) {
  const { data } = await api.post('/api/qc/jobs', payload);
  if (!data?.success) {
    throw new Error(data?.message || 'Échec création de la tâche QC');
  }
  return data?.data;
}

/** GET /api/qc/jobs?projectId=&active= */
export async function fetchQcJobs(params = {}) {
  const { data } = await api.get('/api/qc/jobs', { params });
  if (!data?.success) {
    throw new Error(data?.message || 'Échec chargement des tâches QC');
  }
  return data?.data || [];
}

/** GET /api/qc/jobs/:id */
export async function fetchQcJob(id) {
  const { data } = await api.get(`/api/qc/jobs/${encodeURIComponent(id)}`);
  if (!data?.success) {
    throw new Error(data?.message || 'Échec chargement de la tâche QC');
  }
  return data?.data;
}

/** PATCH /api/qc/jobs/:id */
export async function patchQcJob(id, patch) {
  const { data } = await api.patch(`/api/qc/jobs/${encodeURIComponent(id)}`, patch);
  if (!data?.success) {
    throw new Error(data?.message || 'Échec mise à jour de la tâche QC');
  }
  return data?.data;
}

/** DELETE /api/qc/jobs/:id */
export async function deleteQcJob(id) {
  const { data } = await api.delete(`/api/qc/jobs/${encodeURIComponent(id)}`);
  return data?.success === true;
}

/** POST /api/qc/jobs/:id/run — Run Now (async DA). */
export async function runQcJobNow(id) {
  try {
    const { data } = await api.post(`/api/qc/jobs/${encodeURIComponent(id)}/run`);
    if (!data?.success) {
      throw new Error(data?.message || 'Échec lancement de la tâche QC');
    }
    return data?.data || null;
  } catch (err) {
    const message = err?.response?.data?.message || err?.message || 'Erreur lancement du job QC';
    const error = new Error(message);
    if (err?.response?.status) error.status = err.response.status;
    throw error;
  }
}

export default api;
