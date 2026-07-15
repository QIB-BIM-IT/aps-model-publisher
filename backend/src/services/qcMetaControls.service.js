// src/services/qcMetaControls.service.js
// Chantier 3 — contrôles MÉTA : calculés dans le backend à partir de la métadonnée
// Data Management DÉJÀ lue par le resolver (aucun workitem DA, aucun appel APS
// supplémentaire). Chaque calcul tourne dans son propre try : un échec produit une
// ligne etat 'echec' isolée, comme côté addin.
//
// AMENDEMENT chantier 3 : les valeurs sont calculées tôt (métadonnée capturée au
// startRun dans run.stats.meta) mais les lignes sont persistées avec celles du
// MODÈLE, dans la MÊME transaction de finalisation — un run échoué n'a AUCUNE ligne.

const logger = require('../config/logger');

class QcMetaControlsService {
  /**
   * @param {object} meta - snapshot métadonnée du run (run.stats.meta) :
   *                        { storageSize, revitVersion, fileName }
   * @returns {Array<object>} outcomes au même format que ceux de l'addin
   *          ({ controlCode, etatExtraction, valeurNum?, valeurText?, valeurJson?, erreur? })
   */
  computeMetaControls(meta) {
    const outcomes = [];

    // G101 — version du logiciel (revitProjectVersion résolue par le resolver).
    // Sert à détecter un écart entre version PEB attendue (cible projet) et version
    // réelle — pas seulement à l'afficher. Sans cible : statut NULL (relevé).
    try {
      const version = meta?.revitVersion;
      if (!version) {
        throw new Error('revitVersion absente de la métadonnée capturée au lancement du run');
      }
      outcomes.push({
        controlCode: 'G101',
        etatExtraction: 'extrait',
        valeurNum: Number(version),
        valeurText: String(version),
      });
    } catch (e) {
      outcomes.push({ controlCode: 'G101', etatExtraction: 'echec', erreur: e.message });
      logger.warn(`[QC][Meta] G101 en échec d'extraction: ${e.message}`);
    }

    // G102 — taille du fichier en MÉGAOCTETS binaires (1 Mo = 1 048 576 octets).
    // Octets bruts conservés dans valeur_json pour audit ; valeur_num + cible = Mo.
    try {
      const octets = meta?.storageSize;
      if (!Number.isFinite(octets)) {
        throw new Error('storageSize absent de la métadonnée DM capturée au lancement du run');
      }
      const mo = Math.round((octets / 1048576) * 100) / 100;
      outcomes.push({
        controlCode: 'G102',
        etatExtraction: 'extrait',
        valeurNum: mo,
        valeurJson: { octets, mo, unite: 'Mo', facteur: 1048576 },
      });
    } catch (e) {
      outcomes.push({ controlCode: 'G102', etatExtraction: 'echec', erreur: e.message });
      logger.warn(`[QC][Meta] G102 en échec d'extraction: ${e.message}`);
    }

    // G103 — nom du fichier (attribut DM). Conformité à la convention de nommage via
    // pattern en config projet (forme 'pattern') ; sans cible : statut NULL.
    try {
      const nom = meta?.fileName;
      if (!nom) {
        throw new Error('fileName absent de la métadonnée capturée au lancement du run');
      }
      outcomes.push({
        controlCode: 'G103',
        etatExtraction: 'extrait',
        valeurText: String(nom),
      });
    } catch (e) {
      outcomes.push({ controlCode: 'G103', etatExtraction: 'echec', erreur: e.message });
      logger.warn(`[QC][Meta] G103 en échec d'extraction: ${e.message}`);
    }

    return outcomes;
  }
}

module.exports = new QcMetaControlsService();
