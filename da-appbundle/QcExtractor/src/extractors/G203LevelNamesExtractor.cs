using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G203 — niveaux (noms).
    /// API vérifiée identique Revit 2024/2025 : FilteredElementCollector
    /// OfClass(Level) → Element.Name. Document courant uniquement (les niveaux des
    /// fichiers liés ne sont pas collectés — assumé).
    /// Scoreur backend : nommage ; sans cible : statut NULL.
    /// </summary>
    public class G203LevelNamesExtractor : IControlExtractor
    {
        public string ControlCode => "G203";

        public ControlOutcome Extract(Document doc)
        {
            List<string> niveaux = new FilteredElementCollector(doc)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .Select(l => l.Name)
                .OrderBy(n => n)
                .ToList();

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = niveaux.Count,
                ValeurJson = new { niveaux },
            };
        }
    }
}
