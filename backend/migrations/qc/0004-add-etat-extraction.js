// migrations/qc/0004-add-etat-extraction.js
// Chantier 3 (multi-contrôles) : les deux axes JAMAIS mélangés sur qc.control_results.
//  - etat_extraction (technique) : 'extrait' | 'echec'. Défaut 'extrait' — honnête pour
//    les résultats historiques, tous extraits avec succès.
//  - erreur_extraction : message d'erreur si etat_extraction='echec' (colonne dédiée
//    validée par Dave ; les colonnes de valeur restent vides sur un échec).
// RÈGLE ABSOLUE (appliquée par le code, rappelée ici) : etat_extraction='echec' force
// statut NULL — un échec technique n'est pas une non-conformité.
// Réversible ; ne touche AUCUNE autre table, jamais le schéma public.

const UP_SQL = `
ALTER TABLE qc.control_results ADD COLUMN etat_extraction varchar(16) NOT NULL DEFAULT 'extrait';
ALTER TABLE qc.control_results ADD COLUMN erreur_extraction text;
`;

const DOWN_SQL = `
ALTER TABLE qc.control_results DROP COLUMN IF EXISTS erreur_extraction;
ALTER TABLE qc.control_results DROP COLUMN IF EXISTS etat_extraction;
`;

module.exports = {
  async up({ context: sequelize }) {
    await sequelize.query(UP_SQL);
  },
  async down({ context: sequelize }) {
    await sequelize.query(DOWN_SQL);
  },
};
