// Garde-fou « run déjà en cours » pour les runs QC AUTOMATIQUES.
// Module pur (pas de Sequelize, pas d'APS) : décision testable sans soumission DA.
//
// Indépendant du garde-fou version inchangée (qcSkipUnchangedVersion.js) : les deux
// se cumulent. Celui-ci couvre le cas « un workitem tourne déjà sur cette maquette ».
//
// Défaut : ACTIF. Désactivation globale : QC_SKIP_IN_FLIGHT=false|0|off|no
//
// Run manuel (Run Now / POST /runs) : trigger !== 'automatic' → jamais sauté.
// Doute (GUID absent, statut hors liste, startedAtUtc manquant) → ne pas sauter.

const NIL_GUID = '00000000-0000-0000-0000-000000000000';

// Statuts qc.runs encore « en vol » (soumis / attente DA / finalisation).
// Terminaux : success | failed (le timeout de polling écrit failed, pas un statut dédié).
const IN_FLIGHT_STATUSES = ['queued', 'submitted', 'running'];
const TERMINAL_STATUSES = ['success', 'failed'];

const DEFAULT_POLL_TIMEOUT_MS = 1_200_000; // 20 min — même défaut que QC_POLL_TIMEOUT_MS

function isSkipInFlightEnabled(env = process.env) {
  const raw = env.QC_SKIP_IN_FLIGHT;
  if (raw == null || String(raw).trim() === '') return true;
  const v = String(raw).trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

/**
 * Délai maximal pour considérer un run comme encore en cours.
 * Aligné sur le timeout de polling DA (QC_POLL_TIMEOUT_MS, défaut 20 min) :
 * au-delà, le poller marque queued/submitted en failed ; running n'est couvert
 * ni par ce timeout ni par le watchdog Publish/PDF/Copie. Sans ce plafond, un
 * run coincé en running bloquerait définitivement les automatiques de la maquette.
 */
function getInFlightMaxAgeMs(env = process.env) {
  const n = parseInt(env.QC_POLL_TIMEOUT_MS || String(DEFAULT_POLL_TIMEOUT_MS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_TIMEOUT_MS;
}

function isInFlightStatus(status) {
  return IN_FLIGHT_STATUSES.includes(String(status || ''));
}

/**
 * Un run candidat est « en cours » seulement s'il a un statut en vol ET une
 * date de début récente (≤ maxAgeMs). Absence de date → doute → false (soumettre).
 */
function isRunInFlightForSkip({ status, startedAtUtc, now = Date.now(), maxAgeMs }) {
  if (!isInFlightStatus(status)) return false;
  if (startedAtUtc == null || startedAtUtc === '') return false;
  const started = startedAtUtc instanceof Date ? startedAtUtc.getTime() : new Date(startedAtUtc).getTime();
  if (!Number.isFinite(started)) return false;
  const age = now - started;
  if (age < 0) return true;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  return age <= maxAgeMs;
}

/**
 * @param {object} p
 * @param {'automatic'|'manual'} p.trigger
 * @param {boolean} p.enabled
 * @param {object|null} p.resolved - sortie resolveModel ({ modelGuid })
 * @param {object|null} p.inFlightRun - qc.runs candidat ({ status, startedAtUtc })
 * @param {number} [p.now]
 * @param {number} p.maxAgeMs
 * @returns {boolean}
 */
function shouldSkipInFlightAutomaticRun({
  trigger,
  enabled,
  resolved,
  inFlightRun,
  now = Date.now(),
  maxAgeMs,
}) {
  if (trigger !== 'automatic') return false;
  if (!enabled) return false;
  const guid = resolved?.modelGuid || resolved?.accModelGuid;
  if (!guid || String(guid) === NIL_GUID) return false;
  if (!inFlightRun) return false;
  return isRunInFlightForSkip({
    status: inFlightRun.status,
    startedAtUtc: inFlightRun.startedAtUtc,
    now,
    maxAgeMs,
  });
}

module.exports = {
  NIL_GUID,
  IN_FLIGHT_STATUSES,
  TERMINAL_STATUSES,
  DEFAULT_POLL_TIMEOUT_MS,
  isSkipInFlightEnabled,
  getInFlightMaxAgeMs,
  isInFlightStatus,
  isRunInFlightForSkip,
  shouldSkipInFlightAutomaticRun,
};
