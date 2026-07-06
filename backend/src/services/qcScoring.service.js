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
const LEVELS = ['critique', 'faible'];
const DEFAULT_LEVEL = 'faible';

class QcScoringService {
  constructor() {
    this._grid = null; // cache process (fichier versionné, invariant au runtime)
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
   * Charge la surcharge projet depuis qc.project_config.config.criticite.
   * Le projet est retrouvé via qc.projects (accProjectGuid → projectId DM).
   * Projet sans config → null (héritage complet de la grille maison).
   */
  async loadProjectOverride(accProjectGuid) {
    try {
      const { QCProject, QCProjectConfig } = require('../models/qc');
      if (!accProjectGuid) return null;
      const project = await QCProject.findOne({ where: { accProjectGuid } });
      if (!project) return null;
      const pc = await QCProjectConfig.findOne({ where: { projectId: project.projectId } });
      const crit = pc?.config?.criticite;
      return crit && typeof crit === 'object' ? crit : null;
    } catch (e) {
      logger.warn(`[QC][Scoring] Lecture surcharge projet échouée (non bloquant): ${e.message}`);
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
