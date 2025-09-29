// src/models/PublishJob.js
// Modèle PublishJob (camelCase, aligné sur ta table existante)

const { DataTypes, Model } = require('sequelize');

// Supporte les deux styles d'export de src/config/database.js
const dbExport = require('../config/database');
const sequelize = (dbExport && (dbExport.sequelize || dbExport)) || null;

if (!sequelize || typeof sequelize.define !== 'function') {
  throw new Error(
    '[PublishJob] Impossible d’obtenir une instance Sequelize depuis src/config/database.js. ' +
    'Assure-toi que ce fichier exporte soit directement l’instance (module.exports = sequelize), ' +
    'soit un objet { sequelize }.'
  );
}

class PublishJob extends Model {}

PublishJob.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    // Références
    userId: { type: DataTypes.UUID, allowNull: false },

    // Cible ACC
    hubId: { type: DataTypes.STRING, allowNull: false },
    hubName: { type: DataTypes.STRING, allowNull: true },
    projectId: { type: DataTypes.STRING, allowNull: false },
    projectName: { type: DataTypes.STRING, allowNull: true },

    folderId: { type: DataTypes.STRING, allowNull: true },
    folderName: { type: DataTypes.STRING, allowNull: true },

    // Sélection (URN lineage)
    models: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    // Planification
    scheduleEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    cronExpression: { type: DataTypes.STRING, allowNull: false, defaultValue: '0 2 * * *' },
    timezone: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UTC' },
    nextRun: { type: DataTypes.DATE, allowNull: true },
    lastRun: { type: DataTypes.DATE, allowNull: true },

    // Options publication
    outputFormat: { type: DataTypes.STRING, allowNull: true, defaultValue: 'default' },
    publishViews: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    publishSheets: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    includeLinkedModels: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    publishOptions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Statut & stats
    status: { type: DataTypes.ENUM('idle', 'running', 'error'), allowNull: false, defaultValue: 'idle' },
    statistics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Notifications
    notificationsEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    notifyOnSuccess: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    notifyOnFailure: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    notificationRecipients: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false, defaultValue: [] },

    // Webhooks & petit historique
    webhooks: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  },
  {
    sequelize,
    modelName: 'PublishJob',
    tableName: 'publish_jobs',   // on garde ce nom de table
    // PAS d'underscored -> Sequelize utilisera les colonnes camelCase existantes
    indexes: [
      { fields: ['userId'] },
      { fields: ['hubId'] },
      { fields: ['projectId'] },
      { fields: ['scheduleEnabled'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
    ],
  }
);

module.exports = PublishJob;
