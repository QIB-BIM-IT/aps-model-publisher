using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G412 — hygiène du modèle (Organisation Revit). Contrôle MODÈLE, hôte seul.
    ///
    /// Deux indicateurs dans UNE ligne :
    ///   1) Familles in place — Family.IsInPlace (API vérifiée 2024/2025) + instances.
    ///      Indicateur d'hygiène ; n'affecte le statut que si seuilFamillesInPlace en config.
    ///   2) Groupes miroir — PAS de Group.Mirrored dans l'API. Méthode retenue : consensus
    ///      FamilyInstance.Mirrored sur les membres FamilyInstance du groupe (voir
    ///      spike/model-hygiene/API_VERIFIED.md). Groupes sans FI = indéterminés (non fautifs).
    ///
    /// valeur_num = nbGroupesMiroir (indicateur à verdict strict, tolérance zéro).
    /// Ce contrôle ne mesure PAS la purge (Manuel) — G106 « Fichier purgé » reste hors outil.
    /// </summary>
    public class G412ModelHygieneExtractor : IControlExtractor
    {
        public string ControlCode => "G412";
        private const int MaxListe = 100;

        public ControlOutcome Extract(Document doc)
        {
            var inPlace = CollectInPlaceFamilies(doc);
            var mirror = CollectMirroredGroups(doc);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = mirror.NbMiroir,
                ValeurJson = new
                {
                    famillesInPlace = new
                    {
                        nbFamillesInPlace = inPlace.NbFamilles,
                        nbInstances = inPlace.NbInstances,
                        liste = inPlace.Liste.Take(MaxListe).ToList(),
                        listeTronquee = inPlace.Liste.Count > MaxListe,
                    },
                    groupesMiroir = new
                    {
                        nbGroupesMiroir = mirror.NbMiroir,
                        liste = mirror.ListeMiroir.Take(MaxListe).ToList(),
                        listeTronquee = mirror.ListeMiroir.Count > MaxListe,
                        nbIndetermines = mirror.NbIndetermines,
                        indetermines = mirror.ListeIndetermines.Take(MaxListe).ToList(),
                        methode = "FamilyInstance.Mirrored consensus sur membres FI",
                        noteApi = "Group/GroupType n'exposent pas de propriété Mirrored (2024/2025). "
                            + "Détection via consensus FamilyInstance.Mirrored des membres. "
                            + "Groupes sans FamilyInstance = indéterminés (non comptés comme miroir).",
                    },
                    note = "Statut piloté par groupes miroir (tolérance 0). Familles in place = hygiène complémentaire.",
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

            // Agrégation par Family.Id via les instances (IsInPlace sur Family).
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

            // Aussi les familles in place sans instance (rares mais possibles)
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

        // -------- Groupes miroir --------

        private sealed class MirrorResult
        {
            public int NbMiroir;
            public int NbIndetermines;
            public List<object> ListeMiroir = new List<object>();
            public List<object> ListeIndetermines = new List<object>();
        }

        private static MirrorResult CollectMirroredGroups(Document doc)
        {
            var result = new MirrorResult();

            foreach (Group group in new FilteredElementCollector(doc)
                .OfClass(typeof(Group))
                .Cast<Group>())
            {
                // Groupes attachés (detail attachés à un modèle) : inclus s'ils sont placés.
                MirrorVerdict v = ClassifyGroupMirror(doc, group);
                string nom = ResolveGroupName(group);
                long id = group.Id.Value;

                if (v == MirrorVerdict.Miroir)
                {
                    result.NbMiroir++;
                    result.ListeMiroir.Add(new { nomGroupe = nom, id = id });
                }
                else if (v == MirrorVerdict.Indetermine)
                {
                    result.NbIndetermines++;
                    result.ListeIndetermines.Add(new
                    {
                        nomGroupe = nom,
                        id = id,
                        raison = "aucun FamilyInstance membre (Mirror non lisible sans FI)",
                    });
                }
            }

            return result;
        }

        private enum MirrorVerdict { NonMiroir, Miroir, Indetermine }

        /// <summary>
        /// Consensus FamilyInstance.Mirrored sur les membres FI du groupe.
        /// - 0 FI → Indetermine (pas de Group.Mirrored API)
        /// - tous les FI Mirrored → Miroir
        /// - aucun FI Mirrored → NonMiroir
        /// - mixte → NonMiroir (évite faux positifs d'une FI miroir isolée dans un groupe normal)
        /// </summary>
        private static MirrorVerdict ClassifyGroupMirror(Document doc, Group group)
        {
            IList<ElementId> memberIds;
            try { memberIds = group.GetMemberIds(); }
            catch { return MirrorVerdict.Indetermine; }
            if (memberIds == null || memberIds.Count == 0)
                return MirrorVerdict.Indetermine;

            int fiCount = 0;
            int mirroredCount = 0;
            foreach (ElementId mid in memberIds)
            {
                Element el = doc.GetElement(mid);
                FamilyInstance fi = el as FamilyInstance;
                if (fi == null) continue;
                fiCount++;
                try
                {
                    if (fi.Mirrored) mirroredCount++;
                }
                catch
                {
                    // Certaines FI peuvent ne pas exposer Mirrored de façon fiable
                }
            }

            if (fiCount == 0) return MirrorVerdict.Indetermine;
            if (mirroredCount == fiCount) return MirrorVerdict.Miroir;
            return MirrorVerdict.NonMiroir;
        }

        private static string ResolveGroupName(Group group)
        {
            try
            {
                if (group.GroupType != null && !string.IsNullOrWhiteSpace(group.GroupType.Name))
                    return group.GroupType.Name;
            }
            catch { /* ignore */ }
            try
            {
                if (!string.IsNullOrWhiteSpace(group.Name))
                    return group.Name;
            }
            catch { /* ignore */ }
            return "id:" + group.Id.Value;
        }
    }
}
