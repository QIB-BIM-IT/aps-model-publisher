using System;
using System.IO;
using Newtonsoft.Json;

namespace QcExtractor
{
    /// <summary>
    /// Paramètres du workitem (params.json), fournis par le backend :
    /// identifiants ACC du modèle cloud à contrôler.
    /// </summary>
    public class InputParams
    {
        [JsonProperty("controlCode")]
        public string ControlCode { get; set; } = "G408";

        /// <summary>"US" ou "EMEA" (le repli Canada sera branché via IModelSource, pas ici).</summary>
        [JsonProperty("region")]
        public string Region { get; set; }

        [JsonProperty("projectGuid")]
        public Guid ProjectGuid { get; set; }

        [JsonProperty("modelGuid")]
        public Guid ModelGuid { get; set; }

        /// <summary>
        /// TEST UNIQUEMENT (chantier 3) : code du contrôle dont l'extraction doit être
        /// simulée en échec, pour prouver l'isolation des extracteurs. Vide en usage normal.
        /// </summary>
        [JsonProperty("simulerEchec")]
        public string SimulerEchec { get; set; }

        public static InputParams Load(string path)
        {
            if (!File.Exists(path))
                throw new FileNotFoundException($"Fichier de paramètres introuvable: {path}");
            var parsed = JsonConvert.DeserializeObject<InputParams>(File.ReadAllText(path));
            if (parsed == null || parsed.ProjectGuid == Guid.Empty || parsed.ModelGuid == Guid.Empty)
                throw new InvalidDataException("params.json invalide (projectGuid/modelGuid manquants)");
            return parsed;
        }
    }
}
