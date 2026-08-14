using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G504 — couverture de codification UNIFORMAT sur les catégories de design.
    /// Contrôle MODÈLE (hôte seul, sans lien). API vérifiée identique 2024/2025 :
    /// voir spike/uniformat-control/API_VERIFIED.md.
    ///
    /// PARAMÈTRE CONFIGURABLE (jamais codé en dur) — fourni par le backend via
    /// params.json.uniformat (norme maison versionnée + surcharge projet) :
    ///   - kind "builtin" : BuiltInParameter natif (défaut de test = UNIFORMAT_CODE,
    ///     le « Code d'assemblage », paramètre de TYPE) ;
    ///   - kind "partage" : paramètre partagé/projet lu par NOM (cible future
    ///     Tt_TXT_Code_Uniformat, paramètre d'INSTANCE).
    ///
    /// NATURE TYPE vs INSTANCE — DÉTECTÉE À L'EXÉCUTION (jamais présumée) :
    ///   - partagé/projet : la nature est lue dans doc.ParameterBindings
    ///     (TypeBinding vs InstanceBinding — autoritaire) ;
    ///   - natif : sondage sur les éléments (le paramètre est-il porté par le type ou
    ///     l'instance ?), priorité au TYPE pour éviter la remontée d'une valeur de type
    ///     via l'instance.
    /// Le comptage s'adapte : au TYPE, un type sans code = 1 fautif (1 action) ; à
    /// l'INSTANCE, chaque instance sans code = 1 fautif. La bascule natif(type) →
    /// Tt(instance) est donc un simple changement de config, sans recodage.
    ///
    /// TROIS CAS distingués : (a) paramètre ABSENT du modèle (drapeau parametreAbsent) ;
    /// (b) présent mais VIDE (raison "vide") ; (c) rempli (conforme). Liste des fautifs
    /// bornée par le plafond de sécurité (50 000 IDs par contrôle), le compte total restant exact.
    /// ID stocké = ElementId.Value (Int64, cohérent 2024/2025).
    /// </summary>
    public class G504UniformatCoverageExtractor : IControlExtractor
    {
        public string ControlCode => "G504";
        private const int MaxIdsParGroupe = DesignatedElementLimits.SafetyCapPerControl;

        private readonly UniformatConfig _cfg;

        public G504UniformatCoverageExtractor(UniformatConfig cfg)
        {
            _cfg = cfg;
        }

        public ControlOutcome Extract(Document doc)
        {
            // 1) Résolution de la liste blanche (BuiltInCategory) et du paramètre configuré
            List<string> categoriesDemandees = _cfg != null && _cfg.Categories != null ? _cfg.Categories : new List<string>();
            var cats = new List<BuiltInCategory>();
            var catsInvalides = new List<string>();
            foreach (string s in categoriesDemandees)
            {
                if (Enum.TryParse(s, false, out BuiltInCategory bic) && Enum.IsDefined(typeof(BuiltInCategory), bic))
                    cats.Add(bic);
                else
                    catsInvalides.Add(s);
            }

            string kind = _cfg != null && _cfg.Parametre != null ? _cfg.Parametre.Kind : null;
            string valeur = _cfg != null && _cfg.Parametre != null ? _cfg.Parametre.Valeur : null;
            bool builtin = string.Equals(kind, "builtin", StringComparison.OrdinalIgnoreCase);
            bool configResolue = !string.IsNullOrWhiteSpace(valeur) && cats.Count > 0;

            var parametreJson = new { kind = kind, valeur = valeur };
            var categoriesJson = new { demandees = categoriesDemandees.Count, valides = cats.Count, invalides = catsInvalides };

            // Config non résolue => extraction RÉUSSIE, valeur_num NULL (le scoreur renverra
            // statut NULL). On ne devine rien.
            if (!configResolue)
            {
                return new ControlOutcome
                {
                    ControlCode = ControlCode,
                    ValeurNum = null,
                    ValeurJson = new
                    {
                        parametre = parametreJson,
                        configResolue = false,
                        raison = string.IsNullOrWhiteSpace(valeur)
                            ? "Paramètre non résolu (ni config projet ni norme maison)"
                            : "Liste blanche de catégories vide ou invalide",
                        categories = categoriesJson,
                    },
                };
            }

            // Résolution du BuiltInParameter natif si applicable
            BuiltInParameter bip = BuiltInParameter.INVALID;
            string parametreErreur = null;
            if (builtin && (!Enum.TryParse(valeur, false, out bip) || !Enum.IsDefined(typeof(BuiltInParameter), bip)))
            {
                parametreErreur = "BuiltInParameter inconnu: " + valeur;
                bip = BuiltInParameter.INVALID;
            }

            // 2) Collecte des instances de design (hôte seul)
            var instances = new List<Element>();
            foreach (BuiltInCategory bic in cats)
            {
                instances.AddRange(
                    new FilteredElementCollector(doc)
                        .OfCategory(bic)
                        .WhereElementIsNotElementType()
                        .ToElements());
            }

            // Aucun élément de design => couverture vacuice (100 %), rien à coder
            if (instances.Count == 0)
            {
                return new ControlOutcome
                {
                    ControlCode = ControlCode,
                    ValeurNum = 100,
                    ValeurJson = new
                    {
                        parametre = parametreJson,
                        natureParametre = "indetermine",
                        parametreAbsent = false,
                        aucunElementDesign = true,
                        couverture = new { numerateur = 0, denominateur = 0, pourcentage = 100.0, nature = "indetermine" },
                        nbEntitesFautives = 0,
                        categories = categoriesJson,
                    },
                };
            }

            // 3) Détection de nature (adaptative)
            string nature = DetectNature(doc, instances, builtin, bip, valeur);
            bool absent = nature == "absent";

            // 4) Comptage adaptatif
            return nature == "instance"
                ? BuildInstanceOutcome(doc, instances, builtin, bip, valeur, parametreJson, categoriesJson)
                : BuildTypeOutcome(doc, instances, builtin, bip, valeur, nature, absent, parametreErreur, parametreJson, categoriesJson);
        }

        // ======== Nature ========

        private static string DetectNature(Document doc, List<Element> instances, bool builtin, BuiltInParameter bip, string name)
        {
            if (!builtin)
            {
                // Autoritaire pour les paramètres partagés/projet : les liaisons.
                DefinitionBindingMapIterator it = doc.ParameterBindings.ForwardIterator();
                it.Reset();
                while (it.MoveNext())
                {
                    Definition def = it.Key;
                    if (def != null && string.Equals(def.Name, name, StringComparison.Ordinal))
                    {
                        var binding = it.Current as Binding;
                        if (binding is TypeBinding) return "type";
                        if (binding is InstanceBinding) return "instance";
                    }
                }
                return "absent";
            }

            if (bip == BuiltInParameter.INVALID) return "absent";

            // Natif : sondage, priorité au TYPE (un paramètre de type n'existe pas sur
            // l'élément type via l'instance ; l'inverse peut remonter une valeur héritée).
            foreach (Element inst in instances)
            {
                Element te = doc.GetElement(inst.GetTypeId());
                if (te != null && te.get_Parameter(bip) != null) return "type";
                if (inst.get_Parameter(bip) != null) return "instance";
            }
            return "absent";
        }

        // ======== Lecture de valeur ========

        private static Parameter ReadParam(Element el, bool builtin, BuiltInParameter bip, string name)
        {
            if (el == null) return null;
            return builtin ? el.get_Parameter(bip) : el.LookupParameter(name);
        }

        private static bool NonEmpty(Parameter p)
        {
            if (p == null || !p.HasValue) return false;
            string s = p.StorageType == StorageType.String ? p.AsString() : p.AsValueString();
            return !string.IsNullOrWhiteSpace(s);
        }

        private static double Pct(int num, int denom)
        {
            if (denom == 0) return 100.0;
            if (num == denom) return 100.0; // exact, jamais d'arrondi vers 100 par excès
            return Math.Floor((double)num / denom * 10000.0) / 100.0;
        }

        // ======== Comptage au TYPE (couvre aussi le cas ABSENT) ========

        private ControlOutcome BuildTypeOutcome(
            Document doc, List<Element> instances, bool builtin, BuiltInParameter bip, string valeur,
            string nature, bool absent, string parametreErreur, object parametreJson, object categoriesJson)
        {
            int denom = 0, num = 0, nbInstancesConcernees = 0;
            bool tronque = false;
            var typesFautifs = new List<object>();
            int idsRestants = MaxIdsParGroupe;

            foreach (IGrouping<long, Element> g in instances.GroupBy(e => e.GetTypeId().Value))
            {
                denom++;
                var listeInst = g.ToList();
                ElementId typeId = listeInst[0].GetTypeId();
                Element typeEl = doc.GetElement(typeId);
                Parameter tp = ReadParam(typeEl, builtin, bip, valeur);

                if (NonEmpty(tp)) { num++; continue; }

                nbInstancesConcernees += listeInst.Count;
                int take = idsRestants > 0 ? Math.Min(listeInst.Count, idsRestants) : 0;
                bool coupe = listeInst.Count > take;
                if (coupe) tronque = true;
                var sample = listeInst.Take(take).ToList();
                var ids = sample.Select(e => e.Id.Value).ToList();
                var uniqueIds = sample.Select(e => UniqueIds.Of(e)).ToList();
                idsRestants -= ids.Count;
                ElementType et = typeEl as ElementType;

                typesFautifs.Add(new
                {
                    famille = et != null ? et.FamilyName : null,
                    nomType = typeEl != null ? typeEl.Name : null,
                    categorie = listeInst[0].Category != null ? listeInst[0].Category.Name : null,
                    nbInstances = listeInst.Count,
                    raison = tp == null ? "absent" : "vide",
                    idsEchantillon = ids,
                    uniqueIdsEchantillon = uniqueIds,
                    listeIdsTronquee = coupe,
                });
            }

            double pct = Pct(num, denom);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = pct,
                ValeurJson = new
                {
                    parametre = parametreJson,
                    natureParametre = nature, // "type" ou "absent"
                    parametreAbsent = absent,
                    parametreErreur = parametreErreur,
                    couverture = new { numerateur = num, denominateur = denom, pourcentage = pct, nature = "type" },
                    nbEntitesFautives = typesFautifs.Count,
                    nbInstancesConcernees = nbInstancesConcernees,
                    categories = categoriesJson,
                    typesFautifs = typesFautifs,
                    listeTronquee = tronque,
                },
            };
        }

        // ======== Comptage à l'INSTANCE ========

        private ControlOutcome BuildInstanceOutcome(
            Document doc, List<Element> instances, bool builtin, BuiltInParameter bip, string valeur,
            object parametreJson, object categoriesJson)
        {
            int denom = 0, num = 0;
            var fautives = new List<Element>();

            foreach (Element inst in instances)
            {
                denom++;
                Parameter p = ReadParam(inst, builtin, bip, valeur);
                if (NonEmpty(p)) num++;
                else fautives.Add(inst);
            }

            double pct = Pct(num, denom);

            // Liste par entrée {famille, nomType, categorie, id}, bornée par le
            // plafond de sécurité du contrôle ; le compte total reste exact.
            bool tronque = false;
            var instancesFautives = new List<object>();
            int idsRestants = MaxIdsParGroupe;
            foreach (IGrouping<long, Element> g in fautives.GroupBy(e => e.GetTypeId().Value))
            {
                var listeInst = g.ToList();
                Element typeEl = doc.GetElement(listeInst[0].GetTypeId());
                ElementType et = typeEl as ElementType;
                string famille = et != null ? et.FamilyName : null;
                string nomType = typeEl != null ? typeEl.Name : null;
                foreach (Element e in listeInst)
                {
                    if (idsRestants <= 0) { tronque = true; break; }
                    instancesFautives.Add(new
                    {
                        famille = famille,
                        nomType = nomType,
                        categorie = e.Category != null ? e.Category.Name : null,
                        id = e.Id.Value,
                        uniqueId = UniqueIds.Of(e),
                    });
                    idsRestants--;
                }
                if (idsRestants <= 0 && listeInst.Count > 0) tronque = true;
            }

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = pct,
                ValeurJson = new
                {
                    parametre = parametreJson,
                    natureParametre = "instance",
                    parametreAbsent = false,
                    couverture = new { numerateur = num, denominateur = denom, pourcentage = pct, nature = "instance" },
                    nbEntitesFautives = fautives.Count,
                    nbInstancesConcernees = (int?)null,
                    categories = categoriesJson,
                    instancesFautives = instancesFautives,
                    listeTronquee = tronque,
                },
            };
        }
    }
}
