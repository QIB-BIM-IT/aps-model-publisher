using System.Linq;
using Autodesk.Revit.DB;

namespace QcExtractor.Extractors
{
    /// <summary>
    /// G310 — connecteurs ouverts (non connectés).
    /// API vérifiée identique Revit 2024/2025 : ConnectorManager.UnusedConnectors
    /// (MEPCurve.ConnectorManager et FamilyInstance.MEPModel.ConnectorManager).
    ///
    /// LIMITE ASSUMÉE (tranche lot 1) : compte BRUT et volontairement BRUYANT.
    /// Aucune tentative de distinguer un connecteur ouvert légitime (fin de réseau,
    /// point de raccordement interdiscipline, réserve) d'un connecteur fautif.
    /// Le chiffre est INDICATIF ; l'interprétation reste humaine ou viendra d'un
    /// raffinement ultérieur. Tous domaines confondus (HVAC, plomberie, électrique…).
    /// </summary>
    public class G310OpenConnectorsExtractor : IControlExtractor
    {
        public string ControlCode => "G310";

        public ControlOutcome Extract(Document doc)
        {
            int surCourbes = 0;
            int surInstances = 0;

            foreach (MEPCurve curve in new FilteredElementCollector(doc)
                         .OfClass(typeof(MEPCurve))
                         .Cast<MEPCurve>())
            {
                ConnectorManager cm = curve.ConnectorManager;
                if (cm != null) surCourbes += cm.UnusedConnectors.Size;
            }

            foreach (FamilyInstance fi in new FilteredElementCollector(doc)
                         .OfClass(typeof(FamilyInstance))
                         .Cast<FamilyInstance>())
            {
                ConnectorManager cm = fi.MEPModel?.ConnectorManager;
                if (cm != null) surInstances += cm.UnusedConnectors.Size;
            }

            return new ControlOutcome
            {
                ControlCode = ControlCode,
                ValeurNum = surCourbes + surInstances,
                ValeurJson = new { surCourbes, surInstances },
            };
        }
    }
}
