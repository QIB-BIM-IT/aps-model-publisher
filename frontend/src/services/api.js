import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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

export async function startLogin(opts = {}) {
  const redirect = window.location.origin + '/callback';
  const force = opts.forceLogin ? '&force=login' : '';
  window.location.href = `${API_URL}/api/auth/login?redirect=${encodeURIComponent(redirect)}${force}`;
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

// ----- Runs -----
export async function getRuns(params = {}) {
  const { data } = await api.get('/api/publish/runs', { params });
  return data?.data || [];
}
export async function getJobRuns(jobId, params = {}) {
  const { data } = await api.get(`/api/publish/jobs/${encodeURIComponent(jobId)}/runs`, { params });
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
  const {
    uploadToACC = false,
    accFolderId = null,
  } = options;

  const response = await api.post('/api/pdf-export/export', {
    projectId,
    fileUrns,
    uploadToACC,
    accFolderId,
  });
  return response.data;
}

export default api;
