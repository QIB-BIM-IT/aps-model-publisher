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

  async function loadProjects(hubId) {
    if (!hubId) { setProjects([]); setSelectedProject(''); return; }
    setLoadingProjects(true); setError('');
    try {
      const data = await fetchProjects(hubId);
      setProjects(data);
      setSelectedProject(data.length ? idOf(data[0]) : '');
      setProjectSearch('');
    } catch (e) { setError(e?.message || 'Erreur lors du chargement des projets'); }
    finally { setLoadingProjects(false); }
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
    setChildrenMap((m) => new Map(m.set(folderId, 'loading')));
    try {
      const data = await fetchFolderContents(selectedProject, folderId);
      setChildrenMap((m) => new Map(m.set(folderId, data)));
    } catch (e) {
      setChildrenMap((m) => new Map(m.set(folderId, [])));
      setError(e?.message || 'Erreur lors du chargement du dossier');
    }
  }

  function toggleSelect(itemId, node) {
    setSelectedItems((prev) => {
      const nxt = { ...prev };
      if (nxt[itemId]) delete nxt[itemId];
      else nxt[itemId] = node;
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
    const items = Object.keys(selectedItems);
    if (!selectedHub || !selectedProject || items.length === 0) {
      setToast('Sélectionne au moins une maquette RVT.');
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
    await runPublishJobNow(job.id);
    // on recharge l’historique après un petit délai
    setTimeout(refreshRuns, 400);
  }
  async function handleDelete(job) {
    await deletePublishJob(job.id);
    await Promise.all([refreshJobs(), refreshRuns()]);
  }

  React.useEffect(() => { loadHubs(); }, []);
  React.useEffect(() => { if (selectedHub) loadProjects(selectedHub); }, [selectedHub]);
  React.useEffect(() => { if (selectedHub && selectedProject) loadTopFolders(selectedHub, selectedProject); }, [selectedProject]);

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

  return (
    <div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
            <input
              type="search"
              placeholder="Rechercher un projet…"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              style={{ padding: 8 }}
            />
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} style={{ padding: 8 }}>
              {filteredProjects.map((p) => (
                <option key={idOf(p)} value={idOf(p)}>{nameOf(p, idOf(p))}</option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Arbre fichiers */}
      <section>
        <h3>Fichiers du projet</h3>
        {loadingTop ? (
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
        {loadingJobs ? (
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
        <h3>Historique (dernier 50)</h3>
        {loadingRuns ? (
          <div>Chargement…</div>
        ) : runs.length === 0 ? (
          <div>Aucun run pour ce projet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Run</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Job</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Début</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Fin</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Durée</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Fichiers</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 8 }}>{String(r.id).slice(0, 8)}</td>
                  <td style={{ padding: 8 }}>{String(r.jobId).slice(0, 8)}</td>
                  <td style={{ padding: 8 }}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : '-'}</td>
                  <td style={{ padding: 8 }}>{r.endedAt ? new Date(r.endedAt).toLocaleString() : '-'}</td>
                  <td style={{ padding: 8 }}>
                    {r.stats?.durationMs ? `${Math.round(r.stats.durationMs)} ms` : '-'}
                  </td>
                  <td style={{ padding: 8 }}>
                    {Array.isArray(r.items) ? r.items.length : 0}
                  </td>
                  <td style={{ padding: 8 }}>
                    {r.status}
                    {r.status === 'failed' && r.message ? ` — ${r.message}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
