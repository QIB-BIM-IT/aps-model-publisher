// src/services/email.service.js
// Service pour envoyer des emails de notification d'erreur

const nodemailer = require('nodemailer');
const logger = require('../config/logger');

// Configuration depuis les variables d'environnement
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || 'noreply@aps-model-publisher.com';
// Service désactivé par défaut - l'infrastructure reste en place pour activation future
const EMAIL_ENABLED = false;

let transporter = null;

/**
 * Initialise le transporteur email
 */
function initTransporter() {
  if (!EMAIL_ENABLED) {
    logger.info('[Email] Service email désactivé - Infrastructure en place pour activation future si nécessaire');
    return null;
  }

  if (!SMTP_USER || !SMTP_PASS) {
    logger.info('[Email] SMTP non configuré - les notifications email seront désactivées. Pour activer, configurez SMTP_USER et SMTP_PASS dans .env');
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    logger.info(`[Email] Transporteur initialisé (${SMTP_HOST}:${SMTP_PORT})`);
    return transporter;
  } catch (error) {
    logger.error(`[Email] Erreur initialisation transporteur: ${error.message}`);
    return null;
  }
}

/**
 * Envoie un email de notification d'erreur pour une tâche qui a échoué
 * @param {Object} options - Options de l'email
 * @param {string} options.jobName - Nom de la tâche
 * @param {string} options.jobType - Type de tâche ('publish' ou 'pdf-export')
 * @param {string} options.jobId - ID de la tâche
 * @param {string} options.runId - ID du run
 * @param {string} options.errorMessage - Message d'erreur
 * @param {Object} options.runDetails - Détails du run (stats, results, etc.)
 * @param {Array<string>} options.recipients - Liste des destinataires (emails)
 * @param {Object} options.jobDetails - Détails supplémentaires du job (projectName, fileName, etc.)
 */
async function sendFailureNotification({
  jobName,
  jobType,
  jobId,
  runId,
  errorMessage,
  runDetails = {},
  recipients = [],
  jobDetails = {},
}) {
  if (!EMAIL_ENABLED || !transporter) {
    // Ne pas logger en mode debug pour éviter le spam - c'est normal si le service n'est pas configuré
    return false;
  }

  if (!recipients || recipients.length === 0) {
    logger.warn('[Email] Aucun destinataire spécifié, notification non envoyée');
    return false;
  }

  try {
    const jobTypeLabel = jobType === 'pdf-export' ? 'Export PDF' : 'Publication';
    const projectName = jobDetails.projectName || 'N/A';
    const fileName = jobDetails.fileName || jobDetails.fileUrn || 'N/A';
    const hubName = jobDetails.hubName || 'N/A';

    // Formatage des stats
    const stats = runDetails.stats || {};
    const duration = stats.durationMs
      ? `${Math.round(stats.durationMs / 1000)}s`
      : 'N/A';
    const successCount = stats.okCount || stats.uploaded || 0;
    const failCount = stats.failCount || stats.failed || 0;
    const totalFiles = stats.totalFiles || (runDetails.items?.length || 0);

    // Construction du message HTML structuré
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; }
    .section { margin-bottom: 20px; }
    .section-title { font-weight: 600; color: #1f2937; margin-bottom: 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .info-label { font-weight: 600; color: #6b7280; }
    .info-value { color: #1f2937; }
    .error-box { background: #fee2e2; border-left: 4px solid #dc2626; padding: 12px; margin: 16px 0; border-radius: 4px; }
    .error-message { color: #991b1b; font-weight: 600; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .stat-box { background: white; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb; }
    .stat-value { font-size: 24px; font-weight: 700; color: #1f2937; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">❌ Échec de la tâche ${jobTypeLabel}</h2>
    </div>
    <div class="content">
      <div class="section">
        <div class="section-title">Informations de la tâche</div>
        <div class="info-row">
          <span class="info-label">Nom:</span>
          <span class="info-value">${jobName || 'Sans nom'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Type:</span>
          <span class="info-value">${jobTypeLabel}</span>
        </div>
        <div class="info-row">
          <span class="info-label">ID Tâche:</span>
          <span class="info-value">${jobId || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">ID Run:</span>
          <span class="info-value">${runId || 'N/A'}</span>
        </div>
        ${jobType === 'pdf-export' 
          ? `<div class="info-row">
              <span class="info-label">Fichier:</span>
              <span class="info-value">${fileName}</span>
            </div>`
          : `<div class="info-row">
              <span class="info-label">Hub:</span>
              <span class="info-value">${hubName}</span>
            </div>`
        }
        <div class="info-row">
          <span class="info-label">Projet:</span>
          <span class="info-value">${projectName}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Résultats</div>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-value" style="color: #dc2626;">${failCount}</div>
            <div class="stat-label">Échecs</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" style="color: #059669;">${successCount}</div>
            <div class="stat-label">Succès</div>
          </div>
        </div>
        ${totalFiles > 0 ? `
        <div class="info-row" style="margin-top: 12px;">
          <span class="info-label">Total fichiers:</span>
          <span class="info-value">${totalFiles}</span>
        </div>
        ` : ''}
        <div class="info-row">
          <span class="info-label">Durée:</span>
          <span class="info-value">${duration}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Message d'erreur</div>
        <div class="error-box">
          <div class="error-message">${errorMessage || 'Erreur inconnue'}</div>
        </div>
      </div>

      ${runDetails.results && Array.isArray(runDetails.results) && runDetails.results.length > 0 ? `
      <div class="section">
        <div class="section-title">Détails des résultats</div>
        <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb; max-height: 200px; overflow-y: auto;">
          <pre style="margin: 0; font-size: 11px; color: #374151;">${JSON.stringify(runDetails.results, null, 2)}</pre>
        </div>
      </div>
      ` : ''}

      <div class="footer">
        <p>Ce message a été généré automatiquement par APS Model Publisher</p>
        <p>Date: ${new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}</p>
      </div>
    </div>
  </div>
</body>
</html>
    `.trim();

    // Version texte simple pour les clients qui ne supportent pas HTML
    const textContent = `
Échec de la tâche ${jobTypeLabel}

Informations de la tâche:
- Nom: ${jobName || 'Sans nom'}
- Type: ${jobTypeLabel}
- ID Tâche: ${jobId || 'N/A'}
- ID Run: ${runId || 'N/A'}
${jobType === 'pdf-export' ? `- Fichier: ${fileName}` : `- Hub: ${hubName}`}
- Projet: ${projectName}

Résultats:
- Échecs: ${failCount}
- Succès: ${successCount}
${totalFiles > 0 ? `- Total fichiers: ${totalFiles}` : ''}
- Durée: ${duration}

Message d'erreur:
${errorMessage || 'Erreur inconnue'}

${runDetails.results && Array.isArray(runDetails.results) && runDetails.results.length > 0 
  ? `\nDétails des résultats:\n${JSON.stringify(runDetails.results, null, 2)}` 
  : ''}

---
Ce message a été généré automatiquement par APS Model Publisher
Date: ${new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}
    `.trim();

    const mailOptions = {
      from: EMAIL_FROM,
      to: recipients.join(', '),
      subject: `❌ Échec: ${jobName || 'Tâche'} (${jobTypeLabel})`,
      text: textContent,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`[Email] Notification d'échec envoyée à ${recipients.length} destinataire(s) pour job ${jobId}`);
    return true;
  } catch (error) {
    logger.error(`[Email] Erreur envoi notification: ${error.message}`);
    return false;
  }
}

// Initialiser le transporteur au chargement du module
initTransporter();

module.exports = {
  sendFailureNotification,
  initTransporter,
  isEnabled: () => EMAIL_ENABLED && transporter !== null,
};

