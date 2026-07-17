import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  createCopyJob,
  getCopyJobs,
  patchCopyJob,
  deleteCopyJob,
  runCopyJobNow,
  getCopyRuns,
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

// ═══════════════════════════════════════════════════════════════════════════
// 🔍 MAPPING DIAGNOSTIQUE - Associe les erreurs à des causes possibles
// ═══════════════════════════════════════════════════════════════════════════
const DIAGNOSTIC_PATTERNS = [
  // Problèmes d'authentification
  { pattern: /invalid_grant/i, diagnostic: "Token expiré - L'utilisateur doit se reconnecter", icon: "🔑" },
  { pattern: /401|unauthorized/i, diagnostic: "Authentification échouée - Reconnecter le compte", icon: "🔐" },
  { pattern: /403|forbidden/i, diagnostic: "Accès refusé - Vérifier les permissions du projet", icon: "🚫" },
  { pattern: /offline_access/i, diagnostic: "Scope manquant - Reconnecter avec offline_access", icon: "🔄" },
  
  // Problèmes réseau
  { pattern: /ECONNREFUSED/i, diagnostic: "Connexion refusée - Vérifier API_URL Azure", icon: "🔌" },
  { pattern: /ENOTFOUND|ETIMEDOUT|network/i, diagnostic: "Problème réseau - Vérifier la connectivité", icon: "🌐" },
  { pattern: /timeout/i, diagnostic: "Timeout - L'opération a pris trop de temps", icon: "⏱️" },
  
  // Problèmes de données
  { pattern: /ERR_NO_PROCESSABLE_FILES/i, diagnostic: "Aucune sheet publiée disponible", icon: "📄" },
  { pattern: /no.*changes|nothing.*publish/i, diagnostic: "Aucune modification à publier", icon: "✨" },
  { pattern: /404|not found/i, diagnostic: "Ressource introuvable - Fichier supprimé ou déplacé?", icon: "🔍" },
  
  // Problèmes serveur
  { pattern: /Process restart/i, diagnostic: "Redémarrage serveur pendant l'exécution", icon: "🔄" },
  { pattern: /500|internal server/i, diagnostic: "Erreur serveur Autodesk - Réessayer plus tard", icon: "🖥️" },
  { pattern: /502|503|504/i, diagnostic: "Service temporairement indisponible", icon: "⚠️" },
  
  // Problèmes de fichier
  { pattern: /locked|verrouillé/i, diagnostic: "Fichier verrouillé par un autre utilisateur", icon: "🔒" },
  { pattern: /corrupt|damaged/i, diagnostic: "Fichier corrompu - Vérifier l'intégrité", icon: "💔" },
];

/**
 * Détermine le diagnostic basé sur le message d'erreur et les résultats
 */
function getDiagnostic(run) {
  const message = run.message || '';
  const results = run.results || [];
  
  // Collecter tous les messages d'erreur
  const allMessages = [
    message,
    ...results.filter(r => r.status === 'failed').map(r => r.message || r.error || '')
  ].join(' ');
  
  // Chercher un pattern correspondant
  for (const { pattern, diagnostic, icon } of DIAGNOSTIC_PATTERNS) {
    if (pattern.test(allMessages)) {
      return { text: diagnostic, icon };
    }
  }
  
  // Si échec sans diagnostic spécifique
  if (run.status === 'failed' || (run.stats?.failCount > 0)) {
    if (message) {
      const shortMsg = message.length > 50 ? message.substring(0, 47) + '...' : message;
      return { text: shortMsg, icon: "❓" };
    }
    return { text: "Erreur non identifiée - Voir logs", icon: "❓" };
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 📋 TOOLTIP DÉTAILS MODÈLES - Affiche les résultats par modèle
// ═══════════════════════════════════════════════════════════════════════════
function ModelDetailsTooltip({ results, items }) {
  const [isVisible, setIsVisible] = React.useState(false);
  
  const modelDetails = React.useMemo(() => {
    if (!results || results.length === 0) {
      return (items || []).map(item => ({
        name: typeof item === 'object' ? (item.name || item.urn?.split('/').pop() || 'Modèle') : item,
        status: 'unknown'
      }));
    }
    
    return results.map(r => ({
      name: r.name || r.item?.split('/').pop() || 'Modèle',
      status: r.status,
      message: r.message
    }));
  }, [results, items]);
  
  if (modelDetails.length === 0) return <span>-</span>;
  
  const successCount = modelDetails.filter(m => ['accepted', 'queued', 'success'].includes(m.status)).length;
  const failedCount = modelDetails.filter(m => m.status === 'failed').length;
  
  return (
    <div 
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        gap: 6,
        cursor: 'pointer',
        padding: '4px 8px',
        borderRadius: 6,
        background: isVisible ? 'rgba(0,0,0,0.05)' : 'transparent',
        transition: 'background 0.2s'
      }}>
        <span style={{ fontWeight: 600 }}>{modelDetails.length}</span>
        <span style={{ fontSize: 11, color: '#6b7280' }}>📋</span>
      </div>
      
      {isVisible && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          minWidth: 280,
          maxWidth: 400,
          background: '#1f2937',
          color: '#f9fafb',
          borderRadius: 10,
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          padding: 0,
          marginTop: 8,
          overflow: 'hidden'
        }}>
          <div style={{ 
            padding: '12px 16px', 
            background: '#111827',
            borderBottom: '1px solid #374151',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Détails des modèles</span>
            <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
              <span style={{ color: '#10b981' }}>✅ {successCount}</span>
              <span style={{ color: '#ef4444' }}>❌ {failedCount}</span>
            </div>
          </div>
          
          <div style={{ maxHeight: 250, overflowY: 'auto' }}>
            {modelDetails.map((model, idx) => {
              const isSuccess = ['accepted', 'queued', 'success'].includes(model.status);
              const isFailed = model.status === 'failed';
              
              return (
                <div 
                  key={idx}
                  style={{
                    padding: '10px 16px',
                    borderBottom: idx < modelDetails.length - 1 ? '1px solid #374151' : 'none',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10
                  }}
                >
                  <span style={{ fontSize: 14, marginTop: 2 }}>
                    {isSuccess ? '✅' : isFailed ? '❌' : '⏳'}
                  </span>
                  
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      fontSize: 13, 
                      fontWeight: 500,
                      color: isSuccess ? '#10b981' : isFailed ? '#ef4444' : '#9ca3af',
                      wordBreak: 'break-word'
                    }}>
                      {model.name}
                    </div>
                    {model.message && isFailed && (
                      <div style={{ 
                        fontSize: 11, 
                        color: '#9ca3af',
                        marginTop: 4,
                        wordBreak: 'break-word'
                      }}>
                        {model.message}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          <div style={{
            position: 'absolute',
            top: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: '6px solid #111827'
          }} />
        </div>
      )}
    </div>
  );
}

const FILE_TYPE_CONFIG = {
  rvt:  { label: 'R',   bg: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', shadow: 'rgba(37,99,235,0.3)' },
  rfa:  { label: 'R',   bg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', shadow: 'rgba(59,130,246,0.3)' },
  rte:  { label: 'R',   bg: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)', shadow: 'rgba(96,165,250,0.3)' },
  dwg:  { label: 'DW',  bg: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)', shadow: 'rgba(220,38,38,0.3)' },
  dxf:  { label: 'DX',  bg: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', shadow: 'rgba(239,68,68,0.3)' },
  dwf:  { label: 'DW',  bg: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)', shadow: 'rgba(248,113,113,0.3)' },
  ifc:  { label: 'IFC', bg: 'linear-gradient(135deg, #059669 0%, #047857 100%)', shadow: 'rgba(5,150,105,0.3)' },
  nwc:  { label: 'NW',  bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', shadow: 'rgba(245,158,11,0.3)' },
  nwd:  { label: 'NW',  bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', shadow: 'rgba(245,158,11,0.3)' },
  nwf:  { label: 'NW',  bg: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)', shadow: 'rgba(251,191,36,0.3)' },
  pdf:  { label: 'PDF', bg: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)', shadow: 'rgba(220,38,38,0.3)' },
  xlsx: { label: 'XL',  bg: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', shadow: 'rgba(22,163,74,0.3)' },
  xls:  { label: 'XL',  bg: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', shadow: 'rgba(22,163,74,0.3)' },
  csv:  { label: 'CSV', bg: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', shadow: 'rgba(34,197,94,0.3)' },
  docx: { label: 'W',   bg: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)', shadow: 'rgba(37,99,235,0.3)' },
  doc:  { label: 'W',   bg: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)', shadow: 'rgba(37,99,235,0.3)' },
  pptx: { label: 'PP',  bg: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)', shadow: 'rgba(234,88,12,0.3)' },
  png:  { label: 'IMG', bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', shadow: 'rgba(139,92,246,0.3)' },
  jpg:  { label: 'IMG', bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', shadow: 'rgba(139,92,246,0.3)' },
  jpeg: { label: 'IMG', bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', shadow: 'rgba(139,92,246,0.3)' },
  zip:  { label: 'ZIP', bg: 'linear-gradient(135deg, #64748b 0%, #475569 100%)', shadow: 'rgba(100,116,139,0.3)' },
  dwfx: { label: 'DW',  bg: 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)', shadow: 'rgba(248,113,113,0.3)' },
  '3dm': { label: '3D', bg: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)', shadow: 'rgba(14,165,233,0.3)' },
  skp:  { label: 'SK',  bg: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)', shadow: 'rgba(14,165,233,0.3)' },
  fbx:  { label: 'FBX', bg: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', shadow: 'rgba(6,182,212,0.3)' },
  sat:  { label: 'SAT', bg: 'linear-gradient(135deg, #64748b 0%, #475569 100%)', shadow: 'rgba(100,116,139,0.3)' },
  stp:  { label: 'STP', bg: 'linear-gradient(135deg, #64748b 0%, #475569 100%)', shadow: 'rgba(100,116,139,0.3)' },
  step: { label: 'STP', bg: 'linear-gradient(135deg, #64748b 0%, #475569 100%)', shadow: 'rgba(100,116,139,0.3)' },
  igs:  { label: 'IGS', bg: 'linear-gradient(135deg, #64748b 0%, #475569 100%)', shadow: 'rgba(100,116,139,0.3)' },
};

const DEFAULT_FILE_CONFIG = { label: '?', bg: 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)', shadow: 'rgba(148,163,184,0.3)' };

function getFileIcon(ext) {
  const cfg = FILE_TYPE_CONFIG[ext] || FILE_TYPE_CONFIG[ext?.toLowerCase()] || null;
  if (!cfg) return '📄';
  const map = { R: '🏗️', DW: '📐', IFC: '🏢', NW: '🔍', PDF: '📕', XL: '📊', CSV: '📊', W: '📝', PP: '📎', IMG: '🖼️', ZIP: '📦', '3D': '🧊', SK: '🧊', FBX: '🧊', STP: '⚙️', SAT: '⚙️', IGS: '⚙️' };
  return map[cfg.label] || '📄';
}

function FileIcon({ ext }) {
  const cfg = FILE_TYPE_CONFIG[ext] || FILE_TYPE_CONFIG[ext?.toLowerCase()] || DEFAULT_FILE_CONFIG;
  return (
    <span
      style={{
        display: 'inline-flex',
        minWidth: 20,
        height: 20,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: cfg.label.length > 2 ? 8 : cfg.label.length > 1 ? 9 : 12,
        fontWeight: 700,
        marginRight: 8,
        padding: '0 3px',
        background: cfg.bg,
        color: 'white',
        lineHeight: 1,
        boxShadow: `0 2px 4px ${cfg.shadow}`,
        letterSpacing: '-0.5px',
      }}
    >
      {cfg.label}
    </span>
  );
}

function RevitIcon() {
  return <FileIcon ext="rvt" />;
}

function mergeRuns(publishList = [], pdfList = [], copyList = []) {
  const normalizedPublish = Array.isArray(publishList)
    ? publishList.map((run) => ({ ...run, jobType: run.jobType || 'publish' }))
    : [];
  const normalizedPdf = Array.isArray(pdfList)
    ? pdfList.map((run) => ({ ...run, jobType: 'pdf-export' }))
    : [];
  const normalizedCopy = Array.isArray(copyList)
    ? copyList.map((run) => ({ ...run, jobType: 'file-copy' }))
    : [];

  return [...normalizedPublish, ...normalizedPdf, ...normalizedCopy].sort((a, b) => {
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

  const selectable = isItem(node);
  const checked = !!selected[id];
  const ext = extOf(node);

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
        {selectable && <FileIcon ext={ext} />}
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

// Tree Node pour la sélection d'un dossier de destination (copie) — récursif, dossiers seulement
function CopyDestFolderNode({
  folder,
  level = 0,
  selectedFolderId,
  onSelectFolder,
  childrenMap,
  onLoadChildren,
  expandedSet,
  onToggleExpand,
}) {
  const fId = idOf(folder);
  const isSelected = selectedFolderId === fId;
  const expanded = expandedSet.has(fId);
  const kids = childrenMap.get(fId);
  const loading = kids === 'loading';

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          paddingLeft: 8 + level * 14,
          borderRadius: 6,
          background: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
          border: isSelected ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid transparent',
          fontSize: level === 0 ? 13 : 12,
          transition: 'all 0.15s',
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(fId);
          }}
          style={{
            width: 20,
            height: 20,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: '#475569',
            flexShrink: 0,
          }}
          title={expanded ? 'Réduire' : 'Développer'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div
          onClick={() => onSelectFolder(fId)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            color: isSelected ? '#92400e' : '#1f2937',
            fontWeight: isSelected ? 600 : 400,
          }}
        >
          <span>📁</span>
          <span style={{ wordBreak: 'break-word' }}>{nameOf(folder)}</span>
        </div>
      </div>
      {expanded && (
        <div>
          {loading && (
            <div style={{ paddingLeft: 28 + level * 14, fontSize: 12, color: '#9ca3af', padding: '4px 0' }}>
              Chargement…
            </div>
          )}
          {!loading && Array.isArray(kids) && kids.length === 0 && (
            <div style={{ paddingLeft: 28 + level * 14, fontSize: 12, color: '#9ca3af', padding: '4px 0' }}>
              (aucun sous-dossier)
            </div>
          )}
          {!loading &&
            Array.isArray(kids) &&
            kids.map((sub) => (
              <CopyDestFolderNode
                key={idOf(sub)}
                folder={sub}
                level={level + 1}
                selectedFolderId={selectedFolderId}
                onSelectFolder={onSelectFolder}
                childrenMap={childrenMap}
                onLoadChildren={onLoadChildren}
                expandedSet={expandedSet}
                onToggleExpand={onToggleExpand}
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
  const navigate = useNavigate();
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

  const [copyJobs, setCopyJobs] = React.useState([]);
  const copyRunsRef = React.useRef([]);

  // État du modal de création de copie
  const [showCopyModal, setShowCopyModal] = React.useState(false);
  const [copyDestProjects, setCopyDestProjects] = React.useState([]);
  const [copyDestFolders, setCopyDestFolders] = React.useState([]);
  const [copyDestProjectId, setCopyDestProjectId] = React.useState('');
  const [copyDestFolderId, setCopyDestFolderId] = React.useState('');
  const [copyDestFolderChildren, setCopyDestFolderChildren] = React.useState(new Map());
  const [expandedCopyDestFolders, setExpandedCopyDestFolders] = React.useState(new Set());

  const [runs, setRuns] = React.useState([]);
  const publishRunsRef = React.useRef([]);
  const pdfRunsRef = React.useRef([]);
  const [loadingRuns, setLoadingRuns] = React.useState(false);

  const [autoRefreshActive, setAutoRefreshActive] = React.useState(false);
  const autoRefreshTimeoutRef = React.useRef(null);

  const [loadingHubs, setLoadingHubs] = React.useState(false);
  const [loadingProjects, setLoadingProjects] = React.useState(false);
  const [loadingTop, setLoadingTop] = React.useState(false);

  // Accès au projet ACC : null = pas encore vérifié, true = accès OK, false = pas accès (403)
  const [hasProjectAccess, setHasProjectAccess] = React.useState(null);

  const [selectedHour, setSelectedHour] = React.useState('02:00');
  const [cronExpression, setCronExpression] = React.useState('0 2 * * *');
  const [timezone, setTimezone] = React.useState(DEFAULT_TIMEZONE);
  const [recurrenceType, setRecurrenceType] = React.useState('daily'); // 'daily' ou 'weekly'
  const [selectedDayOfWeek, setSelectedDayOfWeek] = React.useState(1); // 0=dimanche, 1=lundi, ..., 6=samedi
  const [notifyOnFailure, setNotifyOnFailure] = React.useState(false); // Notification email en cas d'échec (décochée par défaut)
  const [error, setError] = React.useState('');
  const [toast, setToast] = React.useState('');

  // État pour le modal PDF
  const [showPDFModal, setShowPDFModal] = React.useState(false);
  const [isExportingPDF, setIsExportingPDF] = React.useState(false);

  // État pour l'édition de jobs existants
  const [editingJob, setEditingJob] = React.useState(null); // Contient le job en cours d'édition

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
          // Ne PAS sélectionner un hub par défaut tant qu'on cherche
          let foundHub = null;
          for (const hub of data) {
            try {
              const projects = await fetchProjects(idOf(hub));
              if (projects.some((p) => idOf(p) === preSelectProject)) {
                foundHub = idOf(hub);
                break;
              }
            } catch (e) {
              console.warn(`Erreur lors de la recherche du projet dans le hub ${idOf(hub)}:`, e);
            }
          }
          if (foundHub) {
            setSelectedHub(foundHub);
            preselectHubApplied.current = true;
          } else {
            // Projet non trouvé dans aucun hub = l'utilisateur n'a pas accès
            console.warn(`Projet ${preSelectProject} non trouvé dans les hubs de l'utilisateur`);
            setSelectedHub(idOf(data[0])); // Sélectionner le premier hub quand même
            setHasProjectAccess(false);
            // Charger les jobs/runs du projet via notre API (pas besoin d'accès ACC)
            try {
              const [pubJobs, pdfJobs, cpJobs, pubRuns, pdfRuns, cpRuns] = await Promise.all([
                getPublishJobs({ projectId: preSelectProject }),
                getPDFExportJobs({ projectId: preSelectProject }),
                getCopyJobs({ projectId: preSelectProject }),
                getRuns({ projectId: preSelectProject, limit: 50 }),
                getPDFExportRuns({ projectId: preSelectProject, limit: 50 }),
                getCopyRuns({ projectId: preSelectProject, limit: 50 }),
              ]);
              setJobs(Array.isArray(pubJobs) ? pubJobs : []);
              setPdfExportJobs(Array.isArray(pdfJobs) ? pdfJobs : []);
              setCopyJobs(Array.isArray(cpJobs) ? cpJobs : []);
              publishRunsRef.current = Array.isArray(pubRuns) ? pubRuns : [];
              pdfRunsRef.current = Array.isArray(pdfRuns) ? pdfRuns : [];
              copyRunsRef.current = Array.isArray(cpRuns) ? cpRuns : [];
              setRuns(mergeRuns(publishRunsRef.current, pdfRunsRef.current, copyRunsRef.current));
            } catch (e2) {
              console.warn('Erreur chargement jobs pour projet inaccessible:', e2);
            }
          }
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
    setCopyJobs([]);
    setJobs([]);
    setRuns([]);
    publishRunsRef.current = [];
    pdfRunsRef.current = [];
    copyRunsRef.current = [];
    setHasProjectAccess(null);
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
        } else if (preSelectProject && !data.some((project) => idOf(project) === preSelectProject)) {
          // Le projet pré-sélectionné n'est PAS dans la liste = l'utilisateur n'a pas accès
          console.warn(`Projet ${preSelectProject} non trouvé dans la liste des projets accessibles`);
          setHasProjectAccess(false);
          setSelectedProject(''); // Ne pas sélectionner un autre projet
          setTopFolders([]);
          // Charger les jobs/runs du projet inaccessible via notre API
          try {
            const [pubJobs, pdfJobs, cpJobs, pubRuns, pdfRuns, cpRuns] = await Promise.all([
              getPublishJobs({ projectId: preSelectProject }),
              getPDFExportJobs({ projectId: preSelectProject }),
              getCopyJobs({ projectId: preSelectProject }),
              getRuns({ projectId: preSelectProject, limit: 50 }),
              getPDFExportRuns({ projectId: preSelectProject, limit: 50 }),
              getCopyRuns({ projectId: preSelectProject, limit: 50 }),
            ]);
            setJobs(Array.isArray(pubJobs) ? pubJobs : []);
            setPdfExportJobs(Array.isArray(pdfJobs) ? pdfJobs : []);
            setCopyJobs(Array.isArray(cpJobs) ? cpJobs : []);
            publishRunsRef.current = Array.isArray(pubRuns) ? pubRuns : [];
            pdfRunsRef.current = Array.isArray(pdfRuns) ? pdfRuns : [];
            copyRunsRef.current = Array.isArray(cpRuns) ? cpRuns : [];
            setRuns(mergeRuns(publishRunsRef.current, pdfRunsRef.current, copyRunsRef.current));
          } catch (e2) {
            console.warn('Erreur chargement jobs pour projet inaccessible:', e2);
          }
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
      setHasProjectAccess(null);
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
      setHasProjectAccess(true);
      await Promise.all([refreshJobs(), refreshRuns(), refreshPdfJobs(), refreshPdfRuns(), refreshCopyJobs(), refreshCopyRuns()]);
    } catch (e) {
      const status = e?.response?.status || e?.status;
      const msg = e?.message || '';
      if (status === 403 || status === 500 && (msg.includes('403') || msg.includes('BIM360DM_ERROR'))) {
        setHasProjectAccess(false);
        setTopFolders([]);
        await Promise.all([refreshJobs(), refreshRuns(), refreshPdfJobs(), refreshPdfRuns(), refreshCopyJobs(), refreshCopyRuns()]);
      } else {
        setError(e?.message || 'Erreur dossiers');
        setHasProjectAccess(true); // Autre erreur, pas un problème d'accès
      }
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

  async function loadCopyDestChildren(folderId) {
    if (!selectedProject || !folderId) return;
    const current = copyDestFolderChildren.get(folderId);
    if (current === 'loading' || Array.isArray(current)) return;
    setCopyDestFolderChildren((m) => new Map(m).set(folderId, 'loading'));
    try {
      const data = await fetchFolderContents(selectedProject, folderId);
      const folders = (data || []).filter(
        (item) =>
          item?.type === 'folders' ||
          (typeof item?.attributes?.extension?.type === 'string' &&
            item.attributes.extension.type.includes('folder'))
      );
      setCopyDestFolderChildren((m) => new Map(m).set(folderId, folders));
    } catch (e) {
      setCopyDestFolderChildren((m) => new Map(m).set(folderId, []));
    }
  }

  function toggleCopyDestExpanded(folderId) {
    setExpandedCopyDestFolders((s) => {
      const nxt = new Set(s);
      if (nxt.has(folderId)) {
        nxt.delete(folderId);
      } else {
        nxt.add(folderId);
      }
      return nxt;
    });
    if (!copyDestFolderChildren.has(folderId)) {
      loadCopyDestChildren(folderId);
    }
  }

  function selectCopyDestFolder(folderId) {
    setCopyDestFolderId(folderId);
    setCopyDestProjectId(selectedProject);
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
        setRuns(mergeRuns(publishRunsRef.current, pdfRunsRef.current, copyRunsRef.current));
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
        setRuns(mergeRuns(publishRunsRef.current, pdfRunsRef.current, copyRunsRef.current));
      } catch (e) {
        setError(e?.message || 'Erreur PDF runs');
      } finally {
        if (!silent) setLoadingRuns(false);
      }
    },
    [selectedProject]
  );

  const refreshCopyJobs = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedProject) return;
      if (!silent) setLoadingJobs(true);
      try {
        const list = await getCopyJobs({ projectId: selectedProject });
        setCopyJobs(Array.isArray(list) ? list : []);
      } catch (e) {
        setError(e?.message || 'Erreur copy jobs');
      } finally {
        if (!silent) setLoadingJobs(false);
      }
    },
    [selectedProject]
  );

  const refreshCopyRuns = React.useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedProject) return;
      if (!silent) setLoadingRuns(true);
      try {
        const list = await getCopyRuns({ projectId: selectedProject, limit: 50 });
        copyRunsRef.current = Array.isArray(list) ? list : [];
        setRuns(mergeRuns(publishRunsRef.current, pdfRunsRef.current, copyRunsRef.current));
      } catch (e) {
        setError(e?.message || 'Erreur copy runs');
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

    // Fonction pour trier les sheets par numéro puis par nom
    const sortSheets = (sheets) => {
      return sheets.slice().sort((a, b) => {
        const numberA = a?.number || '';
        const numberB = b?.number || '';

        if (numberA && numberB) {
          const comparison = numberA.localeCompare(numberB, undefined, { numeric: true });
          if (comparison !== 0) {
            return comparison;
          }
        } else if (numberA) {
          return -1;
        } else if (numberB) {
          return 1;
        }

        return (a?.name || '').localeCompare(b?.name || '');
      });
    };

    const selectedSheetNames =
      config.mode === 'custom'
        ? (config.customSheets || []).map((s) => (typeof s === 'string' ? s : s.name || s)).filter(Boolean)
        : sortSheets(config.availableSheets || []).map((s) => (typeof s === 'string' ? s : s.name || s)).filter(Boolean);

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

      const pdfJobData = {
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
        notifyOnFailure: config.notifyOnFailure !== undefined ? config.notifyOnFailure : notifyOnFailure,
      };

      // Mode édition ou création
      if (editingJob && editingJob.type === 'pdf-export') {
        await patchPDFExportJob(editingJob.id, pdfJobData);
        setToast('✅ Tâche PDF mise à jour!');
      } else {
        await createPDFExportJob(pdfJobData);
        setToast('✅ Tâche PDF planifiée!');
      }

      setTimeout(() => setToast(''), 3000);
      setJobName('');
      setJobType(null);
      setShowPDFModal(false);
      setSelectedItems({}); // Réinitialiser les sélections
      setEditingJob(null); // Sortir du mode édition
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
    // Convertir selectedItems en array d'objets {urn, name}
    const items = Object.values(selectedItems).map((item) => ({
      urn: item.publishUrn || item.data?.urn || item.urn,
      name: item.name || item.data?.name || nameOf(item, 'Maquette')
    }));
    
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

    const jobData = {
      name: jobName.trim(),
      hubId: selectedHub,
      hubName,
      projectId: selectedProject,
      projectName,
      items,
      scheduleEnabled: true,
      cronExpression,
      timezone,
      notifyOnFailure: notifyOnFailure,
    };

    try {
      // Mode édition ou création
      if (editingJob && editingJob.type === 'publish') {
        await patchPublishJob(editingJob.id, jobData);
        setToast('✅ Tâche Publish mise à jour!');
      } else {
        await createPublishJob(jobData);
        setToast('✅ Tâche Publish créée!');
      }
      
      setTimeout(() => setToast(''), 3000);
      setJobName('');
      setJobType(null);
      setSelectedItems({});
      setEditingJob(null); // Sortir du mode édition
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

  async function handleEditPublishJob(job) {
    // Entrer en mode édition et pré-remplir le formulaire
    setEditingJob({ ...job, type: 'publish' });
    setJobType('publish');
    setJobName(job.name || '');
    
    // Pré-sélectionner le hub et projet
    if (job.hubId) setSelectedHub(job.hubId);
    if (job.projectId) setSelectedProject(job.projectId);
    
    // Pré-sélectionner les modèles (conversion correcte pour le formulaire)
    if (Array.isArray(job.models) && job.models.length > 0) {
      const itemsMap = {};
      job.models.forEach(model => {
        // Les modèles peuvent être stockés de deux façons :
        // 1. String simple : "urn:..." (c'est le cas actuellement)
        // 2. Objet : { urn, name }
        let modelUrn, modelName;
        
        if (typeof model === 'string') {
          // Cas 1 : model est déjà l'URN
          modelUrn = model;
          modelName = 'Maquette'; // Nom par défaut car on n'a pas le vrai nom
        } else {
          // Cas 2 : model est un objet
          modelUrn = model.urn || model.publishUrn || model.id;
          modelName = model.name || 'Maquette';
        }
        
        if (modelUrn) {
          itemsMap[modelUrn] = { 
            checked: true, 
            publishUrn: modelUrn, // Utilisé lors de la création du job
            name: modelName, // Pour que nameOf() le trouve
            data: { 
              urn: modelUrn, 
              name: modelName,
              id: modelUrn
            }
          };
        }
      });
      setSelectedItems(itemsMap);
      
      // Log pour debugging
      console.log('[Edit Publish] Modèles pré-sélectionnés:', Object.keys(itemsMap).length);
      console.log('[Edit Publish] Détails des modèles:', itemsMap);
      console.log('[Edit Publish] Job.models:', job.models);
    }
    
    // Configurer l'horaire
    const cronParts = (job.cronExpression || '0 2 * * *').split(' ');
    const minute = cronParts[0] || '0';
    const hour = cronParts[1] || '2';
    const hourMinute = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    
    // Déterminer le type de récurrence
    const dayOfWeek = cronParts[4];
    const isWeekly = dayOfWeek && dayOfWeek !== '*';
    
    // Définir les états (le useEffect mettra à jour cronExpression automatiquement)
    setSelectedHour(hourMinute);
    setTimezone(job.timezone || DEFAULT_TIMEZONE);
    setRecurrenceType(isWeekly ? 'weekly' : 'daily');
    if (isWeekly) {
      setSelectedDayOfWeek(parseInt(dayOfWeek, 10));
    }
    
    // Notification
    setNotifyOnFailure(job.notifyOnFailure || false);
    
    // Scroller vers le haut du formulaire
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setToast('✏️ Mode édition Publish activé');
    setTimeout(() => setToast(''), 3000);
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

  async function handleEditPdfJob(job) {
    // Entrer en mode édition pour PDF et ouvrir le modal
    setEditingJob({ ...job, type: 'pdf-export' });
    setJobType('pdf-export');
    setJobName(job.name || '');
    
    // Pré-sélectionner le hub et projet
    if (job.hubId) setSelectedHub(job.hubId);
    if (job.projectId) setSelectedProject(job.projectId);
    
    // Pré-sélectionner le fichier (si disponible)
    if (job.fileUrn) {
      setSelectedItems({
        [job.fileUrn]: { 
          checked: true, 
          publishUrn: job.fileUrn,
          id: job.fileUrn,
          data: { 
            urn: job.fileUrn, 
            name: job.fileName || 'Fichier',
            id: job.fileUrn
          }
        }
      });
    }
    
    // Configurer les paramètres PDF
    setPdfSelectionMode(job.selectionMode || 'all');
    setPdfSelectedSheets(job.selectedSheets || []);
    setPdfExportMode(job.exportMode || 'individual');
    setPdfMergedFileName(job.mergedFileName || 'Documents.pdf');
    
    // Configurer l'horaire
    const cronParts = (job.cronExpression || '0 2 * * *').split(' ');
    const minute = cronParts[0] || '0';
    const hour = cronParts[1] || '2';
    const hourMinute = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    
    // Déterminer le type de récurrence
    const dayOfWeek = cronParts[4];
    const isWeekly = dayOfWeek && dayOfWeek !== '*';
    
    // Définir les états (le useEffect mettra à jour cronExpression automatiquement)
    setSelectedHour(hourMinute);
    setTimezone(job.timezone || DEFAULT_TIMEZONE);
    setRecurrenceType(isWeekly ? 'weekly' : 'daily');
    if (isWeekly) {
      setSelectedDayOfWeek(parseInt(dayOfWeek, 10));
    }
    
    // Notification
    setNotifyOnFailure(job.notifyOnFailure || false);
    
    // Ouvrir le modal PDF
    setShowPDFModal(true);
    
    // Scroller vers le haut
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setToast('✏️ Mode édition PDF activé');
    setTimeout(() => setToast(''), 3000);
  }

  // ========== COPY JOB HANDLERS ==========

  async function handleToggleCopyJob(job) {
    try {
      await patchCopyJob(job.id, { scheduleEnabled: !job.scheduleEnabled });
      await refreshCopyJobs({ silent: true });
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleRunCopyJob(job) {
    try {
      await runCopyJobNow(job.id);
      setToast('🚀 Copie lancée!');
      setTimeout(() => setToast(''), 3000);
      triggerAutoRefreshWindow(60000);
      await Promise.all([
        refreshCopyRuns({ silent: true }),
        refreshCopyJobs({ silent: true }),
      ]);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleDeleteCopyJob(job) {
    if (!window.confirm('Supprimer cette tâche de copie?')) return;
    try {
      await deleteCopyJob(job.id);
      await Promise.all([refreshCopyJobs({ silent: true }), refreshCopyRuns({ silent: true })]);
    } catch (e) {
      setToast('❌ ' + (e?.message || 'Erreur suppression'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleCreateCopyJob() {
    const selectedFileUrns = Object.entries(selectedItems)
      .map(([key, v]) => ({
        urn: v.publishUrn || v.id || key,
        name: v.attributes?.displayName || v.name || nameOf(v, 'Fichier'),
      }));

    if (selectedFileUrns.length === 0) {
      setToast('❌ Sélectionnez au moins un fichier');
      setTimeout(() => setToast(''), 3000);
      return;
    }
    if (!copyDestFolderId) {
      setToast('❌ Sélectionnez un dossier de destination');
      setTimeout(() => setToast(''), 3000);
      return;
    }

    try {
      const firstItem = Object.values(selectedItems)[0];
      const parentFolderRef = firstItem?.relationships?.parent?.data?.id || '';
      await createCopyJob({
        name: jobName || 'Copie de fichiers',
        hubId: selectedHub,
        hubName: hubs.find((h) => idOf(h) === selectedHub)?.attributes?.name || '',
        projectId: selectedProject,
        projectName: projects.find((p) => idOf(p) === selectedProject)?.attributes?.name || '',
        sourceFolderId: parentFolderRef || 'unknown',
        sourceFolderName: '',
        files: selectedFileUrns,
        destinationProjectId: copyDestProjectId || selectedProject,
        destinationProjectName: '',
        destinationFolderId: copyDestFolderId,
        destinationFolderName: '',
        overwriteExisting: true,
        scheduleEnabled: true,
        cronExpression,
        timezone,
        notifyOnFailure,
      });

      setToast('✅ Tâche de copie créée!');
      setTimeout(() => setToast(''), 3000);
      setShowCopyModal(false);
      setJobType(null);
      setJobName('');
      setSelectedItems({});
      await refreshCopyJobs({ silent: true });
    } catch (e) {
      setToast('❌ ' + (e?.response?.data?.message || e?.message || 'Erreur'));
      setTimeout(() => setToast(''), 3000);
    }
  }

  React.useEffect(() => {
    loadHubs();
  }, []);

  // Mettre à jour le cronExpression automatiquement quand l'utilisateur change l'heure ou la récurrence
  React.useEffect(() => {
    if (selectedHour && recurrenceType) {
      const newCronExpression = generateCronExpression(recurrenceType, selectedHour, selectedDayOfWeek);
      setCronExpression(newCronExpression);
    }
  }, [selectedHour, recurrenceType, selectedDayOfWeek]);

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
    const hasRunningCopyJobs = copyJobs.some((j) => j.status === 'running');
    return hasRunningRuns || hasRunningJobs || hasRunningPdfJobs || hasRunningCopyJobs || autoRefreshActive;
  }, [selectedProject, runs, jobs, pdfExportJobs, copyJobs, autoRefreshActive]);

  React.useEffect(() => {
    if (!shouldAutoRefresh) return undefined;

    const tick = () => {
      void refreshRuns({ silent: true });
      void refreshJobs({ silent: true });
      void refreshPdfRuns({ silent: true });
      void refreshPdfJobs({ silent: true });
      void refreshCopyRuns({ silent: true });
      void refreshCopyJobs({ silent: true });
    };

    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [shouldAutoRefresh, refreshRuns, refreshJobs, refreshPdfRuns, refreshPdfJobs, refreshCopyRuns, refreshCopyJobs]);

  // Polling « léger » dédié à la confirmation webhook ACC : le webhook dm.version.added
  // arrive APRÈS la fin du run (success/partial). On continue donc à rafraîchir les runs
  // (toutes les 15s, fenêtre de 5 min après la fin) jusqu'à recevoir webhookReceived,
  // pour que le ✅ « durée réelle » apparaisse sans action manuelle.
  const hasPendingWebhook = React.useMemo(() => {
    if (!selectedProject) return false;
    const now = Date.now();
    const WEBHOOK_WAIT_MS = 5 * 60 * 1000;
    return runs.some((r) => {
      if (r.status !== 'success' && r.status !== 'partial') return false;
      const s = r.stats || {};
      if (s.webhookReceived || s.webhookEndTime) return false;
      const endedRaw = r.endedAt || r.updatedAt;
      const endedAt = endedRaw ? new Date(endedRaw).getTime() : 0;
      if (!endedAt) return false;
      return (now - endedAt) < WEBHOOK_WAIT_MS;
    });
  }, [selectedProject, runs]);

  React.useEffect(() => {
    // Ne pas doubler le polling rapide : s'il tourne déjà, il couvre aussi ce besoin.
    if (!hasPendingWebhook || shouldAutoRefresh) return undefined;
    const tick = () => {
      void refreshRuns({ silent: true });
      void refreshPdfRuns({ silent: true });
      void refreshCopyRuns({ silent: true });
    };
    const interval = setInterval(tick, 15000);
    return () => clearInterval(interval);
  }, [hasPendingWebhook, shouldAutoRefresh, refreshRuns, refreshPdfRuns, refreshCopyRuns]);

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

        {/* Bandeau accès refusé (affiché quand on arrive d'un clic dashboard sur un projet non accessible) */}
        {hasProjectAccess === false && preSelectProject && (
          <div
            style={{
              padding: '20px 24px',
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(239, 68, 68, 0.06) 100%)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 14,
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              backdropFilter: 'blur(10px)',
              boxShadow: '0 4px 16px rgba(239, 68, 68, 0.1)',
            }}
          >
            <span style={{ fontSize: 36 }}>🔒</span>
            <div>
              <div style={{ fontWeight: 700, color: '#fca5a5', fontSize: 16, marginBottom: 4 }}>
                Vous n'avez pas accès à ce projet ACC
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                Le projet de cette tâche planifiée n'est pas accessible avec votre compte Autodesk.
                Vous pouvez consulter les tâches et l'historique ci-dessous en lecture seule.
                Contactez l'administrateur du projet pour obtenir l'accès.
              </div>
            </div>
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
                {selectedProject ? (
                  <Button
                    type="button"
                    onClick={() =>
                      navigate('/qc-config', {
                        state: {
                          preSelectHub: selectedHub,
                          preSelectProject: selectedProject,
                        },
                      })
                    }
                    style={{
                      padding: '10px 16px',
                      width: '100%',
                      background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
                    }}
                  >
                    Configurer le QC
                  </Button>
                ) : null}
              </div>
            )}
          </Card>
        </div>

        {/* Arbre fichiers */}
        <Card title="📂 Fichiers du projet" style={{ marginBottom: 24 }}>
          {hasProjectAccess === false ? (
            <div style={{
              padding: '20px 24px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <span style={{ fontSize: 28 }}>🔒</span>
              <div>
                <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: 4 }}>
                  Vous n'avez pas accès à ce projet ACC
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>
                  Vous pouvez consulter les planifications et l'historique ci-dessous, mais vous ne pouvez pas naviguer dans les fichiers ni modifier les tâches.
                  Contactez l'administrateur du projet pour obtenir l'accès.
                </div>
              </div>
            </div>
          ) : !selectedProject ? (
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

              {/* Bandeau mode édition */}
              {editingJob && (
                <div
                  style={{
                    padding: 12,
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(124, 58, 237, 0.1) 100%)',
                    border: '2px solid rgba(139, 92, 246, 0.3)',
                    borderRadius: 10,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ fontSize: 24 }}>✏️</div>
                  <div>
                    <div style={{ fontWeight: 600, color: '#6d28d9', fontSize: 14 }}>
                      Mode édition activé
                    </div>
                    <div style={{ fontSize: 12, color: '#7c3aed' }}>
                      Vous modifiez la tâche "{editingJob.name || 'Sans nom'}"
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setEditingJob(null);
                      setJobType(null);
                      setJobName('');
                      setSelectedItems({});
                      setToast('❌ Édition annulée');
                      setTimeout(() => setToast(''), 3000);
                    }}
                    style={{
                      marginLeft: 'auto',
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      background: 'white',
                      color: '#7c3aed',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Annuler
                  </button>
                </div>
              )}

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
                    <Button
                      onClick={() => {
                        const selectedFileCount = Object.keys(selectedItems).length;
                        if (selectedFileCount === 0) {
                          setToast('⚠️ Sélectionne au moins 1 fichier');
                          setTimeout(() => setToast(''), 3000);
                          return;
                        }
                        setJobType('file-copy');
                        setShowCopyModal(true);
                      }}
                      style={{
                        padding: '12px 24px',
                        flex: 1,
                        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                      }}
                    >
                      📋 Créer tâche Copie
                    </Button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                    <Button
                      onClick={() => {
                        setJobType(null);
                        setJobName('');
                        setSelectedItems({}); // Réinitialiser les sélections
                        setEditingJob(null); // Sortir du mode édition si actif
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
                      {editingJob ? '✏️ Mettre à jour' : '✅ Créer'}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>

        {/* Jobs */}
        <Card id="jobs-section" title="⚙️ Tâches du projet" style={{ marginBottom: 24 }}>
          {!selectedProject && hasProjectAccess !== false ? (
            <p style={{ color: '#9ca3af' }}>Sélectionne un projet</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
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
                          <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
                            Planifiée par : <span style={{ fontWeight: 500, color: '#475569' }}>{j.userName || 'Utilisateur inconnu'}</span>
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
                          {hasProjectAccess === false ? (
                            <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                              🔒 Lecture seule — pas d'accès au projet
                            </div>
                          ) : (
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
                                variant="secondary"
                                onClick={() => handleEditPublishJob(j)}
                                style={{ padding: '6px 12px', fontSize: 12, background: '#8b5cf6', color: 'white', border: 'none' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = '#7c3aed'}
                                onMouseLeave={(e) => e.currentTarget.style.background = '#8b5cf6'}
                              >
                                ✏️ Modifier
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() => handleDelete(j)}
                                style={{ padding: '6px 12px', fontSize: 12 }}
                              >
                                🗑️ Supprimer
                              </Button>
                            </div>
                          )}
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
                          <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
                            Planifiée par : <span style={{ fontWeight: 500, color: '#475569' }}>{j.userName || 'Utilisateur inconnu'}</span>
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
                          {hasProjectAccess === false ? (
                            <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                              🔒 Lecture seule — pas d'accès au projet
                            </div>
                          ) : (
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
                                variant="secondary"
                                onClick={() => handleEditPdfJob(j)}
                                style={{ padding: '6px 12px', fontSize: 12, background: '#8b5cf6', color: 'white', border: 'none' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = '#7c3aed'}
                                onMouseLeave={(e) => e.currentTarget.style.background = '#8b5cf6'}
                              >
                                ✏️ Modifier
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() => handleDeletePdfJob(j)}
                                style={{ padding: '6px 12px', fontSize: 12 }}
                              >
                                🗑️ Supprimer
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Colonne Copie */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
                  📋 Tâches Copie ({copyJobs.length})
                </h4>
                {loadingJobs ? (
                  <p style={{ color: '#6b7280', fontSize: 13 }}>Chargement...</p>
                ) : copyJobs.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: 13 }}>Aucune tâche de copie</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {copyJobs.map((j) => {
                      const cronParts = typeof j.cronExpression === 'string' ? j.cronExpression.trim().split(/\s+/) : [];
                      const minutePart = cronParts[0];
                      const hourPart = cronParts[1];
                      const dowPart = cronParts[4];
                      const isSimpleTime = /^\d+$/.test(hourPart || '') && /^\d+$/.test(minutePart || '');
                      const displayTime = isSimpleTime
                        ? `${hourPart.padStart(2, '0')}:${minutePart.padStart(2, '0')}`
                        : 'Planification personnalisée';
                      const isWeekly = /^\d+$/.test(dowPart || '');
                      const dowLabel = isWeekly
                        ? (DAY_OF_WEEK_OPTIONS.find((d) => d.value === Number(dowPart))?.label || '')
                        : '';
                      const recurrenceLabel = isSimpleTime
                        ? (isWeekly ? `📆 Hebdo · ${dowLabel}` : '📅 Quotidien')
                        : '';
                      const statusLabel = !j.scheduleEnabled ? 'Pausé' : j.status || 'idle';
                      const badgeStyles = !j.scheduleEnabled
                        ? { background: 'rgba(148, 163, 184, 0.2)', color: '#475569' }
                        : j.status === 'running'
                        ? { background: 'rgba(245, 158, 11, 0.35)', color: '#b45309', border: '1px solid rgba(245, 158, 11, 0.4)' }
                        : { background: 'rgba(245, 158, 11, 0.35)', color: '#92400e', border: '1px solid rgba(245, 158, 11, 0.4)' };
                      const fileCount = Array.isArray(j.files) ? j.files.length : 0;

                      return (
                        <div
                          key={j.id}
                          style={{
                            padding: '10px 12px',
                            background: 'rgba(245, 158, 11, 0.12)',
                            borderRadius: 8,
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            fontSize: 13,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: '#1f2937' }}>{j.name || 'Sans nom'}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            {fileCount} fichier{fileCount > 1 ? 's' : ''} • 🕐 {displayTime}
                            {recurrenceLabel ? ` • ${recurrenceLabel}` : ''} • {j.timezone || 'UTC'}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
                            Planifiée par : <span style={{ fontWeight: 500, color: '#475569' }}>{j.userName || 'Utilisateur inconnu'}</span>
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
                          {hasProjectAccess === false ? (
                            <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                              🔒 Lecture seule
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <Button
                                variant="secondary"
                                onClick={() => handleToggleCopyJob(j)}
                                style={{ padding: '6px 12px', fontSize: 12 }}
                              >
                                {j.scheduleEnabled ? '⏸️ Pause' : '▶️ Activer'}
                              </Button>
                              <Button
                                onClick={() => handleRunCopyJob(j)}
                                disabled={j.status === 'running'}
                                style={{ padding: '6px 12px', fontSize: 12 }}
                              >
                                🚀 Run Now
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() => handleDeleteCopyJob(j)}
                                style={{ padding: '6px 12px', fontSize: 12 }}
                              >
                                🗑️ Supprimer
                              </Button>
                            </div>
                          )}
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
          {!selectedProject && hasProjectAccess !== false ? (
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
                        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
                      }}
                    >
                      Statut
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
                      Diagnostic
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, index) => {
                    const okCount = r.stats?.okCount ?? 0;
                    const failCount = r.stats?.failCount ?? 0;
                    const totalFiles = Array.isArray(r.items) ? r.items.length : 0;
                    const jobIdShort = r.jobId ? String(r.jobId).slice(0, 8) : String(r.id).slice(0, 8);

                    // Durée réelle (du lancement jusqu'à la confirmation webhook ACC si dispo),
                    // sinon durée de traitement interne. Le crochet ✅ indique une confirmation webhook.
                    let durationText = '-';
                    let durationConfirmed = false;
                    {
                      const s = r.stats || {};
                      let ms = 0;
                      if (s.webhookEndTime && r.startedAt) {
                        ms = new Date(s.webhookEndTime) - new Date(r.startedAt);
                      } else {
                        ms = s.realDurationMs || s.durationMs || (r.endedAt && r.startedAt ? new Date(r.endedAt) - new Date(r.startedAt) : 0);
                      }
                      durationConfirmed = !!(s.webhookReceived || s.webhookEndTime);
                      if (ms) {
                        const seconds = Math.round(ms / 1000);
                        durationText = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
                      }
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
                              background: r.jobType === 'file-copy' ? 'rgba(245, 158, 11, 0.3)' : r.jobType === 'pdf-export' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.15)',
                              color: r.jobType === 'file-copy' ? '#92400e' : r.jobType === 'pdf-export' ? '#059669' : '#1d4ed8',
                              border: r.jobType === 'file-copy' ? '1px solid rgba(245, 158, 11, 0.3)' : r.jobType === 'pdf-export' ? '1px solid rgba(16, 185, 129, 0.3)' : 'none'
                            }}>
                              {r.jobType === 'file-copy' ? '📋 Copie' : r.jobType === 'pdf-export' ? '📄 PDF' : '🚀 Publish'}
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
                          <span title={durationConfirmed
                            ? 'Durée réelle confirmée par webhook (document publié sur ACC)'
                            : "Durée de traitement interne — en attente de confirmation webhook ACC (document pas encore (re)publié sur ACC, ou webhook non reçu/associé)"}>
                            {durationText}{durationConfirmed ? ' ✅' : ''}
                          </span>
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
                          <ModelDetailsTooltip results={r.results} items={r.items} />
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
                        <td style={{ padding: '12px', borderRight: '1px solid rgba(148, 163, 184, 0.1)' }}>
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
                            {r.status === 'partial' && '⚠️'}
                            {r.status}
                          </span>
                        </td>
                        {/* Colonne Diagnostic */}
                        <td style={{ padding: '12px' }}>
                          {(() => {
                            const diagnostic = getDiagnostic(r);
                            if (!diagnostic) {
                              return <span style={{ color: '#9ca3af', fontSize: 13 }}>-</span>;
                            }
                            return (
                              <div style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 8,
                                maxWidth: 280
                              }}>
                                <span style={{ fontSize: 16, flexShrink: 0 }}>{diagnostic.icon}</span>
                                <span style={{ 
                                  fontSize: 12, 
                                  color: '#6b7280',
                                  lineHeight: 1.4
                                }}>
                                  {diagnostic.text}
                                </span>
                              </div>
                            );
                          })()}
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
              setSelectedItems({}); // Réinitialiser les sélections
              setEditingJob(null); // Sortir du mode édition
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
            notifyOnFailure={notifyOnFailure}
            setNotifyOnFailure={setNotifyOnFailure}
            editingJob={editingJob}
          />
        );
      })()}

      {/* Modal Copie de fichiers */}
      {showCopyModal && jobType === 'file-copy' && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => {
            setShowCopyModal(false);
            setJobType(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 32,
              width: '90%',
              maxWidth: 600,
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 25px 50px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 20px 0', fontSize: 20, fontWeight: 700, color: '#1f2937' }}>
              📋 Planifier une copie de fichiers
            </h2>

            {/* Fichiers sélectionnés */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>Fichiers à copier :</label>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Object.entries(selectedItems)
                  .map(([key, v]) => (
                    <div
                      key={key}
                      style={{
                        padding: '6px 10px',
                        background: 'rgba(245, 158, 11, 0.1)',
                        borderRadius: 6,
                        fontSize: 13,
                        color: '#1f2937',
                      }}
                    >
                      {getFileIcon(extOf(v))} {v.attributes?.displayName || v.name || nameOf(v, key.slice(0, 16))}
                    </div>
                  ))}
              </div>
            </div>

            {/* Nom de la tâche */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>Nom de la tâche :</label>
              <input
                type="text"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="Ex: Copie maquette Archi"
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 6,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  fontSize: 14,
                }}
              />
            </div>

            {/* Dossier de destination - même projet */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>Dossier de destination :</label>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>
                Sélectionnez un dossier dans le même projet
              </p>
              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                {topFolders.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: 13 }}>Aucun dossier disponible</p>
                ) : (
                  topFolders.map((f) => (
                    <CopyDestFolderNode
                      key={idOf(f)}
                      folder={f}
                      level={0}
                      selectedFolderId={copyDestFolderId}
                      onSelectFolder={selectCopyDestFolder}
                      childrenMap={copyDestFolderChildren}
                      onLoadChildren={loadCopyDestChildren}
                      expandedSet={expandedCopyDestFolders}
                      onToggleExpand={toggleCopyDestExpanded}
                    />
                  ))
                )}
              </div>
              {copyDestFolderId && (
                <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 6, fontWeight: 500 }}>
                  Destination sélectionnée
                </p>
              )}
            </div>

            {/* Planification */}
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
                      name="recurrence-copy"
                      checked={recurrenceType === 'daily'}
                      onChange={() => setRecurrenceType('daily')}
                      style={{ marginRight: 8, cursor: 'pointer', accentColor: '#f59e0b' }}
                    />
                    <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>📅 Quotidien</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="recurrence-copy"
                      checked={recurrenceType === 'weekly'}
                      onChange={() => setRecurrenceType('weekly')}
                      style={{ marginRight: 8, cursor: 'pointer', accentColor: '#f59e0b' }}
                    />
                    <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>📆 Hebdomadaire</span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
                {recurrenceType === 'weekly' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 160px', minWidth: 160 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      Jour de la semaine
                    </label>
                    <select
                      value={selectedDayOfWeek}
                      onChange={(e) => setSelectedDayOfWeek(Number(e.target.value))}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid #d1d5db',
                        fontSize: 14,
                        outline: 'none',
                        cursor: 'pointer',
                        background: '#fff',
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 140px', minWidth: 140 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    Heure
                  </label>
                  <select
                    value={selectedHour}
                    onChange={(e) => setSelectedHour(e.target.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      fontSize: 14,
                      outline: 'none',
                      cursor: 'pointer',
                      background: '#fff',
                    }}
                  >
                    {HOUR_OPTIONS.map((h) => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 200px', minWidth: 200 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    Fuseau horaire
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      fontSize: 14,
                      outline: 'none',
                      cursor: 'pointer',
                      background: '#fff',
                    }}
                  >
                    {timezoneOptions.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Boutons */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCopyModal(false);
                  setJobType(null);
                }}
                style={{ padding: '10px 20px' }}
              >
                Annuler
              </Button>
              <Button
                onClick={handleCreateCopyJob}
                disabled={!copyDestFolderId}
                style={{
                  padding: '10px 20px',
                  background: copyDestFolderId
                    ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                    : 'rgba(148, 163, 184, 0.3)',
                  opacity: copyDestFolderId ? 1 : 0.5,
                }}
              >
                📋 Planifier la copie
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
