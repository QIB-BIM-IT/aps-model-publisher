/** Utilitaires d’affichage partagés des tableaux de bord QC thématiques. */

export const VIOLET = '#7c3aed';
export const VIOLET_DARK = '#6d28d9';
export const MODEL_COLORS = ['#2563eb', '#0f766e', '#d97706', '#db2777', '#475569', '#0891b2'];
export const EVOLUTION_CHART_HEIGHT = 360;
export const MIN_TREND_POINTS = 5;

export const STABILITY = {
  countAbs: 1,
  sizeAbsMo: 0.5,
  sizeRel: 0.01,
};

export const UNITE_FR = {
  avertissements: 'avertissements',
  Mo: 'Mo',
  variantes: 'variantes',
  vues: 'vues',
  types: 'types',
  'groupes-instance-unique': 'groupes à instance unique',
  pourcentage: '%',
  absents: 'absents',
};

export const DELTA_TONE = {
  none: '#1e293b',
  good: '#0f766e',
  bad: '#c2410c',
};

export function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

export function formatDateShort(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return String(iso);
  }
}

export function formatTimeTick(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

export function pointTimeMs(p) {
  const t = new Date(p?.at || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

export function timeAxisDomain(data) {
  if (!data?.length) return ['auto', 'auto'];
  const ts = data.map((d) => d.t).filter((t) => Number.isFinite(t));
  if (!ts.length) return ['auto', 'auto'];
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  const pad = min === max ? 12 * 3600 * 1000 : Math.max((max - min) * 0.05, 6 * 3600 * 1000);
  return [min - pad, max + pad];
}

export function formatNumber(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 }).format(num);
}

export function uniteLabel(unite) {
  if (!unite) return '';
  return UNITE_FR[unite] || unite;
}

export function modelLabel(m) {
  return m?.modelName || 'Maquette';
}

export function versionLabel(v) {
  if (v == null || v === '') return 'version ACC inconnue';
  return `version ACC ${v}`;
}

export function detailHref(code, runId) {
  if (!runId) return null;
  if (code === 'G408' || code === 'G102') {
    return `/qc-run/${encodeURIComponent(runId)}`;
  }
  return `/qc-run/${encodeURIComponent(runId)}/elements?controlCode=${encodeURIComponent(code)}`;
}

export function numericPoints(points) {
  return (points || []).filter((p) => p.valeurNum != null && Number.isFinite(Number(p.valeurNum)));
}

export function groupSeriesByVersion(series) {
  return (series || []).map((s) => {
    const buckets = new Map();
    for (const p of s.points || []) {
      const key = p.modelVersion == null ? '∅' : String(p.modelVersion);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }
    const points = [...buckets.values()].map((arr) => {
      const ordered = [...arr].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
      const last = ordered[ordered.length - 1];
      return { ...last, runCount: arr.length };
    });
    points.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
    return { ...s, points };
  });
}

export function libelleOf(code, controls) {
  const found = (controls || []).find((c) => c.code === code);
  return found?.libelle || code;
}

export function uniteOf(code, controls) {
  const found = (controls || []).find((c) => c.code === code);
  return uniteLabel(found?.unite);
}

export function breakdownFor(model, breakdowns) {
  return (breakdowns || []).find(
    (b) => String(b.accModelGuid).toLowerCase() === String(model.accModelGuid).toLowerCase()
  );
}

export function deltaTone(sensSouhaitable, abs, stable) {
  if (stable) return 'none';
  const n = Number(abs);
  if (!Number.isFinite(n) || n === 0) return 'none';
  if (sensSouhaitable === 'baisse') return n > 0 ? 'bad' : 'good';
  if (sensSouhaitable === 'hausse') return n > 0 ? 'good' : 'bad';
  return 'none';
}

export function isNegligibleMovement(delta, unite) {
  if (!delta?.available || delta.abs == null) return false;
  const abs = Math.abs(Number(delta.abs));
  if (!Number.isFinite(abs) || abs === 0) return true;
  if (unite === 'Mo') {
    const rel = delta.rel == null ? 0 : Math.abs(Number(delta.rel));
    return abs < STABILITY.sizeAbsMo && rel < STABILITY.sizeRel;
  }
  return abs < STABILITY.countAbs;
}

export function isFirstControlledVersion(model, controls) {
  const deltas = (controls || []).map((c) => model.values?.[c.code]?.delta).filter(Boolean);
  if (!deltas.length) return false;
  return deltas.every((d) => d.reason === 'no_previous_version');
}

export function trendNumericCount(points) {
  return (points || []).filter((p) => p.valeurNum != null && Number.isFinite(Number(p.valeurNum))).length;
}

export function formatDeltaCompact(abs, unite) {
  const n = Number(abs);
  if (!Number.isFinite(n) || n === 0) return '0';
  const sign = n > 0 ? '+' : '−';
  const body = formatNumber(Math.abs(n));
  return unite === 'Mo' ? `${sign}${body} Mo` : `${sign}${body}`;
}

export const PROJECT_ELEMENTS_CODES = new Set(['G412', 'G411', 'G402', 'G410', 'G504', 'G508']);
