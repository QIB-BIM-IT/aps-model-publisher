using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G404 — sous-projets UTILISATEUR (noms).
    /// API vérifiée identique Revit 2024/2025 : new FilteredWorksetCollector(doc)
    /// .OfKind(WorksetKind.UserWorkset) → Workset.Name (hérité de WorksetPreview,
    /// présent dans les deux DLLs). OfKind(UserWorkset) exclut d'office les
    /// sous-projets système générés par Revit (vues, familles, normes du projet).
    /// ATTENTION (décision validée) : « Niveaux et quadrillages partagés », créé
    /// automatiquement en workshared, est classé UserWorkset par l'API sans drapeau
    /// d'exclusion fiable — on ne filtre PAS par nom (dépendant de la langue) ; il
    /// reste dans la liste relevée et s'exempte via
    /// config.controles.G404.cible.exceptions.
    /// Un booléen d'existence serait inutile (toujours vrai en workshared) : la
    /// valeur est la liste des noms. Scoreur backend : nommage ; sans cible : statut NULL.
    /// </summary>
    public class G404WorksetNamesExtractor : IControlExtractor
    {
        public string ControlCode => "G404";

        public ControlOutcome Extract(Document doc)
        {
            // La garde workshared du resolver rend ce cas théorique ; erreur claire
            // (→ ligne etat_extraction='echec' isolée) plutôt qu'une liste trompeuse.
            if (!doc.IsWorkshared)
                throw new InvalidOperationException(
                    "Document non workshared : aucun sous-projet utilisateur à relever");

            List<string> sousProjets = new FilteredWorksetCollector(doc)
                .OfKind(WorksetKind.UserWorkset)
                .Select(w => w.Name)
                .OrderBy(n => n)
                .ToList();

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = sousProjets.Count,
                ValeurJson = new { sousProjets },
            };
        }
    }
}
