const { DataTypes, Model } = require('sequelize');

const dbExport = require('../config/database');
const sequelize = (dbExport && (dbExport.sequelize || dbExport)) || null;

if (!sequelize || typeof sequelize.define !== 'function') {
  throw new Error(
    "[CopyRun] Impossible d'obtenir une instance Sequelize depuis src/config/database.js."
  );
}

class CopyRun extends Model {}

CopyRun.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    jobId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },

    projectId: { type: DataTypes.STRING, allowNull: false },
    destinationProjectId: { type: DataTypes.STRING, allowNull: false },
    destinationFolderId: { type: DataTypes.STRING, allowNull: false },

    // Fichiers au moment du run
    items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    status: {
      type: DataTypes.ENUM('queued', 'running', 'success', 'failed', 'partial'),
      allowNull: false,
      defaultValue: 'queued',
    },

    startedAt: { type: DataTypes.DATE, allowNull: true },
    endedAt: { type: DataTypes.DATE, allowNull: true },

    results: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    stats: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    message: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    modelName: 'CopyRun',
    tableName: 'copy_runs',
    indexes: [
      { fields: ['jobId'] },
      { fields: ['userId'] },
      { fields: ['projectId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
    ],
  }
);

module.exports = CopyRun;
