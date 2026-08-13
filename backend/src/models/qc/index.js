// src/models/qc/index.js
// Point d'entrée des modèles du schéma qc + associations internes.
//
// ⚠️ RÈGLE DE CHARGEMENT : ce module ne doit être requis qu'APRÈS sequelize.sync()
// (donc après connectDB()). Les modèles qc échappent ainsi au sync({alter}) qui gère
// le schéma public — le schéma qc est géré exclusivement par les migrations umzug
// (src/config/qcMigrator.js). Ne jamais importer ce fichier depuis models/index.js.
//
// En pratique : seuls qcRun.service (via son getModels() paresseux) et les scripts
// dédiés doivent requérir ce module.

const QCJob = require('./QCJob');
const QCRun = require('./QCRun');
const QCControlResult = require('./QCControlResult');
const QCWarning = require('./QCWarning');
const QCDesignatedElement = require('./QCDesignatedElement');
const QCProjectConfig = require('./QCProjectConfig');
const QCProject = require('./QCProject'); // pas d'association contraignante — jointure sur accProjectGuid

// User est déjà chargé par l'app à ce stade ; associations en lecture seule,
// constraints: false → Sequelize ne crée/modifie AUCUNE contrainte (elles sont
// posées par la migration, avec ON DELETE SET NULL côté public).
const User = require('../User');

QCJob.belongsTo(User, { foreignKey: 'userId', as: 'user', constraints: false });
QCRun.belongsTo(User, { foreignKey: 'userId', as: 'user', constraints: false });

QCRun.belongsTo(QCJob, { foreignKey: 'jobId', as: 'job', constraints: false });
QCJob.hasMany(QCRun, { foreignKey: 'jobId', as: 'runs', constraints: false });

QCControlResult.belongsTo(QCRun, { foreignKey: 'runId', as: 'run', constraints: false });
QCRun.hasMany(QCControlResult, { foreignKey: 'runId', as: 'controlResults', constraints: false });

QCWarning.belongsTo(QCControlResult, { foreignKey: 'controlResultId', as: 'controlResult', constraints: false });
QCControlResult.hasMany(QCWarning, { foreignKey: 'controlResultId', as: 'warnings', constraints: false });
QCWarning.belongsTo(QCRun, { foreignKey: 'runId', as: 'run', constraints: false });
QCRun.hasMany(QCWarning, { foreignKey: 'runId', as: 'warnings', constraints: false });

QCDesignatedElement.belongsTo(QCControlResult, { foreignKey: 'controlResultId', as: 'controlResult', constraints: false });
QCControlResult.hasMany(QCDesignatedElement, { foreignKey: 'controlResultId', as: 'designatedElements', constraints: false });
QCDesignatedElement.belongsTo(QCRun, { foreignKey: 'runId', as: 'run', constraints: false });
QCRun.hasMany(QCDesignatedElement, { foreignKey: 'runId', as: 'designatedElements', constraints: false });

module.exports = {
  QCJob,
  QCRun,
  QCControlResult,
  QCWarning,
  QCDesignatedElement,
  QCProjectConfig,
  QCProject,
};
