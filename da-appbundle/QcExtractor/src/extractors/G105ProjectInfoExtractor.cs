using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G105 — informations projet (ProjectInfo). API vérifiée identique Revit 2024/2025 :
    /// Document.ProjectInformation → ProjectInfo, champs String Address, Author,
    /// BuildingName, ClientName, IssueDate, Name, Number, OrganizationName,
    /// OrganizationDescription, Status.
    /// valeur_json.champs = valeurs relevées (transparence, aide à la config) ;
    /// valeur_json.champsRenseignes = clés dont la valeur est non vide, consommées par le
    /// scoreur backend 'presence' (cible = liste des clés attendues non vides). Sans cible :
    /// statut NULL.
    /// </summary>
    public class G105ProjectInfoExtractor : IControlExtractor
    {
        public string ControlCode => "G105";

        public ControlOutcome Extract(Document doc)
        {
            ProjectInfo pi = doc.ProjectInformation;

            var champs = new Dictionary<string, string>
            {
                ["address"] = pi.Address,
                ["author"] = pi.Author,
                ["buildingName"] = pi.BuildingName,
                ["clientName"] = pi.ClientName,
                ["issueDate"] = pi.IssueDate,
                ["name"] = pi.Name,
                ["number"] = pi.Number,
                ["organizationName"] = pi.OrganizationName,
                ["organizationDescription"] = pi.OrganizationDescription,
                ["status"] = pi.Status,
            };

            List<string> renseignes = champs
                .Where(kv => !string.IsNullOrWhiteSpace(kv.Value))
                .Select(kv => kv.Key)
                .OrderBy(k => k)
                .ToList();

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = renseignes.Count,
                ValeurJson = new { champs, champsRenseignes = renseignes },
            };
        }
    }
}
