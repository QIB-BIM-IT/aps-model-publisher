import React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table';

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
      accessorKey: 'stats.durationMs',
      header: 'Durée',
      cell: ({ getValue }) => {
        const ms = getValue();
        if (!ms) return '-';
        const seconds = Math.round(ms / 1000);
        return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds/60)}m ${seconds%60}s`;
      },
    },
    {
      id: 'fichiers',
      header: 'Fichiers',
      accessorFn: (row) => Array.isArray(row.items) ? row.items.length : 0,
      cell: ({ getValue }) => (
        <div style={{ textAlign: 'center', fontWeight: 500 }}>
          {getValue()}
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
        
        if (status === 'success') { statusColor = '#059669'; icon = '✅'; }
        if (status === 'failed') { statusColor = '#dc2626'; icon = '❌'; }
        if (status === 'running') { statusColor = '#f59e0b'; icon = '🔄'; }

        return (
          <div>
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
            {row.original.message && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                {row.original.message}
              </div>
            )}
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
