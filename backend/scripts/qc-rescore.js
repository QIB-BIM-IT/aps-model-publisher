// scripts/qc-rescore.js
// Recalcule EN PLACE la criticité des runs QC existants, sans Design Automation :
// le scoring est déterministe et rejouable depuis les données brutes stockées
// (qc.warnings.raw porte failureDefinitionId + description).
//
// Effets par contrôle G408 : qc.warnings.criticite, qc.control_results.valeur_json
// (total INCHANGÉ, critical = nb de critiques, parNiveau {critique, faible}) et statut,
// stats du run. La signature humaine n'est jamais touchée.
//
// Usage : DATABASE_URL=<base locale> node scripts/qc-rescore.js
// Garde-fou : refuse toute cible non locale.

require('dotenv').config();
const { sequelize } = require('../src/config/database');
const qcScoring = require('../src/services/qcScoring.service');

async function main() {
  const host = sequelize.config.host || '(inconnu)';
  console.log(`Hôte PostgreSQL effectif : ${host} | base : ${sequelize.config.database}`);
  if (host !== 'localhost' && host !== '127.0.0.1') {
    console.error('❌ CIBLE NON LOCALE — ARRÊT');
    process.exit(2);
  }

  const { QCRun, QCControlResult, QCWarning } = require('../src/models/qc');
  const grid = qcScoring.loadGrid();
  console.log(`Grille v${grid.version} chargée (${Object.keys(grid.guids).length} Guid(s) critique(s) listés)`);

  const results = await QCControlResult.findAll({ where: { controlCode: 'G408' } });
  let rescored = 0;

  for (const cr of results) {
    const run = await QCRun.findByPk(cr.runId);
    const warnings = await QCWarning.findAll({ where: { controlResultId: cr.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });

    const override = run ? await qcScoring.loadProjectOverride(run.accProjectGuid) : null;
    const counts = { critique: 0, faible: 0 };

    await sequelize.transaction(async (t) => {
      for (const w of warnings) {
        const guid = w.raw?.failureDefinitionId ?? null;
        const level = qcScoring.resolveLevel(guid, w.description, grid, override);
        counts[level]++;
        if (w.criticite !== level) await w.update({ criticite: level }, { transaction: t });
      }

      const total = Number(cr.valeur_num); // total d'extraction, INCHANGÉ
      const thresholds = qcScoring.resolveThresholds(grid, override);
      const statut = counts.critique > thresholds.criticalMax || total > thresholds.totalMax ? 'non_conforme' : 'conforme';

      await cr.update(
        { valeur_json: { total, critical: counts.critique, parNiveau: counts }, statut },
        { transaction: t }
      );

      if (run) {
        await run.update(
          { stats: { ...run.stats, critical: counts.critique, parNiveau: counts, statut } },
          { transaction: t }
        );
      }
    });

    rescored++;
    console.log(
      `  run ${cr.runId?.slice(0, 8)}… : total=${cr.valeur_num} critique=${counts.critique} faible=${counts.faible} statut=${cr.statut}` +
        `${override ? ' (surcharge projet)' : ''}`
    );
  }

  console.log(`\n${rescored} contrôle(s) G408 recalculé(s).`);

  // Vérification : plus aucun libellé de l'ancienne génération
  const [old] = await sequelize.query(
    `SELECT criticite, count(*) FROM qc.warnings WHERE criticite IN ('high','moyen','ignorable') GROUP BY 1`
  );
  const [oldJson] = await sequelize.query(
    `SELECT count(*) AS n FROM qc.control_results WHERE valeur_json::text ~ '(high|moyen|ignorable)'`
  );
  const [levelsNow] = await sequelize.query(`SELECT DISTINCT criticite FROM qc.warnings ORDER BY 1`);
  console.log(`Anciens libellés restants dans warnings.criticite : ${old.length ? JSON.stringify(old) : 'AUCUN'}`);
  console.log(`control_results avec anciens libellés dans valeur_json : ${oldJson[0].n}`);
  console.log(`Valeurs distinctes de criticite : ${levelsNow.map((r) => r.criticite ?? 'NULL').join(', ')}`);

  await sequelize.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
