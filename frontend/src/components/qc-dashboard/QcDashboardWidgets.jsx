import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { card } from '../qc-config/qcTheme';
import {
  DELTA_TONE,
  PROJECT_ELEMENTS_CODES,
  VIOLET_DARK,
  deltaTone,
  detailHref,
  formatDateTime,
  formatDeltaCompact,
  formatNumber,
  isFirstControlledVersion,
  isNegligibleMovement,
  modelLabel,
  uniteLabel,
  versionLabel,
} from './qcDashboardShared';

export function DirectionMark({ dir, color, size = 18 }) {
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

function statutValueColor(statut) {
  if (statut === 'conforme') return DELTA_TONE.good;
  if (statut === 'non_conforme') return DELTA_TONE.bad;
  return DELTA_TONE.none;
}

function statutPhrase(statut) {
  if (statut === 'conforme') return 'conforme';
  if (statut === 'non_conforme') return 'non conforme';
  return 'indicatif';
}

export function VerdictBadge({ value }) {
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

export function DeltaLine({ delta, unite, sensSouhaitable }) {
  if (!delta) return null;
  const muted = { marginTop: 8, fontSize: 12, color: '#475569', lineHeight: 1.35 };
  if (delta.reason === 'extraction_failed' || delta.reason === 'no_previous_version') return null;
  if (delta.reason === 'statut_changed' || delta.reason === 'statut_unchanged') {
    const vs = versionLabel(delta.previousVersion);
    if (delta.reason === 'statut_unchanged') {
      return (
        <div style={muted}>
          Même verdict depuis la {vs}.
        </div>
      );
    }
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: DELTA_TONE.none, lineHeight: 1.3 }}>
          {statutPhrase(delta.previousStatut)} → {statutPhrase(delta.currentStatut)}
        </div>
        <div style={{ marginTop: 3, fontSize: 11, color: '#64748b' }}>depuis la {vs}</div>
      </div>
    );
  }
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
  const stable = isNegligibleMovement(delta, unite);
  const vs = versionLabel(delta.previousVersion);
  if (stable) {
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: DELTA_TONE.none, lineHeight: 1.1 }}>
          stable
        </div>
        <div style={{ marginTop: 3, fontSize: 11, color: '#64748b' }}>depuis la {vs}</div>
      </div>
    );
  }
  const tone = deltaTone(sensSouhaitable, delta.abs, false);
  const color = DELTA_TONE[tone];
  const dir = delta.abs > 0 ? 'up' : 'down';
  const compact = formatDeltaCompact(delta.abs, unite);
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 22,
          fontWeight: 800,
          color,
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

function isPercentCoverage(extras) {
  return Boolean(extras && extras.showPercent === true && extras.denominateur > 0);
}

function showCiblePourcent(control, value) {
  if (control?.ciblePourcent == null) return false;
  if (!value || value.etatExtraction === 'echec') return false;
  return value.statut === 'conforme' || value.statut === 'non_conforme';
}

function extrasHint(code, extras) {
  if (!extras) return null;
  if (code === 'G412' && (extras.famillesInPlace != null || extras.typesGroupes != null)) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
        {extras.famillesInPlace != null ? `${formatNumber(extras.famillesInPlace)} familles in situ` : null}
        {extras.famillesInPlace != null && extras.typesGroupes != null ? ' · ' : null}
        {extras.typesGroupes != null ? `${formatNumber(extras.typesGroupes)} types de groupes` : null}
      </div>
    );
  }
  if (code === 'G504' && extras.denominateur != null) {
    const entity = extras.nature === 'instance' ? 'éléments' : 'types';
    if (extras.aucunElementDesign || extras.denominateur === 0) {
      return (
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
          Aucun élément de design à coder sur cette maquette.
        </div>
      );
    }
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
        {formatNumber(extras.numerateur)} / {formatNumber(extras.denominateur)} {entity} codés
      </div>
    );
  }
  if (code === 'G508') {
    if (extras.aucunParametre) return null;
    if (extras.total != null) {
      return (
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
          {formatNumber(extras.rempli)} / {formatNumber(extras.total)} valeurs renseignées
        </div>
      );
    }
  }
  return structuredExtrasHint(extras);
}

function axisLine(point, unite = 'm') {
  if (!point || typeof point !== 'object') return null;
  const bits = [];
  if (point.ns != null) bits.push(`N/S ${formatNumber(point.ns)} ${unite}`);
  if (point.eo != null) bits.push(`E/O ${formatNumber(point.eo)} ${unite}`);
  if (point.elev != null) bits.push(`élév. ${formatNumber(point.elev)} ${unite}`);
  return bits.length ? bits.join(' · ') : null;
}

function structuredExtrasHint(extras) {
  if (!extras) return null;
  const hintStyle = { marginTop: 8, fontSize: 12, color: '#64748b', lineHeight: 1.4 };

  if (extras.showPercent && extras.denominateur === 0) {
    if (extras.ratioNoun === 'éléments monitorés') {
      return <div style={hintStyle}>Aucun axe ni niveau soumis à l’audit.</div>;
    }
    if (extras.totalNoun === 'liens' || extras.ratioNoun === 'liens dans la variante principale') {
      return <div style={hintStyle}>Cette maquette n’a pas de lien.</div>;
    }
    if (extras.ratioNoun === 'sous-projets bien nommés') {
      return <div style={hintStyle}>Cette maquette n’a pas de sous-projet utilisateur.</div>;
    }
    return <div style={hintStyle}>Aucun élément évaluable pour le rattachement au niveau.</div>;
  }

  if (extras.vacuite && extras.totalNoun) {
    return (
      <div style={hintStyle}>
        {extras.totalNoun === 'axes'
          ? 'Cette maquette n’a pas d’axe.'
          : `Cette maquette n’a pas de ${extras.totalNoun}.`}
      </div>
    );
  }

  if (extras.contreTolerance?.length) {
    const bits = extras.contreTolerance.map((a) => {
      const label = a.axe === 'ns' ? 'N/S' : a.axe === 'eo' ? 'E/O' : a.axe === 'elev' ? 'élév.' : a.axe;
      return `${label} ${formatNumber(a.ecart)} m (tol. ${formatNumber(a.tolerance)} m)`;
    });
    return <div style={hintStyle}>{bits.join(' · ')}</div>;
  }

  if (extras.showPercent && extras.numerateur != null && extras.denominateur != null) {
    return (
      <div style={hintStyle}>
        {formatNumber(extras.numerateur)} / {formatNumber(extras.denominateur)} {extras.ratioNoun || 'éléments'}
      </div>
    );
  }

  const axes = axisLine(extras.ecart);
  if (axes) {
    return <div style={hintStyle}>{axes}</div>;
  }
  return null;
}

function missingConfigCopy(control, extras) {
  if (control.code === 'G508' || (extras?.aucunParametre && control.forme === 'remplissage')) {
    return 'Aucun paramètre d’exploitation n’est listé pour ce projet : le taux n’est pas mesuré.';
  }
  if (control.code === 'G507' || (extras?.aucunParametre && control.forme === 'presenceProjet')) {
    return 'Aucune liste attendue n’est configurée : le chiffre est un inventaire, pas des absents.';
  }
  if (control.code === 'G502') {
    return 'Aucune liste de paramètres de projet attendus n’est configurée.';
  }
  if (control.code === 'G105') {
    return 'Aucun champ projet à valider n’est configuré.';
  }
  if (control.code === 'G504') {
    return 'Aucun verdict : la porte de livraison n’est pas activée pour ce projet.';
  }
  return 'Aucun verdict : une cible n’est pas configurée pour ce projet.';
}

function showMissingConfig(control, value) {
  // Catalogue : attendCibleProjet=false pour indicatif-par-nature (G402, G314)
  // et règles maison (G408, G412, G210). Contrat scoring : pas de cible → statut null.
  if (!control?.attendCibleProjet) return false;
  if (!value || value.etatExtraction === 'echec') return false;
  if (value.statut === 'conforme' || value.statut === 'non_conforme') return false;
  return true;
}

export function KpiCard({
  control,
  model,
  breakdown,
  projectId,
  linkState,
  hideDelta,
}) {
  const code = control.code;
  const value = model.values?.[code] || null;
  const href = detailHref(code, model.runId);
  const failed = value?.etatExtraction === 'echec';
  const missing = !value;
  const unite = uniteLabel(control.unite);
  const extras = value?.extras;
  const configHint = !failed && showMissingConfig(control, value);

  let body;
  if (failed) {
    body = (
      <div style={{ fontSize: 14, color: '#b45309' }}>
        Relevé indisponible — aucun verdict, aucune comparaison.
      </div>
    );
  } else if (isPercentCoverage(extras)) {
    const pct = extras.pourcentage != null ? extras.pourcentage : value.valeurNum;
    const showCible = showCiblePourcent(control, value);
    body = (
      <>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
          {formatNumber(pct)}
          <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginLeft: 6 }}>%</span>
          {showCible ? (
            <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginLeft: 10 }}>
              cible {formatNumber(control.ciblePourcent)} %
            </span>
          ) : null}
        </div>
        {extrasHint(code, extras)}
      </>
    );
  } else if (extras?.binaire) {
    const color = statutValueColor(value.statut);
    body = (
      <>
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.25 }}>
          {extras.releve || '—'}
        </div>
        {value.statut === 'non_conforme' && control.valeurAttendue ? (
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
            Attendu : {control.valeurAttendue}
          </div>
        ) : null}
      </>
    );
  } else if (missing || value.valeurNum == null) {
    const coords = axisLine(extras?.surveyPoint);
    if (coords) {
      body = (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', lineHeight: 1.45 }}>
            {coords}
          </div>
          {extrasHint(code, extras)}
        </>
      );
    } else {
      body = (
        <>
          {extras?.vacuite || (extras?.showPercent && extras?.denominateur === 0) ? null : (
            <div style={{ fontSize: 14, color: '#64748b' }}>Pas de donnée chiffrée</div>
          )}
          {extrasHint(code, extras)}
        </>
      );
    }
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
        {extrasHint(code, extras)}
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
      {configHint ? (
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
          {missingConfigCopy(control, extras)}{' '}
          <Link
            to="/qc-config"
            state={linkState}
            style={{ color: VIOLET_DARK, fontWeight: 600, textDecoration: 'none' }}
          >
            Configurer les cibles
          </Link>
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
        {projectId && PROJECT_ELEMENTS_CODES.has(code) ? (
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

export function WhatChangedSection({ current, controls }) {
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
          if (delta.reason === 'statut_changed' || delta.reason === 'statut_unchanged') {
            const item = { control, delta, kind: 'statut' };
            if (delta.reason === 'statut_unchanged') stable.push(item);
            else moved.push(item);
            continue;
          }
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
                {moved.map((item) => {
                  const { control, delta, unite, currentN, kind } = item;
                  if (kind === 'statut') {
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
                        <span>
                          <strong>{control.libelle}</strong>
                          {' : '}
                          {statutPhrase(delta.previousStatut)}
                          {' → '}
                          {statutPhrase(delta.currentStatut)}
                          {' ('}
                          {versionLabel(delta.previousVersion)}
                          {' → '}
                          {versionLabel(delta.currentVersion)}
                          {')'}
                        </span>
                      </li>
                    );
                  }
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

export function ChartTooltip({ active, payload, unite }) {
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
            {runs != null ? (
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

export function HorizontalCompareChart({ data, bars, unite, height }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
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

const COVERAGE_COLORS = { coded: '#0f766e', rest: '#cbd5e1' };

export function CoverageDonut({ current, controlCode = 'G504' }) {
  const models = current || [];
  let numerateur = 0;
  let denominateur = 0;
  let hasExtras = false;
  let pctFallback = null;
  let vacuous = false;
  for (const m of models) {
    const extras = m.values?.[controlCode]?.extras;
    if (extras && extras.denominateur != null) {
      hasExtras = true;
      numerateur += Number(extras.numerateur) || 0;
      denominateur += Number(extras.denominateur) || 0;
      if (extras.aucunElementDesign || extras.denominateur === 0) vacuous = true;
    } else {
      const n = m.values?.[controlCode]?.valeurNum;
      if (n != null && Number.isFinite(Number(n))) pctFallback = Number(n);
    }
  }

  let coded = 0;
  let rest = 0;
  let caption = '';
  if (hasExtras && denominateur > 0) {
    coded = numerateur;
    rest = Math.max(0, denominateur - numerateur);
    caption = `${formatNumber(coded)} sur ${formatNumber(denominateur)} ${
      models.length > 1 ? 'entités des maquettes affichées' : 'entités de la maquette'
    } portent un code.`;
  } else if (hasExtras && vacuous) {
    return (
      <div style={{ fontSize: 13, color: '#64748b', padding: '8px 0' }}>
        Aucun élément de design à coder
        {models.length > 1 ? ' sur les maquettes affichées' : ' sur cette maquette'}. La couverture
        est vide (100 %), il n’y a pas de composition à montrer.
      </div>
    );
  } else if (pctFallback != null) {
    coded = pctFallback;
    rest = Math.max(0, 100 - pctFallback);
    caption = `Couverture relevée : ${formatNumber(pctFallback)} %.`;
  } else {
    return (
      <div style={{ fontSize: 13, color: '#64748b', padding: '8px 0' }}>
        Pas de couverture chiffrée à représenter pour le moment.
      </div>
    );
  }

  const data = [
    { key: 'coded', name: 'Codés', value: coded },
    { key: 'rest', name: 'Sans code', value: rest },
  ].filter((d) => d.value > 0);
  if (!data.length) {
    data.push({ key: 'coded', name: 'Codés', value: 1 });
  }

  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{caption}</p>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={72}
            outerRadius={104}
            paddingAngle={1}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={COVERAGE_COLORS[d.key] || '#94a3b8'} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, name) => [
              hasExtras && denominateur > 0 ? formatNumber(v) : `${formatNumber(v)} %`,
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
