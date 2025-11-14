import React from 'react';
import { useLocation } from 'react-router-dom';
import api, {
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
  createPDFExportJob,
  getPDFExportJobs,
  deletePDFExportJob,
  patchPDFExportJob,
  runPDFExportJobNow,
  getPDFExportRuns,
  exportPDFsFromCache,
} from '../services/api';
import { PDFExportModal } from '../components/PDFExportModal';

// Helpers
function nameOf(node, fall = '') {
  if (!node) return fall;
  const a = node?.attributes || {};
  return (
    a.displayName ||
    a.name ||
    node?.name ||
    node?.hubName ||
    node?.projectName ||
    fall
  );
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

function mergeRuns(publishList = [], pdfList = []) {
  const normalizedPublish = Array.isArray(publishList)
    ? publishList.map((run) => ({ ...run, jobType: run.jobType || 'publish' }))
    : [];
  const normalizedPdf = Array.isArray(pdfList)
    ? pdfList.map((run) => ({ ...run, jobType: 'pdf-export' }))
    : [];

  return [...normalizedPublish, ...normalizedPdf].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.startedAt || 0).getTime();
    const dateB = new Date(b.createdAt || b.startedAt || 0).getTime();
    return dateB - dateA;
  });
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

const DAY_OF_WEEK_OPTIONS = [
  { value: 0, label: 'Dimanche' },
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
];

/**
 * Génère une expression cron selon la récurrence choisie
 * @param {string} recurrenceType - 'daily' ou 'weekly'
 * @param {string} hour - Format 'HH:MM'
 * @param {number} dayOfWeek - 0-6 (0=dimanche, 6=samedi)
 * @returns {string} Expression cron
 */
function generateCronExpression(recurrenceType, hour, dayOfWeek = 1) {
  const [hourStr, minuteStr] = hour.split(':');
  const minute = minuteStr || '0';
  
  if (recurrenceType === 'weekly') {
    // Format: minute hour * * dayOfWeek
    return `${minute} ${hourStr} * * ${dayOfWeek}`;
  } else {
    // Format: minute hour * * * (daily)
    return `${minute} ${hourStr} * * *`;
  }
}

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
            onChange={() => {
              const itemData = {
                ...node,
                publishUrn: id,
              };
              onToggleSelect(id, itemData);
            }}
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
function Card({ children, title, style = {}, id }) {
  return (
    <div
      id={id}
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

export default function PlanningPage() {
  const location = useLocation();
  const [hubs, setHubs] = React.useState([]);
  const [selectedHub, setSelectedHub] = React.useState('');
  const [projects, setProjects] = React.useState([]);
  const [selectedProject, setSelectedProject] = React.useState('');
  const [projectSearch, setProjectSearch] = React.useState('');

  const [topFolders, setTopFolders] = React.useState([]);
  const [childrenMap, setChildrenMap] = React.useState(new Map());
  const [selectedItems, setSelectedItems] = React.useState({});
  const [jobType, setJobType] = React.useState(null);
  const [jobName, setJobName] = React.useState('');
  const [pdfExportJobs, setPdfExportJobs] = React.useState([]);

  // ✅ Configuration PDF (nouvelle)
  const [pdfSelectionMode, setPdfSelectionMode] = React.useState('all');
  const [pdfSelectedSheets, setPdfSelectedSheets] = React.useState([]);
  const [pdfExportMode, setPdfExportMode] = React.useState('individual');
  const [pdfMergedFileName, setPdfMergedFileName] = React.useState('Documents.pdf');
  const [pdfSheetsLoaded, setPdfSheetsLoaded] = React.useState(false);
  const [pdfAvailableSheets, setPdfAvailableSheets] = React.useState([]);
  const [pdfLoadingSheets, setPdfLoadingSheets] = React.useState(false);
  const [pdfCacheKey, setPdfCacheKey] = React.useState(null);

  const [jobs, setJobs] = React.useState([]);
  const [loadingJobs, setLoadingJobs] = React.useState(false);

  const [runs, setRuns] = React.useState([]);
  const publishRunsRef = React.useRef([]);
  const pdfRunsRef = React.useRef([]);
  const [loadingRuns, setLoadingRuns] = React.useState(false);

  const [autoRefreshActive, setAutoRefreshActive] = React.useState(false);
  const autoRefreshTimeoutRef = React.useRef(null);

  const [loadingHubs, setLoadingHubs] = React.useState(false);
  const [loadingProjects, setLoadingProjects] = React.useState(false);
  const [loadingTop, setLoadingTop] = React.useState(false);

  const [selectedHour, setSelectedHour] = React.useState('02:00');
  const [cronExpression, setCronExpression] = React.useState('0 2 * * *');
  const [timezone, setTimezone] = React.useState(DEFAULT_TIMEZONE);
  const [recurrenceType, setRecurrenceType] = React.useState('daily'); // 'daily' ou 'weekly'
  const [selectedDayOfWeek, setSelectedDayOfWeek] = React.useState(1); // 0=dimanche, 1=lundi, ..., 6=samedi
  const [error, setError] = React.useState('');
  const [toast, setToast] = React.useState('');

  // État pour le modal PDF
  const [showPDFModal, setShowPDFModal] = React.useState(false);
  const [isExportingPDF, setIsExportingPDF] = React.useState(false);

  const preSelectHub = location.state?.preSelectHub;
  const preSelectProject = location.state?.preSelectProject;
  const highlightJobId = location.state?.highlightJobId;
  const preselectHubApplied = React.useRef(false);
  const preselectProjectApplied = React.useRef(false);
  const appliedHighlightJob = React.useRef(null);

  // Définir primarySelectedKey avant les useEffect qui l'utilisent
  const primarySelectedKey = React.useMemo(() => {
    const keys = Object.keys(selectedItems);
    return keys[0] || null;
  }, [selectedItems]);

  React.useEffect(() => {
    appliedHighlightJob.current = null;
    preselectHubApplied.current = false;
    preselectProjectApplied.current = false;
  }, [location.key]);

  React.useEffect(() => {
    setCronExpression(generateCronExpression(recurrenceType, selectedHour, selectedDayOfWeek));
  }, [selectedHour, recurrenceType, selectedDayOfWeek]);

  async function loadHubs() {
    setLoadingHubs(true);
    setError('');
    try {
      const data = await fetchHubs();
      console.log('🏢 Hubs reçus:', data);
      console.log('🏢 Premier hub:', data?.[0]);
      setHubs(data);
      if (data.length) {
        if (preSelectHub && data.some((hub) => idOf(hub) === preSelectHub)) {
          // Hub pré-sélectionné trouvé
          setSelectedHub(preSelectHub);
          preselectHubApplied.current = true;
        } else if (!preSelectHub && preSelectProject) {
          // Pas de hub pré-sélectionné mais un projet oui : chercher le hub qui contient ce projet
          // Commencer avec le premier hub pour ne pas bloquer l'UI
          setSelectedHub(idOf(data[0]));
          
          // Chercher le bon hub en arrière-plan
          (async () => {
            let foundHub = null;
            for (const hub of data) {
              try {
                const projects = await fetchProjects(idOf(hub));
                if (projects.some((p) => idOf(p) === preSelectProject)) {
                  foundHub = idOf(hub);
                  break;
                }
              } catch (e) {
                // Continuer avec le hub suivant si erreur
                console.warn(`Erreur lors de la recherche du projet dans le hub ${idOf(hub)}:`, e);
              }
            }
            if (foundHub) {
              setSelectedHub(foundHub);
              preselectHubApplied.current = true;
            }
          })();
        } else {
          // Aucune pré-sélection : premier hub
          setSelectedHub(idOf(data[0]));
        }
      }
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
    setJobType(null);
    setJobName('');
    setPdfExportJobs([]);
    setJobs([]);
    setRuns([]);
    publishRunsRef.current = [];
    pdfRunsRef.current = [];
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
      console.log('📁 Projets reçus:', data);
      console.log('📁 Premier projet:', data?.[0]);
      setProjects(data);
      setProjectSearch('');
      if (data.length) {
        if (preSelectProject && data.some((project) => idOf(project) === preSelectProject)) {
          setSelectedProject(preSelectProject);
          preselectProjectApplied.current = true;
        } else {
          setSelectedProject(idOf(data[0]));
        }
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
      setPdfExportJobs([]);
      setRuns([]);
      publishRunsRef.current = [];
      pdfRunsRef.current = [];
      setJobType(null);
      setJobName('');
      return;
    }
    setLoadingTop(true);
    setError('');
    setChildrenMap(new Map());
    setSelectedItems({});
    setJobType(null);
    setJobName('');
    try {
      const data = await fetchTopFolders(hubId, projectId);
      setTopFolders(data);
      await Promise.all([refreshJobs(), refreshRuns(), refreshPdfJobs(), refreshPdfRuns()]);
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

  function toggleSelect(itemId, nodeData) {
    setSelectedItems((prev) => {
      const nxt = { ...prev };
      if (nxt[itemId]) {
        delete nxt[itemId];
      } else {
        if (jobType === 'pdf-export' && Object.keys(nxt).length > 0) {
          const firstKey = Object.keys(nxt)[0];
          delete nxt[firstKey];
        }
        nxt[itemId] = {
          ...nodeData,
          publishUrn: itemId,
        };
      }
      return nxt;
    });
  }

  const refreshJobs = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedHub || !selectedProject) return;

      if (!silent) setLoadingJobs(true);
      try {
        const list = await getPublishJobs({ hubId: selectedHub, projectId: selectedProject });
        setJobs(Array.isArray(list) ? list : []);
      } catch (e) {
        setError(e?.message || 'Erreur jobs');
      } finally {
        if (!silent) setLoadingJobs(false);
      }
    },
    [selectedHub, selectedProject]
  );

  const refreshPdfJobs = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedHub || !selectedProject) return;

      if (!silent) setLoadingJobs(true);
      try {
        const list = await getPDFExportJobs({ projectId: selectedProject });
        setPdfExportJobs(Array.isArray(list) ? list : []);
      } catch (e) {
        setError(e?.message || 'Erreur PDF jobs');
      } finally {
        if (!silent) setLoadingJobs(false);
      }
    },
    [selectedHub, selectedProject]
  );

  const refreshRuns = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedHub || !selectedProject) return;

      if (!silent) setLoadingRuns(true);
      try {
        const list = await getRuns({ hubId: selectedHub, projectId: selectedProject, limit: 50 });
        publishRunsRef.current = Array.isArray(list) ? list : [];
        setRuns(mergeRuns(publishRunsRef.current, pdfRunsRef.current));
      } catch (e) {
        setError(e?.message || 'Erreur historique');
      } finally {
        if (!silent) setLoadingRuns(false);
      }
    },
    [selectedHub, selectedProject]
  );

  const refreshPdfRuns = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedProject) return;

      if (!silent) setLoadingRuns(true);
      try {
        const list = await getPDFExportRuns({ projectId: selectedProject, limit: 50 });
        pdfRunsRef.current = Array.isArray(list) ? list : [];
        setRuns(mergeRuns(publishRunsRef.current, pdfRunsRef.current));
      } catch (e) {
        setError(e?.message || 'Erreur PDF runs');
      } finally {
        if (!silent) setLoadingRuns(false);
      }
    },
    [selectedProject]
  );

  const triggerAutoRefreshWindow = React.useCallback(
    (duration = 20000) => {
      setAutoRefreshActive(true);
      if (autoRefreshTimeoutRef.current) {
        clearTimeout(autoRefreshTimeoutRef.current);
      }
      autoRefreshTimeoutRef.current = setTimeout(() => {
        setAutoRefreshActive(false);
        autoRefreshTimeoutRef.current = null;
      }, duration);
    },
    []
  );

  // Fonction pour exporter immédiatement (Run Now)
  async function handleRunNowPDF(config) {
    const selectedFile = Object.values(selectedItems)[0];
    if (!selectedFile || !selectedProject) {
      setToast('⚠️ Sélectionne une maquette et un projet');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    if (!config.cacheKey) {
      setToast('⚠️ Cache expiré, recharge les sheets');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    if (!config.folderId) {
      setToast('⚠️ Sélectionne un dossier de destination');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    // Validation des sheets disponibles
    if (!config.availableSheets || !Array.isArray(config.availableSheets) || config.availableSheets.length === 0) {
      setToast('⚠️ Aucune sheet disponible, recharge les sheets');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    const selectedSheetNames =
      config.mode === 'custom'
        ? (config.customSheets || []).map((s) => (typeof s === 'string' ? s : s.name || s)).filter(Boolean)
        : (config.availableSheets || []).map((s) => (typeof s === 'string' ? s : s.name || s)).filter(Boolean);

    if (selectedSheetNames.length === 0) {
      setToast('⚠️ Aucune sheet sélectionnée');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    setIsExportingPDF(true);
    try {
      const result = await exportPDFsFromCache({
        cacheKey: config.cacheKey,
        projectId: selectedProject,
        folderId: config.folderId,
        selectedSheetNames,
        exportMode: config.merge ? 'combined' : 'individual',
        combinedFileName: config.merge ? config.mergedFileName : undefined,
      });

      const uploadLabel = config.merge ? 'PDF combiné' : 'PDF(s)';
      const successMessage =
        result.failed > 0
          ? `✅ ${result.uploaded} ${uploadLabel} exporté(s) (${result.failed} échec)`
          : `✅ ${result.uploaded} ${uploadLabel} exporté(s) vers ACC`;

      setToast(successMessage);
      setTimeout(() => setToast(''), 5000);
      
      // Ne pas fermer le modal automatiquement pour permettre un autre export
      // L'utilisateur peut fermer manuellement s'il le souhaite
      triggerAutoRefreshWindow();
      await refreshPdfRuns({ silent: true });
    } catch (e) {
      let errorMessage = e?.message || 'Erreur export';
      
      // Détecter si c'est une erreur de cache expiré
      if (errorMessage.toLowerCase().includes('cache') || errorMessage.toLowerCase().includes('expiré') || errorMessage.toLowerCase().includes('invalid')) {
        setToast('⚠️ Cache expiré, recharge les sheets dans le modal');
        setTimeout(() => setToast(''), 5000);
      } 
      // Détecter si c'est une erreur de sheets non disponibles ou de format URN
      else if (errorMessage.includes('ERR_NO_PROCESSABLE_FILES') || 
               errorMessage.includes('Aucune sheet publiée') ||
               errorMessage.includes('Vérifiez que la maquette')) {
        // Extraire seulement la partie utile du message (à partir de "Vérifiez")
        let displayMessage = errorMessage;
        const verifiezIndex = errorMessage.indexOf('Vérifiez');
        if (verifiezIndex !== -1) {
          displayMessage = errorMessage.substring(verifiezIndex);
        }
        // S'assurer qu'il y a un emoji warning
        if (!displayMessage.startsWith('⚠️')) {
          displayMessage = '⚠️ ' + displayMessage;
        }
        setToast(displayMessage);
        setTimeout(() => setToast(''), 7000);
      } 
      else {
        setToast('❌ ' + errorMessage);
        setTimeout(() => setToast(''), 5000);
      }
    } finally {
      setIsExportingPDF(false);
    }
  }

  // Fonction pour planifier la tâche (Schedule)
  async function handleSchedulePDF(config) {
    const selectedFile = Object.values(selectedItems)[0];
    if (!selectedFile) {
      setToast('⚠️ Sélectionne 1 maquette');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    if (!selectedProject) {
      setToast('⚠️ Sélectionne un projet');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    if (!config.jobName || !config.jobName.trim()) {
      setToast('⚠️ Donne un nom à la tâche');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    if (!config.folderId) {
      setToast('⚠️ Sélectionne un dossier de destination');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    const fileUrn = selectedFile?.publishUrn || selectedFile?.id;
    const fileName = selectedFile?.name;

    const projectObj = projects.find((p) => idOf(p) === selectedProject);
    const projectName = nameOf(projectObj, '');

    const selectedFolder = topFolders.find((f) => f.id === config.folderId) ||
      Array.from(childrenMap.values())
        .flat()
        .find((f) => f.id === config.folderId);

    try {
      const sheetsForJob =
        config.mode === 'custom' ? config.customSheets : [];

      // Utiliser la récurrence du config (depuis le modal) ou celle de la page principale
      const scheduleRecurrenceType = config.recurrenceType || recurrenceType;
      const scheduleDayOfWeek = config.selectedDayOfWeek !== undefined ? config.selectedDayOfWeek : selectedDayOfWeek;
      const scheduleHour = config.selectedHour || selectedHour;
      
      // Générer l'expression cron selon la récurrence
      const scheduleCronExpression = generateCronExpression(scheduleRecurrenceType, scheduleHour, scheduleDayOfWeek);
      const scheduleTimezone = config.timezone || timezone;

      await createPDFExportJob({
        name: config.jobName.trim(),
        projectId: selectedProject,
        projectName,
        folderId: config.folderId,
        folderName: selectedFolder?.attributes?.displayName || selectedFolder?.name || '',
        fileUrn,
        fileName,
        scheduleEnabled: true,
        cronExpression: scheduleCronExpression,
        timezone: scheduleTimezone,
        selectionMode: config.mode,
        selectedSheets: sheetsForJob,
        includeSheets: config.options?.includeSheets !== false,
        includeViews2D: config.options?.includeViews2D !== false,
        includeMarkups: config.options?.includeMarkups !== false,
        exportMode: config.merge ? 'combined' : 'individual',
        mergedFileName: config.merge ? config.mergedFileName : null,
        notifyOnFailure: true,
      });

      setToast('✅ Tâche PDF planifiée!');
      setTimeout(() => setToast(''), 3000);
      setJobName('');
      setJobType(null);
      setShowPDFModal(false);
      triggerAutoRefreshWindow();
      await Promise.all([refreshPdfJobs({ silent: true }), refreshPdfRuns({ silent: true })]);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleCreatePDFExportJob() {
    // Cette fonction n'est plus utilisée directement, mais conservée pour compatibilité
    // Le modal est maintenant ouvert via le bouton "Créer tâche PDF"
    const selectedFile = Object.values(selectedItems)[0];
    if (!selectedFile) {
      setToast('⚠️ Sélectionne 1 maquette');
      setTimeout(() => setToast(''), 3000);
      return;
    }
    setShowPDFModal(true);
  }

  async function handleCreatePublishJob() {
    const items = Object.values(selectedItems).map((item) => item.publishUrn);
    if (!selectedHub || !selectedProject || items.length === 0) {
      setToast('⚠️ Sélectionne au moins une maquette');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    if (!jobName.trim()) {
      setToast('⚠️ Donne un nom à la tâche');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    const hubObj = hubs.find((h) => idOf(h) === selectedHub);
    const projectObj = projects.find((p) => idOf(p) === selectedProject);
    const hubName = nameOf(hubObj, '');
    const projectName = nameOf(projectObj, '');

    try {
      await createPublishJob({
        name: jobName.trim(),
        hubId: selectedHub,
        hubName,
        projectId: selectedProject,
        projectName,
        items,
        scheduleEnabled: true,
        cronExpression,
        timezone,
        notifyOnFailure: true,
      });
      setToast('✅ Tâche Publish créée!');
      setTimeout(() => setToast(''), 3000);
      setJobName('');
      setJobType(null);
      setSelectedItems({});
      triggerAutoRefreshWindow();
      await Promise.all([
        refreshJobs({ silent: true }),
        refreshRuns({ silent: true }),
      ]);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleToggleActive(job) {
    await patchPublishJob(job.id, { scheduleEnabled: !job.scheduleEnabled });
    await refreshJobs({ silent: true });
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
      setTimeout(() => {
        void refreshRuns({ silent: true });
      }, 400);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur lancement'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleDelete(job) {
    if (!window.confirm('Supprimer ce job?')) return;
    await deletePublishJob(job.id);
    await Promise.all([
      refreshJobs({ silent: true }),
      refreshRuns({ silent: true }),
    ]);
  }

  async function handleTogglePdfJob(job) {
    try {
      await patchPDFExportJob(job.id, { scheduleEnabled: !job.scheduleEnabled });
      await refreshPdfJobs({ silent: true });
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur maj PDF'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleRunPdfJob(job) {
    try {
      await runPDFExportJobNow(job.id);
      setToast('🚀 Export PDF lancé!');
      setTimeout(() => setToast(''), 3000);
      triggerAutoRefreshWindow();
      await Promise.all([
        refreshPdfRuns({ silent: true }),
        refreshPdfJobs({ silent: true }),
      ]);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur lancement PDF'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleDeletePdfJob(job) {
    if (!window.confirm('Supprimer cette tâche PDF?')) return;
    try {
      await deletePDFExportJob(job.id);
      await Promise.all([
        refreshPdfJobs({ silent: true }),
        refreshPdfRuns({ silent: true }),
      ]);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur suppression PDF'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  React.useEffect(() => {
    loadHubs();
  }, []);

  React.useEffect(() => {
    if (
      preSelectHub &&
      !preselectHubApplied.current &&
      hubs.length > 0 &&
      hubs.some((hub) => idOf(hub) === preSelectHub)
    ) {
      setSelectedHub(preSelectHub);
      preselectHubApplied.current = true;
    }
  }, [preSelectHub, hubs]);

  React.useEffect(() => {
    if (selectedHub) loadProjects(selectedHub);
  }, [selectedHub]);

  React.useEffect(() => {
    if (
      preSelectProject &&
      !preselectProjectApplied.current &&
      projects.length > 0 &&
      projects.some((project) => idOf(project) === preSelectProject)
    ) {
      setSelectedProject(preSelectProject);
      preselectProjectApplied.current = true;
      setTimeout(() => {
        const jobsSection = document.getElementById('jobs-section');
        if (jobsSection) {
          jobsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 500);
    }
  }, [preSelectProject, projects]);

  React.useEffect(() => {
    if (selectedHub && selectedProject) {
      loadTopFolders(selectedHub, selectedProject);
    } else {
      setTopFolders([]);
      setChildrenMap(new Map());
      setSelectedItems({});
      setJobType(null);
      setJobName('');
      setJobs([]);
      setRuns([]);
      setPdfExportJobs([]);
      publishRunsRef.current = [];
      pdfRunsRef.current = [];
    }
  }, [selectedHub, selectedProject]);

  React.useEffect(() => {
    if (jobType !== 'pdf-export') return;
    setSelectedItems((prev) => {
      const keys = Object.keys(prev);
      if (keys.length <= 1) return prev;
      const firstKey = keys[0];
      return firstKey ? { [firstKey]: prev[firstKey] } : {};
    });
  }, [jobType]);

  React.useEffect(() => {
    if (jobType === 'pdf-export') return;
    setPdfSelectionMode('all');
    setPdfSelectedSheets([]);
    setPdfExportMode('individual');
    setPdfMergedFileName('Documents.pdf');
    setPdfSheetsLoaded(false);
    setPdfAvailableSheets([]);
    setPdfLoadingSheets(false);
    setPdfCacheKey(null);
  }, [jobType]);

  React.useEffect(() => {
    if (jobType !== 'pdf-export') return;
    setPdfSheetsLoaded(false);
    setPdfAvailableSheets([]);
    setPdfSelectedSheets([]);
    setPdfLoadingSheets(false);
    setPdfCacheKey(null);
  }, [jobType, primarySelectedKey]);

  React.useEffect(() => {
    return () => {
      if (autoRefreshTimeoutRef.current) {
        clearTimeout(autoRefreshTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (autoRefreshTimeoutRef.current) {
      clearTimeout(autoRefreshTimeoutRef.current);
      autoRefreshTimeoutRef.current = null;
    }
    setAutoRefreshActive(false);
  }, [selectedProject]);

  const shouldAutoRefresh = React.useMemo(() => {
    if (!selectedProject) return false;
    const hasRunningRuns = runs.some((r) => r.status === 'running' || r.status === 'queued');
    const hasRunningJobs = jobs.some((j) => j.status === 'running');
    const hasRunningPdfJobs = pdfExportJobs.some((j) => j.status === 'running');
    return hasRunningRuns || hasRunningJobs || hasRunningPdfJobs || autoRefreshActive;
  }, [selectedProject, runs, jobs, pdfExportJobs, autoRefreshActive]);

  React.useEffect(() => {
    if (!shouldAutoRefresh) return undefined;

    const tick = () => {
      void refreshRuns({ silent: true });
      void refreshJobs({ silent: true });
      void refreshPdfRuns({ silent: true });
      void refreshPdfJobs({ silent: true });
    };

    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [shouldAutoRefresh, refreshRuns, refreshJobs, refreshPdfRuns, refreshPdfJobs]);

  React.useEffect(() => {
    if (!highlightJobId || jobs.length === 0) return;
    if (appliedHighlightJob.current === highlightJobId) return;
    const highlightTimeout = setTimeout(() => {
      const jobElement = document.getElementById(`job-${highlightJobId}`);
      if (!jobElement) return;
      const originalBackground = jobElement.style.background;
      const originalBorder = jobElement.style.border;
      jobElement.dataset.originalBackground = originalBackground;
      jobElement.dataset.originalBorder = originalBorder;
      jobElement.style.background = 'rgba(37, 99, 235, 0.15)';
      jobElement.style.border = '2px solid rgba(37, 99, 235, 0.4)';
      jobElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const resetTimeout = setTimeout(() => {
        jobElement.style.background = originalBackground;
        jobElement.style.border = originalBorder;
        delete jobElement.dataset.originalBackground;
        delete jobElement.dataset.originalBorder;
      }, 3000);
      jobElement.dataset.highlightTimeout = String(resetTimeout);
      appliedHighlightJob.current = highlightJobId;
    }, 800);
    return () => {
      clearTimeout(highlightTimeout);
      const jobElement = document.getElementById(`job-${highlightJobId}`);
      const resetTimeoutId = jobElement?.dataset?.highlightTimeout;
      if (resetTimeoutId) {
        clearTimeout(Number(resetTimeoutId));
        delete jobElement.dataset.highlightTimeout;
        if ('originalBackground' in jobElement.dataset) {
          jobElement.style.background = jobElement.dataset.originalBackground || '';
          delete jobElement.dataset.originalBackground;
        }
        if ('originalBorder' in jobElement.dataset) {
          jobElement.style.border = jobElement.dataset.originalBorder || '';
          delete jobElement.dataset.originalBorder;
        }
      }
    };
  }, [highlightJobId, jobs]);

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
    <>
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
              {/* Liste des maquettes sélectionnées */}
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

              <div
                style={{
                  height: 1,
                  background: 'linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.3), transparent)',
                  marginBottom: 20,
                }}
              />

              {jobType !== null && (
                <>
                  <div
                    style={{
                      padding: 16,
                      background: 'rgba(239, 246, 255, 0.5)',
                      borderRadius: 10,
                      border: '1px solid rgba(37, 99, 235, 0.2)',
                      marginBottom: 16,
                    }}
                  >
                    <label
                      style={{
                        display: 'block',
                        marginBottom: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#475569',
                      }}
                    >
                      📝 Nom de la tâche
                    </label>
                    <input
                      type="text"
                      value={jobName}
                      onChange={(e) => setJobName(e.target.value)}
                      placeholder={
                        jobType === 'publish'
                          ? 'Ex: Publish Revit - Quotidien'
                          : 'Ex: Export PDF - Architecte'
                      }
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: '1px solid rgba(148, 163, 184, 0.3)',
                        background: 'rgba(248, 250, 252, 0.9)',
                        fontSize: 14,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {jobType === 'publish' && (
                    <div style={{ marginBottom: 16 }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
                        🕐 Planification
                      </h4>
                      
                      {/* Type de récurrence */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 8 }}>
                          Récurrence
                        </label>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="recurrence-publish"
                              checked={recurrenceType === 'daily'}
                              onChange={() => setRecurrenceType('daily')}
                              style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
                            />
                            <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>📅 Quotidien</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="recurrence-publish"
                              checked={recurrenceType === 'weekly'}
                              onChange={() => setRecurrenceType('weekly')}
                              style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
                            />
                            <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>📆 Hebdomadaire</span>
                          </label>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
                        {recurrenceType === 'weekly' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 160px', minWidth: 180 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                              Jour de la semaine
                            </label>
                            <select
                              value={selectedDayOfWeek}
                              onChange={(e) => setSelectedDayOfWeek(Number(e.target.value))}
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
                              {DAY_OF_WEEK_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        
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
                      </div>
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                {jobType === null ? (
                  <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                    <Button
                      onClick={() => {
                        setJobType('publish');
                        setJobName('');
                      }}
                      style={{
                        padding: '12px 24px',
                        flex: 1,
                        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      }}
                    >
                      🚀 Créer tâche Publish
                    </Button>
                    <Button
                      onClick={() => {
                        const selectedFile = Object.values(selectedItems)[0];
                        if (!selectedFile) {
                          setToast('⚠️ Sélectionne 1 maquette');
                          setTimeout(() => setToast(''), 3000);
                          return;
                        }
                        setJobType('pdf-export');
                        setShowPDFModal(true);
                      }}
                      disabled={Object.keys(selectedItems).length > 1}
                      style={{
                        padding: '12px 24px',
                        flex: 1,
                        background: Object.keys(selectedItems).length > 1
                          ? 'rgba(148, 163, 184, 0.3)'
                          : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        opacity: Object.keys(selectedItems).length > 1 ? 0.5 : 1,
                        cursor: Object.keys(selectedItems).length > 1 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      📄 Créer tâche PDF
                    </Button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                    <Button
                      onClick={() => {
                        setJobType(null);
                        setJobName('');
                      }}
                      variant="secondary"
                      style={{ padding: '12px 24px', flex: 1 }}
                    >
                      ← Retour
                    </Button>
                    <Button
                      onClick={jobType === 'publish' ? handleCreatePublishJob : handleCreatePDFExportJob}
                      style={{ padding: '12px 24px', flex: 1 }}
                    >
                      ✅ Créer
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>

        {/* Jobs */}
        <Card id="jobs-section" title="⚙️ Tâches du projet" style={{ marginBottom: 24 }}>
          {!selectedProject ? (
            <p style={{ color: '#9ca3af' }}>Sélectionne un projet</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              {/* Colonne Publish */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
                  🚀 Tâches Publish ({jobs.length})
                </h4>
                {loadingJobs ? (
                  <p style={{ color: '#6b7280', fontSize: 13 }}>Chargement...</p>
                ) : jobs.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: 13 }}>Aucune tâche Publish</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {jobs.map((j) => {
                      const cronParts = typeof j.cronExpression === 'string' ? j.cronExpression.trim().split(/\s+/) : [];
                      const minutePart = cronParts[0];
                      const hourPart = cronParts[1];
                      const isSimpleTime = /^\d+$/.test(hourPart || '') && /^\d+$/.test(minutePart || '');
                      const displayTime = isSimpleTime
                        ? `${hourPart.padStart(2, '0')}:${minutePart.padStart(2, '0')}`
                        : 'Planification personnalisée';
                      const statusLabel = !j.scheduleEnabled ? 'Pausé' : j.status || 'idle';
                      const badgeStyles = !j.scheduleEnabled
                        ? { background: 'rgba(156, 163, 175, 0.2)', color: '#475569' }
                        : j.status === 'running'
                        ? { background: 'rgba(251, 191, 36, 0.2)', color: '#92400e' }
                        : { background: 'rgba(34, 197, 94, 0.18)', color: '#15803d' };

                      return (
                        <div
                          key={j.id}
                          id={`job-${j.id}`}
                          style={{
                            padding: '10px 12px',
                            background: 'rgba(59, 130, 246, 0.08)',
                            borderRadius: 8,
                            border: '1px solid rgba(37, 99, 235, 0.2)',
                            fontSize: 13,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: '#1f2937' }}>{j.name || 'Sans nom'}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            {Array.isArray(j.models) ? j.models.length : 0} maquettes • 🕐 {displayTime} • {j.timezone || 'UTC'}
                          </div>
                          <div>
                            <span
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                ...badgeStyles,
                              }}
                            >
                              {statusLabel}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <Button
                              variant="secondary"
                              onClick={() => handleToggleActive(j)}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              {j.scheduleEnabled ? '⏸️ Pause' : '▶️ Activer'}
                            </Button>
                            <Button
                              variant="primary"
                              onClick={() => handleRunNow(j)}
                              disabled={j.status === 'running'}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              🚀 Run Now
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => handleDelete(j)}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              🗑️ Supprimer
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Colonne PDF */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
                  📄 Tâches PDF ({pdfExportJobs.length})
                </h4>
                {loadingJobs ? (
                  <p style={{ color: '#6b7280', fontSize: 13 }}>Chargement...</p>
                ) : pdfExportJobs.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: 13 }}>Aucune tâche PDF</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pdfExportJobs.map((j) => {
                      const cronParts = typeof j.cronExpression === 'string' ? j.cronExpression.trim().split(/\s+/) : [];
                      const minutePart = cronParts[0];
                      const hourPart = cronParts[1];
                      const isSimpleTime = /^\d+$/.test(hourPart || '') && /^\d+$/.test(minutePart || '');
                      const displayTime = isSimpleTime
                        ? `${hourPart.padStart(2, '0')}:${minutePart.padStart(2, '0')}`
                        : 'Planification personnalisée';
                      const statusLabel = !j.scheduleEnabled ? 'Pausé' : j.status || 'idle';
                      const badgeStyles = !j.scheduleEnabled
                        ? { background: 'rgba(148, 163, 184, 0.2)', color: '#475569' }
                        : j.status === 'running'
                        ? { background: 'rgba(52, 211, 153, 0.35)', color: '#047857', border: '1px solid rgba(52, 211, 153, 0.4)' }
                        : { background: 'rgba(16, 185, 129, 0.35)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.4)' };

                      return (
                        <div
                          key={j.id}
                          style={{
                            padding: '10px 12px',
                            background: 'rgba(16, 185, 129, 0.12)',
                            borderRadius: 8,
                            border: '1px solid rgba(16, 185, 129, 0.35)',
                            fontSize: 13,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: '#1f2937' }}>{j.name || 'Sans nom'}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            {j.fileName || j.fileUrn?.slice(0, 8)} • 🕐 {displayTime} • {j.timezone || 'UTC'}
                          </div>
                          <div>
                            <span
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                ...badgeStyles,
                              }}
                            >
                              {statusLabel}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <Button
                              variant="secondary"
                              onClick={() => handleTogglePdfJob(j)}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              {j.scheduleEnabled ? '⏸️ Pause' : '▶️ Activer'}
                            </Button>
                            <Button
                              onClick={() => handleRunPdfJob(j)}
                              disabled={j.status === 'running'}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              🚀 Run Now
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => handleDeletePdfJob(j)}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              🗑️ Supprimer
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
                    const jobIdShort = r.jobId ? String(r.jobId).slice(0, 8) : String(r.id).slice(0, 8);

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
                            borderRight: '1px solid rgba(148, 163, 184, 0.1)',
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                            {r.jobName || r.name || `Job ${jobIdShort}`}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              background: r.jobType === 'pdf-export' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.15)',
                              color: r.jobType === 'pdf-export' ? '#059669' : '#1d4ed8',
                              border: r.jobType === 'pdf-export' ? '1px solid rgba(16, 185, 129, 0.3)' : 'none'
                            }}>
                              {r.jobType === 'pdf-export' ? '📄 PDF' : '🚀 Publish'}
                            </span>
                            <span style={{ fontFamily: 'monospace' }}>{jobIdShort}</span>
                          </div>
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

      {/* Modal PDF Export */}
      {showPDFModal && jobType === 'pdf-export' && (() => {
        const selectedFile = Object.values(selectedItems)[0];
        const fileUrn = selectedFile?.publishUrn || selectedFile?.id;
        return (
          <PDFExportModal
            fileUrn={fileUrn}
            projectId={selectedProject}
            topFolders={topFolders}
            childrenMap={childrenMap}
            onLoadChildren={loadChildren}
            onClose={() => {
              setShowPDFModal(false);
              setJobType(null);
              setJobName('');
            }}
            onRunNow={handleRunNowPDF}
            onSchedule={handleSchedulePDF}
            isExporting={isExportingPDF}
            showScheduleButton={true}
            jobName={jobName}
            onJobNameChange={setJobName}
            selectedHour={selectedHour}
            setSelectedHour={setSelectedHour}
            timezone={timezone}
            setTimezone={setTimezone}
            recurrenceType={recurrenceType}
            setRecurrenceType={setRecurrenceType}
            selectedDayOfWeek={selectedDayOfWeek}
            setSelectedDayOfWeek={setSelectedDayOfWeek}
            hourOptions={HOUR_OPTIONS}
            timezoneOptions={timezoneOptions}
            dayOfWeekOptions={DAY_OF_WEEK_OPTIONS}
            defaultTimezone={DEFAULT_TIMEZONE}
          />
        );
      })()}
    </>
  );
}
