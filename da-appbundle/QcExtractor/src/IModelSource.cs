using System;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;

namespace QcExtractor
{
    /// <summary>
    /// Point d'acquisition UNIQUE du modèle Revit (décision Q3).
    ///
    /// Implémentation actuelle : ouverture cloud directe (CloudModelSource, régions US/EMEA).
    /// Prévu plus tard : une implémentation de repli "download puis ouverture d'une copie
    /// détachée" pour la région Canada — à brancher ICI, sans toucher la logique
    /// d'extraction G408 (G408Extractor) ni l'orchestration (QcExtractorApp).
    /// </summary>
    public interface IModelSource
    {
        Document OpenDocument(Application app, string region, Guid projectGuid, Guid modelGuid);
    }
}
