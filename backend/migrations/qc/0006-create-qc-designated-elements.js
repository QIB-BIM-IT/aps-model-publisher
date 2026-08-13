// migrations/qc/0006-create-qc-designated-elements.js
// Format LONG : 1 ligne = 1 élément (ou objet nommé) désigné par un contrôle, pour un run.
//
// Colonnes FIXES = champs réellement communs à l'inventaire des extracteurs
// (id Revit, catégorie, famille, type, niveau, libellé). Le reste (offset G314,
// raison, GUID paramètre, etc.) va dans `details` (jsonb).
//
// Index (filtres annoncés des briques 2/3) :
//  - runId                 : page attachée à un run
//  - (runId, controlCode)  : filtre contrôle dans un run
//  - controlCode           : comparaison inter-runs d'un même contrôle
//  - category / levelName  : filtres métier (maquette/projet = jointure qc.runs)
//
// Schéma qc uniquement. Réversible. Aucun objet public.

const UP_SQL = `
CREATE TABLE qc.designated_elements (
  id                  uuid PRIMARY KEY,
  "runId"             uuid NOT NULL REFERENCES qc.runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "controlResultId"   uuid NOT NULL REFERENCES qc.control_results(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "controlCode"       varchar(32) NOT NULL,
  "revitElementId"    bigint,
  category            varchar(255),
  "familyName"        varchar(255),
  "typeName"          varchar(255),
  "levelName"         varchar(255),
  label               varchar(512),
  kind                varchar(32) NOT NULL DEFAULT 'element',
  details             jsonb NOT NULL DEFAULT '{}',
  "createdAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX qc_designated_elements_run_idx
  ON qc.designated_elements ("runId");
CREATE INDEX qc_designated_elements_run_control_idx
  ON qc.designated_elements ("runId", "controlCode");
CREATE INDEX qc_designated_elements_control_idx
  ON qc.designated_elements ("controlCode");
CREATE INDEX qc_designated_elements_category_idx
  ON qc.designated_elements (category);
CREATE INDEX qc_designated_elements_level_idx
  ON qc.designated_elements ("levelName");
`;

const DOWN_SQL = `
DROP TABLE IF EXISTS qc.designated_elements;
`;

module.exports = {
  async up({ context: sequelize }) {
    await sequelize.query(UP_SQL);
  },
  async down({ context: sequelize }) {
    await sequelize.query(DOWN_SQL);
  },
};
