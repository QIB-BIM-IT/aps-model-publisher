using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G402 — variantes (design options) présentes dans le modèle.
    /// API vérifiée identique Revit 2024/2025 : FilteredElementCollector
    /// OfClass(DesignOption), propriété IsPrimary.
    ///
    /// COMPTEUR INDICATIF (documenté) : le jugement « variante superflue » reste
    /// humain — aucun verdict automatique de superfluité n'est rendu ici. Le scoreur
    /// de comptage ne s'applique que si le projet fournit une cible en config.
    /// </summary>
    public class G402DesignOptionsExtractor : IControlExtractor
    {
        public string ControlCode => "G402";

        public ControlOutcome Extract(Document doc)
        {
            List<object> variantes = new FilteredElementCollector(doc)
                .OfClass(typeof(DesignOption))
                .Cast<DesignOption>()
                .OrderBy(o => o.Name)
                .Select(o => (object)new { nom = o.Name, principale = o.IsPrimary })
                .ToList();

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = variantes.Count,
                ValeurJson = new { variantes },
            };
        }
    }
}
