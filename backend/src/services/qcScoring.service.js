// src/services/qcScoring.service.js
// Chantier 2 — moteur de scoring de criticité des avertissements G408.
//
// Principes (spike SPIKE_WARNING_IDENTITY.md) :
//  - La clé de classification est le Guid de définition (FailureDefinitionId.Guid),
//    stable entre modèles et indépendant de la langue du moteur. Pas de normalisation
//    de texte : le Guid regroupe déjà.
//  - DEUX niveaux, libellés français définitifs stockés en base (décision assumée,
//    une couche de traduction viendra plus tard si besoin) :
//      'critique' = touche la performance ou l'intégrité (listé dans la grille)
//      'faible'   = tout le reste, et DÉFAUT pour tout Guid absent de la grille
//  - Résolution du niveau d'un avertissement, dans l'ordre :
//      1. surcharge projet (qc.project_config.config.criticite.guids[guid])
//      2. grille maison (config/qc-criticality-grid.json, versionnée dans le repo)
//      3. défaut: 'faible'
//    puis raffinement optionnel par pattern texte À L'INTÉRIEUR du Guid retenu
//    (surcharge projet prioritaire sur la grille pour les raffinements aussi).
//  - Seuils de volume (projet sinon grille) → statut du contrôle :
//      'non_conforme' si critiques > criticalMax OU total > totalMax, sinon 'conforme'.
//  - Extraction toujours, scoring seulement si une grille est disponible : la grille
//    maison est livrée avec le code, donc toujours présente ; si sa lecture échoue,
//    on logge et on n'altère PAS le résultat d'extraction (comportement tranche 1).

const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');

const GRID_PATH = path.join(__dirname, '..', '..', 'config', 'qc-criticality-grid.json');
const CATALOG_PATH = path.join(__dirname, '..', '..', 'config', 'qc-controls-catalog.json');
const UNIFORMAT_NORM_PATH = path.join(__dirname, '..', '..', 'config', 'qc-uniformat-norm.json');
const COPY_MONITOR_NORM_PATH = path.join(__dirname, '..', '..', 'config', 'qc-copy-monitor-norm.json');
const LEVEL_ATTACHMENT_NORM_PATH = path.join(__dirname, '..', '..', 'config', 'qc-level-attachment-norm.json');
const LEVELS = ['critique', 'faible'];
const DEFAULT_LEVEL = 'faible';

class QcScoringService {
  constructor() {
    this._grid = null; // cache process (fichier versionné, invariant au runtime)
    this._catalog = null;
    this._uniformatNorm = null;
    this._copyMonitorNorm = null;
    this._levelAttachmentNorm = null;
  }

  // ======== Catalogue des contrôles (chantier 3) ========

  loadCatalog() {
    if (this._catalog) return this._catalog;
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    if (!raw || typeof raw.controles !== 'object') {
      throw new Error(`Catalogue des contrôles invalide: ${CATALOG_PATH}`);
    }
    this._catalog = raw;
    return raw;
  }

  catalogEntry(controlCode) {
    return this.loadCatalog().controles?.[controlCode] || null;
  }

  // ======== Norme UNIFORMAT (G504) — fichier versionné + surcharge projet ========

  /** Charge la norme UNIFORMAT (cache process). Lance si illisible. */
  loadUniformatNorm() {
    if (this._uniformatNorm) return this._uniformatNorm;
    const raw = JSON.parse(fs.readFileSync(UNIFORMAT_NORM_PATH, 'utf8'));
    if (!raw || typeof raw.parametreDefaut !== 'object' || !Array.isArray(raw.categories)) {
      throw new Error(`Norme UNIFORMAT invalide: ${UNIFORMAT_NORM_PATH}`);
    }
    this._uniformatNorm = raw;
    return raw;
  }

  /**
   * Normalise une désignation de paramètre G504 en { kind, valeur } :
   *  - chaîne  => paramètre partagé maison lu par NOM ({ kind: 'partage' })
   *  - objet   => { kind: 'builtin'|'partage', valeur } explicite
   * Toute forme invalide => null (l'appelant retombe sur le défaut de la norme).
   */
  _normalizeUniformatParam(p) {
    if (typeof p === 'string' && p.trim()) return { kind: 'partage', valeur: p.trim() };
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const kind = p.kind === 'builtin' ? 'builtin' : p.kind === 'partage' ? 'partage' : null;
      const valeur = typeof p.valeur === 'string' ? p.valeur.trim() : '';
      if (kind && valeur) return { kind, valeur };
    }
    return null;
  }

  /**
   * Construit la config EFFECTIVE de G504 (norme maison versionnée + surcharge projet),
   * telle qu'envoyée à l'addin via params.json. AUCUN accès base ici — `controles` est
   * déjà la section qc.project_config.config.controles (ou null).
   *
   * @param {object|null} controles - qc.project_config.config.controles
   * @returns {{ parametre: {kind:string, valeur:string}, categories: string[] }}
   */
  resolveUniformatConfig(controles) {
    const norm = this.loadUniformatNorm();
    const cfg = controles?.G504 || {};

    const parametre =
      this._normalizeUniformatParam(cfg.parametre) ||
      this._normalizeUniformatParam(norm.parametreDefaut) || { kind: 'builtin', valeur: 'UNIFORMAT_CODE' };

    let categories;
    if (Array.isArray(cfg.categories)) {
      // Remplacement explicite par le projet (liste de BuiltInCategory)
      categories = cfg.categories.map(String);
    } else {
      const inclureOptionnelles = cfg.inclureOptionnelles !== false; // défaut: inclure
      const desactivees = new Set((Array.isArray(cfg.categoriesDesactivees) ? cfg.categoriesDesactivees : []).map(String));
      categories = norm.categories
        .filter((c) => (inclureOptionnelles ? true : !c.optionnelle))
        .map((c) => String(c.bic))
        .filter((bic) => !desactivees.has(bic));
    }

    return { parametre, categories };
  }

  // ======== Config G508 (taux de remplissage) — PROJET uniquement ========

  /**
   * Construit la config EFFECTIVE de G508 telle qu'envoyée à l'addin via params.json.
   * La liste des paramètres vit EXCLUSIVEMENT dans qc.project_config (variable par projet,
   * PAS de norme maison). Structure régulière (nom / categories / seuil) pensée pour un
   * futur formulaire web. Retourne null si aucun paramètre n'est configuré (comportement
   * par défaut : rien à mesurer, statut NULL).
   *
   * `categoriesDesignDefaut` (les catégories de design de la norme G504) est joint pour
   * qu'un paramètre au périmètre vide signifie « toutes les catégories de design ».
   *
   * @param {object|null} controles - qc.project_config.config.controles
   * @returns {{ parametres: Array<{nom:string, categories:string[], seuil:number}>, categoriesDesignDefaut: string[] } | null}
   */
  resolveG508Config(controles) {
    const g = controles?.G508;
    if (!g || !Array.isArray(g.parametres) || g.parametres.length === 0) return null;

    const parametres = g.parametres
      .filter((p) => p && typeof p.nom === 'string' && p.nom.trim())
      .map((p) => ({
        nom: p.nom.trim(),
        categories: Array.isArray(p.categories) ? p.categories.map(String) : [],
        seuil: Number.isFinite(p.seuil) ? Number(p.seuil) : 100,
      }));

    if (parametres.length === 0) return null;

    let categoriesDesignDefaut = [];
    try {
      categoriesDesignDefaut = this.loadUniformatNorm().categories.map((c) => String(c.bic));
    } catch (_) {
      categoriesDesignDefaut = [];
    }

    return { parametres, categoriesDesignDefaut };
  }

  // ======== Config G210 (copie-contrôle) — norme maison + surcharge projet ========

  /**
   * Charge la norme maison G210 (niveaux techniques exclus par défaut).
   * @returns {{ niveauxExclus: string[] }}
   */
  loadCopyMonitorNorm() {
    if (this._copyMonitorNorm) return this._copyMonitorNorm;
    const raw = JSON.parse(fs.readFileSync(COPY_MONITOR_NORM_PATH, 'utf8'));
    if (!raw || !Array.isArray(raw.niveauxExclus)) {
      throw new Error(`Norme copie-contrôle invalide: ${COPY_MONITOR_NORM_PATH}`);
    }
    this._copyMonitorNorm = raw;
    return raw;
  }

  /**
   * Config EFFECTIVE G210 envoyée à l'addin : défaut maison + surcharge projet
   * (qc.project_config.config.controles.G210.niveauxExclus). Si le projet fournit
   * une liste (même vide), elle remplace le défaut ; sinon le défaut maison s'applique.
   *
   * @param {object|null} controles
   * @returns {{ niveauxExclus: string[] }}
   */
  resolveG210Config(controles) {
    let niveauxExclus;
    try {
      niveauxExclus = this.loadCopyMonitorNorm().niveauxExclus.map(String);
    } catch (_) {
      niveauxExclus = ['PLAN DE LIAISON'];
    }
    const g = controles?.G210;
    if (g && Array.isArray(g.niveauxExclus)) {
      niveauxExclus = g.niveauxExclus.map(String);
    }
    return { niveauxExclus };
  }

  // ======== Config G314 (rattachement au niveau) — norme + surcharge projet ========

  loadLevelAttachmentNorm() {
    if (this._levelAttachmentNorm) return this._levelAttachmentNorm;
    const raw = JSON.parse(fs.readFileSync(LEVEL_ATTACHMENT_NORM_PATH, 'utf8'));
    if (!raw || !raw.categories || !Array.isArray(raw.categories.mep) || !Array.isArray(raw.categories.structure)) {
      throw new Error(`Norme rattachement niveau invalide: ${LEVEL_ATTACHMENT_NORM_PATH}`);
    }
    this._levelAttachmentNorm = raw;
    return raw;
  }

  /**
   * Config EFFECTIVE G314 : tolérance + catégories MEP/structure.
   * Surcharge projet : controles.G314.{toleranceMm, categories} (categories = liste plate
   * qui remplace mep+structure, ou {mep, structure}).
   */
  resolveG314Config(controles) {
    let toleranceMm = 50;
    let categoriesMep = [];
    let categoriesStructure = [];
    try {
      const norm = this.loadLevelAttachmentNorm();
      toleranceMm = Number.isFinite(norm.toleranceMm) ? Number(norm.toleranceMm) : 50;
      categoriesMep = norm.categories.mep.map(String);
      categoriesStructure = norm.categories.structure.map(String);
    } catch (_) { /* défauts ci-dessus */ }

    const g = controles?.G314;
    if (g) {
      if (Number.isFinite(g.toleranceMm)) toleranceMm = Number(g.toleranceMm);
      if (Array.isArray(g.categories)) {
        // Liste plate : tout en MEP pour l'audit (ventilation structure vide)
        categoriesMep = g.categories.map(String);
        categoriesStructure = [];
      } else if (g.categories && typeof g.categories === 'object') {
        if (Array.isArray(g.categories.mep)) categoriesMep = g.categories.mep.map(String);
        if (Array.isArray(g.categories.structure)) categoriesStructure = g.categories.structure.map(String);
      }
    }
    return { toleranceMm, categoriesMep, categoriesStructure };
  }

  // ======== Grille maison ========

  /** Charge la grille maison (cache). Lance si illisible — l'appelant décide du repli. */
  loadGrid() {
    if (this._grid) return this._grid;
    const raw = JSON.parse(fs.readFileSync(GRID_PATH, 'utf8'));
    if (!raw || typeof raw.guids !== 'object' || typeof raw.seuils !== 'object') {
      throw new Error(`Grille de criticité invalide: ${GRID_PATH}`);
    }
    this._grid = raw;
    return raw;
  }

  isGridAvailable() {
    try {
      this.loadGrid();
      return true;
    } catch (e) {
      logger.warn(`[QC][Scoring] Grille indisponible (${e.message}) — scoring sauté, extraction conservée`);
      return false;
    }
  }

  // ======== Surcharge projet ========

  /**
   * Charge la config projet complète depuis qc.project_config.config :
   * { criticite: surcharge de la grille G408, controles: cibles des autres contrôles }.
   * Le projet est retrouvé via qc.projects (accProjectGuid → projectId DM).
   * Projet sans config → { criticite: null, controles: null }.
   */
  async loadProjectConfig(accProjectGuid) {
    const empty = { criticite: null, controles: null };
    try {
      const { QCProject, QCProjectConfig } = require('../models/qc');
      if (!accProjectGuid) return empty;
      const project = await QCProject.findOne({ where: { accProjectGuid } });
      if (!project) return empty;
      const pc = await QCProjectConfig.findOne({ where: { projectId: project.projectId } });
      const cfg = pc?.config || {};
      return {
        criticite: cfg.criticite && typeof cfg.criticite === 'object' ? cfg.criticite : null,
        controles: cfg.controles && typeof cfg.controles === 'object' ? cfg.controles : null,
      };
    } catch (e) {
      logger.warn(`[QC][Scoring] Lecture config projet échouée (non bloquant): ${e.message}`);
      return empty;
    }
  }

  /** Compat : surcharge criticité seule (chemin G408 historique). */
  async loadProjectOverride(accProjectGuid) {
    return (await this.loadProjectConfig(accProjectGuid)).criticite;
  }

  // ======== Scoreurs par forme (chantier 3) ========

  /**
   * Score un contrôle non-G408 selon la forme du catalogue et la cible projet.
   * AUCUN seuil maison : la cible vient EXCLUSIVEMENT de la config projet.
   * Pas de cible → statut null (valeur relevée, pas de verdict).
   * NE DOIT JAMAIS être appelé sur un échec d'extraction (règle des deux axes,
   * garantie par l'appelant).
   *
   * @param {string} controlCode
   * @param {{valeurNum?: number, valeurJson?: object}} outcome
   * @param {object|null} controles - qc.project_config.config.controles
   * @returns {string|null} 'conforme' | 'non_conforme' | null
   */
  scoreByForme(controlCode, outcome, controles) {
    const entry = this.catalogEntry(controlCode);
    if (!entry) return null;

    // Lot G508 (remplissage) : la porte n'est PAS une 'cible' mais la présence d'une
    // liste de paramètres (par projet). Le verdict est PAR PARAMÈTRE : conforme SEULEMENT
    // si CHAQUE paramètre atteint son seuil (calculé dans l'addin, champ conforme).
    // non_conforme si au moins un paramètre est sous son seuil ou absent. Aucune liste
    // de paramètres (aucunParametre) => statut NULL (rien à mesurer).
    if (entry.forme === 'remplissage') {
      const j = outcome.valeurJson;
      if (!j || j.aucunParametre || !Array.isArray(j.parametres) || j.parametres.length === 0) return null;
      return j.parametres.every((p) => p && p.conforme === true) ? 'conforme' : 'non_conforme';
    }

    // Lot G210 (copieControle) : norme maison STRICTE 100 % — pas de cible requise.
    // conforme SEULEMENT si TOUS les axes et TOUS les niveaux SOUMIS À AUDIT sont
    // monitorés (0 fautif). Les niveaux exclus n'entrent pas dans le calcul.
    // Vacuité (aucun élément soumis à audit) => statut NULL (drapeau vacuite).
    if (entry.forme === 'copieControle') {
      const j = outcome.valeurJson;
      if (!j || j.vacuite === true) return null;
      const soumis = j.global?.soumisAudit;
      if (!Number.isFinite(soumis) || soumis <= 0) return null;
      const fautifs = j.global?.nonMonitoresFautifs;
      if (Number.isFinite(fautifs)) return fautifs === 0 ? 'conforme' : 'non_conforme';
      if (!Number.isFinite(num)) return null;
      return num >= 100 ? 'conforme' : 'non_conforme';
    }

    const cible = controles?.[controlCode]?.cible ?? controles?.[controlCode]?.seuil;
    if (cible === undefined || cible === null) return null;

    const sens = entry.sens || 'max';
    const num = outcome.valeurNum;

    switch (entry.forme) {
      case 'seuil':
      case 'comptage':
      case 'pourcentage': {
        if (!Number.isFinite(num)) return null;
        const ok = sens === 'min' ? num >= Number(cible) : num <= Number(cible);
        return ok ? 'conforme' : 'non_conforme';
      }
      case 'presence': {
        if (!Array.isArray(cible)) return null;
        const champ = entry.champListe || 'parametres';
        const presents = Array.isArray(outcome.valeurJson?.[champ]) ? outcome.valeurJson[champ] : [];
        const lower = new Set(presents.map((p) => String(p).toLowerCase()));
        return cible.every((c) => lower.has(String(c).toLowerCase())) ? 'conforme' : 'non_conforme';
      }
      case 'liste': {
        // Déclaré pour les lots futurs : égalité d'ensembles attendu/relevé
        if (!Array.isArray(cible)) return null;
        const champ = entry.champListe || 'liste';
        const presents = Array.isArray(outcome.valeurJson?.[champ]) ? outcome.valeurJson[champ] : [];
        const a = new Set(cible.map((x) => String(x).toLowerCase()));
        const b = new Set(presents.map((x) => String(x).toLowerCase()));
        return a.size === b.size && [...a].every((x) => b.has(x)) ? 'conforme' : 'non_conforme';
      }
      case 'sequence': {
        // Lot 2 (G407) : l'ordre réel doit respecter une séquence de référence.
        // RÈGLE RETENUE (documentée) : la cible doit apparaître comme SOUS-SÉQUENCE
        // ORDONNÉE de la liste réelle — l'ordre relatif des éléments attendus est
        // exigé, mais des éléments supplémentaires peuvent s'intercaler (un modèle
        // peut avoir des phases en plus sans violer l'ordre de référence). Un élément
        // attendu ABSENT ou dans le mauvais ordre => non_conforme. Comparaison
        // insensible à la casse, espaces bord tronqués.
        if (!Array.isArray(cible) || cible.length === 0) return null;
        const champ = entry.champListe || 'liste';
        const reels = Array.isArray(outcome.valeurJson?.[champ]) ? outcome.valeurJson[champ] : [];
        const norm = (x) => String(x).trim().toLowerCase();
        const reelsNorm = reels.map(norm);
        let i = 0;
        for (const attendu of cible.map(norm)) {
          const pos = reelsNorm.indexOf(attendu, i);
          if (pos === -1) return 'non_conforme';
          i = pos + 1;
        }
        return 'conforme';
      }
      case 'egalite': {
        // Lot 1 (G101) : conforme si la valeur relevée est STRICTEMENT égale à la
        // cible (comparaison en texte : détecte un écart de version, dans les deux sens
        // — un seuil laisserait passer les versions antérieures).
        const releve = outcome.valeurText ?? (Number.isFinite(num) ? String(num) : null);
        if (releve === null) return null;
        return String(releve).trim() === String(cible).trim() ? 'conforme' : 'non_conforme';
      }
      case 'pattern': {
        // Lot 1 (G103) : conforme si valeur_text matche la regex cible (convention de
        // nommage). Regex invalide en config => statut NULL + warn (pas de faux verdict).
        // Forme RÉSERVÉE à G103 (cible chaîne) — les listes de noms passent par 'nommage'.
        if (typeof outcome.valeurText !== 'string') return null;
        try {
          return new RegExp(String(cible)).test(outcome.valeurText) ? 'conforme' : 'non_conforme';
        } catch (e) {
          logger.warn(`[QC][Scoring] Pattern invalide en config pour ${controlCode}: ${e.message}`);
          return null;
        }
      }
      case 'nommage': {
        // Lot NOMMAGE (G404/G203/G205) : valide la LISTE de noms relevée contre la
        // convention décrite en config (cible OBJET). Conforme si TOUS les noms
        // passent. Le détail des fautifs (nomsNonConformes) est réinjecté dans
        // valeur_json par la finalisation via evaluerNommage (option A validée).
        const champ = entry.champListe || 'noms';
        const noms = Array.isArray(outcome.valeurJson?.[champ]) ? outcome.valeurJson[champ] : [];
        const { statut } = this.evaluerNommage(noms, cible, controlCode);
        return statut;
      }
      case 'angle': {
        // Lot COORDONNÉES (G202) : conforme si l'angle relevé (valeur_num, en degrés) est à
        // moins d'une tolérance ANGULAIRE de l'angle attendu, wrap-around géré (359° et 1°
        // sont distants de 2°). Cible OBJET { angle, tolerance } en degrés. Cible malformée
        // => statut NULL (jamais de faux verdict), aligné sur 'pattern'/'nommage'.
        if (!cible || typeof cible !== 'object' || Array.isArray(cible)) {
          logger.warn(`[QC][Scoring] Cible angle malformée pour ${controlCode} (objet {angle,tolerance} attendu) — statut NULL`);
          return null;
        }
        const attendu = Number(cible.angle);
        const tol = Number(cible.tolerance);
        if (!Number.isFinite(attendu) || !Number.isFinite(tol) || !Number.isFinite(num)) {
          logger.warn(`[QC][Scoring] Cible angle incomplète pour ${controlCode} (angle/tolerance numériques attendus) — statut NULL`);
          return null;
        }
        return this.angularDistanceDeg(num, attendu) <= tol ? 'conforme' : 'non_conforme';
      }
      case 'coordonnees': {
        // Lot COORDONNÉES (G201) : conforme si CHAQUE composante (ns, eo, elev) du point relevé
        // est à moins d'une tolérance en distance de la valeur attendue. Le détail (axe fautif)
        // est réinjecté dans valeur_json par la finalisation via evaluerCoordonnees (option A,
        // comme 'nommage') — ici on ne renvoie que le statut.
        const champ = entry.champObjet || 'coordonnees';
        const releve = outcome.valeurJson?.[champ];
        const { statut } = this.evaluerCoordonnees(releve, cible, controlCode);
        return statut;
      }
      case 'couverture': {
        // Lot G504 (couverture UNIFORMAT) : PORTE DE LIVRAISON à 100 %, AUCUNE tolérance.
        // valeur_num = pourcentage de couverture relevé (types OU instances, selon la
        // nature détectée par l'extracteur). conforme SEULEMENT si couverture == 100 %
        // (aucune entité de design sans code) ; non_conforme dès qu'il en manque une —
        // paramètre absent inclus (l'extracteur rapporte alors 0 %, drapeau parametreAbsent).
        // La cible en config ne fait qu'ACTIVER la porte (présence => verdict) ; le seuil
        // reste 100 % quelle que soit sa valeur (pas de desserrage possible). Sans cible :
        // le garde en tête de méthode a déjà renvoyé null (extraction conservée, pas de verdict).
        if (!Number.isFinite(num)) return null;
        return num >= 100 ? 'conforme' : 'non_conforme';
      }
      default:
        return null;
    }
  }

  /**
   * Forme 'nommage' — méthode PURE (aucune écriture, aucun effet de bord), réutilisable.
   * Valide une liste de noms contre une convention en config, éditable par un
   * non-développeur. Cible (OBJET) :
   *   { type: 'prefixe',  valeur: 'TT-' }
   *   { type: 'segments', separateur: '-', nbMin: 3, nbMax: 5 }   (nbMax optionnel)
   *   { type: 'regex',    motif: '^AX-[0-9]{2}$' }                (RegExp JavaScript, réservé développeur)
   * Options communes : ignoreCasse (bool, défaut false — les conventions sont sensibles
   * à la casse par défaut), exceptions (noms exacts exemptés, ex. « Niveaux et
   * quadrillages partagés » pour G404).
   * Règles validées : liste vide => conforme (vacuité) ; segment vide => non conforme.
   * Cible malformée, type inconnu ou regex invalide => statut NULL + warn (jamais de
   * faux verdict), aligné sur la forme 'pattern'.
   *
   * @param {string[]} noms
   * @param {object} cible - config.controles[code].cible
   * @param {string} [controlCode] - pour les logs uniquement
   * @returns {{statut: string|null, nomsNonConformes: string[]}}
   */
  evaluerNommage(noms, cible, controlCode = '?') {
    const aucun = { statut: null, nomsNonConformes: [] };
    if (!cible || typeof cible !== 'object' || Array.isArray(cible)) {
      logger.warn(`[QC][Scoring] Cible nommage malformée pour ${controlCode} (objet attendu) — statut NULL`);
      return aucun;
    }

    const ignoreCasse = cible.ignoreCasse === true;
    const norm = (x) => (ignoreCasse ? String(x).toLowerCase() : String(x));
    const exceptions = new Set((Array.isArray(cible.exceptions) ? cible.exceptions : []).map(norm));

    let estConforme;
    switch (cible.type) {
      case 'prefixe': {
        if (typeof cible.valeur !== 'string' || !cible.valeur.length) {
          logger.warn(`[QC][Scoring] Cible nommage/prefixe sans 'valeur' pour ${controlCode} — statut NULL`);
          return aucun;
        }
        const prefixe = norm(cible.valeur);
        estConforme = (nom) => norm(nom.trim()).startsWith(prefixe);
        break;
      }
      case 'segments': {
        const sep = cible.separateur;
        const nbMin = Number.isFinite(cible.nbMin) ? cible.nbMin : 1;
        const nbMax = Number.isFinite(cible.nbMax) ? cible.nbMax : Infinity;
        if (typeof sep !== 'string' || !sep.length) {
          logger.warn(`[QC][Scoring] Cible nommage/segments sans 'separateur' pour ${controlCode} — statut NULL`);
          return aucun;
        }
        estConforme = (nom) => {
          const segments = nom.trim().split(sep);
          // Décision validée : un segment vide (« A--B », séparateur en bord) est non conforme
          if (segments.some((s) => s.length === 0)) return false;
          return segments.length >= nbMin && segments.length <= nbMax;
        };
        break;
      }
      case 'regex': {
        if (typeof cible.motif !== 'string' || !cible.motif.length) {
          logger.warn(`[QC][Scoring] Cible nommage/regex sans 'motif' pour ${controlCode} — statut NULL`);
          return aucun;
        }
        let re;
        try {
          re = new RegExp(cible.motif, ignoreCasse ? 'i' : '');
        } catch (e) {
          logger.warn(`[QC][Scoring] Motif regex invalide en config pour ${controlCode}: ${e.message} — statut NULL`);
          return aucun;
        }
        estConforme = (nom) => re.test(nom.trim());
        break;
      }
      default:
        logger.warn(`[QC][Scoring] Type de nommage inconnu "${cible.type}" pour ${controlCode} — statut NULL`);
        return aucun;
    }

    const nomsNonConformes = [];
    for (const nom of noms.map(String)) {
      if (exceptions.has(norm(nom.trim()))) continue;
      if (!estConforme(nom)) nomsNonConformes.push(nom);
    }
    // Liste vide (aucun nom, ou tous exemptés) => conforme par vacuité (décision validée)
    return { statut: nomsNonConformes.length ? 'non_conforme' : 'conforme', nomsNonConformes };
  }

  /**
   * Distance ANGULAIRE minimale entre deux angles en degrés, wrap-around géré :
   * angularDistanceDeg(359, 1) === 2 (et non 358). Résultat dans [0, 180].
   */
  angularDistanceDeg(a, b) {
    let d = Math.abs(Number(a) - Number(b)) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  /**
   * Forme 'coordonnees' — méthode PURE (aucune écriture, aucun effet de bord), réutilisable.
   * Compare les 3 composantes d'un point relevé { ns, eo, elev } (mètres) à une cible avec
   * tolérance en distance, et IDENTIFIE l'axe fautif. Cible (OBJET), éditable par un
   * non-développeur :
   *   { ns: <attendu>, eo: <attendu>, elev: <attendu>, tolerance: <mètres> }
   * Tolérance par axe optionnelle (surcharge la globale) : toleranceNs / toleranceEo /
   * toleranceElev. Conforme si CHAQUE axe est à |relevé - attendu| ≤ tolérance de l'axe.
   * Relevé manquant, cible malformée ou incomplète (une composante ou tolérance non
   * numérique) => statut NULL + warn (jamais de faux verdict), aligné sur 'nommage'.
   *
   * @param {object} releve - { ns, eo, elev } en mètres (valeur_json[champObjet] de l'extracteur)
   * @param {object} cible  - config.controles[code].cible
   * @param {string} [controlCode] - pour les logs uniquement
   * @returns {{statut: string|null, axes: object[], axesHorsTolerance: string[]}}
   */
  evaluerCoordonnees(releve, cible, controlCode = '?') {
    const aucun = { statut: null, axes: [], axesHorsTolerance: [] };
    if (!releve || typeof releve !== 'object' || Array.isArray(releve)) {
      logger.warn(`[QC][Scoring] Relevé coordonnees absent/malformé pour ${controlCode} — statut NULL`);
      return aucun;
    }
    if (!cible || typeof cible !== 'object' || Array.isArray(cible)) {
      logger.warn(`[QC][Scoring] Cible coordonnees malformée pour ${controlCode} (objet {ns,eo,elev,tolerance} attendu) — statut NULL`);
      return aucun;
    }

    const tolGlobale = Number(cible.tolerance);
    const definitions = [
      { axe: 'ns', tolKey: 'toleranceNs' },
      { axe: 'eo', tolKey: 'toleranceEo' },
      { axe: 'elev', tolKey: 'toleranceElev' },
    ];

    const axes = [];
    const axesHorsTolerance = [];
    for (const { axe, tolKey } of definitions) {
      const attendu = Number(cible[axe]);
      const val = Number(releve[axe]);
      const tol = Number.isFinite(Number(cible[tolKey])) ? Number(cible[tolKey]) : tolGlobale;
      if (!Number.isFinite(attendu) || !Number.isFinite(val) || !Number.isFinite(tol)) {
        logger.warn(`[QC][Scoring] Cible/relevé coordonnees incomplet pour ${controlCode} (axe ${axe}) — statut NULL`);
        return aucun;
      }
      const ecart = Math.abs(val - attendu);
      const ok = ecart <= tol;
      axes.push({ axe, attendu, releve: val, ecart, tolerance: tol, ok });
      if (!ok) axesHorsTolerance.push(axe);
    }

    return { statut: axesHorsTolerance.length ? 'non_conforme' : 'conforme', axes, axesHorsTolerance };
  }

  // ======== Résolution du niveau d'un avertissement ========

  /**
   * @param {string|null} guid  - Guid de définition de l'avertissement
   * @param {string} text       - texte descriptif (pour le raffinement optionnel)
   * @param {object} grid       - grille maison chargée
   * @param {object|null} override - surcharge projet ({guids, seuils}) ou null
   * @returns {string} 'critique' | 'faible'
   */
  resolveLevel(guid, text, grid, override) {
    const key = String(guid || '').toLowerCase();
    // Surcharge projet prioritaire, sinon grille maison, sinon défaut
    const entry = override?.guids?.[key] ?? grid.guids?.[key] ?? null;
    if (!entry) return DEFAULT_LEVEL;

    let level = LEVELS.includes(entry.niveau) ? entry.niveau : DEFAULT_LEVEL;

    // Raffinement optionnel par pattern texte à l'intérieur du Guid (premier match gagne)
    const raffinements = Array.isArray(entry.raffinements) ? entry.raffinements : [];
    for (const r of raffinements) {
      if (!r?.pattern) continue;
      if (String(text || '').toLowerCase().includes(String(r.pattern).toLowerCase())) {
        if (LEVELS.includes(r.niveau)) level = r.niveau;
        break;
      }
    }
    return level;
  }

  /** Seuils effectifs : surcharge projet champ par champ, sinon grille maison. */
  resolveThresholds(grid, override) {
    return {
      totalMax: Number.isFinite(override?.seuils?.totalMax) ? override.seuils.totalMax : grid.seuils.totalMax,
      criticalMax: Number.isFinite(override?.seuils?.criticalMax) ? override.seuils.criticalMax : grid.seuils.criticalMax,
    };
  }

  // ======== Scoring d'un run ========

  /**
   * Score les avertissements d'un run : calcule le niveau de chacun, les comptes par
   * niveau et le statut selon les seuils. PURE (aucune écriture) — l'écriture reste
   * dans la transaction de finalisation du run (qcRun.service).
   *
   * @param {Array<{failureDefinitionId?: string, description: string}>} warnings - entrées du result.json
   * @param {object|null} override - surcharge projet
   * @returns {{ levels: string[], counts: {critique:number, faible:number},
   *             critical: number, statut: string, thresholds: object }}
   */
  scoreWarnings(warnings, override) {
    const grid = this.loadGrid();
    const counts = { critique: 0, faible: 0 };
    const levels = warnings.map((w) => {
      const level = this.resolveLevel(w.failureDefinitionId, w.description, grid, override);
      counts[level]++;
      return level;
    });
    const thresholds = this.resolveThresholds(grid, override);
    const critical = counts.critique;
    const total = warnings.length;
    const statut = critical > thresholds.criticalMax || total > thresholds.totalMax ? 'non_conforme' : 'conforme';
    return { levels, counts, critical, statut, thresholds };
  }
}

module.exports = new QcScoringService();
