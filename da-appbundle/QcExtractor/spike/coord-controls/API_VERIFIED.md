# Vérification d'API — lot COORDONNÉES (G104, G105, G200, G201, G202)

Méthode : lecture **PURE** des métadonnées de `RevitAPI.dll` (2024 ET 2025) via
`System.Reflection.Metadata` — aucun assembly Autodesk chargé, aucun code Revit
exécuté. Outil : `ApiDump/` (généralise `../SigDump`, dumpe tous les membres publics
des types demandés). Sorties brutes : `api-2024.txt`, `api-2025.txt`.

Reproduire :

```
dotnet run --project ApiDump -- "C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll" \
  Document Units FormatOptions SpecTypeId UnitTypeId ForgeTypeId UnitUtils \
  ProjectInfo BasePoint InternalOrigin ProjectLocation ProjectPosition XYZ > api-2024.txt
# idem avec "...Revit 2025\RevitAPI.dll" > api-2025.txt
```

## Signatures retenues (identiques 2024 et 2025, sauf mention)

### G104 — Système d'unités
| Appel | Signature (2024 = 2025) |
|---|---|
| `Document.GetUnits()` | `Autodesk.Revit.DB.Units GetUnits()` |
| `Units.GetFormatOptions(spec)` | `FormatOptions GetFormatOptions(ForgeTypeId)` |
| `FormatOptions.GetUnitTypeId()` | `ForgeTypeId GetUnitTypeId()` |
| `ForgeTypeId.TypeId` | `String TypeId` (getter) |
| specs | `SpecTypeId.Length/Area/Volume` → `static ForgeTypeId` |
| unités | `UnitTypeId.Meters/Millimeters/SquareMeters/CubicMeters` → `static ForgeTypeId` |

### G105 — Informations projet
| Appel | Signature (2024 = 2025) |
|---|---|
| `Document.ProjectInformation` | `ProjectInfo ProjectInformation` |
| `ProjectInfo.*` | `String` : `Address, Author, BuildingName, ClientName, IssueDate, Name, Number, OrganizationName, OrganizationDescription, Status` |

### G200 — Point de base projet vs origine interne (comparaison INTERNE)
| Appel | Signature (2024 = 2025) |
|---|---|
| `BasePoint.GetProjectBasePoint(doc)` | `static BasePoint GetProjectBasePoint(Document)` |
| `BasePoint.Position` | `XYZ Position` |
| `InternalOrigin.Position` | `XYZ Position` (instance lue via `FilteredElementCollector.OfClass(typeof(InternalOrigin))`) |
| `XYZ.X/Y/Z` | `Double` (getters) |
| `UnitUtils.ConvertFromInternalUnits(v, unit)` | `static Double ConvertFromInternalUnits(Double, ForgeTypeId)` |

Levée d'ambiguïté **point de base vs origine** : le point de base projet expose
`Position` en **coordonnées PROJET** (donc relatives à l'origine interne). L'origine
interne est, par définition, à `(0,0,0)` dans ce système ; l'extracteur lit malgré
tout `InternalOrigin.Position` et fait la soustraction littérale (repli `XYZ.Zero` si
l'élément n'est pas collecté — résultat identique). Aucune référence externe.

### G201 — Géoréférencement : SURVEY POINT (pas le point de base)
| Appel | Signature (2024 = 2025) |
|---|---|
| `BasePoint.GetSurveyPoint(doc)` | `static BasePoint GetSurveyPoint(Document)` |
| `BasePoint.SharedPosition` | `XYZ SharedPosition` |

Levée d'ambiguïté **survey point vs base point** : on lit le **survey point**
(`GetSurveyPoint`), et sa **`SharedPosition`** (coordonnées PARTAGÉES = réelles,
fixées par « Specify Coordinates at Point »), pas `Position` (coordonnées projet), et
surtout pas le point de base. Mapping d'axes retenu (convention Revit) :
`X = Est/Ouest (eo)`, `Y = Nord/Sud (ns)`, `Z = élévation (elev)`. Converties en mètres.

### G202 — Angle au nord vrai
| Appel | Signature (2024 = 2025) |
|---|---|
| `Document.ActiveProjectLocation` | `ProjectLocation ActiveProjectLocation` |
| `ProjectLocation.GetProjectPosition(xyz)` | `ProjectPosition GetProjectPosition(XYZ)` |
| `ProjectPosition.Angle` | `Double Angle` (radians) |
| `XYZ.Zero` | `static XYZ Zero` |

Levée d'ambiguïté **lecture de l'angle au nord vrai** : `GetProjectPosition(XYZ.Zero)`
renvoie la position partagée à l'origine interne ; son champ **`Angle`** est la
rotation (radians) entre le nord PROJET et le nord VRAI. Converti en degrés et
normalisé sur `[0, 360)`. La comparaison à la cible (scoreur `angle`) gère le
wrap-around.

## Deltas 2024 / 2025

**Aucun** sur les membres utilisés par les 5 contrôles : toutes les signatures
ci-dessus sont présentes et identiques dans les deux DLLs (n° de ligne différents
uniquement, voir `api-2024.txt` / `api-2025.txt`). Aucune API utilisée n'est absente
d'une des deux cibles.
