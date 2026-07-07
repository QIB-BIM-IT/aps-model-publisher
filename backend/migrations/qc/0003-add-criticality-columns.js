// migrations/qc/0003-add-criticality-columns.js
// Chantier 2 (moteur de scoring) :
//  - qc.warnings.criticite : niveau résolu par la grille (high | moyen | ignorable), NULL
//    tant qu'un run n'a pas été scoré (runs antérieurs au chantier 2).
//  - qc.control_results.statut : statut du contrôle selon les seuils de volume
//    (conforme | non_conforme), NULL sur les résultats antérieurs. Colonne dédiée
//    validée par Dave (requêtable pour la synthèse par projet à venir).
// Réversible ; ne touche AUCUNE autre table.

const UP_SQL = `
ALTER TABLE qc.warnings ADD COLUMN criticite varchar(16);
CREATE INDEX qc_warnings_criticite_idx ON qc.warnings (criticite);
ALTER TABLE qc.control_results ADD COLUMN statut varchar(16);
`;

const DOWN_SQL = `
ALTER TABLE qc.control_results DROP COLUMN IF EXISTS statut;
DROP INDEX IF EXISTS qc.qc_warnings_criticite_idx;
ALTER TABLE qc.warnings DROP COLUMN IF EXISTS criticite;
`;

module.exports = {
  async up({ context: sequelize }) {
    await sequelize.query(UP_SQL);
  },
  async down({ context: sequelize }) {
    await sequelize.query(DOWN_SQL);
  },
};
