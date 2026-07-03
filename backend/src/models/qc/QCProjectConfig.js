// src/models/qc/QCProjectConfig.js
// Table qc.project_config — configuration QC par projet.
// Créée mais laissée VIDE dans cette tranche (cibles, seuils, patterns critiques viendront plus tard).

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/database');

class QCProjectConfig extends Model {}

QCProjectConfig.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    projectId: { type: DataTypes.STRING, allowNull: false, unique: true },
    config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    sequelize,
    modelName: 'QCProjectConfig',
    schema: 'qc',
    tableName: 'project_config',
    timestamps: true,
    freezeTableName: true,
  }
);

module.exports = QCProjectConfig;
