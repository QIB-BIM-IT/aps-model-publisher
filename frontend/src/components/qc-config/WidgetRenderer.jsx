import React from 'react';
import ValeurNumeriqueWidget from './widgets/ValeurNumeriqueWidget';
import MenuWidget from './widgets/MenuWidget';
import TexteWidget from './widgets/TexteWidget';
import ListeWidget from './widgets/ListeWidget';
import ListeOrdonneeWidget from './widgets/ListeOrdonneeWidget';
import CoordonneesWidget from './widgets/CoordonneesWidget';
import AngleWidget from './widgets/AngleWidget';
import ListePrefixesWidget from './widgets/ListePrefixesWidget';
import ParametreUniformatWidget from './widgets/ParametreUniformatWidget';
import RegleMaisonLectureSeuleWidget from './widgets/RegleMaisonLectureSeuleWidget';
import IndicatifWidget from './widgets/IndicatifWidget';

/** Widgets simples (lot 2 premier temps). */
const SIMPLE_TYPES = new Set([
  'valeurNumerique',
  'menu',
  'texte',
  'liste',
  'listeOrdonnee',
]);

/** Widgets complexes partie A (ce lot). */
const COMPLEX_A_TYPES = new Set([
  'coordonnees',
  'angle',
  'listePrefixes',
  'parametreUniformat',
  'regleMaisonLectureSeule',
  'indicatif',
]);

/** Types encore absents — partie B. */
const PARTIE_B_TYPES = new Set(['table', 'recetteNommage']);

export function isSimpleWidgetType(typeWidget) {
  return SIMPLE_TYPES.has(typeWidget);
}

export function isImplementedWidgetType(typeWidget) {
  return SIMPLE_TYPES.has(typeWidget) || COMPLEX_A_TYPES.has(typeWidget);
}

export function isPartieBWidgetType(typeWidget) {
  return PARTIE_B_TYPES.has(typeWidget);
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
    case 'coordonnees':
      return (
        <CoordonneesWidget
          descriptionCible={descriptionCible}
          valeur={valeur}
          onChange={onChange}
        />
      );
    case 'angle':
      return (
        <AngleWidget descriptionCible={descriptionCible} valeur={valeur} onChange={onChange} />
      );
    case 'listePrefixes':
      return (
        <ListePrefixesWidget
          descriptionCible={descriptionCible}
          valeur={valeur}
          onChange={onChange}
        />
      );
    case 'parametreUniformat':
      return (
        <ParametreUniformatWidget
          descriptionCible={descriptionCible}
          valeur={valeur}
          onChange={onChange}
        />
      );
    case 'regleMaisonLectureSeule':
      return (
        <RegleMaisonLectureSeuleWidget
          descriptionCible={descriptionCible}
          valeur={valeur}
          onChange={onChange}
        />
      );
    case 'indicatif':
      return <IndicatifWidget descriptionCible={descriptionCible} valeur={valeur} onChange={onChange} />;
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
          Widget à venir (partie B) : <code>{type || '(absent)'}</code>
        </div>
      );
  }
}
