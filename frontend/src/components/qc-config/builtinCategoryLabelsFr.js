/**
 * Libellés d'interface Revit (FR) pour les BuiltInCategory de la liste blanche G504.
 *
 * Source / méthode (ne pas inventer hors de cette liste) :
 * - Identifiants techniques = BuiltInCategory (OST_…), stables, utilisés par le scoreur
 *   et l'extracteur (qc-uniformat-norm.json / catalogue).
 * - Noms EN observés en local via Category.Name dans les résultats G504 (worker DA EN) :
 *   Mechanical Equipment, Pipes, Conduits, Cable Trays, etc.
 * - Noms FR = équivalents UI Revit FR (Object Styles / LabelUtils.GetLabelFor sous locale FR),
 *   croisés avec la doc Autodesk FR (ex. Gaines pour OST_DuctCurves, Poteaux porteurs
 *   pour OST_StructuralColumns) et l'aide Revit MEP FR.
 *
 * Affichage uniquement — la config persistée reste le bic (OST_…).
 * Éditable : ajouter/corriger une entrée ici si un libellé FR diverge sur votre Revit.
 */

export const BUILTIN_CATEGORY_LABELS_FR = {
  OST_MechanicalEquipment: 'Équipements mécaniques',
  OST_DuctCurves: 'Gaines',
  OST_DuctFitting: 'Raccords de gaine',
  OST_DuctAccessory: 'Accessoires de gaine',
  OST_DuctTerminal: "Bouches d'aération",
  OST_FlexDuctCurves: 'Gaines flexibles',
  OST_PlumbingFixtures: 'Appareils sanitaires',
  OST_PipeCurves: 'Canalisations',
  OST_PipeFitting: 'Raccords de canalisation',
  OST_PipeAccessory: 'Accessoires de canalisation',
  OST_FlexPipeCurves: 'Canalisations flexibles',
  OST_Sprinklers: 'Sprinklers',
  OST_ElectricalEquipment: 'Équipements électriques',
  OST_ElectricalFixtures: 'Dispositifs électriques',
  OST_LightingFixtures: 'Luminaires',
  OST_LightingDevices: "Dispositifs d'éclairage",
  OST_CommunicationDevices: 'Dispositifs de communication',
  OST_DataDevices: 'Dispositifs de données',
  OST_FireAlarmDevices: "Dispositifs d'alarme incendie",
  OST_SecurityDevices: 'Dispositifs de sécurité',
  OST_NurseCallDevices: "Dispositifs d'appel infirmier",
  OST_TelephoneDevices: 'Dispositifs téléphoniques',
  OST_AudioVisualDevices: 'Dispositifs audiovisuels',
  OST_Conduit: 'Conduits',
  OST_ConduitFitting: 'Raccords de conduit',
  OST_CableTray: 'Chemins de câbles',
  OST_CableTrayFitting: 'Raccords de chemin de câbles',
  OST_StructuralColumns: 'Poteaux porteurs',
  OST_StructuralFraming: 'Ossature',
  OST_StructuralFoundation: 'Fondations',
  OST_StructConnections: 'Connexions structurelles',
  OST_StructuralStiffener: 'Raidisseurs',
  OST_StructuralTruss: 'Fermes',
  OST_GenericModel: 'Modèles génériques',
  OST_SpecialityEquipment: 'Équipements spécialisés',
};

/** Libellé FR pour affichage ; retombe sur le bic si inconnu. */
export function labelBuiltinCategoryFr(bic) {
  const key = String(bic || '').trim();
  if (!key) return '';
  return BUILTIN_CATEGORY_LABELS_FR[key] || key;
}
