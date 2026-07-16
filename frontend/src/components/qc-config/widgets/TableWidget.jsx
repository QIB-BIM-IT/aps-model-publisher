import React from 'react';
import WidgetChrome from './WidgetChrome';
import StringListEditor from './StringListEditor';
import { inputStyle, btnStyle, btnDanger, labelStyle } from './widgetStyles';

/**
 * Widget contrôlé — typeWidget: table (G508 paramètres 7D)
 *
 * Forme scoreur (resolveG508Config) :
 *   controles.G508 = { parametres: [{ nom, categories, seuil }] }
 * (cleConfig catalogue = "parametres" — pas un tableau nu à la racine du contrôle).
 *
 * props: { descriptionCible, valeur, onChange }
 */
function emptyRow(seuilDefaut) {
  return { nom: '', categories: [], seuil: seuilDefaut };
}

export default function TableWidget({ descriptionCible, valeur, onChange }) {
  const colonnes = Array.isArray(descriptionCible?.colonnes) ? descriptionCible.colonnes : [];
  const seuilCol = colonnes.find((c) => c.nom === 'seuil');
  const seuilDefaut =
    seuilCol && Number.isFinite(Number(seuilCol.defaut)) ? Number(seuilCol.defaut) : 100;

  const current =
    valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : null;
  // Compat: accepter aussi un tableau nu (affichage) mais toujours remonter { parametres }
  const rows = Array.isArray(current?.parametres)
    ? current.parametres
    : Array.isArray(valeur)
      ? valeur
      : Array.isArray(descriptionCible?.defaut)
        ? descriptionCible.defaut
        : [];

  function commit(nextRows) {
    onChange({ parametres: nextRows });
  }

  function updateRow(i, patch) {
    commit(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i) {
    commit(rows.filter((_, idx) => idx !== i));
  }

  function addRow() {
    commit([...rows, emptyRow(seuilDefaut)]);
  }

  return (
    <WidgetChrome descriptionCible={descriptionCible}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((row, i) => (
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
                Paramètre #{i + 1}
              </span>
              <button type="button" onClick={() => removeRow(i)} style={btnDanger}>
                Retirer
              </button>
            </div>

            <span style={labelStyle}>Nom du paramètre</span>
            <input
              type="text"
              value={row?.nom == null ? '' : String(row.nom)}
              onChange={(e) => updateRow(i, { nom: e.target.value })}
              style={{ ...inputStyle, marginBottom: 10, maxWidth: '100%' }}
            />

            <span style={labelStyle}>Catégories (BuiltInCategory)</span>
            <div style={{ marginBottom: 10 }}>
              <StringListEditor
                items={Array.isArray(row?.categories) ? row.categories : []}
                onChange={(categories) => updateRow(i, { categories })}
                placeholder="OST_…"
              />
            </div>

            <span style={labelStyle}>Seuil %</span>
            <input
              type="number"
              value={
                row?.seuil === undefined || row?.seuil === null || row?.seuil === ''
                  ? ''
                  : row.seuil
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  updateRow(i, { seuil: '' });
                  return;
                }
                const n = Number(raw);
                updateRow(i, { seuil: Number.isFinite(n) ? n : raw });
              }}
              style={{ ...inputStyle, maxWidth: 120 }}
            />
          </div>
        ))}
        <button type="button" onClick={addRow} style={btnStyle}>
          + Ajouter un paramètre
        </button>
      </div>
    </WidgetChrome>
  );
}
