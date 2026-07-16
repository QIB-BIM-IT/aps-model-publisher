import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle, btnStyle, btnDanger, rowStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: listeOrdonnee
 * Comme liste + flèches monter/descendre (pas de drag&drop).
 * props: { descriptionCible, valeur, onChange }
 */
export default function ListeOrdonneeWidget({ descriptionCible, valeur, onChange }) {
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
    commit(list.map((x, idx) => (idx === i ? text : x)));
  }

  function removeAt(i) {
    commit(list.filter((_, idx) => idx !== i));
  }

  function addRow() {
    commit([...list, '']);
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
    commit(next);
  }

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
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
              placeholder={descriptionCible?.element || 'valeur'}
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
          + Ajouter
        </button>
      </div>
    </WidgetChrome>
  );
}
