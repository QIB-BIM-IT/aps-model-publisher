// src/services/pdfExportScheduler.service.js
// Service pour exécuter les jobs d'export PDF schedulés

const axios = require('axios');
const logger = require('../config/logger');
const apsAuthService = require('./apsAuth.service');
const { PDFExportRun } = require('../models');

class PDFExportSchedulerService {
  /**
   * Crée un run initial pour l'exécution
   */
  async startRun(job) {
    const run = await PDFExportRun.create({
      jobId: job.id,
      userId: job.userId,
      projectId: job.projectId,
      folderId: job.folderId,
      fileUrn: job.fileUrn,
      status: 'running',
      startedAt: new Date(),
      results: [],
      stats: {},
    });

    logger.info(`[PDFExportScheduler] Run créé: ${run.id} pour job ${job.id}`);
    return run;
  }

  /**
   * Exécute l'export PDF via l'endpoint /export-and-save
   */
  async executeRun(run) {
    const started = Date.now();

    try {
      // Récupérer le token utilisateur
      const accessToken = await apsAuthService.ensureValidToken(run.userId);

      logger.info(
        `[PDFExportScheduler] Exécution run=${run.id} pour job=${run.jobId} fileUrn=${run.fileUrn}`
      );

      // Récupérer le job pour les paramètres d'export
      const { PDFExportJob } = require('../models');
      const job = await PDFExportJob.findByPk(run.jobId);
      if (!job) {
        throw new Error(`Job ${run.jobId} introuvable`);
      }

      // Préparer le payload pour /export-and-save
      const payload = {
        fileUrn: job.fileUrn,
        projectId: job.projectId,
        folderId: job.folderId,
        filters: {
          includeSheets: job.includeSheets !== false,
          includeViews2D: job.includeViews2D !== false,
          includeMarkups: job.includeMarkups !== false,
        },
        selectionMode: job.selectionMode || 'all',
        customSheets: job.selectionMode === 'custom' ? (job.selectedSheets || []) : [],
        exportMode: job.exportMode || 'individual',
      };

      if (job.exportMode === 'combined' && job.mergedFileName) {
        payload.combinedFileName = job.mergedFileName;
      }

      logger.debug(`[PDFExportScheduler] Payload: ${JSON.stringify(payload, null, 2)}`);

      // Appeler /export-and-save (requête interne depuis le scheduler)
      const apiUrl = process.env.API_URL || 'http://localhost:3000';
      const url = `${apiUrl}/api/pdf-export/export-and-save`;
      
      logger.debug(`[PDFExportScheduler] Appel interne vers ${url} avec userId=${run.userId}`);
      
      const response = await axios.post(
        url,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-user-token': accessToken,
            'x-internal-request': 'true',
            'x-user-id': String(run.userId),
          },
          // S'assurer que les headers sont bien envoyés
          validateStatus: () => true, // Ne pas throw sur les erreurs HTTP
        }
      );
      
      if (response.status === 401) {
        logger.error(`[PDFExportScheduler] Erreur 401 - Headers envoyés: x-internal-request=true, x-user-id=${run.userId}, x-user-token=${accessToken ? 'présent' : 'absent'}`);
        throw new Error(`Authentification échouée (401): ${response.data?.message || response.statusText}`);
      }

      const data = response.data;

      if (!data.success) {
        throw new Error(data.message || 'Export échoué');
      }

      logger.info(
        `[PDFExportScheduler] ✅ Export réussi: uploaded=${data.uploaded} PDFs, ${data.sheetCount || data.uploaded} sheets, failed=${data.failed}`
      );

      const durationMs = Date.now() - started;

      return {
        results: data.results || [],
        uploaded: data.uploaded || 0,
        failed: data.failed || 0,
        sheetCount: data.sheetCount || data.uploaded || 0, // Nombre réel de sheets
        errors: data.errors || [],
        durationMs,
      };
    } catch (e) {
      logger.error(`[PDFExportScheduler] Erreur exécution: ${e.message}`);
      throw e;
    }
  }

  /**
   * Finalise le run après exécution
   */
  async finishRun(run, summary) {
    const results = summary.results || [];
    const uploaded = summary.uploaded || 0;
    const failed = summary.failed || 0;
    const sheetCount = summary.sheetCount || uploaded; // Fallback sur uploaded si sheetCount absent
    const errors = summary.errors || [];

    let finalStatus = 'success';
    if (failed > 0 && uploaded === 0) {
      finalStatus = 'failed';
    } else if (failed > 0 && uploaded > 0) {
      finalStatus = 'partial';
    } else {
      finalStatus = 'success';
    }

    run.status = finalStatus;
    run.endedAt = new Date();
    run.results = results;
    run.stats = {
      ...(run.stats || {}),
      durationMs: summary.durationMs,
      uploaded, // Nombre de PDFs uploadés
      failed,
      sheetCount, // Nombre de sheets exportées (peut être > uploaded en mode combined)
      total: uploaded + failed,
    };

    if (summary.message) {
      run.message = summary.message;
    }

    await run.save();

    logger.info(
      `[PDFExportScheduler] Run sauvegardé: ${run.id} status=${run.status} uploaded=${uploaded} PDFs, ${sheetCount} sheets`
    );
    return run;
  }
}

module.exports = new PDFExportSchedulerService();
