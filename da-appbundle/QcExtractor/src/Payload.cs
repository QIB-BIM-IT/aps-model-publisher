using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;

namespace QcExtractor
{
    /// <summary>Une ligne d'avertissement G408 (forme INCHANGÉE depuis la tranche 1).</summary>
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

    /// <summary>
    /// Résultat d'UN contrôle. Deux axes jamais mélangés :
    /// EtatExtraction (technique: extrait|echec) — un échec porte Erreur et AUCUNE valeur.
    /// Le statut métier est calculé côté backend, jamais ici.
    /// </summary>
    public class ControlOutcome
    {
        [JsonProperty("controlCode")]
        public string ControlCode { get; set; }

        [JsonProperty("etatExtraction")]
        public string EtatExtraction { get; set; } = "extrait";

        [JsonProperty("erreur", NullValueHandling = NullValueHandling.Ignore)]
        public string Erreur { get; set; }

        [JsonProperty("valeurNum", NullValueHandling = NullValueHandling.Ignore)]
        public double? ValeurNum { get; set; }

        [JsonProperty("valeurText", NullValueHandling = NullValueHandling.Ignore)]
        public string ValeurText { get; set; }

        [JsonProperty("valeurJson", NullValueHandling = NullValueHandling.Ignore)]
        public object ValeurJson { get; set; }

        // ===== Champs spécifiques G408 (forme historique conservée à l'identique) =====

        [JsonProperty("total", NullValueHandling = NullValueHandling.Ignore)]
        public int? Total { get; set; }

        [JsonProperty("critical", NullValueHandling = NullValueHandling.Ignore)]
        public int? Critical { get; set; }

        [JsonProperty("warnings", NullValueHandling = NullValueHandling.Ignore)]
        public List<WarningEntry> Warnings { get; set; }
    }

    /// <summary>
    /// result.json v2 : multi-contrôles. Le backend accepte aussi l'ancienne forme v1
    /// (G408 seul à la racine) pour compatibilité de retour arrière d'alias.
    /// </summary>
    public class ResultPayload
    {
        [JsonProperty("schemaVersion")]
        public int SchemaVersion { get; set; } = 2;

        [JsonProperty("controls")]
        public List<ControlOutcome> Controls { get; set; } = new List<ControlOutcome>();

        public void Save(string path)
        {
            File.WriteAllText(path, JsonConvert.SerializeObject(this, Formatting.Indented));
        }
    }
}
