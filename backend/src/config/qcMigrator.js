// src/config/qcMigrator.js
// Migrateur umzug scopé EXCLUSIVEMENT au schéma qc.
// Le schéma public reste géré par sequelize.sync() comme aujourd'hui — ce module n'y touche jamais.
// Table de suivi : qc.migrations.
//
// Utilisé par :
//  - qcRun.service.init() au boot (up automatique, après connectDB/sync)
//  - scripts/qc-migrate.js en ligne de commande (up / down / down-all / status)

const path = require('path');
const { Umzug, SequelizeStorage } = require('umzug');
const { sequelize } = require('./database');
const logger = require('./logger');

const QC_SCHEMA = 'qc';

/** Crée le schéma qc s'il n'existe pas (idempotent). */
async function ensureQcSchema() {
  await sequelize.query(`CREATE SCHEMA IF NOT EXISTS ${QC_SCHEMA};`);
}

function buildMigrator() {
  return new Umzug({
    migrations: {
      glob: ['migrations/qc/*.js', { cwd: path.join(__dirname, '..', '..') }],
    },
    context: sequelize,
    storage: new SequelizeStorage({
      sequelize,
      schema: QC_SCHEMA,
      tableName: 'migrations',
    }),
    logger: {
      info: (msg) => logger.info(`[QC][Migrator] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`),
      warn: (msg) => logger.warn(`[QC][Migrator] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`),
      error: (msg) => logger.error(`[QC][Migrator] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`),
      debug: () => {},
    },
  });
}

/** Applique toutes les migrations qc en attente (crée le schéma au besoin). */
async function migrateUp() {
  await ensureQcSchema();
  const migrator = buildMigrator();
  const executed = await migrator.up();
  return executed.map((m) => m.name);
}

/** Annule la dernière migration qc. */
async function migrateDown() {
  const migrator = buildMigrator();
  const reverted = await migrator.down();
  return reverted.map((m) => m.name);
}

/**
 * Annule TOUTES les migrations qc puis supprime le schéma qc (y compris qc.migrations).
 * Rollback complet et réversible : un migrateUp() ultérieur reconstruit tout.
 */
async function migrateDownAll() {
  const migrator = buildMigrator();
  const reverted = await migrator.down({ to: 0 });
  // Le schéma ne contient plus que qc.migrations à ce stade ; CASCADE ne peut donc
  // emporter que des objets qc, jamais le schéma public.
  await sequelize.query(`DROP SCHEMA IF EXISTS ${QC_SCHEMA} CASCADE;`);
  return reverted.map((m) => m.name);
}

async function status() {
  await ensureQcSchema();
  const migrator = buildMigrator();
  const executed = (await migrator.executed()).map((m) => m.name);
  const pending = (await migrator.pending()).map((m) => m.name);
  return { executed, pending };
}

module.exports = {
  QC_SCHEMA,
  ensureQcSchema,
  migrateUp,
  migrateDown,
  migrateDownAll,
  status,
};
