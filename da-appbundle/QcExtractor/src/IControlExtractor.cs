using Autodesk.Revit.DB;

namespace QcExtractor
{
    /// <summary>
    /// Contrat d'un extracteur de contrôle MODÈLE (chantier 3).
    /// Chaque extracteur est exécuté dans son propre try par ControlRunner :
    /// une exception produit une ligne etat_extraction='echec' et n'affecte
    /// jamais les autres contrôles.
    /// </summary>
    public interface IControlExtractor
    {
        string ControlCode { get; }
        ControlOutcome Extract(Document doc);
    }
}
