import React from 'react';
import WidgetChrome from './WidgetChrome';
import { warnPanel } from './widgetStyles';

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
      <div style={warnPanel}>{mention}</div>
    </WidgetChrome>
  );
}
