/** Mention discrète sous le tableau — conventions Windows / macOS. */
export const SELECTION_HINT =
  'Clic : une ligne. Ctrl (⌘ sur Mac) : ajouter ou retirer. Maj : étendre la plage depuis la dernière ligne cliquée.';

export function isAddModifier(event) {
  return Boolean(event?.ctrlKey || event?.metaKey);
}

export function isRangeModifier(event) {
  return Boolean(event?.shiftKey);
}

/**
 * Prochaine sélection de lignes, portée à `items` (page affichée).
 * Clic simple / Ctrl-⌘ / Maj — comme un explorateur de fichiers.
 */
export function nextRowSelection({ items, clicked, event, selectedIds, anchorId }) {
  const list = Array.isArray(items) ? items : [];
  const ids = list.map((r) => r.id);
  const clickedId = clicked?.id;
  if (clickedId == null) {
    return { selectedIds: Array.isArray(selectedIds) ? selectedIds : [], anchorId: anchorId ?? null };
  }
  const idx = ids.indexOf(clickedId);
  const current = Array.isArray(selectedIds) ? selectedIds.filter((id) => ids.includes(id)) : [];
  const add = isAddModifier(event);
  const range = isRangeModifier(event);

  if (range) {
    const fromId = anchorId != null && ids.includes(anchorId) ? anchorId : clickedId;
    const a = ids.indexOf(fromId);
    const b = idx >= 0 ? idx : a;
    if (a >= 0 && b >= 0) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return { selectedIds: ids.slice(lo, hi + 1), anchorId: fromId };
    }
  }

  if (add) {
    const set = new Set(current);
    if (set.has(clickedId)) set.delete(clickedId);
    else set.add(clickedId);
    return { selectedIds: ids.filter((id) => set.has(id)), anchorId: clickedId };
  }

  return { selectedIds: [clickedId], anchorId: clickedId };
}

export function selectedRowsFromIds(items, selectedIds) {
  const set = new Set(selectedIds || []);
  return (items || []).filter((r) => set.has(r.id));
}

export function partitionIsolation(rows, { accModelGuid, sameAccModel } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const isolable = [];
  let skippedNoGuid = 0;
  let skippedModel = 0;
  for (const r of list) {
    if (!r?.revitUniqueId) {
      skippedNoGuid += 1;
      continue;
    }
    if (accModelGuid && typeof sameAccModel === 'function' && r.accModelGuid && !sameAccModel(r.accModelGuid, accModelGuid)) {
      skippedModel += 1;
      continue;
    }
    isolable.push(r);
  }
  return { isolable, skippedNoGuid, skippedModel };
}

export function noneIsolableMessage(rows, { skippedNoGuid, skippedModel } = {}) {
  const n = (rows || []).length;
  if (!n) return '';
  if (skippedModel && skippedNoGuid === 0) {
    return 'Les lignes sélectionnées appartiennent à une autre maquette : elles n’ont pas été isolées ici.';
  }
  if (skippedNoGuid === n) {
    return 'Aucune des lignes sélectionnées n’a d’identité 3D (variante, sous-projet, phase, type ou paramètre). L’isolation n’est pas disponible.';
  }
  return 'Aucun objet 3D isolable dans la sélection.';
}

export function mixedIsolationNote({ skippedNoGuid, skippedModel }) {
  const bits = [];
  if (skippedNoGuid) {
    bits.push(
      skippedNoGuid === 1
        ? '1 ligne sans identité 3D n’a pas été isolée.'
        : `${skippedNoGuid} lignes sans identité 3D n’ont pas été isolées.`
    );
  }
  if (skippedModel) {
    bits.push(
      skippedModel === 1
        ? '1 ligne d’une autre maquette n’a pas été isolée.'
        : `${skippedModel} lignes d’une autre maquette n’ont pas été isolées.`
    );
  }
  return bits.join(' ');
}

export function selectedCountLabel(count) {
  if (!count) return '';
  return count === 1 ? '1 ligne sélectionnée' : `${count} lignes sélectionnées`;
}

