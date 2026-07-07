// src/models/qc/QCControlResult.js
// Table qc.control_results — format long strict : 1 ligne = 1 contrôle x 1 modèle x 1 révision
// (le modèle et la révision sont portés par le run).
// Les champs de signature humaine (controleur, date_controle, regle) restent NULL sur un run automatique.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/database');

class QCControlResult extends Model {}

QCControlResult.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    runId: { type: DataTypes.UUID, allowNull: false },

    controlCode: { type: DataTypes.STRING(32), allowNull: false },

    // La valeur relevée, stockée selon sa nature
    valeur_num: { type: DataTypes.DECIMAL, allowNull: true },
    valeur_text: { type: DataTypes.TEXT, allowNull: true },
    valeur_json: { type: DataTypes.JSONB, allowNull: true },

    // Signature humaine — vide sur run automatique
    controleur: { type: DataTypes.STRING, allowNull: true },
    date_controle: { type: DataTypes.DATE, allowNull: true },
    regle: { type: DataTypes.TEXT, allowNull: true },

    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'QCControlResult',
    schema: 'qc',
    tableName: 'control_results',
    timestamps: false,
  }
);

module.exports = QCControlResult;
