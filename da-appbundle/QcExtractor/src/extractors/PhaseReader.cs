using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// Lecture UNIQUE et partagée des phases du document pour G406 (noms) et G407
    /// (ordre) — une seule traversée de Document.Phases, deux scoreurs côté backend.
    /// API vérifiée identique Revit 2024/2025 : Document.Phases (PhaseArray indexé,
    /// ordonné chronologiquement du passé vers le futur), Phase.Name.
    /// Mémoïsation par référence de document : les extracteurs du registre tournent
    /// séquentiellement sur le même Document au sein d'un workitem.
    /// </summary>
    internal static class PhaseReader
    {
        private static Document _lastDoc;
        private static List<string> _lastPhases;

        public static List<string> GetOrderedPhaseNames(Document doc)
        {
            if (ReferenceEquals(doc, _lastDoc) && _lastPhases != null) return _lastPhases;

            var noms = new List<string>();
            PhaseArray phases = doc.Phases;
            for (int i = 0; i < phases.Size; i++)
            {
                Phase p = phases.get_Item(i);
                if (p != null) noms.Add(p.Name);
            }

            _lastDoc = doc;
            _lastPhases = noms;
            return noms;
        }
    }
}
