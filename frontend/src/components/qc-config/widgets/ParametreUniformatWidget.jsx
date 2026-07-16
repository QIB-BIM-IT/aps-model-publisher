import React from 'react';
import WidgetChrome from './WidgetChrome';
import StringListEditor from './StringListEditor';
import { inputStyle, labelStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: parametreUniformat (G504)
 * Forme scoreur (resolveUniformatConfig) :
 *   controles.G504 = { parametre: { kind, valeur }, categories: string[] }
 * (cible numérique optionnelle pour activer la porte — hors scope minimal ici).
 * props: { descriptionCible, valeur, onChange }
 */

function paramKey(p) {
  if (!p || typeof p !== 'object') return '';
  return `${p.kind || ''}|${p.valeur || ''}`;
}

function parseParamKey(key) {
  if (!key) return null;
  const i = key.indexOf('|');
  if (i < 0) return null;
  const kind = key.slice(0, i);
  const valeur = key.slice(i + 1);
  if ((kind !== 'builtin' && kind !== 'partage') || !valeur) return null;
  return { kind, valeur };
}

export default function ParametreUniformatWidget({ descriptionCible, valeur, onChange }) {
  const paramMeta = descriptionCible?.parametreSource || {};
  const catMeta = descriptionCible?.categories || {};
  const choix = Array.isArray(paramMeta.choix) ? paramMeta.choix : [];

  const current =
    valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : null;
  const parametre =
    current?.parametre && typeof current.parametre === 'object'
      ? current.parametre
      : paramMeta.defaut && typeof paramMeta.defaut === 'object'
        ? paramMeta.defaut
        : null;
  const categories = Array.isArray(current?.categories)
    ? current.categories
    : Array.isArray(catMeta.defaut)
      ? catMeta.defaut
      : [];

  function commit(nextParam, nextCats) {
    onChange({
      parametre: nextParam,
      categories: nextCats,
    });
  }

  const selectValue = parametre ? paramKey(parametre) : '';

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div style={{ marginBottom: 14 }}>
        <span style={labelStyle}>{paramMeta.libelle || 'Paramètre source'}</span>
        <select
          value={selectValue}
          onChange={(e) => {
            const p = parseParamKey(e.target.value);
            if (p) commit(p, categories);
          }}
          style={{ ...inputStyle, maxWidth: 360 }}
        >
          <option value="">—</option>
          {choix.map((c) => {
            const p = c?.valeur && typeof c.valeur === 'object' ? c.valeur : null;
            const key = p ? paramKey(p) : '';
            if (!key) return null;
            return (
              <option key={key} value={key}>
                {c.libelle || key}
              </option>
            );
          })}
        </select>
      </div>
      <div>
        <span style={labelStyle}>{catMeta.libelle || 'Catégories'}</span>
        <StringListEditor
          items={categories}
          onChange={(cats) => commit(parametre, cats)}
          placeholder={catMeta.element || 'BuiltInCategory'}
        />
      </div>
    </WidgetChrome>
  );
}
