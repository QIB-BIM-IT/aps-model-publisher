const { DataTypes, Model } = require('sequelize');

const dbExport = require('../config/database');
const sequelize = (dbExport && (dbExport.sequelize || dbExport)) || null;

if (!sequelize || typeof sequelize.define !== 'function') {
  throw new Error(
    "[CopyJob] Impossible d'obtenir une instance Sequelize depuis src/config/database.js."
  );
}

class CopyJob extends Model {}

CopyJob.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    userId: { type: DataTypes.UUID, allowNull: false },

    name: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Tâche sans nom' },

    // Hub source (pour la navigation dashboard)
    hubId: { type: DataTypes.STRING, allowNull: true },
    hubName: { type: DataTypes.STRING, allowNull: true },

    // Projet source
    projectId: { type: DataTypes.STRING, allowNull: false },
    projectName: { type: DataTypes.STRING, allowNull: true },

    // Dossier source
    sourceFolderId: { type: DataTypes.STRING, allowNull: false },
    sourceFolderName: { type: DataTypes.STRING, allowNull: true },

    // Fichiers à copier (array d'objets {urn, name, type})
    // type optionnel: 'rvt', 'dwg', 'ifc', etc.
    files: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    // Dossier de destination (même projet ou projet différent)
    destinationProjectId: { type: DataTypes.STRING, allowNull: false },
    destinationProjectName: { type: DataTypes.STRING, allowNull: true },
    destinationFolderId: { type: DataTypes.STRING, allowNull: false },
    destinationFolderName: { type: DataTypes.STRING, allowNull: true },

    // Option : écraser si le fichier existe déjà (créer nouvelle version)
    overwriteExisting: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    // Planification
    scheduleEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    cronExpression: { type: DataTypes.STRING, allowNull: false, defaultValue: '0 2 * * *' },
    timezone: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UTC' },
    nextRun: { type: DataTypes.DATE, allowNull: true },
    lastRun: { type: DataTypes.DATE, allowNull: true },

    // Statut & stats
    status: { type: DataTypes.ENUM('idle', 'running', 'error'), allowNull: false, defaultValue: 'idle' },
    statistics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Notifications
    notificationsEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    notifyOnSuccess: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    notifyOnFailure: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    notificationRecipients: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false, defaultValue: [] },

    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  },
  {
    sequelize,
    modelName: 'CopyJob',
    tableName: 'copy_jobs',
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

module.exports = CopyJob;
