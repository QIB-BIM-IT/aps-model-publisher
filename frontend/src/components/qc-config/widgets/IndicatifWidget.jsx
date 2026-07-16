import React from 'react';
import WidgetChrome from './WidgetChrome';

/**
 * Widget contrôlé — typeWidget: indicatif (G402, G314)
 * Aucun champ. Valeur remontée = null (pas de configuration).
 * props: { descriptionCible, valeur, onChange }
 */
export default function IndicatifWidget({ descriptionCible }) {
  const mention =
    descriptionCible?.mention ||
    'Contrôle indicatif — pas de configuration';

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 6,
          background: '#fffbeb',
          border: '1px solid #fde68a',
          fontSize: 13,
          color: '#92400e',
        }}
      >
        {mention}
      </div>
    </WidgetChrome>
  );
}
