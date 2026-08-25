import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MIN_VIEWER_PX,
  MIN_TABLE_PX,
  HANDLE_PX,
  STACK_BELOW_PX,
  readStoredViewerWidth,
  writeStoredViewerWidth,
  clampViewerWidth,
  viewportViewerHeight,
} from './qcElementsSplitPrefs';

/**
 * Bornes :
 * - tableau ≥ 420 px : filtres + colonne identifiant restent lisibles ;
 * - viewer ≥ 400 px : orbit + barre d'outils Autodesk restent utilisables ;
 * - défaut 560 px : plus large que l'ancien plafond de 480 px, sans manger le tableau
 *   sur un écran de 1280 px.
 * Sous 960 px de fenêtre, on empile (liste puis 3D) : le glissement côte à côte
 * n'a plus de sens.
 *
 * Hauteur : fraction stable de la fenêtre (innerHeight − chrome), JAMAIS
 * innerHeight − getBoundingClientRect().top. Cette dernière formule croît
 * au défilement (top diminue → hauteur augmente → le parent s'allonge →
 * le sticky n'a plus de course → boucle). Recalcul seulement au resize
 * de la fenêtre.
 */

export default function QcElementsSplitLayout({ open, left, right }) {
  const rowRef = useRef(null);
  const draggingRef = useRef(false);
  const widthRef = useRef(readStoredViewerWidth());
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < STACK_BELOW_PX : false
  );
  const [viewerWidth, setViewerWidth] = useState(() => widthRef.current);
  const [viewerHeight, setViewerHeight] = useState(() => viewportViewerHeight());

  const applyWidth = useCallback((desired, persist) => {
    const box = rowRef.current?.getBoundingClientRect();
    const next = clampViewerWidth(desired, box?.width || 0);
    widthRef.current = next;
    setViewerWidth(next);
    if (persist) writeStoredViewerWidth(next);
  }, []);

  useEffect(() => {
    const onWin = () => {
      setNarrow(window.innerWidth < STACK_BELOW_PX);
      setViewerHeight(viewportViewerHeight());
      if (open && rowRef.current) applyWidth(widthRef.current, false);
    };
    window.addEventListener('resize', onWin);
    return () => window.removeEventListener('resize', onWin);
  }, [open, applyWidth]);

  useEffect(() => {
    if (!open || narrow) return undefined;
    const onMove = (e) => {
      if (!draggingRef.current || !rowRef.current) return;
      const box = rowRef.current.getBoundingClientRect();
      applyWidth(box.right - e.clientX, false);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      writeStoredViewerWidth(widthRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [open, narrow, applyWidth]);

  if (!open) return left;

  if (narrow) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>{left}</div>
        <div style={{ height: viewerHeight, minHeight: 360 }}>{right}</div>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        minHeight: 480,
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: MIN_TABLE_PX, overflow: 'auto' }}>{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajuster la largeur de la maquette 3D"
        onMouseDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        style={{
          flex: `0 0 ${HANDLE_PX}px`,
          cursor: 'col-resize',
          position: 'relative',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 12,
            bottom: 12,
            left: 2,
            width: 4,
            borderRadius: 4,
            background: 'rgba(124,58,237,0.45)',
          }}
        />
      </div>
      <div
        style={{
          flex: `0 0 ${viewerWidth}px`,
          minWidth: MIN_VIEWER_PX,
          position: 'sticky',
          top: 16,
          alignSelf: 'flex-start',
          height: viewerHeight,
          maxHeight: viewerHeight,
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {right}
      </div>
    </div>
  );
}
