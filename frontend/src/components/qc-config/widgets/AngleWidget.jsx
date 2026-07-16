import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle, labelStyle, rowStyle, aideStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: angle (G202)
 * Forme scoreur: controles.G202.cible = { angle, tolerance } (degrés, nord projet).
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

export default function AngleWidget({ descriptionCible, valeur, onChange }) {
  const obj = valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : {};
  const champs = Array.isArray(descriptionCible?.champs) ? descriptionCible.champs : [];
  const angleMeta = champs.find((c) => c.nom === 'angle') || { nom: 'angle', libelle: 'Angle attendu' };
  const tolMeta =
    champs.find((c) => c.nom === 'tolerance') || { nom: 'tolerance', libelle: 'Tolérance angulaire' };
  const unite = descriptionCible?.unite || 'degres';

  function commit(next) {
    const has =
      (next.angle !== undefined && next.angle !== null && next.angle !== '') ||
      (next.tolerance !== undefined && next.tolerance !== null && next.tolerance !== '');
    onChange(has ? next : null);
  }

  function setField(key, raw) {
    const next = { ...obj };
    const parsed = parseNum(raw);
    if (parsed === '') delete next[key];
    else next[key] = parsed;
    commit(next);
  }

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <span style={{ ...aideStyle, marginBottom: 8 }}>
        Angle du nord projet (orientation de travail du modèle — pas le nord géographique).
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <span style={{ ...labelStyle, marginBottom: 4 }}>{angleMeta.libelle}</span>
          <div style={rowStyle}>
            <input
              type="number"
              value={displayNum(obj.angle)}
              onChange={(e) => setField('angle', e.target.value)}
              style={{ ...inputStyle, maxWidth: 160 }}
            />
            <span style={{ fontSize: 12, color: '#64748b' }}>{unite}</span>
          </div>
        </div>
        <div>
          <span style={{ ...labelStyle, marginBottom: 4 }}>{tolMeta.libelle}</span>
          <div style={rowStyle}>
            <input
              type="number"
              value={displayNum(obj.tolerance)}
              onChange={(e) => setField('tolerance', e.target.value)}
              style={{ ...inputStyle, maxWidth: 160 }}
            />
            <span style={{ fontSize: 12, color: '#64748b' }}>± {unite}</span>
          </div>
        </div>
      </div>
    </WidgetChrome>
  );
}
