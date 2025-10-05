// src/services/apsPublish.service.js
// Publish réel via Data v2 *Commands* en ciblant une VERSION, avec détection automatique de région (US|EMEA).
//
// Améliorations:
// - Vérification de l’existence des items avant résolution
// - Détection automatique de la région du projet
// - Support des IDs avec/sans préfixe 'b.'
// - Logs enrichis pour le debug
// - Gestion robuste des erreurs 404
//
// .env utiles :
//  - ENABLE_REAL_PUBLISH=true|false
//  - PUBLISH_COMMAND=PublishModel|PublishWithoutLinks
//  - PUBLISH_ITEM_TIMEOUT_MS, PUBLISH_MAX_RETRIES, PUBLISH_RETRY_BASE_MS

'use strict';

const axios = require('axios');
const logger = require('../config/logger');
const apsAuthService = require('./apsAuth.service');
const { PublishRun } = require('../models');
const { apsConfig } = require('../config/aps.config');

const ENABLE_REAL = String(process.env.ENABLE_REAL_PUBLISH || 'false').toLowerCase() === 'true';
const ITEM_TIMEOUT_MS = parseInt(process.env.PUBLISH_ITEM_TIMEOUT_MS || '120000', 10);
const MAX_RETRIES = Math.max(0, parseInt(process.env.PUBLISH_MAX_RETRIES || '2', 10));
const RETRY_BASE_MS = Math.max(100, parseInt(process.env.PUBLISH_RETRY_BASE_MS || '500', 10));
const PUBLISH_COMMAND = String(process.env.PUBLISH_COMMAND || 'PublishModel'); // PublishModel | PublishWithoutLinks

// Liste des régions supportées par Data Management v2. Les modèles C4R sont
// actuellement provisionnés soit aux US soit sur l'instance EMEA.
const REGIONS = ['us', 'emea']; // ordre d'essai
const REGION_LABELS = REGIONS.map((r) => r.toUpperCase());
const REGION_LIST_LOG = REGION_LABELS.join('/');

function formatRegion(region) {
  return region ? String(region).toUpperCase() : 'N/A';
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function safeBody(b) { try { return JSON.stringify(b).slice(0, 1200); } catch { return '<unserializable>'; } }

function apiBase() {
  return (apsConfig && apsConfig.apis && apsConfig.apis.baseUrl) || 'https://developer.api.autodesk.com';
}

function dataBase() {
  return `${apiBase()}/data/v2`;
}

function commandsBase(region) {
  if (region) {
    return `${apiBase()}/data/v2/regions/${region}`;
  }
  return `${apiBase()}/data/v2`;
}

// — Utilitaires pour gérer les IDs —————————————–

/** Nettoie un ID de projet/hub en retirant le préfixe 'b.' si nécessaire */
function cleanId(id) {
  if (typeof id === 'string' && id.startsWith('b.')) {
    return id.substring(2);
  }
  return id;
}

/**
 * Essaie un appel avec l’ID original, puis sans le préfixe 'b.' si 404
 */
async function tryWithAndWithoutPrefix(axiosConfig, id) {
  let resp = await axios(axiosConfig);

  // Si 404 et que l’ID a un préfixe 'b.', réessayer sans
  if (resp.status === 404 && typeof id === 'string' && id.startsWith('b.')) {
    const cleanedId = cleanId(id);
    // remplace l'ID encodé dans l'URL s'il est présent
    const encodedOriginal = encodeURIComponent(id);
    const encodedCleaned = encodeURIComponent(cleanedId);
    const newUrl = (axiosConfig.url || '').replace(encodedOriginal, encodedCleaned);
    resp = await axios({ ...axiosConfig, url: newUrl });
  }

  return resp;
}

// — Reconnaissance des URN ———————————————––

/** lineage item URN ? ex: urn:adsk.wipprod:dm.lineage:xxxxx */
function isLineageUrn(urn) {
  return /^urn:adsk\.wipprod:dm\.lineage:[A-Za-z0-9-_]+$/i.test(String(urn));
}

/** version URN ? ex: urn:adsk.wipprod:fs.file:vf.<id>?version=<n> */
function isVersionUrn(urn) {
  return /^urn:adsk\.wipprod:fs\.file:vf\.[^?]+(\?|\&)version=\d+$/i.test(String(urn));
}

// — Détection de région et vérification d’existence ————————

/**
 * Détecte la région d’un projet en testant les différentes régions.
 * Retourne { region, projectId } (projectId potentiellement nettoyé)
 */
async function detectProjectRegion(projectId, accessToken) {
  const cleaned = cleanId(projectId);
  logger.debug(`[Publish] Détection région (${REGION_LIST_LOG}) pour projet: ${projectId}`);

  try {
    const url = `${dataBase()}/projects/${encodeURIComponent(projectId)}`;
    const config = {
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 5000,
      validateStatus: () => true,
    };

    const resp = await tryWithAndWithoutPrefix(config, projectId);

      if (resp.status === 200) {
        logger.info(`[Publish] Projet détecté dans région: ${formatRegion(region)}`);
        return { region, projectId: cleaned };
      }
    } catch (e) {
      logger.debug(
        `[Publish] Région ${formatRegion(region)} non accessible pour le projet: ${e.message}`
      );
    }
  } catch (e) {
    logger.warn(`[Publish] Erreur détection région: ${e.message}`);
  }

  logger.warn(
    `[Publish] Impossible de détecter la région (${REGION_LIST_LOG}) du projet: ${projectId}`
  );
  return { region: null, projectId: cleaned };
}

/** Vérifie si un item existe dans une région donnée */
async function verifyItemExists(region, projectId, itemUrn, accessToken) {
  try {
    const url = `${dataBase()}/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemUrn)}`;
    const config = {
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 5000,
      validateStatus: () => true,
    };

    const resp = await tryWithAndWithoutPrefix(config, projectId);
    const exists = resp.status === 200;

    if (exists) {
      logger.debug(`[Publish] Item existe dans région ${formatRegion(region)}: ${itemUrn}`);
    }

    return exists;
  } catch (e) {
    logger.debug(
      `[Publish] Erreur vérification existence item région ${formatRegion(region)}: ${e.message}`
    );
    return false;
  }
}

/** Trouve la région où l’item existe */
async function findItemRegion(projectId, itemUrn, accessToken, projectRegion = null) {
  // Essayer d’abord la région du projet si elle est connue
  const regionsToTry = projectRegion
    ? [projectRegion, ...REGIONS.filter((r) => r !== projectRegion)]
    : REGIONS;

  for (const region of regionsToTry) {
    if (await verifyItemExists(region, projectId, itemUrn, accessToken)) {
      logger.info(`[Publish] Item trouvé dans région: ${formatRegion(region)}`);
      return region;
    }
  }

  return null;
}

// — Résolution de version (region-aware) ———————————–

async function getTipVersionFromItems(region, projectId, itemUrn, accessToken) {
  const url = `${dataBase()}/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemUrn)}`;
  const config = {
    method: 'GET',
    url,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: ITEM_TIMEOUT_MS,
    validateStatus: () => true,
  };

  const resp = await tryWithAndWithoutPrefix(config, projectId);

  if (resp.status !== 200) {
    throw new Error(`items GET ${formatRegion(region)} ${resp.status}: ${safeBody(resp.data)}`);
  }

  // 1) relationships.tip.data.id
  const tip = resp?.data?.data?.relationships?.tip?.data;
  if (tip?.id) {
    logger.debug(`[Publish] Tip version trouvée via relationships: ${tip.id}`);
    return tip.id;
  }

  // 2) included -> versions
  const included = Array.isArray(resp?.data?.included) ? resp.data.included : [];
  const ver = included.find((x) => x?.type === 'versions' && x?.id);
  if (ver?.id) {
    logger.debug(`[Publish] Version trouvée via included: ${ver.id}`);
    return ver.id;
  }

    throw new Error(
      `Tip version introuvable dans la réponse /items (region=${formatRegion(region)})`
    );
}

async function getLatestVersionFromVersions(region, projectId, itemUrn, accessToken) {
  const url = `${dataBase()}/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemUrn)}/versions`;
  const config = {
    method: 'GET',
    url,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: ITEM_TIMEOUT_MS,
    validateStatus: () => true,
  };

  const resp = await tryWithAndWithoutPrefix(config, projectId);

  if (resp.status !== 200) {
    throw new Error(`versions GET ${formatRegion(region)} ${resp.status}: ${safeBody(resp.data)}`);
  }

  const arr = Array.isArray(resp?.data?.data) ? resp.data.data : [];
  if (!arr.length) {
    throw new Error(`Aucune version retournée (region=${formatRegion(region)})`);
  }

  // L’API renvoie généralement la plus récente en premier
  const latestVersion = arr[0].id;
  logger.debug(
    `[Publish] Version la plus récente trouvée: ${latestVersion} (${arr.length} versions au total)`
  );
  return latestVersion;
}

/**
 * Essaie de résoudre vers un URN version en testant les régions
 * Retourne { versionUrn, region }
 */
async function resolveToVersionUrnWithRegion(projectId, inputUrn, accessToken, projectRegion = null) {
  logger.info(`[Publish] Début résolution version pour: ${inputUrn}`);

  // Si c’est déjà une version -> pas besoin de /items
  if (isVersionUrn(inputUrn)) {
    logger.debug(`[Publish] Input est déjà une version -> ${inputUrn}`);
    return { versionUrn: inputUrn, region: projectRegion };
  }

  // Vérifier d’abord que l’item existe et dans quelle région
  const itemRegion = await findItemRegion(projectId, inputUrn, accessToken, projectRegion);

  if (!itemRegion) {
    throw new Error(`Item n'existe dans aucune région (${REGION_LIST_LOG}): ${inputUrn}`);
  }

  // Essayer de résoudre la version dans la région où l’item existe
  try {
    // Essayer d’abord via /items (pour obtenir la tip version)
    const v1 = await getTipVersionFromItems(itemRegion, projectId, inputUrn, accessToken);
    logger.info(
      `[Publish] Résolution tip via /items OK: region=${formatRegion(itemRegion)} item=${inputUrn} -> version=${v1}`
    );
    return { versionUrn: v1, region: itemRegion };
  } catch (e1) {
    logger.warn(
      `[Publish] /items ${formatRegion(itemRegion)} échec, essai fallback /versions: ${e1.message}`
    );

    try {
      // Fallback: essayer via /versions
      const v2 = await getLatestVersionFromVersions(itemRegion, projectId, inputUrn, accessToken);
      logger.info(
        `[Publish] Résolution via /versions OK: region=${formatRegion(itemRegion)} item=${inputUrn} -> version=${v2}`
      );
      return { versionUrn: v2, region: itemRegion };
    } catch (e2) {
      throw new Error(
        `Impossible de résoudre la version même avec item existant dans région ${formatRegion(itemRegion)}: ${e2.message}`
      );
    }
  }
}

// — Envoi de la Command Publish (region-aware) ——————————

async function publishVersionViaCommand(region, projectId, versionUrn, accessToken) {
  const url = `${commandsBase(region)}/projects/${encodeURIComponent(projectId)}/commands`;
  const cmdType =
    PUBLISH_COMMAND === 'PublishWithoutLinks'
      ? 'commands:autodesk.bim360:C4RModelPublishWithoutLinks'
      : 'commands:autodesk.bim360:C4RModelPublish';

  const payload = {
    jsonapi: { version: '1.0' },
    data: {
      type: 'commands',
      attributes: {
        extension: { type: cmdType, version: '1.0.0' },
      },
      relationships: {
        resources: {
          data: [{ type: 'versions', id: versionUrn }],
        },
      },
    },
  };

  logger.debug(
    `[Publish] Envoi command ${PUBLISH_COMMAND} région=${formatRegion(region)} version=${versionUrn}`
  );

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      const config = {
        method: 'POST',
        url,
        data: payload,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        timeout: ITEM_TIMEOUT_MS,
        validateStatus: () => true,
      };

      const resp = await tryWithAndWithoutPrefix(config, projectId);
      const { status, data } = resp;

      if (status === 202 || status === 200 || status === 201) {
        logger.info(
          `[Publish][REAL][Commands] HTTP ${status} region=${formatRegion(region)} project=${projectId} version=${versionUrn} cmd=${PUBLISH_COMMAND}`
        );
        return { outcome: 'accepted', http: status, body: data };
      }

      if (status >= 400 && status < 500 && status !== 429) {
        logger.warn(
          `[Publish][REAL][Commands] ${status} non-retry region=${formatRegion(region)} project=${projectId} version=${versionUrn} body=${safeBody(
            data
          )}`
        );
        return { outcome: 'failed', http: status, body: data };
      }

      attempt++;
      const wait = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      logger.warn(
        `[Publish][REAL][Commands] HTTP ${status} retry attempt=${attempt}/${MAX_RETRIES} wait=${wait}ms region=${formatRegion(region)} body=${safeBody(
          data
        )}`
      );
      await sleep(wait);
    } catch (e) {
      attempt++;
      const wait = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      logger.warn(
        `[Publish][REAL][Commands] network error: ${e.message} retry ${attempt}/${MAX_RETRIES} wait=${wait}ms region=${formatRegion(region)}`
      );
      await sleep(wait);
    }
  }

  return { outcome: 'failed', http: 0, body: null };
}

/**
 * Publie une version en essayant d’abord la région connue (si on l’a),
 * puis en fallback l’autre région.
 */
async function publishVersionWithRegion(versionUrn, knownRegion, projectId, accessToken) {
  const tryOrder = knownRegion ? [knownRegion, ...REGIONS.filter((r) => r !== knownRegion)] : REGIONS.slice();

  logger.debug(
    `[Publish] Ordre des régions à tester pour publish: ${tryOrder.map((r) => formatRegion(r)).join(', ')}`
  );

  for (const region of tryOrder) {
    const r = await publishVersionViaCommand(region, projectId, versionUrn, accessToken);

    if (r.outcome === 'accepted') {
      logger.info(`[Publish] Publication acceptée dans région: ${formatRegion(region)}`);
      return { ...r, regionTried: region };
    }

    if (r.http && r.http !== 404) {
      // Erreur non-404, pas besoin d'essayer autre région
      logger.warn(
        `[Publish] Erreur ${r.http} dans région ${formatRegion(region)}, arrêt des tentatives`
      );
      return { ...r, regionTried: region };
    }

    // En cas de 404, on tente l'autre région
    if (r.http === 404) {
      logger.warn(
        `[Publish] 404 en publish dans region=${formatRegion(region)}, tentative région suivante...`
      );
    }
  }

  // Si toutes régions échouent
  logger.error(
    `[Publish] Échec publication dans toutes les régions testées: ${tryOrder
      .map((r) => formatRegion(r))
      .join(', ')}`
  );
  return {
    outcome: 'failed',
    http: 404,
    body: null,
    regionTried: tryOrder[tryOrder.length - 1],
  };
}

// — Service principal —————————————————––

class APSPublishService {
  async startRun(job) {
    const run = await PublishRun.create({
      jobId: job.id,
      userId: job.userId,
      hubId: job.hubId,
      projectId: job.projectId,
      items: Array.isArray(job.models) ? job.models : [],
      status: 'running',
      startedAt: new Date(),
      results: [],
      stats: {},
    });

    logger.info(`[Publish] Run créé: ${run.id} pour job ${job.id}`);
    return run;
  }

  async executeRun(run) {
    const started = Date.now();
    const results = [];

    try {
      // Token 3-legged de l'utilisateur
      const accessToken = await apsAuthService.ensureValidToken(run.userId);

      // Détecter d'abord la région du projet pour optimiser les appels suivants
      const projectInfo = await detectProjectRegion(run.projectId, accessToken);
      const projectRegion = projectInfo.region;

      logger.info(
        `[Publish] Mode=${ENABLE_REAL ? `REAL(${PUBLISH_COMMAND})` : 'DRY-RUN'} run=${run.id} project=${
          run.projectId
        } région=${formatRegion(projectRegion)} items=${run.items.length}`
      );

      // Log détaillé des items à traiter
      if (run.items.length <= 10) {
        logger.debug(`[Publish] Items à traiter: ${JSON.stringify(run.items)}`);
      } else {
        logger.debug(`[Publish] ${run.items.length} items à traiter (premiers: ${run.items.slice(0, 5).join(', ')}...)`);
      }

      for (const selectedUrn of run.items) {
        try {
          if (!ENABLE_REAL) {
            // Mode DRY-RUN pour tests
            await sleep(120);
            results.push({ item: selectedUrn, status: 'queued' });
            logger.info(`[Publish][DRY-RUN] run=${run.id} item=${selectedUrn}`);
            continue;
          }

          // 1) Résoudre -> VERSION + région
          let versionUrn;
          let resolvedRegion = projectRegion;

          if (isVersionUrn(selectedUrn)) {
            versionUrn = selectedUrn;
            logger.debug(`[Publish] Input déjà version -> ${versionUrn}`);
          } else {
            try {
              const r = await resolveToVersionUrnWithRegion(run.projectId, selectedUrn, accessToken, projectRegion);
              versionUrn = r.versionUrn;
              resolvedRegion = r.region || projectRegion;
              logger.info(
                `[Publish] Résolu: item=${selectedUrn} -> version=${versionUrn} (région=${formatRegion(
                  resolvedRegion
                )})`
              );
            } catch (e) {
              const msg = `Échec résolution version: ${e.message}`;
              results.push({
                item: selectedUrn,
                status: 'failed',
                message: msg,
                error: 'RESOLUTION_ERROR',
              });
              logger.error(`[Publish] ${msg} (project=${run.projectId}, input=${selectedUrn})`);
              continue;
            }
          }

          // 2) Publier, en essayant la région connue puis les autres
          const { outcome, http, body, regionTried } = await publishVersionWithRegion(
            versionUrn,
            resolvedRegion,
            run.projectId,
            accessToken
          );

          const effectiveRegion = regionTried || resolvedRegion || null;

          results.push({
            item: selectedUrn,
            version: versionUrn,
            status: outcome,
            http,
            region: effectiveRegion,
          });

          if (outcome === 'accepted') {
            logger.info(
              `[Publish][REAL] ✓ run=${run.id} version=${versionUrn} => ${outcome} (HTTP ${http}, region=${formatRegion(
                effectiveRegion
              )})`
            );
          } else {
            logger.warn(
              `[Publish][REAL] ✗ run=${run.id} version=${versionUrn} => ${outcome} (HTTP ${http}, body=${safeBody(body)})`
            );
          }
        } catch (e) {
          const message = e?.message || 'Erreur publication inconnue';
          results.push({
            item: selectedUrn,
            status: 'failed',
            message,
            error: 'PUBLISH_ERROR',
          });
          logger.error(`[Publish] Échec critique item=${selectedUrn}: ${message}`, e.stack);
        }
      }
    } catch (e) {
      logger.error(`[Publish] Erreur fatale dans executeRun: ${e.message}`, e.stack);
      throw e;
    }

    const durationMs = Date.now() - started;
    const okCount = results.filter((r) => r.status === 'accepted' || r.status === 'queued').length;
    const failCount = results.filter((r) => r.status === 'failed').length;

    logger.info(`[Publish] Run terminé: ${run.id} duration=${durationMs}ms ok=${okCount} failed=${failCount}`);

    return { results, durationMs };
  }

  async finishRun(run, summary) {
    run.status = summary.status || 'completed';
    run.endedAt = new Date();
    run.results = summary.results || [];
    run.stats = {
      ...(run.stats || {}),
      durationMs: summary.durationMs,
      items: (summary.results || []).length,
      okCount: (summary.results || []).filter((r) => r.status !== 'failed').length,
      failCount: (summary.results || []).filter((r) => r.status === 'failed').length,
    };

    if (summary.message) {
      run.message = summary.message;
    }

    await run.save();

    logger.info(`[Publish] Run sauvegardé: ${run.id} status=${run.status} stats=${JSON.stringify(run.stats)}`);
    return run;
  }

  /** Méthode utilitaire pour vérifier la santé du service */
  async healthCheck(userId, projectId) {
    try {
      const accessToken = await apsAuthService.ensureValidToken(userId);
      const { region } = await detectProjectRegion(projectId, accessToken);

      return {
        healthy: true,
        projectRegion: region,
        projectRegionLabel: formatRegion(region),
        regions: REGIONS,
        regionLabels: REGION_LABELS,
        config: {
          ENABLE_REAL,
          PUBLISH_COMMAND,
          ITEM_TIMEOUT_MS,
          MAX_RETRIES,
        },
      };
    } catch (e) {
      return {
        healthy: false,
        error: e.message,
        regions: REGIONS,
        regionLabels: REGION_LABELS,
      };
    }
  }

  /** Méthode pour lister les items d’un projet (utile pour debug) */
  async listProjectItems(userId, projectId, folderUrn = null) {
    try {
      const accessToken = await apsAuthService.ensureValidToken(userId);
      const projectInfo = await detectProjectRegion(projectId, accessToken);

      if (!projectInfo.region) {
        throw new Error(`Impossible de déterminer la région (${REGION_LIST_LOG}) du projet`);
      }

      const validProjectId = projectInfo.projectId;
      const region = projectInfo.region;

      // Si pas de dossier spécifié, utiliser le dossier racine
      let targetFolderUrn = folderUrn;
      if (!targetFolderUrn) {
        // Obtenir le dossier racine du projet
        const hubUrl = `${dataBase()}/projects/${encodeURIComponent(validProjectId)}`;
        const hubResp = await axios.get(hubUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: ITEM_TIMEOUT_MS,
          validateStatus: () => true,
        });

        if (hubResp.status === 200) {
          targetFolderUrn = hubResp.data?.data?.relationships?.rootFolder?.data?.id;
        }
      }

      if (!targetFolderUrn) {
        throw new Error('Impossible de trouver le dossier racine');
      }

      // Lister le contenu du dossier
      const folderUrl = `${dataBase()}/projects/${encodeURIComponent(
        validProjectId
      )}/folders/${encodeURIComponent(targetFolderUrn)}/contents`;
      const resp = await axios.get(folderUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          'page[limit]': 50,
        },
        timeout: ITEM_TIMEOUT_MS,
        validateStatus: () => true,
      });

      if (resp.status !== 200) {
        throw new Error(`Impossible de lister le contenu: HTTP ${resp.status}`);
      }

      const items = resp.data?.data || [];
      const results = items.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.attributes?.displayName,
        createTime: item.attributes?.createTime,
        modifyTime: item.attributes?.modifyTime,
        extension: item.attributes?.extension?.type,
        size: item.attributes?.storageSize,
      }));

      return {
        projectId: validProjectId,
        region,
        folderUrn: targetFolderUrn,
        itemCount: results.length,
        items: results,
      };
    } catch (e) {
      return {
        error: e.message,
        projectId,
      };
    }
  }

  /** Méthode pour obtenir les détails d’une version */
  async getVersionDetails(userId, projectId, versionUrn) {
    try {
      const accessToken = await apsAuthService.ensureValidToken(userId);
      const projectInfo = await detectProjectRegion(projectId, accessToken);

      if (!projectInfo.region) {
        throw new Error(`Impossible de déterminer la région (${REGION_LIST_LOG}) du projet`);
      }

      const validProjectId = projectInfo.projectId;
      const region = projectInfo.region;

      // Obtenir les détails de la version
      const url = `${dataBase()}/projects/${encodeURIComponent(validProjectId)}/versions/${encodeURIComponent(
        versionUrn
      )}`;
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: ITEM_TIMEOUT_MS,
        validateStatus: () => true,
      });

      if (resp.status !== 200) {
        throw new Error(`Impossible d'obtenir les détails de la version: HTTP ${resp.status}`);
      }

      const data = resp.data?.data;
      return {
        versionUrn,
        projectId: validProjectId,
        region,
        details: {
          type: data?.type,
          displayName: data?.attributes?.displayName,
          createTime: data?.attributes?.createTime,
          lastModifiedTime: data?.attributes?.lastModifiedTime,
          versionNumber: data?.attributes?.versionNumber,
          extension: data?.attributes?.extension,
          storageSize: data?.attributes?.storageSize,
          fileType: data?.attributes?.fileType,
          mimeType: data?.attributes?.mimeType,
          relationships: Object.keys(data?.relationships || {}),
        },
      };
    } catch (e) {
      return {
        error: e.message,
        versionUrn,
        projectId,
      };
    }
  }
}

module.exports = new APSPublishService();
