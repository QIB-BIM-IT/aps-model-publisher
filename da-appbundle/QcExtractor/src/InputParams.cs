using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;

namespace QcExtractor
{
    /// <summary>
    /// Désignation d'un paramètre à contrôler pour G504 : soit un BuiltInParameter natif
    /// (kind = "builtin", ex. UNIFORMAT_CODE), soit un paramètre partagé/projet lu par NOM
    /// (kind = "partage", ex. Tt_TXT_Code_Uniformat). La bascule natif(type) → partagé(instance)
    /// est un simple changement de config : l'extracteur détecte la nature à l'exécution.
    /// </summary>
    public class UniformatParam
    {
        [JsonProperty("kind")]
        public string Kind { get; set; } // "builtin" | "partage"

        [JsonProperty("valeur")]
        public string Valeur { get; set; }
    }

    /// <summary>
    /// Config EFFECTIVE de G504 (norme maison + surcharge projet), résolue par le backend.
    /// Optionnelle dans params.json : seul l'extracteur G504 la consomme.
    /// </summary>
    public class UniformatConfig
    {
        [JsonProperty("parametre")]
        public UniformatParam Parametre { get; set; }

        [JsonProperty("categories")]
        public List<string> Categories { get; set; } = new List<string>();
    }

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

        /// <summary>
        /// Config G504 (couverture UNIFORMAT), résolue par le backend depuis la norme
        /// versionnée + la surcharge projet. Null si absente (l'extracteur G504 le gère).
        /// </summary>
        [JsonProperty("uniformat")]
        public UniformatConfig Uniformat { get; set; }

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
