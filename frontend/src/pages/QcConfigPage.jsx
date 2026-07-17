import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchHubs,
  fetchProjects,
  fetchQcCibleDescriptions,
  fetchQcProjectConfig,
  saveQcProjectConfig,
} from '../services/api';
import WidgetRenderer, { isImplementedWidgetType } from '../components/qc-config/WidgetRenderer';

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

const selectStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  fontSize: 14,
  outline: 'none',
};

const btnPrimary = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

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
        setError('Identifiant projet invalide (attendu b.<guid>)');
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

  const readOnlyControles = useMemo(
    () =>
      controlesMeta.filter(
        (c) => isImplementedWidgetType(c?.descriptionCible?.typeWidget) && c.lectureSeule
      ),
    [controlesMeta]
  );

  const bySection = useMemo(() => {
    const map = new Map();
    const all = [...editableControles, ...readOnlyControles];
    for (const c of all) {
      const sec = c.section || 'Autres';
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec).push(c);
    }
    return [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'fr'));
  }, [editableControles, readOnlyControles]);

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
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', color: '#0f172a' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>
        Configuration QC — par projet
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
        Choisissez un hub puis un projet ACC. Les cibles s&apos;appliquent à tous les runs QC
        de ce projet (clé <code>b.&lt;guid&gt;</code>). Les maquettes à auditer se choisissent
        à la création de tâche (F1).
      </p>

      {/* Sélection hub / projet */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Hub
          </label>
          {loadingHubs ? (
            <p style={{ fontSize: 13, color: '#64748b' }}>Chargement des hubs…</p>
          ) : (
            <select
              value={selectedHub}
              onChange={(e) => setSelectedHub(e.target.value)}
              style={selectStyle}
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
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Projet
          </label>
          <input
            type="search"
            placeholder="Rechercher un projet…"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
            disabled={!selectedHub || loadingProjects}
            style={{ ...selectStyle, marginBottom: 8 }}
          />
          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              background: '#f8fafc',
            }}
          >
            {loadingProjects ? (
              <p style={{ padding: 12, fontSize: 13, color: '#64748b' }}>Chargement…</p>
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
                      padding: '10px 12px',
                      border: 'none',
                      borderBottom: '1px solid #e2e8f0',
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
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Config chargée pour <strong>{loadedProjectId}</strong>
          {existsInDb ? ' (existante en base)' : ' (aucune config encore — défauts widgets)'}
        </p>
      ) : null}

      {error ? (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
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

      {successMsg ? (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {successMsg}
        </div>
      ) : null}

      {!selectedProject ? (
        <p style={{ fontSize: 14, color: '#64748b' }}>
          Sélectionnez un projet pour charger et modifier sa configuration QC.
        </p>
      ) : loadingConfig ? (
        <p style={{ fontSize: 14, color: '#64748b' }}>Chargement de la configuration…</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
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
                ...btnPrimary,
                background: '#64748b',
              }}
            >
              Recharger
            </button>
          </div>

          {bySection.map(([section, items]) => (
            <div key={section} style={{ marginBottom: 28 }}>
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  margin: '0 0 12px',
                  paddingBottom: 6,
                  borderBottom: '2px solid #e2e8f0',
                  color: '#0f172a',
                }}
              >
                {section}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {items.map((c) => (
                  <section
                    key={c.code}
                    data-code={c.code}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: 14,
                      background: c.lectureSeule ? '#f1f5f9' : '#f8fafc',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'baseline',
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{c.code}</span>
                      <span style={{ fontSize: 13, color: '#334155' }}>{c.libelle}</span>
                      {c.nature ? (
                        <span style={{ fontSize: 11, color: '#64748b' }}>{c.nature}</span>
                      ) : null}
                      {c.lectureSeule ? (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>lecture seule</span>
                      ) : null}
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
  );
}
