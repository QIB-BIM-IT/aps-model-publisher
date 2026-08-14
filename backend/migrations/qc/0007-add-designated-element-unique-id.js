// migrations/qc/0007-add-designated-element-unique-id.js
// Ajoute revitUniqueId (UniqueId Revit, identité persistante / externalId Viewer).
// Nullable : objets non instanciés et UniqueId illisible restent vides.
// Index btree partiel : recherche d'un élément par UniqueId (lot Viewer).
// Schéma qc uniquement. Réversible. Aucun objet public.

const UP_SQL = `
ALTER TABLE qc.designated_elements
  ADD COLUMN "revitUniqueId" varchar(128);

CREATE INDEX qc_designated_elements_unique_id_idx
  ON qc.designated_elements ("revitUniqueId")
  WHERE "revitUniqueId" IS NOT NULL;
`;

const DOWN_SQL = `
DROP INDEX IF EXISTS qc.qc_designated_elements_unique_id_idx;
ALTER TABLE qc.designated_elements DROP COLUMN IF EXISTS "revitUniqueId";
`;

module.exports = {
  async up({ context: sequelize }) {
    await sequelize.query(UP_SQL);
  },
  async down({ context: sequelize }) {
    await sequelize.query(DOWN_SQL);
  },
};
