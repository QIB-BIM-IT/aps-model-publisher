// src/models/qc/QCJob.js
// Table qc.jobs — config de contrôle QC planifiable.
// CRUD API : /api/qc/jobs (B1). Scheduler/cron : NON branché tant que B2 n'est pas livré
// (scheduleEnabled est persisté seulement — voir qcJob.service.js).
// ⚠️ Ce modèle ne doit JAMAIS être requis avant sequelize.sync() (voir models/qc/index.js) :
// le schéma qc est géré par les migrations umzug, pas par sync.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../../config/database');

class QCJob extends Model {}

QCJob.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    // FK vers public.users — ON DELETE SET NULL (posée par la migration, pas par Sequelize)
    userId: { type: DataTypes.UUID, allowNull: true },

    name: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Contrôle qualité' },

    // Cible ACC
    hubId: { type: DataTypes.STRING, allowNull: true },
    projectId: { type: DataTypes.STRING, allowNull: false },
    projectName: { type: DataTypes.STRING, allowNull: true },
    region: { type: DataTypes.STRING(16), allowNull: true },
    accProjectGuid: { type: DataTypes.UUID, allowNull: true },
    accModelGuid: { type: DataTypes.UUID, allowNull: true },
    modelUrn: { type: DataTypes.STRING(512), allowNull: true },
    modelName: { type: DataTypes.STRING, allowNull: true },

    // Planification (scheduler branché en B2.2 — fire-and-forget, sans lock projet)
    scheduleEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    cronExpression: { type: DataTypes.STRING(64), allowNull: true },
    timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'UTC' },
    nextRun: { type: DataTypes.DATE, allowNull: true },
    lastRun: { type: DataTypes.DATE, allowNull: true },

    // Colonne de type qc.job_status côté DB ; STRING + validation côté modèle
    // pour éviter que Sequelize ne cherche/génère ses propres types enum.
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'idle',
      validate: { isIn: [['idle', 'running', 'error']] },
    },
  },
  {
    sequelize,
    modelName: 'QCJob',
    schema: 'qc',
    tableName: 'jobs',
    timestamps: true,
  }
);

module.exports = QCJob;
