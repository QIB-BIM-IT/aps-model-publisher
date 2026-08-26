import {
  nextRowSelection,
  partitionIsolation,
  selectedRowsFromIds,
  selectedCountLabel,
  noneIsolableMessage,
  mixedIsolationNote,
} from './qcElementsSelection.js';

const items = [1, 2, 3, 4, 5].map((n) => ({
  id: `r${n}`,
  revitUniqueId: n === 3 ? null : `u${n}`,
  accModelGuid: n === 5 ? 'other' : 'model-a',
}));

function click(id, mods = {}) {
  return nextRowSelection({
    items,
    clicked: items.find((r) => r.id === id),
    event: { ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift },
    selectedIds: mods.selected || [],
    anchorId: mods.anchor ?? null,
  });
}

let failed = 0;
function ok(name, cond) {
  if (!cond) {
    console.error('FAIL', name);
    failed += 1;
  } else console.log('OK', name);
}

const simple = click('r2');
ok('simple selects one', simple.selectedIds.join() === 'r2' && simple.anchorId === 'r2');

const add = click('r4', { ctrl: true, selected: ['r2'], anchor: 'r2' });
ok('ctrl adds', add.selectedIds.join() === 'r2,r4');

const rem = click('r2', { ctrl: true, selected: ['r2', 'r4'], anchor: 'r4' });
ok('ctrl removes', rem.selectedIds.join() === 'r4');

const range = click('r5', { shift: true, selected: ['r2'], anchor: 'r2' });
ok('shift range r2-r5', range.selectedIds.join() === 'r2,r3,r4,r5' && range.anchorId === 'r2');

const rows = selectedRowsFromIds(items, range.selectedIds);
ok('rows from ids preserve order', rows.map((r) => r.id).join() === 'r2,r3,r4,r5');

const part = partitionIsolation(rows, {
  accModelGuid: 'model-a',
  sameAccModel: (a, b) => a === b,
});
ok('no guid skipped', part.skippedNoGuid === 1);
ok('other model skipped', part.skippedModel === 1);
ok('isolable r2 r4', part.isolable.map((r) => r.id).join() === 'r2,r4');

ok('count 3', selectedCountLabel(3) === '3 lignes sélectionnées');
ok('count 1', selectedCountLabel(1) === '1 ligne sélectionnée');

const onlyNoGuid = partitionIsolation(items.filter((r) => r.id === 'r3'));
ok(
  'none isolable copy',
  noneIsolableMessage(items.filter((r) => r.id === 'r3'), onlyNoGuid).includes('identité 3D')
);
ok('mixed note', mixedIsolationNote({ skippedNoGuid: 1, skippedModel: 1 }).includes('sans identité 3D'));

if (failed) process.exit(1);
console.log('ALL_OK');
