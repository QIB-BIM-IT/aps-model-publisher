import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
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
import {
  EVOLUTION_CHART_HEIGHT,
  MODEL_COLORS,
  VIOLET,
  VIOLET_DARK,
  breakdownFor,
  formatDateTime,
  formatNumber,
  formatTimeTick,
  groupSeriesByVersion,
  isFirstControlledVersion,
  libelleOf,
  modelLabel,
  numericPoints,
  pointTimeMs,
  timeAxisDomain,
  uniteOf,
  versionLabel,
} from '../components/qc-dashboard/qcDashboardShared';
import {
  ChartTooltip,
  CoverageDonut,
  HorizontalCompareChart,
  KpiCard,
  WhatChangedSection,
} from '../components/qc-dashboard/QcDashboardWidgets';
import QcCodificationCategorySection from '../components/qc-dashboard/QcCodificationCategorySection';

export default function QcDashboardThemePage() {
  const { projectId, theme: themeParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const accModelGuid = searchParams.get('accModelGuid') || '';
  const previewCompare = searchParams.get('apercuComparaison') === '1';
  const theme = resolveQcDashboardTheme(themeParam);
  const themeMeta = QC_DASHBOARD_THEMES.find((t) => t.id === theme);
  const controlsKey = (themeMeta?.controls || []).join(',');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [metricCode, setMetricCode] = useState('');
  const [hiddenModels, setHiddenModels] = useState(() => new Set());

  const load = useCallback(async () => {
    if (!projectId || !controlsKey) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchQcProjectDashboard(projectId, {
        controls: controlsKey,
        accModelGuid: accModelGuid || undefined,
      });
      setPayload(data);
    } catch (err) {
      setError(err?.message || 'Impossible de charger le tableau de bord');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, accModelGuid, controlsKey]);

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
  const seriesForCharts = seriesByVersion.length ? seriesByVersion : groupSeriesByVersion(series);

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

  function replaceParams({ nextModel = accModelGuid }) {
    const next = {};
    if (nextModel) next.accModelGuid = nextModel;
    setSearchParams(next, { replace: true });
  }

  function setModelFilter(next) {
    replaceParams({ nextModel: next });
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
    { theme, accModelGuid }
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
    return (controls || []).map((codeMeta) => {
      const row = { code: codeMeta.code, libelle: codeMeta.libelle, unite: uniteOf(codeMeta.code, controls) };
      for (const m of compareModels) {
        row[m.accModelGuid] = m.values?.[codeMeta.code]?.valeurNum ?? null;
      }
      return row;
    });
  }, [compareModels, controls]);

  const isHygiene = theme === 'hygiene';
  const isDonnees = theme === 'donnees';

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
                    {isHygiene
                      ? 'Grandeurs relevées sur le dernier run réussi. Le verdict vient du scoring du projet ; sans cible, le contrôle reste indicatif. Un avertissement critique n’a pas le même poids qu’un avertissement faible.'
                      : 'Grandeurs relevées sur le dernier run réussi. Le verdict vient du scoring du projet ; sans cible, le contrôle reste indicatif.'}
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
                            showMiniTrend={isHygiene}
                          />
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </div>

                <WhatChangedSection current={current} controls={controls} />

                {isDonnees ? (
                  <div style={card}>
                    <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                      Composition de la couverture
                    </h2>
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                      Part des entités qui portent un code UNIFORMAT, parmi celles qui devraient en
                      porter un. Ce n’est pas une comparaison entre maquettes.
                    </p>
                    <CoverageDonut current={current} controlCode="G504" />
                  </div>
                ) : null}

                <div style={card}>
                  <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                    Évolution dans le temps
                  </h2>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                    Un point par version ACC de chaque maquette, placé à la date du contrôle de
                    cette version. Les numéros de version ne sont pas comparés d’une maquette à
                    l’autre.
                  </p>
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
                          <Tooltip content={<ChartTooltip unite={unite} />} />
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

                {isDonnees ? (
                  <QcCodificationCategorySection
                    projectId={project?.projectId || projectId}
                    accModelGuid={accModelGuid}
                    current={current}
                  />
                ) : null}

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
                          : isHygiene
                            ? 'Dernier contrôle réussi de chaque maquette. La barre segmentée montre la composition des avertissements, que le tableau ne détaille pas.'
                            : 'Dernier contrôle réussi de chaque maquette.'}
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
                      {isHygiene && controls.some((c) => c.code === 'G408') ? (
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
