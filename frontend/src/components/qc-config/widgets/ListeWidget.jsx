import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle, btnStyle, btnDanger, rowStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: liste
 * Valeur = string[]. Pas de drag&drop.
 * props: { descriptionCible, valeur, onChange }
 */
export default function ListeWidget({ descriptionCible, valeur, onChange }) {
  const defaut = descriptionCible?.defaut;
  const list = Array.isArray(valeur)
    ? valeur
    : Array.isArray(defaut)
      ? defaut
      : [];

  function commit(next) {
    onChange(next);
  }

  function updateAt(i, text) {
    const next = list.map((x, idx) => (idx === i ? text : x));
    commit(next);
  }

  function removeAt(i) {
    commit(list.filter((_, idx) => idx !== i));
  }

  function addRow() {
    commit([...list, '']);
  }

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div>
        {list.map((item, i) => (
          <div key={i} style={rowStyle}>
            <input
              type="text"
              value={item == null ? '' : String(item)}
              onChange={(e) => updateAt(i, e.target.value)}
              placeholder={descriptionCible?.element || 'valeur'}
              style={{ ...inputStyle, flex: 1, maxWidth: 'none' }}
            />
            <button type="button" onClick={() => removeAt(i)} style={btnDanger}>
              Retirer
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow} style={{ ...btnStyle, marginTop: 4 }}>
          + Ajouter
        </button>
      </div>
    </WidgetChrome>
  );
}
