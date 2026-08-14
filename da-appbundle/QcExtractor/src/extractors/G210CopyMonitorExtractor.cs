using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G210 — copie-contrôle des axes (Grid) et niveaux (Level).
    /// Contrôle MODÈLE (hôte SEUL, SANS GetLinkDocument / sans charger de lien).
    ///
    /// API vérifiée identique 2024/2025 (spike/SPIKE_COORDINATION_REVIEW.md + ApiDump) :
    ///   Element.IsMonitoringLinkElement()
    ///   Element.GetMonitoredLinkElementIds() → IList&lt;ElementId&gt;
    /// Les ElementId retournés désignent des RevitLinkInstance sur l'hôte (forums Autodesk
    /// + résolution runtime via doc.GetElement). Le NOM de l'instance est lisible via
    /// Element.Name SANS appeler GetLinkDocument(). Si la résolution échoue, on rapporte
    /// l'identifiant (ElementId.Value) — jamais de chargement de lien.
    ///
    /// Ce contrôle mesure la PRÉSENCE de la relation de monitoring, PAS sa fraîcheur
    /// (l'état « revue de coordination en attente » n'est pas lisible — hors périmètre).
    ///
    /// Exceptions de niveaux : liste fournie par le backend (norme maison + surcharge
    /// projet). Comparaison ROBUSTE : Trim + OrdinalIgnoreCase. Un niveau exclu n'entre
    /// PAS dans la conformité (ni fautif ni requis) mais apparaît dans le rapport avec
    /// l'état « exclu ».
    /// </summary>
    public class G210CopyMonitorExtractor : IControlExtractor
    {
        public string ControlCode => "G210";
        private const int MaxNomsListes = DesignatedElementLimits.SafetyCapPerControl;

        private readonly G210Config _cfg;

        public G210CopyMonitorExtractor(G210Config cfg)
        {
            _cfg = cfg;
        }

        public ControlOutcome Extract(Document doc)
        {
            // Exclusion : trim + insensible à la casse (choix documenté — les noms de
            // niveaux techniques varient souvent en casse / espaces bord).
            var exclusSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (_cfg != null && _cfg.NiveauxExclus != null)
            {
                foreach (string n in _cfg.NiveauxExclus)
                {
                    if (string.IsNullOrWhiteSpace(n)) continue;
                    exclusSet.Add(n.Trim());
                }
            }

            CategoryReport axes = AuditCategory(
                doc,
                new FilteredElementCollector(doc).OfClass(typeof(Grid)).ToElements(),
                exclusSet,
                appliquerExclusions: false);

            CategoryReport niveaux = AuditCategory(
                doc,
                new FilteredElementCollector(doc).OfClass(typeof(Level)).ToElements(),
                exclusSet,
                appliquerExclusions: true);

            int soumis = axes.SoumisAudit + niveaux.SoumisAudit;
            int monitores = axes.Monitores + niveaux.Monitores;
            bool vacuite = soumis == 0;
            double pct = vacuite ? 0.0 : Pct(monitores, soumis);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = vacuite ? (double?)null : pct,
                ValeurJson = new
                {
                    vacuite = vacuite,
                    niveauxExclusConfig = exclusSet.OrderBy(x => x).ToList(),
                    axes = axes.ToJson(inclureExclus: false),
                    niveaux = niveaux.ToJson(inclureExclus: true),
                    global = new
                    {
                        soumisAudit = soumis,
                        monitores = monitores,
                        nonMonitoresFautifs = axes.NonMonitores + niveaux.NonMonitores,
                        pourcentage = vacuite ? (double?)null : pct,
                    },
                },
            };
        }

        private static CategoryReport AuditCategory(
            Document doc, IList<Element> elements, HashSet<string> exclusSet, bool appliquerExclusions)
        {
            var report = new CategoryReport { Total = elements.Count };
            var repartition = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            foreach (Element el in elements)
            {
                string nom = el.Name ?? string.Empty;
                string nomTrim = nom.Trim();

                if (appliquerExclusions && exclusSet.Contains(nomTrim))
                {
                    report.ExclusNoms.Add(nom);
                    continue;
                }

                report.SoumisAudit++;
                bool monitoré = el.IsMonitoringLinkElement();
                if (monitoré)
                {
                    report.Monitores++;
                    IList<ElementId> linkIds = el.GetMonitoredLinkElementIds();
                    if (linkIds != null)
                    {
                        foreach (ElementId lid in linkIds)
                        {
                            string cle = ResolveLinkLabel(doc, lid);
                            if (!repartition.ContainsKey(cle)) repartition[cle] = 0;
                            repartition[cle]++;
                        }
                    }
                }
                else
                {
                    report.NonMonitores++;
                    report.FautifsNoms.Add(nom);
                    report.FautifsIds.Add(el.Id.Value);
                    report.FautifsUniqueIds.Add(UniqueIds.Of(el));
                }
            }

            report.RepartitionParLien = repartition
                .OrderBy(kv => kv.Key)
                .Select(kv => (object)new { lien = kv.Key, count = kv.Value })
                .ToList();
            return report;
        }

        /// <summary>
        /// Résout le libellé du lien source SANS charger le document lié.
        /// GetMonitoredLinkElementIds() renvoie des ElementId d'instances de lien sur
        /// l'hôte ; doc.GetElement + Element.Name suffisent. Jamais GetLinkDocument().
        /// </summary>
        private static string ResolveLinkLabel(Document doc, ElementId linkId)
        {
            if (linkId == null || linkId == ElementId.InvalidElementId)
                return "id:invalid";
            Element el = doc.GetElement(linkId);
            if (el is RevitLinkInstance)
            {
                // Nom de l'instance sur l'hôte — lisible sans GetLinkDocument().
                string n = el.Name;
                return string.IsNullOrWhiteSpace(n) ? ("id:" + linkId.Value) : n;
            }
            if (el != null && !string.IsNullOrWhiteSpace(el.Name))
                return el.Name;
            return "id:" + linkId.Value;
        }

        private static double Pct(int num, int denom)
        {
            if (denom == 0) return 100.0;
            if (num == denom) return 100.0;
            return Math.Floor((double)num / denom * 10000.0) / 100.0;
        }

        private sealed class CategoryReport
        {
            public int Total;
            public int SoumisAudit;
            public int Monitores;
            public int NonMonitores;
            public readonly List<string> FautifsNoms = new List<string>();
            public readonly List<long> FautifsIds = new List<long>();
            public readonly List<string> FautifsUniqueIds = new List<string>();
            public readonly List<string> ExclusNoms = new List<string>();
            public List<object> RepartitionParLien = new List<object>();

            public object ToJson(bool inclureExclus)
            {
                bool tronque = FautifsNoms.Count > MaxNomsListes;
                var json = new Dictionary<string, object>
                {
                    ["total"] = Total,
                    ["soumisAudit"] = SoumisAudit,
                    ["monitores"] = Monitores,
                    ["nonMonitoresFautifs"] = new
                    {
                        total = NonMonitores,
                        noms = FautifsNoms.Take(MaxNomsListes).ToList(),
                        ids = FautifsIds.Take(MaxNomsListes).ToList(),
                        uniqueIds = FautifsUniqueIds.Take(MaxNomsListes).ToList(),
                        listeTronquee = tronque,
                    },
                    ["repartitionParLien"] = RepartitionParLien,
                };
                if (inclureExclus)
                {
                    json["exclus"] = new
                    {
                        total = ExclusNoms.Count,
                        noms = ExclusNoms.OrderBy(n => n).ToList(),
                    };
                }
                return json;
            }
        }
    }
}
