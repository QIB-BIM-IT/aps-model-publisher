using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace QcExtractor
{
    /// <summary>
    /// UniqueId Revit (identité persistante). C'est l'externalId du Viewer APS.
    /// Propriété Element.UniqueId, identique API 2024 / 2025 / 2026
    /// (net48 et net8.0-windows). S'applique aux instances ET aux types.
    /// Jamais de valeur de substitution : null si absent ou illisible.
    /// Ne PAS reconstruire depuis ElementId : le suffixe hex8 ne coïncide
    /// pas toujours (vues, éléments copiés) ; GetElement(uniqueId) est la voie juste.
    /// </summary>
    internal static class UniqueIds
    {
        public static string Of(Element el)
        {
            if (el == null) return null;
            try
            {
                string u = el.UniqueId;
                return string.IsNullOrEmpty(u) ? null : u;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Seconde voie : Document.GetElement(uniqueId) doit retrouver le même ElementId.
        /// Diagnostic uniquement (échantillon dans result.json), hors scoring.
        /// </summary>
        public static object SampleRoundTrip(Document doc, int maxSamples)
        {
            var samples = new List<object>();
            int ok = 0, fail = 0, skipped = 0;
            if (doc == null || maxSamples <= 0)
                return new { sampled = 0, ok, fail, skipped, samples };

            void consider(Element el, string kind)
            {
                if (samples.Count >= maxSamples || el == null) return;
                string u = Of(el);
                if (string.IsNullOrEmpty(u))
                {
                    skipped++;
                    return;
                }
                Element found = null;
                try { found = doc.GetElement(u); }
                catch { /* ignore */ }
                bool match = found != null && found.Id.Value == el.Id.Value;
                if (match) ok++;
                else fail++;
                samples.Add(new
                {
                    kind,
                    id = el.Id.Value,
                    uniqueId = u,
                    roundTripOk = match,
                });
            }

            foreach (Element el in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                if (samples.Count >= maxSamples / 2) break;
                consider(el, "instance");
            }
            foreach (Element el in new FilteredElementCollector(doc).WhereElementIsElementType())
            {
                if (samples.Count >= maxSamples) break;
                consider(el, "type");
            }

            return new { sampled = samples.Count, ok, fail, skipped, samples };
        }
    }
}
