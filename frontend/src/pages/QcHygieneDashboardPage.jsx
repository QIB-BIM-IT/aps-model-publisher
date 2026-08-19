import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchQcProjectDashboard } from '../services/api';
import { btnSecondary, card, errorBanner, pageInner, pageShell } from '../components/qc-config/qcTheme';
import {
  QC_DASHBOARD_THEMES,
  qcDashboardPath,
  resolveQcDashboardTheme,
  withQcDashboardOrigin,
} from '../components/qc-config/qcDashboardNav';

const VIOLET = '#7c3aed';
const VIOLET_DARK = '#6d28d9';
const HYGIENE_CONTROLS = ['G408', 'G412', 'G411', 'G402', 'G410', 'G102'];
const MODEL_COLORS = ['#2563eb', '#0f766e', '#d97706', '#db2777', '#475569', '#0891b2'];
const EVOLUTION_CHART_HEIGHT = 360;
const MIN_TREND_POINTS = 5;

/**
 * Seuil d'affichage du MOUVEMENT (pas un verdict de qualité).
 * Ajuster ici uniquement.
 * - Comptages : 1 unité = un objet réel (avertissement, groupe, vue…).
 * - Taille (Mo) : 0,03 Mo sur 156 Mo est du bruit ; on signale dès 0,5 Mo
 *   ou 1 % de variation relative, le premier atteint.
 */
const STABILITY = {
  countAbs: 1,
  sizeAbsMo: 0.5,
  sizeRel: 0.01,
};

const UNITE_FR = {
  avertissements: 'avertissements',
  Mo: 'Mo',
  variantes: 'variantes',
  vues: 'vues',
  types: 'types',
  'groupes-instance-unique': 'groupes à instance unique',
};

function formatDateTime(iso) {
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

function formatDateShort(iso) {
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

function formatTimeTick(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

function pointTimeMs(p) {
  const t = new Date(p?.at || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

function timeAxisDomain(data) {
  if (!data?.length) return ['auto', 'auto'];
  const ts = data.map((d) => d.t).filter((t) => Number.isFinite(t));
  if (!ts.length) return ['auto', 'auto'];
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  const pad = min === max ? 12 * 3600 * 1000 : Math.max((max - min) * 0.05, 6 * 3600 * 1000);
  return [min - pad, max + pad];
}

function formatNumber(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 }).format(num);
}

function uniteLabel(unite) {
  if (!unite) return '';
  return UNITE_FR[unite] || unite;
}

function modelLabel(m) {
  return m?.modelName || 'Maquette';
}

function versionLabel(v) {
  if (v == null || v === '') return 'version ACC inconnue';
  return `version ACC ${v}`;
}

function detailHref(code, runId) {
  if (!runId) return null;
  if (code === 'G408' || code === 'G102') {
    return `/qc-run/${encodeURIComponent(runId)}`;
  }
  return `/qc-run/${encodeURIComponent(runId)}/elements?controlCode=${encodeURIComponent(code)}`;
}

function numericPoints(points) {
  return (points || []).filter((p) => p.valeurNum != null && Number.isFinite(Number(p.valeurNum)));
}

function groupSeriesByVersion(series) {
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

function libelleOf(code, controls) {
  const found = (controls || []).find((c) => c.code === code);
  return found?.libelle || code;
}

function uniteOf(code, controls) {
  const found = (controls || []).find((c) => c.code === code);
  return uniteLabel(found?.unite);
}

function breakdownFor(model, breakdowns) {
  return (breakdowns || []).find(
    (b) => String(b.accModelGuid).toLowerCase() === String(model.accModelGuid).toLowerCase()
  );
}

function ChartTooltip({ active, payload, unite, seriesMode }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter(
    (p) => p.value != null && p.dataKey && !String(p.dataKey).includes('__')
  );
  if (!items.length) return null;
  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.96)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        borderRadius: 8,
        padding: '8px 10px',
        color: '#fff',
        fontSize: 12,
        maxWidth: 320,
      }}
    >
      {items.map((p) => {
        const guid = String(p.dataKey);
        const row = p.payload || {};
        const at = row[`${guid}__at`];
        const version = row[`${guid}__version`];
        const runs = row[`${guid}__runCount`];
        return (
          <div key={guid} style={{ marginBottom: items.length > 1 ? 10 : 0 }}>
            <div style={{ fontWeight: 700, color: p.color || '#fff', marginBottom: 4 }}>{p.name}</div>
            <div style={{ color: '#cbd5e1' }}>{formatDateTime(at)}</div>
            <div style={{ color: '#94a3b8', margin: '2px 0 4px' }}>{versionLabel(version)}</div>
            <div>
              {formatNumber(p.value)}
              {unite ? ` ${unite}` : ''}
            </div>
            {seriesMode === 'version' && runs != null ? (
              <div style={{ marginTop: 4, color: '#94a3b8' }}>
                {runs === 1
                  ? '1 contrôle réussi sur cette version'
                  : `${formatNumber(runs)} contrôles réussis sur cette version`}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CompareTooltip({ active, payload, unite }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.96)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        borderRadius: 8,
        padding: '8px 10px',
        color: '#fff',
        fontSize: 12,
      }}
    >
      <div style={{ marginBottom: 4, color: '#cbd5e1' }}>{payload[0]?.payload?.name}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color || '#fff' }}>
          {p.name} : {formatNumber(p.value)}
          {unite ? ` ${unite}` : ''}
        </div>
      ))}
    </div>
  );
}

function HorizontalCompareChart({ data, bars, unite, height }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" horizontal={false} />
        <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis
          type="category"
          dataKey="name"
          width={168}
          stroke="#94a3b8"
          tick={{ fontSize: 11, fill: '#334155' }}
        />
        <Tooltip content={<CompareTooltip unite={unite} />} />
        {bars.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={b.fill}
            stackId={b.stackId}
            radius={b.stackId ? [0, 0, 0, 0] : [0, 4, 4, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function isNegligibleMovement(delta, unite) {
  if (!delta?.available || delta.abs == null) return false;
  const abs = Math.abs(Number(delta.abs));
  if (!Number.isFinite(abs) || abs === 0) return true;
  if (unite === 'Mo') {
    const rel = delta.rel == null ? 0 : Math.abs(Number(delta.rel));
    return abs < STABILITY.sizeAbsMo && rel < STABILITY.sizeRel;
  }
  return abs < STABILITY.countAbs;
}

function isFirstControlledVersion(model, controls) {
  const deltas = (controls || []).map((c) => model.values?.[c.code]?.delta).filter(Boolean);
  if (!deltas.length) return false;
  return deltas.every((d) => d.reason === 'no_previous_version');
}

function trendNumericCount(points) {
  return (points || []).filter((p) => p.valeurNum != null && Number.isFinite(Number(p.valeurNum))).length;
}

function formatDeltaCompact(abs, unite) {
  const n = Number(abs);
  if (!Number.isFinite(n) || n === 0) return '0';
  const sign = n > 0 ? '+' : '−';
  const body = formatNumber(Math.abs(n));
  return unite === 'Mo' ? `${sign}${body} Mo` : `${sign}${body}`;
}

function MiniTrend({ points }) {
  const numeric = (points || []).filter(
    (p) => p.valeurNum != null && Number.isFinite(Number(p.valeurNum))
  );
  if (numeric.length < MIN_TREND_POINTS) return null;
  const w = 88;
  const h = 28;
  const pad = 3;
  const vals = numeric.map((p) => Number(p.valeurNum));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const coords = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline
        fill="none"
        stroke="#64748b"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={coords.map(([x, y]) => `${x},${y}`).join(' ')}
      />
      {coords.map(([x, y], i) => (
        <circle
          key={`${x}-${y}-${i}`}
          cx={x}
          cy={y}
          r={i === coords.length - 1 ? 2.4 : 1.5}
          fill="#475569"
        />
      ))}
    </svg>
  );
}

/**
 * Teintes du delta — distinctes des badges de verdict.
 * Badge Non conforme = pastille 11px, rouge #b91c1c.
 * Delta défavorable = grand chiffre, orange brûlé, sans pastille.
 * Delta favorable = sarcelle, pas le vert du badge Conforme.
 */
const DELTA_TONE = {
  none: '#1e293b',
  good: '#0f766e',
  bad: '#c2410c',
};

function deltaTone(sensSouhaitable, abs, stable) {
  if (stable) return 'none';
  const n = Number(abs);
  if (!Number.isFinite(n) || n === 0) return 'none';
  if (sensSouhaitable === 'baisse') return n > 0 ? 'bad' : 'good';
  if (sensSouhaitable === 'hausse') return n > 0 ? 'good' : 'bad';
  return 'none';
}

function DirectionMark({ dir, color, size = 18 }) {
  if (dir === 'flat') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M4 12 H20" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
      </svg>
    );
  }
  const points = dir === 'up' ? '12,3 22,21 2,21' : '2,3 22,3 12,21';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polygon points={points} fill={color} />
    </svg>
  );
}

function VerdictBadge({ value }) {
  if (!value || value.etatExtraction === 'echec') return null;
  let label = 'Indicatif';
  let style = {
    background: 'rgba(148, 163, 184, 0.16)',
    color: '#475569',
    border: '1px solid rgba(148, 163, 184, 0.35)',
  };
  if (value.statut === 'conforme') {
    label = 'Conforme';
    style = {
      background: 'rgba(22, 163, 74, 0.1)',
      color: '#15803d',
      border: '1px solid rgba(22, 163, 74, 0.28)',
    };
  } else if (value.statut === 'non_conforme') {
    label = 'Non conforme';
    style = {
      background: 'rgba(220, 38, 38, 0.1)',
      color: '#b91c1c',
      border: '1px solid rgba(220, 38, 38, 0.28)',
    };
  }
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.02,
        padding: '3px 8px',
        borderRadius: 999,
        ...style,
      }}
    >
      {label}
    </span>
  );
}

function DeltaLine({ delta, unite, sensSouhaitable }) {
  if (!delta) return null;
  const muted = { marginTop: 8, fontSize: 12, color: '#475569', lineHeight: 1.35 };
  if (delta.reason === 'extraction_failed' || delta.reason === 'no_previous_version') return null;
  if (delta.reason === 'no_numeric' || !delta.available) {
    const prev = delta.previousVersion != null ? versionLabel(delta.previousVersion) : null;
    return (
      <div style={muted}>
        {prev
          ? `Pas de comparaison chiffrée avec la ${prev}.`
          : 'Pas de comparaison chiffrée avec la version précédente.'}
      </div>
    );
  }
  const vs = `${versionLabel(delta.previousVersion)} · ${formatDateShort(delta.previousAt)}`;
  const stable = isNegligibleMovement(delta, unite);
  const dir = stable ? 'flat' : delta.abs > 0 ? 'up' : 'down';
  const tone = deltaTone(sensSouhaitable, delta.abs, stable);
  const color = DELTA_TONE[tone];
  const compact = stable ? 'stable' : formatDeltaCompact(delta.abs, unite);
  return (
    <div style={muted} title={`Comparé à la ${vs}`}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 22,
          fontWeight: 800,
          color,
          letterSpacing: 0.01,
          lineHeight: 1.1,
        }}
      >
        <DirectionMark dir={dir} color={color} size={18} />
        <span>{compact}</span>
      </div>
      <div style={{ marginTop: 3, fontSize: 11, color: '#64748b' }}>depuis la {vs}</div>
    </div>
  );
}

function KpiCard({ control, model, breakdown, projectId, linkState, hideDelta }) {
  const code = control.code;
  const value = model.values?.[code] || null;
  const href = detailHref(code, model.runId);
  const failed = value?.etatExtraction === 'echec';
  const missing = !value;
  const unite = uniteLabel(control.unite);
  const extras = value?.extras;
  const showTrend = !hideDelta && trendNumericCount(value?.trend) >= MIN_TREND_POINTS;

  let body;
  if (failed) {
    body = (
      <div style={{ fontSize: 14, color: '#b45309' }}>
        Relevé indisponible — aucun verdict, aucune comparaison.
      </div>
    );
  } else if (missing || value.valeurNum == null) {
    body = <div style={{ fontSize: 14, color: '#64748b' }}>Pas de donnée chiffrée</div>;
  } else if (code === 'G408') {
    const critique = breakdown?.critique ?? extras?.critique;
    const faible = breakdown?.faible ?? extras?.faible;
    body = (
      <>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
          {formatNumber(value.valeurNum)}
          <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginLeft: 6 }}>{unite}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 8,
              background: 'rgba(220, 38, 38, 0.1)',
              color: '#b91c1c',
              border: '1px solid rgba(220, 38, 38, 0.25)',
            }}
          >
            {formatNumber(critique)} critiques
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 8,
              background: 'rgba(217, 119, 6, 0.1)',
              color: '#b45309',
              border: '1px solid rgba(217, 119, 6, 0.25)',
            }}
          >
            {formatNumber(faible)} faibles
          </span>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
          {formatNumber(value.valeurNum)}
          <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginLeft: 6 }}>{unite}</span>
        </div>
        {code === 'G412' && extras && (extras.famillesInPlace != null || extras.typesGroupes != null) ? (
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            {extras.famillesInPlace != null ? `${formatNumber(extras.famillesInPlace)} familles in situ` : null}
            {extras.famillesInPlace != null && extras.typesGroupes != null ? ' · ' : null}
            {extras.typesGroupes != null ? `${formatNumber(extras.typesGroupes)} types de groupes` : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div
      style={{
        border: '1px solid rgba(148, 163, 184, 0.25)',
        borderRadius: 12,
        padding: 16,
        background: 'rgba(248, 250, 252, 0.9)',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', lineHeight: 1.35 }}>
          {control.libelle}
        </div>
        <VerdictBadge value={value} />
      </div>
      {body}
      {!failed && !hideDelta ? (
        <DeltaLine delta={value?.delta} unite={unite} sensSouhaitable={control.sensSouhaitable} />
      ) : null}
      {showTrend ? (
        <div style={{ marginTop: 10 }}>
          <MiniTrend points={value?.trend} />
        </div>
      ) : null}
      <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {href ? (
          <Link
            to={href}
            state={linkState}
            style={{ fontSize: 12, fontWeight: 600, color: VIOLET_DARK, textDecoration: 'none' }}
          >
            Voir le détail →
          </Link>
        ) : null}
        {projectId && (code === 'G412' || code === 'G411' || code === 'G402' || code === 'G410') ? (
          <Link
            to={`/qc-project/${encodeURIComponent(projectId)}/elements?controlCode=${encodeURIComponent(code)}&accModelGuid=${encodeURIComponent(model.accModelGuid)}`}
            state={linkState}
            style={{ fontSize: 12, color: '#64748b', textDecoration: 'none' }}
          >
            Éléments désignés
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function WhatChangedSection({ current, controls }) {
  if (!current.length) return null;
  const modelsWithHistory = current.filter((m) => !isFirstControlledVersion(m, controls));
  if (!modelsWithHistory.length) return null;
  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
        Ce qui a changé
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
        Mouvements depuis la version ACC précédente, pas depuis le dernier run. Ce sont des faits,
        pas un jugement.
      </p>
      {modelsWithHistory.map((model) => {
        const moved = [];
        const stable = [];
        for (const control of controls) {
          const value = model.values?.[control.code];
          const delta = value?.delta;
          if (!delta || delta.reason === 'extraction_failed') continue;
          if (delta.reason === 'no_previous_version') continue;
          if (!delta.available || delta.abs == null) continue;
          const unite = uniteLabel(control.unite);
          const item = {
            control,
            delta,
            unite,
            currentN: value?.valeurNum,
            negligible: isNegligibleMovement(delta, unite),
          };
          if (item.negligible) stable.push(item);
          else moved.push(item);
        }
        return (
          <div key={model.runId} style={{ marginBottom: modelsWithHistory.length > 1 ? 18 : 0 }}>
            {current.length > 1 ? (
              <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
                {modelLabel(model)}
              </div>
            ) : null}
            {moved.length ? (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', color: '#0f172a', fontSize: 14, lineHeight: 1.55 }}>
                {moved.map(({ control, delta, unite, currentN }) => {
                  const dir = delta.abs > 0 ? 'up' : 'down';
                  const tone = deltaTone(control.sensSouhaitable, delta.abs, false);
                  const color = DELTA_TONE[tone];
                  return (
                    <li
                      key={control.code}
                      style={{
                        marginBottom: 8,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}
                    >
                      <span style={{ marginTop: 2 }}>
                        <DirectionMark dir={dir} color={color} size={14} />
                      </span>
                      <span>
                        <strong>{control.libelle}</strong>
                        {' : '}
                        {formatNumber(delta.previousValeurNum)}
                        {' → '}
                        {formatNumber(currentN)}
                        {unite ? ` ${unite}` : ''}
                        {' ('}
                        {versionLabel(delta.previousVersion)}
                        {' → '}
                        {versionLabel(delta.currentVersion)}
                        {')'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div style={{ fontSize: 14, color: '#475569' }}>
                Aucune grandeur n’a bougé depuis la version ACC précédente.
              </div>
            )}
            {stable.length ? (
              <div style={{ marginTop: 8, fontSize: 13, color: '#64748b' }}>
                Inchangés : {stable.map((s) => s.control.libelle).join(', ')}.
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function QcHygieneDashboardPage() {
  const { projectId, theme: themeParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const accModelGuid = searchParams.get('accModelGuid') || '';
  const seriesMode = searchParams.get('series') === 'run' ? 'run' : 'version';
  const previewCompare = searchParams.get('apercuComparaison') === '1';
  const theme = resolveQcDashboardTheme(themeParam);
  const themeMeta = QC_DASHBOARD_THEMES.find((t) => t.id === theme);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [metricCode, setMetricCode] = useState('');
  const [hiddenModels, setHiddenModels] = useState(() => new Set());

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchQcProjectDashboard(projectId, {
        controls: HYGIENE_CONTROLS.join(','),
        accModelGuid: accModelGuid || undefined,
      });
      setPayload(data);
    } catch (err) {
      setError(err?.message || 'Impossible de charger le tableau de bord');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, accModelGuid]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!projectId) return;
    if (themeParam === theme) return;
    navigate(qcDashboardPath(projectId, theme) + location.search, {
      replace: true,
      state: location.state,
    });
  }, [projectId, theme, themeParam, location.search, location.state, navigate]);

  const project = payload?.project;
  const controls = payload?.controls || [];
  const current = payload?.current || [];
  const series = payload?.series || [];
  const seriesByVersion = payload?.seriesByVersion || [];
  const warningBreakdown = payload?.warningBreakdown || [];
  const seriesForCharts =
    seriesMode === 'run'
      ? series
      : seriesByVersion.length
        ? seriesByVersion
        : groupSeriesByVersion(series);

  useEffect(() => {
    if (!controls.length) return;
    if (!controls.some((c) => c.code === metricCode)) {
      setMetricCode(controls[0].code);
    }
  }, [controls, metricCode]);

  const modelOptions = useMemo(() => {
    const fromApi = payload?.models || [];
    if (fromApi.length) return fromApi;
    const map = new Map();
    for (const m of current) {
      map.set(String(m.accModelGuid).toLowerCase(), {
        accModelGuid: m.accModelGuid,
        modelName: m.modelName,
      });
    }
    return [...map.values()];
  }, [payload, current]);

  const colorByModel = useMemo(() => {
    const map = new Map();
    modelOptions.forEach((m, i) => {
      map.set(String(m.accModelGuid).toLowerCase(), MODEL_COLORS[i % MODEL_COLORS.length]);
    });
    return map;
  }, [modelOptions]);

  function replaceParams({ nextModel = accModelGuid, nextSeries = seriesMode }) {
    const next = {};
    if (nextModel) next.accModelGuid = nextModel;
    if (nextSeries === 'run') next.series = 'run';
    setSearchParams(next, { replace: true });
  }

  function setModelFilter(next) {
    replaceParams({ nextModel: next, nextSeries: seriesMode });
  }

  function goBackToPlanning() {
    const hubId = project?.hubId || location.state?.preSelectHub || null;
    const pid = project?.projectId || projectId;
    if (!pid) {
      navigate('/planning');
      return;
    }
    navigate('/planning', {
      state: {
        preSelectHub: hubId,
        preSelectProject: pid,
      },
    });
  }

  function goToTheme(nextTheme) {
    if (!projectId || nextTheme === theme) return;
    navigate(qcDashboardPath(projectId, nextTheme) + location.search, {
      state: location.state,
    });
  }

  const detailLinkState = withQcDashboardOrigin(
    {
      preSelectHub: location.state?.preSelectHub || project?.hubId || null,
      preSelectProject: location.state?.preSelectProject || project?.projectId || projectId,
    },
    { theme, accModelGuid, series: seriesMode }
  );

  function toggleChartModel(guid) {
    const key = String(guid).toLowerCase();
    setHiddenModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const timeChart = useMemo(() => {
    const code = metricCode;
    const enabled = new Set(
      modelOptions
        .filter((m) => !hiddenModels.has(String(m.accModelGuid).toLowerCase()))
        .map((m) => String(m.accModelGuid).toLowerCase())
    );
    const rows = (seriesForCharts || [])
      .filter((s) => s.controlCode === code)
      .map((s) => ({
        ...s,
        guid: String(s.accModelGuid).toLowerCase(),
        numeric: numericPoints(s.points),
      }))
      .filter((s) => enabled.has(s.guid) && s.numeric.length > 0);

    const byT = new Map();
    for (const s of rows) {
      for (const p of s.numeric) {
        const t = pointTimeMs(p);
        if (t == null) continue;
        if (!byT.has(t)) byT.set(t, { t });
        const row = byT.get(t);
        row[s.guid] = Number(p.valeurNum);
        row[`${s.guid}__version`] = p.modelVersion;
        row[`${s.guid}__runCount`] = p.runCount ?? 1;
        row[`${s.guid}__at`] = p.at;
      }
    }
    const data = [...byT.values()].sort((a, b) => a.t - b.t);
    return { rows, data, domain: timeAxisDomain(data) };
  }, [seriesForCharts, metricCode, modelOptions, hiddenModels]);

  const compareModels = useMemo(() => {
    if (current.length >= 2 || !previewCompare || current.length !== 1) return current;
    const a = current[0];
    const scale = (n, f) => (n == null ? null : Math.round(Number(n) * f * 100) / 100);
    const bValues = {};
    for (const [code, v] of Object.entries(a.values || {})) {
      bValues[code] = v ? { ...v, valeurNum: scale(v.valeurNum, 0.62) } : v;
    }
    return [
      a,
      {
        ...a,
        accModelGuid: '00000000-0000-0000-0000-apercu',
        modelName: `${modelLabel(a)} (aperçu)`,
        values: bValues,
      },
    ];
  }, [current, previewCompare]);

  const compareBreakdown = useMemo(() => {
    if (compareModels.length < 2) return warningBreakdown;
    if (!previewCompare || current.length >= 2) return warningBreakdown;
    const src = warningBreakdown[0] || {};
    return [
      src,
      {
        ...src,
        accModelGuid: '00000000-0000-0000-0000-apercu',
        critique: src.critique == null ? null : Math.max(0, Math.round(src.critique * 0.5)),
        faible: src.faible == null ? null : Math.max(0, Math.round(src.faible * 0.7)),
        total: null,
      },
    ];
  }, [compareModels, previewCompare, current.length, warningBreakdown]);

  const compareRows = useMemo(() => {
    if (compareModels.length < 2) return [];
    return HYGIENE_CONTROLS.map((code) => {
      const row = { code, libelle: libelleOf(code, controls), unite: uniteOf(code, controls) };
      for (const m of compareModels) {
        const v = m.values?.[code];
        row[m.accModelGuid] =
          v && v.etatExtraction !== 'echec' && v.valeurNum != null ? Number(v.valeurNum) : null;
      }
      return row;
    });
  }, [compareModels, controls]);

  return (
    <div style={pageShell}>
      <div style={{ ...pageInner, maxWidth: 1180 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          <button type="button" onClick={goBackToPlanning} style={{ ...btnSecondary }}>
            ← Retour à la planification
          </button>
        </div>

        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            margin: '0 0 6px',
            background: `linear-gradient(135deg, ${VIOLET} 0%, ${VIOLET_DARK} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Tableau de bord QC
        </h1>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: '#94a3b8', lineHeight: 1.5, maxWidth: 820 }}>
          Suivi de la qualité des maquettes du projet. Le thème actif décrit un regroupement de
          contrôles ; d’autres thèmes arriveront ensuite.
        </p>

        <div
          role="tablist"
          aria-label="Thèmes du tableau de bord"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 20,
          }}
        >
          {QC_DASHBOARD_THEMES.map((t) => {
            const active = t.id === theme;
            const clickable = t.available;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={!clickable}
                onClick={() => clickable && goToTheme(t.id)}
                title={clickable ? t.label : `${t.label} — à venir`}
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: active ? 700 : 600,
                  cursor: clickable ? 'pointer' : 'default',
                  border: active
                    ? `1px solid ${VIOLET}`
                    : '1px solid rgba(148, 163, 184, 0.35)',
                  background: active ? 'rgba(124, 58, 237, 0.12)' : 'transparent',
                  color: !clickable ? '#64748b' : active ? VIOLET_DARK : '#cbd5e1',
                  opacity: clickable ? 1 : 0.7,
                }}
              >
                {t.label}
                {!clickable ? (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>
                    à venir
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {loading && (
          <div style={{ ...card, color: '#64748b' }}>Chargement de l’état du projet…</div>
        )}
        {error && <div style={errorBanner}>{error}</div>}

        {!loading && !error && (
          <>
            <div style={{ ...card, borderTop: `4px solid ${VIOLET}` }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 16,
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
                    Projet
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    {project?.projectName || 'Projet'}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                    {themeMeta?.label || 'Hygiène et santé du modèle'}
                  </div>
                </div>
                <label style={{ minWidth: 260, flex: '1 1 260px' }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                    Maquette
                  </span>
                  <select
                    value={accModelGuid}
                    onChange={(e) => setModelFilter(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(148, 163, 184, 0.35)',
                      background: '#fff',
                      fontSize: 14,
                      color: '#0f172a',
                    }}
                  >
                    <option value="">Toutes les maquettes</option>
                    {modelOptions.map((m) => (
                      <option key={m.accModelGuid} value={m.accModelGuid}>
                        {modelLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p style={{ margin: '16px 0 0', fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                L’état actuel correspond au <strong>dernier contrôle réussi</strong> de chaque maquette.
                {current.length
                  ? ` ${current
                      .map(
                        (m) =>
                          `${modelLabel(m)} : ${formatDateTime(m.endedAtUtc || m.startedAtUtc)} (${versionLabel(m.modelVersion)})`
                      )
                      .join(' · ')}`
                  : ' Aucune maquette n’a encore de contrôle réussi.'}
              </p>
            </div>

            {!current.length ? (
              <div style={card}>
                <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Aucun contrôle réussi</div>
                <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>
                  Ce projet n’a pas encore de run réussi, ou la maquette filtrée n’en a aucun. Les
                  indicateurs et les courbes apparaîtront dès qu’un contrôle aboutira.
                </div>
              </div>
            ) : (
              <>
                <div style={card}>
                  <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    État actuel
                  </h2>
                  <p style={{ margin: '0 0 18px', fontSize: 13, color: '#64748b' }}>
                    Grandeurs relevées sur le dernier run réussi. Le verdict vient du scoring du
                    projet ; sans cible, le contrôle reste indicatif. Un avertissement critique n’a
                    pas le même poids qu’un avertissement faible.
                  </p>
                  {current.map((model) => {
                    const firstVersion = isFirstControlledVersion(model, controls);
                    const showHeading = current.length > 1 || accModelGuid || firstVersion;
                    return (
                    <div key={model.runId} style={{ marginBottom: current.length > 1 ? 22 : 0 }}>
                      {showHeading ? (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>
                            {modelLabel(model)}
                            <span style={{ fontWeight: 500, color: '#64748b', marginLeft: 8 }}>
                              {formatDateTime(model.endedAtUtc || model.startedAtUtc)} · {versionLabel(model.modelVersion)}
                            </span>
                          </div>
                          {firstVersion ? (
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                              Premier contrôle de cette maquette — aucune version antérieure à comparer.
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                          gap: 12,
                        }}
                      >
                        {controls.map((control) => (
                          <KpiCard
                            key={`${model.runId}-${control.code}`}
                            control={control}
                            model={model}
                            breakdown={breakdownFor(model, warningBreakdown)}
                            projectId={project?.projectId || projectId}
                            linkState={detailLinkState}
                            hideDelta={firstVersion}
                          />
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </div>

                <WhatChangedSection current={current} controls={controls} />

                <div style={card}>
                  <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    Évolution dans le temps
                  </h2>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                    {seriesMode === 'version'
                      ? 'Un point par version ACC de chaque maquette, placé à la date du dernier contrôle réussi de cette version. Les numéros de version ne sont pas comparés d’une maquette à l’autre.'
                      : 'Un point par contrôle réussi, placé à sa date réelle.'}
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <button
                      type="button"
                      onClick={() => replaceParams({ nextSeries: 'version' })}
                      style={{
                        ...btnSecondary,
                        background: seriesMode === 'version' ? 'rgba(124, 58, 237, 0.12)' : undefined,
                        color: seriesMode === 'version' ? VIOLET_DARK : undefined,
                        border:
                          seriesMode === 'version'
                            ? '1px solid rgba(124, 58, 237, 0.45)'
                            : undefined,
                      }}
                    >
                      Par version ACC
                    </button>
                    <button
                      type="button"
                      onClick={() => replaceParams({ nextSeries: 'run' })}
                      style={{
                        ...btnSecondary,
                        background: seriesMode === 'run' ? 'rgba(124, 58, 237, 0.12)' : undefined,
                        color: seriesMode === 'run' ? VIOLET_DARK : undefined,
                        border:
                          seriesMode === 'run' ? '1px solid rgba(124, 58, 237, 0.45)' : undefined,
                      }}
                    >
                      Chaque contrôle
                    </button>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                      Grandeur
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {controls.map((c) => {
                        const active = c.code === metricCode;
                        return (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => setMetricCode(c.code)}
                            style={{
                              ...btnSecondary,
                              background: active ? 'rgba(124, 58, 237, 0.12)' : undefined,
                              color: active ? VIOLET_DARK : undefined,
                              border: active ? '1px solid rgba(124, 58, 237, 0.45)' : undefined,
                            }}
                          >
                            {c.libelle}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {modelOptions.length > 1 ? (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                        Maquettes
                      </div>
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {modelOptions.map((m) => {
                          const guid = String(m.accModelGuid).toLowerCase();
                          const checked = !hiddenModels.has(guid);
                          return (
                            <label
                              key={guid}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 13,
                                color: '#334155',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleChartModel(m.accModelGuid)}
                                style={{ accentColor: VIOLET }}
                              />
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 99,
                                  background: colorByModel.get(guid) || '#64748b',
                                  flexShrink: 0,
                                }}
                              />
                              {modelLabel(m)}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {(() => {
                    const unite = uniteOf(metricCode, controls);
                    if (!timeChart.rows.length) {
                      return (
                        <div style={{ fontSize: 13, color: '#64748b', padding: '8px 0' }}>
                          {hiddenModels.size && modelOptions.length
                            ? 'Activez au moins une maquette pour afficher la courbe.'
                            : 'Pas de valeur chiffrée pour cette grandeur sur l’historique disponible.'}
                        </div>
                      );
                    }
                    return (
                      <ResponsiveContainer width="100%" height={EVOLUTION_CHART_HEIGHT}>
                        <LineChart data={timeChart.data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                          <XAxis
                            type="number"
                            dataKey="t"
                            domain={timeChart.domain}
                            tickFormatter={formatTimeTick}
                            minTickGap={48}
                            tick={{ fontSize: 11, fill: '#64748b' }}
                            stroke="#94a3b8"
                          />
                          <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                          <Tooltip content={<ChartTooltip unite={unite} seriesMode={seriesMode} />} />
                          {timeChart.rows.length > 1 ? (
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                          ) : null}
                          {timeChart.rows.map((s) => (
                            <Line
                              key={s.guid}
                              type="monotone"
                              dataKey={s.guid}
                              name={modelLabel(s)}
                              stroke={colorByModel.get(s.guid) || '#2563eb'}
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </div>

                <div style={card}>
                  <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    Comparaison entre maquettes
                  </h2>
                  {compareModels.length < 2 ? (
                    <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                      Une seule maquette a un contrôle réussi sur ce projet
                      {accModelGuid ? ' (filtre actif)' : ''}. La comparaison n’a de sens qu’avec au
                      moins deux maquettes.
                    </p>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
                        {previewCompare && current.length < 2
                          ? 'Aperçu construit pour illustration : ce projet n’a qu’une maquette. Les chiffres de droite ne sont pas des données réelles.'
                          : 'Dernier contrôle réussi de chaque maquette. La barre segmentée montre la composition des avertissements, que le tableau ne détaille pas.'}
                      </p>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b' }}>
                                Contrôle
                              </th>
                              {compareModels.map((m) => (
                                <th
                                  key={m.accModelGuid}
                                  style={{ textAlign: 'right', padding: '8px 10px', color: '#64748b' }}
                                >
                                  {modelLabel(m)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {compareRows.map((row) => (
                              <tr key={row.code} style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
                                <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 600 }}>
                                  {row.libelle}
                                  {row.unite ? (
                                    <span style={{ fontWeight: 500, color: '#64748b' }}> ({row.unite})</span>
                                  ) : null}
                                </td>
                                {compareModels.map((m) => (
                                  <td
                                    key={m.accModelGuid}
                                    style={{ padding: '8px 10px', textAlign: 'right', color: '#0f172a' }}
                                  >
                                    {formatNumber(row[m.accModelGuid])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {controls.some((c) => c.code === 'G408') ? (
                        <div style={{ marginTop: 18 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                            {libelleOf('G408', controls)}
                            {uniteOf('G408', controls) ? (
                              <span style={{ fontWeight: 500, color: '#64748b' }}>
                                {' '}
                                ({uniteOf('G408', controls)})
                              </span>
                            ) : null}
                          </div>
                          <HorizontalCompareChart
                            data={compareModels.map((m) => {
                              const b = breakdownFor(m, compareBreakdown);
                              return {
                                name: modelLabel(m),
                                critique: b?.critique ?? 0,
                                faible: b?.faible ?? 0,
                              };
                            })}
                            unite={uniteOf('G408', controls)}
                            height={Math.max(120, compareModels.length * 40 + 48)}
                            bars={[
                              { key: 'critique', name: 'Critiques', fill: '#b91c1c', stackId: 'g408' },
                              { key: 'faible', name: 'Faibles', fill: '#d97706', stackId: 'g408' },
                            ]}
                          />
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
