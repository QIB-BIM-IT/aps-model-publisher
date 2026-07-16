import React, { useEffect, useMemo, useState } from 'react';
import { fetchQcCibleDescriptions } from '../services/api';
import WidgetRenderer, { isImplementedWidgetType } from '../components/qc-config/WidgetRenderer';

/**
 * Page de test isolée — lot 2 (moteur complet : 25 contrôles).
 * Charge GET /api/qc/controls/cible-descriptions, capture la saisie dans l'état local
 * (pas d'enregistrement en base).
 */
export default function QcConfigTestPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [controles, setControles] = useState([]);
  /** État capturé : { [code]: valeurWidget } — vit ICI, pas dans les widgets. */
  const [config, setConfig] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await fetchQcCibleDescriptions();
        if (cancelled) return;
        setControles(Array.isArray(data?.controles) ? data.controles : []);
      } catch (e) {
        if (!cancelled) {
          setError(e?.response?.data?.message || e?.message || 'Erreur chargement descriptions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const implemented = useMemo(
    () => controles.filter((c) => isImplementedWidgetType(c?.descriptionCible?.typeWidget)),
    [controles]
  );
  const unknown = useMemo(
    () => controles.filter((c) => !isImplementedWidgetType(c?.descriptionCible?.typeWidget)),
    [controles]
  );

  function setControlValue(code, valeur) {
    setConfig((prev) => {
      if (valeur === null || valeur === undefined) {
        const next = { ...prev };
        delete next[code];
        return next;
      }
      return { ...prev, [code]: valeur };
    });
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', color: '#0f172a' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>
        QC Config — page de test (lot 2)
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
        Moteur adaptatif complet (25 contrôles). État capturé en direct ci-dessous — aucun
        enregistrement en base dans ce lot.
      </p>

      {loading ? (
        <p style={{ fontSize: 14, color: '#64748b' }}>Chargement des descriptions de cible…</p>
      ) : null}

      {error ? (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <p style={{ fontSize: 13, color: '#475569', marginBottom: 16 }}>
          Contrôles rendus :{' '}
          <strong>{implemented.map((c) => c.code).join(', ') || '(aucun)'}</strong>
          {' '}({implemented.length}/{controles.length})
          {unknown.length ? (
            <span style={{ color: '#b91c1c' }}>
              {' '}
              — non couverts : {unknown.map((c) => `${c.code}(${c.descriptionCible?.typeWidget})`).join(', ')}
            </span>
          ) : (
            <span style={{ color: '#15803d' }}> — couverture complète</span>
          )}
        </p>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {implemented.map((c) => (
          <section
            key={c.code}
            data-code={c.code}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: 14,
              background: '#f8fafc',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'baseline',
                marginBottom: 10,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 14 }}>{c.code}</span>
              <span style={{ fontSize: 13, color: '#334155' }}>{c.libelle}</span>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#e0f2fe',
                  color: '#0369a1',
                }}
              >
                {c.descriptionCible?.typeWidget}
                {c.descriptionCible?.cleConfig
                  ? ` · ${c.descriptionCible.cleConfig}`
                  : ''}
              </span>
              {c.nature ? (
                <span style={{ fontSize: 11, color: '#64748b' }}>{c.nature}</span>
              ) : null}
            </div>
            <WidgetRenderer
              descriptionCible={c.descriptionCible}
              valeur={config[c.code]}
              onChange={(v) => setControlValue(c.code, v)}
            />
          </section>
        ))}
      </div>

      <div style={{ marginTop: 28 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          État config capturé (live)
        </h3>
        <pre
          style={{
            margin: 0,
            padding: 14,
            borderRadius: 8,
            background: '#0f172a',
            color: '#e2e8f0',
            fontSize: 12,
            overflow: 'auto',
            maxHeight: 360,
            lineHeight: 1.45,
          }}
        >
          {JSON.stringify(config, null, 2)}
        </pre>
      </div>
    </div>
  );
}
