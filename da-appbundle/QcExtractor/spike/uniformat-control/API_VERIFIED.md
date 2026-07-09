# Vérification d'API — G504 couverture UNIFORMAT (contrôle MODÈLE)

Méthode : lecture **PURE** des métadonnées de `RevitAPI.dll` (2024 ET 2025) via
`System.Reflection.Metadata` — aucun assembly Autodesk chargé, aucun code Revit
exécuté. Outil réutilisé : `../coord-controls/ApiDump/`. Sorties brutes :
`uniformat-api-2024.txt` / `uniformat-api-2025.txt` (types), `bip-*.txt`
(enum `BuiltInParameter`), `bic-*.txt` (enum `BuiltInCategory`).

Reproduire :

```
$p = "../coord-controls/ApiDump"
dotnet run --project $p -- "C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll" \
  Element ElementId ElementType FamilySymbol Parameter Definition StorageType \
  FilteredElementCollector Category BindingMap Binding InstanceBinding TypeBinding \
  DefinitionBindingMapIterator > uniformat-api-2024.txt
dotnet run --project $p -- "C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll" BuiltInParameter > bip-2024.txt
dotnet run --project $p -- "C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll" BuiltInCategory > bic-2024.txt
# idem avec "...Revit 2025\RevitAPI.dll"
```

## Paramètre « Code d'assemblage » (Assembly Code) — natif

| Élément | Résultat (2024 = 2025) |
|---|---|
| BuiltInParameter du Code d'assemblage | **`UNIFORMAT_CODE`** (`bip-*.txt` L331/333) |
| (description associée) | `UNIFORMAT_DESCRIPTION` |

**Levée d'ambiguïté** demandée : le Code d'assemblage n'est PAS un commentaire
(`ALL_MODEL_INSTANCE_COMMENTS`) ni `ASSEMBLY_NAME` (fonction « assemblages » de Revit,
sans rapport). Le paramètre natif qui porte le code UNIFORMAT est bien
`BuiltInParameter.UNIFORMAT_CODE`. C'est un paramètre de **TYPE**.

## Lecture d'un paramètre (natif OU partagé par nom)

| Appel | Signature (2024 = 2025) |
|---|---|
| Natif par enum | `Parameter Element.get_Parameter(BuiltInParameter)` |
| Partagé/projet par nom | `Parameter Element.LookupParameter(String)` |
| Type d'un élément | `ElementId Element.GetTypeId()` |
| Valeur présente ? | `Boolean Parameter.HasValue` |
| Stockage | `StorageType Parameter.StorageType` (None/Integer/Double/String/ElementId) |
| Valeur texte | `String Parameter.AsString()` / `String Parameter.AsValueString()` |
| Définition | `Definition Parameter.Definition` ; `Boolean Parameter.IsShared` |
| Type d'élément | `String ElementType.FamilyName`, `String ElementType.Name` |
| Catégorie | `Category Element.Category` → `String Name`, `BuiltInCategory BuiltInCategory` |

## Détection de nature TYPE vs INSTANCE (adaptative)

Deux signaux, vérifiés contre les DLLs :

1. **Bindings** (autoritaire pour les paramètres partagés/projet) :
   `doc.ParameterBindings.ForwardIterator()` → `it.Key` (`Definition`) et
   `it.Current` (`Object`, à caster). Types présents des deux côtés :
   `Autodesk.Revit.DB.InstanceBinding` et `Autodesk.Revit.DB.TypeBinding`.
   `Definition.Name == <nom>` → `is TypeBinding` ⇒ type ; `is InstanceBinding` ⇒ instance.
2. **Sondage** (nécessaire pour les natifs, absents des bindings) : sur un élément
   témoin, `instance.get_Parameter(bip) != null` ⇒ instance ; sinon
   `GetElement(instance.GetTypeId()).get_Parameter(bip) != null` ⇒ type ; sinon absent.

`UNIFORMAT_CODE` : le sondage renvoie **type** (présent sur le type, null sur l'instance).

## Identifiant d'élément (cohérence 2024/2025)

| Appel | Signature (2024 = 2025) |
|---|---|
| `ElementId.Value` | **`Int64 Value`** (getter) des DEUX côtés |

`ElementId.Value` (Int64) est présent et identique en 2024 et 2025 — c'est déjà l'ID
stocké par G408 (`FailingElements().Select(id => id.Value)`). Aucun recours à
`IntegerValue` (obsolète/retiré). Pas de delta.

## Collecte

| Appel | Signature (2024 = 2025) |
|---|---|
| `FilteredElementCollector.OfCategory(BuiltInCategory)` | idem |
| `FilteredElementCollector.WhereElementIsNotElementType()` | idem |

## Liste blanche BuiltInCategory — existence 2024 ET 2025

34 des 35 entrées de l'amorce existent à l'identique dans les deux DLLs.

**Correction signalée (ambiguïté d'API)** : l'amorce listait `OST_StructuralConnections`,
qui **n'existe pas** dans l'enum `BuiltInCategory`. La catégorie réelle des connexions
structurelles est **`OST_StructConnections`** (présente en 2024 et 2025, `bic-*.txt`
L791). La norme maison utilise donc `OST_StructConnections`.

`OST_GenericModel` et `OST_SpecialityEquipment` sont marquées **optionnelles**
(désactivables) dans la norme (ambiguïté design, chevauchement avec G308).

## Deltas 2024 / 2025

**Aucun** sur les membres utilisés par G504 : toutes les signatures ci-dessus sont
présentes et identiques dans les deux DLLs (n° de ligne différents uniquement). Aucune
API utilisée n'est absente d'une des deux cibles.
