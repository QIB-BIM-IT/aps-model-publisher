import React from 'react';

/**
 * Modal "Save As" pour sauvegarder les PDFs sur ACC
 */
export function PDFSaveAsModal({
  jobId,
  pdfs,
  topFolders,
  selectedProject,
  childrenMap,
  onLoadChildren,
  onClose,
  onSave,
  isSaving,
}) {
  const [mergeAll, setMergeAll] = React.useState(false);
  const [fileName, setFileName] = React.useState('Documents.pdf');
  const [selectedPdfs, setSelectedPdfs] = React.useState(
    pdfs.map((p) => p.name)
  );
  const [selectedFolder, setSelectedFolder] = React.useState(null);

  const handleSave = () => {
    if (!selectedFolder) {
      alert('Sélectionne un dossier de destination');
      return;
    }

    if (selectedPdfs.length === 0) {
      alert('Sélectionne au moins un PDF');
      return;
    }

    if (mergeAll && !fileName.trim()) {
      alert('Entre un nom pour le fichier fusionné');
      return;
    }

    onSave({
      jobId,
      projectId: selectedProject,
      folderId: selectedFolder.id,
      fileName: mergeAll ? fileName : null,
      pdfNames: selectedPdfs,
      mergeAll,
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2001,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 32,
          maxWidth: 600,
          width: '90%',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 25px 80px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 700, color: '#0f172a' }}>
          💾 Sauvegarder les PDFs
        </h2>
        <p style={{ margin: '0 0 24px 0', fontSize: 14, color: '#64748b' }}>
          Choisis comment sauvegarder tes PDFs sur ACC
        </p>

        {/* Options de fusion */}
        <div
          style={{
            padding: 16,
            background: 'rgba(239, 246, 255, 0.5)',
            borderRadius: 10,
            border: '1px solid rgba(37, 99, 235, 0.2)',
            marginBottom: 20,
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            <input
              type="radio"
              name="saveMode"
              checked={!mergeAll}
              onChange={() => setMergeAll(false)}
              style={{ marginRight: 10, cursor: 'pointer', accentColor: '#2563eb' }}
            />
            <span style={{ fontWeight: 500, color: '#1f2937' }}>📄 Sauvegarder individuellement</span>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="saveMode"
              checked={mergeAll}
              onChange={() => setMergeAll(true)}
              style={{ marginRight: 10, cursor: 'pointer', accentColor: '#2563eb' }}
            />
            <span style={{ fontWeight: 500, color: '#1f2937' }}>
              🔗 Fusionner en un seul PDF
            </span>
          </label>
        </div>

        {/* Nom du fichier fusionné */}
        {mergeAll && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
              📝 Nom du fichier
            </label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Nom du fichier..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#9ca3af' }}>
              L'extension .pdf sera ajoutée automatiquement
            </p>
          </div>
        )}

        {/* Sélection des PDFs */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
            📋 PDFs à inclure ({selectedPdfs.length}/{pdfs.length})
          </label>
          <div
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 8,
              maxHeight: 150,
              overflowY: 'auto',
              background: '#f9fafb',
            }}
          >
            {pdfs.map((pdf) => (
              <label
                key={pdf.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderBottom: '1px solid #e5e7eb',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedPdfs.includes(pdf.name)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedPdfs([...selectedPdfs, pdf.name]);
                    } else {
                      setSelectedPdfs(selectedPdfs.filter((n) => n !== pdf.name));
                    }
                  }}
                  style={{ marginRight: 10, cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937' }}>
                    {pdf.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>
                    {(pdf.size / 1024).toFixed(1)} KB
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Sélection du dossier ACC */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
            📁 Destination (dossier ACC)
          </label>
          <div
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 8,
              maxHeight: 180,
              overflowY: 'auto',
              background: '#f9fafb',
            }}
          >
            {topFolders.map((folder) => (
              <FolderTreeNode
                key={folder.id}
                folder={folder}
                childrenMap={childrenMap}
                onLoadChildren={onLoadChildren}
                selectedFolder={selectedFolder}
                onSelectFolder={setSelectedFolder}
              />
            ))}
          </div>
        </div>

        {selectedFolder && (
          <div
            style={{
              padding: 12,
              background: 'rgba(16, 185, 129, 0.08)',
              borderRadius: 8,
              marginBottom: 20,
              border: '1px solid rgba(16, 185, 129, 0.2)',
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: '#047857', fontWeight: 600 }}>
              ✓ Destination: {selectedFolder.attributes?.displayName || selectedFolder.name}
            </p>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onClose}
            disabled={isSaving}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid #d1d5db',
              background: '#fff',
              color: '#475569',
              fontWeight: 600,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.5 : 1,
            }}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={!selectedFolder || selectedPdfs.length === 0 || isSaving}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 10,
              border: 'none',
              background:
                !selectedFolder || selectedPdfs.length === 0 || isSaving
                  ? 'rgba(148, 163, 184, 0.3)'
                  : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#fff',
              fontWeight: 600,
              cursor:
                !selectedFolder || selectedPdfs.length === 0 || isSaving
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {isSaving ? '⏳ Sauvegarde...' : '💾 Sauvegarder sur ACC'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tree node pour les dossiers
 */
function FolderTreeNode({
  folder,
  childrenMap,
  onLoadChildren,
  selectedFolder,
  onSelectFolder,
}) {
  const [expanded, setExpanded] = React.useState(false);
  const id = folder.id;
  const kids = childrenMap.get(id) || null;
  const loading = kids === 'loading';
  const folderType = folder?.type || folder?.attributes?.extension?.type || '';
  const isFolder = typeof folderType === 'string' && folderType.includes('folder');
  const isSelected = isFolder && selectedFolder?.id === id;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: 4,
          cursor: isFolder ? 'pointer' : 'default',
          background: isSelected ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
          borderLeft: isSelected ? '3px solid #10b981' : '3px solid transparent',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isSelected && isFolder) e.currentTarget.style.background = 'rgba(148, 163, 184, 0.08)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected && isFolder) e.currentTarget.style.background = 'transparent';
        }}
      >
        {isFolder ? (
          <button
            onClick={() => {
              if (!kids) onLoadChildren(id);
              setExpanded((e) => !e);
            }}
            style={{
              cursor: 'pointer',
              width: 20,
              height: 20,
              border: 'none',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: '#475569',
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span style={{ width: 20 }} />
        )}

        <button
          onClick={() => {
            if (isFolder) onSelectFolder(folder);
          }}
          style={{
            flex: 1,
            textAlign: 'left',
            border: 'none',
            background: 'transparent',
            cursor: isFolder ? 'pointer' : 'not-allowed',
            fontSize: 13,
            color: isSelected ? '#059669' : '#1f2937',
            fontWeight: isSelected ? 600 : 400,
            padding: 0,
          }}
        >
          {isFolder ? '📁 ' : '📄 '}
          {folder.attributes?.displayName || folder.name}
        </button>

        {isSelected && <span style={{ fontSize: 12, color: '#10b981' }}>✓</span>}
      </div>

      {expanded && isFolder && (
        <div style={{ marginLeft: 8 }}>
          {loading && <div style={{ fontSize: 12, color: '#9ca3af', padding: '4px 8px' }}>Chargement…</div>}
          {!loading &&
            Array.isArray(kids) &&
            kids.map((child) => (
              <FolderTreeNode
                key={child.id}
                folder={child}
                childrenMap={childrenMap}
                onLoadChildren={onLoadChildren}
                selectedFolder={selectedFolder}
                onSelectFolder={onSelectFolder}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default PDFSaveAsModal;
