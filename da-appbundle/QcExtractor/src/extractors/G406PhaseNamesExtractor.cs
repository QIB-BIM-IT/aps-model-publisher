using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G406 — phases du document (noms). La liste émise est ORDONNÉE (ordre
    /// chronologique du document) : la même lecture sert G407 (ordre) via
    /// PhaseReader, sans relire les phases. Scoreur backend : presence
    /// (liste de noms attendus en config), sans cible : statut NULL.
    /// </summary>
    public class G406PhaseNamesExtractor : IControlExtractor
    {
        public string ControlCode => "G406";

        public ControlOutcome Extract(Document doc)
        {
            List<string> phases = PhaseReader.GetOrderedPhaseNames(doc);
            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = phases.Count,
                ValeurJson = new { phases },
            };
        }
    }
}
