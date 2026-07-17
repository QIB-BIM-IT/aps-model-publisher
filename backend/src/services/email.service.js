// src/services/email.service.js
// Service d'envoi d'emails d'alerte via Azure Communication Services (ACS) Email.
// Deux types d'alerte : 'failed' (la tâche a échoué) et 'stuck' (tâche bloquée / trop longue).
// Piloté par variables d'environnement :
//   EMAIL_ENABLED          : 'true' pour activer l'envoi
//   ACS_CONNECTION_STRING  : connection string de la ressource Communication Services
//   EMAIL_FROM             : adresse expéditrice (ex: DoNotReply@<sous-domaine>.azurecomm.net)
//   APP_BASE_URL           : URL publique de l'app pour le lien (fallback: CORS_ORIGIN)

const { EmailClient } = require('@azure/communication-email');
const logger = require('../config/logger');

const APP_NAME = 'APS Model Publisher';

const EMAIL_ENABLED = String(process.env.EMAIL_ENABLED || 'false').toLowerCase() === 'true';
const ACS_CONNECTION_STRING = process.env.ACS_CONNECTION_STRING || '';
const EMAIL_FROM_RAW = process.env.EMAIL_FROM || '';
const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.CORS_ORIGIN || '').replace(/\/+$/, '');

// EMAIL_FROM peut être "Nom <adresse@domaine>" : on extrait l'adresse seule (requise par ACS).
function parseSenderAddress(raw) {
  if (!raw) return '';
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}
const SENDER_ADDRESS = parseSenderAddress(EMAIL_FROM_RAW);

let client = null;
function getClient() {
  if (!EMAIL_ENABLED) return null;
  if (!ACS_CONNECTION_STRING || !SENDER_ADDRESS) {
    logger.warn('[Email] EMAIL_ENABLED=true mais ACS_CONNECTION_STRING ou EMAIL_FROM manquant — envoi désactivé.');
    return null;
  }
  if (!client) {
    try {
      client = new EmailClient(ACS_CONNECTION_STRING);
      logger.info('[Email] Client ACS Email initialisé.');
    } catch (e) {
      logger.error(`[Email] Erreur initialisation client ACS: ${e.message}`);
      client = null;
    }
  }
  return client;
}

function isEnabled() {
  return EMAIL_ENABLED && !!ACS_CONNECTION_STRING && !!SENDER_ADDRESS;
}

function jobTypeLabel(jobType) {
  if (jobType === 'pdf-export') return 'Export PDF';
  if (jobType === 'file-copy') return 'Copie de fichiers';
  if (jobType === 'publish') return 'Publication';
  if (jobType === 'qc') return 'Contrôle qualité';
  return 'Tâche';
}

function formatDate(date) {
  const d = date ? new Date(date) : new Date();
  try {
    return d.toLocaleString('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short' });
  } catch {
    return d.toISOString();
  }
}

// Construit le sujet : Nom de l'app — Nom de la tâche — <Échec|Bloquée> — Date
function buildSubject({ reason, jobName, occurredAt }) {
  const reasonLabel = reason === 'stuck' ? 'Tâche bloquée' : 'Échec';
  return `${APP_NAME} — ${jobName || 'Tâche'} — ${reasonLabel} — ${formatDate(occurredAt)}`;
}

function buildBody({ reason, jobName, jobType, jobId, runId, errorMessage, occurredAt, jobDetails = {} }) {
  const isStuck = reason === 'stuck';
  const typeLabel = jobTypeLabel(jobType);
  const dateStr = formatDate(occurredAt);
  const projectName = jobDetails.projectName || 'N/A';
  const headerColor = isStuck ? '#d97706' : '#dc2626';
  const headerColor2 = isStuck ? '#b45309' : '#991b1b';
  const icon = isStuck ? '⏳' : '❌';
  const title = isStuck
    ? `${icon} Tâche bloquée (trop longue)`
    : `${icon} Échec de la tâche`;
  const intro = isStuck
    ? `La tâche <b>${jobName || 'sans nom'}</b> (${typeLabel}) semble <b>bloquée</b> : elle s'exécute depuis trop longtemps et a été interrompue automatiquement. Une intervention peut être nécessaire.`
    : `La tâche <b>${jobName || 'sans nom'}</b> (${typeLabel}) a <b>échoué</b>. Consulte le détail ci-dessous et l'application pour plus d'informations.`;

  const link = APP_BASE_URL || '';
  const linkButton = link
    ? `<div style="margin:24px 0;">
         <a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">Ouvrir ${APP_NAME}</a>
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;background:#f3f4f6;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:linear-gradient(135deg,${headerColor} 0%,${headerColor2} 100%);color:#fff;padding:20px 24px;">
      <h2 style="margin:0;font-size:18px;">${title}</h2>
      <div style="opacity:.9;font-size:13px;margin-top:4px;">${APP_NAME}</div>
    </div>
    <div style="padding:24px;">
      <p style="margin-top:0;">${intro}</p>
      ${linkButton}
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Tâche</td><td style="padding:6px 0;font-weight:600;">${jobName || 'Sans nom'}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Type</td><td style="padding:6px 0;">${typeLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Projet</td><td style="padding:6px 0;">${projectName}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Date</td><td style="padding:6px 0;">${dateStr}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">ID tâche</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${jobId || 'N/A'}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">ID run</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${runId || 'N/A'}</td></tr>
      </table>
      <div style="margin-top:16px;background:${isStuck ? '#fef3c7' : '#fee2e2'};border-left:4px solid ${headerColor};padding:12px;border-radius:4px;">
        <div style="font-weight:600;color:${headerColor2};">${isStuck ? 'Raison' : "Message d'erreur"}</div>
        <div style="color:#374151;margin-top:4px;">${errorMessage || (isStuck ? 'Délai d\'exécution dépassé.' : 'Erreur inconnue.')}</div>
      </div>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
        Message automatique de ${APP_NAME}. Tu reçois cet email car tu es le propriétaire de cette tâche.
      </div>
    </div>
  </div>
</body></html>`;

  const text = [
    title,
    APP_NAME,
    '',
    intro.replace(/<[^>]+>/g, ''),
    link ? `\nOuvrir l'application : ${link}` : '',
    '',
    `Tâche   : ${jobName || 'Sans nom'}`,
    `Type    : ${typeLabel}`,
    `Projet  : ${projectName}`,
    `Date    : ${dateStr}`,
    `ID tâche: ${jobId || 'N/A'}`,
    `ID run  : ${runId || 'N/A'}`,
    '',
    `${isStuck ? 'Raison' : "Message d'erreur"}: ${errorMessage || (isStuck ? "Délai d'exécution dépassé." : 'Erreur inconnue.')}`,
  ].join('\n');

  return { html, text };
}

/**
 * Envoie une alerte (échec ou tâche bloquée) au(x) destinataire(s).
 * @param {Object} opts
 * @param {'failed'|'stuck'} opts.reason
 * @param {string} opts.jobName
 * @param {string} opts.jobType - 'publish' | 'pdf-export' | 'file-copy'
 * @param {string} opts.jobId
 * @param {string} opts.runId
 * @param {string} opts.errorMessage
 * @param {Date|string} [opts.occurredAt]
 * @param {Array<string>} opts.recipients
 * @param {Object} [opts.jobDetails]
 * @returns {Promise<boolean>}
 */
async function sendTaskAlert(opts) {
  const { reason = 'failed', recipients = [] } = opts || {};
  const c = getClient();
  if (!c) return false;

  const toList = (recipients || []).filter((e) => e && typeof e === 'string');
  if (toList.length === 0) {
    logger.warn('[Email] Aucun destinataire valide, alerte non envoyée.');
    return false;
  }

  const subject = buildSubject(opts);
  const { html, text } = buildBody(opts);

  const message = {
    senderAddress: SENDER_ADDRESS,
    content: { subject, plainText: text, html },
    recipients: { to: toList.map((address) => ({ address })) },
  };

  try {
    const poller = await c.beginSend(message);
    const result = await poller.pollUntilDone();
    if (result.status === 'Succeeded') {
      logger.info(`[Email] Alerte '${reason}' envoyée à ${toList.length} destinataire(s) (job ${opts.jobId}).`);
      return true;
    }
    logger.error(`[Email] Envoi non abouti (status=${result.status}) pour job ${opts.jobId}.`);
    return false;
  } catch (e) {
    logger.error(`[Email] Erreur d'envoi ACS: ${e.message}`);
    return false;
  }
}

// Compat : ancien point d'entrée (échec). Redirige vers sendTaskAlert.
async function sendFailureNotification(opts) {
  return sendTaskAlert({ ...opts, reason: 'failed' });
}

module.exports = {
  isEnabled,
  sendTaskAlert,
  sendFailureNotification,
};
