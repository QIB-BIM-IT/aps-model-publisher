# API vérifiée — G412 hygiène du modèle (révision)

Vérification métadonnées `RevitAPI.dll` 2024 et 2025.

## Familles in place

| Membre | 2024 | 2025 |
|--------|------|------|
| `Family.IsInPlace` | présent | présent |

## Groupes — comptes exacts (pas de miroir)

| Membre | 2024 | 2025 |
|--------|------|------|
| `GroupType.Groups` (prop) | présent | présent |
| `GroupSet.Size` (via Groups) | utilisé comme G411 | idem |
| `Group.GetMemberIds()` | présent | présent |
| `Element.Pinned` | présent | présent |
| `Element.ViewSpecific` | présent | présent |
| `Element.Category` / `Name` | présent | présent |

**Critère « instance unique »** : `GroupType.Groups.Size == 1` (nombre d'INSTANCES du
type), distinct du nombre de MEMBRES (`GetMemberIds`, info complémentaire).

## Groupes miroir — RETIRÉ

`Group` / `GroupType` n'exposent **aucune** propriété Mirrored (2024=2025).
L'heuristique `FamilyInstance.Mirrored` est retirée (indéterminés massifs, non fiable).

## Deltas 2024 / 2025

Aucun sur le périmètre G412.

## Code : G412

Pas G106 (purge = Manuel). G412 = Organisation Revit.
