using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G309 — éléments MEP sans système assigné.
    /// API vérifiée identique Revit 2024/2025 : MEPCurve.MEPSystem (null = non assigné).
    ///
    /// CHOIX DE SÉMANTIQUE (documenté, tranche lot 1) : « élément MEP » = les MEPCurve
    /// qui portent la notion de système, soit Duct, FlexDuct (Mechanical), Pipe,
    /// FlexPipe (Plumbing). Les CableTray/Conduit/Wire sont exclus : ils héritent de
    /// MEPCurve mais n'ont pas de système MEP au sens Revit (MEPSystem toujours null,
    /// les compter serait du bruit pur). Les FamilyInstance (raccords, terminaux…)
    /// sont hors périmètre de cette tranche — leur assignation passe par les
    /// connecteurs et relève d'un raffinement futur.
    /// </summary>
    public class G309UnassignedMepSystemsExtractor : IControlExtractor
    {
        public string ControlCode => "G309";

        public ControlOutcome Extract(Document doc)
        {
            var parCategorie = new Dictionary<string, int>();
            int total = 0;

            foreach (MEPCurve curve in new FilteredElementCollector(doc)
                         .OfClass(typeof(MEPCurve))
                         .Cast<MEPCurve>())
            {
                bool porteUnSysteme =
                    curve is Autodesk.Revit.DB.Mechanical.Duct ||
                    curve is Autodesk.Revit.DB.Mechanical.FlexDuct ||
                    curve is Autodesk.Revit.DB.Plumbing.Pipe ||
                    curve is Autodesk.Revit.DB.Plumbing.FlexPipe;
                if (!porteUnSysteme) continue;

                if (curve.MEPSystem == null)
                {
                    total++;
                    string cat = curve.Category?.Name ?? curve.GetType().Name;
                    parCategorie[cat] = parCategorie.TryGetValue(cat, out int n) ? n + 1 : 1;
                }
            }

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = total,
                ValeurJson = new { parCategorie = parCategorie.OrderBy(kv => kv.Key).ToDictionary(kv => kv.Key, kv => kv.Value) },
            };
        }
    }
}
