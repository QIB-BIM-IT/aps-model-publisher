import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle, labelStyle, aideStyle } from './widgetStyles';
import { labelBuiltinCategoryFr } from '../builtinCategoryLabelsFr';

/**
 * Widget contrôlé — typeWidget: parametreUniformat (G504)
 * Forme scoreur (resolveUniformatConfig) :
 *   controles.G504 = { parametre: { kind, valeur }, categories: string[] }
 * (cible numérique optionnelle pour activer la porte — hors scope minimal ici).
 *
 * Affichage catégories : noms d'interface Revit FR ; valeurs stockées = BuiltInCategory (OST_…).
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

function uniqueBics(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const bic = String(raw || '').trim();
    if (!bic || seen.has(bic)) continue;
    seen.add(bic);
    out.push(bic);
  }
  return out;
}

export default function ParametreUniformatWidget({ descriptionCible, valeur, onChange }) {
  const paramMeta = descriptionCible?.parametreSource || {};
  const catMeta = descriptionCible?.categories || {};
  const choix = Array.isArray(paramMeta.choix) ? paramMeta.choix : [];
  const whitelist = uniqueBics(
    Array.isArray(catMeta.defaut) ? catMeta.defaut : []
  );

  const current =
    valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : null;
  const parametre =
    current?.parametre && typeof current.parametre === 'object'
      ? current.parametre
      : paramMeta.defaut && typeof paramMeta.defaut === 'object'
        ? paramMeta.defaut
        : null;
  const categories = Array.isArray(current?.categories)
    ? uniqueBics(current.categories)
    : whitelist.slice();

  function commit(nextParam, nextCats) {
    onChange({
      parametre: nextParam,
      categories: uniqueBics(nextCats),
    });
  }

  function toggleCategory(bic, checked) {
    if (checked) {
      if (categories.includes(bic)) return;
      commit(parametre, [...categories, bic]);
    } else {
      commit(
        parametre,
        categories.filter((c) => c !== bic)
      );
    }
  }

  const selectValue = parametre ? paramKey(parametre) : '';
  const selectedSet = new Set(categories);
  // Afficher la liste blanche + toute catégorie déjà en config hors liste
  const displayList = uniqueBics([...whitelist, ...categories]);

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
        <span style={{ ...aideStyle, marginBottom: 8 }}>
          Noms tels qu&apos;affichés dans Revit (français). La configuration enregistre
          l&apos;identifiant technique stable utilisé au contrôle.
        </span>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 280,
            overflowY: 'auto',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.3)',
            background: 'rgba(248, 250, 252, 0.9)',
          }}
        >
          {displayList.map((bic) => {
            const checked = selectedSet.has(bic);
            const label = labelBuiltinCategoryFr(bic);
            return (
              <label
                key={bic}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  color: '#0f172a',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggleCategory(bic, e.target.checked)}
                  style={{ accentColor: '#2563eb' }}
                />
                <span style={{ fontWeight: 500 }}>{label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </WidgetChrome>
  );
}
