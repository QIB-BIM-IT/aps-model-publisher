// Préférence de largeur du volet 3D (éléments désignés).
// localStorage peut être absent ou bloqué : toujours retomber sur le défaut.

export const STORAGE_KEY = 'qc.elements.viewerWidthPx';
export const DEFAULT_VIEWER_PX = 560;
export const MIN_VIEWER_PX = 400;
export const MIN_TABLE_PX = 420;
export const HANDLE_PX = 8;
export const STACK_BELOW_PX = 960;

export function readStoredViewerWidth(fallback = DEFAULT_VIEWER_PX) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === '') return fallback;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return n;
  } catch {
    return fallback;
  }
}

export function writeStoredViewerWidth(px) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(px)));
  } catch {
    /* quota, mode privé, politique d'entreprise */
  }
}

export function clampViewerWidth(desired, containerWidth) {
  const want = Number.isFinite(desired) ? desired : DEFAULT_VIEWER_PX;
  if (!containerWidth || containerWidth <= 0) {
    return Math.max(MIN_VIEWER_PX, want);
  }
  const maxViewer = Math.max(MIN_VIEWER_PX, containerWidth - MIN_TABLE_PX - HANDLE_PX);
  return Math.min(maxViewer, Math.max(MIN_VIEWER_PX, want));
}
