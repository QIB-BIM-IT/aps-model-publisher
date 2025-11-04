import React, { useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
  getToken,
  getUserApsToken as getUserToken,
  listSheets,
} from '../services/api';
import './PDFExportPanel.css';

export function PDFExportPanel({ selectedFile, projectId, folderId }) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [filters, setFilters] = useState({
    includeSheets: true,
    includeViews2D: true,
    includeMarkups: true,
  });
  const [selectionMode, setSelectionMode] = useState('filters');
  const [availableSheets, setAvailableSheets] = useState([]);
  const [availableViews, setAvailableViews] = useState([]);
  const [selectedSheetIds, setSelectedSheetIds] = useState([]);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [sheetLoadError, setSheetLoadError] = useState(null);
  const [exportMode, setExportMode] = useState('individual');
  const [combinedFileName, setCombinedFileName] = useState('Projet-Final.pdf');

  const totalSheets = availableSheets.length;
  const selectedCount = selectedSheetIds.length;

  const selectedSheets = useMemo(
    () => availableSheets.filter((sheet) => selectedSheetIds.includes(sheet.id)),
    [availableSheets, selectedSheetIds]
  );

  const canExport =
    !isExporting &&
    !!selectedFile &&
    !!folderId &&
    (selectionMode !== 'custom' || selectedCount > 0);

  const toggleFilter = (key) => {
    setFilters((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSheetToggle = (sheetId) => {
    setSelectedSheetIds((prev) =>
      prev.includes(sheetId)
        ? prev.filter((id) => id !== sheetId)
        : [...prev, sheetId]
    );
  };

  const handleSelectAllSheets = () => {
    if (availableSheets.length === 0) {
      return;
    }
    setSelectedSheetIds(availableSheets.map((sheet) => sheet.id));
  };

  const handleClearSheets = () => setSelectedSheetIds([]);

  const handleLoadSheets = async () => {
    if (!selectedFile) {
      toast.error('Sélectionne un fichier Revit en premier');
      return;
    }

    setLoadingSheets(true);
    setSheetLoadError(null);

    try {
      const { sheets, views2D } = await listSheets(selectedFile.urn, projectId);

      setAvailableSheets(sheets);
      setAvailableViews(views2D);
      setSelectedSheetIds((prev) => {
        if (!prev.length) {
          return [];
        }
        const validIds = new Set((sheets || []).map((sheet) => sheet.id));
        return prev.filter((id) => validIds.has(id));
      });

      toast.success(`✅ ${sheets?.length || 0} feuille(s) chargée(s)`);
    } catch (error) {
      console.error('Load sheets error:', error);
      setSheetLoadError(error.message);
      toast.error(`Impossible de charger les sheets: ${error.message}`);
    } finally {
      setLoadingSheets(false);
    }
  };

  const handleExportToACC = async () => {
    if (!selectedFile) {
      toast.error('Sélectionne un fichier en premier');
      return;
    }

    if (!folderId) {
      toast.error('Choisis un dossier de destination');
      return;
    }

    if (selectionMode === 'custom' && selectedCount === 0) {
      toast.error('Choisis au moins une feuille pour un export personnalisé');
      return;
    }

    if (exportMode === 'combined' && !combinedFileName.trim()) {
      toast.error('Entre un nom de fichier pour le PDF combiné');
      return;
    }

    setIsExporting(true);
    setExportProgress('Export ACC en cours...');

    try {
      const userToken = await getUserToken();
      const jwtToken = getToken();

      if (!jwtToken) {
        throw new Error('Session expirée, reconnecte-toi');
      }

      const payload = {
        fileUrn: selectedFile.urn,
        projectId,
        folderId,
        filters,
        selectionMode,
        customSheets: selectionMode === 'custom' ? selectedSheets : [],
        exportMode,
        combinedFileName: exportMode === 'combined' ? combinedFileName.trim() : undefined,
      };

      const response = await fetch('/api/pdf-export/export-and-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-token': userToken,
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok || data.success === false) {
        const message = data?.message || data?.error || 'Export échoué';
        throw new Error(message);
      }

      const uploadLabel = exportMode === 'combined' ? 'PDF combiné' : 'PDF(s)';
      const successMessage = data.failed > 0
        ? `✅ ${data.uploaded} ${uploadLabel} uploadé(s) (${data.failed} échec)`
        : `✅ ${data.uploaded} ${uploadLabel} uploadé(s) sur ACC`;

      toast.success(successMessage, { autoClose: 5000 });

      if (Array.isArray(data.errors)) {
        data.errors.forEach((err) => {
          if (err?.filename) {
            toast.error(`Échec upload: ${err.filename}`, { autoClose: 4000 });
          }
        });
      }

      if (Array.isArray(data.unmatchedSheets) && data.unmatchedSheets.length > 0) {
        toast.warn(
          `⚠️ ${data.unmatchedSheets.length} feuille(s) n'ont pas été trouvées dans les PDFs générés`,
          { autoClose: 7000 }
        );
      }
    } catch (error) {
      console.error('Export error:', error);
      toast.error(`Export échoué: ${error.message}`);
    } finally {
      setIsExporting(false);
      setExportProgress('');
    }
  };

  return (
    <div className="pdf-export-panel">
      <div className="pdf-export-header">
        <h3>📄 Export PDF hybride</h3>
        <p>Choisis comment extraire tes feuilles Revit et leur format de sortie.</p>
      </div>

      <div className="pdf-export-section">
        <div className="pdf-export-section-title">Section 1 · Filtres globaux</div>
        <div className="pdf-export-checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={filters.includeSheets}
              onChange={() => toggleFilter('includeSheets')}
            />
            <span>Toutes les sheets disponibles</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.includeViews2D}
              onChange={() => toggleFilter('includeViews2D')}
            />
            <span>Toutes les vues 2D</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.includeMarkups}
              onChange={() => toggleFilter('includeMarkups')}
            />
            <span>Markups et annotations</span>
          </label>
        </div>
      </div>

      <div className="pdf-export-section">
        <div className="pdf-export-section-title">Section 2 · Sélection custom</div>
        <div className="pdf-export-radio-group">
          <label>
            <input
              type="radio"
              name="selectionMode"
              value="filters"
              checked={selectionMode === 'filters'}
              onChange={() => setSelectionMode('filters')}
            />
            <span>Utiliser les filtres globaux ci-dessus</span>
          </label>
          <label>
            <input
              type="radio"
              name="selectionMode"
              value="custom"
              checked={selectionMode === 'custom'}
              onChange={() => setSelectionMode('custom')}
            />
            <span>Sélectionner des sheets spécifiques</span>
          </label>
        </div>

        {selectionMode === 'custom' && (
          <div className="pdf-export-custom-block">
            <div className="pdf-export-custom-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={handleLoadSheets}
                disabled={loadingSheets || !selectedFile}
              >
                {loadingSheets ? 'Chargement...' : 'Charger les sheets'}
              </button>
              <div className="pdf-export-custom-stats">
                <span>{totalSheets} sheet(s) disponibles</span>
                <span>{availableViews.length} vue(s) 2D détectées</span>
              </div>
            </div>

            {sheetLoadError && (
              <div className="pdf-export-error">⚠️ {sheetLoadError}</div>
            )}

            {totalSheets > 0 ? (
              <div className="pdf-export-sheet-list">
                <div className="pdf-export-sheet-actions">
                  <span>
                    {selectedCount}/{totalSheets} sheet(s) sélectionnée(s)
                  </span>
                  <div className="pdf-export-sheet-buttons">
                    <button type="button" onClick={handleSelectAllSheets}>
                      Tout sélectionner
                    </button>
                    <button type="button" onClick={handleClearSheets}>
                      Tout désélectionner
                    </button>
                  </div>
                </div>

                <div className="pdf-export-sheet-items">
                  {availableSheets.map((sheet) => {
                    const labelNumber = sheet.number ? `${sheet.number} - ` : '';
                    return (
                      <label key={sheet.id}>
                        <input
                          type="checkbox"
                          checked={selectedSheetIds.includes(sheet.id)}
                          onChange={() => handleSheetToggle(sheet.id)}
                        />
                        <div>
                          <div className="pdf-export-sheet-name">
                            {labelNumber}
                            {sheet.name}
                          </div>
                          {sheet.category && (
                            <div className="pdf-export-sheet-meta">{sheet.category}</div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="pdf-export-empty">Aucune feuille chargée pour le moment.</p>
            )}
          </div>
        )}
      </div>

      <div className="pdf-export-section">
        <div className="pdf-export-section-title">Section 3 · Format de sortie</div>
        <div className="pdf-export-radio-group">
          <label>
            <input
              type="radio"
              name="exportMode"
              value="individual"
              checked={exportMode === 'individual'}
              onChange={() => setExportMode('individual')}
            />
            <span>Export individuel (1 PDF par sheet)</span>
          </label>
          <label>
            <input
              type="radio"
              name="exportMode"
              value="combined"
              checked={exportMode === 'combined'}
              onChange={() => setExportMode('combined')}
            />
            <span>Combiner en un seul PDF</span>
          </label>
        </div>

        {exportMode === 'combined' && (
          <div className="pdf-export-combined-input">
            <label htmlFor="combinedFileName">Nom du fichier combiné</label>
            <input
              id="combinedFileName"
              type="text"
              value={combinedFileName}
              onChange={(event) => setCombinedFileName(event.target.value)}
              placeholder="Projet-Final.pdf"
            />
            <span className="pdf-export-helper">L'extension .pdf sera ajoutée si nécessaire</span>
          </div>
        )}
      </div>

      <button
        onClick={handleExportToACC}
        disabled={!canExport}
        className="primary-btn"
      >
        {isExporting ? (
          <>
            <span className="spinner" aria-hidden="true"></span>
            {exportProgress || 'Traitement en cours...'}
          </>
        ) : (
          <>
            <span role="img" aria-label="export">📤</span>
            Exporter vers ACC
          </>
        )}
      </button>

      {isExporting && (
        <div className="pdf-export-progress">{exportProgress}</div>
      )}
    </div>
  );
}

export default PDFExportPanel;
