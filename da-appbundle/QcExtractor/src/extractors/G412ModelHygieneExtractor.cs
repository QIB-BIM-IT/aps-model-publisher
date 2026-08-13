using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G412 — hygiène du modèle (Organisation Revit). Contrôle MODÈLE, hôte seul.
    ///
    /// Trois indicateurs (mesures exactes, aucune heuristique) :
    ///   1) Familles in place — Family.IsInPlace + instances (INDICATIF).
    ///   2) Total de types de groupes (+ instances) — INDICATIF (tendance jalon).
    ///   3) Groupes à instance unique — GroupType.Groups.Size == 1 (TOLÉRANCE ZÉRO,
    ///      pilote le statut). Un type placé une seule fois devrait être explosé.
    ///
    /// RETRAIT : groupes miroir (pas de Group.Mirrored en API ; heuristique FI retirée).
    /// valeur_num = nbGroupesInstanceUnique. Voir spike/model-hygiene/API_VERIFIED.md.
    /// Purge = Manuel hors outil (pas G106).
    /// </summary>
    public class G412ModelHygieneExtractor : IControlExtractor
    {
        public string ControlCode => "G412";
        private const int MaxListe = DesignatedElementLimits.SafetyCapPerControl;

        public ControlOutcome Extract(Document doc)
        {
            var inPlace = CollectInPlaceFamilies(doc);
            var groupes = CollectGroupStats(doc);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = groupes.NbInstanceUnique,
                ValeurJson = new
                {
                    famillesInPlace = new
                    {
                        nbFamillesInPlace = inPlace.NbFamilles,
                        nbInstances = inPlace.NbInstances,
                        liste = inPlace.Liste.Take(MaxListe).ToList(),
                        listeTronquee = inPlace.Liste.Count > MaxListe,
                    },
                    groupes = new
                    {
                        nbTypesGroupes = groupes.NbTypes,
                        nbInstancesGroupesTotal = groupes.NbInstancesTotal,
                        nbGroupesInstanceUnique = groupes.NbInstanceUnique,
                        listeInstanceUnique = groupes.ListeUnique.Take(MaxListe).ToList(),
                        listeTronquee = groupes.ListeUnique.Count > MaxListe,
                    },
                    note = "Statut piloté par groupes à instance unique (tolérance 0, mesure exacte GroupType.Groups.Size==1). "
                        + "Familles in place et total de groupes = indicateurs complémentaires. "
                        + "Indicateur groupes miroir RETIRÉ (pas d'API Group.Mirrored fiable).",
                },
            };
        }

        // -------- Familles in place --------

        private sealed class InPlaceResult
        {
            public int NbFamilles;
            public int NbInstances;
            public List<object> Liste = new List<object>();
        }

        private static InPlaceResult CollectInPlaceFamilies(Document doc)
        {
            var result = new InPlaceResult();

            var groups = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilyInstance))
                .Cast<FamilyInstance>()
                .Where(fi =>
                {
                    try
                    {
                        Family fam = fi.Symbol != null ? fi.Symbol.Family : null;
                        return fam != null && fam.IsInPlace;
                    }
                    catch
                    {
                        return false;
                    }
                })
                .GroupBy(fi => fi.Symbol.Family.Id.Value)
                .ToList();

            var seen = new HashSet<long>(groups.Select(g => g.Key));
            foreach (Family fam in new FilteredElementCollector(doc).OfClass(typeof(Family)).Cast<Family>())
            {
                if (!fam.IsInPlace) continue;
                long id = fam.Id.Value;
                if (seen.Contains(id)) continue;
                result.Liste.Add(new { famille = fam.Name, nbInstances = 0, id = id });
                result.NbFamilles++;
            }

            foreach (var g in groups.OrderByDescending(x => x.Count()).ThenBy(x =>
            {
                try { return x.First().Symbol.Family.Name; }
                catch { return ""; }
            }))
            {
                string name;
                try { name = g.First().Symbol.Family.Name; }
                catch { name = "id:" + g.Key; }
                int n = g.Count();
                result.Liste.Add(new { famille = name, nbInstances = n, id = g.Key });
                result.NbFamilles++;
                result.NbInstances += n;
            }

            return result;
        }

        // -------- Groupes (types / instances / instance unique) --------

        private sealed class GroupStats
        {
            public int NbTypes;
            public int NbInstancesTotal;
            public int NbInstanceUnique;
            public List<object> ListeUnique = new List<object>();
        }

        /// <summary>
        /// Parcourt les GroupType (comme G411 / script pyRevit) :
        /// - Size == 0 : type inutilisé (compté dans nbTypes, pas dans instance unique)
        /// - Size == 1 : groupe à instance unique (défaut franc)
        /// - Size &gt; 1 : type réutilisé (OK pour le verdict strict)
        /// </summary>
        private static GroupStats CollectGroupStats(Document doc)
        {
            var result = new GroupStats();

            foreach (GroupType gt in new FilteredElementCollector(doc)
                .OfClass(typeof(GroupType))
                .Cast<GroupType>()
                .OrderBy(t => t.Name))
            {
                result.NbTypes++;
                GroupSet set = gt.Groups;
                int nInst = set != null ? set.Size : 0;
                result.NbInstancesTotal += nInst;

                if (nInst != 1) continue;

                Group instance = FirstGroup(set);
                int nbMembres = 0;
                bool pinned = false;
                bool viewSpecific = false;
                long idInstance = 0;
                if (instance != null)
                {
                    idInstance = instance.Id.Value;
                    try
                    {
                        IList<ElementId> members = instance.GetMemberIds();
                        nbMembres = members != null ? members.Count : 0;
                    }
                    catch { /* ignore */ }
                    try { pinned = instance.Pinned; } catch { /* ignore */ }
                    try { viewSpecific = instance.ViewSpecific; } catch { /* ignore */ }
                }

                string categorie = null;
                try
                {
                    if (gt.Category != null) categorie = gt.Category.Name;
                }
                catch { /* ignore */ }

                result.NbInstanceUnique++;
                result.ListeUnique.Add(new
                {
                    nomType = gt.Name,
                    categorie = categorie,
                    nbMembres = nbMembres,
                    pinned = pinned,
                    viewSpecific = viewSpecific,
                    idType = gt.Id.Value,
                    idInstance = idInstance,
                });
            }

            return result;
        }

        private static Group FirstGroup(GroupSet set)
        {
            if (set == null) return null;
            foreach (Group g in set)
                return g;
            return null;
        }
    }
}
