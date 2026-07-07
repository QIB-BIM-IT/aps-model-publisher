using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G407 — phases du document (ordre). RÉUTILISE la lecture de G406 (PhaseReader,
    /// une seule traversée de Document.Phases par workitem). Émet la même liste
    /// ordonnée ; le verdict d'ordre est rendu côté backend par le scoreur 'sequence'
    /// (comparaison à une séquence de référence en config), sans cible : statut NULL.
    /// </summary>
    public class G407PhaseOrderExtractor : IControlExtractor
    {
        public string ControlCode => "G407";

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
