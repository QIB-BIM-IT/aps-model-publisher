using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G408 — inventaire des avertissements du modèle.
    /// REFACTORÉ dans le registre à ISO-COMPORTEMENT STRICT depuis la tranche 1 :
    /// même logique, mêmes patterns, mêmes champs de sortie (total, critical, warnings
    /// avec description/severity/elementIds/failureDefinitionId). Le scoring de
    /// criticité par Guid reste côté backend, inchangé.
    /// </summary>
    public class G408WarningsExtractor : IControlExtractor
    {
        public string ControlCode => "G408";

        // Tranche 1 : liste de patterns "critiques" codée en dur (FR + EN) — conservée
        // à l'identique. La criticité réelle est calculée côté backend (grille par Guid).
        private static readonly string[] CriticalPatterns =
        {
            // EN
            "identical instances in the same place",
            "duplicate mark",
            "elements have duplicate",
            "overlap",
            "room separation lines overlap",
            // FR
            "instances identiques au même emplacement",
            "valeurs de repère en double",
            "se chevauchent",
            "lignes de séparation de pièces",
        };

        public ControlOutcome Extract(Document doc)
        {
            IList<FailureMessage> failures = doc.GetWarnings();
            var outcome = new ControlOutcome
            {
                ControlCode = ControlCode,
                Total = failures.Count,
                Critical = 0,
                Warnings = new List<WarningEntry>(),
            };

            foreach (FailureMessage fm in failures)
            {
                string description = fm.GetDescriptionText() ?? string.Empty;

                bool isCritical =
                    fm.GetSeverity() == FailureSeverity.Error ||
                    CriticalPatterns.Any(p => description.IndexOf(p, StringComparison.OrdinalIgnoreCase) >= 0);

                if (isCritical) outcome.Critical++;

                outcome.Warnings.Add(new WarningEntry
                {
                    Description = description,
                    Severity = isCritical ? "critical" : "warning",
                    ElementIds = fm.GetFailingElements().Select(id => id.Value).ToList(),
                    FailureDefinitionId = fm.GetFailureDefinitionId()?.Guid.ToString(),
                });
            }

            return outcome;
        }
    }
}
