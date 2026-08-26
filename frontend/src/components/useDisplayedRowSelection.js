import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nextRowSelection } from './qcElementsSelection';

/**
 * Sélection de la page affichée. Vidée quand `resetKey` change
 * (page, filtre, tri, maquette) — pas de sélection invisible.
 */
export function useDisplayedRowSelection(resetKey, onReset) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [anchorId, setAnchorId] = useState(null);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSelectedIds([]);
    setAnchorId(null);
    onResetRef.current?.();
  }, [resetKey]);

  const applyClick = useCallback(
    (items, row, event) => {
      const next = nextRowSelection({
        items,
        clicked: row,
        event,
        selectedIds,
        anchorId,
      });
      setSelectedIds(next.selectedIds);
      setAnchorId(next.anchorId);
      return next;
    },
    [selectedIds, anchorId]
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return {
    selectedIds,
    selectedSet,
    applyClick,
    count: selectedIds.length,
  };
}
