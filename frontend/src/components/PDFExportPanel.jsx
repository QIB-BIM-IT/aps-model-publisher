import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { getUserApsToken as getUserToken } from '../services/api';
import './PDFExportPanel.css';

export function PDFExportPanel({ selectedFile, projectId, folderId }) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  const handleExportToACC = async () => {
    if (!selectedFile) {
      toast.error('Please select a file first');
      return;
    }

    if (!folderId) {
      toast.error('Please select a destination folder');
      return;
    }

    setIsExporting(true);
    setExportProgress('Exporting PDFs...');

    try {
      const userToken = await getUserToken();

      const response = await fetch('/api/pdf-export/export-and-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-token': userToken
        },
        body: JSON.stringify({
          fileUrn: selectedFile.urn,
          projectId: projectId,
          folderId: folderId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Export failed');
      }

      if (data.success) {
        const message = data.failed > 0
          ? `✅ ${data.uploaded} PDF(s) uploaded to ACC (${data.failed} failed)`
          : `✅ ${data.uploaded} PDF(s) uploaded to ACC`;

        toast.success(message, { autoClose: 5000 });

        if (data.errors && data.errors.length > 0) {
          data.errors.forEach(err => {
            toast.error(`Failed: ${err.filename}`, { autoClose: 3000 });
          });
        }
      } else {
        toast.error('Export failed');
      }

    } catch (error) {
      console.error('Export error:', error);
      toast.error(`Export failed: ${error.message}`);
    } finally {
      setIsExporting(false);
      setExportProgress('');
    }
  };

  return (
    <div className="pdf-export-panel">
      <button
        onClick={handleExportToACC}
        disabled={isExporting || !selectedFile || !folderId}
        className="btn-primary"
        style={{
          padding: '12px 24px',
          fontSize: '16px',
          backgroundColor: isExporting ? '#ccc' : '#0696D7',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isExporting ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        {isExporting ? (
          <>
            <span className="spinner" aria-hidden="true"></span>
            {exportProgress || 'Processing...'}
          </>
        ) : (
          <>
            <span role="img" aria-label="export">📤</span>
            Export to ACC
          </>
        )}
      </button>

      {isExporting && (
        <div className="progress-info" style={{ marginTop: '12px', fontSize: '14px', color: '#666' }}>
          {exportProgress}
        </div>
      )}
    </div>
  );
}

export default PDFExportPanel;
