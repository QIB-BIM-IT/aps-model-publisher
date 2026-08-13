using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G508 — taux de remplissage des paramètres d'exploitation (usage 7D). Contrôle MODÈLE
    /// (hôte seul, sans lien). Réutilise fortement les patterns de G504 (lecture par nom,
    /// détection de nature type/instance, plafonnement de liste, ElementId.Value Int64).
    /// API vérifiée identique 2024/2025 : voir spike/uniformat-control/API_VERIFIED.md
    /// (G508 n'utilise AUCUNE API absente de G504).
    ///
    /// DIFFÉRENCE CLÉ AVEC G504 : la liste des paramètres est VARIABLE PAR PROJET (exigences
    /// client/EIR) et GRANULAIRE — chaque paramètre a son propre périmètre de catégories.
    /// Elle vit dans qc.project_config (PAS de norme maison versionnée). Structure régulière
    /// (nom / categories / seuil) pensée pour un futur formulaire web.
    ///
    /// Pour CHAQUE paramètre de la liste : taux de remplissage (entités avec valeur non vide
    /// / total entités du périmètre), nature type/instance détectée à l'exécution, 3 cas
    /// absent/vide/rempli, et — si non conforme — la liste des entités fautives bornée par
    /// le plafond de sécurité (50 000 IDs par contrôle). Rapport PAR PARAMÈTRE (le gestionnaire
    /// 7D veut savoir QUEL paramètre traîne), plus un taux global agrégé pour Power BI.
    /// </summary>
    public class G508OperationalParamsFillRateExtractor : IControlExtractor
    {
        public string ControlCode => "G508";
        private const int MaxIdsParParametre = DesignatedElementLimits.SafetyCapPerControl;

        private readonly G508Config _cfg;

        public G508OperationalParamsFillRateExtractor(G508Config cfg)
        {
            _cfg = cfg;
        }

        public ControlOutcome Extract(Document doc)
        {
            List<G508ParamEntry> entries = _cfg != null && _cfg.Parametres != null ? _cfg.Parametres : new List<G508ParamEntry>();

            // Comportement PAR DÉFAUT : aucune liste de paramètres => rien à mesurer,
            // extraction réussie, statut NULL (le scoreur 'remplissage' renverra null).
            if (entries.Count == 0)
            {
                return new ControlOutcome
                {
                    ControlCode = ControlCode,
                    ValeurNum = null,
                    ValeurJson = new
                    {
                        aucunParametre = true,
                        message = "Aucun paramètre configuré (qc.project_config.config.controles.G508.parametres)",
                        parametres = new List<object>(),
                    },
                };
            }

            var rapport = new List<object>();
            long sumRempli = 0, sumTotal = 0;
            int idsEmisGlobal = 0;

            foreach (G508ParamEntry entry in entries)
            {
                string nom = entry != null ? entry.Nom : null;
                double seuil = entry != null ? entry.Seuil : 100;

                // Périmètre granulaire : catégories du paramètre, sinon défaut design maison.
                List<string> catsDemandees =
                    (entry != null && entry.Categories != null && entry.Categories.Count > 0)
                        ? entry.Categories
                        : (_cfg.CategoriesDesignDefaut ?? new List<string>());

                var cats = new List<BuiltInCategory>();
                var catsInvalides = new List<string>();
                foreach (string s in catsDemandees)
                {
                    if (Enum.TryParse(s, false, out BuiltInCategory bic) && Enum.IsDefined(typeof(BuiltInCategory), bic))
                        cats.Add(bic);
                    else
                        catsInvalides.Add(s);
                }

                if (string.IsNullOrWhiteSpace(nom))
                {
                    rapport.Add(new
                    {
                        nom = nom,
                        categories = cats.Select(c => c.ToString()).ToList(),
                        natureDetectee = "indetermine",
                        rempli = 0,
                        total = 0,
                        pourcentage = 0.0,
                        seuil = seuil,
                        conforme = false,
                        parametreAbsent = true,
                        nbFautifs = 0,
                        idsEchantillon = new List<long>(),
                        listeTronquee = false,
                        erreur = "Nom de paramètre vide",
                    });
                    continue;
                }

                // Résolution du nom : BuiltInParameter (natif, ALL_CAPS) sinon partagé par nom.
                BuiltInParameter bip = BuiltInParameter.INVALID;
                bool builtin = false;
                if (Enum.TryParse(nom, false, out BuiltInParameter tmp) && Enum.IsDefined(typeof(BuiltInParameter), tmp))
                {
                    builtin = true;
                    bip = tmp;
                }

                // Collecte des instances du périmètre
                var instances = new List<Element>();
                foreach (BuiltInCategory bic in cats)
                {
                    instances.AddRange(
                        new FilteredElementCollector(doc)
                            .OfCategory(bic)
                            .WhereElementIsNotElementType()
                            .ToElements());
                }

                // Périmètre vide : on ne peut pas détecter la nature ni mesurer. Taux vacuice
                // (100 %, conforme), SANS le confondre avec un paramètre absent du modèle.
                if (instances.Count == 0)
                {
                    rapport.Add(new
                    {
                        nom = nom,
                        categories = cats.Select(c => c.ToString()).ToList(),
                        categoriesInvalides = catsInvalides,
                        natureDetectee = "indetermine",
                        rempli = 0,
                        total = 0,
                        pourcentage = 100.0,
                        seuil = seuil,
                        conforme = 100.0 >= seuil,
                        parametreAbsent = false,
                        aucunElement = true,
                        nbFautifs = 0,
                        idsEchantillon = new List<long>(),
                        listeTronquee = false,
                    });
                    continue;
                }

                string nature = DetectNature(doc, instances, builtin, bip, nom);
                bool absent = nature == "absent";

                int rempli = 0, total = 0, nbFautifs = 0;
                var idsEch = new List<long>();
                bool tronque = false;

                if (nature == "instance")
                {
                    foreach (Element inst in instances)
                    {
                        total++;
                        Parameter p = ReadParam(inst, builtin, bip, nom);
                        if (NonEmpty(p)) { rempli++; continue; }
                        nbFautifs++;
                        if (idsEmisGlobal < MaxIdsParParametre) { idsEch.Add(inst.Id.Value); idsEmisGlobal++; }
                        else tronque = true;
                    }
                }
                else
                {
                    // TYPE (couvre aussi ABSENT) : un type sans valeur = 1 fautif ; on liste
                    // les instances des types fautifs (pour repérer dans Revit).
                    foreach (IGrouping<long, Element> g in instances.GroupBy(e => e.GetTypeId().Value))
                    {
                        total++;
                        var listeInst = g.ToList();
                        Element typeEl = doc.GetElement(listeInst[0].GetTypeId());
                        Parameter tp = ReadParam(typeEl, builtin, bip, nom);
                        if (NonEmpty(tp)) { rempli++; continue; }
                        nbFautifs++;
                        foreach (Element e in listeInst)
                        {
                            if (idsEmisGlobal < MaxIdsParParametre) { idsEch.Add(e.Id.Value); idsEmisGlobal++; }
                            else { tronque = true; break; }
                        }
                    }
                }

                double pct = Pct(rempli, total);
                bool conforme = pct >= seuil; // total==0 => pct 100 => conforme (vacuice)
                sumRempli += rempli;
                sumTotal += total;

                rapport.Add(new
                {
                    nom = nom,
                    categories = cats.Select(c => c.ToString()).ToList(),
                    categoriesInvalides = catsInvalides,
                    natureDetectee = nature, // "type" | "instance" | "absent"
                    rempli = rempli,
                    total = total,
                    pourcentage = pct,
                    seuil = seuil,
                    conforme = conforme,
                    parametreAbsent = absent,
                    nbFautifs = nbFautifs,
                    idsEchantillon = idsEch,
                    listeTronquee = tronque,
                });
            }

            double global = Pct((int)sumRempli, (int)sumTotal);

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = global,
                ValeurJson = new
                {
                    aucunParametre = false,
                    global = new { rempli = sumRempli, total = sumTotal, pourcentage = global },
                    parametres = rapport,
                },
            };
        }

        // ======== Helpers (mêmes patterns que G504) ========

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
    }
}
