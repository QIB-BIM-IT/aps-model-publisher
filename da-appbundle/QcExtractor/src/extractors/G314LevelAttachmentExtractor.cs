using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G314 — rattachement au niveau (déclaré vs physique). Contrôle MODÈLE, hôte seul.
    /// Portage headless du script pyRevit éprouvé (logique métier conservée) :
    ///   - niveau physique = niveau le plus ÉLEVÉ situé SOUS le point de référence
    ///     (PAS le plus proche), avec tolérance de limite ;
    ///   - priorité Building Story (via BuiltInParameter.LEVEL_IS_BUILDING_STORY —
    ///     voir spike/level-attachment/API_VERIFIED.md), repli sur tous les niveaux ;
    ///   - niveau déclaré : paramètres de niveau du script, puis Element.LevelId ;
    ///   - Z : LocationPoint, sinon LocationCurve (moyenne + start/end), sinon bbox ;
    ///   - linéaire multi-niveaux → MULTI-NIVEAUX (écarté du verdict).
    ///
    /// Quatre états : conforme / fautif / multiNiveaux / nonEvaluable.
    /// Verdict = conformes / (conformes + fautifs) uniquement. Contrôle BRUYANT /
    /// indicatif : sans cible en config, statut NULL. Tolérance et catégories via config
    /// (défauts maison 50 mm, MEP+structure). Liste fautifs plafonnée à 100.
    /// </summary>
    public class G314LevelAttachmentExtractor : IControlExtractor
    {
        public string ControlCode => "G314";
        private const int MaxFautifs = 100;

        // Ordre du script pyRevit. RBS_REFERENCE_LEVEL_PARAM absent des DLL 2024/2025 — omis.
        private static readonly BuiltInParameter[] LevelParams =
        {
            BuiltInParameter.INSTANCE_SCHEDULE_ONLY_LEVEL_PARAM,
            BuiltInParameter.SCHEDULE_LEVEL_PARAM,
            BuiltInParameter.FAMILY_LEVEL_PARAM,
            BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM,
            BuiltInParameter.RBS_START_LEVEL_PARAM,
            BuiltInParameter.WALL_BASE_CONSTRAINT,
            BuiltInParameter.STAIRS_BASE_LEVEL_PARAM,
            BuiltInParameter.ROOF_CONSTRAINT_LEVEL_PARAM,
        };

        private readonly G314Config _cfg;

        public G314LevelAttachmentExtractor(G314Config cfg)
        {
            _cfg = cfg;
        }

        public ControlOutcome Extract(Document doc)
        {
            double toleranceMm = _cfg != null && _cfg.ToleranceMm > 0 ? _cfg.ToleranceMm : 50.0;
            double toleranceInternal = UnitUtils.ConvertToInternalUnits(toleranceMm, UnitTypeId.Millimeters);

            var mepCats = ResolveCats(_cfg != null ? _cfg.CategoriesMep : null);
            var structCats = ResolveCats(_cfg != null ? _cfg.CategoriesStructure : null);

            List<Level> levels = GetProjectLevels(doc);
            var counts = new GroupCounts();
            var fautifs = new List<object>();
            bool tronque = false;

            AuditGroup(doc, mepCats, levels, toleranceInternal, "mep", counts, fautifs, ref tronque);
            AuditGroup(doc, structCats, levels, toleranceInternal, "structure", counts, fautifs, ref tronque);

            int evaluables = counts.Conformes + counts.Fautifs;
            double? pct = evaluables == 0
                ? (double?)null
                : Pct(counts.Conformes, evaluables);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = pct,
                ValeurJson = new
                {
                    toleranceMm = toleranceMm,
                    niveauxUtilises = levels.Count,
                    evaluables = evaluables,
                    conformes = counts.Conformes,
                    fautifs = counts.Fautifs,
                    multiNiveaux = counts.MultiNiveaux,
                    nonEvaluables = counts.NonEvaluables,
                    pourcentageConformite = pct,
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
                    risque = "Contrôle bruyant : faux positifs possibles (poutres à décalage volontaire, etc.). Indicatif par défaut (sans cible => statut NULL).",
                },
            };
        }

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

        private static List<Level> GetProjectLevels(Document doc)
        {
            List<Level> all = new FilteredElementCollector(doc)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .OrderBy(l => l.Elevation)
                .ToList();

            var building = new List<Level>();
            foreach (Level level in all)
            {
                // API : propriété IsBuildingStory absente des métadonnées Level ; paramètre
                // LEVEL_IS_BUILDING_STORY présent 2024/2025 (voir API_VERIFIED.md).
                Parameter p = level.get_Parameter(BuiltInParameter.LEVEL_IS_BUILDING_STORY);
                if (p != null && p.HasValue && p.AsInteger() == 1)
                    building.Add(level);
            }
            return building.Count > 0 ? building : all;
        }

        private void AuditGroup(
            Document doc, List<BuiltInCategory> cats, List<Level> levels, double tolInternal,
            string groupe, GroupCounts counts, List<object> fautifs, ref bool tronque)
        {
            if (cats.Count == 0) return;
            SubCounts sub = groupe == "mep" ? counts.Mep : counts.Structure;

            foreach (BuiltInCategory bic in cats)
            {
                IList<Element> elements = new FilteredElementCollector(doc)
                    .OfCategory(bic)
                    .WhereElementIsNotElementType()
                    .ToElements();

                foreach (Element el in elements)
                {
                    Level declared = GetDeclaredLevel(doc, el);
                    if (declared == null)
                    {
                        counts.NonEvaluables++;
                        sub.NonEvaluables++;
                        continue;
                    }

                    double? refZ, startZ, endZ;
                    GetZ(el, out refZ, out startZ, out endZ);
                    if (refZ == null)
                    {
                        counts.NonEvaluables++;
                        sub.NonEvaluables++;
                        continue;
                    }

                    Level physical = GetPhysicalLevel(levels, refZ.Value, tolInternal);
                    if (physical == null)
                    {
                        counts.NonEvaluables++;
                        sub.NonEvaluables++;
                        continue;
                    }

                    // Multi-niveaux (linéaire traversant)
                    if (startZ != null && endZ != null)
                    {
                        Level startLvl = GetPhysicalLevel(levels, startZ.Value, tolInternal);
                        Level endLvl = GetPhysicalLevel(levels, endZ.Value, tolInternal);
                        if (!SameElevation(startLvl, endLvl, tolInternal))
                        {
                            counts.MultiNiveaux++;
                            sub.MultiNiveaux++;
                            continue;
                        }
                    }

                    if (SameElevation(declared, physical, tolInternal))
                    {
                        counts.Conformes++;
                        sub.Conformes++;
                    }
                    else
                    {
                        counts.Fautifs++;
                        sub.Fautifs++;
                        if (fautifs.Count < MaxFautifs)
                        {
                            string famille, typeName;
                            GetFamilyType(doc, el, out famille, out typeName);
                            fautifs.Add(new
                            {
                                id = el.Id.Value,
                                groupe = groupe,
                                categorie = el.Category != null ? el.Category.Name : null,
                                famille = famille,
                                type = typeName,
                                niveauDeclare = declared.Name,
                                niveauPhysique = physical.Name,
                                decalagePhysiqueMm = Round1(Mm(refZ.Value - physical.Elevation)),
                                ecartEntreNiveauxMm = Round1(Mm(physical.Elevation - declared.Elevation)),
                            });
                        }
                        else tronque = true;
                    }
                }
            }
        }

        private static Level GetDeclaredLevel(Document doc, Element el)
        {
            foreach (BuiltInParameter bip in LevelParams)
            {
                Parameter p = el.get_Parameter(bip);
                if (p == null || p.StorageType != StorageType.ElementId) continue;
                ElementId id = p.AsElementId();
                if (id == null || id == ElementId.InvalidElementId) continue;
                Level lvl = doc.GetElement(id) as Level;
                if (lvl != null) return lvl;
            }
            try
            {
                ElementId lid = el.LevelId;
                if (lid != null && lid != ElementId.InvalidElementId)
                    return doc.GetElement(lid) as Level;
            }
            catch { /* certains éléments n'exposent pas LevelId */ }
            return null;
        }

        private static void GetZ(Element el, out double? refZ, out double? startZ, out double? endZ)
        {
            refZ = startZ = endZ = null;
            Location loc = el.Location;
            if (loc is LocationPoint lp)
            {
                refZ = lp.Point.Z;
                return;
            }
            if (loc is LocationCurve lc)
            {
                try
                {
                    Curve c = lc.Curve;
                    XYZ a = c.GetEndPoint(0);
                    XYZ b = c.GetEndPoint(1);
                    refZ = (a.Z + b.Z) / 2.0;
                    startZ = a.Z;
                    endZ = b.Z;
                    return;
                }
                catch { /* repli bbox */ }
            }
            try
            {
                BoundingBoxXYZ bb = el.get_BoundingBox(null);
                if (bb != null)
                    refZ = (bb.Min.Z + bb.Max.Z) / 2.0;
            }
            catch { /* non évaluable */ }
        }

        private static Level GetPhysicalLevel(List<Level> levels, double z, double tol)
        {
            if (levels == null || levels.Count == 0) return null;
            Level physical = levels[0];
            foreach (Level level in levels)
            {
                if (level.Elevation <= z + tol) physical = level;
                else break;
            }
            return physical;
        }

        private static bool SameElevation(Level a, Level b, double tol)
        {
            if (a == null || b == null) return false;
            return Math.Abs(a.Elevation - b.Elevation) <= tol;
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

        private static double Mm(double internalUnits)
        {
            return UnitUtils.ConvertFromInternalUnits(internalUnits, UnitTypeId.Millimeters);
        }

        private static double Round1(double v)
        {
            return Math.Round(v, 1);
        }

        private static double Pct(int num, int denom)
        {
            if (denom == 0) return 100.0;
            if (num == denom) return 100.0;
            return Math.Floor((double)num / denom * 10000.0) / 100.0;
        }

        private sealed class SubCounts
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

        private sealed class GroupCounts
        {
            public int Conformes, Fautifs, MultiNiveaux, NonEvaluables;
            public readonly SubCounts Mep = new SubCounts();
            public readonly SubCounts Structure = new SubCounts();
        }
    }
}
