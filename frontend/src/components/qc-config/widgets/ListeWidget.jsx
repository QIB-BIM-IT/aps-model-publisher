import React from 'react';
import WidgetChrome from './WidgetChrome';
import StringListEditor from './StringListEditor';

/**
 * Widget contrôlé — typeWidget: liste
 * Valeur = string[]. Pas de drag&drop.
 * props: { descriptionCible, valeur, onChange }
 */
export default function ListeWidget({ descriptionCible, valeur, onChange }) {
  const defaut = descriptionCible?.defaut;
  const list = Array.isArray(valeur)
    ? valeur
    : Array.isArray(defaut)
      ? defaut
      : [];

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <StringListEditor
        items={list}
        onChange={onChange}
        placeholder={descriptionCible?.element || 'valeur'}
      />
    </WidgetChrome>
  );
}
