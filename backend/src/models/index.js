// src/models/index.js
// Version compatible avec des modèles "déjà initialisés" (classe Sequelize exportée)

const sequelize = require('../config/database');

// Ces fichiers exportent directement le modèle (classe étendue de Model,
// déjà initialisée avec sequelize dans chaque fichier)
const User = require('./User');
const PublishJob = require('./PublishJob');
const PublishRun = require('./PublishRun');
const PDFExportJob = require('./PDFExportJob');
const PDFExportRun = require('./PDFExportRun');
const WebhookRegistration = require('./WebhookRegistration');

// ========== PUBLISH JOBS ASSOCIATIONS ==========
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

// ========== PDF EXPORT JOBS ASSOCIATIONS ==========
PDFExportJob.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  constraints: true,
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});
User.hasMany(PDFExportJob, {
  foreignKey: 'userId',
  as: 'pdfExportJobs',
  constraints: true,
  onDelete: 'CASCADE',
});

PDFExportRun.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  constraints: true,
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});
User.hasMany(PDFExportRun, {
  foreignKey: 'userId',
  as: 'pdfExportRuns',
  constraints: true,
  onDelete: 'CASCADE',
});

PDFExportRun.belongsTo(PDFExportJob, {
  foreignKey: 'jobId',
  as: 'job',
  constraints: true,
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});
PDFExportJob.hasMany(PDFExportRun, {
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
  PDFExportJob,
  PDFExportRun,
  WebhookRegistration,
};
