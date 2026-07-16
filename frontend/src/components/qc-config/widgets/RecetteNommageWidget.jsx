import React from 'react';
import WidgetChrome from './WidgetChrome';
import OrderedStringListEditor from './OrderedStringListEditor';
import { inputStyle, labelStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: recetteNommage (G103)
 *
 * Forme scoreur (evaluerRecetteNommage) :
 *   controles.G103 = { recette: { champs: string[], separateur?, extension? } }
 * Comparaison STRICTE au nom DM. Aperçu live = champs.join(sep) + extension.
 *
 * props: { descriptionCible, valeur, onChange }
 */
export default function RecetteNommageWidget({ descriptionCible, valeur, onChange }) {
  const champsMeta = descriptionCible?.champs || {};
  const sepMeta = descriptionCible?.separateur || {};
  const extMeta = descriptionCible?.extension || {};

  const current =
    valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : null;
  const recette =
    current?.recette && typeof current.recette === 'object' ? current.recette : null;

  const champs = Array.isArray(recette?.champs)
    ? recette.champs
    : Array.isArray(champsMeta.defaut)
      ? champsMeta.defaut
      : [];
  const separateur =
    recette?.separateur != null && String(recette.separateur).length
      ? String(recette.separateur)
      : sepMeta.defaut != null
        ? String(sepMeta.defaut)
        : '_';
  const extension =
    recette?.extension != null
      ? String(recette.extension)
      : extMeta.defaut != null
        ? String(extMeta.defaut)
        : '';

  const choixSep = Array.isArray(sepMeta.choix) ? sepMeta.choix : ['_', '-', '.'];

  function commit(next) {
    onChange({ recette: next });
  }

  const apercu =
    champs.length > 0 ? champs.map((c) => String(c ?? '')).join(separateur) + extension : '';

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div style={{ marginBottom: 14 }}>
        <span style={labelStyle}>{champsMeta.libelle || 'Valeurs des champs (ordre)'}</span>
        <OrderedStringListEditor
          items={champs}
          onChange={(nextChamps) =>
            commit({ champs: nextChamps, separateur, extension })
          }
          placeholder={champsMeta.element || 'valeur de champ'}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={labelStyle}>{sepMeta.libelle || 'Séparateur'}</span>
        <select
          value={separateur}
          onChange={(e) => commit({ champs, separateur: e.target.value, extension })}
          style={{ ...inputStyle, maxWidth: 120 }}
        >
          {choixSep.map((s) => (
            <option key={String(s)} value={String(s)}>
              {String(s)}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={labelStyle}>{extMeta.libelle || 'Extension (optionnelle)'}</span>
        <input
          type="text"
          value={extension}
          onChange={(e) => commit({ champs, separateur, extension: e.target.value })}
          placeholder=".rvt"
          style={inputStyle}
        />
      </div>

      <div
        style={{
          padding: '12px 14px',
          borderRadius: 8,
          background: '#0f172a',
          border: '1px solid #1e293b',
        }}
      >
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>
          Aperçu du nom attendu (live)
        </div>
        <code
          style={{
            fontSize: 15,
            color: apercu ? '#38bdf8' : '#64748b',
            wordBreak: 'break-all',
          }}
        >
          {apercu || '(ajoutez des champs…)'}
        </code>
      </div>
    </WidgetChrome>
  );
}
