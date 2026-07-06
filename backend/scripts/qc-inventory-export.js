// scripts/qc-inventory-export.js
// Inventaire des Guids de définition d'avertissement : agrège TOUT qc.warnings
// (tous runs confondus), groupé par Guid, et exporte un CSV à annoter dans Excel.
//
// Colonnes : guid;texte_exemple;occurrences;nb_modeles;classification_actuelle;critique_a_remplir
//   - occurrences : nombre total de lignes qc.warnings portant ce Guid (tous runs,
//     y compris les re-runs d'un même modèle — les re-runs gonflent ce compte)
//   - nb_modeles : nombre de modèles DISTINCTS (accModelGuid) où le Guid apparaît
//   - classification_actuelle : 'critique' si listé dans la grille maison, sinon 'faible' (défaut)
//   - critique_a_remplir : colonne vide, à annoter manuellement
// CSV en UTF-8 avec BOM, séparateur ';' (Excel français).
//
// Usage : DATABASE_URL=<base locale> node scripts/qc-inventory-export.js [--out <fichier.csv>]

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../src/config/database');
const qcScoring = require('../src/services/qcScoring.service');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function csvField(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  // Garde-fou hôte local
  const host = sequelize.config.host || '(inconnu)';
  console.log(`Hôte PostgreSQL effectif : ${host} | base : ${sequelize.config.database}`);
  if (host !== 'localhost' && host !== '127.0.0.1') {
    console.error('❌ CIBLE NON LOCALE — ARRÊT');
    process.exit(2);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = arg('--out', path.join(__dirname, '..', 'exports', `qc-guid-inventory-${stamp}.csv`));

  const grid = qcScoring.loadGrid();

  const [rows] = await sequelize.query(`
    SELECT
      lower(w.raw->>'failureDefinitionId')      AS guid,
      min(w.description)                        AS texte_exemple,
      count(*)::int                             AS occurrences,
      count(DISTINCT r."accModelGuid")::int     AS nb_modeles
    FROM qc.warnings w
    JOIN qc.runs r ON r.id = w."runId"
    GROUP BY 1
    ORDER BY occurrences DESC, guid;
  `);

  const lines = ['guid;texte_exemple;occurrences;nb_modeles;classification_actuelle;critique_a_remplir'];
  for (const r of rows) {
    const classification = grid.guids?.[r.guid] ? 'critique' : 'faible';
    lines.push(
      [r.guid, r.texte_exemple, r.occurrences, r.nb_modeles, classification, ''].map(csvField).join(';')
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, '﻿' + lines.join('\r\n') + '\r\n', 'utf8'); // BOM pour Excel

  console.log(`\n${rows.length} Guid(s) distinct(s) — CSV écrit : ${outPath}\n`);
  console.log(lines.slice(0, 16).join('\n'));

  await sequelize.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
