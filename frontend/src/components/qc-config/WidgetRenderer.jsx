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
import TableWidget from './widgets/TableWidget';
import InfosProjetWidget from './widgets/InfosProjetWidget';
import RecetteNommageWidget from './widgets/RecetteNommageWidget';

/** Tous les typeWidget du catalogue actif (25 contrôles). */
const IMPLEMENTED_TYPES = new Set([
  'valeurNumerique',
  'menu',
  'texte',
  'liste',
  'listeOrdonnee',
  'coordonnees',
  'angle',
  'listePrefixes',
  'parametreUniformat',
  'regleMaisonLectureSeule',
  'indicatif',
  'table',
  'recetteNommage',
]);

export function isSimpleWidgetType(typeWidget) {
  return [
    'valeurNumerique',
    'menu',
    'texte',
    'liste',
    'listeOrdonnee',
  ].includes(typeWidget);
}

export function isImplementedWidgetType(typeWidget) {
  return IMPLEMENTED_TYPES.has(typeWidget);
}

/** @deprecated partie B terminée — toujours false. */
export function isPartieBWidgetType() {
  return false;
}

/**
 * G105 et G508 partagent typeWidget "table" dans le catalogue.
 * Discrimination via cleConfig (champs vs parametres).
 */
function renderTable(descriptionCible, valeur, onChange) {
  if (descriptionCible?.cleConfig === 'champs') {
    return (
      <InfosProjetWidget
        descriptionCible={descriptionCible}
        valeur={valeur}
        onChange={onChange}
      />
    );
  }
  // G508 — cleConfig "parametres"
  return (
    <TableWidget descriptionCible={descriptionCible} valeur={valeur} onChange={onChange} />
  );
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
      return (
        <IndicatifWidget descriptionCible={descriptionCible} valeur={valeur} onChange={onChange} />
      );
    case 'table':
      return renderTable(descriptionCible, valeur, onChange);
    case 'recetteNommage':
      return (
        <RecetteNommageWidget
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
          Widget inconnu : <code>{type || '(absent)'}</code>
        </div>
      );
  }
}
