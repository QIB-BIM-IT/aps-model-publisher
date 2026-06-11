import React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table';

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
      // Tronquer le message s'il est trop long
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
  
  // Combiner items et results pour avoir noms et statuts
  const modelDetails = React.useMemo(() => {
    if (!results || results.length === 0) {
      // Fallback sur items si pas de results
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
      {/* Indicateur cliquable */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 6,
        cursor: 'pointer',
        padding: '4px 8px',
        borderRadius: 6,
        background: isVisible ? '#f3f4f6' : 'transparent',
        transition: 'background 0.2s'
      }}>
        <span style={{ fontWeight: 600 }}>{modelDetails.length}</span>
        <span style={{ fontSize: 11, color: '#6b7280' }}>📋</span>
      </div>
      
      {/* Tooltip */}
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
          {/* Header */}
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
          
          {/* Liste des modèles */}
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
                  {/* Status icon */}
                  <span style={{ 
                    fontSize: 14,
                    marginTop: 2
                  }}>
                    {isSuccess ? '✅' : isFailed ? '❌' : '⏳'}
                  </span>
                  
                  {/* Model info */}
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
          
          {/* Arrow */}
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

export default function HistoriqueTable({ runs }) {
  const [sorting, setSorting] = React.useState([{ id: 'createdAt', desc: true }]);
  const [globalFilter, setGlobalFilter] = React.useState('');

  const columns = React.useMemo(() => [
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ getValue }) => {
        const val = getValue();
        return val ? new Date(val).toLocaleDateString('fr-CA') : '-';
      },
    },
    {
      accessorKey: 'jobId',
      header: 'Job',
      cell: ({ getValue }) => (
        <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#6b7280' }}>
          {String(getValue()).slice(0, 8)}
        </span>
      ),
    },
    {
      accessorKey: 'startedAt',
      header: 'Début',
      cell: ({ getValue }) => {
        const val = getValue();
        return val ? new Date(val).toLocaleTimeString('fr-CA') : '-';
      },
    },
    {
      accessorKey: 'endedAt',
      header: 'Fin',
      cell: ({ getValue, row }) => {
        const val = getValue();
        if (val) return new Date(val).toLocaleTimeString('fr-CA');
        if (row.original.status === 'running') return '⏳ en cours...';
        return '-';
      },
    },
    {
      id: 'dureeReelle',
      header: 'Durée réelle',
      accessorFn: (row) => {
        const s = row.stats || {};
        if (s.webhookEndTime && row.startedAt) return new Date(s.webhookEndTime) - new Date(row.startedAt);
        return s.realDurationMs || s.durationMs
          || (row.endedAt && row.startedAt ? new Date(row.endedAt) - new Date(row.startedAt) : 0);
      },
      cell: ({ getValue, row }) => {
        const ms = getValue();
        if (!ms) return '-';
        const seconds = Math.round(ms / 1000);
        const txt = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
        const confirmed = !!(row.original.stats?.webhookReceived || row.original.stats?.webhookEndTime);
        return (
          <span title={confirmed
            ? 'Durée réelle confirmée par webhook (publié sur ACC)'
            : 'Durée de traitement interne (pas de confirmation ACC — ex. maquette sans modification)'}>
            {txt}{confirmed ? ' ✅' : ''}
          </span>
        );
      },
    },
    {
      id: 'fichiers',
      header: 'Modèles',
      accessorFn: (row) => Array.isArray(row.items) ? row.items.length : (row.results?.length || 0),
      cell: ({ row }) => (
        <div style={{ textAlign: 'center' }}>
          <ModelDetailsTooltip 
            results={row.original.results} 
            items={row.original.items} 
          />
        </div>
      ),
    },
    {
      accessorKey: 'stats.okCount',
      header: 'Succès',
      cell: ({ getValue }) => (
        <div style={{ textAlign: 'center', color: '#059669', fontWeight: 600, fontSize: 15 }}>
          {getValue() ?? 0}
        </div>
      ),
    },
    {
      accessorKey: 'stats.failCount',
      header: 'Échecs',
      cell: ({ getValue }) => {
        const count = getValue() ?? 0;
        return (
          <div style={{
            textAlign: 'center',
            color: count > 0 ? '#dc2626' : '#9ca3af',
            fontWeight: 600,
            fontSize: 15
          }}>
            {count}
          </div>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Statut',
      cell: ({ getValue, row }) => {
        const status = getValue();
        let statusColor = '#666';
        let icon = '';
        let bgColor = 'transparent';
        
        if (status === 'success') { statusColor = '#059669'; icon = '✅'; bgColor = '#ecfdf5'; }
        if (status === 'failed') { statusColor = '#dc2626'; icon = '❌'; bgColor = '#fef2f2'; }
        if (status === 'running') { statusColor = '#f59e0b'; icon = '🔄'; bgColor = '#fffbeb'; }
        if (status === 'partial') { statusColor = '#d97706'; icon = '⚠️'; bgColor = '#fffbeb'; }

        return (
          <div style={{
            background: bgColor,
            padding: '6px 10px',
            borderRadius: 6,
            display: 'inline-block'
          }}>
            <span style={{
              color: statusColor,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14
            }}>
              {icon} {status}
            </span>
          </div>
        );
      },
    },
    // 🆕 Colonne Diagnostic
    {
      id: 'diagnostic',
      header: 'Diagnostic',
      cell: ({ row }) => {
        const diagnostic = getDiagnostic(row.original);
        
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
      },
    },
  ], []);

  const table = useReactTable({
    data: runs,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div>
      {/* Barre de recherche */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          type="search"
          placeholder="🔍 Rechercher dans l'historique..."
          value={globalFilter ?? ''}
          onChange={(e) => setGlobalFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            fontSize: 14,
            width: 320,
            outline: 'none'
          }}
        />
        <span style={{ fontSize: 14, color: '#6b7280' }}>
          {table.getFilteredRowModel().rows.length} résultat(s)
        </span>
      </div>

      {/* Tableau */}
      <div style={{ 
        border: '1px solid #e5e7eb', 
        borderRadius: 8, 
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <table style={{ 
          borderCollapse: 'collapse', 
          width: '100%',
          background: '#fff'
        }}>
          <thead style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      textAlign: 'left',
                      padding: '12px 16px',
                      cursor: header.column.getCanSort() ? 'pointer' : 'default',
                      userSelect: 'none',
                      fontWeight: 600,
                      fontSize: 14,
                      color: '#374151',
                      borderRight: '1px solid #e5e7eb', // ✅ Lignes verticales
                      position: 'relative'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() && (
                        <span style={{ fontSize: 12 }}>
                          {header.column.getIsSorted() === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, index) => (
              <tr
                key={row.id}
                style={{
                  background: row.original.status === 'running' 
                    ? '#fffbf0' 
                    : index % 2 === 0 ? '#fff' : '#f9fafb',
                  borderBottom: '1px solid #e5e7eb'
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{
                      padding: '12px 16px',
                      fontSize: 14,
                      borderRight: '1px solid #e5e7eb', // ✅ Lignes verticales
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
