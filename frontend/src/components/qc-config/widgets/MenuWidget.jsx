import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: menu
 * props: { descriptionCible, valeur, onChange }
 * choix: string[] ou { valeur, libelle }[]
 */
export default function MenuWidget({ descriptionCible, valeur, onChange }) {
  const choix = Array.isArray(descriptionCible?.choix) ? descriptionCible.choix : [];
  const defaut = descriptionCible?.defaut;
  const hasValeur = valeur !== undefined && valeur !== null && valeur !== '';
  const display = hasValeur ? String(valeur) : defaut !== undefined && defaut !== null && defaut !== '' ? String(defaut) : '';

  function optionValue(c) {
    return typeof c === 'object' && c != null ? String(c.valeur) : String(c);
  }
  function optionLabel(c) {
    return typeof c === 'object' && c != null ? String(c.libelle ?? c.valeur) : String(c);
  }

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <select
        value={display}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, maxWidth: 280 }}
      >
        <option value="">—</option>
        {choix.map((c) => {
          const v = optionValue(c);
          return (
            <option key={v} value={v}>
              {optionLabel(c)}
            </option>
          );
        })}
      </select>
    </WidgetChrome>
  );
}
