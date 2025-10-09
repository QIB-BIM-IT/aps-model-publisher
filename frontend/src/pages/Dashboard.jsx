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

// ---------- helpers ----------
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
      title="Revit"
      style={{
        display: 'inline-flex', width: 16, height: 16, borderRadius: 3,
        alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, marginRight: 6,
        background: '#1E6BD6', color: 'white', lineHeight: 1,
      }}
    >R</span>
  );
}

function HistoriqueTable({ runs }) {
  const [sortField, setSortField] = React.useState('createdAt');
  const [sortDirection, setSortDirection] = React.useState('desc');

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedRuns = React.useMemo(() => {
    return [...runs].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (sortField === 'stats.okCount') {
        aVal = a.stats?.okCount ?? 0;
        bVal = b.stats?.okCount ?? 0;
      }
      if (sortField === 'stats.failCount') {
        aVal = a.stats?.failCount ?? 0;
        bVal = b.stats?.failCount ?? 0;
      }
      if (sortField === 'stats.durationMs') {
        aVal = a.stats?.durationMs ?? 0;
        bVal = b.stats?.durationMs ?? 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [runs, sortField, sortDirection]);

  const SortableHeader = ({ field, children }) => (
    <th
      onClick={() => handleSort(field)}
      style={{
        textAlign: 'left',
        borderBottom: '2px solid #ddd',
        padding: '12px 8px',
        cursor: 'pointer',
        userSelect: 'none',
        background: sortField === field ? '#f0f9ff' : 'transparent',
        fontWeight: 600,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {children}
        {sortField === field && (
          <span style={{ fontSize: 12 }}>
            {sortDirection === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </th>
  );

  return (
    <table
      style={{
        borderCollapse: 'collapse',
        width: '100%',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <thead style={{ background: '#f9fafb' }}>
        <tr>
          <SortableHeader field="createdAt">Date</SortableHeader>
          <SortableHeader field="jobId">Job</SortableHeader>
          <SortableHeader field="startedAt">Début</SortableHeader>
          <SortableHeader field="endedAt">Fin</SortableHeader>
          <SortableHeader field="stats.durationMs">Durée</SortableHeader>
          <SortableHeader field="items">Fichiers</SortableHeader>
          <SortableHeader field="stats.okCount">Succès</SortableHeader>
          <SortableHeader field="stats.failCount">Échecs</SortableHeader>
          <SortableHeader field="status">Statut</SortableHeader>
        </tr>
      </thead>
      <tbody>
        {sortedRuns.map((r, index) => {
          const okCount = r.stats?.okCount ?? 0;
          const failCount = r.stats?.failCount ?? 0;
          const totalFiles = Array.isArray(r.items) ? r.items.length : 0;

          let durationText = '-';
          if (r.stats?.durationMs) {
            const seconds = Math.round(r.stats.durationMs / 1000);
            durationText =
              seconds < 60
                ? `${seconds}s`
                : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
          }

          let statusColor = '#666';
          if (r.status === 'success') statusColor = '#0a6';
          if (r.status === 'failed') statusColor = '#c33';
          if (r.status === 'running') statusColor = '#fa0';

          return (
            <tr
              key={r.id}
              style={{
                background: index % 2 === 0 ? '#fff' : '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <td style={{ padding: '10px 8px' }}>
                {r.createdAt
                  ? new Date(r.createdAt).toLocaleDateString('fr-CA')
                  : '-'}
              </td>
              <td
                style={{
                  padding: '10px 8px',
                  fontSize: 13,
                  fontFamily: 'monospace',
                  color: '#6b7280',
                }}
              >
                {String(r.jobId).slice(0, 8)}
              </td>
              <td style={{ padding: '10px 8px', fontSize: 14 }}>
                {r.startedAt
                  ? new Date(r.startedAt).toLocaleTimeString('fr-CA')
                  : '-'}
              </td>
              <td style={{ padding: '10px 8px', fontSize: 14 }}>
                {r.endedAt
                  ? new Date(r.endedAt).toLocaleTimeString('fr-CA')
                  : r.status === 'running'
                  ? '⏳ en cours...'
                  : '-'}
              </td>
              <td style={{ padding: '10px 8px', fontWeight: 500 }}>{durationText}</td>
              <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 500 }}>
                {totalFiles}
              </td>
              <td
                style={{
                  padding: '10px 8px',
                  textAlign: 'center',
                  color: '#059669',
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {okCount}
              </td>
              <td
                style={{
                  padding: '10px 8px',
                  textAlign: 'center',
                  color: failCount > 0 ? '#dc2626' : '#9ca3af',
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {failCount}
              </td>
              <td style={{ padding: '10px 8px' }}>
                <span
                  style={{
                    color: statusColor,
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 14,
                  }}
                >
                  {r.status === 'running' && '🔄'}
                  {r.status === 'success' && '✅'}
                  {r.status === 'failed' && '❌'}
                  {r.status}
                </span>
                {r.message && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    {r.message}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------- Tree node ----------
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
    <div style={{ marginLeft: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {isFolder(node) ? (
          <button onClick={toggle} style={{ cursor: 'pointer', width: 22 }}>
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span style={{ width: 22 }} />
        )}
        {selectable && (
          <input type="checkbox" checked={checked} onChange={() => onToggleSelect(id, node)} />
        )}
        {isItem(node) && isRvt(node) && <RevitIcon />}
        <span>{nm}</span>
      </div>

      {expanded && (
        <div style={{ marginLeft: 8 }}>
          {loading && <div>Chargement…</div>}
          {!loading && Array.isArray(kids) && kids.length === 0 && (
            <div style={{ color: '#666' }}>(vide)</div>
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

// ---------- Page ----------
export default function Dashboard() {
  const [hubs, setHubs] = React.useState([]);
  const [selectedHub, setSelectedHub] = React.useState('');
  const [projects, setProjects] = React.useState([]);
  const [selectedProject, setSelectedProject] = React.useState('');
  const [projectSearch, setProjectSearch] = React.useState('');

  const [topFolders, setTopFolders] = React.useState([]);
  const [childrenMap, setChildrenMap] = React.useState(new Map()); // folderId -> children[] | 'loading'
  const [selectedItems, setSelectedItems] = React.useState({}); // itemId -> node

  const [jobs, setJobs] = React.useState([]);
  const [loadingJobs, setLoadingJobs] = React.useState(false);

  const [runs, setRuns] = React.useState([]);
  const [loadingRuns, setLoadingRuns] = React.useState(false);

  const [loadingHubs, setLoadingHubs] = React.useState(false);
  const [loadingProjects, setLoadingProjects] = React.useState(false);
  const [loadingTop, setLoadingTop] = React.useState(false);

  const [cronExpression, setCronExpression] = React.useState('0 2 * * *');
  const [timezone, setTimezone] = React.useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [error, setError] = React.useState('');
  const [toast, setToast] = React.useState('');

  async function loadHubs() {
    setLoadingHubs(true); setError('');
    try {
      const data = await fetchHubs();
      setHubs(data);
      if (data.length) setSelectedHub(idOf(data[0]));
    } catch (e) { setError(e?.message || 'Erreur lors du chargement des hubs'); }
    finally { setLoadingHubs(false); }
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
      setError(e?.message || 'Erreur lors du chargement des projets');
    } finally {
      setLoadingProjects(false);
    }
  }

  async function loadTopFolders(hubId, projectId) {
    if (!hubId || !projectId) { setTopFolders([]); return; }
    setLoadingTop(true); setError(''); setChildrenMap(new Map()); setSelectedItems({});
    try {
      const data = await fetchTopFolders(hubId, projectId);
      setTopFolders(data);
      await Promise.all([refreshJobs(), refreshRuns()]);
    } catch (e) { setError(e?.message || 'Erreur lors du chargement des dossiers'); }
    finally { setLoadingTop(false); }
  }

  async function loadChildren(folderId) {
    console.log('📁 FOLDER ID:', folderId);
    setChildrenMap((m) => new Map(m.set(folderId, 'loading')));
    try {
      const data = await fetchFolderContents(selectedProject, folderId);
      console.log('📦 FOLDER CONTENTS:', JSON.stringify(data, null, 2));
      setChildrenMap((m) => new Map(m.set(folderId, data)));
    } catch (e) {
      setChildrenMap((m) => new Map(m.set(folderId, [])));
      setError(e?.message || 'Erreur lors du chargement du dossier');
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
      setError(e?.message || 'Erreur chargement jobs');
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
      setError(e?.message || 'Erreur chargement historique');
    } finally {
      setLoadingRuns(false);
    }
  }

  async function handlePlanifier() {
    console.log('🔍 selectedItems avant extraction:', selectedItems);
    const items = Object.values(selectedItems).map((item) => item.publishUrn);
    console.log('📤 URNs à envoyer:', items);
    console.log('📤 Premier URN:', items[0]);
    if (!selectedHub || !selectedProject || items.length === 0) {
      setToast('Sélectionne au moins une maquette RVT.');
      return;
    }
    console.log('📤 Envoi des URNs pour publish:', items);
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
      setToast('Job créé 🎉');
      setSelectedItems({});
      await Promise.all([refreshJobs(), refreshRuns()]);
    } catch (e) {
      setToast(e?.message || 'Erreur création du job');
    }
  }

  async function handleToggleActive(job) {
    await patchPublishJob(job.id, { scheduleEnabled: !job.scheduleEnabled });
    await refreshJobs();
  }
  async function handleRunNow(job) {
    try {
      const run = await runPublishJobNow(job.id);

      if (run && run.id) {
        const pendingRun = { ...run, status: 'pending' };
        setRuns((prev) => {
          const without = prev.filter((r) => r.id !== pendingRun.id);
          return [pendingRun, ...without];
        });

        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: 'running',
                  lastRun: new Date().toISOString(),
                }
              : j
          )
        );
      }

      // on recharge l’historique après un petit délai
      setTimeout(refreshRuns, 400);
    } catch (e) {
      setToast(e?.message || 'Erreur lancement du job');
    }
  }
  async function handleDelete(job) {
    await deletePublishJob(job.id);
    await Promise.all([refreshJobs(), refreshRuns()]);
  }

  React.useEffect(() => { loadHubs(); }, []);
  React.useEffect(() => { if (selectedHub) loadProjects(selectedHub); }, [selectedHub]);
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

  const selectedArray = Object.entries(selectedItems).map(([id, node]) => ({ id, name: nameOf(node, id) }));

  const filteredProjects = React.useMemo(() => {
    if (!projectSearch.trim()) return projects;
    const query = projectSearch.trim().toLowerCase();
    const filtered = projects.filter((p) => nameOf(p, idOf(p)).toLowerCase().includes(query));
    if (selectedProject && !filtered.some((p) => idOf(p) === selectedProject)) {
      const current = projects.find((p) => idOf(p) === selectedProject);
      if (current) filtered.unshift(current);
    }
    return filtered;
  }, [projects, projectSearch, selectedProject]);

  const projectStyles = `
    #project-search-input::placeholder { color: #9ca3af; opacity: 1; }
    #project-search-input::-ms-input-placeholder { color: #9ca3af; }
    #project-search-input:-ms-input-placeholder { color: #9ca3af; }
    #project-search-input:focus {
      border-color: #2563eb !important;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
    }
    .project-option[aria-selected="true"] {
      background: #eef2ff !important;
      color: #1d4ed8 !important;
      font-weight: 600 !important;
    }
    .project-option:not([aria-selected="true"]):hover {
      background: #f3f4f6 !important;
    }
    .project-option:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
  `;

  return (
    <div>
      <style>{projectStyles}</style>
      <h2>Explorateur ACC</h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {toast && <p style={{ color: '#0a6', fontWeight: 600 }}>{toast}</p>}

      {/* Hubs */}
      <section style={{ marginBottom: 16 }}>
        <h3>Hubs</h3>
        {loadingHubs ? (
          <p>Chargement des hubs…</p>
        ) : (
          <select value={selectedHub} onChange={(e) => setSelectedHub(e.target.value)} style={{ padding: 8, minWidth: 360 }}>
            {hubs.map((h) => (
              <option key={idOf(h)} value={idOf(h)}>{nameOf(h, idOf(h))}</option>
            ))}
          </select>
        )}
      </section>

      {/* Projets */}
      <section style={{ marginBottom: 16 }}>
        <h3>Projets</h3>
        {loadingProjects ? (
          <p>Chargement des projets…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 580 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                border: '1px solid #d0d7de',
                borderRadius: 16,
                padding: 20,
                background: '#f9fafb',
                boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>
                  Choisis un projet
                </div>
                <div style={{ position: 'relative', flex: '0 0 280px', minWidth: 220 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: 14,
                      transform: 'translateY(-50%)',
                      color: '#6b7280',
                      fontSize: 16,
                    }}
                  >
                    🔍
                  </span>
                  <input
                    id="project-search-input"
                    type="search"
                    placeholder="Search projects by name or number…"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px 10px 40px',
                      borderRadius: 999,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      color: '#111827',
                      fontSize: 15,
                      outline: 'none',
                      boxShadow: '0 1px 2px rgba(15,23,42,0.08)',
                      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                    }}
                  />
                </div>
              </div>
              <div
                role="listbox"
                aria-label="Liste des projets"
                style={{
                  maxHeight: 280,
                  overflowY: 'auto',
                  borderRadius: 12,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                }}
              >
                {filteredProjects.length === 0 ? (
                  <div style={{ padding: 16, color: '#6b7280', textAlign: 'center' }}>
                    Aucun projet ne correspond à cette recherche.
                  </div>
                ) : (
                  filteredProjects.map((p, index) => {
                    const projectId = idOf(p);
                    const selected = projectId === selectedProject;
                    const isLast = index === filteredProjects.length - 1;
                    return (
                      <button
                        key={projectId}
                        type="button"
                        onClick={() => setSelectedProject(projectId)}
                        role="option"
                        aria-selected={selected}
                        className="project-option"
                        style={{
                          width: '100%',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          padding: '12px 16px',
                          background: selected ? '#eef2ff' : 'transparent',
                          color: selected ? '#1d4ed8' : '#111827',
                          fontWeight: selected ? 600 : 500,
                          border: 'none',
                          borderBottom: isLast ? 'none' : '1px solid #f3f4f6',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: 15,
                          transition: 'background 0.15s ease, color 0.15s ease',
                        }}
                      >
                        <span>{nameOf(p, projectId)}</span>
                        {selected && <span style={{ fontSize: 12 }}>Sélectionné</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Arbre fichiers */}
      <section>
        <h3>Fichiers du projet</h3>
        {!selectedProject ? (
          <p>Sélectionne un projet pour afficher ses dossiers.</p>
        ) : loadingTop ? (
          <p>Chargement des dossiers…</p>
        ) : topFolders.length === 0 ? (
          <p>Aucun dossier trouvé.</p>
        ) : (
          <div>
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
      </section>

      {/* Sélection + planification */}
      <section style={{ marginTop: 16 }}>
        <h4>Maquettes sélectionnées ({selectedArray.length})</h4>
        {selectedArray.length === 0 ? (
          <div>Aucune sélection.</div>
        ) : (
          <>
            <ul>
              {selectedArray.map(({ id, name }) => (
                <li key={id}><RevitIcon />{name}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <label>
                CRON:&nbsp;
                <input value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} style={{ padding: 6, width: 160 }} />
              </label>
              <label>
                Timezone:&nbsp;
                <input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ padding: 6, width: 220 }} />
              </label>
              <button onClick={handlePlanifier} style={{ padding: '8px 14px', cursor: 'pointer' }}>
                Planifier la publication
              </button>
            </div>
          </>
        )}
      </section>

      {/* Mes jobs */}
      <section style={{ marginTop: 24 }}>
        <h3>Mes jobs</h3>
        {!selectedProject ? (
          <div>Sélectionne un projet pour voir les jobs planifiés.</div>
        ) : loadingJobs ? (
          <div>Chargement…</div>
        ) : jobs.length === 0 ? (
          <div>Aucun job pour ce projet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>ID</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Maquettes</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>CRON</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>TZ</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Dernier run</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Status</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td style={{ padding: 8 }}>{String(j.id).slice(0, 8)}</td>
                  <td style={{ padding: 8 }}>{Array.isArray(j.models) ? j.models.length : 0}</td>
                  <td style={{ padding: 8 }}>{j.cronExpression}</td>
                  <td style={{ padding: 8 }}>{j.timezone}</td>
                  <td style={{ padding: 8 }}>{j.lastRun ? new Date(j.lastRun).toLocaleString() : '-'}</td>
                  <td style={{ padding: 8 }}>{j.status || '-'}</td>
                  <td style={{ padding: 8, display: 'flex', gap: 8 }}>
                    <button onClick={() => handleToggleActive(j)} style={{ padding: '4px 8px' }}>
                      {j.scheduleEnabled ? 'Désactiver' : 'Activer'}
                    </button>
                    <button onClick={() => handleRunNow(j)} style={{ padding: '4px 8px' }}>
                      Run now
                    </button>
                    <button onClick={() => handleDelete(j)} style={{ padding: '4px 8px', color: 'crimson' }}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Historique des exécutions */}
      <section style={{ marginTop: 24 }}>
        <h3>Historique des publications</h3>
        {!selectedProject ? (
          <div>Sélectionne un projet pour consulter l'historique.</div>
        ) : loadingRuns ? (
          <div>Chargement…</div>
        ) : runs.length === 0 ? (
          <div>Aucune publication pour ce projet.</div>
        ) : (
          <HistoriqueTable runs={runs} />
        )}
      </section>
    </div>
  );
}
