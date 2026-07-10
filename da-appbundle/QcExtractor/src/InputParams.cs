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
    /// G508 — une entrée de paramètre d'exploitation à vérifier (structure RÉGULIÈRE
    /// pensée pour un futur formulaire web : champs nets, pas de structure libre).
    /// </summary>
    public class G508ParamEntry
    {
        /// <summary>Nom du paramètre. Résolu comme G504 : si le nom correspond à un
        /// BuiltInParameter (ALL_CAPS) il est lu par enum, sinon en paramètre partagé
        /// par NOM (LookupParameter). La nature type/instance est détectée à l'exécution.</summary>
        [JsonProperty("nom")]
        public string Nom { get; set; }

        /// <summary>BuiltInCategory du périmètre de CE paramètre (granulaire).
        /// Vide/absent = toutes les catégories de design (CategoriesDesignDefaut).</summary>
        [JsonProperty("categories")]
        public List<string> Categories { get; set; } = new List<string>();

        /// <summary>% de remplissage requis pour ce paramètre (défaut 100).</summary>
        [JsonProperty("seuil")]
        public double Seuil { get; set; } = 100;
    }

    /// <summary>
    /// Config PROJET de G508 (taux de remplissage des paramètres d'exploitation), résolue
    /// par le backend depuis qc.project_config UNIQUEMENT (liste variable par projet, PAS
    /// de norme maison). Optionnelle : sans elle, l'extracteur G508 rapporte « aucun
    /// paramètre configuré » (statut NULL).
    /// </summary>
    public class G508Config
    {
        [JsonProperty("parametres")]
        public List<G508ParamEntry> Parametres { get; set; } = new List<G508ParamEntry>();

        /// <summary>Catégories de design par défaut (norme maison G504) appliquées à un
        /// paramètre dont la liste de catégories est vide (« toutes catégories de design »).</summary>
        [JsonProperty("categoriesDesignDefaut")]
        public List<string> CategoriesDesignDefaut { get; set; } = new List<string>();
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

        /// <summary>
        /// Config G508 (taux de remplissage des paramètres d'exploitation), résolue par le
        /// backend depuis qc.project_config. Null si absente (l'extracteur G508 le gère).
        /// </summary>
        [JsonProperty("g508")]
        public G508Config G508 { get; set; }

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
