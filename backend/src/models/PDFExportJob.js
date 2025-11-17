// src/models/PDFExportJob.js
// Modèle pour les jobs d'export PDF schedulés

const { DataTypes, Model } = require('sequelize');

const dbExport = require('../config/database');
const sequelize = (dbExport && (dbExport.sequelize || dbExport)) || null;

if (!sequelize || typeof sequelize.define !== 'function') {
  throw new Error(
    "[PDFExportJob] Impossible d'obtenir une instance Sequelize depuis src/config/database.js. " +
      'Assure-toi que ce fichier exporte soit directement l\'instance (module.exports = sequelize), ' +
      'soit un objet { sequelize }.'
  );
}

class PDFExportJob extends Model {}

PDFExportJob.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    // Références
    userId: { type: DataTypes.UUID, allowNull: false },

    // 🆕 Nom de la tâche
    name: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Tâche sans nom' },

    // Cible ACC
    projectId: { type: DataTypes.STRING, allowNull: false },
    projectName: { type: DataTypes.STRING, allowNull: true },
    folderId: { type: DataTypes.STRING, allowNull: false },
    folderName: { type: DataTypes.STRING, allowNull: true },

    // Sélection du fichier
    fileUrn: { type: DataTypes.STRING, allowNull: false },
    fileName: { type: DataTypes.STRING, allowNull: true },

    // Planification
    scheduleEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    cronExpression: { type: DataTypes.STRING, allowNull: false, defaultValue: '0 2 * * *' },
    timezone: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UTC' },
    nextRun: { type: DataTypes.DATE, allowNull: true },
    lastRun: { type: DataTypes.DATE, allowNull: true },

    // Options de sélection de sheets
    selectionMode: { type: DataTypes.ENUM('all', 'custom'), allowNull: false, defaultValue: 'all' },
    selectedSheets: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, // Array d'objets {name, size, type}

    // Options de filtrage
    includeSheets: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    includeViews2D: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    includeMarkups: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    // Format de sortie
    exportMode: { type: DataTypes.ENUM('individual', 'combined'), allowNull: false, defaultValue: 'individual' },
    mergedFileName: { type: DataTypes.STRING, allowNull: true },

    // Statut & stats
    status: { type: DataTypes.ENUM('idle', 'running', 'error'), allowNull: false, defaultValue: 'idle' },
    statistics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Notifications
    notificationsEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    notifyOnSuccess: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    notifyOnFailure: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    notificationRecipients: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: false, defaultValue: [] },

    // Historique
    history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  },
  {
    sequelize,
    modelName: 'PDFExportJob',
    tableName: 'pdf_export_jobs',
    indexes: [
      { fields: ['userId'] },
      { fields: ['projectId'] },
      { fields: ['scheduleEnabled'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
    ],
  }
);

module.exports = PDFExportJob;
