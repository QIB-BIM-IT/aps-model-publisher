// src/models/qc/QCWarning.js
// Table qc.warnings — lignes filles du contrôle G408 : liste brute des avertissements Revit.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/database');

class QCWarning extends Model {}

QCWarning.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    controlResultId: { type: DataTypes.UUID, allowNull: false },
    runId: { type: DataTypes.UUID, allowNull: false },

    severity: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'warning',
      validate: { isIn: [['warning', 'critical']] },
    },

    description: { type: DataTypes.TEXT, allowNull: false },
    elementIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    raw: { type: DataTypes.JSONB, allowNull: true },

    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'QCWarning',
    schema: 'qc',
    tableName: 'warnings',
    timestamps: false,
  }
);

module.exports = QCWarning;
