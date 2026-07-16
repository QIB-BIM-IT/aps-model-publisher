import React from 'react';
import WidgetChrome from './WidgetChrome';
import OrderedStringListEditor from './OrderedStringListEditor';

/**
 * Widget contrôlé — typeWidget: listeOrdonnee
 * props: { descriptionCible, valeur, onChange }
 */
export default function ListeOrdonneeWidget({ descriptionCible, valeur, onChange }) {
  const defaut = descriptionCible?.defaut;
  const list = Array.isArray(valeur)
    ? valeur
    : Array.isArray(defaut)
      ? defaut
      : [];

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <OrderedStringListEditor
        items={list}
        onChange={onChange}
        placeholder={descriptionCible?.element || 'valeur'}
      />
    </WidgetChrome>
  );
}
