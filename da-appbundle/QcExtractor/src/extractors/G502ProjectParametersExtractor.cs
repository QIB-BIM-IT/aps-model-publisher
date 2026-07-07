using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G502 — paramètres de projet présents (liste des définitions liées).
    /// API vérifiée : Document.ParameterBindings (BindingMap) → ForwardIterator()
    /// (hérité de DefinitionBindingMap, identique 2024/2025) → Definition.Name.
    /// ⚠️ INTERDIT ici : Definition.ParameterGroup et les surcharges
    /// BindingMap.Insert(BuiltInParameterGroup) — SUPPRIMÉS de l'API Revit 2025.
    /// Lecture des noms uniquement. Paramètres globaux (GlobalParametersManager)
    /// hors périmètre de cette tranche.
    /// </summary>
    public class G502ProjectParametersExtractor : IControlExtractor
    {
        public string ControlCode => "G502";

        public ControlOutcome Extract(Document doc)
        {
            var parametres = new List<string>();

            DefinitionBindingMapIterator it = doc.ParameterBindings.ForwardIterator();
            it.Reset();
            while (it.MoveNext())
            {
                Definition def = it.Key;
                if (def != null) parametres.Add(def.Name);
            }
            parametres.Sort();

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = parametres.Count,
                ValeurJson = new { parametres },
            };
        }
    }
}
