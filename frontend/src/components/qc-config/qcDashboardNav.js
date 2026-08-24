/**
 * Navigation du tableau de bord QC.
 * Réutilise le contrat location.state { preSelectHub, preSelectProject }
 * (IDs string), déjà utilisé Planning ↔ QC. Les clés qcDashboard* indiquent
 * une provenance tableau de bord — absentes si l’on vient de la Planning.
 *
 * Ajouter un thème = une entrée dans QC_DASHBOARD_THEMES.
 */

export const QC_DASHBOARD_DEFAULT_THEME = 'hygiene';

export const QC_DASHBOARD_THEMES = [
  { id: 'hygiene', label: 'Hygiène et santé du modèle', available: true },
  { id: 'donnees', label: 'Données et codification', available: false },
  { id: 'references', label: 'Références et positionnement', available: false },
  { id: 'livraison', label: 'Conventions de livraison', available: false },
];

export function qcDashboardThemeById(id) {
  return QC_DASHBOARD_THEMES.find((t) => t.id === String(id || '')) || null;
}

export function resolveQcDashboardTheme(id) {
  const found = qcDashboardThemeById(id);
  if (found?.available) return found.id;
  return QC_DASHBOARD_DEFAULT_THEME;
}

export function qcDashboardPath(projectId, theme = QC_DASHBOARD_DEFAULT_THEME, search = '') {
  if (!projectId) return '/planning';
  const t = resolveQcDashboardTheme(theme);
  const base = `/qc-dashboard/${encodeURIComponent(projectId)}/${encodeURIComponent(t)}`;
  const q = typeof search === 'string' ? search.replace(/^\?/, '') : '';
  return q ? `${base}?${q}` : base;
}

export function withQcDashboardOrigin(baseState, { theme, accModelGuid } = {}) {
  const next = { ...(baseState || {}) };
  next.qcDashboardTheme = resolveQcDashboardTheme(theme);
  next.qcDashboardAccModelGuid = accModelGuid ? String(accModelGuid) : '';
  delete next.qcDashboardSeries;
  return next;
}

export function qcDashboardOriginFromState(state) {
  if (!state?.qcDashboardTheme) return null;
  return {
    theme: resolveQcDashboardTheme(state.qcDashboardTheme),
    accModelGuid: state.qcDashboardAccModelGuid || '',
    preSelectHub: state.preSelectHub ?? null,
    preSelectProject: state.preSelectProject ?? null,
  };
}

export function qcDashboardReturnPath(origin, projectId) {
  const pid = origin?.preSelectProject || projectId;
  if (!pid || !origin) return null;
  const params = new URLSearchParams();
  if (origin.accModelGuid) params.set('accModelGuid', origin.accModelGuid);
  return qcDashboardPath(pid, origin.theme, params.toString());
}
