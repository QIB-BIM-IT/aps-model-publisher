using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G507 — paramètres PARTAGÉS intégrés au modèle.
    /// API vérifiée identique Revit 2024/2025 : FilteredElementCollector
    /// OfClass(SharedParameterElement), propriété GuidValue (Guid du fichier de
    /// paramètres partagés), nom via Element.Name.
    ///
    /// DISTINCTION AVEC G502 (documentée) : G502 liste les liaisons de paramètres de
    /// PROJET (Document.ParameterBindings — définitions liées aux catégories, qu'elles
    /// soient d'origine partagée ou non). G507 liste les définitions de paramètres
    /// PARTAGÉS présentes dans le document (SharedParameterElement) : à l'API, un
    /// paramètre partagé est identifié par son Guid de fichier .txt partagé
    /// (GuidValue), ce qu'un paramètre de projet « simple » n'a pas. Un même nom peut
    /// donc apparaître dans les deux listes (partagé ET lié au projet).
    /// « Paramètres partagés d'exploitation attendus » : l'attendu vient de la config
    /// projet (cible du scoreur presence) — l'extracteur relève la présence brute.
    /// </summary>
    public class G507SharedParametersExtractor : IControlExtractor
    {
        public string ControlCode => "G507";

        public ControlOutcome Extract(Document doc)
        {
            var noms = new List<string>();
            var detail = new List<object>();

            foreach (SharedParameterElement sp in new FilteredElementCollector(doc)
                         .OfClass(typeof(SharedParameterElement))
                         .Cast<SharedParameterElement>()
                         .OrderBy(sp => sp.Name))
            {
                noms.Add(sp.Name);
                detail.Add(new { nom = sp.Name, guid = sp.GuidValue.ToString() });
            }

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = noms.Count,
                ValeurJson = new
                {
                    // Liste des noms pour le scoreur presence (champListe)
                    parametresPartages = noms,
                    detail,
                },
            };
        }
    }
}
