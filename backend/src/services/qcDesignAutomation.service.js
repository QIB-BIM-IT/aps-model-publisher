// src/services/qcDesignAutomation.service.js
// Client Design Automation v3 (+ OSS pour le fichier résultat) dédié au module QC.
//
// Additif strict :
//  - consomme les endpoints DA déjà déclarés (et jamais utilisés) dans aps.config.js ;
//  - maintient son PROPRE cache de token 2 legs (scopes code:all + bucket/data) pour ne
//    JAMAIS écraser le cache 2 legs partagé de apsAuth.service (dont les scopes servent
//    aux fonctionnalités existantes) ;
//  - aucun appel APS existant n'est modifié.
//
// Le token 3 legs de l'utilisateur est passé au workitem via l'argument réservé
// `adsk3LeggedToken` (valeur = access_token brut) — c'est lui qui autorise l'ouverture
// du modèle cloud ACC dans le moteur Revit. Le token doit porter le scope code:all.

const axios = require('axios');
const qs = require('querystring');
const crypto = require('crypto');
const { apsConfig } = require('../config/aps.config');
const logger = require('../config/logger');

// Scopes du token 2 legs QC (gestion DA + bucket OSS résultat)
const QC_2LO_SCOPES = ['code:all', 'bucket:create', 'bucket:read', 'data:read', 'data:write', 'data:create'];

const BASE = apsConfig.apis.baseUrl; // https://developer.api.autodesk.com
const DA = apsConfig.apis.designAutomation; // { workItems, activities, appBundles, engines } (déjà déclarés)

class QcDesignAutomationService {
  constructor() {
    // Cache 2 legs PRIVÉ au module QC (ne pas utiliser apsAuthService.getTwoLeggedToken :
    // son cache est partagé et mono-scope — l'écraser impacterait l'existant).
    this._token = { access_token: null, expires_at: 0 };
  }

  // ======== Configuration (multimoteur) ========

  get config() {
    const clientId = process.env.APS_CLIENT_ID || '';
    return {
      nickname: process.env.QC_DA_NICKNAME || clientId,
      alias: process.env.QC_DA_ALIAS || 'prod',
      bucketKey:
        process.env.QC_OSS_BUCKET ||
        (clientId ? `qc-results-${crypto.createHash('sha1').update(clientId).digest('hex').slice(0, 12)}` : null),
    };
  }

  /**
   * Noms des ressources DA pour une version d'engine donnée.
   * Préfixe qc_extractor + suffixe version, underscores (l'API DA refuse les tirets).
   */
  namesFor(version) {
    return {
      appBundleName: `qc_extractor_appbundle_${version}`,
      activityName: `qc_extractor_activity_${version}`,
      engine: `Autodesk.Revit+${version}`,
      alias: this.config.alias,
    };
  }

  /**
   * Id qualifié de l'activity pour une version Revit ('2024' | '2025').
   * Map d'env QC_DA_ACTIVITY_ID_<version> ; l'ancien QC_DA_ACTIVITY_ID reste lu
   * comme alias 2024 (compat tranche 1, rien ne casse).
   */
  activityIdFor(version) {
    const v = String(version);
    const fromMap = process.env[`QC_DA_ACTIVITY_ID_${v}`] || null;
    if (fromMap) return fromMap;
    if (v === '2024') return process.env.QC_DA_ACTIVITY_ID || null;
    return null;
  }

  /** Versions Revit dont l'activity est configurée (ordre croissant). */
  configuredVersions() {
    return ['2024', '2025'].filter((v) => Boolean(this.activityIdFor(v)));
  }

  /** Le module DA est-il prêt à soumettre au moins un type de workitem ? */
  isConfigured() {
    return Boolean(
      process.env.APS_CLIENT_ID &&
        process.env.APS_CLIENT_SECRET &&
        this.config.bucketKey &&
        this.configuredVersions().length > 0
    );
  }

  /** Message d'aide quand la config DA est absente (boot dégradé). */
  configurationHint() {
    return (
      'Design Automation non configuré pour le module QC. ' +
      'Exécuter backend/scripts/setup-da.js --engine-version <2024|2025> puis définir ' +
      'QC_DA_ACTIVITY_ID_2024 / QC_DA_ACTIVITY_ID_2025 ' +
      '(ex: <nickname>.qc_extractor_activity_2025+prod). Voir backend/docs/QC_MODULE.md.'
    );
  }

  // ======== Token 2 legs privé ========

  async getToken() {
    const now = Date.now();
    if (this._token.access_token && now < this._token.expires_at - 60_000) {
      return this._token.access_token;
    }
    const body = {
      grant_type: 'client_credentials',
      client_id: apsConfig.credentials.client_id,
      client_secret: apsConfig.credentials.client_secret,
      scope: QC_2LO_SCOPES.join(' '),
    };
    const { data } = await axios.post(apsConfig.endpoints.TOKEN, qs.stringify(body), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    this._token = {
      access_token: data.access_token,
      expires_at: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  async _authHeaders() {
    const token = await this.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  // ======== OSS (bucket transient pour result.json) ========

  async ensureBucket() {
    const { bucketKey } = this.config;
    const headers = await this._authHeaders();
    try {
      await axios.post(
        `${BASE}/oss/v2/buckets`,
        { bucketKey, policyKey: 'transient' },
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      );
      logger.info(`[QC][DA] Bucket OSS créé: ${bucketKey}`);
    } catch (err) {
      if (err.response?.status === 409) return; // existe déjà
      throw new Error(`Création bucket OSS échouée: ${this._msg(err)}`);
    }
  }

  /**
   * Crée une URL signée OSS (access=readwrite) pour un objet.
   * DA fera un PUT dessus (argument result), puis on fera un GET dessus pour lire le résultat.
   */
  async createSignedResultUrl(objectKey, minutesExpiration = 120) {
    const { bucketKey } = this.config;
    const headers = await this._authHeaders();
    const { data } = await axios.post(
      `${BASE}/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/signed?access=readwrite`,
      { minutesExpiration },
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
    return data.signedUrl;
  }

  async downloadResult(signedUrl) {
    const { data } = await axios.get(signedUrl, { responseType: 'json', timeout: 60_000 });
    return data;
  }

  // ======== Workitems ========

  /**
   * Soumet un workitem QC sur l'activity fournie (routage par version fait en amont).
   * @param {object} p
   * @param {string} p.activityId    - id qualifié de l'activity (résolu via activityIdFor)
   * @param {object} p.inputParams   - contenu de params.json (region, projectGuid, modelGuid…)
   * @param {string} p.resultUrl     - URL signée OSS (PUT par DA)
   * @param {string} p.threeLeggedToken - access_token 3 legs BRUT (scope code:all) de l'utilisateur
   * @param {string|null} p.onCompleteUrl - callback de complétion (optionnel)
   * @returns {Promise<string>} id du workitem
   */
  async submitWorkitem({ activityId, inputParams, resultUrl, threeLeggedToken, onCompleteUrl }) {
    if (!activityId) throw new Error('activityId manquant (routage par version non résolu)');
    const headers = await this._authHeaders();

    const args = {
      inputParams: {
        url: `data:application/json,${JSON.stringify(inputParams)}`,
      },
      result: {
        url: resultUrl,
        verb: 'put',
      },
      // Argument réservé DA4R : contexte utilisateur pour l'ouverture du modèle cloud ACC.
      adsk3LeggedToken: threeLeggedToken,
    };
    if (onCompleteUrl) {
      args.onComplete = { verb: 'post', url: onCompleteUrl };
    }

    const payload = { activityId, arguments: args };

    const { data } = await axios.post(`${BASE}${DA.workItems}`, payload, {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

    logger.info(`[QC][DA] Workitem soumis: ${data.id} (activity=${activityId})`);
    return data.id;
  }

  /**
   * Télécharge le report texte d'un workitem (diagnostic post-mortem).
   * Best-effort : null si indisponible.
   */
  async downloadReport(reportUrl) {
    if (!reportUrl) return null;
    try {
      const { data } = await axios.get(reportUrl, { responseType: 'text', timeout: 60_000 });
      return typeof data === 'string' ? data : JSON.stringify(data);
    } catch (e) {
      logger.warn(`[QC][DA] Report indisponible: ${e.message}`);
      return null;
    }
  }

  /**
   * Statut d'un workitem: { status: 'pending'|'inprogress'|'success'|'failed'|'cancelled'|..., reportUrl }
   */
  async getWorkitem(workitemId) {
    const headers = await this._authHeaders();
    const { data } = await axios.get(`${BASE}${DA.workItems}/${encodeURIComponent(workitemId)}`, { headers });
    return data;
  }

  // ======== Utils ========

  _msg(err) {
    if (err?.response?.data) {
      try {
        return JSON.stringify(err.response.data);
      } catch {
        return String(err.response.data);
      }
    }
    return err?.message || String(err);
  }
}

module.exports = new QcDesignAutomationService();
