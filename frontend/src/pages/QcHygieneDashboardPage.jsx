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
const MODEL_COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#db2777', '#0f766e'];

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
  const row = payload[0]?.payload || {};
  const runs = row.runCount;
  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.96)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        borderRadius: 8,
        padding: '8px 10px',
        color: '#fff',
        fontSize: 12,
        maxWidth: 300,
      }}
    >
      <div style={{ marginBottom: 4, color: '#cbd5e1' }}>{versionLabel(row.version)}</div>
      <div style={{ marginBottom: 6, color: '#94a3b8' }}>{formatDateTime(row.at)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color || '#fff' }}>
          {p.name} : {formatNumber(p.value)}
          {unite ? ` ${unite}` : ''}
        </div>
      ))}
      {seriesMode === 'version' && runs != null ? (
        <div style={{ marginTop: 6, color: '#94a3b8' }}>
          {runs === 1
            ? '1 contrôle réussi sur cette version'
            : `${formatNumber(runs)} contrôles réussis sur cette version`}
        </div>
      ) : null}
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

function KpiCard({ control, model, breakdown, projectId, linkState }) {
  const code = control.code;
  const value = model.values?.[code] || null;
  const href = detailHref(code, model.runId);
  const failed = value?.etatExtraction === 'echec';
  const missing = !value;
  const unite = uniteLabel(control.unite);
  const extras = value?.extras;

  let body;
  if (failed) {
    body = <div style={{ fontSize: 14, color: '#b45309' }}>Relevé indisponible</div>;
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
        border: code === 'G408' ? `1px solid rgba(124, 58, 237, 0.35)` : '1px solid rgba(148, 163, 184, 0.25)',
        borderRadius: 12,
        padding: 16,
        background: code === 'G408' ? 'rgba(124, 58, 237, 0.04)' : 'rgba(248, 250, 252, 0.9)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 8, lineHeight: 1.35 }}>
        {control.libelle}
      </div>
      {body}
      <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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

  const chartsByControl = useMemo(() => {
    return HYGIENE_CONTROLS.map((code) => {
      const rows = seriesForCharts.filter((s) => s.controlCode === code);
      const modelsWithHistory = rows
        .map((s) => ({
          ...s,
          numeric: numericPoints(s.points),
        }))
        .filter((s) => s.numeric.length > 0);
      const canChart = modelsWithHistory.some((s) => s.numeric.length >= 2);
      const singleOnly = modelsWithHistory.length > 0 && !canChart;

      const dateKeys = new Map();
      for (const s of modelsWithHistory) {
        for (const p of s.numeric) {
          const key =
            seriesMode === 'version'
              ? `v:${p.modelVersion ?? '∅'}:${p.at || p.runId}`
              : p.at
                ? new Date(p.at).toISOString()
                : p.runId;
          if (!dateKeys.has(key)) {
            dateKeys.set(key, {
              key,
              at: p.at,
              tick:
                seriesMode === 'version'
                  ? p.modelVersion != null
                    ? `v${p.modelVersion}`
                    : '—'
                  : formatDateShort(p.at),
              version: p.modelVersion,
              runCount: p.runCount ?? 1,
            });
          }
        }
      }
      const sorted = [...dateKeys.values()].sort(
        (a, b) => new Date(a.at || 0) - new Date(b.at || 0)
      );
      const data = sorted.map((d) => {
        const row = {
          key: d.key,
          tick: d.tick,
          version: d.version,
          at: d.at,
          runCount: d.runCount,
        };
        for (const s of modelsWithHistory) {
          const hit = s.numeric.find((p) => {
            const k =
              seriesMode === 'version'
                ? `v:${p.modelVersion ?? '∅'}:${p.at || p.runId}`
                : p.at
                  ? new Date(p.at).toISOString()
                  : p.runId;
            return k === d.key;
          });
          row[s.accModelGuid] = hit ? Number(hit.valeurNum) : null;
        }
        return row;
      });

      return { code, modelsWithHistory, canChart, singleOnly, data };
    });
  }, [seriesForCharts, seriesMode]);

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
                    Grandeurs relevées sur le dernier run réussi. Un avertissement critique n’a pas le
                    même poids qu’un avertissement faible.
                  </p>
                  {current.map((model) => (
                    <div key={model.runId} style={{ marginBottom: current.length > 1 ? 22 : 0 }}>
                      {current.length > 1 || accModelGuid ? (
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 10 }}>
                          {modelLabel(model)}
                          <span style={{ fontWeight: 500, color: '#64748b', marginLeft: 8 }}>
                            {formatDateTime(model.endedAtUtc || model.startedAtUtc)} · {versionLabel(model.modelVersion)}
                          </span>
                        </div>
                      ) : null}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
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
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={card}>
                  <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    Évolution dans le temps
                  </h2>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                    {seriesMode === 'version'
                      ? 'Un point par version ACC auditée (dernier contrôle réussi de cette version). C’est l’évolution de la maquette, pas le nombre de relances.'
                      : 'Un point par contrôle réussi. Utile pour voir chaque mesure, y compris les relances sur une même version.'}
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
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
                  {chartsByControl.map(({ code, modelsWithHistory, canChart, singleOnly, data }) => {
                    const unite = uniteOf(code, controls);
                    const singleHint =
                      seriesMode === 'version'
                        ? 'Une seule version ACC a un contrôle réussi'
                        : 'Un seul contrôle réussi à ce jour';
                    return (
                      <div key={code} style={{ marginBottom: 28 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                          {libelleOf(code, controls)}
                          {unite ? <span style={{ fontWeight: 500, color: '#64748b' }}> ({unite})</span> : null}
                        </div>
                        {!modelsWithHistory.length ? (
                          <div style={{ fontSize: 13, color: '#64748b', padding: '8px 0' }}>
                            Pas de valeur chiffrée pour ce contrôle sur l’historique disponible.
                          </div>
                        ) : singleOnly ? (
                          <div style={{ fontSize: 13, color: '#64748b', padding: '8px 0', lineHeight: 1.5 }}>
                            {singleHint}
                            {modelsWithHistory[0]?.numeric?.[0]
                              ? ` (${formatDateTime(modelsWithHistory[0].numeric[0].at)}, ${versionLabel(
                                  modelsWithHistory[0].numeric[0].modelVersion
                                )} : ${formatNumber(modelsWithHistory[0].numeric[0].valeurNum)}${unite ? ` ${unite}` : ''})`
                              : ''}
                            . La courbe d’évolution apparaîtra dès qu’une autre{' '}
                            {seriesMode === 'version' ? 'version' : 'mesure'} sera disponible.
                          </div>
                        ) : canChart ? (
                          <ResponsiveContainer width="100%" height={240}>
                            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                              <XAxis
                                dataKey="tick"
                                stroke="#94a3b8"
                                interval="preserveStartEnd"
                                minTickGap={36}
                                tick={{ fontSize: 11, fill: '#64748b' }}
                              />
                              <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                              <Tooltip content={<ChartTooltip unite={unite} seriesMode={seriesMode} />} />
                              {modelsWithHistory.length > 1 ? (
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                              ) : null}
                              {modelsWithHistory.map((s) => (
                                <Line
                                  key={s.accModelGuid}
                                  type="monotone"
                                  dataKey={s.accModelGuid}
                                  name={modelLabel(s)}
                                  stroke={colorByModel.get(String(s.accModelGuid).toLowerCase()) || VIOLET}
                                  strokeWidth={2}
                                  dot={{ r: 3 }}
                                  connectNulls
                                />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        ) : null}
                      </div>
                    );
                  })}
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
                          ? 'Aperçu construit pour illustration : ce projet n’a qu’une maquette. Les barres de droite ne sont pas des données réelles.'
                          : 'Même instant métier : dernier run réussi de chaque maquette, pour repérer celle qui décroche. Barres horizontales, une par maquette.'}
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
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 22 }}>
                        {HYGIENE_CONTROLS.map((code) => {
                          const unite = uniteOf(code, controls);
                          const height = Math.max(120, compareModels.length * 40 + 48);
                          if (code === 'G408') {
                            const data = compareModels.map((m) => {
                              const b = breakdownFor(m, compareBreakdown);
                              return {
                                name: modelLabel(m),
                                critique: b?.critique ?? 0,
                                faible: b?.faible ?? 0,
                              };
                            });
                            return (
                              <div key={code}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                                  {libelleOf(code, controls)}
                                  {unite ? <span style={{ fontWeight: 500, color: '#64748b' }}> ({unite})</span> : null}
                                </div>
                                <HorizontalCompareChart
                                  data={data}
                                  unite={unite}
                                  height={height}
                                  bars={[
                                    { key: 'critique', name: 'Critiques', fill: '#b91c1c', stackId: 'g408' },
                                    { key: 'faible', name: 'Faibles', fill: '#d97706', stackId: 'g408' },
                                  ]}
                                />
                              </div>
                            );
                          }
                          const data = compareModels.map((m) => {
                            const v = m.values?.[code];
                            return {
                              name: modelLabel(m),
                              valeur:
                                v && v.etatExtraction !== 'echec' && v.valeurNum != null
                                  ? Number(v.valeurNum)
                                  : 0,
                            };
                          });
                          return (
                            <div key={code}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                                {libelleOf(code, controls)}
                                {unite ? <span style={{ fontWeight: 500, color: '#64748b' }}> ({unite})</span> : null}
                              </div>
                              <HorizontalCompareChart
                                data={data}
                                unite={unite}
                                height={height}
                                bars={[{ key: 'valeur', name: libelleOf(code, controls), fill: VIOLET }]}
                              />
                            </div>
                          );
                        })}
                      </div>
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
