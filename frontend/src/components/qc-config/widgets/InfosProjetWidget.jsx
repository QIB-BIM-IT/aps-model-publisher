import React from 'react';
import WidgetChrome from './WidgetChrome';
import { inputStyle, btnStyle, btnDanger, labelStyle } from './widgetStyles';

/**
 * Widget contrôlé — G105 (descriptionCible.typeWidget = "table", cleConfig = "champs")
 *
 * Forme scoreur (evaluerInfosProjet) :
 *   controles.G105 = { champs: [{ cle, valeurAttendue?, mode? }] }
 * Modes: presence | contenu (défaut) | exact. Clés camelCase catalogue.
 *
 * Note: le catalogue utilise typeWidget "table" pour G105 ET G508 — discrimination
 * dans WidgetRenderer via cleConfig === "champs".
 *
 * props: { descriptionCible, valeur, onChange }
 */
function emptyChamp(modeDefaut) {
  return { cle: '', valeurAttendue: '', mode: modeDefaut };
}

export default function InfosProjetWidget({ descriptionCible, valeur, onChange }) {
  const colonnes = Array.isArray(descriptionCible?.colonnes) ? descriptionCible.colonnes : [];
  const cleCol = colonnes.find((c) => c.nom === 'cle');
  const modeCol = colonnes.find((c) => c.nom === 'mode');
  const choixChamps = Array.isArray(cleCol?.choix) ? cleCol.choix : [];
  const choixModes = Array.isArray(modeCol?.choix) ? modeCol.choix : ['presence', 'contenu', 'exact'];
  const modeDefaut = modeCol?.defaut || 'contenu';

  const current =
    valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : null;
  const champs = Array.isArray(current?.champs)
    ? current.champs
    : Array.isArray(descriptionCible?.defaut)
      ? descriptionCible.defaut
      : [];

  function commit(next) {
    onChange({ champs: next });
  }

  function updateAt(i, patch) {
    commit(champs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function removeAt(i) {
    commit(champs.filter((_, idx) => idx !== i));
  }

  function addRow() {
    const firstUnused = choixChamps.find(
      (c) => !champs.some((x) => String(x.cle) === String(c.valeur))
    );
    commit([
      ...champs,
      {
        ...emptyChamp(modeDefaut),
        cle: firstUnused ? String(firstUnused.valeur) : '',
      },
    ]);
  }

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {champs.map((row, i) => {
          const mode = row?.mode || modeDefaut;
          const presence = mode === 'presence';
          return (
            <div
              key={i}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 12,
                background: '#f8fafc',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
                  Champ #{i + 1}
                </span>
                <button type="button" onClick={() => removeAt(i)} style={btnDanger}>
                  Retirer
                </button>
              </div>

              <span style={labelStyle}>Champ ProjectInfo</span>
              <select
                value={row?.cle == null ? '' : String(row.cle)}
                onChange={(e) => updateAt(i, { cle: e.target.value })}
                style={{ ...inputStyle, marginBottom: 10, maxWidth: 320 }}
              >
                <option value="">—</option>
                {choixChamps.map((c) => {
                  const v = typeof c === 'object' ? String(c.valeur) : String(c);
                  const lab = typeof c === 'object' ? String(c.libelle ?? c.valeur) : String(c);
                  return (
                    <option key={v} value={v}>
                      {lab}
                    </option>
                  );
                })}
              </select>

              <span style={labelStyle}>Mode</span>
              <select
                value={mode}
                onChange={(e) => updateAt(i, { mode: e.target.value })}
                style={{ ...inputStyle, marginBottom: 10, maxWidth: 200 }}
              >
                {choixModes.map((m) => {
                  const v = typeof m === 'object' ? String(m.valeur ?? m) : String(m);
                  return (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  );
                })}
              </select>

              <span style={labelStyle}>Valeur attendue</span>
              <input
                type="text"
                value={row?.valeurAttendue == null ? '' : String(row.valeurAttendue)}
                onChange={(e) => updateAt(i, { valeurAttendue: e.target.value })}
                disabled={presence}
                placeholder={presence ? '(ignorée — mode presence)' : 'valeur'}
                style={{
                  ...inputStyle,
                  maxWidth: '100%',
                  opacity: presence ? 0.45 : 1,
                  background: presence ? '#f1f5f9' : '#fff',
                }}
              />
            </div>
          );
        })}
        <button type="button" onClick={addRow} style={btnStyle}>
          + Ajouter un champ
        </button>
      </div>
    </WidgetChrome>
  );
}
