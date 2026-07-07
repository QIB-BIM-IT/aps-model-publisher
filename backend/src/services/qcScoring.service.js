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
const LEVELS = ['critique', 'faible'];
const DEFAULT_LEVEL = 'faible';

class QcScoringService {
  constructor() {
    this._grid = null; // cache process (fichier versionné, invariant au runtime)
    this._catalog = null;
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
    const cible = controles?.[controlCode]?.cible;
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
        if (typeof outcome.valeurText !== 'string') return null;
        try {
          return new RegExp(String(cible)).test(outcome.valeurText) ? 'conforme' : 'non_conforme';
        } catch (e) {
          logger.warn(`[QC][Scoring] Pattern invalide en config pour ${controlCode}: ${e.message}`);
          return null;
        }
      }
      default:
        return null;
    }
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
