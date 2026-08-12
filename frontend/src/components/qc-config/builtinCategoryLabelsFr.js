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

/** Noms EN observés côté extracteur DA → libellé FR (G504 typesFautifs.categorie). */
const EN_CATEGORY_LABELS_FR = {
  'Mechanical Equipment': 'Équipements mécaniques',
  Ducts: 'Gaines',
  'Duct Fittings': 'Raccords de gaine',
  'Duct Accessories': 'Accessoires de gaine',
  'Air Terminals': "Bouches d'aération",
  'Flex Ducts': 'Gaines flexibles',
  'Plumbing Fixtures': 'Appareils sanitaires',
  Pipes: 'Canalisations',
  'Pipe Fittings': 'Raccords de canalisation',
  'Pipe Accessories': 'Accessoires de canalisation',
  'Flex Pipes': 'Canalisations flexibles',
  Sprinklers: 'Sprinklers',
  'Electrical Equipment': 'Équipements électriques',
  'Electrical Fixtures': 'Dispositifs électriques',
  Lighting: 'Luminaires',
  'Lighting Fixtures': 'Luminaires',
  'Lighting Devices': "Dispositifs d'éclairage",
  'Communication Devices': 'Dispositifs de communication',
  'Data Devices': 'Dispositifs de données',
  'Fire Alarm Devices': "Dispositifs d'alarme incendie",
  'Security Devices': 'Dispositifs de sécurité',
  'Nurse Call Devices': "Dispositifs d'appel infirmier",
  'Telephone Devices': 'Dispositifs téléphoniques',
  'Audio Visual Devices': 'Dispositifs audiovisuels',
  Conduits: 'Conduits',
  'Conduit Fittings': 'Raccords de conduit',
  'Cable Trays': 'Chemins de câbles',
  'Cable Tray Fittings': 'Raccords de chemin de câbles',
  'Structural Columns': 'Poteaux porteurs',
  'Structural Framing': 'Ossature',
  'Structural Foundations': 'Fondations',
  'Structural Connections': 'Connexions structurelles',
  'Generic Models': 'Modèles génériques',
  'Specialty Equipment': 'Équipements spécialisés',
};

/** Libellé FR pour affichage ; retombe sur le bic / nom EN si inconnu. */
export function labelBuiltinCategoryFr(bic) {
  const key = String(bic || '').trim();
  if (!key) return '';
  if (BUILTIN_CATEGORY_LABELS_FR[key]) return BUILTIN_CATEGORY_LABELS_FR[key];
  if (EN_CATEGORY_LABELS_FR[key]) return EN_CATEGORY_LABELS_FR[key];
  return key;
}
