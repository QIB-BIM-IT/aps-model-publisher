using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G314 — rattachement au niveau (RÉVISION). Contrôle MODÈLE, hôte seul.
    ///
    /// ANCIENNE MÉTHODE (retirée) : calcul géométrique d'un « niveau physique » depuis Z
    /// → ~90 % de faux positifs MEP (décalages plafond / niveaux techniques).
    ///
    /// NOUVELLE MÉTHODE : paramètres NATIFS + table de plages d'étages (Building Story),
    /// trois familles détectées par élément :
    ///   C — Base Level + Top Level (colonnes) : cohérence Top &gt; Base (multi-étages OK) ;
    ///   B — LocationCurve (filaires) : plages des extrémités ; multi-niveaux écarté ;
    ///   A — Level + Offset (ponctuels) : élévation effective dans la plage du niveau déclaré.
    ///
    /// Plages semi-ouvertes [E_i, E_{i+1}) ; dernier niveau = borne basse seule.
    /// Tolérance défaut 0 (arithmétique exacte). Pas de repli Element.LevelId.
    /// Voir spike/level-attachment/API_VERIFIED.md.
    /// </summary>
    public class G314LevelAttachmentExtractor : IControlExtractor
    {
        public string ControlCode => "G314";
        private const int MaxFautifs = 100;

        // Niveau déclaré (Familles A/B) — contraintes d'hôte / référence d'abord.
        // INSTANCE_SCHEDULE_ONLY_LEVEL_PARAM en dernier : peut différer du niveau de contrainte.
        // RBS_REFERENCE_LEVEL_PARAM absent des DLL 2024/2025.
        private static readonly BuiltInParameter[] LevelParams =
        {
            BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM,
            BuiltInParameter.FAMILY_LEVEL_PARAM,
            BuiltInParameter.RBS_START_LEVEL_PARAM,
            BuiltInParameter.SCHEDULE_LEVEL_PARAM,
            BuiltInParameter.WALL_BASE_CONSTRAINT,
            BuiltInParameter.STAIRS_BASE_LEVEL_PARAM,
            BuiltInParameter.ROOF_CONSTRAINT_LEVEL_PARAM,
            BuiltInParameter.INSTANCE_SCHEDULE_ONLY_LEVEL_PARAM,
        };

        // Offset vertical (Famille A) — vrais offsets d'abord.
        // INSTANCE_ELEVATION_PARAM en dernier : parfois élévation absolue (pas un décalage).
        private static readonly BuiltInParameter[] OffsetParams =
        {
            BuiltInParameter.INSTANCE_FREE_HOST_OFFSET_PARAM,
            BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM,
            BuiltInParameter.RBS_OFFSET_PARAM,
            BuiltInParameter.RBS_START_OFFSET_PARAM,
            BuiltInParameter.SCHEDULE_BASE_LEVEL_OFFSET_PARAM,
            BuiltInParameter.ASSOCIATED_LEVEL_OFFSET,
            BuiltInParameter.INSTANCE_OFFSET_POS_PARAM,
            BuiltInParameter.INSTANCE_ELEVATION_PARAM,
        };

        // Bruit arithmétique min (tolérance config 0) — ~0.01 mm en unités internes.
        private const double FloorEpsMm = 0.01;

        // Famille C — paires Base/Top (vérifiées présentes 2024/2025).
        private static readonly BuiltInParameter[][] BaseTopPairs =
        {
            new[] { BuiltInParameter.FAMILY_BASE_LEVEL_PARAM, BuiltInParameter.FAMILY_TOP_LEVEL_PARAM },
            new[] { BuiltInParameter.SCHEDULE_BASE_LEVEL_PARAM, BuiltInParameter.SCHEDULE_TOP_LEVEL_PARAM },
        };

        private readonly G314Config _cfg;

        public G314LevelAttachmentExtractor(G314Config cfg)
        {
            _cfg = cfg;
        }

        public ControlOutcome Extract(Document doc)
        {
            // Défaut 0 : la méthode par paramètres est arithmétique ; tolérance optionnelle.
            double toleranceMm = 0;
            if (_cfg != null && _cfg.ToleranceMm >= 0)
                toleranceMm = _cfg.ToleranceMm;
            double tol = UnitUtils.ConvertToInternalUnits(toleranceMm, UnitTypeId.Millimeters);

            double hauteurMinMm = 2000;
            if (_cfg != null && _cfg.HauteurMinEtageMm >= 0)
                hauteurMinMm = _cfg.HauteurMinEtageMm;

            var mepCats = ResolveCats(_cfg != null ? _cfg.CategoriesMep : null);
            var structCats = ResolveCats(_cfg != null ? _cfg.CategoriesStructure : null);

            List<StoryRange> ranges = BuildStoryRanges(doc, hauteurMinMm);
            var counts = new Totals();
            var fautifs = new List<object>();
            bool tronque = false;

            foreach (BuiltInCategory bic in mepCats)
                AuditCategory(doc, bic, "mep", ranges, tol, counts, fautifs, ref tronque);
            foreach (BuiltInCategory bic in structCats)
                AuditCategory(doc, bic, "structure", ranges, tol, counts, fautifs, ref tronque);

            int evaluables = counts.Conformes + counts.Fautifs;
            double? pct = evaluables == 0 ? (double?)null : Pct(counts.Conformes, evaluables);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = pct,
                ValeurJson = new
                {
                    methode = "plages-etages-parametres-natifs",
                    toleranceMm = toleranceMm,
                    hauteurMinEtageMm = hauteurMinMm,
                    niveauxUtilises = ranges.Count,
                    plages = ranges.Select(r => new
                    {
                        niveau = r.Level.Name,
                        basMm = Round1(Mm(r.Low)),
                        hautMm = r.High.HasValue ? (double?)Round1(Mm(r.High.Value)) : null,
                    }).ToList(),
                    evaluables = evaluables,
                    conformes = counts.Conformes,
                    fautifs = counts.Fautifs,
                    multiNiveaux = counts.MultiNiveaux,
                    nonEvaluables = counts.NonEvaluables,
                    pourcentageConformite = pct,
                    parFamille = new
                    {
                        A = counts.A.ToJson(),
                        B = counts.B.ToJson(),
                        C = counts.C.ToJson(),
                    },
                    parGroupe = new
                    {
                        mep = counts.Mep.ToJson(),
                        structure = counts.Structure.ToJson(),
                    },
                    fautifsDetail = new
                    {
                        total = counts.Fautifs,
                        liste = fautifs,
                        listeTronquee = tronque,
                    },
                    note = "Méthode par paramètres natifs + plages Building Story (borne semi-ouverte, hauteurMinEtageMm filtre les niveaux techniques serrés). Indicatif : sans cible/seuil => statut NULL. Ancienne méthode géométrique retirée.",
                },
            };
        }

        // ======== Collecte / plages ========

        private static List<BuiltInCategory> ResolveCats(List<string> names)
        {
            var cats = new List<BuiltInCategory>();
            if (names == null) return cats;
            foreach (string s in names)
            {
                if (Enum.TryParse(s, false, out BuiltInCategory bic) && Enum.IsDefined(typeof(BuiltInCategory), bic))
                    cats.Add(bic);
            }
            return cats;
        }

        private static List<StoryRange> BuildStoryRanges(Document doc, double hauteurMinEtageMm)
        {
            List<Level> all = new FilteredElementCollector(doc)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .OrderBy(l => l.Elevation)
                .ToList();

            var building = new List<Level>();
            foreach (Level level in all)
            {
                Parameter p = level.get_Parameter(BuiltInParameter.LEVEL_IS_BUILDING_STORY);
                if (p != null && p.HasValue && p.AsInteger() == 1)
                    building.Add(level);
            }
            List<Level> candidates = building.Count > 0 ? building : all;

            // Filtre des niveaux techniques trop serrés : on ne retient un niveau comme
            // borne d'étage que s'il est à >= hauteurMinEtageMm au-dessus du précédent retenu.
            // hauteurMinEtageMm = 0 → aucun filtre (tous les Building Story).
            double minGap = UnitUtils.ConvertToInternalUnits(hauteurMinEtageMm, UnitTypeId.Millimeters);
            var levels = new List<Level>();
            foreach (Level lvl in candidates)
            {
                if (levels.Count == 0)
                {
                    levels.Add(lvl);
                    continue;
                }
                if (hauteurMinEtageMm <= 0 || lvl.Elevation - levels[levels.Count - 1].Elevation >= minGap)
                    levels.Add(lvl);
            }
            if (levels.Count == 0)
                levels = candidates;

            var ranges = new List<StoryRange>();
            for (int i = 0; i < levels.Count; i++)
            {
                double? high = i + 1 < levels.Count ? (double?)levels[i + 1].Elevation : null;
                ranges.Add(new StoryRange { Level = levels[i], Low = levels[i].Elevation, High = high });
            }
            return ranges;
        }

        private static int FindRangeIndex(List<StoryRange> ranges, double z, double tol)
        {
            // Convention semi-ouverte : z pile à High appartient au niveau SUIVANT.
            for (int i = 0; i < ranges.Count; i++)
            {
                StoryRange r = ranges[i];
                if (z < r.Low - tol) continue;
                if (!r.High.HasValue) return i; // dernier : borne basse seule
                if (tol <= 0)
                {
                    if (z < r.High.Value) return i;
                }
                else if (z < r.High.Value + tol)
                {
                    // Avec tolérance : si z est dans la zone ambiguë autour de High,
                    // préférer le niveau suivant si z >= High.
                    if (z >= r.High.Value && i + 1 < ranges.Count) return i + 1;
                    return i;
                }
            }
            return -1;
        }

        private static bool SameLevelId(Level a, Level b)
        {
            if (a == null || b == null) return false;
            return a.Id.Value == b.Id.Value;
        }

        private static int IndexOfLevel(List<StoryRange> ranges, Level level)
        {
            if (level == null) return -1;
            for (int i = 0; i < ranges.Count; i++)
            {
                if (SameLevelId(ranges[i].Level, level)) return i;
            }
            // Niveau déclaré hors Building Story : rattacher par élévation
            return FindRangeIndex(ranges, level.Elevation, 0);
        }

        /// <summary>
        /// CONFORME si effectiveZ ∈ [Low, High) du niveau déclaré (High absente = dernier).
        /// Borne basse : tolérance config + eps plancher (bruit AsDouble / arrondi mm).
        /// Borne haute : semi-ouverte stricte (z == High → niveau suivant), eps n'élargit PAS High.
        /// </summary>
        private static bool ElevationInStoryRange(StoryRange range, double effectiveZ, double tol)
        {
            if (range == null) return false;
            double floorTol = Math.Max(tol, UnitUtils.ConvertToInternalUnits(FloorEpsMm, UnitTypeId.Millimeters));
            if (effectiveZ < range.Low - floorTol) return false;
            if (!range.High.HasValue) return true;
            // Semi-ouverte : High exclue. La tolérance config élargit sous High, jamais au-delà.
            if (tol <= 0) return effectiveZ < range.High.Value;
            if (effectiveZ >= range.High.Value) return false;
            return effectiveZ < range.High.Value + tol;
        }

        // ======== Audit ========

        private void AuditCategory(
            Document doc, BuiltInCategory bic, string groupe,
            List<StoryRange> ranges, double tol,
            Totals counts, List<object> fautifs, ref bool tronque)
        {
            if (ranges.Count == 0) return;

            foreach (Element el in new FilteredElementCollector(doc)
                .OfCategory(bic)
                .WhereElementIsNotElementType()
                .ToElements())
            {
                char famille = DetectFamily(el);
                Bucket bucket = famille == 'C' ? counts.C : famille == 'B' ? counts.B : counts.A;
                Bucket groupeB = groupe == "mep" ? counts.Mep : counts.Structure;

                Outcome outcome;
                if (famille == 'C')
                    outcome = EvaluateFamilyC(doc, el, ranges);
                else if (famille == 'B')
                    outcome = EvaluateFamilyB(doc, el, ranges, tol);
                else
                    outcome = EvaluateFamilyA(doc, el, ranges, tol);

                ApplyOutcome(outcome, counts, bucket, groupeB);

                if (outcome.Status == Status.Fautif)
                {
                    if (fautifs.Count < MaxFautifs)
                        fautifs.Add(BuildFautifJson(doc, el, famille, groupe, outcome, ranges));
                    else
                        tronque = true;
                }
            }
        }

        private static char DetectFamily(Element el)
        {
            if (HasBaseAndTop(el)) return 'C';
            if (el.Location is LocationCurve) return 'B';
            return 'A';
        }

        private static bool HasBaseAndTop(Element el)
        {
            foreach (BuiltInParameter[] pair in BaseTopPairs)
            {
                if (ReadLevelParam(el, pair[0]) != null && ReadLevelParam(el, pair[1]) != null)
                    return true;
            }
            return false;
        }

        // ---- Famille A : Level + Offset ----

        private static Outcome EvaluateFamilyA(Document doc, Element el, List<StoryRange> ranges, double tol)
        {
            Level declared = GetDeclaredLevel(doc, el);
            if (declared == null)
                return Outcome.NonEval("pas de paramètre de niveau déclaré");

            int idx = IndexOfLevel(ranges, declared);
            if (idx < 0)
                return Outcome.NonEval("niveau déclaré hors table de plages");

            double offset = GetOffset(el); // 0 si absent
            double effective = declared.Elevation + offset;
            StoryRange range = ranges[idx];

            // Sur le plan du niveau déclaré (offset ~ 0) et plage = ce niveau → toujours dans
            // [Low, High) par convention de borne basse INCLUSE (évite faux positifs de bruit).
            double floorTol = Math.Max(tol, UnitUtils.ConvertToInternalUnits(FloorEpsMm, UnitTypeId.Millimeters));
            bool onDeclaredPlane = SameLevelId(range.Level, declared) && Math.Abs(offset) <= floorTol;
            bool ok = onDeclaredPlane || ElevationInStoryRange(range, effective, tol);

            if (ok)
                return Outcome.Ok('A', declared, offset, effective, range);

            string raison = effective < range.Low - floorTol
                ? "sous_niveau"
                : "depassement_haut";
            return Outcome.Fail('A', declared, offset, effective, range, raison: raison);
        }

        // ---- Famille B : LocationCurve ----

        private static Outcome EvaluateFamilyB(Document doc, Element el, List<StoryRange> ranges, double tol)
        {
            LocationCurve lc = el.Location as LocationCurve;
            if (lc == null || lc.Curve == null)
                return Outcome.NonEval("LocationCurve illisible");

            XYZ a, b;
            try
            {
                a = lc.Curve.GetEndPoint(0);
                b = lc.Curve.GetEndPoint(1);
            }
            catch
            {
                return Outcome.NonEval("extrémités de courbe illisibles");
            }

            int i0 = FindRangeIndex(ranges, a.Z, tol);
            int i1 = FindRangeIndex(ranges, b.Z, tol);
            if (i0 < 0 || i1 < 0)
                return Outcome.NonEval("extrémité hors plages d'étages");

            if (i0 != i1)
                return Outcome.Multi('B');

            Level declared = GetDeclaredLevel(doc, el);
            if (declared == null)
                return Outcome.NonEval("pas de paramètre de niveau déclaré");

            int idxDeclared = IndexOfLevel(ranges, declared);
            if (idxDeclared < 0)
                return Outcome.NonEval("niveau déclaré hors table de plages");

            // Même plage physique pour les deux extrémités : conforme ssi cette plage
            // est celle du niveau déclaré (équivalent Famille A sans dépendre d'un offset
            // filaire parfois absent — la plage des extrémités EST la mesure).
            double midZ = (a.Z + b.Z) / 2.0;
            StoryRange range = ranges[idxDeclared];
            bool ok = idxDeclared == i0 && ElevationInStoryRange(range, midZ, tol);

            double offset = midZ - declared.Elevation;
            if (ok)
                return Outcome.Ok('B', declared, offset, midZ, range);

            string raison = idxDeclared != i0
                ? "plage_extremites_differente_du_niveau_declare"
                : (midZ < range.Low ? "sous_niveau" : "depassement_haut");
            return Outcome.Fail('B', declared, offset, midZ, range, raison: raison);
        }

        // ---- Famille C : Base + Top ----

        private static Outcome EvaluateFamilyC(Document doc, Element el, List<StoryRange> ranges)
        {
            Level baseLvl = null, topLvl = null;
            foreach (BuiltInParameter[] pair in BaseTopPairs)
            {
                ElementId bId = ReadLevelParam(el, pair[0]);
                ElementId tId = ReadLevelParam(el, pair[1]);
                if (bId == null || tId == null) continue;
                baseLvl = doc.GetElement(bId) as Level;
                topLvl = doc.GetElement(tId) as Level;
                if (baseLvl != null && topLvl != null) break;
                baseLvl = topLvl = null;
            }

            if (baseLvl == null || topLvl == null)
                return Outcome.Fail('C', null, 0, 0, null, baseLvl, topLvl, "base/top manquant ou invalide");

            // Multi-étages OK ; seule la cohérence Top > Base est exigée.
            if (topLvl.Elevation <= baseLvl.Elevation)
                return Outcome.Fail('C', null, 0, 0, null, baseLvl, topLvl, "Top Level <= Base Level");

            return Outcome.OkC(baseLvl, topLvl);
        }

        // ======== Lecture paramètres ========

        private static Level GetDeclaredLevel(Document doc, Element el)
        {
            // PAS de repli Element.LevelId (spécification révision).
            foreach (BuiltInParameter bip in LevelParams)
            {
                ElementId id = ReadLevelParam(el, bip);
                if (id == null) continue;
                Level lvl = doc.GetElement(id) as Level;
                if (lvl != null) return lvl;
            }
            return null;
        }

        private static ElementId ReadLevelParam(Element el, BuiltInParameter bip)
        {
            Parameter p = el.get_Parameter(bip);
            if (p == null || p.StorageType != StorageType.ElementId) return null;
            ElementId id = p.AsElementId();
            if (id == null || id == ElementId.InvalidElementId) return null;
            return id;
        }

        private static double GetOffset(Element el)
        {
            foreach (BuiltInParameter bip in OffsetParams)
            {
                Parameter p = el.get_Parameter(bip);
                if (p == null || p.StorageType != StorageType.Double) continue;
                if (!p.HasValue) continue;
                return p.AsDouble(); // unités internes
            }
            return 0;
        }

        // ======== JSON fautif / compteurs ========

        private static object BuildFautifJson(
            Document doc, Element el, char famille, string groupe,
            Outcome o, List<StoryRange> ranges)
        {
            string familleRevit, typeName;
            GetFamilyType(doc, el, out familleRevit, out typeName);

            if (famille == 'C')
            {
                return new
                {
                    id = el.Id.Value,
                    famille = "C",
                    groupe = groupe,
                    categorie = el.Category != null ? el.Category.Name : null,
                    familleRevit = familleRevit,
                    type = typeName,
                    baseLevel = o.BaseLevel != null ? o.BaseLevel.Name : null,
                    topLevel = o.TopLevel != null ? o.TopLevel.Name : null,
                    raison = o.Raison,
                };
            }

            return new
            {
                id = el.Id.Value,
                famille = famille.ToString(),
                groupe = groupe,
                categorie = el.Category != null ? el.Category.Name : null,
                familleRevit = familleRevit,
                type = typeName,
                niveauDeclare = o.Declared != null ? o.Declared.Name : null,
                niveauPlage = o.Range != null && o.Range.Level != null ? o.Range.Level.Name : null,
                decalageMm = Round1(Mm(o.Offset)),
                elevationEffectiveMm = Round1(Mm(o.EffectiveZ)),
                plageNiveauMm = o.Range == null ? null : new
                {
                    bas = Round1(Mm(o.Range.Low)),
                    haut = o.Range.High.HasValue ? (double?)Round1(Mm(o.Range.High.Value)) : null,
                },
                raison = o.Raison,
            };
        }

        private static void GetFamilyType(Document doc, Element el, out string famille, out string typeName)
        {
            famille = null;
            typeName = null;
            try
            {
                FamilyInstance fi = el as FamilyInstance;
                if (fi != null && fi.Symbol != null)
                {
                    famille = fi.Symbol.Family != null ? fi.Symbol.Family.Name : null;
                    typeName = fi.Symbol.Name;
                }
            }
            catch { /* ignore */ }
            if (typeName == null)
            {
                Element te = doc.GetElement(el.GetTypeId());
                ElementType et = te as ElementType;
                if (et != null)
                {
                    if (famille == null) famille = et.FamilyName;
                    typeName = et.Name;
                }
            }
        }

        private static void ApplyOutcome(Outcome o, Totals totals, Bucket famille, Bucket groupe)
        {
            switch (o.Status)
            {
                case Status.Conforme:
                    totals.Conformes++; famille.Conformes++; groupe.Conformes++; break;
                case Status.Fautif:
                    totals.Fautifs++; famille.Fautifs++; groupe.Fautifs++; break;
                case Status.Multi:
                    totals.MultiNiveaux++; famille.MultiNiveaux++; groupe.MultiNiveaux++; break;
                default:
                    totals.NonEvaluables++; famille.NonEvaluables++; groupe.NonEvaluables++; break;
            }
        }

        private static double Mm(double internalUnits)
        {
            return UnitUtils.ConvertFromInternalUnits(internalUnits, UnitTypeId.Millimeters);
        }

        private static double Round1(double v) { return Math.Round(v, 1); }

        private static double Pct(int num, int denom)
        {
            if (denom == 0) return 100.0;
            if (num == denom) return 100.0;
            return Math.Floor((double)num / denom * 10000.0) / 100.0;
        }

        // ======== Types internes ========

        private sealed class StoryRange
        {
            public Level Level;
            public double Low;
            public double? High; // null = dernier niveau (pas de borne haute)
        }

        private enum Status { Conforme, Fautif, Multi, NonEval }

        private sealed class Outcome
        {
            public Status Status;
            public char Famille;
            public Level Declared;
            public Level BaseLevel;
            public Level TopLevel;
            public double Offset;
            public double EffectiveZ;
            public StoryRange Range;
            public string Raison;

            public static Outcome Ok(char f, Level d, double off, double z, StoryRange r)
            {
                return new Outcome { Status = Status.Conforme, Famille = f, Declared = d, Offset = off, EffectiveZ = z, Range = r };
            }
            public static Outcome Fail(char f, Level d, double off, double z, StoryRange r, Level b = null, Level t = null, string raison = null)
            {
                return new Outcome { Status = Status.Fautif, Famille = f, Declared = d, Offset = off, EffectiveZ = z, Range = r, BaseLevel = b, TopLevel = t, Raison = raison };
            }
            public static Outcome Multi(char f)
            {
                return new Outcome { Status = Status.Multi, Famille = f };
            }
            public static Outcome NonEval(string raison)
            {
                return new Outcome { Status = Status.NonEval, Raison = raison };
            }
            public static Outcome OkC(Level b, Level t)
            {
                return new Outcome { Status = Status.Conforme, Famille = 'C', BaseLevel = b, TopLevel = t };
            }
        }

        private sealed class Bucket
        {
            public int Conformes, Fautifs, MultiNiveaux, NonEvaluables;
            public object ToJson()
            {
                return new
                {
                    evaluables = Conformes + Fautifs,
                    conformes = Conformes,
                    fautifs = Fautifs,
                    multiNiveaux = MultiNiveaux,
                    nonEvaluables = NonEvaluables,
                };
            }
        }

        private sealed class Totals
        {
            public int Conformes, Fautifs, MultiNiveaux, NonEvaluables;
            public readonly Bucket A = new Bucket();
            public readonly Bucket B = new Bucket();
            public readonly Bucket C = new Bucket();
            public readonly Bucket Mep = new Bucket();
            public readonly Bucket Structure = new Bucket();
        }
    }
}
