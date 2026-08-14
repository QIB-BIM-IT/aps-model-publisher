// src/models/qc/QCDesignatedElement.js
// Table qc.designated_elements — format long : 1 ligne = 1 élément/objet désigné.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/database');

class QCDesignatedElement extends Model {}

QCDesignatedElement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    runId: { type: DataTypes.UUID, allowNull: false },
    controlResultId: { type: DataTypes.UUID, allowNull: false },
    controlCode: { type: DataTypes.STRING(32), allowNull: false },

    revitElementId: { type: DataTypes.BIGINT, allowNull: true },
    revitUniqueId: { type: DataTypes.STRING(128), allowNull: true },
    category: { type: DataTypes.STRING(255), allowNull: true },
    familyName: { type: DataTypes.STRING(255), allowNull: true },
    typeName: { type: DataTypes.STRING(255), allowNull: true },
    levelName: { type: DataTypes.STRING(255), allowNull: true },
    label: { type: DataTypes.STRING(512), allowNull: true },
    kind: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'element' },
    details: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'QCDesignatedElement',
    schema: 'qc',
    tableName: 'designated_elements',
    timestamps: false,
  }
);

module.exports = QCDesignatedElement;
