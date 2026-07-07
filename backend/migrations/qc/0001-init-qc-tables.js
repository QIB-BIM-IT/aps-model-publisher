// migrations/qc/0001-init-qc-tables.js
// Tranche verticale QC : 5 tables du schéma qc (jobs, runs, control_results, warnings, project_config).
//
// Décisions d'intégrité (ISO 19650 — la preuve survit aux suppressions) :
//  - qc.jobs.userId  -> public.users : ON DELETE SET NULL (jamais CASCADE vers public)
//  - qc.runs.userId  -> public.users : ON DELETE SET NULL
//  - qc.runs.jobId   -> qc.jobs      : ON DELETE SET NULL (supprimer une config de job ne doit pas effacer les runs)
//  - qc.control_results.runId -> qc.runs : CASCADE (composent un seul enregistrement)
//  - qc.warnings -> qc.control_results / qc.runs : CASCADE (idem)
// Les colonnes snapshot executedByName / executedByAutodeskId sur qc.runs sont la source
// de vérité de la traçabilité, figées, indépendantes de public.users.
//
// NOTE : cette migration ne touche QUE le schéma qc. La FK vers public.users est portée
// par les tables qc et n'altère pas la définition de public.users.

const UP_SQL = `
CREATE TYPE qc.run_type AS ENUM ('quotidien', 'jalon');
CREATE TYPE qc.run_status AS ENUM ('queued', 'submitted', 'running', 'success', 'failed');
CREATE TYPE qc.job_status AS ENUM ('idle', 'running', 'error');

-- Jobs planifiés QC (même pattern que publish_jobs ; minimal pour la tranche, cron non branché)
CREATE TABLE qc.jobs (
  id                uuid PRIMARY KEY,
  "userId"          uuid REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  name              varchar(255) NOT NULL DEFAULT 'Contrôle qualité',
  "hubId"           varchar(255),
  "projectId"       varchar(255) NOT NULL,
  "projectName"     varchar(255),
  region            varchar(16),
  "accProjectGuid"  uuid,
  "accModelGuid"    uuid,
  "modelUrn"        varchar(512),
  "modelName"       varchar(255),
  "scheduleEnabled" boolean NOT NULL DEFAULT false,
  "cronExpression"  varchar(64),
  timezone          varchar(64) NOT NULL DEFAULT 'UTC',
  status            qc.job_status NOT NULL DEFAULT 'idle',
  "createdAt"       timestamptz NOT NULL,
  "updatedAt"       timestamptz NOT NULL
);
CREATE INDEX qc_jobs_user_idx ON qc.jobs ("userId");
CREATE INDEX qc_jobs_project_idx ON qc.jobs ("projectId");

-- Un run = une exécution DA4R sur un modèle / une révision
CREATE TABLE qc.runs (
  id                     uuid PRIMARY KEY,
  "jobId"                uuid REFERENCES qc.jobs(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "userId"               uuid REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "executedByName"       varchar(255),
  "executedByAutodeskId" varchar(255),
  "runType"              qc.run_type NOT NULL DEFAULT 'quotidien',
  "startedAtUtc"         timestamptz,
  "endedAtUtc"           timestamptz,
  "revitVersion"         varchar(16),
  "daWorkitemId"         varchar(128),
  region                 varchar(16) NOT NULL,
  "accProjectGuid"       uuid NOT NULL,
  "accModelGuid"         uuid NOT NULL,
  "modelVersion"         integer,
  "versionUrn"           varchar(512),
  status                 qc.run_status NOT NULL DEFAULT 'queued',
  message                text,
  stats                  jsonb NOT NULL DEFAULT '{}',
  "createdAt"            timestamptz NOT NULL,
  "updatedAt"            timestamptz NOT NULL
);
CREATE INDEX qc_runs_job_idx ON qc.runs ("jobId");
CREATE INDEX qc_runs_user_idx ON qc.runs ("userId");
CREATE INDEX qc_runs_model_idx ON qc.runs ("accProjectGuid", "accModelGuid");
CREATE INDEX qc_runs_workitem_idx ON qc.runs ("daWorkitemId");
CREATE INDEX qc_runs_status_idx ON qc.runs (status);

-- Format long strict : 1 ligne = 1 contrôle x 1 modèle x 1 révision (modèle/révision portés par le run)
CREATE TABLE qc.control_results (
  id            uuid PRIMARY KEY,
  "runId"       uuid NOT NULL REFERENCES qc.runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "controlCode" varchar(32) NOT NULL,
  valeur_num    numeric,
  valeur_text   text,
  valeur_json   jsonb,
  controleur    varchar(255),
  date_controle timestamptz,
  regle         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qc_control_results_run_control_unique UNIQUE ("runId", "controlCode")
);
CREATE INDEX qc_control_results_control_idx ON qc.control_results ("controlCode");

-- Lignes filles de G408 : liste brute des avertissements
CREATE TABLE qc.warnings (
  id                uuid PRIMARY KEY,
  "controlResultId" uuid NOT NULL REFERENCES qc.control_results(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "runId"           uuid NOT NULL REFERENCES qc.runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
  severity          varchar(16) NOT NULL DEFAULT 'warning',
  description       text NOT NULL,
  "elementIds"      jsonb NOT NULL DEFAULT '[]',
  raw               jsonb,
  "createdAt"       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qc_warnings_run_idx ON qc.warnings ("runId");
CREATE INDEX qc_warnings_result_idx ON qc.warnings ("controlResultId");

-- Vide dans cette tranche ; structure posée pour la suite (cibles, seuils, patterns critiques…)
CREATE TABLE qc.project_config (
  id            uuid PRIMARY KEY,
  "projectId"   varchar(255) NOT NULL UNIQUE,
  config        jsonb NOT NULL DEFAULT '{}',
  "createdAt"   timestamptz NOT NULL,
  "updatedAt"   timestamptz NOT NULL
);
`;

const DOWN_SQL = `
DROP TABLE IF EXISTS qc.project_config;
DROP TABLE IF EXISTS qc.warnings;
DROP TABLE IF EXISTS qc.control_results;
DROP TABLE IF EXISTS qc.runs;
DROP TABLE IF EXISTS qc.jobs;
DROP TYPE IF EXISTS qc.job_status;
DROP TYPE IF EXISTS qc.run_status;
DROP TYPE IF EXISTS qc.run_type;
`;

module.exports = {
  async up({ context: sequelize }) {
    await sequelize.query(UP_SQL);
  },
  async down({ context: sequelize }) {
    await sequelize.query(DOWN_SQL);
  },
};
