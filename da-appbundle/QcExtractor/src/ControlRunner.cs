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
        private static IControlExtractor[] Registry()
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
            };
        }

        public static ResultPayload RunAll(Document doc, InputParams input)
        {
            var payload = new ResultPayload();

            foreach (IControlExtractor extractor in Registry())
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
