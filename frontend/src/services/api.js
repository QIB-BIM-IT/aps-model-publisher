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

export default api;
