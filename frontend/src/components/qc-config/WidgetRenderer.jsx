import React from 'react';
import ValeurNumeriqueWidget from './widgets/ValeurNumeriqueWidget';
import MenuWidget from './widgets/MenuWidget';
import TexteWidget from './widgets/TexteWidget';
import ListeWidget from './widgets/ListeWidget';
import ListeOrdonneeWidget from './widgets/ListeOrdonneeWidget';

const SIMPLE_TYPES = new Set([
  'valeurNumerique',
  'menu',
  'texte',
  'liste',
  'listeOrdonnee',
]);

export function isSimpleWidgetType(typeWidget) {
  return SIMPLE_TYPES.has(typeWidget);
}

/**
 * Aiguilleur — selon descriptionCible.typeWidget, rend le widget correspondant.
 * Contrat: { descriptionCible, valeur, onChange }
 */
export default function WidgetRenderer({ descriptionCible, valeur, onChange }) {
  const type = descriptionCible?.typeWidget;

  switch (type) {
    case 'valeurNumerique':
      return (
        <ValeurNumeriqueWidget
          descriptionCible={descriptionCible}
          valeur={valeur}
          onChange={onChange}
        />
      );
    case 'menu':
      return (
        <MenuWidget descriptionCible={descriptionCible} valeur={valeur} onChange={onChange} />
      );
    case 'texte':
      return (
        <TexteWidget descriptionCible={descriptionCible} valeur={valeur} onChange={onChange} />
      );
    case 'liste':
      return (
        <ListeWidget descriptionCible={descriptionCible} valeur={valeur} onChange={onChange} />
      );
    case 'listeOrdonnee':
      return (
        <ListeOrdonneeWidget
          descriptionCible={descriptionCible}
          valeur={valeur}
          onChange={onChange}
        />
      );
    default:
      return (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: '1px dashed #cbd5e1',
            background: '#f8fafc',
            fontSize: 13,
            color: '#64748b',
          }}
        >
          Widget à venir : <code>{type || '(absent)'}</code>
        </div>
      );
  }
}
