import React, { useMemo, useState, useEffect } from 'react';
import { exportWithCache } from '../services/api';

function getSheetKey(sheet) {
  if (!sheet) return '';
  if (sheet.id !== undefined && sheet.id !== null) return String(sheet.id);
  if (sheet.number) return `number:${sheet.number}`;
  if (sheet.name) return `name:${sheet.name}`;
  return JSON.stringify(sheet);
}

/**
 * Modal d'export PDF avec sélection custom de sheets
 */
export function PDFExportModal({
  fileUrn,
  projectId,
  topFolders,
  childrenMap,
  onLoadChildren,
  onClose,
  onConfirm,
  onRunNow,
  onSchedule,
  isExporting,
  showScheduleButton = false,
  jobName: initialJobName = '',
  onJobNameChange,
  selectedHour: initialSelectedHour = '02:00',
  setSelectedHour,
  timezone: initialTimezone = 'UTC',
  setTimezone,
  hourOptions = [],
  timezoneOptions = [],
  defaultTimezone = 'UTC',
}) {
  // Options d'export
  const [includeMarkups, setIncludeMarkups] = useState(true);

  // Sélection de sheets
  const [selectionMode, setSelectionMode] = useState('all'); // 'all' ou 'custom'
  const [availableSheets, setAvailableSheets] = useState([]);
  const [availableMarkups, setAvailableMarkups] = useState([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [selectedSheetKeys, setSelectedSheetKeys] = useState([]);
  const [cacheKey, setCacheKey] = useState(null);
  const selectedSheetCount = selectedSheetKeys.length;

  // Format de sortie
  const [merge, setMerge] = useState(false);
  const [mergedFileName, setMergedFileName] = useState('Documents.pdf');
  
  // Nom de la tâche (pour la planification)
  const [jobName, setJobName] = useState(initialJobName);
  
  useEffect(() => {
    if (onJobNameChange) {
      onJobNameChange(jobName);
    }
  }, [jobName, onJobNameChange]);

  // Dossier destination
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [hasSheetsLoaded, setHasSheetsLoaded] = useState(false);
  const lastLoadedFileUrnRef = React.useRef(null);
  const loadingRef = React.useRef(false);

  const selectedSheets = useMemo(() => {
    if (selectionMode !== 'custom') return [];
    const keySet = new Set(selectedSheetKeys);
    return availableSheets.filter((sheet) => keySet.has(getSheetKey(sheet)));
  }, [selectionMode, selectedSheetKeys, availableSheets]);

  const handleLoadSheets = React.useCallback(async () => {
    if (!fileUrn) {
      alert('Sélectionne un fichier Revit valide avant de charger les sheets');
      return;
    }

    // Éviter les appels multiples simultanés
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoadingSheets(true);
    setLoadingProgress(0);

    let progressInterval;

    try {
      progressInterval = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 90) return 90;
          return prev + Math.random() * 25;
        });
      }, 800);

      const result = await exportWithCache(fileUrn, projectId);

      const sheets = Array.isArray(result?.sheets)
        ? result.sheets.map((s) => ({
            ...s,
            name: typeof s?.name === 'string' ? s.name.replace(/^Feuilles\s*[-_]?\s*/i, '') : s?.name,
          }))
        : [];
      setAvailableSheets(sheets);
      setAvailableMarkups(Array.isArray(result?.markups) ? result.markups : []);
      setCacheKey(result?.cacheKey || null);
      // Tout sélectionner par défaut
      const keys = sheets.map((s) => getSheetKey(s)).filter(Boolean);
      setSelectedSheetKeys(keys);
      setHasSheetsLoaded(true);
      lastLoadedFileUrnRef.current = fileUrn;

      setLoadingProgress(100);

      setTimeout(() => {
        setLoadingProgress(0);
      }, 800);
    } catch (error) {
      console.error('Erreur chargement sheets:', error);
      const errorMessage = error?.message || error?.response?.data?.message || 'Impossible de charger les sheets';
      alert(errorMessage);
      setHasSheetsLoaded(false);
      lastLoadedFileUrnRef.current = null;
      setLoadingProgress(0);
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      setLoadingSheets(false);
      loadingRef.current = false;
    }
  }, [fileUrn, projectId]);

  // Charger automatiquement les sheets quand le modal s'ouvre
  useEffect(() => {
    // Réinitialiser l'état quand le modal se ferme (pas de fileUrn)
    if (!fileUrn) {
      setHasSheetsLoaded(false);
      setAvailableSheets([]);
      setSelectedSheetKeys([]);
      setCacheKey(null);
      lastLoadedFileUrnRef.current = null;
      setSelectedFolder(null);
      loadingRef.current = false;
      return;
    }

    // Charger seulement si :
    // 1. Le fichier a changé OU
    // 2. Les sheets n'ont jamais été chargés pour ce fichier
    const fileChanged = lastLoadedFileUrnRef.current !== fileUrn;
    const needsLoad = !hasSheetsLoaded || fileChanged;

    if (needsLoad && !loadingSheets && !loadingRef.current) {
      handleLoadSheets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrn]); // Seulement dépendre de fileUrn pour éviter les boucles

  const handleExport = () => {
    if (!selectedFolder) {
      alert('Sélectionne un dossier de destination');
      return;
    }

    if (selectionMode === 'custom' && selectedSheetCount === 0) {
      alert('Sélectionne au moins un sheet');
      return;
    }

    if (merge && !mergedFileName.trim()) {
      alert('Entre un nom pour le fichier fusionné');
      return;
    }

    onConfirm({
      folderId: selectedFolder.id,
      mode: selectionMode,
      customSheets: selectionMode === 'custom' ? selectedSheets : [],
      merge,
      mergedFileName: merge ? mergedFileName.trim() : null,
      cacheKey,
      availableSheets,
      availableMarkups,
      options: {
        includeSheets: true, // Toujours inclure les sheets
        includeViews2D: false, // Plus de vues 2D
        includeMarkups,
      },
    });
  };

  const handlePrimaryAction = () => {
    if (loadingSheets || isExporting) return;

    handleExport();
  };

  const primaryButtonLabel = useMemo(() => {
    if (loadingSheets) return '⏳ Chargement...';
    return isExporting ? '⏳ Export en cours...' : '📄 Exporter vers ACC';
  }, [loadingSheets, isExporting]);

  const isPrimaryDisabled =
    loadingSheets ||
    isExporting ||
    !selectedFolder ||
    (selectionMode === 'custom' && selectedSheetCount === 0);

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
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '40px 16px',
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 32,
          maxWidth: 700,
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 80px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 700, color: '#0f172a' }}>
          📄 Export PDF to ACC
        </h2>
        <p style={{ margin: '0 0 24px 0', fontSize: 14, color: '#64748b' }}>
          Configure ton export et choisis la destination
        </p>

        {/* SECTION 1: Chargement des sheets */}
        {loadingSheets && (
          <div
            style={{
              padding: 16,
              background: 'rgba(239, 246, 255, 0.5)',
              borderRadius: 10,
              border: '1px solid rgba(37, 99, 235, 0.2)',
              marginBottom: 20,
            }}
          >
            <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
              ⏳ Chargement des sheets disponibles...
            </h4>
            <div
              style={{
                width: '100%',
                height: 8,
                borderRadius: 4,
                background: 'rgba(148, 163, 184, 0.2)',
                overflow: 'hidden',
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                  width: `${loadingProgress}%`,
                  transition: 'width 0.3s ease-out',
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
              {Math.round(loadingProgress)}% complété (2-5 minutes)
            </p>
          </div>
        )}

        {/* SECTION 2: Sélection de sheets */}
        {hasSheetsLoaded && !loadingSheets && (
          <div
            style={{
              padding: 16,
              background: 'rgba(248, 250, 252, 0.8)',
              borderRadius: 10,
              border: '1px solid rgba(148, 163, 184, 0.3)',
              marginBottom: 20,
            }}
          >
            <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
              🎯 Sélection de sheets ({availableSheets.length} disponibles)
            </h4>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: 10, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="selectionMode"
                  checked={selectionMode === 'all'}
                  onChange={() => setSelectionMode('all')}
                  style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>
                  Tous les sheets disponibles
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="selectionMode"
                  checked={selectionMode === 'custom'}
                  onChange={() => setSelectionMode('custom')}
                  style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>
                  Sélectionner des sheets spécifiques
                </span>
              </label>
            </div>

            {selectionMode === 'custom' && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 13, color: '#64748b' }}>
                  {selectedSheetCount}/{availableSheets.length} sheets sélectionnés
                </div>
                <div
                  style={{
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    maxHeight: 200,
                    overflowY: 'auto',
                    background: '#fff',
                  }}
                >
                  {availableSheets
                    .slice()
                    .sort((a, b) => {
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
                    })
                    .map((sheet) => {
                    const key = getSheetKey(sheet);
                    const isChecked = selectedSheetKeys.includes(key);

                    return (
                      <label
                        key={key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '8px 12px',
                          borderBottom: '1px solid #e5e7eb',
                          cursor: 'pointer',
                          background: isChecked ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSheetKeys((prev) =>
                                prev.includes(key) ? prev : [...prev, key]
                              );
                            } else {
                              setSelectedSheetKeys((prev) => prev.filter((id) => id !== key));
                            }
                          }}
                          style={{ marginRight: 10, cursor: 'pointer', accentColor: '#2563eb' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937' }}>
                            {sheet.number && <strong>{sheet.number}</strong>} {sheet.number ? ' - ' : ''}
                            {sheet.name}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION 3: Options d'export */}
        {hasSheetsLoaded && !loadingSheets && (
          <div
            style={{
              padding: 16,
              background: 'rgba(239, 246, 255, 0.5)',
              borderRadius: 10,
              border: '1px solid rgba(37, 99, 235, 0.2)',
              marginBottom: 20,
            }}
          >
            <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
              ⚙️ Options d'export
            </h4>

            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeMarkups}
                onChange={(e) => setIncludeMarkups(e.target.checked)}
                style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
              />
              <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>
                ✓ Inclure markups et annotations
              </span>
            </label>
          </div>
        )}

        {/* SECTION 4: Format de sortie */}
        <div
          style={{
            padding: 16,
            background: 'rgba(248, 250, 252, 0.8)',
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.3)',
            marginBottom: 20,
          }}
        >
          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
            📦 Format de sortie
          </h4>

          <label style={{ display: 'flex', alignItems: 'center', marginBottom: 10, cursor: 'pointer' }}>
            <input
              type="radio"
              name="outputFormat"
              checked={!merge}
              onChange={() => setMerge(false)}
              style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
            />
            <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>
              📄 Export individuel (1 PDF par sheet)
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', marginBottom: 12, cursor: 'pointer' }}>
            <input
              type="radio"
              name="outputFormat"
              checked={merge}
              onChange={() => setMerge(true)}
              style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
            />
            <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>
              🔗 Combiner en un seul PDF
            </span>
          </label>

          {merge && (
            <div style={{ marginLeft: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
                Nom du fichier fusionné:
              </label>
              <input
                type="text"
                value={mergedFileName}
                onChange={(e) => setMergedFileName(e.target.value)}
                placeholder="Documents.pdf"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  fontSize: 14,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
        </div>

        {/* SECTION 5: Sélection dossier */}
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
            {Array.isArray(topFolders) && topFolders.length > 0 ? (
              topFolders.map((folder) => (
                <FolderTreeNode
                  key={folder.id}
                  folder={folder}
                  childrenMap={childrenMap}
                  onLoadChildren={onLoadChildren}
                  selectedFolder={selectedFolder}
                  onSelectFolder={setSelectedFolder}
                />
              ))
            ) : (
              <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>
                Aucun dossier disponible pour ce projet
              </div>
            )}
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

        {/* Heure et fuseau horaire (pour la planification) */}
        {showScheduleButton && (
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
              🕐 Planification
            </h4>
            <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 160px', minWidth: 180 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Heure de publication
                </label>
                <select
                  value={initialSelectedHour}
                  onChange={(e) => setSelectedHour && setSelectedHour(e.target.value)}
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
                  {hourOptions.map((option) => (
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
                  value={initialTimezone}
                  onChange={(e) => setTimezone && setTimezone(e.target.value)}
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
                  Fuseau détecté : <strong>{defaultTimezone}</strong>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Nom de la tâche (pour la planification) */}
        {showScheduleButton && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: '#475569' }}>
              📝 Nom de la tâche (requis pour la planification)
            </label>
            <input
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="Ex: Export PDF - Architecte"
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
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onClose}
            disabled={isExporting}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid #d1d5db',
              background: '#fff',
              color: '#475569',
              fontWeight: 600,
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.5 : 1,
            }}
          >
            Annuler
          </button>
          {showScheduleButton && onRunNow && onSchedule ? (
            <>
              <button
                onClick={() => {
                  const config = {
                    folderId: selectedFolder.id,
                    mode: selectionMode,
                    customSheets: selectionMode === 'custom' ? selectedSheets : [],
                    merge,
                    mergedFileName: merge ? mergedFileName.trim() : null,
                    cacheKey,
                    availableSheets,
                    availableMarkups,
                    options: {
                      includeSheets: true,
                      includeViews2D: false,
                      includeMarkups,
                    },
                  };
                  onRunNow(config);
                }}
                disabled={isPrimaryDisabled || isExporting}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background:
                    isPrimaryDisabled || isExporting
                      ? 'rgba(148, 163, 184, 0.3)'
                      : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: isPrimaryDisabled || isExporting ? 'not-allowed' : 'pointer',
                }}
              >
                {isExporting ? '⏳ Export...' : '🚀 Run Now'}
              </button>
              <button
                onClick={() => {
                  if (!jobName.trim()) {
                    alert('⚠️ Entre un nom pour la tâche');
                    return;
                  }
                  // Calculer le cronExpression à partir de l'heure sélectionnée
                  const [hour, minute] = initialSelectedHour.split(':');
                  const cronExpression = `${minute} ${hour} * * *`;
                  
                  const config = {
                    folderId: selectedFolder.id,
                    mode: selectionMode,
                    customSheets: selectionMode === 'custom' ? selectedSheets : [],
                    merge,
                    mergedFileName: merge ? mergedFileName.trim() : null,
                    cacheKey,
                    availableSheets,
                    availableMarkups,
                    jobName: jobName.trim(),
                    cronExpression,
                    timezone: initialTimezone,
                    options: {
                      includeSheets: true,
                      includeViews2D: false,
                      includeMarkups,
                    },
                  };
                  onSchedule(config);
                }}
                disabled={isPrimaryDisabled || isExporting || !jobName.trim()}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background:
                    isPrimaryDisabled || isExporting
                      ? 'rgba(148, 163, 184, 0.3)'
                      : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: isPrimaryDisabled || isExporting ? 'not-allowed' : 'pointer',
                }}
              >
                {isExporting ? '⏳ Planification...' : '📅 Planifier'}
              </button>
            </>
          ) : (
            <button
              onClick={handlePrimaryAction}
              disabled={isPrimaryDisabled}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background:
                  isPrimaryDisabled
                    ? 'rgba(148, 163, 184, 0.3)'
                    : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#fff',
                fontWeight: 600,
                cursor:
                  isPrimaryDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {primaryButtonLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Composant FolderTreeNode (même que dans PDFSaveAsModal.jsx)
function FolderTreeNode({ folder, childrenMap, onLoadChildren, selectedFolder, onSelectFolder }) {
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

export default PDFExportModal;
