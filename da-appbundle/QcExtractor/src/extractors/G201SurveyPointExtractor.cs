using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G201 — géoréférencement : coordonnées du SURVEY POINT (point topographique, coordonnées
    /// réelles), et NON le point de base projet. API vérifiée identique Revit 2024/2025 :
    /// BasePoint.GetSurveyPoint(doc).SharedPosition — coordonnées PARTAGÉES (réelles, fixées par
    /// « Specify Coordinates at Point »), pas la Position (coordonnées projet). Convention d'axes
    /// Revit : X = Est/Ouest (eo), Y = Nord/Sud (ns), Z = élévation (elev), converties en mètres.
    /// valeur_json.surveyPoint = {ns, eo, elev} pour le scoreur backend 'coordonnees'
    /// (comparaison par axe à une cible avec tolérance en distance). Sans cible : statut NULL.
    /// </summary>
    public class G201SurveyPointExtractor : IControlExtractor
    {
        public string ControlCode => "G201";

        public ControlOutcome Extract(Document doc)
        {
            XYZ sp = BasePoint.GetSurveyPoint(doc).SharedPosition;

            double eo = Metres(sp.X);
            double ns = Metres(sp.Y);
            double elev = Metres(sp.Z);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurJson = new
                {
                    unite = "metres",
                    surveyPoint = new { ns, eo, elev },
                },
            };
        }

        private static double Metres(double pieds)
        {
            return UnitUtils.ConvertFromInternalUnits(pieds, UnitTypeId.Meters);
        }
    }
}
