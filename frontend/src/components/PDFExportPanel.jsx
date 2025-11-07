import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  getToken,
  getUserApsToken as getUserToken,
  exportWithCache,
} from '../services/api';
import './PDFExportPanel.css';

export function PDFExportPanel({ selectedFile, projectId, folderId }) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [cacheKey, setCacheKey] = useState(null);
  const [sheetsLoaded, setSheetsLoaded] = useState(false);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [sheetLoadError, setSheetLoadError] = useState(null);
  const [availableSheets, setAvailableSheets] = useState([]);
  const [availableViews, setAvailableViews] = useState([]);
  const [availableMarkups, setAvailableMarkups] = useState([]);
  const [selectedSheetNames, setSelectedSheetNames] = useState([]);
  const [exportMode, setExportMode] = useState('individual');
  const [combinedFileName, setCombinedFileName] = useState('Projet-Final.pdf');
  const [resolvedUrns, setResolvedUrns] = useState(null);

  useEffect(() => {
    setResolvedUrns(null);
    setCacheKey(null);
    setSheetsLoaded(false);
    setAvailableSheets([]);
    setAvailableViews([]);
    setAvailableMarkups([]);
    setSelectedSheetNames([]);
    setSheetLoadError(null);
    setExportProgress('');
  }, [selectedFile?.urn]);

  const totalSheets = availableSheets.length;
  const selectedCount = selectedSheetNames.length;

  const canExport =
    !isExporting &&
    !!selectedFile &&
    !!folderId &&
    selectedCount > 0;

  const handleSheetToggle = (sheetName) => {
    setSelectedSheetNames((prev) =>
      prev.includes(sheetName)
        ? prev.filter((name) => name !== sheetName)
        : [...prev, sheetName]
    );
  };

  const handleSelectAllSheets = () => {
    if (availableSheets.length === 0) {
      return;
    }
    setSelectedSheetNames(availableSheets.map((sheet) => sheet.name));
  };

  const handleClearSheets = () => setSelectedSheetNames([]);

  const handleLoadSheets = async () => {
    if (!selectedFile) {
      toast.error('Sélectionne un fichier Revit en premier');
      return;
    }

    setLoadingSheets(true);
    setSheetLoadError(null);
    setSheetsLoaded(false);

    try {
      setExportProgress('Export en cours pour obtenir la liste des sheets (2-5 min)...');

      const result = await exportWithCache(
        selectedFile.urn,
        projectId
      );

      const normalizedSheets = (result.sheets || []).map((sheet, index) => ({
        ...sheet,
        id: sheet.id || sheet.guid || sheet.objectId || sheet.name || `sheet-${index}`,
      }));

      setCacheKey(result.cacheKey || null);
      setAvailableSheets(normalizedSheets);
      setAvailableViews(result.views2D || []);
      setAvailableMarkups(result.markups || []);
      setResolvedUrns(result.resolvedUrns || null);

      const allSheetNames = normalizedSheets.map((sheet) => sheet.name);
      setSelectedSheetNames(allSheetNames);

      setSheetsLoaded(true);

      const totalPdfs = result.stats?.total || 0;
      const sheetsCount = result.stats?.sheets || normalizedSheets.length || 0;
      const markupsCount = result.stats?.markups || (result.markups?.length ?? 0);
      toast.success(`✅ ${sheetsCount} feuille(s) chargée(s) (${totalPdfs} PDFs total, ${markupsCount} markup(s))`);

      setExportProgress('');
    } catch (error) {
      console.error('Load sheets error:', error);
      setSheetLoadError(error.message);
      toast.error(`Impossible de charger les sheets: ${error.message}`);
      setExportProgress('');
    } finally {
      setLoadingSheets(false);
    }
  };

  const handleExportToACC = async () => {
    if (!selectedFile || !folderId || selectedCount === 0) {
      toast.error('Sélectionne au moins une feuille et un dossier de destination');
      return;
    }

    if (exportMode === 'combined' && !combinedFileName.trim()) {
      toast.error('Entre un nom de fichier pour le PDF combiné');
      return;
    }

    if (!cacheKey) {
      toast.error('Cache expiré, recharge les sheets');
      return;
    }

    setIsExporting(true);
    setExportProgress('Upload vers ACC en cours...');

    try {
      const userToken = await getUserToken();
      const jwtToken = getToken();

      if (!jwtToken) {
        throw new Error('Session expirée, reconnecte-toi');
      }

      const payload = {
        cacheKey,
        projectId,
        folderId,
        selectedSheetNames,
        exportMode,
        combinedFileName: exportMode === 'combined' ? combinedFileName.trim() : undefined,
      };

      const response = await fetch('/api/pdf-export/export-from-cache', {
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
      {/* ========== HEADER ========== */}
      <div className="pdf-export-header">
        <h3>📄 Export PDF vers ACC</h3>
        <p>Exporte tes feuilles Revit directement sur Autodesk Construction Cloud</p>
      </div>

      {/* ========== SECTION 1: MODÈLE SÉLECTIONNÉ + BOUTON CHARGER ========== */}
      <div className="pdf-export-section">
        <div className="pdf-export-section-title">Étape 1 · Charger les sheets disponibles</div>

        {/* Info modèle sélectionné */}
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(239, 246, 255, 0.5)',
            borderRadius: 8,
            marginBottom: 16,
            border: '1px solid rgba(37, 99, 235, 0.2)',
          }}
        >
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>
            Modèle sélectionné:
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1f2937' }}>
            {selectedFile?.name || selectedFile?.displayName || 'Aucun fichier sélectionné'}
          </div>
        </div>

        {/* Bouton charger OU Badge succès */}
        {!sheetsLoaded ? (
          <>
            <button
              type="button"
              className="primary-btn"
              onClick={handleLoadSheets}
              disabled={loadingSheets || !selectedFile}
              style={{ width: '100%' }}
            >
              {loadingSheets ? (
                <>
                  <span className="spinner" aria-hidden="true"></span>
                  {exportProgress || 'Chargement en cours...'}
                </>
              ) : (
                <>
                  <span role="img" aria-label="load">
                    📋
                  </span>
                  Charger les sheets disponibles
                </>
              )}
            </button>

            {!selectedFile && (
              <div className="pdf-export-helper" style={{ marginTop: 8, color: '#94a3b8' }}>
                ⚠️ Sélectionne d'abord un fichier Revit (.rvt) dans la liste ci-dessus
              </div>
            )}

            {loadingSheets && (
              <div
                className="pdf-export-progress"
                style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}
              >
                ⏳ Export en cours (2-5 minutes)... Le ZIP est téléchargé et analysé pour obtenir la
                liste des sheets.
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 24 }}>✅</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#059669' }}>
                {totalSheets} feuille(s) chargée(s)
              </div>
              <div style={{ fontSize: 12, color: '#047857' }}>
                {availableViews.length} vue(s) 2D disponible(s)
              </div>
            </div>
            <button
              type="button"
              onClick={handleLoadSheets}
              className="secondary-btn"
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              🔄 Recharger
            </button>
          </div>
        )}

        {/* Erreur de chargement */}
        {sheetLoadError && (
          <div className="pdf-export-error" style={{ marginTop: 12 }}>
            ⚠️ {sheetLoadError}
          </div>
        )}
      </div>

      {/* ========== SECTION 2: LISTE DES SHEETS (Apparaît après chargement) ========== */}
      {sheetsLoaded && totalSheets > 0 && (
        <div className="pdf-export-section">
          <div className="pdf-export-section-title">
            Étape 2 · Sélectionne les feuilles à exporter
          </div>

          <div className="pdf-export-sheet-list">
            {/* Actions: Tout sélectionner / Désélectionner */}
            <div className="pdf-export-sheet-actions">
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {selectedCount}/{totalSheets} feuille(s) sélectionnée(s)
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

            {/* Liste scrollable avec checkboxes */}
            <div className="pdf-export-sheet-items">
              {availableSheets.map((sheet) => (
                <label key={sheet.name}>
                  <input
                    type="checkbox"
                    checked={selectedSheetNames.includes(sheet.name)}
                    onChange={() => handleSheetToggle(sheet.name)}
                  />
                  <div>
                    <div className="pdf-export-sheet-name">
                      {sheet.name}
                    </div>
                    <div className="pdf-export-sheet-meta">
                      {(sheet.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========== SECTION 3: OPTIONS D'EXPORT (Apparaît si des sheets sont sélectionnées) ========== */}
      {sheetsLoaded && selectedCount > 0 && (
        <div className="pdf-export-section">
          <div className="pdf-export-section-title">
            Étape 3 · Format de sortie
          </div>

          <div className="pdf-export-radio-group">
            <label>
              <input
                type="radio"
                name="exportMode"
                value="individual"
                checked={exportMode === 'individual'}
                onChange={() => setExportMode('individual')}
              />
              <span>📄 Export individuel (1 PDF par feuille)</span>
            </label>

            <label>
              <input
                type="radio"
                name="exportMode"
                value="combined"
                checked={exportMode === 'combined'}
                onChange={() => setExportMode('combined')}
              />
              <span>🔗 Combiner en un seul PDF</span>
            </label>
          </div>

          {/* Nom du fichier combiné */}
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
              <span className="pdf-export-helper">
                L'extension .pdf sera ajoutée si nécessaire
              </span>
            </div>
          )}
        </div>
      )}

      {/* ========== BOUTON FINAL: EXPORTER VERS ACC ========== */}
      {sheetsLoaded && selectedCount > 0 && (
        <button
          onClick={handleExportToACC}
          disabled={!canExport}
          className="primary-btn"
          style={{ width: '100%' }}
        >
          {isExporting ? (
            <>
              <span className="spinner" aria-hidden="true"></span>
              {exportProgress || 'Upload en cours...'}
            </>
          ) : (
            <>
              <span role="img" aria-label="export">📤</span>
              Exporter vers ACC
            </>
          )}
        </button>
      )}

      {/* Message d'aide si aucune sheet chargée */}
      {!sheetsLoaded && !loadingSheets && (
        <div style={{
          padding: 20,
          textAlign: 'center',
          color: '#94a3b8',
          fontSize: 14
        }}>
          💡 Commence par charger les sheets disponibles pour continuer
        </div>
      )}
    </div>
  );
}

export default PDFExportPanel;
