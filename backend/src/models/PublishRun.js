// src/models/PublishRun.js
// Modèle PublishRun (camelCase), corrigé avec DataTypes.DATE

const { DataTypes, Model } = require('sequelize');

const dbExport = require('../config/database');
const sequelize = (dbExport && (dbExport.sequelize || dbExport)) || null;

if (!sequelize || typeof sequelize.define !== 'function') {
  throw new Error(
    '[PublishRun] Impossible d’obtenir une instance Sequelize depuis src/config/database.js. ' +
    'Assure-toi que ce fichier exporte soit directement l’instance (module.exports = sequelize), ' +
    'soit un objet { sequelize }.'
  );
}

class PublishRun extends Model {}

PublishRun.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    // Références
    jobId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },

    // Contexte
    hubId: { type: DataTypes.STRING, allowNull: false },
    projectId: { type: DataTypes.STRING, allowNull: false },

    // Copie des items au moment du run
    items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    // Statut du run
    status: {
      type: DataTypes.ENUM('queued', 'running', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'queued',
    },

    startedAt: { type: DataTypes.DATE, allowNull: true },
    endedAt:   { type: DataTypes.DATE, allowNull: true },

    // Résultats détaillés (par item)
    results: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    // Statistiques agrégées
    stats: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Message d’erreur éventuel
    message: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    modelName: 'PublishRun',
    tableName: 'publish_runs',
    indexes: [
      { fields: ['jobId'] },
      { fields: ['userId'] },
      { fields: ['projectId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
    ],
  }
);

module.exports = PublishRun;
