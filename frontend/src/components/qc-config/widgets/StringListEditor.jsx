import React from 'react';
import { inputStyle, btnStyle, btnDanger, rowStyle } from './widgetStyles';

/**
 * Brique réutilisable — liste de chaînes avec Ajouter / Retirer (pas de drag&drop).
 * Extraite pour que liste, listePrefixes, G210, G504 catégories partagent la même logique.
 */
export default function StringListEditor({
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

  return (
    <div>
      {list.map((item, i) => (
        <div key={i} style={rowStyle}>
          <input
            type="text"
            value={item == null ? '' : String(item)}
            onChange={(e) => updateAt(i, e.target.value)}
            placeholder={placeholder}
            style={{ ...inputStyle, flex: 1, maxWidth: 'none' }}
          />
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
