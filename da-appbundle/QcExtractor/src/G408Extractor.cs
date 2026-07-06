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

        // SPIKE chantier 2 : bloc de diagnostic optionnel, absent si non demandé
        [JsonProperty("diagnostics", NullValueHandling = NullValueHandling.Ignore)]
        public DiagnosticsPayload Diagnostics { get; set; }

        public void Save(string path)
        {
            File.WriteAllText(path, JsonConvert.SerializeObject(this, Formatting.Indented));
        }
    }

    // ===== SPIKE chantier 2 : diagnostic de l'identité des avertissements =====

    public class DiagnosticWarning
    {
        [JsonProperty("index")]
        public int Index { get; set; }

        /// <summary>Guid de FailureDefinitionId, ou null si l'accesseur retourne null.</summary>
        [JsonProperty("definitionGuid")]
        public string DefinitionGuid { get; set; }

        /// <summary>true si le Guid est Guid.Empty ou l'id null (indisponibilité explicite).</summary>
        [JsonProperty("guidEmptyOrUnavailable")]
        public bool GuidEmptyOrUnavailable { get; set; }

        [JsonProperty("descriptionText")]
        public string DescriptionText { get; set; }

        [JsonProperty("severityNative")]
        public string SeverityNative { get; set; }

        [JsonProperty("failingElementsCount")]
        public int FailingElementsCount { get; set; }

        [JsonProperty("additionalElementsCount")]
        public int AdditionalElementsCount { get; set; }
    }

    public class GuidAggregate
    {
        [JsonProperty("count")]
        public int Count { get; set; }

        [JsonProperty("texts")]
        public List<string> Texts { get; set; } = new List<string>();
    }

    public class DiagnosticsPayload
    {
        [JsonProperty("engineLanguage")]
        public string EngineLanguage { get; set; }

        [JsonProperty("warnings")]
        public List<DiagnosticWarning> Warnings { get; set; } = new List<DiagnosticWarning>();

        /// <summary>Agrégation par Guid distinct : occurrences + textes associés (dédoublonnés).</summary>
        [JsonProperty("byGuid")]
        public Dictionary<string, GuidAggregate> ByGuid { get; set; } = new Dictionary<string, GuidAggregate>();
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
            return Extract(doc, diagnostic: false, engineLanguage: null);
        }

        /// <summary>
        /// SPIKE chantier 2 : le calcul G408 (Total/Critical/Warnings) est STRICTEMENT
        /// identique au chemin prouvé ; le diagnostic est un ajout en lecture seule.
        /// </summary>
        public static ResultPayload Extract(Document doc, bool diagnostic, string engineLanguage)
        {
            IList<FailureMessage> failures = doc.GetWarnings();
            var result = new ResultPayload { Total = failures.Count };
            var diag = diagnostic ? new DiagnosticsPayload { EngineLanguage = engineLanguage } : null;
            int index = 0;

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

                if (diag != null)
                {
                    FailureDefinitionId defId = fm.GetFailureDefinitionId();
                    Guid? guid = defId?.Guid;
                    bool unavailable = defId == null || guid == null || guid.Value == Guid.Empty;
                    string guidKey = unavailable ? "(vide/indisponible)" : guid.Value.ToString();

                    diag.Warnings.Add(new DiagnosticWarning
                    {
                        Index = index,
                        DefinitionGuid = defId == null ? null : guid.Value.ToString(),
                        GuidEmptyOrUnavailable = unavailable,
                        DescriptionText = description,
                        SeverityNative = fm.GetSeverity().ToString(),
                        FailingElementsCount = fm.GetFailingElements().Count,
                        AdditionalElementsCount = fm.GetAdditionalElements().Count,
                    });

                    if (!diag.ByGuid.TryGetValue(guidKey, out GuidAggregate agg))
                    {
                        agg = new GuidAggregate();
                        diag.ByGuid[guidKey] = agg;
                    }
                    agg.Count++;
                    if (!agg.Texts.Contains(description)) agg.Texts.Add(description);
                }

                index++;
            }

            result.Diagnostics = diag;
            return result;
        }
    }
}
