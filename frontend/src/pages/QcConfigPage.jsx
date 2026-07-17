import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchHubs,
  fetchProjects,
  fetchQcCibleDescriptions,
  fetchQcProjectConfig,
  saveQcProjectConfig,
} from '../services/api';
import WidgetRenderer, { isImplementedWidgetType } from '../components/qc-config/WidgetRenderer';
import {
  pageShell,
  pageInner,
  pageTitle,
  pageSubtitle,
  card,
  cardTitle,
  sectionTitle,
  label,
  input,
  btnPrimary,
  btnSecondary,
  muted,
  errorBanner,
  successBanner,
  controlCard,
  controlCardReadonly,
  projectListBox,
  badge,
  badgeMuted,
  SECTION_TITLES,
  sectionKeyFromCode,
  controlNum,
} from '../components/qc-config/qcTheme';

function nameOf(node, fall = '') {
  if (!node) return fall;
  const a = node?.attributes || {};
  return a.displayName || a.name || node?.name || node?.hubName || node?.projectName || fall;
}

function idOf(node) {
  return node?.id || node?.hubId || node?.projectId || node?.urn || '';
}

/** Widgets qui émettent déjà l'objet controles[code] complet. */
const OBJECT_WIDGETS = new Set([
  'listePrefixes',
  'parametreUniformat',
  'recetteNommage',
  'table',
  'regleMaisonLectureSeule',
  'indicatif',
]);

/**
 * Config API → valeur widget.
 * Simple (cleConfig = "cible"|…) : unwrap. Complexe : objet entier.
 */
export function toWidgetValeur(controlCfg, descriptionCible) {
  if (controlCfg == null || typeof controlCfg !== 'object' || Array.isArray(controlCfg)) {
    return undefined;
  }
  const type = descriptionCible?.typeWidget;
  if (OBJECT_WIDGETS.has(type)) return controlCfg;

  const cle = descriptionCible?.cleConfig;
  if (cle && typeof cle === 'string' && !cle.includes('|') && !cle.includes('(')) {
    if (Object.prototype.hasOwnProperty.call(controlCfg, cle)) return controlCfg[cle];
  }
  if (Object.prototype.hasOwnProperty.call(controlCfg, 'cible')) return controlCfg.cible;
  if (Object.prototype.hasOwnProperty.call(controlCfg, 'seuil')) return controlCfg.seuil;
  return controlCfg;
}

/**
 * Valeur widget → objet controles[code] pour PUT.
 * null = effacement ciblé ; undefined = ne pas envoyer.
 */
export function toControlCfg(valeur, descriptionCible) {
  if (valeur === undefined) return undefined;
  if (valeur === null) return null;
  if (valeur === '') return null;

  const type = descriptionCible?.typeWidget;
  if (OBJECT_WIDGETS.has(type)) {
    if (typeof valeur === 'object' && !Array.isArray(valeur)) return valeur;
    return undefined;
  }

  const cle =
    descriptionCible?.cleConfig &&
    typeof descriptionCible.cleConfig === 'string' &&
    !descriptionCible.cleConfig.includes('|') &&
    !descriptionCible.cleConfig.includes('(')
      ? descriptionCible.cleConfig
      : 'cible';

  // coordonnees / angle : objet primary sous cleConfig
  if (type === 'coordonnees' || type === 'angle') {
    if (typeof valeur === 'object' && !Array.isArray(valeur)) return { [cle]: valeur };
    return undefined;
  }

  return { [cle]: valeur };
}

/**
 * Page isolée F2 — formulaire de configuration QC sur données réelles (grain projet).
 * Sélection légère hub → projet ; charge/sauve via API config (clé b.<guid>).
 */
export default function QcConfigPage() {
  const [hubs, setHubs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedHub, setSelectedHub] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [projectSearch, setProjectSearch] = useState('');

  const [loadingHubs, setLoadingHubs] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [saving, setSaving] = useState(false);

  const [controlesMeta, setControlesMeta] = useState([]);
  /** État formulaire : { [code]: valeurWidget } */
  const [config, setConfig] = useState({});
  const [loadedProjectId, setLoadedProjectId] = useState('');
  const [existsInDb, setExistsInDb] = useState(false);

  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const [successMsg, setSuccessMsg] = useState('');

  // Descriptions une fois
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchQcCibleDescriptions();
        if (!cancelled) {
          setControlesMeta(Array.isArray(data?.controles) ? data.controles : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.response?.data?.message || e?.message || 'Erreur chargement descriptions');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hubs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingHubs(true);
      try {
        const list = await fetchHubs();
        if (cancelled) return;
        setHubs(list || []);
        if (list?.length) {
          setSelectedHub((prev) => prev || idOf(list[0]));
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.response?.data?.message || e?.message || 'Erreur chargement hubs');
        }
      } finally {
        if (!cancelled) setLoadingHubs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Projets du hub
  useEffect(() => {
    if (!selectedHub) {
      setProjects([]);
      setSelectedProject('');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingProjects(true);
      setSelectedProject('');
      setConfig({});
      setLoadedProjectId('');
      setSuccessMsg('');
      setValidationErrors([]);
      try {
        const list = await fetchProjects(selectedHub);
        if (!cancelled) setProjects(list || []);
      } catch (e) {
        if (!cancelled) {
          setError(e?.response?.data?.message || e?.message || 'Erreur chargement projets');
          setProjects([]);
        }
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedHub]);

  const loadProjectConfig = useCallback(
    async (projectId) => {
      if (!projectId || !String(projectId).startsWith('b.')) {
        setError('Projet invalide — sélectionnez un projet ACC dans la liste.');
        return;
      }
      setLoadingConfig(true);
      setError('');
      setSuccessMsg('');
      setValidationErrors([]);
      try {
        const data = await fetchQcProjectConfig(projectId);
        const controlesCfg = data?.config?.controles || {};
        const next = {};
        for (const meta of controlesMeta) {
          const stored = controlesCfg[meta.code];
          if (stored == null) continue;
          const v = toWidgetValeur(stored, meta.descriptionCible);
          if (v !== undefined) next[meta.code] = v;
        }
        setConfig(next);
        setLoadedProjectId(data.projectId || projectId);
        setExistsInDb(!!data.exists);
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || 'Erreur chargement config');
        setConfig({});
        setLoadedProjectId('');
      } finally {
        setLoadingConfig(false);
      }
    },
    [controlesMeta]
  );

  useEffect(() => {
    if (!selectedProject || !controlesMeta.length) return;
    loadProjectConfig(selectedProject);
  }, [selectedProject, controlesMeta, loadProjectConfig]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => nameOf(p, idOf(p)).toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const editableControles = useMemo(
    () =>
      controlesMeta.filter(
        (c) => isImplementedWidgetType(c?.descriptionCible?.typeWidget) && !c.lectureSeule
      ),
    [controlesMeta]
  );

  /** Groupés par section du registre (1→6), tri numérique du code dans chaque section. */
  const bySection = useMemo(() => {
    const all = controlesMeta
      .filter((c) => isImplementedWidgetType(c?.descriptionCible?.typeWidget))
      .slice()
      .sort((a, b) => {
        const sa = sectionKeyFromCode(a.code);
        const sb = sectionKeyFromCode(b.code);
        if (sa !== sb) return sa - sb;
        return controlNum(a.code) - controlNum(b.code);
      });

    const map = new Map();
    for (const c of all) {
      const key = sectionKeyFromCode(c.code);
      const title = SECTION_TITLES[key] || c.section || 'Autres';
      if (!map.has(title)) map.set(title, []);
      map.get(title).push(c);
    }
    return [...map.entries()];
  }, [controlesMeta]);

  function setControlValue(code, valeur) {
    setConfig((prev) => {
      if (valeur === null || valeur === undefined) {
        const next = { ...prev };
        delete next[code];
        return next;
      }
      return { ...prev, [code]: valeur };
    });
    setSuccessMsg('');
    setValidationErrors([]);
  }

  async function handleSave() {
    if (!selectedProject || !loadedProjectId) return;
    setSaving(true);
    setError('');
    setSuccessMsg('');
    setValidationErrors([]);

    const controles = {};
    for (const meta of editableControles) {
      if (!Object.prototype.hasOwnProperty.call(config, meta.code)) continue;
      const cfg = toControlCfg(config[meta.code], meta.descriptionCible);
      if (cfg !== undefined) controles[meta.code] = cfg;
    }

    try {
      const result = await saveQcProjectConfig(loadedProjectId, { controles });
      setSuccessMsg(
        `Configuration enregistrée pour ${result.projectId || loadedProjectId}` +
          (result.projectName ? ` (${result.projectName})` : '')
      );
      // Recharger pour confirmer la persistance sous b.<guid>
      await loadProjectConfig(loadedProjectId);
    } catch (e) {
      const data = e?.response?.data;
      const errs = Array.isArray(data?.errors)
        ? data.errors
        : Array.isArray(e?.errors)
          ? e.errors
          : [];
      setValidationErrors(errs);
      setError(data?.message || e?.message || 'Erreur enregistrement');
      // saisie conservée dans `config`
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    !!selectedProject &&
    !!loadedProjectId &&
    !loadingConfig &&
    !saving &&
    editableControles.length > 0;

  return (
    <div style={pageShell}>
      <div style={pageInner}>
        <h1 style={pageTitle}>Configuration QC — par projet</h1>
        <p style={pageSubtitle}>
          Sélectionnez un projet pour définir ses cibles de contrôle qualité. Ces cibles
          serviront à évaluer les maquettes de ce projet. Le choix des maquettes à auditer
          se fait au moment de planifier une tâche QC.
        </p>

        {/* Sélection hub / projet — carte type Planning */}
        <div style={card}>
          <h3 style={cardTitle}>Projet ACC</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 20,
            }}
          >
            <div>
              <label style={label}>Hub</label>
              {loadingHubs ? (
                <p style={muted}>Chargement des hubs…</p>
              ) : (
                <select
                  value={selectedHub}
                  onChange={(e) => setSelectedHub(e.target.value)}
                  style={{ ...input, cursor: 'pointer' }}
                >
                  {hubs.map((h) => (
                    <option key={idOf(h)} value={idOf(h)}>
                      {nameOf(h, idOf(h))}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label style={label}>Projet</label>
              <input
                type="search"
                placeholder="Rechercher un projet…"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                disabled={!selectedHub || loadingProjects}
                style={{ ...input, marginBottom: 8 }}
              />
              <div style={projectListBox}>
                {loadingProjects ? (
                  <p style={{ padding: 12, ...muted }}>Chargement…</p>
                ) : filteredProjects.length === 0 ? (
                  <p style={{ padding: 12, fontSize: 13, color: '#94a3b8' }}>Aucun projet</p>
                ) : (
                  filteredProjects.map((p) => {
                    const pid = idOf(p);
                    const selected = pid === selectedProject;
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => setSelectedProject(pid)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 14px',
                          border: 'none',
                          borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
                          background: selected ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
                          color: selected ? '#1d4ed8' : '#1e293b',
                          fontWeight: selected ? 600 : 400,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        {nameOf(p, pid)}
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{pid}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {loadedProjectId ? (
            <p style={{ ...muted, marginTop: 16, marginBottom: 0 }}>
              Configuration chargée pour le projet{' '}
              <strong style={{ color: '#0f172a' }}>
                {nameOf(
                  projects.find((p) => idOf(p) === selectedProject),
                  loadedProjectId
                )}
              </strong>
              {existsInDb
                ? ' (déjà enregistrée).'
                : ' (aucune configuration enregistrée — valeurs par défaut affichées).'}
            </p>
          ) : null}
        </div>

        {error ? (
          <div style={errorBanner}>
            {error}
            {validationErrors.length > 0 ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {validationErrors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {successMsg ? <div style={successBanner}>{successMsg}</div> : null}

        {!selectedProject ? (
          <div style={card}>
            <p style={{ ...muted, margin: 0 }}>
              Sélectionnez un projet pour charger et modifier sa configuration QC.
            </p>
          </div>
        ) : loadingConfig ? (
          <div style={card}>
            <p style={{ ...muted, margin: 0 }}>Chargement de la configuration…</p>
          </div>
        ) : (
          <>
            <div
              style={{
                ...card,
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '16px 24px',
              }}
            >
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                style={{
                  ...btnPrimary,
                  opacity: canSave ? 1 : 0.5,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                }}
              >
                {saving ? 'Enregistrement…' : 'Enregistrer la configuration'}
              </button>
              <button
                type="button"
                onClick={() => loadProjectConfig(selectedProject)}
                disabled={loadingConfig || saving}
                style={{
                  ...btnSecondary,
                  opacity: loadingConfig || saving ? 0.5 : 1,
                  cursor: loadingConfig || saving ? 'not-allowed' : 'pointer',
                }}
              >
                Recharger
              </button>
            </div>

            {bySection.map(([section, items]) => (
              <div key={section} style={card}>
                <h3 style={sectionTitle}>{section}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {items.map((c) => (
                    <section
                      key={c.code}
                      data-code={c.code}
                      style={c.lectureSeule ? controlCardReadonly : controlCard}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          alignItems: 'center',
                          marginBottom: 12,
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                          {c.code}
                        </span>
                        <span style={{ fontSize: 13, color: '#334155' }}>{c.libelle}</span>
                        {c.nature ? <span style={badge}>{c.nature}</span> : null}
                        {c.lectureSeule ? <span style={badgeMuted}>lecture seule</span> : null}
                      </div>
                      <WidgetRenderer
                        descriptionCible={c.descriptionCible}
                        valeur={config[c.code]}
                        onChange={(v) => {
                          if (c.lectureSeule) return;
                          setControlValue(c.code, v);
                        }}
                      />
                    </section>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
