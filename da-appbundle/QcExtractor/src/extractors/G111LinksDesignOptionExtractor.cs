using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G111 — liens (RevitLinkInstance) dans la design option PRINCIPALE nommée.
    /// Code section 1 (Fichier / références) : les liens sont des références externes
    /// de l'hôte ; le pinné n'est PAS exigé. Nom lisible via Element.Name SANS
    /// GetLinkDocument / sans charger le lien.
    /// Défaut option : "Liens" (configurable G111Config.designOptionNom).
    /// Vacuité (0 lien) => vacuite=true, statut NULL côté scoreur.
    /// </summary>
    public class G111LinksDesignOptionExtractor : IControlExtractor
    {
        public string ControlCode => "G111";
        private const int MaxFautifs = 100;
        public const string DesignOptionNomDefaut = "Liens";

        private readonly string _designOptionNom;

        public G111LinksDesignOptionExtractor(G111Config cfg)
        {
            string fromCfg = cfg != null ? cfg.DesignOptionNom : null;
            _designOptionNom = string.IsNullOrWhiteSpace(fromCfg)
                ? DesignOptionNomDefaut
                : fromCfg.Trim();
        }

        public ControlOutcome Extract(Document doc)
        {
            var liens = new List<object>();
            var fautifs = new List<object>();

            foreach (RevitLinkInstance link in new FilteredElementCollector(doc)
                .OfClass(typeof(RevitLinkInstance))
                .Cast<RevitLinkInstance>()
                .OrderBy(l => l.Name))
            {
                DesignOption dop = null;
                try { dop = link.DesignOption; } catch { /* ignore */ }
                string doNom = DesignOptionPlacement.Label(dop);
                bool optionOk = DesignOptionPlacement.EstOptionPrincipaleAttendue(
                    dop, _designOptionNom, out string raisonOption);

                string nom = link.Name ?? string.Empty;
                long id = link.Id.Value;
                bool estConforme = optionOk;

                liens.Add(new
                {
                    nom,
                    designOptionNom = doNom,
                    estConforme,
                    id,
                });

                if (!estConforme)
                {
                    fautifs.Add(new
                    {
                        nom,
                        designOptionNom = doNom,
                        raisons = raisonOption != null
                            ? new[] { raisonOption }
                            : new[] { "mauvaise option" },
                        id,
                    });
                }
            }

            bool vacuite = liens.Count == 0;
            int nbFautifs = fautifs.Count;

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = vacuite ? (double?)null : nbFautifs,
                ValeurJson = new
                {
                    vacuite,
                    designOptionNomAttendu = _designOptionNom,
                    nbLiens = liens.Count,
                    nbConformes = liens.Count - nbFautifs,
                    nbFautifs,
                    liens,
                    fautifs = fautifs.Take(MaxFautifs).ToList(),
                    listeTronquee = fautifs.Count > MaxFautifs,
                    note = "Verdict = option primaire nommée (tolérance 0). Pas d'exigence pinné. Noms pour Power BI.",
                },
            };
        }
    }
}
