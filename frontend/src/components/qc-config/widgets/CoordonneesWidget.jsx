import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle, labelStyle, rowStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: coordonnees (G201)
 *
 * Forme scoreur (evaluerCoordonnees / cleConfig "cible") :
 *   { ns, eo, elev, tolerance?, toleranceNs?, toleranceEo?, toleranceElev? }
 * (pas { ns: {valeur,tolerance} } — écart volontaire vs intuition UI, aligné catalogue).
 *
 * props: { descriptionCible, valeur, onChange }
 */
function parseNum(raw) {
  if (raw === '' || raw === undefined || raw === null) return '';
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function displayNum(v) {
  if (v === undefined || v === null || v === '') return '';
  return v;
}

export default function CoordonneesWidget({ descriptionCible, valeur, onChange }) {
  const obj = valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : {};
  const sousChamps = Array.isArray(descriptionCible?.sousChamps)
    ? descriptionCible.sousChamps
    : [
        { nom: 'ns', libelle: 'Nord / Sud', unite: 'm' },
        { nom: 'eo', libelle: 'Est / Ouest', unite: 'm' },
        { nom: 'elev', libelle: 'Élévation', unite: 'm' },
      ];

  const tolKeys = {
    ns: 'toleranceNs',
    eo: 'toleranceEo',
    elev: 'toleranceElev',
  };

  function commit(next) {
    const keys = ['ns', 'eo', 'elev', 'tolerance', 'toleranceNs', 'toleranceEo', 'toleranceElev'];
    const hasAny = keys.some((k) => next[k] !== undefined && next[k] !== null && next[k] !== '');
    onChange(hasAny ? next : null);
  }

  function setField(key, raw) {
    const next = { ...obj };
    const parsed = parseNum(raw);
    if (parsed === '') delete next[key];
    else next[key] = parsed;
    commit(next);
  }

  const tolGlobale = descriptionCible?.toleranceGlobale;

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sousChamps.map((ch) => {
          const axe = ch.nom;
          const tolKey = tolKeys[axe] || `tolerance${axe}`;
          return (
            <div key={axe}>
              <span style={{ ...labelStyle, marginBottom: 4 }}>{ch.libelle || axe}</span>
              <div style={rowStyle}>
                <input
                  type="number"
                  value={displayNum(obj[axe])}
                  onChange={(e) => setField(axe, e.target.value)}
                  placeholder="valeur"
                  style={{ ...inputStyle, maxWidth: 140 }}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>{ch.unite || 'm'}</span>
                <input
                  type="number"
                  value={displayNum(obj[tolKey])}
                  onChange={(e) => setField(tolKey, e.target.value)}
                  placeholder="tolérance"
                  style={{ ...inputStyle, maxWidth: 140 }}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>± {ch.unite || 'm'}</span>
              </div>
            </div>
          );
        })}
        {tolGlobale ? (
          <div>
            <span style={{ ...labelStyle, marginBottom: 4 }}>
              {tolGlobale.libelle || 'Tolérance globale'}
            </span>
            <div style={rowStyle}>
              <input
                type="number"
                value={displayNum(obj.tolerance)}
                onChange={(e) => setField('tolerance', e.target.value)}
                placeholder="tolérance globale"
                style={{ ...inputStyle, maxWidth: 140 }}
              />
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {tolGlobale.unite || 'm'}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </WidgetChrome>
  );
}
