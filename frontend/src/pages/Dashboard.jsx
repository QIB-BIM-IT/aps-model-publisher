import React from 'react';
import {
  fetchHubs,
  fetchProjects,
  fetchTopFolders,
  fetchFolderContents,
  createPublishJob,
  getPublishJobs,
  patchPublishJob,
  deletePublishJob,
  runPublishJobNow,
  getRuns,
} from '../services/api';

// Helpers
function nameOf(node, fall = '') {
  const a = node?.attributes || {};
  return a.displayName || a.name || node?.name || node?.hubName || node?.projectName || fall;
}
function idOf(node) {
  return node?.id || node?.hubId || node?.projectId || node?.urn || '';
}
function extOf(node) {
  const n = nameOf(node, '').toLowerCase();
  const m = n.match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}
function isFolder(node) {
  const t = node?.type || node?.attributes?.extension?.type || '';
  return t.includes('folder') || node?.type === 'folders';
}
function isItem(node) {
  const t = node?.type || node?.attributes?.extension?.type || '';
  return t.includes('items') || node?.type === 'items';
}
const isRvt = (node) => extOf(node) === 'rvt';

function RevitIcon() {
  return (
    <span
      style={{
        display: 'inline-flex',
        width: 20,
        height: 20,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        marginRight: 8,
        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
        color: 'white',
        lineHeight: 1,
        boxShadow: '0 2px 4px rgba(37,99,235,0.3)',
      }}
    >
      R
    </span>
  );
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00`;
  let suffix = '';
  if (value === '00:00') suffix = ' — Minuit';
  if (value === '12:00') suffix = ' — Midi';
  if (value === '02:00') suffix = ' — Recommandé';
  return {
    value,
    label: `${value}${suffix}`,
  };
});

const TIMEZONE_OPTIONS = [
  { value: 'America/Vancouver', label: '🇨🇦 Canada - Vancouver (Pacific)' },
  { value: 'America/Edmonton', label: '🇨🇦 Canada - Calgary (Mountain)' },
  { value: 'America/Toronto', label: '🇨🇦 Canada - Toronto (Eastern)' },
  { value: 'America/Halifax', label: '🇨🇦 Canada - Halifax (Atlantic)' },
  { value: 'America/Los_Angeles', label: '🇺🇸 USA - Los Angeles (Pacific)' },
  { value: 'America/Denver', label: '🇺🇸 USA - Denver (Mountain)' },
  { value: 'America/Chicago', label: '🇺🇸 USA - Chicago (Central)' },
  { value: 'America/New_York', label: '🇺🇸 USA - New York (Eastern)' },
  { value: 'Europe/London', label: '🇬🇧 Europe - Londres' },
  { value: 'Europe/Paris', label: '🇫🇷 Europe - Paris' },
  { value: 'Europe/Berlin', label: '🇩🇪 Europe - Berlin' },
  { value: 'Europe/Madrid', label: '🇪🇸 Europe - Madrid' },
  { value: 'Asia/Dubai', label: '🇦🇪 Asie - Dubaï' },
  { value: 'Asia/Singapore', label: '🇸🇬 Asie - Singapour' },
  { value: 'Asia/Tokyo', label: '🇯🇵 Asie - Tokyo' },
  { value: 'Asia/Shanghai', label: '🇨🇳 Asie - Shanghai' },
  { value: 'Australia/Sydney', label: '🇦🇺 Australie - Sydney' },
  { value: 'UTC', label: '🌐 UTC' },
];

const DEFAULT_TIMEZONE =
  typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';

// Tree Node avec style moderne
function TreeNode({ node, projectId, onLoadChildren, childrenMap, selected, onToggleSelect }) {
  const [expanded, setExpanded] = React.useState(false);
  const id = idOf(node);
  const nm = nameOf(node, id);
  const kids = childrenMap.get(id) || null;
  const loading = kids === 'loading';

  async function toggle() {
    if (isFolder(node)) {
      if (!kids) onLoadChildren(id);
      setExpanded((e) => !e);
    }
  }

  const selectable = isItem(node) && isRvt(node);
  const checked = !!selected[id];

  return (
    <div style={{ marginLeft: 20 }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: 8,
          transition: 'all 0.2s',
          background: checked ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
          border: checked ? '1px solid rgba(37, 99, 235, 0.2)' : '1px solid transparent',
        }}
      >
        {isFolder(node) ? (
          <button
            onClick={toggle}
            style={{
              cursor: 'pointer',
              width: 24,
              height: 24,
              border: 'none',
              background: 'rgba(148, 163, 184, 0.15)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              transition: 'all 0.2s',
              color: '#475569',
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span style={{ width: 24 }} />
        )}
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleSelect(id, node)}
            style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563eb' }}
          />
        )}
        {isItem(node) && isRvt(node) && <RevitIcon />}
        <span style={{ fontSize: 14, color: '#1f2937', fontWeight: checked ? 600 : 400 }}>{nm}</span>
      </div>

      {expanded && (
        <div style={{ marginLeft: 12, marginTop: 4 }}>
          {loading && <div style={{ color: '#6b7280', fontSize: 14, padding: 8 }}>Chargement…</div>}
          {!loading && Array.isArray(kids) && kids.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>(vide)</div>
          )}
          {!loading &&
            Array.isArray(kids) &&
            kids.map((child) => (
              <TreeNode
                key={idOf(child)}
                node={child}
                projectId={projectId}
                onLoadChildren={onLoadChildren}
                childrenMap={childrenMap}
                selected={selected}
                onToggleSelect={onToggleSelect}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// Composant Card moderne
function Card({ children, title, style = {} }) {
  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(20px)',
        borderRadius: 16,
        border: '1px solid rgba(148, 163, 184, 0.2)',
        boxShadow: '0 8px 32px rgba(15, 23, 42, 0.08)',
        padding: 24,
        ...style,
      }}
    >
      {title && (
        <h3
          style={{
            margin: '0 0 20px 0',
            fontSize: 18,
            fontWeight: 600,
            color: '#0f172a',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

// Bouton moderne
function Button({ children, onClick, variant = 'primary', disabled = false, style = {} }) {
  const variants = {
    primary: {
      background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
      color: '#fff',
      border: 'none',
      boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
    },
    secondary: {
      background: 'rgba(148, 163, 184, 0.15)',
      color: '#475569',
      border: '1px solid rgba(148, 163, 184, 0.3)',
      boxShadow: 'none',
    },
    danger: {
      background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
      color: '#fff',
      border: 'none',
      boxShadow: '0 4px 14px rgba(220, 38, 38, 0.4)',
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 20px',
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s',
        opacity: disabled ? 0.5 : 1,
        ...variants[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export default function Dashboard() {
  const [hubs, setHubs] = React.useState([]);
  const [selectedHub, setSelectedHub] = React.useState('');
  const [projects, setProjects] = React.useState([]);
  const [selectedProject, setSelectedProject] = React.useState('');
  const [projectSearch, setProjectSearch] = React.useState('');

  const [topFolders, setTopFolders] = React.useState([]);
  const [childrenMap, setChildrenMap] = React.useState(new Map());
  const [selectedItems, setSelectedItems] = React.useState({});

  const [jobs, setJobs] = React.useState([]);
  const [loadingJobs, setLoadingJobs] = React.useState(false);

  const [runs, setRuns] = React.useState([]);
  const [loadingRuns, setLoadingRuns] = React.useState(false);

  const [loadingHubs, setLoadingHubs] = React.useState(false);
  const [loadingProjects, setLoadingProjects] = React.useState(false);
  const [loadingTop, setLoadingTop] = React.useState(false);

  const [selectedHour, setSelectedHour] = React.useState('02:00');
  const [cronExpression, setCronExpression] = React.useState('0 2 * * *');
  const [timezone, setTimezone] = React.useState(DEFAULT_TIMEZONE);
  const [error, setError] = React.useState('');
  const [toast, setToast] = React.useState('');

  React.useEffect(() => {
    const [hour, minute] = selectedHour.split(':');
    setCronExpression(`${minute} ${hour} * * *`);
  }, [selectedHour]);

  async function loadHubs() {
    setLoadingHubs(true);
    setError('');
    try {
      const data = await fetchHubs();
      setHubs(data);
      if (data.length) setSelectedHub(idOf(data[0]));
    } catch (e) {
      setError(e?.message || 'Erreur hubs');
    } finally {
      setLoadingHubs(false);
    }
  }

  const resetProjectData = React.useCallback(() => {
    setSelectedProject('');
    setProjectSearch('');
    setTopFolders([]);
    setChildrenMap(new Map());
    setSelectedItems({});
    setJobs([]);
    setRuns([]);
  }, []);

  async function loadProjects(hubId) {
    if (!hubId) {
      setProjects([]);
      resetProjectData();
      return;
    }
    setLoadingProjects(true);
    setError('');
    try {
      const data = await fetchProjects(hubId);
      setProjects(data);
      setProjectSearch('');
      if (data.length) {
        setSelectedProject(idOf(data[0]));
      } else {
        resetProjectData();
      }
    } catch (e) {
      setProjects([]);
      resetProjectData();
      setError(e?.message || 'Erreur projets');
    } finally {
      setLoadingProjects(false);
    }
  }

  async function loadTopFolders(hubId, projectId) {
    if (!hubId || !projectId) {
      setTopFolders([]);
      return;
    }
    setLoadingTop(true);
    setError('');
    setChildrenMap(new Map());
    setSelectedItems({});
    try {
      const data = await fetchTopFolders(hubId, projectId);
      setTopFolders(data);
      await Promise.all([refreshJobs(), refreshRuns()]);
    } catch (e) {
      setError(e?.message || 'Erreur dossiers');
    } finally {
      setLoadingTop(false);
    }
  }

  async function loadChildren(folderId) {
    setChildrenMap((m) => new Map(m.set(folderId, 'loading')));
    try {
      const data = await fetchFolderContents(selectedProject, folderId);
      setChildrenMap((m) => new Map(m.set(folderId, data)));
    } catch (e) {
      setChildrenMap((m) => new Map(m.set(folderId, [])));
      setError(e?.message || 'Erreur dossier');
    }
  }

  function toggleSelect(itemId, node) {
    setSelectedItems((prev) => {
      const nxt = { ...prev };
      if (nxt[itemId]) {
        delete nxt[itemId];
      } else {
        nxt[itemId] = {
          ...node,
          publishUrn: itemId,
        };
      }
      return nxt;
    });
  }

  async function refreshJobs() {
    setLoadingJobs(true);
    try {
      const list = await getPublishJobs({ hubId: selectedHub, projectId: selectedProject });
      setJobs(list);
    } catch (e) {
      setError(e?.message || 'Erreur jobs');
    } finally {
      setLoadingJobs(false);
    }
  }

  async function refreshRuns() {
    setLoadingRuns(true);
    try {
      const list = await getRuns({ hubId: selectedHub, projectId: selectedProject, limit: 50 });
      setRuns(list);
    } catch (e) {
      setError(e?.message || 'Erreur historique');
    } finally {
      setLoadingRuns(false);
    }
  }

  async function handlePlanifier() {
    const items = Object.values(selectedItems).map((item) => item.publishUrn);
    if (!selectedHub || !selectedProject || items.length === 0) {
      setToast('⚠️ Sélectionne au moins une maquette RVT.');
      setTimeout(() => setToast(''), 3000);
      return;
    }
    try {
      await createPublishJob({
        hubId: selectedHub,
        projectId: selectedProject,
        items,
        scheduleEnabled: true,
        cronExpression,
        timezone,
        notifyOnFailure: true,
      });
      setToast('✅ Job créé avec succès!');
      setTimeout(() => setToast(''), 3000);
      setSelectedItems({});
      await Promise.all([refreshJobs(), refreshRuns()]);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleToggleActive(job) {
    await patchPublishJob(job.id, { scheduleEnabled: !job.scheduleEnabled });
    await refreshJobs();
  }

  async function handleRunNow(job) {
    try {
      const run = await runPublishJobNow(job.id);
      if (run?.id) {
        setRuns((prev) => [{ ...run, status: 'pending' }, ...prev.filter((r) => r.id !== run.id)]);
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id ? { ...j, status: 'running', lastRun: new Date().toISOString() } : j
          )
        );
      }
      setTimeout(refreshRuns, 400);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur lancement'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleDelete(job) {
    if (!window.confirm('Supprimer ce job?')) return;
    await deletePublishJob(job.id);
    await Promise.all([refreshJobs(), refreshRuns()]);
  }

  React.useEffect(() => {
    loadHubs();
  }, []);

  React.useEffect(() => {
    if (selectedHub) loadProjects(selectedHub);
  }, [selectedHub]);

  React.useEffect(() => {
    if (selectedHub && selectedProject) {
      loadTopFolders(selectedHub, selectedProject);
    } else {
      setTopFolders([]);
      setChildrenMap(new Map());
      setSelectedItems({});
      setJobs([]);
      setRuns([]);
    }
  }, [selectedHub, selectedProject]);

  // Auto-refresh pendant les runs
  React.useEffect(() => {
    if (!selectedProject) return;
    const hasRunningRuns = runs.some((r) => r.status === 'running' || r.status === 'queued');
    const hasRunningJobs = jobs.some((j) => j.status === 'running');
    if (!hasRunningRuns && !hasRunningJobs) return;

    const interval = setInterval(() => {
      refreshRuns();
      refreshJobs();
    }, 3000);

    return () => clearInterval(interval);
  }, [selectedProject, runs, jobs]);

  const selectedArray = Object.entries(selectedItems).map(([id, node]) => ({
    id,
    name: nameOf(node, id),
  }));

  const filteredProjects = React.useMemo(() => {
    const sorted = [...projects].sort((a, b) => {
      const nameA = nameOf(a, idOf(a)).toLowerCase();
      const nameB = nameOf(b, idOf(b)).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    if (!projectSearch.trim()) return sorted;

    const query = projectSearch.trim().toLowerCase();
    const filtered = sorted.filter((p) => nameOf(p, idOf(p)).toLowerCase().includes(query));

    if (selectedProject && !filtered.some((p) => idOf(p) === selectedProject)) {
      const current = projects.find((p) => idOf(p) === selectedProject);
      if (current) filtered.unshift(current);
    }

    return filtered;
  }, [projects, projectSearch, selectedProject]);

  const timezoneOptions = React.useMemo(() => {
    const base = [...TIMEZONE_OPTIONS];
    if (timezone && !base.some((option) => option.value === timezone)) {
      base.push({ value: timezone, label: `🌐 ${timezone}` });
    }
    return base;
  }, [timezone]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        padding: '40px 20px',
      }}
    >
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 700,
              background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom: 8,
            }}
          >
            🚀 APS Model Publisher
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 16 }}>
            Automatise la publication de tes maquettes Revit vers ACC
          </p>
        </div>

        {/* Toast */}
        {toast && (
          <div
            style={{
              position: 'fixed',
              top: 20,
              right: 20,
              background: 'rgba(17, 24, 39, 0.95)',
              backdropFilter: 'blur(12px)',
              color: '#fff',
              padding: '12px 20px',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              zIndex: 1000,
              fontSize: 14,
              fontWeight: 500,
              border: '1px solid rgba(148, 163, 184, 0.2)',
            }}
          >
            {toast}
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              background: 'rgba(220, 38, 38, 0.1)',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              color: '#fca5a5',
              padding: '12px 16px',
              borderRadius: 12,
              marginBottom: 20,
              fontSize: 14,
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {/* Grid Layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
          {/* Hub */}
          <Card title="🏢 Hub">
            {loadingHubs ? (
              <p style={{ color: '#6b7280' }}>Chargement...</p>
            ) : (
              <select
                value={selectedHub}
                onChange={(e) => setSelectedHub(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'rgba(248, 250, 252, 0.8)',
                  fontSize: 14,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {hubs.map((h) => (
                  <option key={idOf(h)} value={idOf(h)}>
                    {nameOf(h, idOf(h))}
                  </option>
                ))}
              </select>
            )}
          </Card>

          {/* Projet */}
          <Card title="📁 Projet">
            {loadingProjects ? (
              <p style={{ color: '#6b7280' }}>Chargement...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  type="search"
                  placeholder="🔍 Rechercher un projet..."
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    background: 'rgba(248, 250, 252, 0.8)',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
                <div
                  style={{
                    maxHeight: 280,
                    overflowY: 'auto',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: 10,
                    background: 'rgba(248, 250, 252, 0.5)',
                  }}
                >
                  {filteredProjects.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                      Aucun projet trouvé
                    </div>
                  ) : (
                    filteredProjects.map((p) => {
                      const projectId = idOf(p);
                      const isSelected = projectId === selectedProject;
                      return (
                        <button
                          key={projectId}
                          type="button"
                          onClick={() => setSelectedProject(projectId)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '12px 16px',
                            background: isSelected ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
                            color: isSelected ? '#1d4ed8' : '#1f2937',
                            fontWeight: isSelected ? 600 : 400,
                            fontSize: 14,
                            border: 'none',
                            borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                            outline: 'none',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'rgba(148, 163, 184, 0.08)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <span>{nameOf(p, projectId)}</span>
                          {isSelected && <span style={{ fontSize: 12, color: '#2563eb' }}>✓ Sélectionné</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Arbre fichiers */}
        <Card title="📂 Fichiers du projet" style={{ marginBottom: 24 }}>
          {!selectedProject ? (
            <p style={{ color: '#6b7280' }}>Sélectionne un projet</p>
          ) : loadingTop ? (
            <p style={{ color: '#6b7280' }}>Chargement...</p>
          ) : topFolders.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>Aucun dossier</p>
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {topFolders.map((f) => (
                <TreeNode
                  key={idOf(f)}
                  node={f}
                  projectId={selectedProject}
                  onLoadChildren={loadChildren}
                  childrenMap={childrenMap}
                  selected={selectedItems}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Sélection */}
        <Card title={`✅ Maquettes sélectionnées (${selectedArray.length})`} style={{ marginBottom: 24 }}>
          {selectedArray.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>Aucune sélection</p>
          ) : (
            <>
              <div style={{ marginBottom: 16, maxHeight: 150, overflowY: 'auto' }}>
                {selectedArray.map(({ id, name }) => (
                  <div
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'rgba(239, 246, 255, 0.6)',
                      borderRadius: 8,
                      marginBottom: 8,
                      border: '1px solid rgba(37, 99, 235, 0.2)',
                    }}
                  >
                    <RevitIcon />
                    <span style={{ fontSize: 14, color: '#1f2937' }}>{name}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 160px', minWidth: 180 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    Heure de publication
                  </label>
                  <select
                    value={selectedHour}
                    onChange={(e) => setSelectedHour(e.target.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      background: 'rgba(248, 250, 252, 0.9)',
                      fontSize: 14,
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {HOUR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 220px', minWidth: 220 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    Fuseau horaire
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      background: 'rgba(248, 250, 252, 0.9)',
                      fontSize: 14,
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {timezoneOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    Fuseau détecté : <strong>{DEFAULT_TIMEZONE}</strong>
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Button onClick={handlePlanifier} style={{ padding: '12px 24px' }}>
                    🚀 Planifier
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* Jobs */}
        <Card title="⚙️ Mes jobs" style={{ marginBottom: 24 }}>
          {!selectedProject ? (
            <p style={{ color: '#9ca3af' }}>Sélectionne un projet</p>
          ) : loadingJobs ? (
            <p style={{ color: '#6b7280' }}>Chargement...</p>
          ) : jobs.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>Aucun job</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid rgba(148, 163, 184, 0.2)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 13, fontWeight: 600, color: '#475569' }}>ID</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 13, fontWeight: 600, color: '#475569' }}>Maquettes</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 13, fontWeight: 600, color: '#475569' }}>Heure planifiée</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 13, fontWeight: 600, color: '#475569' }}>Fuseau horaire</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 13, fontWeight: 600, color: '#475569' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 13, fontWeight: 600, color: '#475569' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const cronParts = typeof j.cronExpression === 'string' ? j.cronExpression.trim().split(/\s+/) : [];
                    const minutePart = cronParts[0];
                    const hourPart = cronParts[1];
                    const isSimpleTime = /^\d+$/.test(hourPart || '') && /^\d+$/.test(minutePart || '');
                    const displayTime = isSimpleTime
                      ? `${hourPart.padStart(2, '0')}:${minutePart.padStart(2, '0')}`
                      : 'Planification personnalisée';

                    return (
                      <tr key={j.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        <td style={{ padding: '10px 8px', fontSize: 13, fontFamily: 'monospace', color: '#6b7280' }}>
                          {String(j.id).slice(0, 8)}
                        </td>
                        <td style={{ padding: '10px 8px', fontSize: 14, fontWeight: 500 }}>
                          {Array.isArray(j.models) ? j.models.length : 0}
                        </td>
                        <td style={{ padding: '10px 8px', fontSize: 14, fontWeight: 500 }}>
                          🕐 {displayTime}
                        </td>
                        <td style={{ padding: '10px 8px', fontSize: 13, color: '#475569' }}>
                          {j.timezone || 'UTC'}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              background: j.status === 'running' ? 'rgba(251, 146, 60, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                              color: j.status === 'running' ? '#ea580c' : '#16a34a',
                            }}
                          >
                            {j.status || 'idle'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Button
                              variant="secondary"
                              onClick={() => handleToggleActive(j)}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              {j.scheduleEnabled ? 'Pause' : 'Activer'}
                            </Button>
                            <Button
                              variant="primary"
                              onClick={() => handleRunNow(j)}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              ▶️
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => handleDelete(j)}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              🗑️
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Historique */}
        <Card title="📊 Historique des publications">
          {!selectedProject ? (
            <p style={{ color: '#9ca3af' }}>Sélectionne un projet</p>
          ) : loadingRuns ? (
            <p style={{ color: '#6b7280' }}>Chargement...</p>
          ) : runs.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>Aucune publication</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: '2px solid rgba(148, 163, 184, 0.2)',
                      background: 'rgba(248, 250, 252, 0.5)',
                    }}
                  >
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Job
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Début
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Fin
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Durée
                    </th>
                    <th
                      style={{
                        textAlign: 'center',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Fichiers
                    </th>
                    <th
                      style={{
                        textAlign: 'center',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Succès
                    </th>
                    <th
                      style={{
                        textAlign: 'center',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Échecs
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '12px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                      }}
                    >
                      Statut
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, index) => {
                    const okCount = r.stats?.okCount ?? 0;
                    const failCount = r.stats?.failCount ?? 0;
                    const totalFiles = Array.isArray(r.items) ? r.items.length : 0;

                    let durationText = '-';
                    if (r.stats?.durationMs) {
                      const seconds = Math.round(r.stats.durationMs / 1000);
                      durationText = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
                    }

                    let statusColor = '#6b7280';
                    let statusBg = 'rgba(156, 163, 175, 0.15)';
                    if (r.status === 'success') {
                      statusColor = '#059669';
                      statusBg = 'rgba(5, 150, 105, 0.15)';
                    }
                    if (r.status === 'failed') {
                      statusColor = '#dc2626';
                      statusBg = 'rgba(220, 38, 38, 0.15)';
                    }
                    if (r.status === 'running') {
                      statusColor = '#f59e0b';
                      statusBg = 'rgba(245, 158, 11, 0.15)';
                    }

                    return (
                      <tr
                        key={r.id}
                        style={{
                          background:
                            r.status === 'running'
                              ? 'rgba(254, 243, 199, 0.3)'
                              : index % 2 === 0
                              ? 'rgba(248, 250, 252, 0.3)'
                              : 'transparent',
                          borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
                        }}
                      >
                        <td
                          style={{
                            padding: '12px',
                            fontSize: 13,
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString('fr-CA') : '-'}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: '#6b7280',
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          {String(r.jobId).slice(0, 8)}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            fontSize: 13,
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          {r.startedAt ? new Date(r.startedAt).toLocaleTimeString('fr-CA') : '-'}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            fontSize: 13,
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          {r.endedAt
                            ? new Date(r.endedAt).toLocaleTimeString('fr-CA')
                            : r.status === 'running'
                            ? '⏳ en cours...'
                            : '-'}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            fontWeight: 500,
                            fontSize: 13,
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          {durationText}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            textAlign: 'center',
                            fontWeight: 600,
                            fontSize: 14,
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          {totalFiles}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            textAlign: 'center',
                            color: '#059669',
                            fontWeight: 700,
                            fontSize: 15,
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          {okCount}
                        </td>
                        <td
                          style={{
                            padding: '12px',
                            textAlign: 'center',
                            color: failCount > 0 ? '#dc2626' : '#cbd5e1',
                            fontWeight: 700,
                            fontSize: 15,
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          {failCount}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '4px 12px',
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 600,
                              color: statusColor,
                              background: statusBg,
                            }}
                          >
                            {r.status === 'running' && '🔄'}
                            {r.status === 'success' && '✅'}
                            {r.status === 'failed' && '❌'}
                            {r.status}
                          </span>
                          {r.message && (
                            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{r.message}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
