import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQcRunViewer, fetchQcViewerToken } from '../services/api';
import { btnSecondary } from './qc-config/qcTheme';

const VIOLET = '#7c3aed';
const VIOLET_DARK = '#6d28d9';
const VIEWER_BASE = 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*';
const ISOLATE_MAX = 2000;

let assetsPromise = null;

function loadViewerAssets() {
  if (window.Autodesk?.Viewing) return Promise.resolve();
  if (assetsPromise) return assetsPromise;
  assetsPromise = new Promise((resolve, reject) => {
    const cssId = 'aps-viewer-css';
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId;
      link.rel = 'stylesheet';
      link.href = `${VIEWER_BASE}/style.min.css`;
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = `${VIEWER_BASE}/viewer3D.min.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      assetsPromise = null;
      reject(new Error('Impossible de charger le visualiseur 3D.'));
    };
    document.head.appendChild(script);
  });
  return assetsPromise;
}

function mapDbIds(model, uniqueIds) {
  return new Promise((resolve) => {
    if (!model || !uniqueIds?.length) {
      resolve({ found: [], missing: uniqueIds || [] });
      return;
    }
    model.getExternalIdMapping((map) => {
      const found = [];
      const missing = [];
      const seen = new Set();
      for (const u of uniqueIds) {
        const dbId = map ? map[u] : null;
        if (dbId != null && !seen.has(dbId)) {
          seen.add(dbId);
          found.push(dbId);
        } else if (dbId == null) {
          missing.push(u);
        }
      }
      resolve({ found, missing });
    });
  });
}

export default function QcRunViewerPane({
  runId,
  open,
  onToggle,
  isolateRequest,
  subtitle,
  idleMessage,
}) {
  const hostRef = useRef(null);
  const viewerRef = useRef(null);
  const readyRef = useRef(false);
  const pendingRef = useRef(null);
  const [status, setStatus] = useState('');
  const [blocking, setBlocking] = useState(null);
  const [context, setContext] = useState(null);
  const [loadMs, setLoadMs] = useState(null);

  const applyIsolate = useCallback(async (req) => {
    const viewer = viewerRef.current;
    if (!req || !viewer || !readyRef.current) {
      pendingRef.current = req || null;
      return;
    }
    if (req.clear) {
      try {
        if (typeof viewer.showAll === 'function') viewer.showAll();
        else viewer.isolate();
        if (typeof viewer.clearSelection === 'function') viewer.clearSelection();
      } catch (_) {
        /* viewer en cours de teardown */
      }
      setStatus(req.emptyMessage || '');
      return;
    }
    const ids = (req.uniqueIds || []).filter(Boolean);
    if (!ids.length) {
      setStatus(req.emptyMessage || 'Aucun objet 3D à isoler pour cette sélection.');
      return;
    }
    let work = ids;
    let capped = false;
    if (!req.skipCap && work.length > ISOLATE_MAX) {
      work = work.slice(0, ISOLATE_MAX);
      capped = true;
    }
    const { found, missing } = await mapDbIds(viewer.model, work);
    if (!found.length) {
      setStatus(
        req.notFoundMessage ||
          'Cet objet n’apparaît pas dans la vue 3D (vue, famille, ou élément absent de la traduction).'
      );
      return;
    }
    viewer.isolate(found);
    viewer.select(found);
    viewer.fitToView(found);
    const bits = [];
    if (req.label) bits.push(req.label);
    bits.push(
      found.length === 1
        ? 'Objet isolé dans la maquette.'
        : `${found.length} objet(s) isolé(s) dans la maquette.`
    );
    if (capped) {
      bits.push(
        `Pour rester fluide, seuls les ${ISOLATE_MAX} premiers objets de la sélection ont été isolés (${ids.length} au total).`
      );
    } else if (missing.length && ids.length > 1) {
      bits.push(`${missing.length} objet(s) de la liste n’apparaissent pas en 3D.`);
    }
    setStatus(bits.join(' '));
  }, []);

  useEffect(() => {
    if (!open || !runId) return undefined;
    let cancelled = false;
    readyRef.current = false;
    setBlocking(null);
    setStatus('Préparation de la maquette…');
    setLoadMs(null);

    (async () => {
      const t0 = performance.now();
      const ctx = await fetchQcRunViewer(runId);
      if (cancelled) return;
      setContext(ctx);
      const tr = ctx.translation || {};
      if (tr.status !== 'ready') {
        setBlocking(tr.message || 'Cette maquette n’est pas visualisable.');
        setStatus('');
        return;
      }
      await loadViewerAssets();
      if (cancelled) return;
      const Av = window.Autodesk.Viewing;
      const getToken = async (onReady) => {
        try {
          const tok = await fetchQcViewerToken();
          onReady(tok.accessToken, tok.expiresIn);
        } catch (e) {
          setStatus(e.message || 'La session de visualisation a expiré. Réouvrez la maquette.');
        }
      };
      Av.Initializer(
        {
          env: 'AutodeskProduction2',
          api: ctx.viewerApi || 'streamingV2',
          getAccessToken: getToken,
        },
        () => {
          if (cancelled) return;
          if (viewerRef.current) {
            try {
              viewerRef.current.finish();
            } catch (_) {
              /* ignore */
            }
            viewerRef.current = null;
            if (typeof window !== 'undefined') {
              window.__qcViewerLive = Math.max(0, (window.__qcViewerLive || 1) - 1);
            }
          }
          const viewer = new Av.GuiViewer3D(hostRef.current, {
            extensions: [],
          });
          viewer.start();
          viewerRef.current = viewer;
          if (typeof window !== 'undefined') {
            window.__qcViewerLive = (window.__qcViewerLive || 0) + 1;
          }
          Av.Document.load(
            ctx.documentUrn,
            (doc) => {
              if (cancelled) return;
              const geom = doc.getRoot().getDefaultGeometry();
              if (!geom) {
                setBlocking('Cette maquette n’a pas de vue 3D consultable.');
                return;
              }
              viewer
                .loadDocumentNode(doc, geom)
                .then(() => {
                  if (cancelled) return;
                  readyRef.current = true;
                  setLoadMs(Math.round(performance.now() - t0));
                  setStatus(
                    `Maquette de la version ACC${ctx.modelVersion != null ? ` v${ctx.modelVersion}` : ''} chargée.`
                  );
                  const pending = pendingRef.current;
                  pendingRef.current = null;
                  if (pending) applyIsolate(pending);
                })
                .catch(() => {
                  if (!cancelled) setBlocking('Impossible d’afficher la maquette 3D.');
                });
            },
            () => {
              if (!cancelled) {
                setBlocking(
                  'Impossible de charger cette version de la maquette. Vérifiez qu’une vue 3D existe.'
                );
              }
            }
          );
        }
      );
    })().catch((e) => {
      if (!cancelled) {
        setBlocking(e.message || 'Impossible de préparer la visualisation.');
        setStatus('');
      }
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      const v = viewerRef.current;
      viewerRef.current = null;
      if (v) {
        try {
          v.finish();
        } catch (_) {
          /* ignore */
        }
        if (typeof window !== 'undefined') {
          window.__qcViewerLive = Math.max(0, (window.__qcViewerLive || 1) - 1);
        }
      }
    };
  }, [open, runId, applyIsolate]);

  useEffect(() => {
    if (!open || !isolateRequest) return;
    applyIsolate(isolateRequest);
  }, [open, isolateRequest, applyIsolate]);

  // Canevas 3D : un vrai changement de taille du conteneur (séparation, fenêtre)
  // ne met pas à jour la projection tout seul. On ignore les observations
  // qui ne changent ni largeur ni hauteur — viewer.resize() ne doit pas
  // relancer l'observateur.
  useEffect(() => {
    if (!open || blocking) return undefined;
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    let lastW = -1;
    let lastH = -1;
    const sync = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      const v = viewerRef.current;
      if (v && typeof v.resize === 'function') {
        try {
          v.resize();
        } catch (_) {
          /* viewer en cours de teardown */
        }
      }
    };
    const ro = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    });
    ro.observe(el);
    sync();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open, runId, blocking]);

  if (!open) {
    return (
      <button type="button" onClick={onToggle} style={btnSecondary}>
        Afficher la maquette 3D
      </button>
    );
  }

  if (!runId) {
    return (
      <div
        style={{
          border: '1px solid rgba(148,163,184,0.35)',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#0f172a',
          minHeight: 220,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            background: 'rgba(15,23,42,0.95)',
            borderBottom: '1px solid rgba(148,163,184,0.25)',
          }}
        >
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>Maquette 3D</div>
          <button
            type="button"
            onClick={onToggle}
            style={{ ...btnSecondary, padding: '6px 10px', fontSize: 12 }}
          >
            Replier
          </button>
        </div>
        <div style={{ padding: 16, color: '#e2e8f0', fontSize: 13, lineHeight: 1.5 }}>
          {idleMessage ||
            'Choisissez une maquette dans le filtre pour afficher sa vue 3D. Aucun modèle unique ne peut être chargé tant que toutes les maquettes sont listées.'}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid rgba(148,163,184,0.35)',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#0f172a',
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          padding: '10px 12px',
          background: 'rgba(15,23,42,0.95)',
          borderBottom: '1px solid rgba(148,163,184,0.25)',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>
            {context?.modelName || 'Maquette'}
            {context?.modelVersion != null ? ` — version ACC v${context.modelVersion}` : ''}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
            {subtitle || 'Version exactement auditée par ce run'}
            {loadMs != null ? ` · chargée en ${(loadMs / 1000).toFixed(1)} s` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          style={{ ...btnSecondary, padding: '6px 10px', fontSize: 12 }}
        >
          Replier
        </button>
      </div>
      {blocking ? (
        <div style={{ padding: 16, color: '#e2e8f0', fontSize: 13, lineHeight: 1.5 }}>{blocking}</div>
      ) : (
        <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative' }} />
      )}
      {status && !blocking && (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 12,
            color: '#ddd6fe',
            background: 'rgba(124,58,237,0.18)',
            borderTop: `1px solid ${VIOLET}`,
            flexShrink: 0,
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

export { ISOLATE_MAX, VIOLET_DARK, VIOLET };
