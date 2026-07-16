import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: texte
 * props: { descriptionCible, valeur, onChange }
 */
export default function TexteWidget({ descriptionCible, valeur, onChange }) {
  const defaut = descriptionCible?.defaut;
  const hasValeur = valeur !== undefined && valeur !== null;
  const display = hasValeur
    ? String(valeur)
    : defaut !== undefined && defaut !== null
      ? String(defaut)
      : '';

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <input
        type="text"
        value={display}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </WidgetChrome>
  );
}
