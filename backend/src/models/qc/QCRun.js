// src/models/qc/QCRun.js
// Table qc.runs — une exécution DA4R sur un modèle / une révision.
// Traçabilité ISO 19650 : executedByName / executedByAutodeskId sont des snapshots figés
// au moment du run (tirés du contexte token 3 legs), indépendants de public.users.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/database');

class QCRun extends Model {}

QCRun.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    // FK ON DELETE SET NULL (posées par la migration) — la preuve survit aux suppressions
    jobId: { type: DataTypes.UUID, allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: true },

    // Snapshots de traçabilité (source de vérité, figée)
    executedByName: { type: DataTypes.STRING, allowNull: true },
    executedByAutodeskId: { type: DataTypes.STRING, allowNull: true },

    runType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'quotidien',
      validate: { isIn: [['quotidien', 'jalon']] },
    },

    startedAtUtc: { type: DataTypes.DATE, allowNull: true },
    endedAtUtc: { type: DataTypes.DATE, allowNull: true },

    revitVersion: { type: DataTypes.STRING(16), allowNull: true },
    daWorkitemId: { type: DataTypes.STRING(128), allowNull: true },

    // Identifiants ACC du modèle
    region: { type: DataTypes.STRING(16), allowNull: false },
    accProjectGuid: { type: DataTypes.UUID, allowNull: false },
    accModelGuid: { type: DataTypes.UUID, allowNull: false },
    modelVersion: { type: DataTypes.INTEGER, allowNull: true },
    versionUrn: { type: DataTypes.STRING(512), allowNull: true },

    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'queued',
      validate: { isIn: [['queued', 'submitted', 'running', 'success', 'failed']] },
    },

    message: { type: DataTypes.TEXT, allowNull: true },
    stats: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    sequelize,
    modelName: 'QCRun',
    schema: 'qc',
    tableName: 'runs',
    timestamps: true,
  }
);

module.exports = QCRun;
