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

function ChartTooltip({ active, payload, label, unite }) {
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
        maxWidth: 280,
      }}
    >
      <div style={{ marginBottom: 4, color: '#cbd5e1' }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color || '#fff' }}>
          {p.name} : {formatNumber(p.value)}
          {unite ? ` ${unite}` : ''}
          {p.payload?.version != null ? ` · ${versionLabel(p.payload.version)}` : ''}
        </div>
      ))}
    </div>
  );
}

function KpiCard({ control, model, breakdown, projectId }) {
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
            style={{ fontSize: 12, fontWeight: 600, color: VIOLET_DARK, textDecoration: 'none' }}
          >
            Voir le détail →
          </Link>
        ) : null}
        {projectId && (code === 'G412' || code === 'G411' || code === 'G402' || code === 'G410') ? (
          <Link
            to={`/qc-project/${encodeURIComponent(projectId)}/elements?controlCode=${encodeURIComponent(code)}&accModelGuid=${encodeURIComponent(model.accModelGuid)}`}
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
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const accModelGuid = searchParams.get('accModelGuid') || '';

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

  const project = payload?.project;
  const controls = payload?.controls || [];
  const current = payload?.current || [];
  const series = payload?.series || [];
  const warningBreakdown = payload?.warningBreakdown || [];

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

  function setModelFilter(next) {
    if (next) setSearchParams({ accModelGuid: next }, { replace: true });
    else setSearchParams({}, { replace: true });
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

  const chartsByControl = useMemo(() => {
    return HYGIENE_CONTROLS.map((code) => {
      const rows = series.filter((s) => s.controlCode === code);
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
          const key = p.at ? new Date(p.at).toISOString() : p.runId;
          if (!dateKeys.has(key)) {
            dateKeys.set(key, {
              key,
              at: p.at,
              label: `${formatDateShort(p.at)} · v${p.modelVersion ?? '?'}`,
              version: p.modelVersion,
            });
          }
        }
      }
      const sorted = [...dateKeys.values()].sort(
        (a, b) => new Date(a.at || 0) - new Date(b.at || 0)
      );
      const data = sorted.map((d) => {
        const row = { key: d.key, label: d.label, version: d.version, at: d.at };
        for (const s of modelsWithHistory) {
          const hit = s.numeric.find((p) => {
            const k = p.at ? new Date(p.at).toISOString() : p.runId;
            return k === d.key;
          });
          row[s.accModelGuid] = hit ? Number(hit.valeurNum) : null;
        }
        return row;
      });

      return { code, modelsWithHistory, canChart, singleOnly, data };
    });
  }, [series]);

  const compareRows = useMemo(() => {
    if (current.length < 2) return [];
    return HYGIENE_CONTROLS.map((code) => {
      const row = { code, libelle: libelleOf(code, controls), unite: uniteOf(code, controls) };
      for (const m of current) {
        const v = m.values?.[code];
        row[m.accModelGuid] =
          v && v.etatExtraction !== 'echec' && v.valeurNum != null ? Number(v.valeurNum) : null;
      }
      return row;
    });
  }, [current, controls]);

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
          Hygiène et santé du modèle
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8', lineHeight: 1.5, maxWidth: 820 }}>
          État actuel du projet (dernier contrôle réussi de chaque maquette), évolution dans le temps
          et comparaison entre maquettes. Les dates comptent : les maquettes d’un même projet ne sont
          pas nécessairement contrôlées le même jour.
        </p>

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
                  <p style={{ margin: '0 0 18px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                    Preuve d’amélioration continue : chaque point est un run réussi, avec sa date et la
                    version ACC auditée. Une baisse des avertissements d’une révision à l’autre est
                    lisible ici.
                  </p>
                  {chartsByControl.map(({ code, modelsWithHistory, canChart, singleOnly, data }) => {
                    const unite = uniteOf(code, controls);
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
                            Un seul contrôle réussi à ce jour
                            {modelsWithHistory[0]?.numeric?.[0]
                              ? ` (${formatDateTime(modelsWithHistory[0].numeric[0].at)}, ${versionLabel(
                                  modelsWithHistory[0].numeric[0].modelVersion
                                )} : ${formatNumber(modelsWithHistory[0].numeric[0].valeurNum)}${unite ? ` ${unite}` : ''})`
                              : ''}
                            . La courbe d’évolution apparaîtra dès le prochain run réussi.
                          </div>
                        ) : canChart ? (
                          <ResponsiveContainer width="100%" height={240}>
                            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                              <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                              <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                              <Tooltip content={<ChartTooltip unite={unite} />} />
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
                  {current.length < 2 ? (
                    <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                      Une seule maquette a un contrôle réussi sur ce projet
                      {accModelGuid ? ' (filtre actif)' : ''}. La comparaison n’a de sens qu’avec au
                      moins deux maquettes.
                    </p>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
                        Même instant métier : dernier run réussi de chaque maquette, pour repérer celle
                        qui décroche.
                      </p>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b' }}>
                                Contrôle
                              </th>
                              {current.map((m) => (
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
                                {current.map((m) => (
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
                      <div style={{ marginTop: 20 }}>
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={compareRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
                            <XAxis dataKey="libelle" stroke="#94a3b8" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} />
                            <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                            <Tooltip
                              contentStyle={{
                                background: 'rgba(15, 23, 42, 0.95)',
                                border: '1px solid rgba(148, 163, 184, 0.3)',
                                borderRadius: 8,
                                color: '#fff',
                                fontSize: 12,
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            {current.map((m) => (
                              <Bar
                                key={m.accModelGuid}
                                dataKey={m.accModelGuid}
                                name={modelLabel(m)}
                                fill={colorByModel.get(String(m.accModelGuid).toLowerCase()) || VIOLET}
                                radius={[4, 4, 0, 0]}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
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
