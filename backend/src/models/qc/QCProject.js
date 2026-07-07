// src/models/qc/QCProject.js
// Table qc.projects — attributs projet uniquement (region, hub, ids ACC).
// PAS de version ici : la version Revit est au grain modèle (qc.runs.revitVersion).
// Pas de FK depuis qc.runs — jointure applicative sur accProjectGuid.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/database');

class QCProject extends Model {}

QCProject.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    region: { type: DataTypes.STRING(16), allowNull: true },
    hubId: { type: DataTypes.STRING, allowNull: true },
    projectId: { type: DataTypes.STRING, allowNull: false, unique: true },
    projectName: { type: DataTypes.STRING, allowNull: true },
    accProjectGuid: { type: DataTypes.UUID, allowNull: true, unique: true },
  },
  {
    sequelize,
    modelName: 'QCProject',
    schema: 'qc',
    tableName: 'projects',
    timestamps: true,
  }
);

module.exports = QCProject;
