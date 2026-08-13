using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G203 — niveaux PINNÉS (refonte : plus de nommage).
    /// Contrôle MODÈLE, hôte seul. Les niveaux ne peuvent pas être dans une design option
    /// (règle Revit) : on ne vérifie que Element.Pinned.
    /// La liste complète {nom, pinned} est relevée pour Power BI ; le verdict porte
    /// uniquement sur l'état pinné (tolérance zéro).
    /// API vérifiée 2024/2025 : Level via OfClass, Element.Pinned, Element.Name.
    /// </summary>
    public class G203PinnedLevelsExtractor : IControlExtractor
    {
        public string ControlCode => "G203";
        private const int MaxFautifs = DesignatedElementLimits.SafetyCapPerControl;

        public ControlOutcome Extract(Document doc)
        {
            var niveaux = new List<object>();
            var fautifs = new List<object>();

            foreach (Level lvl in new FilteredElementCollector(doc)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .OrderBy(l => l.Name))
            {
                bool pinned = false;
                try { pinned = lvl.Pinned; } catch { /* ignore */ }
                string nom = lvl.Name ?? string.Empty;
                long id = lvl.Id.Value;

                niveaux.Add(new { nom, pinned, id });
                if (!pinned)
                {
                    fautifs.Add(new { nom, pinned, id, raisons = new[] { "non pinne" } });
                }
            }

            bool vacuite = niveaux.Count == 0;
            int nbFautifs = fautifs.Count;

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = vacuite ? (double?)null : nbFautifs,
                ValeurJson = new
                {
                    vacuite,
                    nbNiveaux = niveaux.Count,
                    nbPinnes = niveaux.Count - nbFautifs,
                    nbFautifs,
                    niveaux,
                    fautifs = fautifs.Take(MaxFautifs).ToList(),
                    listeTronquee = fautifs.Count > MaxFautifs,
                    note = "Verdict = tous pinnés (tolérance 0). Noms relevés pour Power BI, pas pour le score.",
                },
            };
        }
    }
}
