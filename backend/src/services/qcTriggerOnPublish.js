// Déclenchement d'un run QC automatique à la publication (dm.version.added).
// Module pur : décision testable sans APS ni Sequelize.
//
// Interrupteur global QC_TRIGGER_ON_PUBLISH : DÉSACTIVÉ par défaut.
// Activation : true | 1 | on | yes
//
// Ne touche pas aux garde-fous version / in-flight (appliqués par startRun
// quand trigger=automatic).

function isTriggerOnPublishEnabled(env = process.env) {
  const raw = env.QC_TRIGGER_ON_PUBLISH;
  if (raw == null || String(raw).trim() === '') return false;
  const v = String(raw).trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(v);
}

function getTipRetryDelayMs(env = process.env) {
  const n = parseInt(env.QC_TRIGGER_ON_PUBLISH_TIP_RETRY_MS || '8000', 10);
  if (!Number.isFinite(n) || n < 0) return 8000;
  return n;
}

/**
 * Filtre maquette Revit sans appel Autodesk supplémentaire.
 * Fiable et suffisant : l'événement porte le nom du fichier (et parfois ext).
 * C4R workshared se publie sous un nom .rvt. PDF / copies / DWG exclus.
 */
function isRevitModelPayload(payload = {}) {
  const name = String(payload.name || payload.fileName || '').trim();
  if (/\.rvt$/i.test(name)) return true;
  const ext = payload.ext;
  if (typeof ext === 'string' && ext.replace(/^\./, '').toLowerCase() === 'rvt') return true;
  const extType = ext && typeof ext === 'object' ? String(ext.type || '') : '';
  if (/c4rmodel/i.test(extType) && /\.rvt$/i.test(name || '')) return true;
  return false;
}

/**
 * Clé de lignée comparable (dm.lineage:ID ou, repli, vf.ID).
 * Les préfixes wipprod / wipemea ne font pas partie de la clé — même fichier
 * régionné différemment reste matchable. On ne convertit JAMAIS b.<guid> ↔ GUID ACC.
 */
function lineageKey(urn) {
  const s = String(urn || '').trim();
  if (!s) return '';
  const lin = s.match(/dm\.lineage:([^?]+)/i);
  if (lin) return lin[1];
  const vf = s.match(/fs\.file:vf\.([^?]+)/i);
  if (vf) return vf[1];
  return s;
}

function urnsMatch(a, b) {
  const ka = lineageKey(a);
  const kb = lineageKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/**
 * Correspondance projet en TENANT COMPTE du piège b.<guid> vs GUID ACC :
 * on compare job.projectId (DM préfixé) aux formes b. / nu DU MÊME identifiant,
 * et job.accProjectGuid au GUID nu s'il est posé. Jamais projectId.slice(2)
 * comme s'il était l'accProjectGuid.
 */
function projectJobMatches(job, rawProject) {
  const raw = String(rawProject || '').trim();
  if (!raw) return true;
  const jobPid = String(job?.projectId || '').trim();
  if (jobPid === raw || (jobPid && jobPid === `b.${raw}`)) return true;
  const acc = String(job?.accProjectGuid || '').trim().toLowerCase();
  if (acc) {
    const r = raw.toLowerCase();
    if (r === acc || r === `b.${acc}`) return true;
  }
  return false;
}

/**
 * Tip DM encore à l'ancienne version alors que le webhook annonce plus récent
 * → le garde-fou version inchangée sauterait à tort. Une reprise est justifiée.
 */
function shouldRetryForStaleTip({
  skipped,
  skipReason,
  webhookVersion,
  resolvedVersion,
  webhookVersionUrn,
  resolvedVersionUrn,
}) {
  if (!skipped || skipReason !== 'unchanged_version') return false;
  const wUrn = webhookVersionUrn ? String(webhookVersionUrn) : '';
  const rUrn = resolvedVersionUrn ? String(resolvedVersionUrn) : '';
  if (wUrn && rUrn && wUrn !== rUrn) return true;
  if (webhookVersion == null || resolvedVersion == null) return false;
  const w = Number(webhookVersion);
  const r = Number(resolvedVersion);
  if (!Number.isFinite(w) || !Number.isFinite(r)) return false;
  return w > r;
}

module.exports = {
  isTriggerOnPublishEnabled,
  getTipRetryDelayMs,
  isRevitModelPayload,
  lineageKey,
  urnsMatch,
  projectJobMatches,
  shouldRetryForStaleTip,
};
