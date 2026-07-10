# API vérifiée — G314 (rattachement au niveau)

Vérification par lecture PURE des métadonnées contre `RevitAPI.dll` 2024 et 2025.

## Signatures utilisées (identiques 2024 / 2025)

- `Element.LevelId`, `Element.Location`, `Element.get_BoundingBox(View)`
- `LocationPoint.Point`, `LocationCurve.Curve` (+ `Curve.GetEndPoint`)
- `Level.Elevation`, `Level.ProjectElevation`
- `UnitUtils.ConvertFromInternalUnits(Double, ForgeTypeId)` / `UnitTypeId.Millimeters`
- `Element.get_Parameter(BuiltInParameter)`, `Parameter.AsElementId()`, `StorageType.ElementId`

## Building Story

La propriété `Level.IsBuildingStory` **n'apparaît pas** dans les métadonnées publiques
des propriétés de `Level` (seuls `Elevation` / `ProjectElevation` listés). En revanche
`BuiltInParameter.LEVEL_IS_BUILDING_STORY` existe en 2024 **et** 2025.

**Choix G314** : lire Building Story via `level.get_Parameter(LEVEL_IS_BUILDING_STORY)`
(`AsInteger() == 1`), avec repli sur tous les niveaux si aucun Building Story — comme le
script pyRevit (qui utilisait `level.IsBuildingStory` en interactif).

## BuiltInParameter de niveau (liste du script)

Présents 2024/2025 :
`INSTANCE_SCHEDULE_ONLY_LEVEL_PARAM`, `SCHEDULE_LEVEL_PARAM`, `FAMILY_LEVEL_PARAM`,
`INSTANCE_REFERENCE_LEVEL_PARAM`, `RBS_START_LEVEL_PARAM`, `WALL_BASE_CONSTRAINT`,
`STAIRS_BASE_LEVEL_PARAM`, `ROOF_CONSTRAINT_LEVEL_PARAM`.

**Absent des deux DLLs** : `RBS_REFERENCE_LEVEL_PARAM` (le script pyRevit le tolérait via
`getattr` → `None`). Non utilisé par G314.

## BuiltInCategory

Liste MEP + STRUCTURE du prompt : toutes présentes. `OST_StructConnections` (pas
`OST_StructuralConnections`).

## Deltas 2024 / 2025

Aucun sur le périmètre G314 (hors ajouts UnitTypeId hors sujet en 2025).
