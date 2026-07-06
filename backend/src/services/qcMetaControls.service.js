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
   * @param {object} meta - snapshot métadonnée du run (run.stats.meta) : { storageSize, fileName }
   * @returns {Array<object>} outcomes au même format que ceux de l'addin
   *          ({ controlCode, etatExtraction, valeurNum?, valeurJson?, erreur? })
   */
  computeMetaControls(meta) {
    const outcomes = [];

    // G102 — taille du fichier (storageSize de la version DM)
    try {
      const octets = meta?.storageSize;
      if (!Number.isFinite(octets)) {
        throw new Error('storageSize absent de la métadonnée DM capturée au lancement du run');
      }
      outcomes.push({
        controlCode: 'G102',
        etatExtraction: 'extrait',
        valeurNum: octets,
        valeurJson: { octets, mo: Math.round((octets / 1048576) * 10) / 10 },
      });
    } catch (e) {
      outcomes.push({ controlCode: 'G102', etatExtraction: 'echec', erreur: e.message });
      logger.warn(`[QC][Meta] G102 en échec d'extraction: ${e.message}`);
    }

    return outcomes;
  }
}

module.exports = new QcMetaControlsService();
