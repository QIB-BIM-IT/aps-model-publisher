// src/services/qcProjectConfig.service.js
// Couche données du formulaire de configuration QC (lot 1) :
//   - descriptions de cible depuis le catalogue (pour le moteur de rendu lot 2)
//   - lecture / écriture de qc.project_config avec validation dérivée du catalogue
//
// ⚠️ CLÉ projectId (piège G507) :
//   qc.project_config est indexé par projectId au format PRÉFIXÉ "b.<guid>"
//   — la MÊME clé que loadProjectConfig (scoring) lit via :
//     accProjectGuid (guid nu) → qc.projects.projectId ("b.<guid>") → project_config
//   Écrire sous le guid nu rend la config invisible au scoring (bug silencieux).
//   Les routes DOIVENT toujours résoudre vers le projectId préfixé avant toute
//   lecture/écriture. JAMAIS persister sous le guid nu.
//
// Sémantique d'écriture : MERGE au niveau config.controles[code]
//   - les contrôles fournis dans le body sont mis à jour / ajoutés
//   - les autres contrôles déjà configurés sont préservés
//   - criticite (racine) est remplacé seulement s'il est fourni dans le body
//   - un contrôle envoyé à null ou {} est retiré (effacement ciblé)

const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');

const CATALOG_PATH = path.join(__dirname, '..', '..', 'config', 'qc-controls-catalog.json');
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_CONFIG = Object.freeze({ controles: {}, criticite: null });

class QcProjectConfigService {
  constructor() {
    this._catalog = null;
  }

  getModels() {
    // Paresseux : ne jamais charger les modèles qc avant connectDB()/sync
    return require('../models/qc');
  }

  loadCatalog() {
    if (this._catalog) return this._catalog;
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    if (!raw || typeof raw.controles !== 'object') {
      throw new Error(`Catalogue des contrôles invalide: ${CATALOG_PATH}`);
    }
    this._catalog = raw;
    return raw;
  }

  /**
   * Résout l'identifiant d'entrée vers le projectId PRÉFIXÉ "b.<guid>" utilisé pour
   * qc.project_config — même chemin que qcScoring.service.loadProjectConfig.
   *
   * @param {string} projectKey - "b.<guid>" OU accProjectGuid nu
   * @returns {Promise<{ projectId: string, accProjectGuid: string|null, projectName: string|null }>}
   */
  async resolvePrefixedProjectId(projectKey) {
    const key = String(projectKey || '').trim();
    if (!key) {
      const err = new Error('Identifiant projet requis');
      err.statusCode = 400;
      throw err;
    }

    const { QCProject } = this.getModels();

    // Chemin préféré : projectId DM déjà préfixé (clé native de project_config)
    if (key.startsWith('b.')) {
      const project = await QCProject.findOne({ where: { projectId: key } });
      return {
        projectId: key,
        accProjectGuid: project?.accProjectGuid || (GUID_RE.test(key.slice(2)) ? key.slice(2) : null),
        projectName: project?.projectName || null,
      };
    }

    // Guid nu = accProjectGuid → résoudre vers qc.projects.projectId (préfixé)
    // Exactement comme loadProjectConfig : sans cette résolution, lecture/écriture
    // sous le guid nu ne matche PAS le scoring.
    if (GUID_RE.test(key)) {
      const project = await QCProject.findOne({ where: { accProjectGuid: key } });
      if (!project?.projectId) {
        const err = new Error(
          `Projet QC introuvable pour accProjectGuid=${key} — impossible de résoudre le projectId préfixé b.<guid>`
        );
        err.statusCode = 404;
        throw err;
      }
      if (!String(project.projectId).startsWith('b.')) {
        logger.warn(
          `[QC][Config] projectId inattendu (sans préfixe b.) pour accProjectGuid=${key}: ${project.projectId}`
        );
      }
      return {
        projectId: project.projectId,
        accProjectGuid: key,
        projectName: project.projectName || null,
      };
    }

    const err = new Error(
      'Identifiant projet invalide : attendu "b.<guid>" (projectId DM) ou un accProjectGuid (UUID nu)'
    );
    err.statusCode = 400;
    throw err;
  }

  sectionOf(code) {
    const n = parseInt(String(code).replace(/^G/i, ''), 10);
    if (!Number.isFinite(n)) return null;
    if (n >= 100 && n < 200) return '1 — Fichier';
    if (n >= 200 && n < 300) return '2 — Coordonnées et références';
    if (n >= 300 && n < 400) return '3 — Modélisation';
    if (n >= 400 && n < 500) return '4 — Organisation';
    if (n >= 500 && n < 600) return '5 — Données';
    return null;
  }

  /**
   * Nature formulaire : Auto (règle maison), Mixte (cible humaine + extraction auto),
   * Manuel (indicatif / jugement humain). Dérivée du typeWidget — pas de champ catalogue dédié.
   */
  natureOf(descriptionCible) {
    const w = descriptionCible?.typeWidget;
    if (w === 'regleMaisonLectureSeule') return 'Auto';
    if (w === 'indicatif') return 'Manuel';
    return 'Mixte';
  }

  isLectureSeule(descriptionCible) {
    const w = descriptionCible?.typeWidget;
    if (w === 'indicatif') return true;
    if (w === 'regleMaisonLectureSeule' && !descriptionCible.champEditable && !descriptionCible.champsAvances) {
      return true;
    }
    return false;
  }

  /** Retire les champs purement techniques scoring, garde ce que le formulaire consomme. */
  sanitizeDescriptionCible(desc) {
    if (!desc || typeof desc !== 'object') return desc;
    const { formatScoreur, ecartSignale, ...rest } = desc;
    return rest;
  }

  /**
   * GET descriptions de cible — 25 contrôles actifs, payload prêt pour le moteur de rendu.
   */
  getCibleDescriptions() {
    const catalog = this.loadCatalog();
    const controles = Object.entries(catalog.controles).map(([code, entry]) => {
      const descriptionCible = this.sanitizeDescriptionCible(entry.descriptionCible || {});
      return {
        code,
        section: this.sectionOf(code),
        libelle: entry.libelle || code,
        source: entry.source || null,
        forme: entry.forme || null,
        nature: this.natureOf(descriptionCible),
        lectureSeule: this.isLectureSeule(descriptionCible),
        descriptionCible,
      };
    });
    return {
      version: catalog.version || 1,
      count: controles.length,
      controles,
    };
  }

  /**
   * GET config projet — ne crée jamais de ligne. Absent → objet vide structuré.
   */
  async getProjectConfig(projectKey) {
    const resolved = await this.resolvePrefixedProjectId(projectKey);
    const { QCProjectConfig } = this.getModels();
    const row = await QCProjectConfig.findOne({ where: { projectId: resolved.projectId } });
    if (!row) {
      return {
        projectId: resolved.projectId,
        accProjectGuid: resolved.accProjectGuid,
        projectName: resolved.projectName,
        exists: false,
        config: { controles: {}, criticite: null },
      };
    }
    const cfg = row.config && typeof row.config === 'object' ? row.config : {};
    return {
      projectId: resolved.projectId,
      accProjectGuid: resolved.accProjectGuid,
      projectName: resolved.projectName,
      exists: true,
      config: {
        controles: cfg.controles && typeof cfg.controles === 'object' ? cfg.controles : {},
        criticite: cfg.criticite && typeof cfg.criticite === 'object' ? cfg.criticite : null,
      },
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Valide une cible de contrôle à partir de descriptionCible du catalogue (source de vérité).
   * @returns {string[]} messages d'erreur (vide = OK)
   */
  validateControlPayload(code, controlCfg, descriptionCible) {
    const errors = [];
    if (controlCfg === null) return errors; // effacement ciblé
    if (typeof controlCfg !== 'object' || Array.isArray(controlCfg)) {
      errors.push(`${code}: la config d'un contrôle doit être un objet`);
      return errors;
    }
    if (Object.keys(controlCfg).length === 0) return errors; // {} = effacement

    const desc = descriptionCible || {};
    const widget = desc.typeWidget;
    const rules = Array.isArray(desc.validation) ? desc.validation : [];

    if (this.isLectureSeule(desc)) {
      errors.push(`${code}: contrôle en lecture seule (${widget}) — configuration refusée`);
      return errors;
    }

    // Valeur principale selon cleConfig (ex. "cible", "designOptionNom", "parametres")
    const primary = this._primaryValue(controlCfg, desc);

    // Cohérence de type selon le widget (avant les règles déclarées)
    const typeErr = this._validateWidgetType(code, widget, primary, controlCfg, desc);
    if (typeErr) errors.push(typeErr);

    for (const rule of rules) {
      const msg = this._applyValidationRule(code, rule, primary, controlCfg, desc);
      if (msg) errors.push(msg);
    }

    return errors;
  }

  _primaryValue(controlCfg, desc) {
    const cle = desc.cleConfig;
    if (!cle || typeof cle !== 'string') return controlCfg;
    if (cle.includes('|')) return controlCfg;
    if (Object.prototype.hasOwnProperty.call(controlCfg, cle)) return controlCfg[cle];
    // Compat : certains lots historiques utilisent encore "cible" / "seuil"
    if (Object.prototype.hasOwnProperty.call(controlCfg, 'cible')) return controlCfg.cible;
    if (Object.prototype.hasOwnProperty.call(controlCfg, 'seuil')) return controlCfg.seuil;
    return undefined;
  }

  _validateWidgetType(code, widget, primary, controlCfg, desc) {
    switch (widget) {
      case 'menu':
        if (primary === undefined || primary === null || primary === '') return null; // vide = pas de cible
        if (typeof primary !== 'string' && typeof primary !== 'number') {
          return `${code}: typeWidget menu — valeur attendue texte/nombre (reçu ${typeof primary})`;
        }
        return null;
      case 'valeurNumerique':
        if (primary === undefined || primary === null || primary === '') return null;
        if (typeof primary === 'number' && Number.isFinite(primary)) return null;
        if (typeof primary === 'string' && primary.trim() !== '' && Number.isFinite(Number(primary))) return null;
        return `${code}: typeWidget valeurNumerique — nombre attendu (reçu ${JSON.stringify(primary)})`;
      case 'texte':
        if (primary === undefined || primary === null) return null;
        if (typeof primary !== 'string') {
          return `${code}: typeWidget texte — chaîne attendue`;
        }
        return null;
      case 'liste':
      case 'listeOrdonnee':
        if (primary === undefined || primary === null) return null;
        if (!Array.isArray(primary)) return `${code}: typeWidget ${widget} — tableau attendu`;
        return null;
      case 'listePrefixes':
        if (controlCfg.prefixes != null && !Array.isArray(controlCfg.prefixes)) {
          return `${code}: prefixes doit être un tableau`;
        }
        if (controlCfg.exceptions != null && !Array.isArray(controlCfg.exceptions)) {
          return `${code}: exceptions doit être un tableau`;
        }
        return null;
      case 'coordonnees': {
        if (primary === undefined || primary === null || primary === '') return null;
        if (typeof primary !== 'object' || Array.isArray(primary)) {
          return `${code}: typeWidget coordonnees — objet {ns, eo, elev, …} attendu`;
        }
        for (const k of ['ns', 'eo', 'elev']) {
          if (primary[k] === undefined || primary[k] === null || primary[k] === '') continue;
          if (!Number.isFinite(Number(primary[k]))) {
            return `${code}: coordonnée ${k} doit être numérique`;
          }
        }
        return null;
      }
      case 'angle': {
        if (primary === undefined || primary === null || primary === '') return null;
        const angle = typeof primary === 'object' ? primary.angle : primary;
        if (!Number.isFinite(Number(angle))) {
          return `${code}: typeWidget angle — angle numérique attendu`;
        }
        return null;
      }
      case 'recetteNommage': {
        const recette = controlCfg.recette;
        if (recette == null && (controlCfg.cible == null || controlCfg.cible === '')) return null;
        if (recette != null) {
          if (typeof recette !== 'object' || Array.isArray(recette)) {
            return `${code}: recette doit être un objet { champs, separateur?, extension? }`;
          }
          if (!Array.isArray(recette.champs)) {
            return `${code}: recette.champs doit être un tableau`;
          }
        }
        return null;
      }
      case 'table':
        if (primary === undefined || primary === null) return null;
        if (!Array.isArray(primary)) return `${code}: typeWidget table — tableau de lignes attendu`;
        return null;
      case 'parametreUniformat':
        return null; // structure riche ; validation déclarée vide au catalogue
      case 'regleMaisonLectureSeule':
        return null; // champEditable / champsAvances validés par les règles si présentes
      case 'indicatif':
        return `${code}: contrôle indicatif — pas de configuration`;
      default:
        return null;
    }
  }

  _applyValidationRule(code, rule, primary, controlCfg, desc) {
    // Valeur absente / vide : les règles de présence ne s'appliquent que si une valeur est fournie
    // (laisser vide = pas de cible / statut NULL côté scoring). Exception: nonVide quand une clé est présente.
    switch (rule) {
      case 'nombrePositif': {
        if (primary === undefined || primary === null || primary === '') return null;
        const n = typeof primary === 'number' ? primary : Number(primary);
        if (!Number.isFinite(n) || n <= 0) {
          return `${code}: validation nombrePositif — nombre strictement positif requis (reçu ${JSON.stringify(primary)})`;
        }
        return null;
      }
      case 'valeurDansListe': {
        if (primary === undefined || primary === null || primary === '') return null;
        const choix = Array.isArray(desc.choix) ? desc.choix : [];
        const allowed = choix.map((c) => (typeof c === 'object' && c != null ? String(c.valeur) : String(c)));
        if (!allowed.includes(String(primary))) {
          return `${code}: validation valeurDansListe — "${primary}" n'est pas dans [${allowed.join(', ')}]`;
        }
        return null;
      }
      case 'nonVide': {
        // Appliquer seulement si le contrôle envoie une clé principale renseignée « à tort » vide
        if (primary === undefined || primary === null) return null;
        if (typeof primary === 'string' && primary.trim() === '') {
          return `${code}: validation nonVide — valeur vide refusée`;
        }
        if (Array.isArray(primary) && primary.length === 0) {
          return `${code}: validation nonVide — liste vide refusée`;
        }
        if (desc.typeWidget === 'listePrefixes') {
          const prefixes = controlCfg.prefixes;
          if (Array.isArray(prefixes) && prefixes.length === 0) {
            return `${code}: validation nonVide — prefixes vide refusé`;
          }
        }
        return null;
      }
      case 'comparaisonStricte':
        // Contrainte de scoring (G103), pas de contrainte de forme sur la saisie ici
        return null;
      default:
        logger.warn(`[QC][Config] Règle de validation catalogue inconnue ignorée: ${rule} (${code})`);
        return null;
    }
  }

  /**
   * PUT/POST config — validation catalogue puis upsert merge sous projectId préfixé.
   *
   * Body attendu :
   *   { controles?: { [code]: object|null }, criticite?: object|null }
   * ou { config: { controles?, criticite? } }
   */
  async upsertProjectConfig(projectKey, body) {
    const resolved = await this.resolvePrefixedProjectId(projectKey);
    const payload = body?.config && typeof body.config === 'object' ? body.config : body || {};
    const incomingControles =
      payload.controles && typeof payload.controles === 'object' && !Array.isArray(payload.controles)
        ? payload.controles
        : null;
    const hasCriticite = Object.prototype.hasOwnProperty.call(payload, 'criticite');

    if (!incomingControles && !hasCriticite) {
      const err = new Error('Body invalide : fournir { controles } et/ou { criticite }');
      err.statusCode = 400;
      throw err;
    }

    const catalog = this.loadCatalog();
    const allErrors = [];

    if (incomingControles) {
      for (const [code, cfg] of Object.entries(incomingControles)) {
        const entry = catalog.controles[code];
        if (!entry) {
          allErrors.push(`${code}: code de contrôle inconnu du catalogue`);
          continue;
        }
        allErrors.push(...this.validateControlPayload(code, cfg, entry.descriptionCible));
      }
    }

    if (allErrors.length) {
      const err = new Error(`Configuration invalide : ${allErrors.join(' ; ')}`);
      err.statusCode = 400;
      err.errors = allErrors;
      throw err;
    }

    const { QCProjectConfig } = this.getModels();
    const existing = await QCProjectConfig.findOne({ where: { projectId: resolved.projectId } });
    const prev = existing?.config && typeof existing.config === 'object' ? existing.config : {};
    const mergedControles = {
      ...(prev.controles && typeof prev.controles === 'object' ? prev.controles : {}),
    };

    if (incomingControles) {
      for (const [code, cfg] of Object.entries(incomingControles)) {
        if (cfg === null || (typeof cfg === 'object' && !Array.isArray(cfg) && Object.keys(cfg).length === 0)) {
          delete mergedControles[code];
        } else {
          // Remplacement de l'objet controles[code] (pas de merge profond intra-contrôle)
          mergedControles[code] = cfg;
        }
      }
    }

    const nextConfig = {
      ...prev,
      controles: mergedControles,
    };
    if (hasCriticite) {
      nextConfig.criticite = payload.criticite;
    }

    // Upsert sous la clé PRÉFIXÉE — conflictFields projectId (même pattern que qc.projects)
    await QCProjectConfig.upsert(
      {
        projectId: resolved.projectId,
        config: nextConfig,
      },
      { conflictFields: ['projectId'] }
    );

    logger.info(
      `[QC][Config] Upsert project_config projectId=${resolved.projectId} controles=[${Object.keys(mergedControles).join(',')}]`
    );

    return this.getProjectConfig(resolved.projectId);
  }
}

module.exports = new QcProjectConfigService();
