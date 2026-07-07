using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G411 — types de groupes inutilisés (aucune instance placée).
    /// API vérifiée identique Revit 2024/2025 : GroupType.Groups (GroupSet) → Size == 0.
    /// Sémantique assumée cette tranche : types de groupes (modèle + détail) sans
    /// instance ; les groupes imbriqués comptent comme instances via Groups.
    /// </summary>
    public class G411UnusedGroupsExtractor : IControlExtractor
    {
        public string ControlCode => "G411";

        public ControlOutcome Extract(Document doc)
        {
            List<string> inutilises = new FilteredElementCollector(doc)
                .OfClass(typeof(GroupType))
                .Cast<GroupType>()
                .Where(gt => gt.Groups.Size == 0)
                .Select(gt => gt.Name)
                .OrderBy(n => n)
                .ToList();

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = inutilises.Count,
                ValeurJson = new { groupesInutilises = inutilises },
            };
        }
    }
}
