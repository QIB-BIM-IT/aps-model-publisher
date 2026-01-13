// src/models/WebhookRegistration.js
// Modèle pour stocker les webhooks APS créés (éviter les doublons)

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class WebhookRegistration extends Model {}

WebhookRegistration.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    // ID du webhook retourné par Autodesk
    apsHookId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    // Type de scope: 'folder' ou 'project'
    scopeType: {
      type: DataTypes.ENUM('folder', 'project'),
      allowNull: false,
      defaultValue: 'folder',
    },

    // URN du scope (folder URN ou project ID)
    scopeValue: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // Project ID associé
    projectId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // Hub ID associé
    hubId: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // Type d'événement surveillé (ex: dm.version.added)
    eventType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'dm.version.added',
    },

    // Callback URL utilisé
    callbackUrl: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // Statut du webhook
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'error', 'expired'),
      allowNull: false,
      defaultValue: 'active',
    },

    // Dernière erreur (si status = error)
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // Date d'expiration (les webhooks Autodesk peuvent expirer)
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    // Metadata supplémentaire
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
    },
  },
  {
    sequelize,
    modelName: 'WebhookRegistration',
    tableName: 'webhook_registrations',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['scopeType', 'scopeValue', 'eventType'],
        name: 'unique_webhook_scope',
      },
      {
        fields: ['projectId'],
      },
      {
        fields: ['status'],
      },
    ],
  }
);

module.exports = WebhookRegistration;
