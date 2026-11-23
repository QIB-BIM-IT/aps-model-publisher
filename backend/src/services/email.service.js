// src/services/email.service.js
// Courriel de fin d'exécution via Azure Communication Services (ACS) Email.
// Envoyé pour chaque run Publish / PDF / Copie : réussite, échec partiel, échec, ou tâche bloquée.
// Piloté par variables d'environnement :
//   EMAIL_ENABLED          : 'true' pour activer l'envoi
//   ACS_CONNECTION_STRING  : connection string de la ressource Communication Services
//   EMAIL_FROM             : adresse expéditrice (ex: DoNotReply@<sous-domaine>.azurecomm.net)
//   APP_BASE_URL           : URL publique de l'app pour le lien (fallback: CORS_ORIGIN)

const { EmailClient } = require('@azure/communication-email');
const logger = require('../config/logger');

const APP_NAME = 'APS Model Publisher';
const LIST_LIMIT = 40;

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
let disabledWarned = false;

function getClient() {
  if (!EMAIL_ENABLED) return null;
  if (!ACS_CONNECTION_STRING || !SENDER_ADDRESS) {
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

function warnDisabledOnce() {
  if (disabledWarned) return;
  disabledWarned = true;
  logger.warn('[Email] Service désactivé (EMAIL_ENABLED, ACS_CONNECTION_STRING ou EMAIL_FROM) — aucun courriel ne sera envoyé.');
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

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return null;
  const totalSec = Math.round(n / 1000);
  if (totalSec < 60) return `${totalSec} s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec ? `${min} min ${sec} s` : `${min} min`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${h} h ${remMin} min` : `${h} h`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortId(value) {
  if (typeof value !== 'string' || !value) return '';
  const parts = value.split('/');
  return parts[parts.length - 1] || value;
}

const OK_STATUS = new Set(['accepted', 'queued', 'success', 'uploaded', 'ok']);

function isSuccessItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.success === true) return true;
  if (item.success === false) return false;
  return OK_STATUS.has(String(item.status || '').toLowerCase());
}

function itemLabel(item) {
  return item.name || item.filename || item.fileName || shortId(item.item) || shortId(item.urn) || 'Sans nom';
}

function itemReason(item) {
  const raw = item.message || item.error || (item.http ? `HTTP ${item.http}` : '');
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function collectItems(results) {
  const succeeded = [];
  const failed = [];
  for (const item of Array.isArray(results) ? results : []) {
    if (!item || typeof item !== 'object') continue;
    const entry = { name: String(itemLabel(item)), reason: itemReason(item) };
    if (isSuccessItem(item)) succeeded.push(entry);
    else failed.push(entry);
  }
  return { succeeded, failed };
}

function countOf(explicit, fallback) {
  const n = Number(explicit);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Réussite, échec partiel, échec ou tâche bloquée.
 * Un reason explicite 'stuck' ou 'failed'/'skipped' est respecté,
 * sauf si les compteurs montrent à la fois des réussites et des échecs (partiel).
 */
function classifyRunOutcome(run, reason) {
  if (reason === 'stuck') return 'stuck';

  const { succeeded, failed } = collectItems(run?.results);
  const stats = run?.stats || {};
  const okCount = countOf(stats.okCount != null ? stats.okCount : stats.uploaded, succeeded.length);
  const failCount = countOf(stats.failCount != null ? stats.failCount : stats.failed, failed.length);

  if (okCount > 0 && failCount > 0) return 'partial';
  if (reason === 'failed' || reason === 'skipped') return 'failed';
  if (run?.status === 'partial') return 'partial';
  if (run?.status === 'failed' || run?.status === 'error' || failCount > 0) return 'failed';
  if (okCount === 0 && failCount === 0 && run?.status !== 'success') return 'failed';
  return 'success';
}

function outcomeCopy(reason) {
  if (reason === 'success') {
    return {
      label: 'Réussite',
      title: 'Exécution réussie',
      intro: 'Tous les éléments de cette exécution ont abouti.',
      header: '#059669',
      header2: '#047857',
      tint: '#ecfdf5',
      ink: '#065f46',
    };
  }
  if (reason === 'partial') {
    return {
      label: 'Échec partiel',
      title: 'Exécution partielle',
      intro: 'Une partie des éléments a réussi, une autre a échoué. Le détail est plus bas.',
      header: '#d97706',
      header2: '#b45309',
      tint: '#fffbeb',
      ink: '#92400e',
    };
  }
  if (reason === 'stuck') {
    return {
      label: 'Tâche bloquée',
      title: 'Tâche bloquée',
      intro: 'Cette exécution a duré trop longtemps et a été interrompue automatiquement.',
      header: '#d97706',
      header2: '#b45309',
      tint: '#fffbeb',
      ink: '#92400e',
    };
  }
  return {
    label: 'Échec',
    title: 'Exécution en échec',
    intro: 'Cette exécution ne s\'est pas terminée correctement.',
    header: '#dc2626',
    header2: '#991b1b',
    tint: '#fef2f2',
    ink: '#991b1b',
  };
}

function renderItemList(title, items, accent) {
  const shown = items.slice(0, LIST_LIMIT);
  const extra = items.length - shown.length;
  const rows = shown.length
    ? shown.map((item) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;">${esc(item.name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${esc(item.reason || '—')}</td>
        </tr>`).join('')
    : `<tr><td colspan="2" style="padding:10px 12px;font-size:13px;color:#9ca3af;">Aucun</td></tr>`;
  const more = extra > 0
    ? `<div style="padding:8px 12px;font-size:12px;color:#6b7280;">+ ${extra} autre${extra > 1 ? 's' : ''}</div>`
    : '';

  return `
    <div style="margin-top:18px;">
      <div style="font-size:13px;font-weight:700;color:${accent};margin-bottom:8px;">${esc(title)} (${items.length})</div>
      <table style="width:100%;border-collapse:collapse;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;">
        ${rows}
      </table>
      ${more}
    </div>`;
}

function renderItemListText(title, items) {
  if (!items.length) return `${title} (0)\n  — aucun`;
  const shown = items.slice(0, LIST_LIMIT);
  const lines = shown.map((item) => `  - ${item.name}${item.reason ? ` — ${item.reason}` : ''}`);
  if (items.length > shown.length) lines.push(`  + ${items.length - shown.length} autre(s)`);
  return `${title} (${items.length})\n${lines.join('\n')}`;
}

function buildSubject({ reason, jobName, occurredAt }) {
  const { label } = outcomeCopy(reason);
  return `${APP_NAME} — ${jobName || 'Tâche'} — ${label} — ${formatDate(occurredAt)}`;
}

function buildBody(opts) {
  const {
    reason,
    jobName,
    jobType,
    jobId,
    runId,
    errorMessage,
    occurredAt,
    jobDetails = {},
    durationMs,
    succeeded = [],
    failed = [],
    okCount,
    failCount,
  } = opts;

  const copy = outcomeCopy(reason);
  const typeLabel = jobTypeLabel(jobType);
  const dateStr = formatDate(occurredAt);
  const projectName = jobDetails.projectName || 'N/A';
  const duration = formatDuration(durationMs);
  const shownOk = okCount != null ? okCount : succeeded.length;
  const shownFail = failCount != null ? failCount : failed.length;
  const link = APP_BASE_URL || '';
  const note = reason === 'success' ? '' : (errorMessage || '');

  const linkButton = link
    ? `<div style="margin:20px 0 4px;">
         <a href="${esc(link)}" style="background:#111827;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;display:inline-block;font-size:14px;">Ouvrir ${esc(APP_NAME)}</a>
       </div>`
    : '';

  const noteBlock = note
    ? `<div style="margin-top:16px;background:${copy.tint};border-left:4px solid ${copy.header};padding:12px 14px;border-radius:4px;">
         <div style="font-weight:700;color:${copy.ink};font-size:13px;">Résumé</div>
         <div style="color:#374151;margin-top:4px;font-size:14px;">${esc(note)}</div>
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#111827;background:#f3f4f6;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:${copy.header};color:#fff;padding:22px 24px;">
      <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;opacity:.85;">${esc(APP_NAME)}</div>
      <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;">${esc(copy.title)}</h1>
      <div style="margin-top:6px;font-size:14px;opacity:.95;">${esc(jobName || 'Sans nom')}</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;">${esc(copy.intro)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;width:150px;">Résultat</td><td style="padding:6px 0;font-weight:700;color:${copy.header};">${esc(copy.label)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Tâche</td><td style="padding:6px 0;font-weight:600;">${esc(jobName || 'Sans nom')}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Type</td><td style="padding:6px 0;">${esc(typeLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Projet</td><td style="padding:6px 0;">${esc(projectName)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Date</td><td style="padding:6px 0;">${esc(dateStr)}</td></tr>
        ${duration ? `<tr><td style="padding:6px 0;color:#6b7280;">Durée</td><td style="padding:6px 0;">${esc(duration)}</td></tr>` : ''}
        <tr><td style="padding:6px 0;color:#6b7280;">Réussites</td><td style="padding:6px 0;">${esc(shownOk)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Échecs</td><td style="padding:6px 0;">${esc(shownFail)}</td></tr>
      </table>
      ${noteBlock}
      ${renderItemList('Réussis', succeeded, '#059669')}
      ${renderItemList('En échec', failed, '#dc2626')}
      ${linkButton}
      <div style="margin-top:22px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
        Message automatique de ${esc(APP_NAME)}. Tu reçois ce courriel car les notifications sont activées sur ton compte.
        ${jobId ? `<br>Tâche ${esc(jobId)}${runId ? ` · exécution ${esc(runId)}` : ''}` : ''}
      </div>
    </div>
  </div>
</body></html>`;

  const text = [
    copy.title,
    APP_NAME,
    '',
    copy.intro,
    '',
    `Résultat : ${copy.label}`,
    `Tâche    : ${jobName || 'Sans nom'}`,
    `Type     : ${typeLabel}`,
    `Projet   : ${projectName}`,
    `Date     : ${dateStr}`,
    duration ? `Durée    : ${duration}` : '',
    `Réussites: ${shownOk}`,
    `Échecs   : ${shownFail}`,
    note ? `\nRésumé: ${note}` : '',
    '',
    renderItemListText('Réussis', succeeded),
    '',
    renderItemListText('En échec', failed),
    link ? `\nOuvrir l'application : ${link}` : '',
    jobId ? `\nTâche ${jobId}${runId ? ` · exécution ${runId}` : ''}` : '',
  ].filter((line) => line !== '').join('\n');

  return { html, text };
}

function buildTaskEmail(opts) {
  const reason = classifyRunOutcome(
    { status: opts.status, results: opts.results, stats: { okCount: opts.okCount, failCount: opts.failCount, uploaded: opts.okCount, failed: opts.failCount } },
    opts.reason
  );
  const { succeeded, failed } = collectItems(opts.results);
  const subject = buildSubject({ ...opts, reason });
  const body = buildBody({ ...opts, reason, succeeded, failed });
  return { reason, subject, ...body };
}

/**
 * Envoie le courriel de fin (réussite, échec, partiel ou bloquée).
 * @param {Object} opts
 * @param {'success'|'partial'|'failed'|'stuck'|'skipped'} [opts.reason]
 * @param {string} opts.jobName
 * @param {string} opts.jobType
 * @param {string} opts.jobId
 * @param {string} [opts.runId]
 * @param {string} [opts.errorMessage]
 * @param {Date|string} [opts.occurredAt]
 * @param {number} [opts.durationMs]
 * @param {Array} [opts.results]
 * @param {number} [opts.okCount]
 * @param {number} [opts.failCount]
 * @param {string} [opts.status]
 * @param {Array<string>} opts.recipients
 * @param {Object} [opts.jobDetails]
 * @returns {Promise<boolean>}
 */
async function sendTaskAlert(opts) {
  const recipients = (opts && opts.recipients) || [];
  if (!isEnabled()) {
    warnDisabledOnce();
    return false;
  }
  const c = getClient();
  if (!c) {
    warnDisabledOnce();
    return false;
  }

  const toList = recipients.filter((e) => e && typeof e === 'string');
  if (toList.length === 0) {
    logger.warn('[Email] Aucun destinataire valide, courriel non envoyé.');
    return false;
  }

  const { reason, subject, html, text } = buildTaskEmail(opts || {});

  const message = {
    senderAddress: SENDER_ADDRESS,
    content: { subject, plainText: text, html },
    recipients: { to: toList.map((address) => ({ address })) },
  };

  try {
    const poller = await c.beginSend(message);
    const result = await poller.pollUntilDone();
    if (result.status === 'Succeeded') {
      logger.info(`[Email] Courriel '${reason}' envoyé à ${toList.length} destinataire(s) (job ${opts.jobId}).`);
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
  classifyRunOutcome,
  buildTaskEmail,
};
