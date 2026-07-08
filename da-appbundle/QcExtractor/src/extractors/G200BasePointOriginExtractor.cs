using System;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G200 — cohérence point de base projet / origine interne (comparaison INTERNE,
    /// aucune référence externe). API vérifiée identique Revit 2024/2025 :
    /// BasePoint.GetProjectBasePoint(doc).Position expose le point de base en coordonnées
    /// PROJET (donc relatives à l'origine interne). L'origine interne — définitionnellement
    /// à (0,0,0) dans ce système — est lue littéralement via
    /// FilteredElementCollector.OfClass(InternalOrigin).Position (repli XYZ.Zero si non
    /// collectée, résultat identique). Écart par axe converti en mètres.
    /// valeur_num = plus grand écart absolu par axe (le pire axe) pour le scoreur backend
    /// 'seuil' (conforme si écart ≤ tolérance en config) ; valeur_json = écart par axe.
    /// Sans cible : statut NULL.
    /// </summary>
    public class G200BasePointOriginExtractor : IControlExtractor
    {
        public string ControlCode => "G200";

        public ControlOutcome Extract(Document doc)
        {
            XYZ pbp = BasePoint.GetProjectBasePoint(doc).Position;

            InternalOrigin io = new FilteredElementCollector(doc)
                .OfClass(typeof(InternalOrigin))
                .Cast<InternalOrigin>()
                .FirstOrDefault();
            XYZ origine = io != null ? io.Position : XYZ.Zero;

            double eo = Metres(pbp.X - origine.X);
            double ns = Metres(pbp.Y - origine.Y);
            double elev = Metres(pbp.Z - origine.Z);
            double ecartMaxAbs = Math.Max(Math.Abs(eo), Math.Max(Math.Abs(ns), Math.Abs(elev)));

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = ecartMaxAbs,
                ValeurJson = new
                {
                    unite = "metres",
                    ecart = new { ns, eo, elev },
                    ecartMaxAbs,
                },
            };
        }

        private static double Metres(double pieds)
        {
            return UnitUtils.ConvertFromInternalUnits(pieds, UnitTypeId.Meters);
        }
    }
}
