// migrations/qc/0005-add-job-schedule-timestamps.js
// B2.2 — nextRun / lastRun sur qc.jobs pour planif + rattrapage créneaux manqués
// (même sémantique que publish_jobs). Réversible. Schéma qc uniquement.

const UP_SQL = `
ALTER TABLE qc.jobs ADD COLUMN IF NOT EXISTS "nextRun" timestamptz;
ALTER TABLE qc.jobs ADD COLUMN IF NOT EXISTS "lastRun" timestamptz;
`;

const DOWN_SQL = `
ALTER TABLE qc.jobs DROP COLUMN IF EXISTS "lastRun";
ALTER TABLE qc.jobs DROP COLUMN IF EXISTS "nextRun";
`;

module.exports = {
  async up({ context: sequelize }) {
    await sequelize.query(UP_SQL);
  },
  async down({ context: sequelize }) {
    await sequelize.query(DOWN_SQL);
  },
};
