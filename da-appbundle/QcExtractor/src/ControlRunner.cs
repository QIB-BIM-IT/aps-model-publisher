using System;
using Autodesk.Revit.DB;

namespace QcExtractor
{
    /// <summary>
    /// Registre des extracteurs MODÈLE et boucle d'exécution isolée :
    /// CHAQUE extracteur tourne dans son propre try. Un échec produit une ligne
    /// en échec d'extraction avec son message ; les autres continuent.
    /// </summary>
    public static class ControlRunner
    {
        private static IControlExtractor[] Registry(InputParams input)
        {
            return new IControlExtractor[]
            {
                new Extractors.G408WarningsExtractor(),
                new Extractors.G411UnusedGroupsExtractor(),
                new Extractors.G502ProjectParametersExtractor(),
                // Lot 1 (chantier 3)
                new Extractors.G309UnassignedMepSystemsExtractor(),
                new Extractors.G310OpenConnectorsExtractor(),
                new Extractors.G402DesignOptionsExtractor(),
                new Extractors.G410UnplacedViewsExtractor(),
                // Lot 2 — G406/G407 partagent la lecture des phases via PhaseReader
                new Extractors.G406PhaseNamesExtractor(),
                new Extractors.G407PhaseOrderExtractor(),
                new Extractors.G507SharedParametersExtractor(),
                // Lot NOMMAGE — sous-projets uniquement (G203/G205 refondus en état)
                new Extractors.G404WorksetNamesExtractor(),
                // Lot ÉTAT RÉFÉRENCE — G203 niveaux pinnés ; G205 axes pinnés + DO principale ;
                // G111 liens dans DO principale (noms relevés pour Power BI, verdict = état).
                new Extractors.G203PinnedLevelsExtractor(),
                new Extractors.G205PinnedGridsExtractor(input != null ? input.G205 : null),
                new Extractors.G111LinksDesignOptionExtractor(input != null ? input.G111 : null),
                // Lot COORDONNÉES — hôte seul, sans lien (API vérifiée 2024/2025) :
                // unités, infos projet, base/origine, survey point, angle au nord vrai.
                new Extractors.G104UnitSystemExtractor(),
                new Extractors.G105ProjectInfoExtractor(),
                new Extractors.G200BasePointOriginExtractor(),
                new Extractors.G201SurveyPointExtractor(),
                new Extractors.G202TrueNorthAngleExtractor(),
                // Lot G504 — couverture UNIFORMAT : reçoit sa config (paramètre + liste
                // blanche) résolue par le backend via params.json (norme maison + projet).
                new Extractors.G504UniformatCoverageExtractor(input != null ? input.Uniformat : null),
                // Lot G508 — taux de remplissage des paramètres d'exploitation : liste de
                // paramètres VARIABLE PAR PROJET (qc.project_config), granulaire par catégories.
                new Extractors.G508OperationalParamsFillRateExtractor(input != null ? input.G508 : null),
                // Lot G210 — copie-contrôle axes/niveaux : présence de monitoring (PAS
                // fraîcheur), exclusions de niveaux techniques via config (norme + projet).
                new Extractors.G210CopyMonitorExtractor(input != null ? input.G210 : null),
                // Lot G314 — rattachement au niveau (déclaré vs physique), catégories
                // MEP+structure et tolérance via config (norme maison + projet).
                new Extractors.G314LevelAttachmentExtractor(input != null ? input.G314 : null),
                // Lot G412 — hygiène du modèle : in place + total groupes + instance unique
                // (Organisation Revit ; ne remplace pas la purge manuelle / G106 doc).
                new Extractors.G412ModelHygieneExtractor(),
            };
        }

        public static ResultPayload RunAll(Document doc, InputParams input)
        {
            var payload = new ResultPayload();

            foreach (IControlExtractor extractor in Registry(input))
            {
                try
                {
                    // Facilité de TEST uniquement (params.json.simulerEchec) : prouve
                    // l'isolation des échecs sans extracteur cassé permanent.
                    if (!string.IsNullOrEmpty(input.SimulerEchec) && input.SimulerEchec == extractor.ControlCode)
                        throw new InvalidOperationException("Échec simulé pour test d'isolation (simulerEchec)");

                    ControlOutcome outcome = extractor.Extract(doc);
                    outcome.ControlCode = extractor.ControlCode;
                    outcome.EtatExtraction = "extrait";
                    payload.Controls.Add(outcome);
                    Console.WriteLine($"[QcExtractor] {extractor.ControlCode}: extrait");
                }
                catch (Exception e)
                {
                    payload.Controls.Add(new ControlOutcome
                    {
                        ControlCode = extractor.ControlCode,
                        EtatExtraction = "echec",
                        Erreur = e.Message,
                        // AUCUNE valeur sur un échec — règle absolue des deux axes
                    });
                    Console.WriteLine($"[QcExtractor] {extractor.ControlCode}: ECHEC — {e.Message}");
                }
            }

            return payload;
        }
    }
}
