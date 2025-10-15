// src/models/index.js
// Version compatible avec des modèles "déjà initialisés" (classe Sequelize exportée)

const sequelize = require('../config/database');

// Ces fichiers exportent directement le modèle (classe étendue de Model,
// déjà initialisée avec sequelize dans chaque fichier)
const User = require('./User');
const PublishJob = require('./PublishJob');
const PublishRun = require('./PublishRun');

// Associations avec contraintes d'intégrité référentielle activées
PublishJob.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  constraints: true,
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});
User.hasMany(PublishJob, {
  foreignKey: 'userId',
  as: 'publishJobs',
  constraints: true,
  onDelete: 'CASCADE',
});

PublishRun.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  constraints: true,
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});
User.hasMany(PublishRun, {
  foreignKey: 'userId',
  as: 'publishRuns',
  constraints: true,
  onDelete: 'CASCADE',
});

PublishRun.belongsTo(PublishJob, {
  foreignKey: 'jobId',
  as: 'job',
  constraints: true,
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});
PublishJob.hasMany(PublishRun, {
  foreignKey: 'jobId',
  as: 'runs',
  constraints: true,
  onDelete: 'CASCADE',
});

module.exports = {
  sequelize,
  User,
  PublishJob,
  PublishRun,
};
