using System;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using DesignAutomationFramework;

namespace QcExtractor
{
    /// <summary>
    /// Point d'entrée Design Automation for Revit (DB application, sans UI).
    /// Flux : params.json -> IModelSource.OpenDocument (cloud ACC) -> G408Extractor -> result.json
    /// </summary>
    public class QcExtractorApp : IExternalDBApplication
    {
        public ExternalDBApplicationResult OnStartup(ControlledApplication application)
        {
            DesignAutomationBridge.DesignAutomationReadyEvent += HandleDesignAutomationReadyEvent;
            return ExternalDBApplicationResult.Succeeded;
        }

        public ExternalDBApplicationResult OnShutdown(ControlledApplication application)
        {
            return ExternalDBApplicationResult.Succeeded;
        }

        private void HandleDesignAutomationReadyEvent(object sender, DesignAutomationReadyEventArgs e)
        {
            e.Succeeded = Run(e.DesignAutomationData);
        }

        private static bool Run(DesignAutomationData data)
        {
            if (data == null) throw new ArgumentNullException(nameof(data));

            InputParams input = InputParams.Load("params.json");
            Console.WriteLine($"[QcExtractor] Contrôle {input.ControlCode} — region={input.Region} project={input.ProjectGuid} model={input.ModelGuid}");

            // Q3 : point de bascule unique pour l'acquisition du modèle.
            // Aujourd'hui : ouverture cloud directe (US/EMEA). Demain : repli download+copie
            // détachée pour la région Canada, en changeant UNIQUEMENT cette implémentation.
            IModelSource modelSource = new CloudModelSource();

            Document doc = modelSource.OpenDocument(data.RevitApp, input.Region, input.ProjectGuid, input.ModelGuid);
            try
            {
                ResultPayload result = G408Extractor.Extract(doc);
                result.ControlCode = input.ControlCode;
                result.Save("result.json");
                Console.WriteLine($"[QcExtractor] G408: total={result.Total} critical={result.Critical}");
                return true;
            }
            finally
            {
                doc.Close(false);
            }
        }
    }
}
