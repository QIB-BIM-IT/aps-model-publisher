import React from 'react';
import WidgetChrome from './WidgetChrome';
import StringListEditor from './StringListEditor';
import { labelStyle, infoPanel } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: regleMaisonLectureSeule
 * Affiche la règle maison en lecture. Si descriptionCible.champEditable (G210),
 * expose une liste éditable.
 *
 * Forme scoreur G210: controles.G210.niveauxExclus (pas "listeExclusion").
 * Valeur remontée: null si rien d'éditable ; sinon { niveauxExclus: string[] }.
 *
 * props: { descriptionCible, valeur, onChange }
 */
export default function RegleMaisonLectureSeuleWidget({ descriptionCible, valeur, onChange }) {
  const regle = descriptionCible?.regle || '';
  const editable = descriptionCible?.champEditable;

  if (!editable || editable.typeWidget !== 'liste') {
    return (
      <WidgetChrome descriptionCible={descriptionCible}>
        <div style={infoPanel}>
          <strong style={{ display: 'block', marginBottom: 4 }}>Règle maison</strong>
          {regle || 'Aucune saisie — règle fixe appliquée à l’extraction.'}
        </div>
      </WidgetChrome>
    );
  }

  // G210: cleConfig = niveauxExclus
  const fieldName = editable.nom || 'niveauxExclus';
  const current =
    valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : null;
  const list = Array.isArray(current?.[fieldName])
    ? current[fieldName]
    : Array.isArray(editable.defaut)
      ? editable.defaut
      : [];

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div style={{ ...infoPanel, marginBottom: 12 }}>
        <strong style={{ display: 'block', marginBottom: 4 }}>Règle maison</strong>
        {regle || 'Règle fixe ; champ ci-dessous = seule surcharge projet.'}
      </div>
      <span style={labelStyle}>{editable.libelle || fieldName}</span>
      <StringListEditor
        items={list}
        onChange={(next) => onChange({ [fieldName]: next })}
        placeholder={editable.element || 'valeur'}
      />
    </WidgetChrome>
  );
}
