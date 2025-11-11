// src/models/PDFExportRun.js
// Modèle pour l'historique des exports PDF schedulés

const { DataTypes, Model } = require('sequelize');

const dbExport = require('../config/database');
const sequelize = (dbExport && (dbExport.sequelize || dbExport)) || null;

if (!sequelize || typeof sequelize.define !== 'function') {
  throw new Error(
    "[PDFExportRun] Impossible d'obtenir une instance Sequelize depuis src/config/database.js. " +
      'Assure-toi que ce fichier exporte soit directement l\'instance (module.exports = sequelize), ' +
      'soit un objet { sequelize }.'
  );
}

class PDFExportRun extends Model {}

PDFExportRun.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    // Références
    jobId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },

    // Contexte
    projectId: { type: DataTypes.STRING, allowNull: false },
    folderId: { type: DataTypes.STRING, allowNull: false },
    fileUrn: { type: DataTypes.STRING, allowNull: false },

    // Statut du run
    status: {
      type: DataTypes.ENUM('queued', 'running', 'success', 'failed', 'partial'),
      allowNull: false,
      defaultValue: 'queued',
    },

    startedAt: { type: DataTypes.DATE, allowNull: true },
    endedAt: { type: DataTypes.DATE, allowNull: true },

    // Résultats détaillés (fichiers uploadés)
    results: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    // Statistiques agrégées
    stats: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Message d'erreur éventuel
    message: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    modelName: 'PDFExportRun',
    tableName: 'pdf_export_runs',
    indexes: [
      { fields: ['jobId'] },
      { fields: ['userId'] },
      { fields: ['projectId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
    ],
  }
);

module.exports = PDFExportRun;
