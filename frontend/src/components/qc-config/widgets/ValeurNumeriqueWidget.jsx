import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: valeurNumerique
 * props: { descriptionCible, valeur, onChange }
 */
export default function ValeurNumeriqueWidget({ descriptionCible, valeur, onChange }) {
  const defaut = descriptionCible?.defaut;
  const hasValeur = valeur !== undefined && valeur !== null && valeur !== '';
  const display =
    hasValeur ? valeur : defaut !== undefined && defaut !== null && defaut !== '' ? defaut : '';
  const unite = descriptionCible?.unite || '';

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="number"
          value={display === '' ? '' : display}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange('');
              return;
            }
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : raw);
          }}
          style={{ ...inputStyle, maxWidth: 200 }}
        />
        {unite ? (
          <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>{unite}</span>
        ) : null}
      </div>
    </WidgetChrome>
  );
}
