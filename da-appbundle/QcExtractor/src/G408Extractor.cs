using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Newtonsoft.Json;

namespace QcExtractor
{
    public class WarningEntry
    {
        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("severity")]
        public string Severity { get; set; } // "warning" | "critical"

        [JsonProperty("elementIds")]
        public List<long> ElementIds { get; set; } = new List<long>();

        [JsonProperty("failureDefinitionId")]
        public string FailureDefinitionId { get; set; }
    }

    public class ResultPayload
    {
        [JsonProperty("controlCode")]
        public string ControlCode { get; set; } = "G408";

        [JsonProperty("total")]
        public int Total { get; set; }

        [JsonProperty("critical")]
        public int Critical { get; set; }

        [JsonProperty("warnings")]
        public List<WarningEntry> Warnings { get; set; } = new List<WarningEntry>();

        public void Save(string path)
        {
            File.WriteAllText(path, JsonConvert.SerializeObject(this, Formatting.Indented));
        }
    }

    /// <summary>
    /// Contrôle G408 : inventaire des avertissements du modèle.
    /// Aucun scoring, aucune comparaison à une cible dans cette tranche.
    /// </summary>
    public static class G408Extractor
    {
        // Tranche verticale : liste de patterns "critiques" codée en dur (FR + EN).
        // La configuration par projet (qc.project_config) prendra le relais plus tard.
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

        public static ResultPayload Extract(Document doc)
        {
            IList<FailureMessage> failures = doc.GetWarnings();
            var result = new ResultPayload { Total = failures.Count };

            foreach (FailureMessage fm in failures)
            {
                string description = fm.GetDescriptionText() ?? string.Empty;

                bool isCritical =
                    fm.GetSeverity() == FailureSeverity.Error ||
                    CriticalPatterns.Any(p => description.IndexOf(p, StringComparison.OrdinalIgnoreCase) >= 0);

                if (isCritical) result.Critical++;

                result.Warnings.Add(new WarningEntry
                {
                    Description = description,
                    Severity = isCritical ? "critical" : "warning",
                    ElementIds = fm.GetFailingElements().Select(id => id.Value).ToList(),
                    FailureDefinitionId = fm.GetFailureDefinitionId()?.Guid.ToString(),
                });
            }

            return result;
        }
    }
}
