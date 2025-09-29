// src/config/database.js
const { Sequelize } = require('sequelize');
const logger = require('./logger');

const isDbLoggingOn = String(process.env.DB_LOGGING || '').toLowerCase() === 'true';
const loggingFn = isDbLoggingOn ? (msg) => logger.debug(msg) : false;

function getDatabaseConfig() {
  // Support DATABASE_URL (ex: cloud) ou variables séparées (local)
  const hasUrl = !!process.env.DATABASE_URL;
  const sslEnabled = String(process.env.DB_SSL || '').toLowerCase() === 'true';

  if (hasUrl) {
    return {
      dialect: 'postgres',
      protocol: 'postgres',
      host: process.env.DB_HOST,
      logging: loggingFn,
      dialectOptions: sslEnabled
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : {},
      define: {
        underscored: false,
        freezeTableName: false,
      },
      // pool soft par défaut
      pool: { max: 10, min: 0, idle: 10000, acquire: 30000 },
      url: process.env.DATABASE_URL,
      use_env_variable: 'DATABASE_URL',
    };
  }

  return {
    database: process.env.DB_NAME || 'aps_model_publisher',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    dialect: process.env.DB_DIALECT || 'postgres',
    logging: loggingFn,
    dialectOptions: sslEnabled
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {},
    define: {
      underscored: false,
      freezeTableName: false,
    },
    pool: { max: 10, min: 0, idle: 10000, acquire: 30000 },
  };
}

const cfg = getDatabaseConfig();

// Création de l’instance Sequelize
const sequelize = cfg.url
  ? new Sequelize(cfg.url, cfg)
  : new Sequelize(cfg.database, cfg.username, cfg.password, cfg);

/**
 * Connexion et synchronisation des modèles.
 * - charge les modèles/associations
 * - authenticate()
 * - sync() (ou alter si besoin)
 */
async function connectDB() {
  try {
    // Charge les modèles AVANT authenticate/sync
    require('../models');

    await sequelize.authenticate();
    logger.info('Connexion PostgreSQL établie avec succès');

    // Création/sync des tables. En dev, alter:true facilite l’évolution des schémas.
    const alter = String(process.env.DB_SYNC_ALTER || 'true').toLowerCase() === 'true';
    await sequelize.sync({ alter });
    logger.info(`Synchronisation Sequelize terminée (alter=${alter})`);
  } catch (err) {
    logger.error(`Erreur de connexion/synchronisation PostgreSQL: ${err.message}`);
    throw err;
  }
}

// Fermeture gracieuse
process.on('beforeExit', async () => {
  try {
    await sequelize.close();
    logger.info('Connexion PostgreSQL fermée');
  } catch (err) {
    logger.error(`Erreur lors de la fermeture de PostgreSQL: ${err.message}`);
  }
});

module.exports = {
  sequelize,
  connectDB,
};
