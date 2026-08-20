// Garde-fou « version inchangée » pour les runs QC AUTOMATIQUES.
// Module pur (pas de Sequelize, pas d'APS) : décision testable sans soumission DA.
//
// Défaut : ACTIF. Désactivation globale : QC_SKIP_UNCHANGED_VERSION=false|0|off|no
// (réglage d'environnement, pas par tâche — une colonne qc.jobs exigerait une migration).
//
// Run manuel (Run Now / POST /runs) : trigger !== 'automatic' → jamais sauté.

const NIL_GUID = '00000000-0000-0000-0000-000000000000';

function isSkipUnchangedVersionEnabled(env = process.env) {
  const raw = env.QC_SKIP_UNCHANGED_VERSION;
  if (raw == null || String(raw).trim() === '') return true;
  const v = String(raw).trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

/**
 * Compare la version résolue (métadonnée DM, avant submit) au dernier run réussi.
 * versionUrn (identité APS de la version tip) est préféré ; modelVersion (entier ACC)
 * sert de repli si l'un des URN est absent. Si aucune paire comparable n'existe,
 * retourne false (ne pas sauter).
 */
function sameModelVersion(resolved, lastRun) {
  const resolvedUrn = resolved?.versionUrn ? String(resolved.versionUrn) : '';
  const lastUrn = lastRun?.versionUrn ? String(lastRun.versionUrn) : '';
  if (resolvedUrn && lastUrn) return resolvedUrn === lastUrn;

  const a = resolved?.dmVersionNumber;
  const b = lastRun?.modelVersion;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

function resolvedVersionIsKnown(resolved) {
  if (!resolved) return false;
  if (resolved.versionUrn) return true;
  return resolved.dmVersionNumber != null;
}

/**
 * @param {object} p
 * @param {'automatic'|'manual'} p.trigger
 * @param {boolean} p.enabled
 * @param {object|null} p.resolved  - sortie resolveModel ({ modelGuid, versionUrn, dmVersionNumber })
 * @param {object|null} p.lastSuccess - qc.runs success ({ versionUrn, modelVersion })
 * @returns {boolean}
 */
function shouldSkipUnchangedAutomaticRun({ trigger, enabled, resolved, lastSuccess }) {
  if (trigger !== 'automatic') return false;
  if (!enabled) return false;
  const guid = resolved?.modelGuid || resolved?.accModelGuid;
  if (!guid || String(guid) === NIL_GUID) return false;
  if (!resolvedVersionIsKnown(resolved)) return false;
  if (!lastSuccess) return false;
  return sameModelVersion(resolved, lastSuccess);
}

module.exports = {
  NIL_GUID,
  isSkipUnchangedVersionEnabled,
  sameModelVersion,
  resolvedVersionIsKnown,
  shouldSkipUnchangedAutomaticRun,
};
