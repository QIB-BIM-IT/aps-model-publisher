// src/models/index.js
// Version compatible avec des modèles "déjà initialisés" (classe Sequelize exportée)

const sequelize = require('../config/database');

// Ces fichiers exportent directement le modèle (classe étendue de Model,
// déjà initialisée avec sequelize dans chaque fichier)
const User = require('./User');
const PublishJob = require('./PublishJob');
const PublishRun = require('./PublishRun');

// Associations
PublishJob.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(PublishJob, { foreignKey: 'userId', as: 'publishJobs' });

PublishRun.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(PublishRun, { foreignKey: 'userId', as: 'publishRuns' });

PublishRun.belongsTo(PublishJob, { foreignKey: 'jobId', as: 'job' });
PublishJob.hasMany(PublishRun, { foreignKey: 'jobId', as: 'runs' });

module.exports = {
  sequelize,
  User,
  PublishJob,
  PublishRun,
};
