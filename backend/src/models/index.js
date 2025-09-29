// src/models/index.js
// Version compatible avec des modèles "déjà initialisés" (classe Sequelize exportée)

const sequelize = require('../config/database');

// Ces fichiers exportent directement le modèle (classe étendue de Model,
// déjà initialisée avec sequelize dans chaque fichier)
const User = require('./User');
const PublishJob = require('./PublishJob');
const PublishRun = require('./PublishRun');

// Si tu as besoin d'associations, tu peux les définir ici.
// (Optionnel — à activer si nécessaire)
// PublishJob.belongsTo(User, { foreignKey: 'userId' });
// User.hasMany(PublishJob, { as: 'publishJobs', foreignKey: 'userId' });

// PublishRun.belongsTo(User, { foreignKey: 'userId' });
// User.hasMany(PublishRun, { as: 'publishRuns', foreignKey: 'userId' });

// PublishRun.belongsTo(PublishJob, { foreignKey: 'jobId' });
// PublishJob.hasMany(PublishRun, { as: 'runs', foreignKey: 'jobId' });

module.exports = {
  sequelize,
  User,
  PublishJob,
  PublishRun,
};
