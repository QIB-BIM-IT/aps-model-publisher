import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { fetchQcProjectDesignatedElements } from '../services/api';
import { pageShell, pageInner, card, btnSecondary, errorBanner } from '../components/qc-config/qcTheme';

const VIOLET = '#7c3aed';
const VIOLET_DARK = '#6d28d9';
const PAGE_SIZE = 50;

const DETAILS_LABELS = {
  raison: 'Raison',
  decalageMm: 'Décalage (mm)',
  elevationEffectiveMm: 'Élévation effective (mm)',
  niveauDeclare: 'Niveau déclaré',
  niveauPlage: 'Niveau de la plage',
  plageNiveauMm: 'Bornes de la plage',
  famille: 'Famille d’analyse',
  groupe: 'Discipline',
  nom: 'Nom',
  principale: 'Variante principale',
  pinned: 'Pinné',
  raisons: 'Motifs',
  categorieAudit: 'Catégorie d’audit',
  designOptionNom: 'Variante',
  nbInstances: 'Occurrences',
  nbMembres: 'Membres du groupe',
  nature: 'Nature',
  guid: 'Identifiant du paramètre',
  source: 'Origine',
  viewSpecific: 'Spécifique à une vue',
  idType: 'Identifiant du type',
  parametre: 'Paramètre',
  natureDetectee: 'Nature détectée',
  parametreAbsent: 'Paramètre absent',
  baseLevel: 'Niveau de base',
  topLevel: 'Niveau supérieur',
};

const KNOWN_DETAIL_KEYS = {
  G111: ['designOptionNom', 'nom', 'raisons'],
  G203: ['nom', 'pinned', 'raisons'],
  G210: ['categorieAudit', 'nom'],
  G314: [
    'niveauDeclare',
    'decalageMm',
    'elevationEffectiveMm',
    'niveauPlage',
    'plageNiveauMm',
    'raison',
    'famille',
    'groupe',
  ],
  G402: ['nom', 'principale'],
  G404: ['nom'],
  G406: ['nom'],
  G407: ['nom'],
  G410: ['nom'],
  G411: ['nom'],
  G412: ['idType', 'nbInstances', 'nbMembres', 'pinned', 'source', 'viewSpecific'],
  G502: ['nom'],
  G504: ['nature', 'nbInstances', 'raison'],
  G507: ['guid', 'nom'],
};

const SKIP_DETAIL_KEYS = new Set(['id']);

const COMMON_SORT = [
  { key: 'revitElementId', label: 'Identifiant Revit' },
  { key: 'category', label: 'Catégorie' },
  { key: 'familyName', label: 'Famille' },
  { key: 'typeName', label: 'Type' },
  { key: 'levelName', label: 'Niveau' },
  { key: 'label', label: 'Libellé' },
];

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

function humanizeKey(key) {
  if (DETAILS_LABELS[key]) return DETAILS_LABELS[key];
  return String(key)
    .replace(/Mm$/, ' (mm)')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function formatNumber(n) {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return new Intl.NumberFormat('fr-CA').format(num);
}

function formatDetailValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((x) => formatDetailValue(x))
      .filter((x) => x !== '')
      .join(', ');
  }
  if (typeof value === 'object') {
    if (value.bas != null || value.haut != null || value.min != null || value.max != null) {
      const lo = value.bas ?? value.min;
      const hi = value.haut ?? value.max;
      if (lo != null && hi != null) return `${formatNumber(lo)} à ${formatNumber(hi)} mm`;
      if (lo != null) return `à partir de ${formatNumber(lo)} mm`;
      if (hi != null) return `jusqu’à ${formatNumber(hi)} mm`;
    }
    return Object.entries(value)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${humanizeKey(k)} : ${formatDetailValue(v)}`)
      .join(' · ');
  }
  return String(value);
}

function collectDetailKeys(controlCode, items) {
  const ordered = [];
  const seen = new Set();
  const push = (k) => {
    if (!k || SKIP_DETAIL_KEYS.has(k) || seen.has(k)) return;
    seen.add(k);
    ordered.push(k);
  };
  for (const k of KNOWN_DETAIL_KEYS[controlCode] || []) push(k);
  for (const item of items || []) {
    const details = item?.details && typeof item.details === 'object' ? item.details : {};
    for (const k of Object.keys(details)) push(k);
  }
  return ordered;
}

const selectStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(248, 250, 252, 0.9)',
  fontSize: 13,
  color: '#0f172a',
};

const thStyle = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid rgba(148,163,184,0.35)',
  color: '#475569',
  fontWeight: 700,
  fontSize: 12,
  whiteSpace: 'nowrap',
  background: 'rgba(248,250,252,0.95)',
};

const tdStyle = {
  padding: '8px 10px',
  borderBottom: '1px solid rgba(148,163,184,0.15)',
  color: '#0f172a',
  fontSize: 13,
  verticalAlign: 'top',
};

function modelLabel(m) {
  return m?.modelName || 'Maquette';
}

export default function QcProjectElementsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const controlCode = searchParams.get('controlCode') || '';
  const accModelGuid = searchParams.get('accModelGuid') || '';

  const [qInput, setQInput] = useState(searchParams.get('q') || '');
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [category, setCategory] = useState(searchParams.get('category') || '');
  const [level, setLevel] = useState(searchParams.get('level') || '');
  const [page, setPage] = useState(Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1));
  const [sortBy, setSortBy] = useState('controlCode');
  const [sortDir, setSortDir] = useState('asc');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [copyMsg, setCopyMsg] = useState(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = qInput.trim();
      setQ((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const next = {};
    if (controlCode) next.controlCode = controlCode;
    if (accModelGuid) next.accModelGuid = accModelGuid;
    if (q) next.q = q;
    if (category) next.category = category;
    if (level) next.level = level;
    if (page > 1) next.page = String(page);
    setSearchParams(next, { replace: true });
  }, [controlCode, accModelGuid, q, category, level, page, setSearchParams]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchQcProjectDesignatedElements(projectId, {
        controlCode: controlCode || undefined,
        accModelGuid: accModelGuid || undefined,
        category: category || undefined,
        level: level || undefined,
        q: q || undefined,
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        sortDir,
      });
      setPayload(data);
    } catch (err) {
      setError(err?.message || 'Impossible de charger les éléments désignés');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, controlCode, accModelGuid, category, level, q, page, sortBy, sortDir]);

  useEffect(() => {
    load();
  }, [load]);

  const project = payload?.project;
  const items = payload?.items || [];
  const total = payload?.total ?? 0;
  const pageCount = payload?.pageCount ?? 0;
  const byControl = payload?.byControl || [];
  const byModel = payload?.byModel || [];
  const facets = payload?.facets || { categories: [], levels: [] };
  const totalAll = byModel.reduce((s, m) => s + (m.count || 0), 0);

  const adaptiveKeys = useMemo(
    () => (controlCode ? collectDetailKeys(controlCode, items) : []),
    [controlCode, items]
  );

  function replaceFilters({ nextControl = controlCode, nextModel = accModelGuid }) {
    const next = {};
    if (nextControl) next.controlCode = nextControl;
    if (nextModel) next.accModelGuid = nextModel;
    if (q) next.q = q;
    setSearchParams(next, { replace: true });
    setCategory('');
    setLevel('');
    setPage(1);
  }

  function toggleSort(key) {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
    setPage(1);
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

  async function copyText(text, scopeLabel) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(scopeLabel);
    } catch {
      setCopyMsg('Impossible de copier dans le presse-papiers.');
    }
    setTimeout(() => setCopyMsg(null), 4000);
  }

  function copyPageIds() {
    const ids = items.map((r) => r.revitElementId).filter(Boolean);
    if (!ids.length) {
      setCopyMsg('Aucun identifiant Revit sur cette page.');
      setTimeout(() => setCopyMsg(null), 4000);
      return;
    }
    copyText(
      ids.join('\n'),
      `${ids.length} identifiant(s) Revit copiés — page affichée uniquement (${items.length} ligne(s)).`
    );
  }

  function copyPageLabels() {
    const labels = items.map((r) => r.label).filter((x) => x && String(x).trim());
    if (!labels.length) {
      setCopyMsg('Aucun libellé sur cette page.');
      setTimeout(() => setCopyMsg(null), 4000);
      return;
    }
    copyText(
      labels.join('\n'),
      `${labels.length} libellé(s) copiés — page affichée uniquement (${items.length} ligne(s)).`
    );
  }

  async function copyAll(kind) {
    if (!projectId || copying) return;
    setCopying(true);
    try {
      const data = await fetchQcProjectDesignatedElements(projectId, {
        controlCode: controlCode || undefined,
        accModelGuid: accModelGuid || undefined,
        category: category || undefined,
        level: level || undefined,
        q: q || undefined,
        idsOnly: 1,
        sortBy,
        sortDir,
      });
      const values = kind === 'ids' ? data?.revitElementIds || [] : data?.labels || [];
      if (!values.length) {
        setCopyMsg(
          kind === 'ids'
            ? 'Aucun identifiant Revit dans l’ensemble filtré (éléments sans identifiant).'
            : 'Aucun libellé dans l’ensemble filtré.'
        );
        setTimeout(() => setCopyMsg(null), 4000);
        return;
      }
      const extra = data?.truncated ? ' (plafond de copie atteint)' : '';
      await copyText(
        values.join('\n'),
        kind === 'ids'
          ? `${values.length} identifiant(s) Revit copiés — ensemble des résultats filtrés (${data.total} ligne(s))${extra}.`
          : `${values.length} libellé(s) copiés — ensemble des résultats filtrés (${data.total} ligne(s))${extra}.`
      );
    } catch (err) {
      setCopyMsg(err?.message || 'Échec de la copie de l’ensemble filtré.');
      setTimeout(() => setCopyMsg(null), 4000);
    } finally {
      setCopying(false);
    }
  }

  const selectedControl = byControl.find((c) => c.controlCode === controlCode);
  const selectedModel = byModel.find(
    (m) => String(m.accModelGuid).toLowerCase() === accModelGuid.toLowerCase()
  );
  const modelsToShow = selectedModel ? [selectedModel] : byModel;

  return (
    <div style={pageShell}>
      <div style={{ ...pageInner, maxWidth: 1280 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          <button type="button" onClick={goBackToPlanning} style={btnSecondary}>
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
          Éléments désignés — état actuel
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: '#94a3b8' }}>
          Dernier contrôle réussi de chaque maquette du projet. Ce n’est pas l’historique :
          une maquette sans contrôle réussi n’apparaît pas.
        </p>

        {error && <div style={errorBanner}>{error}</div>}

        <div style={{ ...card, borderTop: `4px solid ${VIOLET}` }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
            {project?.projectName || 'Projet'}
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#475569' }}>
            Vue de l’état actuel : pour chaque maquette, seuls les éléments du dernier
            contrôle réussi sont listés.
          </p>
          {modelsToShow.length > 0 && (
            <div style={{ display: 'grid', gap: 10 }}>
              {modelsToShow.map((m) => (
                <div
                  key={m.accModelGuid}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(124,58,237,0.06)',
                    border: '1px solid rgba(124,58,237,0.18)',
                    fontSize: 13,
                    color: '#334155',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{modelLabel(m)}</div>
                  <div style={{ marginTop: 4 }}>
                    Dernier contrôle : {formatDateTime(m.endedAtUtc || m.startedAtUtc)}
                    {' · '}
                    Version ACC {m.modelVersion != null ? `v${m.modelVersion}` : 'inconnue'}
                    {' · '}
                    {m.count} élément(s)
                  </div>
                </div>
              ))}
            </div>
          )}
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
            Les identifiants Revit valent pour la version ACC auditée de chaque maquette.
            Les maquettes ont pu être contrôlées à des dates différentes, et le modèle a
            pu évoluer depuis.
          </p>
        </div>

        <div style={card}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <label style={{ display: 'block' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Maquette</div>
              <select
                value={accModelGuid}
                onChange={(e) => replaceFilters({ nextModel: e.target.value })}
                style={selectStyle}
              >
                <option value="">Toutes les maquettes ({totalAll})</option>
                {byModel.map((m) => (
                  <option key={m.accModelGuid} value={m.accModelGuid}>
                    {modelLabel(m)} ({m.count})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Contrôle</div>
              <select
                value={controlCode}
                onChange={(e) => replaceFilters({ nextControl: e.target.value })}
                style={selectStyle}
              >
                <option value="">
                  Tous les contrôles ({byControl.reduce((s, c) => s + (c.count || 0), 0)})
                </option>
                {byControl.map((c) => (
                  <option key={c.controlCode} value={c.controlCode}>
                    {c.controlCode} — {c.libelle} ({c.count})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Recherche</div>
              <input
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Libellé, type ou famille"
                style={selectStyle}
              />
            </label>
            <label style={{ display: 'block' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Catégorie</div>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(1);
                }}
                style={selectStyle}
                disabled={!facets.categories?.length}
              >
                <option value="">Toutes les catégories</option>
                {facets.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Niveau</div>
              <select
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                  setPage(1);
                }}
                style={selectStyle}
                disabled={!facets.levels?.length}
              >
                <option value="">Tous les niveaux</option>
                {facets.levels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ fontSize: 13, color: '#334155', marginBottom: 12 }}>
            {loading
              ? 'Chargement…'
              : selectedControl
                ? `${total} élément(s) pour ${selectedControl.controlCode} — ${selectedControl.libelle}`
                : `${total} élément(s)`}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={copyPageIds} style={btnSecondary}>
              Copier les identifiants Revit de cette page
            </button>
            <button type="button" onClick={copyPageLabels} style={btnSecondary}>
              Copier les libellés de cette page
            </button>
            <button
              type="button"
              onClick={() => copyAll('ids')}
              disabled={copying || total === 0}
              style={{
                ...btnSecondary,
                background: `linear-gradient(135deg, ${VIOLET} 0%, ${VIOLET_DARK} 100%)`,
                color: '#fff',
                border: 'none',
                opacity: copying || total === 0 ? 0.6 : 1,
              }}
            >
              {copying ? 'Copie…' : 'Copier les identifiants Revit de tous les résultats filtrés'}
            </button>
            <button
              type="button"
              onClick={() => copyAll('labels')}
              disabled={copying || total === 0}
              style={btnSecondary}
            >
              Copier les libellés de tous les résultats filtrés
            </button>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b' }}>
            « Cette page » = les {items.length} ligne(s) affichées. « Tous les résultats filtrés » = les{' '}
            {total} ligne(s) correspondant aux filtres actuels, pas seulement cette page.
          </p>
          {copyMsg && (
            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(124,58,237,0.08)',
                color: VIOLET_DARK,
                fontSize: 13,
              }}
            >
              {copyMsg}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Maquette</th>
                  {!controlCode && (
                    <th style={thStyle}>
                      <button
                        type="button"
                        onClick={() => toggleSort('controlCode')}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: sortBy === 'controlCode' ? VIOLET_DARK : '#475569',
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        Contrôle
                        {sortBy === 'controlCode' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  )}
                  {COMMON_SORT.map((col) => (
                    <th key={col.key} style={thStyle}>
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: sortBy === col.key ? VIOLET_DARK : '#475569',
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        {col.label}
                        {sortBy === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                  {adaptiveKeys.map((k) => (
                    <th key={k} style={thStyle}>
                      {humanizeKey(k)}
                    </th>
                  ))}
                  <th style={thStyle}>Run</th>
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  items.map((row, i) => (
                    <tr key={row.id} style={{ background: i % 2 ? 'rgba(248,250,252,0.8)' : 'transparent' }}>
                      <td style={tdStyle}>{row.modelName || 'Maquette'}</td>
                      {!controlCode && (
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 700, color: VIOLET_DARK }}>{row.controlCode}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>{row.libelle}</div>
                        </td>
                      )}
                      <td style={{ ...tdStyle, fontFamily: 'ui-monospace, Consolas, monospace' }}>
                        {row.revitElementId || ''}
                      </td>
                      <td style={tdStyle}>{row.category || ''}</td>
                      <td style={tdStyle}>{row.familyName || ''}</td>
                      <td style={tdStyle}>{row.typeName || ''}</td>
                      <td style={tdStyle}>{row.levelName || ''}</td>
                      <td style={tdStyle}>{row.label || ''}</td>
                      {adaptiveKeys.map((k) => (
                        <td key={k} style={tdStyle}>
                          {formatDetailValue(row.details?.[k])}
                        </td>
                      ))}
                      <td style={tdStyle}>
                        {row.runId ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/qc-run/${encodeURIComponent(row.runId)}`)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: VIOLET_DARK,
                              fontWeight: 600,
                              fontSize: 12,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                            }}
                          >
                            Voir le run
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {!loading && total === 0 && (
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 12 }}>
              Aucun élément ne correspond à ces filtres. Un projet sans contrôle réussi
              affiche aussi une liste vide.
            </p>
          )}

          {pageCount > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginTop: 16,
                fontSize: 13,
                color: '#334155',
              }}
            >
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ ...btnSecondary, opacity: page <= 1 ? 0.45 : 1 }}
              >
                Page précédente
              </button>
              <span>
                Page {page} sur {pageCount} — {total} élément(s)
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                style={{ ...btnSecondary, opacity: page >= pageCount ? 0.45 : 1 }}
              >
                Page suivante
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
