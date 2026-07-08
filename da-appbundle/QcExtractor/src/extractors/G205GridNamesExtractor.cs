using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G205 — axes / quadrillages (noms).
    /// API vérifiée identique Revit 2024/2025 : FilteredElementCollector
    /// OfClass(Grid) → Element.Name. Les segments d'un quadrillage multi-segments
    /// (MultiSegmentGrid) sont des Grid portant le même nom : la liste est
    /// dédoublonnée (Distinct) — pour une validation de nommage, les doublons
    /// n'apportent rien. Document courant uniquement (liens exclus — assumé).
    /// Scoreur backend : nommage ; sans cible : statut NULL.
    /// </summary>
    public class G205GridNamesExtractor : IControlExtractor
    {
        public string ControlCode => "G205";

        public ControlOutcome Extract(Document doc)
        {
            List<string> axes = new FilteredElementCollector(doc)
                .OfClass(typeof(Grid))
                .Cast<Grid>()
                .Select(g => g.Name)
                .Distinct()
                .OrderBy(n => n)
                .ToList();

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = axes.Count,
                ValeurJson = new { axes },
            };
        }
    }
}
