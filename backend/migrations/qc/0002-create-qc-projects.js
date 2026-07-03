// migrations/qc/0002-create-qc-projects.js
// Chantier 1 (multimoteur) : table qc.projects — attributs PROJET uniquement.
//
// Décisions (plan approuvé) :
//  - Ce n'est PAS un cache de version : la version Revit reste au grain modèle
//    sur qc.runs.revitVersion. Aucune colonne de version ici.
//  - Aucune FK contraignante depuis qc.runs : les runs portent déjà accProjectGuid,
//    la jointure se fait dessus. Zéro ALTER des tables qc existantes.
//  - Alimentée par upsert du resolver (qcModelResolver.service) à chaque résolution réussie.

const UP_SQL = `
CREATE TABLE qc.projects (
  id               uuid PRIMARY KEY,
  region           varchar(16),
  "hubId"          varchar(255),
  "projectId"      varchar(255) NOT NULL UNIQUE,
  "projectName"    varchar(255),
  "accProjectGuid" uuid UNIQUE,
  "createdAt"      timestamptz NOT NULL,
  "updatedAt"      timestamptz NOT NULL
);
CREATE INDEX qc_projects_guid_idx ON qc.projects ("accProjectGuid");
`;

const DOWN_SQL = `
DROP TABLE IF EXISTS qc.projects;
`;

module.exports = {
  async up({ context: sequelize }) {
    await sequelize.query(UP_SQL);
  },
  async down({ context: sequelize }) {
    await sequelize.query(DOWN_SQL);
  },
};
