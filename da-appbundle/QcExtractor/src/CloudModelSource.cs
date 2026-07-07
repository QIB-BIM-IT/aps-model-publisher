using System;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;

namespace QcExtractor
{
    /// <summary>
    /// Ouverture directe d'un modèle cloud ACC via ses GUIDs.
    /// Nécessite que le workitem porte l'argument adsk3LeggedToken (scope code:all) :
    /// c'est lui qui fournit le contexte utilisateur aux APIs Revit Cloud Model dans DA.
    /// Régions supportées par ConvertCloudGUIDsToCloudPath : US et EMEA.
    /// </summary>
    public class CloudModelSource : IModelSource
    {
        public Document OpenDocument(Application app, string region, Guid projectGuid, Guid modelGuid)
        {
            string cloudRegion = string.Equals(region, "EMEA", StringComparison.OrdinalIgnoreCase)
                ? ModelPathUtils.CloudRegionEMEA
                : ModelPathUtils.CloudRegionUS;

            ModelPath cloudPath = ModelPathUtils.ConvertCloudGUIDsToCloudPath(cloudRegion, projectGuid, modelGuid);

            // Lecture seule : pas de détachement ni de synchronisation, on ne modifie rien.
            return app.OpenDocumentFile(cloudPath, new OpenOptions());
        }
    }
}
