using System;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G202 — angle de rotation du NORD PROJET (orientation du modèle).
    /// API vérifiée identique Revit 2024/2025 :
    /// Document.ActiveProjectLocation.GetProjectPosition(XYZ.Zero).Angle — rotation en
    /// radians du nord projet par rapport au nord vrai, lue à l'origine interne.
    /// Convertie en degrés et normalisée sur [0, 360).
    /// valeur_num = cet angle (degrés) pour le scoreur backend 'angle', qui le compare à
    /// une cible HUMAINE en config { angle, tolerance } — JAMAIS au nord vrai comme
    /// cible implicite (0°). Sans cible : extraction réussie, statut NULL.
    /// valeur_json.angleNordProjet = même valeur (libellé clair) ; angleNordVrai conservé
    /// en alias pour compatibilité des lectures historiques.
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
                    angleNordProjet = normalise,
                    // Alias historique (même valeur) — ne pas interpréter comme « cible = nord vrai »
                    angleNordVrai = normalise,
                    radians = pos.Angle,
                },
            };
        }
    }
}
