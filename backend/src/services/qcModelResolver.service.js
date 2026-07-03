// src/services/qcModelResolver.service.js
// Chantier 1 : résolution de version PAR MODÈLE et garde workshared, sans ouverture.
//
// Règles (plan approuvé) :
//  - UN SEUL GET Version DM (tip) par résolution. INTERDIT : Model Derivative,
//    workitem de résolution, ouverture de confirmation.
//  - Garde workshared par DOUBLE signal vérifié contre les réponses DM réelles :
//      extension.type === 'versions:autodesk.bim360:C4RModel'
//      ET extension.data.modelType === 'multiuser'
//  - Version lue dans extension.data.revitProjectVersion (JSON number → normalisée en chaîne).
//  - Point d'entrée « désignation lisible » : URL ACC Docs, ou noms (hub/projet/fichier),
//    ou identifiants directs (projectId + itemUrn). Aucun GUID codé en dur.
//  - Upsert de qc.projects (attributs projet uniquement) à chaque résolution réussie.

const axios = require('axios');
const { apsConfig } = require('../config/aps.config');
const logger = require('../config/logger');

const BASE = apsConfig.apis.baseUrl;
const C4R_TYPE = 'versions:autodesk.bim360:C4RModel';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOLDER_DEPTH = 4;

class QcModelResolverService {
  // ======== 1) Désignation lisible → { projectId, itemUrn } ========

  /**
   * @param {object} d - désignation : { accUrl } | { hubId|hubName, projectId|projectName, fileName [, folderPath] }
   *                     | { projectId, itemUrn }
   */
  async resolveDesignation(d, accessToken) {
    if (d.accUrl) return this.parseAccUrl(d.accUrl);

    if (d.projectId && d.itemUrn) {
      return { projectId: d.projectId, itemUrn: d.itemUrn };
    }

    if ((d.hubId || d.hubName) && (d.projectId || d.projectName) && d.fileName) {
      return this._resolveByNames(d, accessToken);
    }

    const err = new Error(
      'Désignation du modèle invalide. Fournir soit accUrl (URL ACC Docs du fichier), ' +
        'soit { hubName|hubId, projectName|projectId, fileName }, soit { projectId, itemUrn }.'
    );
    err.statusCode = 400;
    throw err;
  }

  /**
   * URL ACC Docs attendue : https://acc.autodesk.com/docs/files/projects/<projectGuid>?...&entityId=<urn lineage>
   * Toute autre forme → erreur explicative, jamais une devinette.
   */
  parseAccUrl(accUrl) {
    let u;
    try {
      u = new URL(accUrl);
    } catch {
      const err = new Error(`URL ACC invalide: ${accUrl}`);
      err.statusCode = 400;
      throw err;
    }
    const m = u.pathname.match(/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!m) {
      const err = new Error(
        `URL ACC non reconnue (pas de GUID de projet dans le chemin): ${accUrl}. ` +
          'Attendu: https://acc.autodesk.com/docs/files/projects/<guid>?...&entityId=<urn>'
      );
      err.statusCode = 400;
      throw err;
    }
    const entityId = u.searchParams.get('entityId');
    if (!entityId || !entityId.startsWith('urn:')) {
      const err = new Error(
        "L'URL ACC désigne un projet/dossier, pas un fichier (paramètre entityId absent). " +
          'Ouvrir le fichier .rvt dans ACC Docs et copier l\'URL complète.'
      );
      err.statusCode = 400;
      throw err;
    }
    return { projectId: `b.${m[1]}`, itemUrn: entityId };
  }

  async _resolveByNames(d, accessToken) {
    const hubs = await this._getHubs(accessToken);
    const hub = hubs.find(
      (h) =>
        (d.hubId && h.id === d.hubId) ||
        (d.hubName && (h.attributes?.name || '').toLowerCase() === String(d.hubName).toLowerCase())
    );
    if (!hub) {
      const err = new Error(`Hub introuvable: ${d.hubId || d.hubName} (hubs accessibles: ${hubs.map((h) => h.attributes?.name).join(', ')})`);
      err.statusCode = 404;
      throw err;
    }

    let project;
    if (d.projectId) {
      project = { id: d.projectId };
    } else {
      const projects = await this._get(`${BASE}/project/v1/hubs/${hub.id}/projects`, accessToken);
      project = (projects.data || []).find(
        (p) => (p.attributes?.name || '').toLowerCase() === String(d.projectName).toLowerCase()
      );
      if (!project) {
        const err = new Error(`Projet introuvable dans le hub ${hub.attributes?.name}: ${d.projectName}`);
        err.statusCode = 404;
        throw err;
      }
    }

    const itemUrn = await this._findItemByName(hub.id, project.id, d.fileName, accessToken);
    return { projectId: project.id, itemUrn };
  }

  async _findItemByName(hubId, projectId, fileName, accessToken) {
    const tf = await this._get(`${BASE}/project/v1/hubs/${hubId}/projects/${projectId}/topFolders`, accessToken);
    const stack = (tf.data || [])
      .filter((f) => /project files|fichiers/i.test(f.attributes?.displayName || ''))
      .map((f) => ({ id: f.id, depth: 0 }));

    const matches = [];
    while (stack.length) {
      const f = stack.pop();
      if (f.depth > MAX_FOLDER_DEPTH) continue;
      const c = await this._get(
        `${BASE}/data/v1/projects/${projectId}/folders/${encodeURIComponent(f.id)}/contents`,
        accessToken
      );
      for (const it of c.data || []) {
        if (it.type === 'folders') {
          stack.push({ id: it.id, depth: f.depth + 1 });
        } else if ((it.attributes?.displayName || '').toLowerCase() === String(fileName).toLowerCase()) {
          matches.push(it.id);
        }
      }
    }

    if (matches.length === 0) {
      const err = new Error(`Fichier introuvable dans le projet (profondeur ≤ ${MAX_FOLDER_DEPTH}): ${fileName}`);
      err.statusCode = 404;
      throw err;
    }
    if (matches.length > 1) {
      const err = new Error(`Fichier ambigu (${matches.length} occurrences de "${fileName}") — fournir accUrl ou itemUrn.`);
      err.statusCode = 400;
      throw err;
    }
    return matches[0];
  }

  // ======== 2) Métadonnée C4RModel : version + garde workshared ========

  /**
   * Résout la métadonnée du modèle SANS l'ouvrir (un seul GET tip).
   * @returns {Promise<object>} { workshared, extensionType, modelType, revitVersion (string|null),
   *   projectGuid, modelGuid, dmVersionNumber, versionUrn, fileName, region, hubId, hubName,
   *   projectId, projectName, itemUrn }
   */
  async resolveModel({ projectId, itemUrn }, accessToken) {
    // Hub → région (même terrain que resolveRegionAndProject d'apsPublish : lecture seule)
    const hubInfo = await this._findHubForProject(projectId, accessToken);
    const region = String(hubInfo.region || 'US').toUpperCase();

    // LE GET Version DM unique
    const tip = await this._getWithRegionFallback(
      `${BASE}/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemUrn)}/tip`,
      accessToken,
      region
    );

    const attrs = tip.data?.attributes || {};
    const ext = attrs.extension || {};
    const data = ext.data || {};

    // Double signal vérifié contre les réponses DM réelles (C4RModel 1.3.1 vs File 1.0)
    const workshared = ext.type === C4R_TYPE && data.modelType === 'multiuser';

    const resolved = {
      workshared,
      extensionType: ext.type || null,
      modelType: data.modelType || null,
      // number JSON → chaîne normalisée ('2025'), null si non workshared
      revitVersion: workshared && data.revitProjectVersion != null ? String(data.revitProjectVersion) : null,
      projectGuid: workshared ? data.projectGuid || null : null,
      modelGuid: workshared ? data.modelGuid || null : null,
      dmVersionNumber: attrs.versionNumber ?? null,
      versionUrn: tip.data?.id || null,
      fileName: attrs.name || null,
      region,
      hubId: hubInfo.hubId,
      hubName: hubInfo.hubName,
      projectId,
      projectName: hubInfo.projectName,
      itemUrn,
    };

    logger.info(
      `[QC][Resolver] ${resolved.fileName || itemUrn}: workshared=${resolved.workshared} ` +
        `(type=${resolved.extensionType}, modelType=${resolved.modelType}) ` +
        `revitProjectVersion=${resolved.revitVersion || 'n/a'} region=${region} ` +
        `projectGuid=${resolved.projectGuid || '-'} modelGuid=${resolved.modelGuid || '-'} dmVersion=${resolved.dmVersionNumber}`
    );

    if (resolved.workshared) {
      await this._upsertQcProject(resolved).catch((e) =>
        logger.warn(`[QC][Resolver] Upsert qc.projects échoué (non bloquant): ${e.message}`)
      );
    }

    return resolved;
  }

  async _findHubForProject(projectId, accessToken) {
    const hubs = await this._getHubs(accessToken);
    for (const hub of hubs) {
      try {
        const p = await this._get(
          `${BASE}/project/v1/hubs/${hub.id}/projects/${encodeURIComponent(projectId)}`,
          accessToken
        );
        if (p.data?.id) {
          return {
            hubId: hub.id,
            hubName: hub.attributes?.name || null,
            region: hub.attributes?.region || 'US',
            projectName: p.data.attributes?.name || null,
          };
        }
      } catch {
        // 404 = pas dans ce hub, on continue
      }
    }
    const err = new Error(`Projet ${projectId} introuvable dans les hubs accessibles à l'utilisateur`);
    err.statusCode = 404;
    throw err;
  }

  // ======== 3) qc.projects (attributs projet uniquement) ========

  async _upsertQcProject(resolved) {
    // Modèles qc chargés paresseusement (jamais avant sync) — même règle que qcRun.service
    const { QCProject } = require('../models/qc');
    const accProjectGuid = GUID_RE.test(String(resolved.projectGuid)) ? resolved.projectGuid : null;
    await QCProject.upsert(
      {
        projectId: resolved.projectId,
        region: resolved.region,
        hubId: resolved.hubId,
        projectName: resolved.projectName,
        accProjectGuid,
      },
      { conflictFields: ['projectId'] }
    );
  }

  // ======== HTTP utils ========

  async _get(url, accessToken, extraHeaders = {}) {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
      timeout: 30_000,
    });
    return data;
  }

  /** GET avec repli x-ads-region : les projets hors US peuvent exiger l'en-tête (cf. apsData.service). */
  async _getWithRegionFallback(url, accessToken, region) {
    try {
      return await this._get(url, accessToken);
    } catch (e) {
      if (e.response?.status === 404 && region && region !== 'US') {
        return this._get(url, accessToken, { 'x-ads-region': region });
      }
      throw e;
    }
  }

  async _getHubs(accessToken) {
    const res = await this._get(`${BASE}/project/v1/hubs`, accessToken);
    return res.data || [];
  }
}

module.exports = new QcModelResolverService();
