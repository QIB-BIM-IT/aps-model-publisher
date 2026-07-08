using System;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G202 — angle au nord (nord projet vs nord VRAI). API vérifiée identique Revit 2024/2025 :
    /// Document.ActiveProjectLocation.GetProjectPosition(XYZ.Zero).Angle — rotation en radians
    /// entre le nord projet et le nord vrai, lue à l'origine interne. Convertie en degrés et
    /// normalisée sur [0, 360).
    /// valeur_num = angle en degrés pour le scoreur backend 'angle' (comparaison à une cible avec
    /// tolérance angulaire, wrap-around géré). Sans cible : statut NULL.
    /// </summary>
    public class G202TrueNorthAngleExtractor : IControlExtractor
    {
        public string ControlCode => "G202";

        public ControlOutcome Extract(Document doc)
        {
            ProjectPosition pos = doc.ActiveProjectLocation.GetProjectPosition(XYZ.Zero);

            double degres = pos.Angle * 180.0 / Math.PI;
            double normalise = degres % 360.0;
            if (normalise < 0) normalise += 360.0;

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = normalise,
                ValeurJson = new
                {
                    unite = "degres",
                    angleNordVrai = normalise,
                    radians = pos.Angle,
                },
            };
        }
    }
}
