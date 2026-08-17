import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { fetchQcRunDetail, downloadQcRunFiche } from '../services/api';
import { labelBuiltinCategoryFr } from '../components/qc-config/builtinCategoryLabelsFr';
import {
  pageShell,
  pageInner,
  card,
  btnSecondary,
  muted,
  errorBanner,
  SECTION_TITLES,
  sectionKeyFromCode,
  controlNum,
} from '../components/qc-config/qcTheme';
import {
  qcDashboardOriginFromState,
  qcDashboardReturnPath,
} from '../components/qc-config/qcDashboardNav';

const VIOLET = '#7c3aed';
const VIOLET_DARK = '#6d28d9';

function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-CA');
  } catch {
    return '—';
  }
}

function statusTechniqueLabel(status) {
  if (status === 'success') return 'Réussi';
  if (status === 'failed') return 'Échoué';
  if (status === 'running') return 'En cours';
  if (status === 'queued' || status === 'submitted') return 'En file';
  return status || '—';
}

function formatNum(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(digits).replace(/\.?0+$/, '');
}

/** Une ligne lisible pour la valeur relevée (pas de JSON). */
export function valeurReleveeLigne(result) {
  if (!result || result.etat_extraction === 'echec') return null;
  const j = result.valeur_json;
  const u = result.unite ? ` ${result.unite}` : '';

  if (result.controlCode === 'G408' && j) {
    const crit = j.parNiveau?.critique ?? j.critical ?? 0;
    const faible = j.parNiveau?.faible ?? 0;
    return `${j.total ?? result.valeur_num ?? 0} avertissement(s) — ${crit} critique(s), ${faible} faible(s)`;
  }
  if (result.controlCode === 'G504' && j?.couverture) {
    const c = j.couverture;
    return `Couverture ${formatNum(c.pourcentage ?? result.valeur_num)} % (${c.numerateur ?? '—'}/${c.denominateur ?? '—'}, ${c.nature || 'type'})`;
  }
  if (result.controlCode === 'G102' && (result.valeur_num != null || j?.mo != null)) {
    return `${formatNum(result.valeur_num ?? j.mo)} Mo`;
  }
  if (j?.couverture && j.couverture.pourcentage != null) {
    return `${formatNum(j.couverture.pourcentage)} % (${j.couverture.numerateur}/${j.couverture.denominateur})`;
  }
  if (j?.global?.pourcentage != null) {
    return `${formatNum(j.global.pourcentage)} %`;
  }
  if (j?.pourcentageConformite != null) {
    return `${formatNum(j.pourcentageConformite)} % de conformité`;
  }
  if (Array.isArray(j?.phases)) {
    return j.phases.length ? j.phases.join(', ') : 'Aucune phase';
  }
  if (Array.isArray(j?.variantes)) {
    return `${j.variantes.length} variante(s)`;
  }
  if (j?.nomFichier) return j.nomFichier;
  if (j?.ecartMaxAbs != null) return `Écart max. ${formatNum(j.ecartMaxAbs)} ${j.unite || 'm'}`;
  if (j?.angleNordProjet != null) return `${formatNum(j.angleNordProjet, 3)}°`;
  if (j?.aucunParametre) return 'Aucun paramètre configuré';
  if (result.valeur_text) return String(result.valeur_text);
  if (result.valeur_num != null) return `${formatNum(result.valeur_num)}${u}`;
  return '—';
}

function truncNote(j) {
  if (!j) return null;
  if (j.listeTronquee || j.listeIdsTronquee) return 'Liste partielle (plafond d’extraction).';
  if (j.fautifsDetail?.listeTronquee) return 'Liste partielle (plafond d’extraction).';
  if (j.vuesNonPlacees && j.listeTronquee) return 'Liste partielle (plafond d’extraction).';
  if (j.groupes?.listeTronquee) return 'Liste partielle (plafond d’extraction).';
  if (Array.isArray(j.parametres) && j.parametres.some((p) => p?.listeTronquee)) {
    return 'Liste partielle sur au moins un paramètre.';
  }
  return null;
}

function SimpleTable({ columns, rows, maxRows }) {
  if (!rows?.length) return <p style={{ ...muted, margin: '8px 0', color: '#64748b' }}>Aucune donnée.</p>;
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid rgba(148,163,184,0.35)',
                  color: '#475569',
                  fontWeight: 600,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} style={{ background: i % 2 ? 'rgba(248,250,252,0.8)' : 'transparent' }}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    padding: '6px 8px',
                    borderBottom: '1px solid rgba(148,163,184,0.15)',
                    color: '#0f172a',
                    verticalAlign: 'top',
                  }}
                >
                  {row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NameList({ title, items, truncated }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 4 }}>{title}</div>
      {truncated && (
        <div style={{ fontSize: 12, color: '#b45309', marginBottom: 4 }}>Liste partielle (plafond d’extraction).</div>
      )}
      <ul style={{ margin: 0, paddingLeft: 18, color: '#334155', fontSize: 13, lineHeight: 1.45 }}>
        {items.slice(0, 10).map((x, i) => (
          <li key={i}>{typeof x === 'string' ? x : x?.nom || x?.name || JSON.stringify(x)}</li>
        ))}
      </ul>
    </div>
  );
}

function KvList({ pairs }) {
  const list = pairs.filter(([, v]) => v != null && v !== '');
  if (!list.length) return null;
  return (
    <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', fontSize: 13 }}>
      {list.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt style={{ color: '#64748b', fontWeight: 600 }}>{k}</dt>
          <dd style={{ margin: 0, color: '#0f172a' }}>{String(v)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Détail structuré — formes connues + repli lisible (pas de JSON brut). */
function StructuredDetail({ result }) {
  const j = result?.valeur_json;
  if (!j || typeof j !== 'object') {
    if (result?.valeur_text) return <p style={{ margin: '8px 0', fontSize: 13 }}>{result.valeur_text}</p>;
    return <p style={{ ...muted, margin: '8px 0', color: '#64748b' }}>Aucun détail supplémentaire.</p>;
  }

  const code = result.controlCode;
  const noteTrunc = truncNote(j);

  if (code === 'G408') {
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const groups = [
      { key: 'critique', label: 'Critiques', color: '#b91c1c' },
      { key: 'faible', label: 'Faibles', color: '#b45309' },
    ];
    return (
      <div>
        <KvList
          pairs={[
            ['Total', j.total],
            ['Critiques', j.parNiveau?.critique ?? j.critical],
            ['Faibles', j.parNiveau?.faible],
          ]}
        />
        {groups.map((g) => {
          const items = warnings.filter((w) => w.criticite === g.key);
          if (!items.length) return null;
          return (
            <div key={g.key} style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: g.color, marginBottom: 6 }}>
                {g.label} ({items.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#334155', lineHeight: 1.45 }}>
                {items.map((w) => (
                  <li key={w.id}>
                    {w.description}
                    {Array.isArray(w.elementIds) && w.elementIds.length > 0 && (
                      <span style={{ color: '#94a3b8' }}> — {w.elementIds.length} élément(s)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!warnings.length && <p style={{ fontSize: 13, color: '#64748b' }}>Aucun avertissement listé.</p>}
      </div>
    );
  }

  if (code === 'G504') {
    const c = j.couverture || {};
    const fautifs = Array.isArray(j.typesFautifs)
      ? j.typesFautifs
      : Array.isArray(j.instancesFautives)
        ? j.instancesFautives
        : [];
    const byCat = new Map();
    for (const f of fautifs) {
      const cat = labelBuiltinCategoryFr(f.categorie || f.bic || 'Autre');
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(f);
    }
    return (
      <div>
        <KvList
          pairs={[
            ['Couverture', `${formatNum(c.pourcentage)} %`],
            ['Numérateur', c.numerateur],
            ['Dénominateur', c.denominateur],
            ['Nature', c.nature],
            ['Paramètre', j.parametre?.valeur || j.parametre],
          ]}
        />
        {noteTrunc && <div style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>{noteTrunc}</div>}
        {j.listeTronquee && (
          <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>Liste partielle (plafond d’extraction).</div>
        )}
        {[...byCat.entries()].map(([cat, rows]) => (
          <div key={cat} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: VIOLET_DARK }}>{cat}</div>
            <SimpleTable
              maxRows={10}
              columns={[
                { key: 'famille', label: 'Famille' },
                { key: 'nomType', label: 'Type' },
                { key: 'raison', label: 'Raison' },
                { key: 'nb', label: 'Occurrences' },
              ]}
              rows={rows.map((f) => ({
                famille: f.famille || '—',
                nomType: f.nomType || f.nom || '—',
                raison: f.raison || '—',
                nb: f.nbInstances ?? (Array.isArray(f.idsEchantillon) ? f.idsEchantillon.length : '—'),
              }))}
            />
          </div>
        ))}
      </div>
    );
  }

  if (code === 'G105' && (j.infosProjet?.champs || j.champs)) {
    const champs = Array.isArray(j.infosProjet?.champs)
      ? j.infosProjet.champs
      : Object.entries(j.champs || {}).map(([cle, valeurRelevee]) => ({ cle, valeurRelevee }));
    return (
      <SimpleTable
        columns={[
          { key: 'cle', label: 'Champ' },
          { key: 'valeurRelevee', label: 'Valeur relevée' },
          { key: 'valeurAttendue', label: 'Valeur attendue' },
          { key: 'conforme', label: 'Conforme' },
        ]}
        rows={champs.map((ch) => ({
          cle: ch.cle || ch.libelle || '—',
          valeurRelevee: ch.valeurRelevee ?? '—',
          valeurAttendue: ch.valeurAttendue ?? '—',
          conforme: ch.conforme === true ? 'Oui' : ch.conforme === false ? 'Non' : '—',
        }))}
      />
    );
  }

  if (code === 'G103' && (j.recetteNommage || j.nomFichier)) {
    const r = j.recetteNommage || {};
    return (
      <KvList
        pairs={[
          ['Nom relevé', r.nomReleve || j.nomFichier],
          ['Nom attendu', r.nomAttenduAssemble],
          ['Conforme', r.conforme === true ? 'Oui' : r.conforme === false ? 'Non' : '—'],
        ]}
      />
    );
  }

  if (j.ecart || j.surveyPoint) {
    return (
      <KvList
        pairs={[
          ['Unité', j.unite],
          ['Écart N/S', j.ecart?.ns],
          ['Écart E/O', j.ecart?.eo],
          ['Écart élév.', j.ecart?.elev],
          ['Écart max.', j.ecartMaxAbs],
          ['Point de levé N/S', j.surveyPoint?.ns],
          ['Point de levé E/O', j.surveyPoint?.eo],
          ['Point de levé élév.', j.surveyPoint?.elev],
          ['Angle nord projet', j.angleNordProjet],
        ]}
      />
    );
  }

  if (Array.isArray(j.phases)) {
    return <NameList title="Phases" items={j.phases} />;
  }
  if (Array.isArray(j.variantes)) {
    return (
      <NameList
        title="Variantes"
        items={j.variantes.map((v) => (typeof v === 'string' ? v : v.nom || JSON.stringify(v)))}
      />
    );
  }
  if (Array.isArray(j.vuesNonPlacees)) {
    return <NameList title="Vues non placées" items={j.vuesNonPlacees} truncated={!!j.listeTronquee} />;
  }
  if (Array.isArray(j.groupesInutilises)) {
    return <NameList title="Groupes inutilisés" items={j.groupesInutilises} truncated={!!j.listeTronquee} />;
  }
  if (Array.isArray(j.fautifs)) {
    return (
      <>
        {noteTrunc && <div style={{ fontSize: 12, color: '#b45309' }}>{noteTrunc}</div>}
        <SimpleTable
          maxRows={10}
          columns={[
            { key: 'nom', label: 'Élément' },
            { key: 'detail', label: 'Détail' },
          ]}
          rows={j.fautifs.map((f) => ({
            nom: f.nom || f.id || '—',
            detail: Array.isArray(f.raisons) ? f.raisons.join(', ') : f.raison || '',
          }))}
        />
      </>
    );
  }
  if (j.nommage?.nomsNonConformes) {
    return (
      <NameList title="Noms non conformes" items={j.nommage.nomsNonConformes} truncated={!!j.listeTronquee} />
    );
  }
  if (Array.isArray(j.sousProjets)) {
    return <NameList title="Sous-projets" items={j.sousProjets} />;
  }
  if (Array.isArray(j.parametres) && j.parametres.every((p) => typeof p === 'string')) {
    return <NameList title="Paramètres" items={j.parametres} />;
  }
  if (Array.isArray(j.parametres) && j.parametres[0]?.nom) {
    return (
      <SimpleTable
        columns={[
          { key: 'nom', label: 'Paramètre' },
          { key: 'pct', label: 'Remplissage' },
          { key: 'conforme', label: 'Conforme' },
        ]}
        rows={j.parametres.map((p) => ({
          nom: p.nom,
          pct: p.pourcentage != null ? `${formatNum(p.pourcentage)} %` : p.present === true ? 'Présent' : p.present === false ? 'Absent' : '—',
          conforme: p.conforme === true ? 'Oui' : p.conforme === false ? 'Non' : '—',
        }))}
      />
    );
  }
  if (j.global || j.couverture) {
    const g = j.global || j.couverture;
    return (
      <>
        <KvList
          pairs={[
            ['Pourcentage', g.pourcentage != null ? `${formatNum(g.pourcentage)} %` : null],
            ['Numérateur / monitoires', g.numerateur ?? g.monitores],
            ['Dénominateur / soumis', g.denominateur ?? g.soumisAudit],
          ]}
        />
        {noteTrunc && <div style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>{noteTrunc}</div>}
      </>
    );
  }

  // Repli générique lisible : paires clés/valeurs scalaires + listes courtes
  const pairs = [];
  const lists = [];
  for (const [k, v] of Object.entries(j)) {
    if (k === 'note') continue;
    if (v == null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      pairs.push([k, v === true ? 'Oui' : v === false ? 'Non' : v]);
    } else if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      lists.push([k, v.map(String)]);
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (typeof v2 === 'string' || typeof v2 === 'number' || typeof v2 === 'boolean') {
          pairs.push([`${k} · ${k2}`, v2 === true ? 'Oui' : v2 === false ? 'Non' : v2]);
        }
      }
    }
  }
  return (
    <div>
      {j.note && <p style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>{j.note}</p>}
      {noteTrunc && <div style={{ fontSize: 12, color: '#b45309' }}>{noteTrunc}</div>}
      <KvList pairs={pairs} />
      {lists.map(([title, items]) => (
        <NameList key={title} title={title} items={items} />
      ))}
      {!pairs.length && !lists.length && (
        <p style={{ fontSize: 13, color: '#64748b' }}>Détail non tabulable pour ce contrôle.</p>
      )}
    </div>
  );
}

function StatutBadge({ result }) {
  if (result.etat_extraction === 'echec') {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          background: 'rgba(220,38,38,0.12)',
          color: '#b91c1c',
          border: '1px solid rgba(220,38,38,0.25)',
        }}
      >
        Échec d’extraction
      </span>
    );
  }
  if (result.statut === 'conforme') {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          background: 'rgba(5,150,105,0.12)',
          color: '#047857',
          border: '1px solid rgba(5,150,105,0.25)',
        }}
      >
        Conforme
      </span>
    );
  }
  if (result.statut === 'non_conforme') {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          background: 'rgba(220,38,38,0.12)',
          color: '#b91c1c',
          border: '1px solid rgba(220,38,38,0.25)',
        }}
      >
        Non conforme
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        background: 'rgba(148,163,184,0.2)',
        color: '#475569',
        border: '1px solid rgba(148,163,184,0.35)',
      }}
    >
      Sans verdict
    </span>
  );
}

function SummaryPill({ label, value, tone }) {
  const colors = {
    violet: { bg: 'rgba(124,58,237,0.12)', color: VIOLET_DARK, border: 'rgba(124,58,237,0.3)' },
    green: { bg: 'rgba(5,150,105,0.12)', color: '#047857', border: 'rgba(5,150,105,0.3)' },
    red: { bg: 'rgba(220,38,38,0.1)', color: '#b91c1c', border: 'rgba(220,38,38,0.25)' },
    amber: { bg: 'rgba(245,158,11,0.12)', color: '#b45309', border: 'rgba(245,158,11,0.3)' },
    slate: { bg: 'rgba(148,163,184,0.15)', color: '#334155', border: 'rgba(148,163,184,0.3)' },
  };
  const c = colors[tone] || colors.slate;
  return (
    <div
      style={{
        flex: '1 1 120px',
        minWidth: 110,
        padding: '12px 14px',
        borderRadius: 12,
        background: c.bg,
        border: `1px solid ${c.border}`,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: c.color, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c.color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function ControlRow({ result, runId, navState }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ligne = valeurReleveeLigne(result);
  const elementsCount = Number(result.elementsCount) || 0;

  return (
    <div
      style={{
        border: '1px solid rgba(148,163,184,0.25)',
        borderRadius: 12,
        marginBottom: 10,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          border: 'none',
          background: open ? 'rgba(124,58,237,0.04)' : 'transparent',
          padding: '12px 14px',
          cursor: 'pointer',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ color: VIOLET, fontWeight: 800, fontSize: 13, minWidth: 44 }}>{result.controlCode}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{result.libelle}</div>
          {result.etat_extraction === 'echec' ? (
            <div style={{ fontSize: 13, color: '#b91c1c', marginTop: 4 }}>
              {result.erreur_extraction || 'Échec d’extraction'}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>{ligne}</div>
          )}
          {result.cibleIntitule && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Cible : {result.cibleIntitule}</div>
          )}
        </div>
        <StatutBadge result={result} />
        <span style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px 70px', borderTop: '1px solid rgba(148,163,184,0.15)' }}>
          {result.etat_extraction === 'echec' ? (
            <p style={{ fontSize: 13, color: '#b91c1c' }}>{result.erreur_extraction || 'Échec d’extraction'}</p>
          ) : (
            <StructuredDetail result={result} />
          )}
          {elementsCount > 0 && (
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/qc-run/${encodeURIComponent(runId)}/elements?controlCode=${encodeURIComponent(result.controlCode)}`,
                  navState ? { state: navState } : undefined
                )
              }
              style={{
                marginTop: 12,
                padding: '8px 14px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                background: `linear-gradient(135deg, ${VIOLET} 0%, ${VIOLET_DARK} 100%)`,
              }}
            >
              Voir les {elementsCount} élément{elementsCount > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function QcRunResultsPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [ficheLoading, setFicheLoading] = useState(false);
  const [ficheError, setFicheError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchQcRunDetail(runId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Impossible de charger le run');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const grouped = useMemo(() => {
    const results = data?.results || [];
    const map = new Map();
    for (const r of results) {
      const key = r.sectionKey ?? sectionKeyFromCode(r.controlCode);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => controlNum(a.controlCode) - controlNum(b.controlCode));
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [data]);

  const run = data?.run;
  const summary = data?.summary;

  /** Même contrat que Dashboard → Planning (preSelectHub / preSelectProject = IDs string). */
  function goBackToPlanning() {
    const projectId = run?.projectId || null;
    if (!projectId) {
      navigate('/planning');
      return;
    }
    navigate('/planning', {
      state: {
        preSelectHub: run?.hubId || null,
        preSelectProject: projectId,
      },
    });
  }

  const dashboardOrigin = qcDashboardOriginFromState(location.state);
  const dashboardReturnPath = qcDashboardReturnPath(
    dashboardOrigin,
    dashboardOrigin?.preSelectProject || run?.projectId
  );

  function goBackToDashboard() {
    if (!dashboardReturnPath) return;
    navigate(dashboardReturnPath, {
      state: {
        preSelectHub: dashboardOrigin.preSelectHub || run?.hubId || null,
        preSelectProject: dashboardOrigin.preSelectProject || run?.projectId,
      },
    });
  }

  async function handleDownloadFiche() {
    if (!runId || ficheLoading) return;
    setFicheLoading(true);
    setFicheError(null);
    try {
      const { blob, fileName } = await downloadQcRunFiche(runId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFicheError(e?.message || 'Impossible de télécharger la fiche de contrôle');
    } finally {
      setFicheLoading(false);
    }
  }

  return (
    <div style={pageShell}>
      <div style={{ ...pageInner, maxWidth: 960 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          {dashboardReturnPath ? (
            <button type="button" onClick={goBackToDashboard} style={{ ...btnSecondary }}>
              ← Retour au tableau de bord QC
            </button>
          ) : null}
          <button
            type="button"
            onClick={goBackToPlanning}
            style={{ ...btnSecondary }}
          >
            ← Retour à la planification
          </button>
          {!loading && !error && run && (
            <button
              type="button"
              onClick={handleDownloadFiche}
              disabled={ficheLoading}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: ficheLoading ? 'wait' : 'pointer',
                border: 'none',
                color: '#fff',
                background: ficheLoading
                  ? 'rgba(124, 58, 237, 0.45)'
                  : `linear-gradient(135deg, ${VIOLET} 0%, ${VIOLET_DARK} 100%)`,
                boxShadow: '0 4px 14px rgba(124, 58, 237, 0.25)',
              }}
            >
              {ficheLoading ? 'Génération de la fiche…' : 'Télécharger la fiche de contrôle'}
            </button>
          )}
        </div>
        {ficheError && <div style={{ ...errorBanner, marginBottom: 16 }}>{ficheError}</div>}

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
          Résultats du contrôle QC
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: '#94a3b8' }}>
          Détail des contrôles relevés pour cette exécution.
        </p>

        {loading && <div style={{ ...card, color: '#64748b' }}>Chargement…</div>}
        {error && <div style={errorBanner}>{error}</div>}

        {!loading && !error && run && (
          <>
            <div
              style={{
                ...card,
                borderTop: `4px solid ${VIOLET}`,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    background: 'rgba(124,58,237,0.15)',
                    color: VIOLET_DARK,
                    border: '1px solid rgba(124,58,237,0.35)',
                  }}
                >
                  QC
                </span>
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    background:
                      run.status === 'success'
                        ? 'rgba(5,150,105,0.12)'
                        : run.status === 'failed'
                          ? 'rgba(220,38,38,0.12)'
                          : 'rgba(148,163,184,0.2)',
                    color:
                      run.status === 'success' ? '#047857' : run.status === 'failed' ? '#b91c1c' : '#475569',
                  }}
                >
                  {statusTechniqueLabel(run.status)}
                </span>
                {run.revitVersion && (
                  <span style={{ fontSize: 12, color: '#64748b' }}>Revit {run.revitVersion}</span>
                )}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>
                {run.modelName || 'Maquette'}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 10,
                  fontSize: 13,
                  color: '#334155',
                }}
              >
                <div>
                  <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 11 }}>PROJET</div>
                  {run.projectName || '—'}
                </div>
                <div>
                  <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 11 }}>DATE</div>
                  {formatDateTime(run.startedAtUtc)}
                </div>
                <div>
                  <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 11 }}>DURÉE</div>
                  {formatDuration(run.durationMs)}
                </div>
                <div>
                  <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 11 }}>LANCÉ PAR</div>
                  {run.executedByName || '—'}
                </div>
                <div>
                  <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 11 }}>VERSION ACC</div>
                  {run.modelVersion != null ? `v${run.modelVersion}` : '—'}
                </div>
                {run.jobName && (
                  <div>
                    <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: 11 }}>TÂCHE</div>
                    {run.jobName}
                  </div>
                )}
              </div>
              {run.message && (
                <div style={{ marginTop: 12, fontSize: 13, color: '#b91c1c' }}>{run.message}</div>
              )}
            </div>

            {summary && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
                <SummaryPill label="Extraits" value={summary.extraits} tone="violet" />
                <SummaryPill label="Échecs extr." value={summary.echecsExtraction} tone="amber" />
                <SummaryPill label="Conformes" value={summary.conformes} tone="green" />
                <SummaryPill label="Non conformes" value={summary.nonConformes} tone="red" />
                <SummaryPill label="Sans verdict" value={summary.sansVerdict} tone="slate" />
              </div>
            )}

            {grouped.map(([key, items]) => (
              <div key={key} style={{ ...card, paddingTop: 18 }}>
                <h2
                  style={{
                    margin: '0 0 14px',
                    fontSize: 16,
                    fontWeight: 700,
                    color: VIOLET_DARK,
                    paddingBottom: 8,
                    borderBottom: '1px solid rgba(124,58,237,0.2)',
                  }}
                >
                  {SECTION_TITLES[key] || items[0]?.section || `Section ${key}`}
                </h2>
                {items.map((r) => (
                  <ControlRow key={r.id || r.controlCode} result={r} runId={runId} navState={location.state} />
                ))}
              </div>
            ))}

            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button
                type="button"
                onClick={goBackToPlanning}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: '#94a3b8',
                  fontSize: 13,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Retour à la planification
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
