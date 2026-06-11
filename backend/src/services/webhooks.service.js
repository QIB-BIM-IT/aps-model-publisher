// src/services/webhooks.service.js
// Service pour gérer les webhooks Autodesk APS
// Les webhooks permettent de recevoir des notifications en temps réel
// quand des événements se produisent (publication, export, etc.)

const crypto = require('crypto');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { apsConfig } = require('../config/aps.config');
const { PublishRun, PDFExportRun, CopyRun } = require('../models');

// Note: Op est importé de Sequelize pour les requêtes avec opérateurs (gte, lte, etc.)

class WebhooksService {
  constructor() {
    this.secret = apsConfig.webhooks.secret;
    // Toujours actif par défaut (mettre WEBHOOKS_ENABLED=false pour désactiver, ex. en local)
    this.enabled = String(process.env.WEBHOOKS_ENABLED || 'true').toLowerCase() === 'true';
  }

  /**
   * Vérifie la signature d'un webhook Autodesk
   * @param {string} payload - Corps de la requête (string)
   * @param {string} signature - Signature reçue dans les headers
   * @returns {boolean} - true si signature valide
   */
  verifySignature(payload, signature) {
    if (!this.secret) {
      logger.warn('[Webhooks] ⚠️ WEBHOOK_SECRET non configuré, signature non vérifiée');
      return false;
    }

    if (!signature) {
      logger.warn('[Webhooks] ⚠️ Aucune signature fournie');
      return false;
    }

    try {
      // Autodesk APS envoie la signature dans x-adsk-signature avec un préfixe
      // qui indique l'algorithme:
      //   - "sha1hash=<hex>"  -> HMAC-SHA1  (cas des webhooks Data Management / Forge)
      //   - "sha256=<hex>"    -> HMAC-SHA256 (certains autres produits Autodesk)
      // On détecte le préfixe pour choisir le bon algorithme. Sans préfixe connu,
      // on accepte si SHA1 OU SHA256 correspond (robustesse face à l'ambiguïté).
      const raw = String(signature).trim();
      const match = raw.match(/^(sha1hash|sha256|sha1)=(.+)$/i);

      let algos;
      let providedSignature;
      if (match) {
        const prefix = match[1].toLowerCase();
        providedSignature = match[2];
        algos = prefix === 'sha256' ? ['sha256'] : ['sha1'];
      } else {
        // Pas de préfixe reconnu: essayer les deux algos
        providedSignature = raw;
        algos = ['sha1', 'sha256'];
      }

      return algos.some((algo) => this._matchesHmac(algo, payload, providedSignature));
    } catch (error) {
      logger.error(`[Webhooks] Erreur vérification signature: ${error.message}`);
      return false;
    }
  }

  /**
   * Compare (timing-safe) la signature fournie avec le HMAC calculé pour un algo donné
   * @param {string} algo - 'sha1' ou 'sha256'
   * @param {string} payload - Corps brut de la requête
   * @param {string} providedHex - Signature hex fournie (sans préfixe)
   * @returns {boolean}
   */
  _matchesHmac(algo, payload, providedHex) {
    try {
      const expected = crypto.createHmac(algo, this.secret).update(payload).digest('hex');
      const expectedBuf = Buffer.from(expected, 'hex');
      const providedBuf = Buffer.from(providedHex, 'hex');
      // timingSafeEqual exige des buffers de même longueur
      if (expectedBuf.length !== providedBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(expectedBuf, providedBuf);
    } catch (_e) {
      return false;
    }
  }

  /**
   * Traite un événement webhook dm.version.added (nouvelle version créée)
   * Format Autodesk Data Management:
   * {
   *   hook: { event: "dm.version.added", ... },
   *   payload: { project: "b.xxx", lineageUrn: "urn:...", versionUrn: "urn:...", name: "file.rvt" }
   * }
   * @param {object} event - Événement reçu
   * @returns {Promise<void>}
   */
  async handlePublishEvent(event) {
    try {
      const { payload, hook } = event;
      const eventTime = new Date().toISOString();
      
      // Extraire les infos du webhook Autodesk Data Management
      // ⚠️ Le payload APS envoie souvent le projet SANS le préfixe "b." alors
      // que nos PublishRun.projectId le stockent AVEC. On accepte les 2 formes.
      const rawProject = payload?.project || payload?.projectId;
      const projectId = rawProject;
      const projectIdCandidates = [];
      if (rawProject) {
        projectIdCandidates.push(rawProject);
        if (rawProject.startsWith('b.')) projectIdCandidates.push(rawProject.slice(2));
        else projectIdCandidates.push(`b.${rawProject}`);
      }
      const lineageUrn = payload?.lineageUrn;
      const versionUrn = payload?.versionUrn || payload?.resourceUrn;
      const fileName = payload?.name;
      const eventType = hook?.event || payload?.eventType || 'dm.version.added';
      
      logger.info(`[Webhooks] 📨 dm.version.added reçu: project=${projectId}, file=${fileName}`);
      logger.debug(`[Webhooks] lineageUrn=${lineageUrn}, versionUrn=${versionUrn}`);
      
      if (!projectId) {
        logger.warn('[Webhooks] Événement sans projectId, ignoré');
        return;
      }

      // Chercher les runs récents pour ce projet qui sont en cours ou récemment terminés
      // (dernière heure - pour capturer le temps réel même si le run est déjà marqué completed)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      const recentRuns = await PublishRun.findAll({
        where: {
          projectId: { [Op.in]: projectIdCandidates },
          startedAt: {
            [Op.gte]: oneHourAgo,
          },
        },
        order: [['startedAt', 'DESC']],
        limit: 10,
      });

      if (recentRuns.length === 0) {
        logger.debug(`[Webhooks] Aucun run récent pour projet ${projectId}, webhook ignoré`);
        return;
      }

      // Chercher le run qui contient ce modèle (par lineageUrn)
      let matchedRun = null;
      for (const run of recentRuns) {
        const items = run.items || [];
        // Vérifier si un des items correspond au lineageUrn
        const hasItem = items.some(item => {
          const itemUrn = typeof item === 'string' ? item : item.urn;
          // Comparer les URNs (peuvent être légèrement différents)
          return itemUrn && lineageUrn && (
            itemUrn.includes(lineageUrn) || 
            lineageUrn.includes(itemUrn) ||
            itemUrn === lineageUrn
          );
        });
        
        if (hasItem) {
          matchedRun = run;
          break;
        }
      }

      // Si pas de match exact, utiliser le run le plus récent en cours
      if (!matchedRun) {
        matchedRun = recentRuns.find(r => r.status === 'running') || recentRuns[0];
        logger.debug(`[Webhooks] Pas de match exact, utilisation du run ${matchedRun.id}`);
      }

      // Mettre à jour le run avec le temps réel
      const stats = matchedRun.stats || {};
      const webhookEvents = stats.webhookEvents || [];
      
      // Ajouter cet événement à la liste
      webhookEvents.push({
        type: eventType,
        time: eventTime,
        fileName,
        lineageUrn,
        versionUrn,
      });

      matchedRun.stats = {
        ...stats,
        webhookEndTime: eventTime,
        webhookEventType: eventType,
        webhookReceived: true,
        webhookEvents,
        lastWebhookFile: fileName,
      };
      
      // Calculer le temps réel total
      if (matchedRun.startedAt) {
        const realDurationMs = new Date(eventTime) - new Date(matchedRun.startedAt);
        matchedRun.stats.realDurationMs = realDurationMs;
        logger.info(`[Webhooks] ✅ Run ${matchedRun.id} mis à jour: ${fileName} publié en ${Math.round(realDurationMs/1000)}s`);
      }
      
      await matchedRun.save();
    } catch (error) {
      logger.error(`[Webhooks] Erreur traitement événement publish: ${error.message}`);
      throw error;
    }
  }

  /**
   * Traite un événement webhook d'export PDF
   * @param {object} event - Événement reçu
   * @returns {Promise<void>}
   */
  async handlePDFExportEvent(event) {
    try {
      const { payload } = event;
      
      const runId = payload?.runId || payload?.jobId || payload?.id;
      const projectId = payload?.projectId;
      const exportJobId = payload?.exportJobId || payload?.jobId;
      
      if (!runId && !exportJobId) {
        logger.warn('[Webhooks] Événement PDF export sans runId ou exportJobId');
        return;
      }

      // Chercher le run correspondant
      let run = null;
      if (runId) {
        run = await PDFExportRun.findByPk(runId);
      } else if (exportJobId) {
        // Chercher par exportJobId (stocké dans stats.exportJobId)
        const runs = await PDFExportRun.findAll({
          where: {
            status: 'running',
          },
          order: [['startedAt', 'DESC']],
        });
        
        run = runs.find(r => {
          const stats = r.stats || {};
          return stats.exportJobId === exportJobId || stats.jobId === exportJobId;
        });
        
        // Si pas trouvé, chercher dans les runs récents (dernières 24h)
        if (!run) {
          const recentRuns = await PDFExportRun.findAll({
            where: {
              status: {
                [Op.in]: ['success', 'partial', 'failed'],
              },
              startedAt: {
                [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000),
              },
            },
            order: [['startedAt', 'DESC']],
            limit: 50,
          });
          
          run = recentRuns.find(r => {
            const stats = r.stats || {};
            return stats.exportJobId === exportJobId || stats.jobId === exportJobId;
          });
        }
      }

      if (!run) {
        logger.warn(`[Webhooks] Run introuvable pour événement PDF: runId=${runId}, exportJobId=${exportJobId}`);
        return;
      }

      const eventType = payload?.eventType || payload?.type || 'unknown';
      const eventTime = payload?.timestamp || payload?.time || new Date().toISOString();
      
      logger.info(`[Webhooks] 📨 Événement PDF export reçu: type=${eventType}, runId=${run.id}`);

      // Mettre à jour avec le temps réel
      if (eventType === 'export.completed' || eventType === 'pdf.uploaded' || eventType === 'export.finished') {
        run.stats = {
          ...(run.stats || {}),
          webhookEndTime: eventTime,
          webhookEventType: eventType,
          webhookReceived: true,
        };
        
        // Calculer le temps réel total (depuis le début jusqu'à l'export réel)
        let realDurationMs = null;
        if (run.startedAt) {
          realDurationMs = new Date(eventTime) - new Date(run.startedAt);
          run.stats.realDurationMs = realDurationMs;
        }
        
        await run.save();
        if (realDurationMs !== null) {
          logger.info(`[Webhooks] ✅ Run ${run.id} mis à jour avec temps réel: ${realDurationMs}ms`);
        } else {
          logger.info(`[Webhooks] ✅ Run ${run.id} mis à jour (startedAt manquant, temps réel non calculé)`);
        }
      }
    } catch (error) {
      logger.error(`[Webhooks] Erreur traitement événement PDF: ${error.message}`);
      throw error;
    }
  }

  // ----------- Gestionnaire unifié dm.version.added (Publish / PDF / Copie) -----------

  /**
   * Construit la liste des identifiants de projet possibles (avec/sans préfixe "b.").
   */
  _projectIdCandidates(raw) {
    const out = [];
    if (!raw) return out;
    out.push(raw);
    if (raw.startsWith('b.')) out.push(raw.slice(2));
    else out.push(`b.${raw}`);
    return out;
  }

  /**
   * Extrait les noms de fichiers connus d'un run (items + results) pour le matching.
   */
  _runFileNames(run) {
    const names = new Set();
    const scan = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const it of arr) {
        if (!it) continue;
        if (typeof it === 'string') { names.add(it); continue; }
        for (const k of ['name', 'fileName', 'fileNameWithExt', 'displayName']) {
          if (it[k]) names.add(String(it[k]));
        }
      }
    };
    scan(run.items);
    scan(run.results);
    const stats = run.stats || {};
    if (stats.mergedFileName) names.add(String(stats.mergedFileName));
    return [...names];
  }

  /**
   * Applique le temps de fin réel (issu du webhook) sur un run et le sauvegarde.
   */
  async _applyWebhookEnd(run, kind, { eventTime, eventType, fileName, lineageUrn, versionUrn }) {
    const stats = run.stats || {};
    const webhookEvents = stats.webhookEvents || [];
    webhookEvents.push({ type: eventType, time: eventTime, fileName, lineageUrn, versionUrn });
    run.stats = {
      ...stats,
      webhookEndTime: eventTime,
      webhookEventType: eventType,
      webhookReceived: true,
      webhookEvents,
      lastWebhookFile: fileName,
    };
    if (run.startedAt) {
      run.stats.realDurationMs = new Date(eventTime) - new Date(run.startedAt);
    }
    await run.save();
    const secs = run.stats.realDurationMs != null ? Math.round(run.stats.realDurationMs / 1000) : '?';
    logger.info(`[Webhooks] ✅ ${kind} run ${run.id} mis à jour: "${fileName}" publié (temps réel ${secs}s)`);
  }

  /**
   * Gestionnaire unifié pour dm.version.added: route l'événement vers le run
   * Publish / PDF / Copie qui correspond le mieux (par fichier puis par récence).
   */
  async handleDataVersionAdded(event) {
    const { payload, hook } = event;
    const eventTime = new Date().toISOString();
    const rawProject = payload?.project || payload?.projectId;
    const fileName = payload?.name || payload?.fileName;
    const lineageUrn = payload?.lineageUrn;
    const versionUrn = payload?.versionUrn || payload?.resourceUrn;
    const eventType = hook?.event || payload?.eventType || 'dm.version.added';

    logger.info(`[Webhooks] 📨 dm.version.added: project=${rawProject}, file=${fileName}`);

    if (!rawProject) {
      logger.warn('[Webhooks] Événement sans projectId, ignoré');
      return;
    }

    const candidates = this._projectIdCandidates(rawProject);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recencyQuery = (where) => ({
      where: { ...where, startedAt: { [Op.gte]: since } },
      order: [['startedAt', 'DESC']],
      limit: 10,
    });

    // Récupérer les runs récents des 3 types pour ce projet.
    const [publishRuns, pdfRuns, copyRuns] = await Promise.all([
      PublishRun.findAll(recencyQuery({ projectId: { [Op.in]: candidates } })),
      PDFExportRun.findAll(recencyQuery({ projectId: { [Op.in]: candidates } })),
      // Pour la copie, le fichier apparaît dans le projet de DESTINATION.
      CopyRun.findAll(recencyQuery({ destinationProjectId: { [Op.in]: candidates } })),
    ]);

    const tagged = [
      ...publishRuns.map((r) => ({ run: r, kind: 'Publish' })),
      ...pdfRuns.map((r) => ({ run: r, kind: 'PDF' })),
      ...copyRuns.map((r) => ({ run: r, kind: 'Copy' })),
    ];

    if (tagged.length === 0) {
      logger.debug(`[Webhooks] Aucun run récent (publish/pdf/copy) pour ${rawProject}, ignoré`);
      return;
    }

    // Scoring: correspondance de fichier > run en cours > récence.
    const score = ({ run }) => {
      let s = 0;
      if (fileName) {
        const names = this._runFileNames(run);
        if (names.some((n) => n === fileName || n.includes(fileName) || fileName.includes(n))) s += 100;
      }
      if (lineageUrn) {
        const names = this._runFileNames(run);
        if (names.some((n) => lineageUrn.includes(n))) s += 50;
      }
      if (run.status === 'running') s += 10;
      // récence (plus récent = meilleur)
      s += (new Date(run.startedAt || 0).getTime()) / 1e13;
      return s;
    };

    tagged.sort((a, b) => score(b) - score(a));
    const best = tagged[0];
    await this._applyWebhookEnd(best.run, best.kind, { eventTime, eventType, fileName, lineageUrn, versionUrn });
  }

  /**
   * Traite un événement webhook générique
   * @param {object} event - Événement reçu
   * @returns {Promise<void>}
   */
  async handleEvent(event) {
    const { payload, hook } = event;
    
    // Format Autodesk Data Management: hook.event = "dm.version.added"
    const hookEvent = hook?.event || '';
    const eventType = payload?.eventType || payload?.type || payload?.event || hookEvent || 'unknown';
    const resourceType = payload?.resourceType || payload?.resource || hook?.system || 'unknown';

    logger.info(`[Webhooks] 📨 Événement reçu: hookEvent=${hookEvent}, type=${eventType}, resource=${resourceType}`);

    // dm.version.added (création d'une nouvelle version) couvre Publish, PDF et Copie:
    // dans les 3 cas, un document est publié/créé/copié dans un dossier ACC.
    if (hookEvent.startsWith('dm.') || resourceType === 'data' ||
        eventType.includes('version') || eventType.includes('item')) {
      await this.handleDataVersionAdded(event);
    } else if (resourceType.includes('pdf') || resourceType.includes('export') ||
               eventType.includes('pdf') || eventType.includes('export')) {
      // Chemin hérité (events explicites export.*) — conservé pour /test.
      await this.handlePDFExportEvent(event);
    } else {
      logger.warn(`[Webhooks] Type d'événement non géré: ${eventType} (hook=${hookEvent}, resource=${resourceType})`);
    }
  }

  /**
   * Vérifie si les webhooks sont activés
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }
}

module.exports = new WebhooksService();

