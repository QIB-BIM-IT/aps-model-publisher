import React from 'react';
import { inputStyle, btnStyle, btnDanger, rowStyle } from './widgetStyles';

/**
 * Brique réutilisable — liste ordonnée de chaînes (Ajouter / Retirer / ↑ ↓).
 * Extraite pour listeOrdonnee et recetteNommage (champs).
 */
export default function OrderedStringListEditor({
  items,
  onChange,
  placeholder = 'valeur',
  addLabel = '+ Ajouter',
}) {
  const list = Array.isArray(items) ? items : [];

  function updateAt(i, text) {
    onChange(list.map((x, idx) => (idx === i ? text : x)));
  }

  function removeAt(i) {
    onChange(list.filter((_, idx) => idx !== i));
  }

  function addRow() {
    onChange([...list, '']);
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
    onChange(next);
  }

  return (
    <div>
      {list.map((item, i) => (
        <div key={i} style={rowStyle}>
          <span style={{ fontSize: 12, color: '#94a3b8', width: 20, textAlign: 'right' }}>
            {i + 1}.
          </span>
          <input
            type="text"
            value={item == null ? '' : String(item)}
            onChange={(e) => updateAt(i, e.target.value)}
            placeholder={placeholder}
            style={{ ...inputStyle, flex: 1, maxWidth: 'none' }}
          />
          <button
            type="button"
            onClick={() => move(i, -1)}
            disabled={i === 0}
            style={{ ...btnStyle, opacity: i === 0 ? 0.4 : 1 }}
            title="Monter"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => move(i, 1)}
            disabled={i === list.length - 1}
            style={{ ...btnStyle, opacity: i === list.length - 1 ? 0.4 : 1 }}
            title="Descendre"
          >
            ↓
          </button>
          <button type="button" onClick={() => removeAt(i)} style={btnDanger}>
            Retirer
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow} style={{ ...btnStyle, marginTop: 4 }}>
        {addLabel}
      </button>
    </div>
  );
}
