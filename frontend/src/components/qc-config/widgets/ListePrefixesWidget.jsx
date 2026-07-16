import React from 'react';
import WidgetChrome from './WidgetChrome';
import StringListEditor from './StringListEditor';
import { labelStyle, aideStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: listePrefixes (G404)
 * Forme scoreur: controles.G404.{ prefixes, exceptions } (resolveG404Cible).
 * Réutilise StringListEditor (même logique que le widget liste).
 * props: { descriptionCible, valeur, onChange }
 */
export default function ListePrefixesWidget({ descriptionCible, valeur, onChange }) {
  const defaut = descriptionCible?.defaut && typeof descriptionCible.defaut === 'object'
    ? descriptionCible.defaut
    : {};
  const prefixesDef =
    descriptionCible?.prefixes?.defaut || defaut.prefixes || [];
  const exceptionsDef =
    descriptionCible?.exceptions?.defaut || defaut.exceptions || [];

  const current =
    valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : null;
  const prefixes = Array.isArray(current?.prefixes) ? current.prefixes : prefixesDef;
  const exceptions = Array.isArray(current?.exceptions) ? current.exceptions : exceptionsDef;

  function commit(nextPrefixes, nextExceptions) {
    onChange({ prefixes: nextPrefixes, exceptions: nextExceptions });
  }

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div style={{ marginBottom: 14 }}>
        <span style={labelStyle}>
          {descriptionCible?.prefixes?.libelle || 'Préfixes autorisés'}
        </span>
        <StringListEditor
          items={prefixes}
          onChange={(p) => commit(p, exceptions)}
          placeholder="préfixe"
        />
      </div>
      <div>
        <span style={labelStyle}>
          {descriptionCible?.exceptions?.libelle || 'Exceptions (noms exacts)'}
        </span>
        <span style={{ ...aideStyle, marginBottom: 6 }}>
          Noms exacts exemptés (sous-projets système Revit, etc.).
        </span>
        <StringListEditor
          items={exceptions}
          onChange={(e) => commit(prefixes, e)}
          placeholder="exception"
        />
      </div>
    </WidgetChrome>
  );
}
