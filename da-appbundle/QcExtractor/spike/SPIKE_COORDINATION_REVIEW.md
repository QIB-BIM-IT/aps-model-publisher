# SPIKE — Lisibilité de la revue de coordination (Copy/Monitor) sans lien chargé

Branche `spike/qc-coordination-review`, **non destinée au merge**. Livrable : une
connaissance, pas une feature. Aucun contrôle, aucune migration, aucune écriture en
base, aucun changement de l'extraction existante n'a été produit.

## Question centrale

> L'état de revue de coordination (Coordination Review) est-il LISIBLE via l'API
> Revit sur le modèle hôte SEUL, ouvert en headless SANS charger le lien maître ?

## Réponse

- **Niveau minimal** (booléen « une revue de coordination est en attente ») : **NON.**
  Aucune API publique n'expose cet état, ni sur le document, ni sur le lien, ni sur
  les éléments monitorés.
- **Niveau riche** (combien / sur quoi / quel type de différence) : **NON** pour la
  partie « différence en attente ». En revanche, la **relation** Copy/Monitor
  elle-même (quels éléments hôte monitorent un élément d'un lien, et les ElementId
  monitorés) **EST lisible sur le modèle hôte seul, sans charger le lien**.

Autrement dit : on peut savoir **qu'il existe des éléments en copie-contrôle** et
**lesquels**, mais pas **qu'une revue est en attente** ni **quelle différence** la
motive. L'état « needs coordination review » n'est pas persistant dans une surface
d'API publique lisible ; il est reconstruit par l'UI de Coordination Review (qui
requiert le lien), et non exposé.

## Preuve d'API (vérifiée par inspection des métadonnées de RevitAPI.dll 2024 ET 2025)

Méthode de vérification : lecture PURE des métadonnées via `System.Reflection.Metadata`
(aucun assembly Autodesk chargé, aucun code Revit exécuté). Scripts et outil dans ce
dossier : `inspect-coordination-api.ps1`, `inspect-coordination-api2.ps1`, `SigDump/`.

### Ce qui EXISTE — la relation Copy/Monitor, lisible sur l'hôte seul

Sur `Autodesk.Revit.DB.Element` (signatures identiques 2024 et 2025) :

```
bool                 IsMonitoringLinkElement()
bool                 IsMonitoringLocalElement()
IList<ElementId>     GetMonitoredLinkElementIds()
IList<ElementId>     GetMonitoredLocalElementIds()
```

Ces méthodes portent sur des éléments du **document hôte** et ne prennent aucun
document lié en argument : elles sont donc appelables en headless sans
`GetLinkDocument()`. Elles décrivent la **relation de monitoring** (cet élément
copie-surveille un élément d'un lien, et les ElementId concernés), pas l'état
« différence en attente ».

Note importante sur `GetMonitoredLinkElementIds()` : les ElementId retournés
désignent des éléments **dans le document lié** (+ l'instance de lien). Les résoudre
en objets exige le lien chargé, mais la **présence de la relation** et son
**décompte** ne l'exigent pas.

### Ce qui N'EXISTE PAS — l'état de revue de coordination

- Aucun type `CoordinationReview`, `Autodesk.Revit.DB.*Review*`, `*CoordinationReview*`
  dans la surface publique. Les seuls hits sur « Review » sont des faux positifs
  internes (`ElementUniqueIdForREViewableCache`, `IsPreviewRelease`, etc.).
- Aucune API `GetCoordinationReview` ou équivalent.
- Aucun état « pending / out-of-date » spécifique au monitoring. Les membres
  `IsDataOutOfDate` (ViewSchedule/TableSectionData), `ConfigurationReloadInfo`,
  `EditingFailures.OutOfDateElements` concernent d'autres sujets (schedules, parts,
  édition collaborative), pas la revue de coordination.

### Sur le lien lui-même — rien sur la revue

`Autodesk.Revit.DB.RevitLinkType` (membres publics vérifiés) expose l'état du
FICHIER lié, pas de la revue :

```
LinkedFileStatus GetLinkedFileStatus()   // Loaded / Unloaded / NotFound / ... (état fichier)
bool             IsLoaded(...)           // chargement du lien
bool             LocallyUnloaded { get; }
ICollection<ElementId> GetChildIds() / GetLinks() / ...
```

`Autodesk.Revit.DB.RevitLinkInstance` n'expose que :

```
Document GetLinkDocument()               // charge/accède au document lié
void     MoveBasePointToHostBasePoint()
void     MoveOriginToHostOrigin()
```

Aucun de ces membres ne renseigne « revue de coordination en attente ».

## Deltas 2024 / 2025

**Aucun** sur le périmètre Copy/Monitor / Coordination Review. Les 4 méthodes de
monitoring sur `Element`, `RevitLinkType.GetLinkedFileStatus()` et
`RevitLinkInstance.GetLinkDocument()` ont des **signatures identiques** dans les deux
DLLs. Les seuls écarts observés dans l'inspection (2025 ajoute
`GeometryAugmentationRegistry`, `IGeometryAugmentationServer`,
`GPolyLineCoordinateBuilder`) sont hors sujet.

## Ce qu'exigerait la lecture de l'état de revue (puisque non lisible sans lien)

L'état « needs coordination review » n'étant pas exposé, même **charger le lien** ne
fournit pas d'API publique retournant directement ce statut : il n'existe pas de
`GetCoordinationReview()`. Une détection devrait être **reconstruite** à la main :

1. charger le lien maître en headless (`RevitLinkInstance.GetLinkDocument()`), donc
   payer le coût d'ouverture + résolution du lien cloud (impensable dans le run
   d'extraction actuel qui ouvre l'hôte sans liens) ;
2. pour chaque élément hôte monitoré (`IsMonitoringLinkElement()` +
   `GetMonitoredLinkElementIds()`), résoudre l'élément maître correspondant dans le
   document lié ;
3. comparer les propriétés surveillées (position, nom, etc.) côté hôte vs côté maître
   pour inférer une différence — c'est-à-dire **réimplémenter** la logique de
   Coordination Review, sans garantie de parité avec Revit, et sans accès au
   « change log » interne que l'UI utilise.

Implications : coût d'ouverture du lien (temps, mémoire, disponibilité du modèle
maître cloud), fragilité de la comparaison maison, et risque de faux positifs /
négatifs par rapport au verdict natif de Revit. À mettre en balance avec la valeur
« signaler qu'une intervention humaine est requise ».

## Constat transférable aux autres contrôles inter-modèles

Le principe général se confirme : **les relations de dépendance inter-modèles portées
par l'hôte sont souvent lisibles sans charger le lien, mais l'état dérivé qui dépend
du contenu du lien ne l'est pas.**

- **Espaces MEP bornés par un lien** (`Space`/`Room` dont les frontières viennent d'un
  lien архитecture) : les propriétés géométriques d'un espace (aire, volume) sont
  calculées et **stockées** dans l'hôte au dernier calcul — donc lisibles headless —
  mais elles peuvent être **périmées** si le lien a changé, et l'API n'expose pas un
  drapeau « frontière périmée à cause du lien ». Même dichotomie : la donnée est là,
  la fraîcheur vis-à-vis du lien ne l'est pas.
- Règle pratique pour de futurs contrôles QC : ce qui est **matérialisé/paramétré sur
  l'élément hôte** est extractible headless ; ce qui exige de **comparer à l'état
  courant du lien** exige de charger le lien et, souvent, de recalculer.

## Diagnostic runtime

**Aucun modèle de test avec copie-contrôle ET une revue de coordination EN ATTENTE
n'a été désigné pour ce spike.** Conformément à la consigne, aucun run spéculatif n'a
été émis et rien n'est deviné. Un tel run n'aurait de toute façon pas changé la
conclusion sur l'état de revue, puisque l'inspection des DLLs établit qu'aucune
surface d'API publique ne l'expose (avec ou sans lien).

Si un modèle adéquat est fourni ultérieurement, le seul diagnostic runtime **utile et
sûr** (sans toucher l'extraction existante) serait de confirmer que
`IsMonitoringLinkElement()` / `GetMonitoredLinkElementIds()` s'énumèrent bien sur
l'hôte seul et de compter les éléments en copie-contrôle par catégorie (axes/niveaux)
— ce qui documenterait le « niveau riche de la relation », sans jamais accéder à
l'état de revue.

## Conclusion pour un futur contrôle QC

- Faisable headless, sans lien : un contrôle « présence et volume de copie-contrôle »
  — booléen « le modèle contient des éléments en copie-contrôle » + décompte par
  catégorie (via `IsMonitoringLinkElement()` et le filtrage des ElementId hôte).
- Non faisable de façon fiable sans charger le lien (et sans API dédiée même avec) :
  un contrôle « revue de coordination en attente ». À ne pas promettre sur la base de
  l'API actuelle.
