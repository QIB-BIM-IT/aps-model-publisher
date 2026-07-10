# API vérifiée — G210 (copie-contrôle axes/niveaux)

Vérification par lecture PURE des métadonnées (`spike/coord-controls/ApiDump`)
contre `RevitAPI.dll` 2024 et 2025. Aucun assembly Autodesk chargé.

## Signatures (identiques 2024 / 2025)

Sur `Autodesk.Revit.DB.Element` :

```
Boolean IsMonitoringLinkElement()
Boolean IsMonitoringLocalElement()
IList<ElementId> GetMonitoredLinkElementIds()
IList<ElementId> GetMonitoredLocalElementIds()
String get_Name() / P String Name
```

Sur `Autodesk.Revit.DB.RevitLinkInstance` :

```
Document GetLinkDocument()   // EXISTE — JAMAIS appelé par G210
```

**Delta 2024/2025 : aucun** sur ce périmètre (Compare-Object des lignes Monitor /
GetLinkDocument : vide).

## Nom de l'instance de lien SANS charger le lien

`GetMonitoredLinkElementIds()` renvoie des `ElementId` d'**instances de lien**
(`RevitLinkInstance`) portées par le document hôte (constat forums Autodesk +
résolution runtime via `doc.GetElement(id)`).

Sur l'hôte seul :

1. `el.IsMonitoringLinkElement()` → présence de la relation ;
2. `el.GetMonitoredLinkElementIds()` → IDs d'instances de lien ;
3. `doc.GetElement(id) as RevitLinkInstance` → instance hôte ;
4. `instance.Name` (hérité de `Element`) → **nom lisible sans `GetLinkDocument()`**.

Si la résolution échoue, G210 rapporte `id:<ElementId.Value>` — jamais de chargement
de lien. Ambiguïté résolue : le nom de l'instance est lisible sur l'hôte seul.

## Hors périmètre

L'état « revue de coordination en attente » n'est **pas** lisible (voir
`SPIKE_COORDINATION_REVIEW.md`). G210 mesure la **présence** de monitoring, pas
sa fraîcheur.
