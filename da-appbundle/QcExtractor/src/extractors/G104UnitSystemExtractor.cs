using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G104 — système d'unités du projet (longueur / aire / volume).
    /// API vérifiée identique Revit 2024/2025 : Document.GetUnits() →
    /// Units.GetFormatOptions(ForgeTypeId spec) → FormatOptions.GetUnitTypeId() →
    /// ForgeTypeId.TypeId ; specs via SpecTypeId.Length/Area/Volume.
    /// valeur_text = jeton canonique « longueur|aire|volume » (nom court extrait du
    /// TypeId, ex. « millimeters|squareMeters|cubicMeters »), comparé tel quel par le
    /// scoreur backend 'egalite' ; valeur_json conserve les TypeId bruts pour aider à
    /// rédiger la cible. Sans cible : statut NULL.
    /// </summary>
    public class G104UnitSystemExtractor : IControlExtractor
    {
        public string ControlCode => "G104";

        public ControlOutcome Extract(Document doc)
        {
            Units units = doc.GetUnits();

            string idLongueur = TypeId(units, SpecTypeId.Length);
            string idAire = TypeId(units, SpecTypeId.Area);
            string idVolume = TypeId(units, SpecTypeId.Volume);

            string longueur = ShortName(idLongueur);
            string aire = ShortName(idAire);
            string volume = ShortName(idVolume);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurText = $"{longueur}|{aire}|{volume}",
                ValeurJson = new
                {
                    longueur,
                    aire,
                    volume,
                    typeIds = new { longueur = idLongueur, aire = idAire, volume = idVolume },
                },
            };
        }

        private static string TypeId(Units units, ForgeTypeId spec)
        {
            return units.GetFormatOptions(spec).GetUnitTypeId().TypeId;
        }

        // « autodesk.unit.unit:millimeters-1.0.1 » → « millimeters »
        private static string ShortName(string typeId)
        {
            if (string.IsNullOrEmpty(typeId)) return typeId;
            int colon = typeId.IndexOf(':');
            string tail = colon >= 0 ? typeId.Substring(colon + 1) : typeId;
            int dash = tail.IndexOf('-');
            return dash >= 0 ? tail.Substring(0, dash) : tail;
        }
    }
}
