# API vérifiée — G314 RÉVISÉ (plages d'étages + paramètres natifs)

Vérification métadonnées `RevitAPI.dll` 2024 et 2025.

## Building Story

`BuiltInParameter.LEVEL_IS_BUILDING_STORY` présent 2024/2025.
Propriété `Level.IsBuildingStory` absente des métadonnées → lecture via le paramètre.

Filtre additif `hauteurMinEtageMm` (défaut 2000, config) : un Building Story n'est
retenu comme borne d'étage que s'il est à ≥ ce seuil au-dessus du précédent retenu.
Sans filtre, les niveaux techniques serrés (usines) créent des plages &lt; 1 m irréalistes.

## Niveau déclaré (Familles A/B)

Présents : `INSTANCE_REFERENCE_LEVEL_PARAM`, `FAMILY_LEVEL_PARAM`,
`RBS_START_LEVEL_PARAM`, `SCHEDULE_LEVEL_PARAM`, `WALL_BASE_CONSTRAINT`,
`STAIRS_BASE_LEVEL_PARAM`, `ROOF_CONSTRAINT_LEVEL_PARAM`,
`INSTANCE_SCHEDULE_ONLY_LEVEL_PARAM` (dernier : peut différer de la contrainte).

**Absent** : `RBS_REFERENCE_LEVEL_PARAM` — omis.
**Pas de repli** `Element.LevelId` (révision).

## Offset (Famille A)

Présents 2024/2025 : `INSTANCE_FREE_HOST_OFFSET_PARAM`,
`FAMILY_BASE_LEVEL_OFFSET_PARAM`, `RBS_OFFSET_PARAM`, `RBS_START_OFFSET_PARAM`,
`SCHEDULE_BASE_LEVEL_OFFSET_PARAM`, `ASSOCIATED_LEVEL_OFFSET`,
`INSTANCE_OFFSET_POS_PARAM`, `INSTANCE_ELEVATION_PARAM` (dernier : parfois absolu).

## Base / Top (Famille C)

Présents : `FAMILY_BASE_LEVEL_PARAM` / `FAMILY_TOP_LEVEL_PARAM`,
`SCHEDULE_BASE_LEVEL_PARAM` / `SCHEDULE_TOP_LEVEL_PARAM`.

## LocationCurve / unités

`LocationCurve.Curve`, `Curve.GetEndPoint`, `Level.Elevation`,
`UnitUtils.ConvertFromInternalUnits` / `ConvertToInternalUnits` + `UnitTypeId.Millimeters`.
Comparaison d'`ElementId` via `.Value` (cohérent net48 / net8.0-windows).

## Deltas 2024 / 2025

Aucun sur le périmètre G314 (hors ajouts UnitTypeId / Rebar hors sujet).
