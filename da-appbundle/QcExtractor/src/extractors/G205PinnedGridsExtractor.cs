using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G205 — axes PINNÉS et dans la design option PRINCIPALE nommée (refonte : plus de nommage).
    /// Deux conditions par Grid : (1) Element.Pinned (2) DesignOption PRIMARY au nom attendu
    /// (défaut "Quadrillages", configurable via G205Config.designOptionNom).
    /// Main Model / option secondaire / mauvais nom = fautif sur l'option.
    /// Liste complète pour Power BI ; verdict = état uniquement (tolérance zéro).
    /// Vacuité (0 axe) => vacuite=true, valeur_num null.
    /// Pas de Distinct sur le nom : chaque Grid (y compris segments multi) est audité.
    /// </summary>
    public class G205PinnedGridsExtractor : IControlExtractor
    {
        public string ControlCode => "G205";
        private const int MaxFautifs = DesignatedElementLimits.SafetyCapPerControl;
        public const string DesignOptionNomDefaut = "Quadrillages";

        private readonly string _designOptionNom;

        public G205PinnedGridsExtractor(G205Config cfg)
        {
            string fromCfg = cfg != null ? cfg.DesignOptionNom : null;
            _designOptionNom = string.IsNullOrWhiteSpace(fromCfg)
                ? DesignOptionNomDefaut
                : fromCfg.Trim();
        }

        public ControlOutcome Extract(Document doc)
        {
            var axes = new List<object>();
            var fautifs = new List<object>();

            foreach (Grid grid in new FilteredElementCollector(doc)
                .OfClass(typeof(Grid))
                .Cast<Grid>()
                .OrderBy(g => g.Name))
            {
                bool pinned = false;
                try { pinned = grid.Pinned; } catch { /* ignore */ }

                DesignOption dop = null;
                try { dop = grid.DesignOption; } catch { /* ignore */ }
                string doNom = DesignOptionPlacement.Label(dop);
                bool optionOk = DesignOptionPlacement.EstOptionPrincipaleAttendue(
                    dop, _designOptionNom, out string raisonOption);

                var raisons = new List<string>();
                if (!pinned) raisons.Add("non pinne");
                if (!optionOk && raisonOption != null) raisons.Add(raisonOption);

                bool estConforme = pinned && optionOk;
                string nom = grid.Name ?? string.Empty;
                long id = grid.Id.Value;

                axes.Add(new
                {
                    nom,
                    pinned,
                    designOptionNom = doNom,
                    estConforme,
                    id,
                });

                if (!estConforme)
                {
                    fautifs.Add(new
                    {
                        nom,
                        pinned,
                        designOptionNom = doNom,
                        raisons,
                        id,
                    });
                }
            }

            bool vacuite = axes.Count == 0;
            int nbFautifs = fautifs.Count;

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = vacuite ? (double?)null : nbFautifs,
                ValeurJson = new
                {
                    vacuite,
                    designOptionNomAttendu = _designOptionNom,
                    nbAxes = axes.Count,
                    nbConformes = axes.Count - nbFautifs,
                    nbFautifs,
                    axes,
                    fautifs = fautifs.Take(MaxFautifs).ToList(),
                    listeTronquee = fautifs.Count > MaxFautifs,
                    note = "Verdict = pinné ET option primaire nommée (tolérance 0). Noms pour Power BI.",
                },
            };
        }
    }
}
