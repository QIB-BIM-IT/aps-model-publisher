# API vérifiée — G412 hygiène du modèle

Vérification métadonnées `RevitAPI.dll` 2024 et 2025 (spike ApiDump, lecture PURE).

## Familles in place

| Membre | 2024 | 2025 |
|--------|------|------|
| `Family.IsInPlace` (prop + `get_IsInPlace`) | présent | présent |

Comptage des instances : `FamilyInstance` dont `Symbol.Family.IsInPlace == true`,
agrégé par `Family.Id.Value`. Familles in place sans instance aussi listées (0 instance).

## Groupes miroir — AMBIGUÏTÉ API DOCUMENTÉE

| Type | Propriété Mirrored / IsMirrored | 2024 | 2025 |
|------|----------------------------------|------|------|
| `Group` | **aucune** | — | — |
| `GroupType` | **aucune** | — | — |
| `FamilyInstance.Mirrored` | présent | oui | oui |
| `Transform.HasReflection` | présent | oui | oui |

**Pas de propriété native « groupe miroir ».** La méthode fiable citée sur les forums
Autodesk (placer une instance temporaire du `GroupType`, comparer les transforms des
membres, `Transaction.RollBack`) n'est **pas** retenue ici : aucun extracteur du module
n'ouvre de transaction ; risque headless DA (échec PlaceGroup, worksets, groupes attachés).

### Méthode retenue (lecture seule)

Consensus sur les membres `FamilyInstance` du groupe (`Group.GetMemberIds`) :

- **0 FI** → indéterminé (rapporté à part, **non** compté comme miroir)
- **tous** les FI ont `Mirrored == true` → groupe miroir
- sinon → non miroir (un FI miroir isolé dans un groupe normal ne crée **pas** de faux positif)

Limite : un groupe miroir composé uniquement de murs / courbes système (sans FI) reste
indéterminé. Signalé dans `valeur_json.groupesMiroir.nbIndetermines`.

## Deltas 2024 / 2025

Aucun sur le périmètre G412 (`IsInPlace`, `Mirrored`, absence de mirroir sur `Group`).

## Code retenu : G412

Pas G106 : le catalogue / doc existants associent G106 à « Fichier purgé » (Manuel).
G412 = Organisation Revit (après G411 types de groupes inutilisés). La purge reste hors outil.
