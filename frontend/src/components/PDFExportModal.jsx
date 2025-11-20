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
  recurrenceType: initialRecurrenceType = 'daily',
  setRecurrenceType,
  selectedDayOfWeek: initialSelectedDayOfWeek = 1,
  setSelectedDayOfWeek,
  hourOptions = [],
  timezoneOptions = [],
  dayOfWeekOptions = [],
  defaultTimezone = 'UTC',
  notifyOnFailure: initialNotifyOnFailure = false,
  setNotifyOnFailure,
  editingJob = null, // Pour détecter le mode édition
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
  
  // Notification email (utiliser l'état local si setNotifyOnFailure n'est pas fourni)
  const [localNotifyOnFailure, setLocalNotifyOnFailure] = useState(initialNotifyOnFailure);
  const notifyOnFailureValue = setNotifyOnFailure ? initialNotifyOnFailure : localNotifyOnFailure;
  const handleNotifyOnFailureChange = (value) => {
    if (setNotifyOnFailure) {
      setNotifyOnFailure(value);
    } else {
      setLocalNotifyOnFailure(value);
    }
  };
  
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

  // État pour gérer l'expansion de l'arbre de dossiers
  const [expandedFolders, setExpandedFolders] = useState(new Set());

  // Clés pour stocker le dossier de destination dans localStorage
  const STORAGE_KEY = `pdf_export_last_folder_${projectId}`;
  const STORAGE_PATH_KEY = `pdf_export_last_folder_path_${projectId}`;
  const STORAGE_FOLDER_OBJ_KEY = `pdf_export_last_folder_obj_${projectId}`;

  // Fonction pour trouver le chemin vers un dossier (tous ses parents)
  const findFolderPath = React.useCallback((folderId, folders, childrenMap) => {
    const path = [];
    
    // Fonction récursive pour chercher le dossier
    const findInTree = (currentFolders, currentPath = []) => {
      for (const folder of currentFolders) {
        if (folder.id === folderId) {
          // Trouvé ! Retourner le chemin complet
          return [...currentPath, folder.id];
        }
        
        // Chercher dans les enfants
        const children = childrenMap.get(folder.id);
        if (Array.isArray(children) && children.length > 0) {
          const result = findInTree(children, [...currentPath, folder.id]);
          if (result) return result;
        }
      }
      return null;
    };

    const result = findInTree(folders);
    return result || [];
  }, []);

  // Fonction pour auto-expander l'arbre vers un dossier
  const autoExpandToFolder = React.useCallback((folderPathArray) => {
    if (!folderPathArray || folderPathArray.length === 0) return;
    
    // Enlever le dernier élément (le dossier lui-même, on ne l'expand pas)
    const pathToExpand = folderPathArray.slice(0, -1);
    
    // Charger les enfants de tous les dossiers dans le chemin si nécessaire
    let needsLoading = false;
    for (const parentId of pathToExpand) {
      const kids = childrenMap.get(parentId);
      if (!kids) {
        // Les enfants ne sont pas encore chargés, les charger
        console.log('🔄 Chargement des enfants de:', parentId);
        onLoadChildren(parentId);
        needsLoading = true;
      }
    }
    
    // Si on doit charger des dossiers, attendre un peu avant d'expander
    const delay = needsLoading ? 800 : 100;
    
    setTimeout(() => {
      console.log('🌳 Expansion effective du chemin:', pathToExpand);
      setExpandedFolders(new Set(pathToExpand));
    }, delay);
  }, [childrenMap, onLoadChildren]);

  // Pré-remplir les valeurs en mode édition
  useEffect(() => {
    if (editingJob) {
      console.log('✏️ Mode édition activé:', editingJob);
      
      // Pré-remplir le mode et les sheets
      if (editingJob.selectionMode) setSelectionMode(editingJob.selectionMode);
      if (editingJob.exportMode === 'combined') setMerge(true);
      if (editingJob.mergedFileName) setMergedFileName(editingJob.mergedFileName);
      
      // Pré-sélectionner le dossier si possible
      if (editingJob.folderId && topFolders) {
        // Rechercher le dossier dans topFolders
        const folder = topFolders?.find(f => f.id === editingJob.folderId);
        if (folder) {
          console.log('✅ Dossier trouvé dans topFolders (édition):', folder.attributes?.displayName || folder.name);
          setSelectedFolder(folder);
          const path = findFolderPath(editingJob.folderId, topFolders, childrenMap);
          if (path.length > 0) {
            autoExpandToFolder(path);
          }
        } else {
          // Rechercher dans childrenMap
          const allFolders = Array.from(childrenMap?.values() || []).flat();
          const foundFolder = allFolders.find(f => f.id === editingJob.folderId);
          if (foundFolder) {
            console.log('✅ Dossier trouvé dans childrenMap (édition):', foundFolder.attributes?.displayName || foundFolder.name);
            setSelectedFolder(foundFolder);
            const path = findFolderPath(editingJob.folderId, topFolders, childrenMap);
            if (path.length > 0) {
              autoExpandToFolder(path);
            }
          } else {
            // Dossier non trouvé dans l'arbre, créer un objet folder temporaire avec les infos du job
            console.warn('⚠️ Dossier non trouvé dans l\'arbre (édition), création d\'un objet temporaire');
            const tempFolder = {
              id: editingJob.folderId,
              name: editingJob.folderName || 'Dossier',
              attributes: {
                displayName: editingJob.folderName || 'Dossier'
              },
              type: 'folders'
            };
            console.log('📁 Utilisation du dossier temporaire:', tempFolder);
            setSelectedFolder(tempFolder);
            
            // Essayer d'obtenir le chemin depuis localStorage
            try {
              const savedPathJson = localStorage.getItem(`pdf_export_last_folder_path_${projectId}`);
              if (savedPathJson) {
                const savedPath = JSON.parse(savedPathJson);
                if (Array.isArray(savedPath) && savedPath.length > 0) {
                  console.log('🌳 Auto-expansion du chemin (depuis localStorage):', savedPath);
                  autoExpandToFolder(savedPath);
                }
              }
            } catch (e) {
              console.warn('Erreur récupération du chemin depuis localStorage:', e);
            }
          }
        }
      }
    }
  }, [editingJob, topFolders, childrenMap, autoExpandToFolder, findFolderPath, projectId]);

  // Restaurer le dernier dossier sélectionné depuis localStorage (seulement en mode création)
  useEffect(() => {
    // Ne pas restaurer si on est en mode édition (editingJob a priorité)
    if (editingJob || !projectId || !topFolders || topFolders.length === 0) {
      return;
    }

    try {
      const savedFolderId = localStorage.getItem(STORAGE_KEY);
      const savedPathJson = localStorage.getItem(STORAGE_PATH_KEY);
      const savedFolderObjJson = localStorage.getItem(STORAGE_FOLDER_OBJ_KEY);
      
      console.log('📂 Restauration du dossier:', { savedFolderId, savedPathJson, savedFolderObjJson });
      
      if (savedFolderId) {
        // Rechercher le dossier dans topFolders
        const folder = topFolders.find(f => f.id === savedFolderId);
        if (folder) {
          console.log('✅ Dossier trouvé dans topFolders:', folder.attributes?.displayName || folder.name);
          setSelectedFolder(folder);
          // Si on a le chemin sauvegardé, l'utiliser
          if (savedPathJson) {
            try {
              const savedPath = JSON.parse(savedPathJson);
              if (Array.isArray(savedPath) && savedPath.length > 0) {
                console.log('🌳 Auto-expansion du chemin:', savedPath);
                autoExpandToFolder(savedPath);
              }
            } catch (e) {
              console.warn('Erreur parsing du chemin:', e);
            }
          }
          return;
        }

        // Rechercher dans childrenMap si non trouvé dans topFolders
        const allFolders = Array.from(childrenMap?.values() || []).flat();
        const foundFolder = allFolders.find(f => f.id === savedFolderId);
        if (foundFolder) {
          console.log('✅ Dossier trouvé dans childrenMap:', foundFolder.attributes?.displayName || foundFolder.name);
          setSelectedFolder(foundFolder);
          if (savedPathJson) {
            try {
              const savedPath = JSON.parse(savedPathJson);
              if (Array.isArray(savedPath) && savedPath.length > 0) {
                console.log('🌳 Auto-expansion du chemin:', savedPath);
                autoExpandToFolder(savedPath);
              }
            } catch (e) {
              console.warn('Erreur parsing du chemin:', e);
            }
          }
        } else {
          // Dossier non trouvé dans l'arbre, utiliser l'objet sauvegardé
          console.warn('⚠️ Dossier non trouvé dans l\'arbre, utilisation de l\'objet sauvegardé');
          if (savedFolderObjJson) {
            try {
              const savedFolderObj = JSON.parse(savedFolderObjJson);
              console.log('✅ Restauration depuis l\'objet sauvegardé:', savedFolderObj.attributes?.displayName || savedFolderObj.name);
              setSelectedFolder(savedFolderObj);
              // Essayer d'auto-expander avec le chemin sauvegardé
              if (savedPathJson) {
                try {
                  const savedPath = JSON.parse(savedPathJson);
                  if (Array.isArray(savedPath) && savedPath.length > 0) {
                    console.log('🌳 Auto-expansion du chemin (objet sauvegardé):', savedPath);
                    autoExpandToFolder(savedPath);
                  }
                } catch (e) {
                  console.warn('Erreur parsing du chemin:', e);
                }
              }
            } catch (e) {
              console.warn('Erreur parsing de l\'objet dossier:', e);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Erreur lors de la restauration du dossier depuis localStorage:', error);
    }
  }, [editingJob, projectId, topFolders, childrenMap, STORAGE_KEY, STORAGE_PATH_KEY, STORAGE_FOLDER_OBJ_KEY, autoExpandToFolder]);

  // Sauvegarder le dossier sélectionné dans localStorage
  useEffect(() => {
    if (selectedFolder?.id && projectId && topFolders) {
      try {
        localStorage.setItem(STORAGE_KEY, selectedFolder.id);
        
        // Sauvegarder l'objet complet du dossier (pour pouvoir le restaurer même si les parents ne sont pas chargés)
        localStorage.setItem(STORAGE_FOLDER_OBJ_KEY, JSON.stringify({
          id: selectedFolder.id,
          name: selectedFolder.name,
          attributes: selectedFolder.attributes,
          type: selectedFolder.type
        }));
        
        // Trouver et sauvegarder le chemin
        const path = findFolderPath(selectedFolder.id, topFolders, childrenMap);
        if (path.length > 0) {
          localStorage.setItem(STORAGE_PATH_KEY, JSON.stringify(path));
        }
      } catch (error) {
        console.warn('Erreur lors de la sauvegarde du dossier dans localStorage:', error);
      }
    }
  }, [selectedFolder, projectId, topFolders, childrenMap, STORAGE_KEY, STORAGE_PATH_KEY, STORAGE_FOLDER_OBJ_KEY, findFolderPath]);

  const selectedSheets = useMemo(() => {
    if (selectionMode !== 'custom') return [];
    const keySet = new Set(selectedSheetKeys);
    const filtered = availableSheets.filter((sheet) => keySet.has(getSheetKey(sheet)));
    
    // Trier les sheets sélectionnés dans le même ordre que l'affichage
    // (tri par numéro avec localeCompare numérique, puis par nom)
    return filtered.sort((a, b) => {
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
      let errorMessage = error?.message || error?.response?.data?.message || 'Impossible de charger les sheets';
      
      // Améliorer le message si c'est une erreur de sheets non disponibles ou de format URN
      if (errorMessage.includes('ERR_NO_PROCESSABLE_FILES') || 
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
        errorMessage = displayMessage;
      }
      
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
      // NE PAS réinitialiser selectedFolder ici - il doit persister entre les sessions
      // setSelectedFolder(null);
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

  // Debug: Log pour comprendre l'état des boutons
  React.useEffect(() => {
    console.log('🔍 État du bouton:', {
      loadingSheets,
      isExporting,
      selectedFolder: selectedFolder?.id,
      selectedFolderName: selectedFolder?.attributes?.displayName || selectedFolder?.name,
      selectionMode,
      selectedSheetCount,
      isPrimaryDisabled
    });
  }, [loadingSheets, isExporting, selectedFolder, selectionMode, selectedSheetCount, isPrimaryDisabled]);

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
          {editingJob ? '✏️ Modifier l\'export PDF' : '📄 Export PDF to ACC'}
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
                  expandedFolders={expandedFolders}
                  setExpandedFolders={setExpandedFolders}
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
            
            {/* Type de récurrence */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 8 }}>
                Récurrence
              </label>
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="recurrence-pdf"
                    checked={initialRecurrenceType === 'daily'}
                    onChange={() => setRecurrenceType && setRecurrenceType('daily')}
                    style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
                  />
                  <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>📅 Quotidien</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="recurrence-pdf"
                    checked={initialRecurrenceType === 'weekly'}
                    onChange={() => setRecurrenceType && setRecurrenceType('weekly')}
                    style={{ marginRight: 8, cursor: 'pointer', accentColor: '#2563eb' }}
                  />
                  <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>📆 Hebdomadaire</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 16 }}>
              {initialRecurrenceType === 'weekly' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 160px', minWidth: 180 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    Jour de la semaine
                  </label>
                  <select
                    value={initialSelectedDayOfWeek}
                    onChange={(e) => setSelectedDayOfWeek && setSelectedDayOfWeek(Number(e.target.value))}
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
                    {(dayOfWeekOptions.length > 0 ? dayOfWeekOptions : [
                      { value: 0, label: 'Dimanche' },
                      { value: 1, label: 'Lundi' },
                      { value: 2, label: 'Mardi' },
                      { value: 3, label: 'Mercredi' },
                      { value: 4, label: 'Jeudi' },
                      { value: 5, label: 'Vendredi' },
                      { value: 6, label: 'Samedi' },
                    ]).map((option) => (
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

            {/* Notification email */}
            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={notifyOnFailureValue}
                  onChange={(e) => handleNotifyOnFailureChange(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 500 }}>
                  📧 Notification par courriel en cas d'échec
                </span>
              </label>
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4, marginLeft: 26 }}>
                Recevoir un email avec les détails de l'erreur si la tâche échoue
              </p>
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
                  
                  // Fonction pour générer l'expression cron
                  const generateCron = (recurrenceType, hour, dayOfWeek = 1) => {
                    const [hourStr, minuteStr] = hour.split(':');
                    const minute = minuteStr || '0';
                    if (recurrenceType === 'weekly') {
                      return `${minute} ${hourStr} * * ${dayOfWeek}`;
                    } else {
                      return `${minute} ${hourStr} * * *`;
                    }
                  };
                  
                  const cronExpression = generateCron(initialRecurrenceType, initialSelectedHour, initialSelectedDayOfWeek);
                  
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
                    recurrenceType: initialRecurrenceType,
                    selectedDayOfWeek: initialSelectedDayOfWeek,
                    notifyOnFailure: notifyOnFailureValue,
                    selectedHour: initialSelectedHour,
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
                {isExporting ? (editingJob ? '⏳ Mise à jour...' : '⏳ Planification...') : (editingJob ? '✏️ Mettre à jour' : '📅 Planifier')}
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
function FolderTreeNode({ folder, childrenMap, onLoadChildren, selectedFolder, onSelectFolder, expandedFolders, setExpandedFolders }) {
  const id = folder.id;
  const kids = childrenMap.get(id) || null;
  const loading = kids === 'loading';
  const folderType = folder?.type || folder?.attributes?.extension?.type || '';
  const isFolder = typeof folderType === 'string' && folderType.includes('folder');
  const isSelected = isFolder && selectedFolder?.id === id;
  const expanded = expandedFolders.has(id);

  const toggleExpanded = () => {
    const newExpanded = new Set(expandedFolders);
    if (expanded) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedFolders(newExpanded);
  };

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
              toggleExpanded();
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
                expandedFolders={expandedFolders}
                setExpandedFolders={setExpandedFolders}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default PDFExportModal;
