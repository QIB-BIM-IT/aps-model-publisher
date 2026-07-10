# Module QC BIM — tranche verticale G408 (Design Automation for Revit)

Module **strictement additif** : tout vit dans le schéma PostgreSQL `qc`, géré par des
migrations umzug réversibles (`qc.migrations`). Le schéma `public` reste géré par
`sequelize.sync()` comme aujourd'hui et n'est jamais modifié.

## Architecture

```
POST /api/qc/runs (JWT)                       [qc.routes.js]
  └─ qcRun.service.startRun()
       ├─ ensureValidToken(userId)            → token 3 legs frais (refresh juste avant submit)
       ├─ vérif scope code:all                → 403 explicite si absent (montée progressive)
       ├─ INSERT qc.runs (queued)             → snapshot executedByName/executedByAutodeskId
       ├─ URL signée OSS (result.json)
       └─ workitem DA4R                       [qcDesignAutomation.service.js]
            arguments: inputParams (data-url), result (put), adsk3LeggedToken, onComplete?
                 │
                 ▼  moteur Autodesk.Revit+2024
            QcExtractor.bundle : params.json → IModelSource (ouverture cloud US/EMEA)
                                → Document.GetWarnings() → result.json {total, critical, warnings[]}
                 │
   complétion double canal (verrou EN BASE : update conditionnel sur qc.runs.status)
   ├─ POST /api/qc/da-callback?runId&sig      (jeton HMAC ; statut workitem re-vérifié)
   └─ polling GET workitems/:id               (secours, 30 s, timeout 20 min)
                 │
                 ▼
   qc.control_results (G408: valeur_num=total, valeur_json={total,critical}, signature humaine NULL)
   qc.warnings        (1 ligne par avertissement, severity warning|critical)
```

## Variables d'environnement (toutes nouvelles, aucune existante modifiée)

| Variable | Obligatoire | Description |
|---|---|---|
| `QC_DA_ACTIVITY_ID_2024` / `QC_DA_ACTIVITY_ID_2025` | **au moins une** (active le module DA) | Ids qualifiés des activities par version Revit, ex. `<nickname>.qc_extractor_activity_2025+prod`. Affichés par `setup-da.js --engine-version <v>`. Le routage choisit l'activity selon la version résolue du modèle ; version sans activity configurée ⇒ run `failed` explicite, aucun workitem. L'ancien `QC_DA_ACTIVITY_ID` reste lu comme alias 2024 (compat). |
| `QC_OSS_BUCKET` | non | Bucket OSS transient des résultats (défaut dérivé du client id). |
| `QC_CALLBACK_BASE_URL` | non | Base publique pour le callback `onComplete` (ex. `https://<app>.azurewebsites.net`). Absent ⇒ polling seul. |
| `QC_CALLBACK_SECRET` | non | Secret HMAC du callback (défaut : `WEBHOOK_SECRET` puis `JWT_SECRET`). |
| `QC_DA_NICKNAME` / `QC_DA_APPBUNDLE` / `QC_DA_ACTIVITY` / `QC_DA_ALIAS` / `QC_DA_ENGINE` | non | Défauts : client id / `QcExtractor` / `QcExtractG408` / `prod` / `Autodesk.Revit+2024`. |
| `QC_POLL_INTERVAL_MS` / `QC_POLL_TIMEOUT_MS` | non | Polling de secours (30 000 / 1 200 000). |

**Scopes** : ajouter `code:all` à `APS_SCOPES` (3 legs, pour les prochains logins) et il est
demandé automatiquement par le token 2 legs privé du module QC. Montée progressive : aucune
session existante n'est cassée ; un utilisateur QC dont le token ne porte pas `code:all`
reçoit une erreur explicite l'invitant à se reconnecter.

## Mise en route (multimoteur 2024/2025)

1. **Build de l'addin** (Revit 2024 → net48, Revit 2025 → **net8.0-windows** ; dotnet SDK 8 requis) :
   `pwsh da-appbundle/QcExtractor/build-bundle.ps1 -EngineVersion 2024` puis `-EngineVersion 2025`
2. **Provisioning DA** (AppBundle + Activity par version, alias, bucket — idempotent, nickname jamais modifié) :
   `node backend/scripts/setup-da.js --engine-version 2024` puis `--engine-version 2025`
   puis poser `QC_DA_ACTIVITY_ID_2024` / `QC_DA_ACTIVITY_ID_2025` (valeurs affichées).
3. **Migrations** : appliquées automatiquement au boot (après `connectDB()`/sync), ou à la main :
   `node backend/scripts/qc-migrate.js up | down | down-all | status`
   (`down-all` = rollback complet : tables + types + schéma qc supprimés).
4. **Lancer un run** — désignation lisible, la version et la garde workshared sont résolues par
   métadonnée DM (un seul GET Version, sans ouverture, sans Model Derivative) :
   ```
   POST /api/qc/runs   (Authorization: Bearer <JWT applicatif>)
   { "accUrl": "https://acc.autodesk.com/docs/files/projects/<guid>?...&entityId=<urn>" }
   ou { "hubName": "...", "projectName": "...", "fileName": "xxx.rvt" }
   ou { "projectId": "b.xxx", "itemUrn": "urn:adsk.wipprod:dm.lineage:..." }
   (+ "runType": "quotidien" | "jalon")
   ```
   `POST /api/qc/resolve` (même body) : résolution seule, aucun run ni workitem — diagnostic.

## Gardes du resolver

- **Workshared (double signal DM vérifié)** : `extension.type === 'versions:autodesk.bim360:C4RModel'`
  ET `extension.data.modelType === 'multiuser'`. Sinon : run `failed` « hors périmètre, non
  workshared », `daWorkitemId` NULL, aucun workitem. (`accModelGuid` reçoit la sentinelle
  `00000000-…` : un non-workshared n'a pas de GUID de modèle cloud ; contexte réel dans `stats.itemUrn`.)
- **Version** : `extension.data.revitProjectVersion` (number JSON, normalisé en chaîne) fait foi,
  sans ouverture de confirmation. Version sans activity configurée → run `failed` explicite.
- **Incohérence métadonnée** (cas réel confirmé — gabarit) : si l'engine annoncé refuse avec
  « cloud model is not saved in current release », le run est `failed` avec un message dédié
  signalant l'incohérence. Aucun essai d'engine adjacent, aucune réparation silencieuse.
- `qc.projects` (migration 0002) : attributs projet uniquement (region, hub, ids), upsert par le
  resolver ; PAS de version, PAS de FK depuis `qc.runs` (jointure sur `accProjectGuid`).

## Scoring de criticité (chantier 2)

- **Grille maison** : [config/qc-criticality-grid.json](../config/qc-criticality-grid.json),
  versionnée dans le repo. Clé = **Guid de définition** (stable, indépendant de la langue —
  voir docs/SPIKE_WARNING_IDENTITY.md sur la branche spike). **Deux niveaux, libellés
  français définitifs stockés en base** : `critique` (touche la performance ou l'intégrité —
  seuls les critiques sont listés dans la grille) et `faible` (tout le reste, **défaut** pour
  tout Guid absent). Raffinement optionnel par pattern texte à l'intérieur d'un Guid.
  Seuils de volume : `totalMax`, `criticalMax`.
- **Surcharge projet** : `qc.project_config.config.criticite` (jsonb), ne porte que les
  écarts : `{ "criticite": { "guids": { "<guid>": { "niveau": "high" } }, "seuils": { … } } }`.
  Projet sans config → héritage complet de la grille maison.
- **Effets sur un run** (`qcScoring.service`, appelé dans la transaction de finalisation) :
  `qc.warnings.criticite` par ligne ; `qc.control_results` : `valeur_num` = total (inchangé),
  `valeur_json = { total, critical: <nb critiques>, parNiveau: {critique, faible} }`,
  `statut` = `non_conforme` si critiques > criticalMax OU total > totalMax, sinon `conforme`.
  Recalcul des runs existants sans DA : `node scripts/qc-rescore.js` (déterministe, en place).
- **Inventaire des Guids** (remplissage de la grille) :
  `node scripts/qc-batch-inventory.js --models <liste.json>` lance l'extraction normale sur un
  lot de modèles (désignations lisibles, non-workshared/versions non supportées sautés proprement ;
  voir `scripts/qc-inventory-models.example.json`), puis
  `node scripts/qc-inventory-export.js` exporte `exports/qc-guid-inventory-<date>.csv`
  (tous runs confondus, groupé par Guid, à annoter dans Excel — les re-runs d'un même
  modèle gonflent la colonne occurrences ; `nb_modeles` est dédoublonné).
- **Règle** : extraction toujours ; scoring seulement si une grille est disponible (elle est
  livrée avec le code ; si illisible → log + comportement tranche 1, colonnes à NULL).
  La signature humaine reste NULL sur run automatique.

## Multi-contrôles (chantier 3)

- **Registre d'extracteurs** (addin, `IControlExtractor` + `ControlRunner`) : chaque contrôle
  MODÈLE tourne dans son propre try — un échec produit une ligne `etat_extraction='echec'`
  + `erreur_extraction`, les autres continuent. Payload v2 (`{schemaVersion:2, controls:[…]}`),
  compat lecture v1 (G408 seul) conservée côté backend.
- **Fork MÉTA/MODÈLE** : contrôles MÉTA calculés dans le backend depuis la métadonnée DM du
  resolver (`qcMetaControls.service`, ex. G102 via `storageSize` — zéro workitem), contrôles
  MODÈLE dans l'addin. TOUTES les lignes sont persistées dans UNE transaction à la
  finalisation, même runId — un run échoué n'a AUCUNE ligne.
- **Deux axes jamais mélangés** sur `qc.control_results` (migration 0004) :
  `etat_extraction` technique ('extrait'|'echec') et `statut` métier
  ('conforme'|'non_conforme'|NULL). RÈGLE ABSOLUE : un échec d'extraction force
  `statut` NULL, aucun scoreur appelé. Trois cas lisibles : jugé / relevé sans cible /
  bug d'extraction.
- **Catalogue** [config/qc-controls-catalog.json](../config/qc-controls-catalog.json)
  (code → source meta|modele, forme) et **scoreurs par forme** (`seuil`, `comptage`,
  `presence` ; `pourcentage`/`liste` déclarés). Cibles EXCLUSIVEMENT depuis
  `qc.project_config.config.controles[code].cible` — sans cible : statut NULL. G408
  garde son scoring par Guid, inchangé.
- Contrôles actuels : G408 (modèle/guid), G102 (méta/seuil, octets), G411 (modèle/comptage,
  groupes inutilisés), G502 (modèle/presence, paramètres de projet — lecture des noms
  uniquement, `Definition.ParameterGroup` interdit car supprimé de l'API 2025).
- **Lot 1** : G101 (méta/`egalite` — écart entre version PEB cible et `revitProjectVersion`
  réelle), G103 (méta/`pattern` — nom de fichier vs regex de convention), G309
  (modèle/comptage — Duct/Pipe/FlexDuct/FlexPipe avec `MEPSystem` null ; CableTray/Conduit
  exclus, sans notion de système), G310 (modèle/comptage — `UnusedConnectors`, **compte brut
  indicatif et bruyant**, aucun tri légitime/fautif dans cette tranche), G402
  (modèle/comptage — variantes présentes, jugement de superfluité humain), G410
  (modèle/comptage — vues `NotPlaced` hors gabarits, liste plafonnée à 200 noms).
  API vérifiée identique 2024/2025 pour toutes ces lectures.
- **Lot 2** : G406 (modèle/presence — noms de phases, liste ORDONNÉE via `Document.Phases`),
  G407 (modèle/**`sequence`** — même lecture que G406 partagée par `PhaseReader`, une seule
  traversée ; règle : la cible doit être une sous-séquence ordonnée de la liste réelle,
  éléments intercalés tolérés, ordre relatif exigé), G507 (modèle/presence —
  `SharedParameterElement`+`GuidValue` ; distinction documentée : G502 = liaisons de
  paramètres de PROJET via ParameterBindings, G507 = définitions de paramètres PARTAGÉS
  identifiées par leur Guid de fichier partagé). API vérifiée identique 2024/2025.
- **Lot NOMMAGE** : G404 (modèle/nommage — sous-projets UTILISATEUR via
  `FilteredWorksetCollector.OfKind(WorksetKind.UserWorkset)` → `Workset.Name` ; les
  sous-projets système vues/familles/normes sont exclus par `OfKind` ; « Niveaux et
  quadrillages partagés » est classé `UserWorkset` par l'API sans drapeau d'exclusion
  fiable — il reste dans la liste relevée et s'exempte via `exceptions` en config,
  jamais par un filtre de nom codé en dur), G203 (modèle/nommage — niveaux via
  `OfClass(Level)` → `Element.Name`), G205 (modèle/nommage — axes/quadrillages via
  `OfClass(Grid)` → `Element.Name`, dédoublonné : les segments d'un quadrillage
  multi-segments portent le même nom). API vérifiée identique 2024/2025.
  La forme `pattern` reste RÉSERVÉE à G103 (cible chaîne regex sur UNE valeur) ;
  piste d'unification future vers `nommage`, aucune action maintenant.
- **Lot COORDONNÉES** (tous MODÈLE, hôte seul, sans lien ; API vérifiée identique
  2024/2025 — preuves dans `da-appbundle/QcExtractor/spike/coord-controls/API_VERIFIED.md`) :
  G104 (modèle/`egalite` — système d'unités longueur/aire/volume via `Document.GetUnits()`
  → `SpecTypeId.Length/Area/Volume`, `valeur_text` = jeton canonique `« longueur|aire|volume »`),
  G105 (modèle/`presence` — champs `ProjectInfo`, `champListe='champsRenseignes'` = clés non
  vides), G200 (modèle/`seuil` — écart point de base projet vs origine interne, comparaison
  INTERNE, `valeur_num` = plus grand écart absolu par axe en mètres), G201 (modèle/**`coordonnees`**
  — **survey point** `BasePoint.GetSurveyPoint(doc).SharedPosition`, PAS le point de base ;
  3 composantes ns/eo/elev en mètres), G202 (modèle/**`angle`** — angle au nord VRAI via
  `ActiveProjectLocation.GetProjectPosition(XYZ.Zero).Angle`, degrés normalisés `[0,360)`).

## Forme de scoreur « nommage » (lot NOMMAGE)

Valide une **liste de noms** relevée par l'extracteur (localisée par `champListe` du
catalogue) contre une convention décrite dans
`qc.project_config.config.controles[<code>].cible`. Chaque nom est marqué conforme ou
non : le contrôle est `conforme` si TOUS les noms passent, `non_conforme` si au moins
un échoue, et `valeur_json.nommage.nomsNonConformes` liste les noms à corriger.
Sans cible : extraction réussie, `statut` NULL (comme partout). Liste vide (ou tous
les noms exemptés) : `conforme` (vérité par vacuité). Cible malformée ou regex
invalide : `statut` NULL + warn — jamais de faux verdict.

La cible est un **objet** avec un champ `type` (trois sous-formes, de la plus simple à
la plus puissante) :

1. **`prefixe`** — le nom doit commencer par le préfixe donné. Le cas le plus fréquent
   et le plus lisible :

   ```json
   { "controles": { "G404": { "cible": { "type": "prefixe", "valeur": "TT-" } } } }
   ```

2. **`segments`** — le nom doit être découpé par le séparateur en un nombre de morceaux
   attendu, aucun morceau vide (`A--B` ou `-A-B` sont non conformes). `nbMax` est
   optionnel (absent = pas de plafond) :

   ```json
   { "controles": { "G203": { "cible": { "type": "segments", "separateur": "-", "nbMin": 3, "nbMax": 5 } } } }
   ```

3. **`regex`** — motif d'expression régulière (sémantique **RegExp JavaScript**, le
   scoring est backend). Réservé aux cas tordus, écrit par un développeur :

   ```json
   { "controles": { "G205": { "cible": { "type": "regex", "motif": "^AX-[0-9]{2}$" } } } }
   ```

Options communes aux trois sous-formes :

- `ignoreCasse` (défaut `false`) : comparaison insensible à la casse si `true` — par
  défaut les conventions de nommage sont sensibles à la casse.
- `exceptions` : liste de noms exacts exemptés de la validation. Exemple typique,
  exempter le sous-projet créé automatiquement par Revit :

  ```json
  { "controles": { "G404": { "cible": {
      "type": "prefixe", "valeur": "TT-",
      "exceptions": ["Niveaux et quadrillages partagés"]
  } } } }
  ```

## Formes de scoreur « coordonnees » et « angle » (lot COORDONNÉES)

Deux nouvelles formes, dont les cibles viennent — comme toujours — EXCLUSIVEMENT de
`qc.project_config.config.controles[<code>].cible`. Sans cible : extraction réussie,
`statut` NULL (valeurs relevées, aucun verdict). Cible malformée ou incomplète :
`statut` NULL + warn (jamais de faux verdict).

### `coordonnees` — G201, géoréférencement (survey point vs PEB)

L'extracteur relève les 3 composantes du **survey point** en mètres : `ns` (Nord/Sud),
`eo` (Est/Ouest), `elev` (élévation). La cible décrit les coordonnées attendues du PEB
(Plan d'Exécution BIM) et une **tolérance en distance** (mètres). Le contrôle est
`conforme` si CHAQUE axe est à `|relevé − attendu| ≤ tolérance` ; sinon `non_conforme`,
et `valeur_json.coordonnees.axesHorsTolerance` liste le ou les **axes fautifs** (avec
le détail par axe dans `valeur_json.coordonnees.axes`).

Cible lisible par un non-développeur — coordonnées attendues + une tolérance globale :

```json
{ "controles": { "G201": { "cible": {
    "ns": 5039000.0, "eo": 300100.0, "elev": 52.5,
    "tolerance": 0.05
} } } }
```

- `ns`, `eo`, `elev` : les coordonnées réelles attendues du survey point, **en mètres**.
- `tolerance` : écart maximal toléré, **en mètres** (ex. `0.05` = 5 cm), appliqué aux 3 axes.
- Tolérance par axe (optionnelle, surcharge la globale) : `toleranceNs`, `toleranceEo`,
  `toleranceElev`. Exemple — tolérance serrée en plan, plus large en altitude :

  ```json
  { "controles": { "G201": { "cible": {
      "ns": 5039000.0, "eo": 300100.0, "elev": 52.5,
      "toleranceNs": 0.02, "toleranceEo": 0.02, "toleranceElev": 0.10
  } } } }
  ```

### `angle` — G202, angle au nord vrai (vs PEB)

L'extracteur relève `valeur_num` = angle au nord vrai en degrés, normalisé sur
`[0, 360)`. La cible est l'angle attendu du PEB + une **tolérance angulaire** en degrés.
Le contrôle est `conforme` si la **distance angulaire** relevé↔attendu est ≤ tolérance.
La distance angulaire gère le **wrap-around** : `359°` et `1°` sont distants de `2°`
(et non `358°`), donc une cible proche de `0°` reste conforme pour un relevé proche de
`360°` si l'écart réel est dans la tolérance.

```json
{ "controles": { "G202": { "cible": {
    "angle": 0.0,
    "tolerance": 0.5
} } } }
```

- `angle` : l'angle attendu du PEB entre nord projet et nord vrai, **en degrés**.
- `tolerance` : écart angulaire maximal toléré, **en degrés** (ex. `0.5`).

## Forme de scoreur « couverture » (lot G504 — codification UNIFORMAT)

G504 mesure la **couverture de codification UNIFORMAT** : parmi les éléments des
catégories de design (liste blanche), quelle proportion porte une valeur non vide dans
le paramètre configuré. C'est le contrôle le plus riche : paramètre configurable, liste
blanche de catégories, **comptage adaptatif type/instance**, liste détaillée plafonnée
pour Power BI.

### Paramètre configurable + liste blanche (norme maison versionnée)

La norme vit dans `backend/config/qc-uniformat-norm.json` (fichier versionné, comme
`qc-criticality-grid.json`), surchargeable par `qc.project_config.config.controles.G504` :

```json
{ "controles": { "G504": {
    "cible": 100,
    "parametre": { "kind": "builtin", "valeur": "UNIFORMAT_CODE" },
    "categories": ["OST_MechanicalEquipment", "OST_DuctCurves"],
    "categoriesDesactivees": ["OST_GenericModel"],
    "inclureOptionnelles": true
} } }
```

- **`parametre`** : soit `{ "kind": "builtin", "valeur": "<BuiltInParameter>" }` (paramètre
  natif, ex. `UNIFORMAT_CODE` = « Code d'assemblage »), soit `{ "kind": "partage",
  "valeur": "<nom>" }` (paramètre partagé/projet lu par NOM, ex. `Tt_TXT_Code_Uniformat`).
  Une simple chaîne est acceptée comme raccourci pour un paramètre partagé. Défaut : la
  `parametreDefaut` de la norme.
- **Liste blanche** : `categories` (liste de `BuiltInCategory`) **remplace** la norme ; sinon
  la norme s'applique, moins `categoriesDesactivees`, et `inclureOptionnelles: false` retire
  les catégories marquées optionnelles (`OST_GenericModel`, `OST_SpecialityEquipment` —
  ambiguïté design, chevauchement avec G308). Clés en `BuiltInCategory` (stables, non
  traduites). **Correction** : l'amorce mentionnait `OST_StructuralConnections`, inexistant ;
  la catégorie réelle est `OST_StructConnections`.

### Comptage adaptatif TYPE vs INSTANCE (détecté à l'exécution)

L'addin **détecte la nature réelle** du paramètre — jamais présumée :
- **partagé/projet** : lue dans `doc.ParameterBindings` (`TypeBinding` vs `InstanceBinding`) ;
- **natif** : sondage sur les éléments (priorité au type).

Puis il adapte le comptage :
- **paramètre au TYPE** (cas natif actuel « Code d'assemblage ») : `valeur_num` = types de
  design avec code / total types de design. Un type sans code = **1 fautif** (1 action) ;
  la liste des `typesFautifs` donne `{famille, nomType, categorie, nbInstances, idsEchantillon}`
  avec le **nombre total d'instances concernées** en contexte d'ampleur.
- **paramètre à l'INSTANCE** (cible future `Tt_TXT_Code_Uniformat`) : `valeur_num` =
  instances avec code / total instances. Chaque instance sans code = 1 fautif ;
  `instancesFautives` donne `{famille, nomType, categorie, id}` par entrée.

La nature détectée est rapportée dans `valeur_json.natureParametre` et
`valeur_json.couverture.nature`.

### Chemin de transition (bascule par config seule, sans recodage)

- **Aujourd'hui** : `{ "kind": "builtin", "valeur": "UNIFORMAT_CODE" }` — natif, **au type**.
- **Bientôt** (Tetra Tech) : `{ "kind": "partage", "valeur": "Tt_TXT_Code_Uniformat" }` —
  partagé, **à l'instance**, pour plus de précision.

Grâce à la détection de nature, la transition est un **simple changement de la config
projet** : aucun recodage ni redéploiement du bundle.

### Trois cas distingués

- **(a) ABSENT** : le paramètre n'est intégré nulle part (cause amont) — drapeau
  `valeur_json.parametreAbsent = true`, `natureParametre = "absent"`, couverture 0 %.
- **(b) VIDE** : présent mais sans valeur — le défaut visé (`raison: "vide"` par fautif).
- **(c) REMPLI** : conforme.

### Plafonnement & IDs

La liste des fautifs est **plafonnée à 100 IDs par groupe** (comme G410), avec le compte
total exact à côté (`nbInstances` / `nbEntitesFautives`) et un drapeau `listeTronquee`.
Les IDs sont des `ElementId.Value` (Int64, cohérents 2024/2025) pour repérer dans Revit.

### Scoring : porte de livraison à 100 %

- `conforme` **seulement si** `valeur_num == 100` (couverture complète). `non_conforme`
  dès qu'une entité manque — **aucune tolérance**. Paramètre absent ⇒ 0 % ⇒ `non_conforme`.
- La `cible` en config **active la porte** (présence ⇒ verdict) ; le seuil reste 100 %
  quelle que soit sa valeur. **Sans cible ni config** : extraction réussie, `statut` NULL.
- Le `statut` est la **porte de livraison** ; `valeur_num` (pourcentage) est la **tendance**
  pour Power BI.

## Forme de scoreur « remplissage » (lot G508 — paramètres d'exploitation 7D)

G508 mesure le **taux de remplissage des paramètres d'exploitation** (usage 7D). Il réutilise
fortement les patterns de G504 (lecture par nom, détection type/instance, plafonnement de
liste), avec **deux différences clés** :

1. La liste des paramètres à vérifier est **VARIABLE PAR PROJET** (exigences client / EIR) :
   elle vit dans `qc.project_config` — **pas** de norme maison versionnée.
2. Elle est **granulaire** : chaque paramètre a **son propre périmètre de catégories**.

### Config PROJET (structure régulière, destinée à un futur formulaire web)

```json
{ "controles": { "G508": {
    "parametres": [
      { "nom": "Tt_Numero_Serie", "categories": ["OST_MechanicalEquipment", "OST_ElectricalEquipment"], "seuil": 100 },
      { "nom": "Tt_Garantie",     "categories": ["OST_MechanicalEquipment"], "seuil": 100 }
    ]
} } }
```

- **`nom`** : nom du paramètre. Résolu comme G504 — si le nom correspond à un
  `BuiltInParameter` (ALL_CAPS) il est lu par enum, sinon comme **paramètre partagé par NOM**
  (`LookupParameter`). La **nature type/instance est détectée à l'exécution**.
- **`categories`** : `BuiltInCategory` du périmètre de CE paramètre (granulaire).
  **Vide/absent = toutes les catégories de design** (les catégories de la norme G504).
- **`seuil`** : % de remplissage requis pour ce paramètre (**défaut 100**).
- Le **nombre de paramètres est variable** (un projet en a 7, un autre 5 ou 12) : le contrôle
  itère sur la liste quelle qu'en soit la longueur.

> La structure est **régulière** (champs nets `nom` / `categories` / `seuil`, pas de structure
> libre) précisément pour être **remplie plus tard par un formulaire web**. À préserver.

### Mesure et sortie (rapport PAR PARAMÈTRE)

Pour chaque paramètre : taux = entités avec valeur non vide / total entités du périmètre,
en **unités selon la nature détectée** (types au TYPE, instances à l'INSTANCE). Les **3 cas**
sont distingués par paramètre : **absent** (`parametreAbsent=true`), **vide** (compté fautif),
**rempli**.

`valeur_json` :
- `parametres[]` : `{nom, categories, natureDetectee, rempli, total, pourcentage, seuil, conforme, parametreAbsent, nbFautifs, idsEchantillon, listeTronquee}` ;
- `idsEchantillon` = IDs d'instances fautives (`ElementId.Value`, cohérent 2024/2025) **plafonnés à 100 par paramètre**, `nbFautifs` conservant le total réel ;
- `global` : `{rempli, total, pourcentage}` agrégé.

`valeur_num` = taux **global agrégé** (Σ rempli / Σ total), pour la tendance Power BI d'ensemble.
Le rapport reste **par paramètre** : un gestionnaire 7D veut savoir QUEL paramètre traîne.

### Scoring : porte par paramètre

- `conforme` **seulement si CHAQUE** paramètre atteint son seuil. `non_conforme` si au moins
  un paramètre est sous son seuil **ou absent**.
- **Sans liste de paramètres** (aucune config G508) : extraction réussie, `valeur_json`
  indique `aucunParametre`, `statut` NULL. **C'est le comportement par défaut attendu** tant
  qu'un projet n'a pas défini ses exigences.

## Forme de scoreur « copieControle » (lot G210 — axes et niveaux)

G210 mesure la **présence** de la relation de copie-contrôle (Copy/Monitor) sur les
**axes** (`Grid`) et **niveaux** (`Level`) de l'hôte. Il **ne** mesure **pas** la
fraîcheur ni l'état « revue de coordination en attente » (non lisible via l'API
publique — voir `spike/SPIKE_COORDINATION_REVIEW.md` et
`spike/copy-monitor/API_VERIFIED.md`).

### Règle métier (norme maison, 100 %)

TOUS les axes et TOUS les niveaux **soumis à audit** DOIVENT être en copie-contrôle
depuis un lien maître. **Pas de cible requise** en config projet : la porte est
toujours active (norme maison).

### Exceptions de niveaux (config, jamais codées en dur dans l'extracteur)

```json
{ "controles": { "G210": { "niveauxExclus": ["PLAN DE LIAISON"] } } }
```

- Défaut maison versionné : `config/qc-copy-monitor-norm.json` → `["PLAN DE LIAISON"]`.
- Surcharge projet : `qc.project_config.config.controles.G210.niveauxExclus` (même une
  liste vide remplace le défaut).
- **Comparaison robuste** : `Trim` + insensible à la casse (`OrdinalIgnoreCase`) —
  choix documenté (les noms techniques varient souvent en casse / espaces bord),
  aligné sur le patron d'exceptions de G404 (`ignoreCasse` / `exceptions`).

Un niveau exclu **n'entre pas** dans la conformité (ni fautif ni requis), mais
**apparaît** dans le rapport avec l'état « exclu » (transparence).

### Trois états d'un niveau

| État | Sens |
|------|------|
| monitoré | `IsMonitoringLinkElement() == true` |
| non monitoré fautif | soumis à audit et non monitoré |
| exclu | nom dans `niveauxExclus` (jamais compté fautif) |

### Sortie

- `valeur_num` = % monitoré parmi les éléments **soumis à audit**
  `(axes monitorés + niveaux monitorés non exclus) / (total axes + total niveaux non exclus)`.
- `valeur_json` : par catégorie `{total, exclus (niveaux), soumisAudit, monitores,
  nonMonitoresFautifs {total, noms plafonnés à 100, listeTronquee}, repartitionParLien}` ;
  `repartitionParLien` = nom de l'instance de lien (lisible sur l'hôte sans
  `GetLinkDocument()`), sinon `id:<ElementId.Value>`.
- Vacuité (aucun axe ni niveau soumis à audit) : `vacuite=true`, `valeur_num` NULL,
  `statut` NULL — **pas** `non_conforme`.

### Scoring

- `conforme` seulement si **0 fautif** parmi les soumis à audit (`valeur_num == 100`).
- `non_conforme` dès qu'un élément soumis à audit n'est pas monitoré.
- Un niveau exclu non monitoré **ne** rend **pas** non conforme.

## Forme « pourcentage » appliquée à G314 (rattachement au niveau)

G314 compare le **niveau déclaré** d'un élément (paramètres de niveau Revit, puis
`Element.LevelId`) à son **niveau physique** (niveau Building Story le plus élevé
sous le point de référence Z — PAS le plus proche). Portage headless du script
pyRevit maison. Voir `spike/level-attachment/API_VERIFIED.md`.

### Quatre états

| État | Sens | Entre dans le verdict ? |
|------|------|-------------------------|
| conforme | déclaré ≈ physique (tolérance) | oui |
| fautif | déclaré ≠ physique | oui |
| multiNiveaux | linéaire traversant plusieurs niveaux | non (écarté) |
| nonEvaluable | pas de niveau déclaré / pas de Z | non (écarté) |

`valeur_num` = `conformes / (conformes + fautifs)`. **Contrôle intrinsèquement bruyant**
(faux positifs possibles sur poutres à décalage volontaire, etc.).

### Config

- Défauts maison : `config/qc-level-attachment-norm.json` — `toleranceMm: 50`, catégories
  MEP + STRUCTURE (`OST_StructConnections`, pas `OST_StructuralConnections`).
- Surcharge : `controles.G314.{toleranceMm, categories}`.
- Scoring : forme `pourcentage` / sens `min`. Cible via `cible` **ou** alias `seuil`
  (ex. `{ "G314": { "seuil": 95 } }`). **Sans cible : statut NULL** — ne pas mettre 100 %
  par défaut ; le seuil doit être un choix conscient.
- Liste des fautifs plafonnée à 100 : `{id, categorie, famille, type, niveauDeclare,
  niveauPhysique, decalagePhysiqueMm, ecartEntreNiveauxMm}` ; comptes ventilés MEP/structure.

## Intégrité des données (ISO 19650)

- Jamais de `ON DELETE CASCADE` de `qc` vers `public` : `qc.jobs.userId` et `qc.runs.userId`
  sont en `ON DELETE SET NULL` ; `qc.runs.jobId` aussi (supprimer une config de job ne
  supprime pas les runs exécutés).
- `executedByName` / `executedByAutodeskId` sur `qc.runs` : snapshots figés au moment du
  run, source de vérité de la traçabilité, indépendants de `public.users`.
- Cascades internes à `qc` conservées (`control_results` → `runs`, `warnings` → `control_results`) :
  elles composent un seul enregistrement.

## Prérequis de déploiement (bloquant, hors code)

- **`DB_SYNC_ALTER=false` sur l'App Service Azure avant tout déploiement.** Aujourd'hui à
  `true`, donc chaque boot exécute `sync({alter:true})` sur le schéma public — ce qui
  invalide toute preuve de non-régression. Action d'infrastructure, aucun changement de code.
  Le test « snapshot du schéma public » n'est valide qu'une fois cette variable à `false`.

## Lot COORDONNÉES — à exécuter par l'utilisateur EN LOCAL (procédure)

Ces étapes touchent la base et/ou l'infra APS : elles sont **volontairement laissées
au lancement manuel**, une fois la base **locale** active. Rappel du garde-fou : la
connexion PostgreSQL doit être `localhost`/`127.0.0.1` (activer le bloc LOCAL de
`backend/.env`, `DB_SSL=false`) — ne rien lancer contre une base distante.

**0. Base locale (préalable, côté utilisateur).** Activer la base locale, s'assurer
que PostgreSQL tourne, puis appliquer les migrations qc :

```
node backend/scripts/qc-migrate.js status
node backend/scripts/qc-migrate.js up      # aucune migration nouvelle attendue : les colonnes existent déjà
```

Aucune migration n'est ajoutée par ce lot (schéma `qc` inchangé, schéma `public` jamais
touché). `status` doit montrer 0004 déjà appliquée.

**1. Confirmer l'hôte local.** Vérifier que l'application résout bien vers un hôte
local avant tout run (sinon, arrêter).

**2. Build zéro warning + re-provisioning DA (les 2 moteurs).** L'ajout de contrôles
MODÈLE exige de rebuilder le bundle et de re-provisionner :

```
pwsh da-appbundle/QcExtractor/build-bundle.ps1 -EngineVersion 2024
pwsh da-appbundle/QcExtractor/build-bundle.ps1 -EngineVersion 2025
node backend/scripts/setup-da.js --engine-version 2024
node backend/scripts/setup-da.js --engine-version 2025
```

Ressources `qc_extractor` suffixées par version, nickname en lecture seule (jamais de
PATCH). Poser les `QC_DA_ACTIVITY_ID_2024/2025` affichés.

**3. Non-régression des 16 (PRIORITÉ ABSOLUE).** Lancer un run sur chaque pilote et
comparer valeurs + statuts des 16 contrôles existants à un run de référence
pré-lot : ils doivent être identiques. Total attendu : **21 lignes** par run
(16 + 5 nouveaux).

```
POST /api/qc/runs { "hubName": "...", "projectName": "...", "fileName": "ELEC 2024.rvt" }   # Revit 2024
POST /api/qc/runs { "hubName": "...", "projectName": "...", "fileName": "M_PR 2025.rvt" }    # Revit 2025
```

**4. Valeurs relevées des 5 nouveaux (sans cible → `statut` NULL).** Sur chaque pilote,
relever : G104 `valeur_text` (unités) + `valeur_json`, G105 `champsRenseignes`,
G200 écart par axe + `ecartMaxAbs`, G201 `surveyPoint {ns,eo,elev}`, G202 angle en
degrés. `etat_extraction='extrait'`, `statut` NULL tant qu'aucune cible n'est en config.

**5. Preuves des scoreurs (insérer une cible de test dans `qc.project_config.config.controles`,
lancer, puis la RETIRER).**

- **G201 `coordonnees`** : cible proche du survey point réel + `tolerance` large ⇒ `conforme` ;
  puis cible éloignée (ou tolérance serrée) ⇒ `non_conforme`, en vérifiant
  `valeur_json.coordonnees.axesHorsTolerance` (axe fautif identifié).
- **G202 `angle`** : cible avec tolérance ⇒ `conforme` ; prouver le **wrap-around**
  (angle réel proche de 360°, cible proche de 0°, `tolerance` couvrant l'écart réel ⇒ `conforme`).
- **G200 `seuil`** : tolérance serrée ⇒ `non_conforme`, tolérance large ⇒ `conforme`.

Un re-scoring déterministe des runs existants (sans DA) est possible via
`node backend/scripts/qc-rescore.js` après insertion/retrait de cible.

**6. Isolation d'échec.** Lancer un run avec `simulerEchec` = l'un des 5 codes (ex. `G201`) :
sa ligne doit être `etat_extraction='echec'`, `statut` NULL, les 20 autres intactes.

```
POST /api/qc/runs { "...": "...", "simulerEchec": "G201" }
```

**7. Additivité.** Vérifier que le diff est confiné au module QC + addin, que le schéma
`public` est inchangé (snapshot — valide seulement si `DB_SYNC_ALTER=false`), qu'aucune
migration n'a été ajoutée et que `backend/src/config/database.js` est intact.

## Lot G504 — à exécuter par l'utilisateur EN LOCAL (procédure)

Mêmes garde-fous que ci-dessus (base **locale** uniquement, rebuild bundle +
re-provisioning `setup-da.js` 2024/2025 car G504 est un contrôle MODÈLE). Total attendu :
**22 lignes** par run (21 + G504).

**Non-régression (priorité).** Les 21 contrôles existants doivent rester identiques aux
références. G504 s'ajoute sans les toucher.

**G504 sur les 2 pilotes (paramètre natif « Code d'assemblage », cas TYPE).** Le défaut de
la norme est `{ "kind": "builtin", "valeur": "UNIFORMAT_CODE" }`. Relever :
`valeur_num` (couverture %), `valeur_json.natureParametre` (**doit être `type`**),
`couverture {numerateur, denominateur, pourcentage}`, `nbEntitesFautives` (types),
`nbInstancesConcernees`, et `typesFautifs[]` (échantillon d'IDs plafonné à 100). Le Code
d'assemblage étant natif, il existe partout : on attend un **vrai %**, pas un cas absent.

**Preuve du scoring (porte 100 %) — insérer puis retirer une cible.**

```json
{ "controles": { "G504": { "cible": 100 } } }
```

- couverture < 100 % ⇒ `statut = non_conforme` avec la liste des fautifs ;
- couverture == 100 % ⇒ `statut = conforme` ;
- sans `cible` ⇒ `statut` NULL (extraction conservée).

**Preuve de la bascule TYPE/INSTANCE.** Pointer un paramètre d'INSTANCE existant via
`{ "controles": { "G504": { "parametre": { "kind": "partage", "valeur": "<param instance>" } } } }`
et vérifier que `valeur_json.natureParametre` passe à `instance` et que le comptage
bascule (dénominateur = instances, `instancesFautives[]` par entrée).

**Isolation.** `simulerEchec: "G504"` ⇒ sa ligne `etat_extraction='echec'`, les 21 autres intactes.

## Lot G508 — à exécuter par l'utilisateur EN LOCAL (procédure)

Mêmes garde-fous (base **locale**, rebuild bundle + re-provisioning `setup-da.js` 2024/2025 —
G508 est un contrôle MODÈLE). Total attendu : **23 lignes** par run (22 + G508).

**Comportement par défaut (sans config).** Sur les 2 pilotes, G508 doit rapporter
`etat_extraction='extrait'`, `valeur_json.aucunParametre = true`, `statut` NULL — c'est le
comportement attendu tant qu'aucune exigence n'est définie.

**Preuve du granulaire (insérer puis retirer une config).**

```json
{ "controles": { "G508": { "parametres": [
  { "nom": "ALL_MODEL_INSTANCE_COMMENTS", "categories": ["OST_MechanicalEquipment"], "seuil": 100 },
  { "nom": "UNIFORMAT_CODE", "categories": ["OST_ElectricalEquipment"], "seuil": 100 },
  { "nom": "Tt_Parametre_Inexistant", "categories": [], "seuil": 100 }
] } } }
```

Vérifier `valeur_json.parametres[]` : un **taux par paramètre** distinct, des **périmètres de
catégories différents**, la **nature détectée** (instance vs type), le cas **absent**
(`parametreAbsent=true`) pour le paramètre inventé, et le **verdict d'ensemble**
(`non_conforme` dès qu'un paramètre est sous son seuil ou absent). Retirer la config ensuite.

**Isolation.** `simulerEchec: "G508"` ⇒ sa ligne `etat_extraction='echec'`, les 22 autres intactes.

## Lot G210 — à exécuter par l'utilisateur EN LOCAL (procédure)

Mêmes garde-fous (base **locale**, rebuild bundle + re-provisioning `setup-da.js` 2024/2025 —
G210 est un contrôle MODÈLE). Total attendu : **24 lignes** par run (23 + G210).

**Sur les 2 pilotes.** Rapporter par catégorie : total / exclus / soumisAudit / monitorés /
non monitorés fautifs, listes, répartition par lien. M_PR a 0 axe → vérifier le cas
« aucun axe ». Vérifier si « PLAN DE LIAISON » (ou variante) existe et est classé « exclu ».

**Preuves de scoring (déterministes).** Cas 100 % soumis-audit monitorés → conforme ;
cas avec un fautif → non_conforme + liste ; cas où seul un niveau exclu n'est pas
monitoré → **conforme** ; vacuité → statut NULL.

**Isolation.** `simulerEchec: "G210"` ⇒ sa ligne `etat_extraction='echec'`, les 23 autres intactes.

## Lot G314 — à exécuter par l'utilisateur EN LOCAL (procédure)

Mêmes garde-fous (base **locale**, rebuild + re-provisioning 2024/2025). Total attendu :
**25 lignes** par run (24 + G314).

**Sur les 2 pilotes.** Rapporter les 4 états (ventilés MEP/structure), % conformité,
liste fautifs plafonnée. Du bruit est **attendu**. G102 MÉTA peut dériver si le fichier
ACC a changé — ce n'est pas une régression MODÈLE.

**Scoring.** Sans cible → statut NULL. Avec `seuil`/`cible` de test (ex. 95) →
conforme/non_conforme selon le %.

**Isolation.** `simulerEchec: "G314"` ⇒ sa ligne `echec`, les 24 autres intactes.

## Limites assumées de la tranche

- Un seul contrôle (G408), un seul engine (Revit 2024), régions US/EMEA (repli Canada à
  brancher plus tard dans l'addin via `IModelSource`, point de bascule unique).
- Patterns « critiques » codés en dur dans l'addin ; `qc.project_config` créée mais vide.
- Aucun scoring, aucune comparaison à une cible. Pas de planification cron des jobs qc.
