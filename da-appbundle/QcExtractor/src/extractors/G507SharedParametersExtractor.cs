using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G507 — paramètres PARTAGÉS intégrés (SharedParameterElement).
    /// Aligné sur G508 : liste d'attendus VARIABLE PAR PROJET
    /// (qc.project_config.config.controles.G507.parametres [{nom}]).
    ///
    /// Sans liste : relève tous les SharedParameterElement présents, statut NULL.
    /// Avec liste : verdict de PRÉSENCE par nom attendu (conforme si tous présents).
    ///
    /// Distinction G502 : G502 = ParameterBindings (projet) ; G507 = SharedParameterElement
    /// (GuidValue du fichier .txt partagé).
    /// </summary>
    public class G507SharedParametersExtractor : IControlExtractor
    {
        public string ControlCode => "G507";

        private readonly G507Config _cfg;

        public G507SharedParametersExtractor(G507Config cfg)
        {
            _cfg = cfg;
        }

        public ControlOutcome Extract(Document doc)
        {
            var presents = new List<string>();
            var detail = new List<object>();
            var byName = new Dictionary<string, SharedParameterElement>(StringComparer.OrdinalIgnoreCase);

            foreach (SharedParameterElement sp in new FilteredElementCollector(doc)
                         .OfClass(typeof(SharedParameterElement))
                         .Cast<SharedParameterElement>()
                         .OrderBy(sp => sp.Name))
            {
                string nom = sp.Name ?? string.Empty;
                presents.Add(nom);
                detail.Add(new { nom, guid = sp.GuidValue.ToString() });
                if (!string.IsNullOrWhiteSpace(nom) && !byName.ContainsKey(nom.Trim()))
                    byName[nom.Trim()] = sp;
            }

            List<G507ParamEntry> attendus =
                _cfg != null && _cfg.Parametres != null ? _cfg.Parametres : new List<G507ParamEntry>();

            // Défaut : aucune liste projet => inventaire seulement, statut NULL.
            if (attendus.Count == 0)
            {
                return new ControlOutcome
                {
                    ControlCode = ControlCode,
                    ValeurNum = presents.Count,
                    ValeurJson = new
                    {
                        aucunParametre = true,
                        message = "Aucun paramètre attendu configuré (qc.project_config.config.controles.G507.parametres)",
                        parametresPartages = presents,
                        detail,
                        parametres = new List<object>(),
                    },
                };
            }

            var rapport = new List<object>();
            int nbAbsents = 0;
            foreach (G507ParamEntry entry in attendus)
            {
                string nom = entry != null && entry.Nom != null ? entry.Nom.Trim() : null;
                if (string.IsNullOrEmpty(nom)) continue;

                SharedParameterElement sp;
                bool present = byName.TryGetValue(nom, out sp);
                if (!present) nbAbsents++;

                rapport.Add(new
                {
                    nom,
                    present,
                    guid = present ? sp.GuidValue.ToString() : (string)null,
                });
            }

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = nbAbsents,
                ValeurJson = new
                {
                    aucunParametre = false,
                    nbAttendus = rapport.Count,
                    nbPresents = rapport.Count - nbAbsents,
                    nbAbsents,
                    parametres = rapport,
                    // Inventaire complet toujours relevé (Power BI / diagnostic)
                    parametresPartages = presents,
                    detail,
                },
            };
        }
    }
}
