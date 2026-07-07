using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G410 — vues non placées sur feuille.
    /// API vérifiée identique Revit 2024/2025 : View.GetPlacementOnSheetStatus()
    /// (enum ViewPlacementOnSheetStatus : NotApplicable=0, NotPlaced=1,
    /// PartiallyPlaced=2, CompletelyPlaced=3 — valeurs identiques des deux côtés).
    ///
    /// CHOIX DE SÉMANTIQUE (documenté) : comptées = vues au statut NotPlaced,
    /// gabarits de vue exclus (IsTemplate). NotApplicable (vues non plaçables :
    /// feuilles elles-mêmes, navigateur…) exclu par l'API. PartiallyPlaced n'est
    /// PAS compté comme non placé. La liste est plafonnée à 200 noms dans
    /// valeur_json pour borner la taille du résultat ; le compte reste exact.
    /// </summary>
    public class G410UnplacedViewsExtractor : IControlExtractor
    {
        public string ControlCode => "G410";
        private const int MaxNomsListes = 200;

        public ControlOutcome Extract(Document doc)
        {
            List<string> nonPlacees = new FilteredElementCollector(doc)
                .OfClass(typeof(View))
                .Cast<View>()
                .Where(v => !v.IsTemplate && v.GetPlacementOnSheetStatus() == ViewPlacementOnSheetStatus.NotPlaced)
                .Select(v => v.Name)
                .OrderBy(n => n)
                .ToList();

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = nonPlacees.Count,
                ValeurJson = new
                {
                    vuesNonPlacees = nonPlacees.Take(MaxNomsListes).ToList(),
                    listeTronquee = nonPlacees.Count > MaxNomsListes,
                },
            };
        }
    }
}
