# Module QC BIM — tranche verticale G408 (Design Automation for Revit)

Module **strictement additif** : tout vit dans le schéma PostgreSQL `qc`, géré par des
migrations umzug réversibles (`qc.migrations`). Le schéma `public` reste géré par
`sequelize.sync()` comme aujourd'hui et n'est jamais modifié.

## Catalogue — bloc `descriptionCible` (préparation formulaire)

Chaque entrée de `backend/config/qc-controls-catalog.json` porte un bloc additif
**`descriptionCible`** (widget, libellés, aide, défauts, validation) destiné à un
futur formulaire web adaptatif. Ce bloc **ne pilote pas** l'extraction ni le scoring ;
seuls les champs historiques (`source`, `forme`, `champListe`, `libelle`, …) restent
la source de vérité runtime. G103 est marqué `aTraiterSeparement: true` (widget
nommage à concevoir séparément). Voir les champs `formatScoreur` / `ecartSignale`
dans le catalogue pour le lien avec `qc.project_config`.

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
- Contrôles actuels : G408 (modèle/guid), G102 (méta/seuil, **Mo** binaires), G411 (modèle/comptage,
  groupes inutilisés), G502 (modèle/presence, paramètres de projet — lecture des noms
  uniquement, `Definition.ParameterGroup` interdit car supprimé de l'API 2025).
- **Lot 1** : G101 (méta/`egalite` — écart entre version PEB cible et `revitProjectVersion`
  réelle), G103 (méta/`pattern` — nom de fichier vs regex de convention), G402
  (modèle/comptage — variantes présentes, jugement de superfluité humain), G410
  (modèle/comptage — vues `NotPlaced` hors gabarits, liste plafonnée à 200 noms).
  **G309 / G310 RETIRÉS** du parc actif (voir section « Retraits »).
  API vérifiée identique 2024/2025 pour toutes ces lectures.
- **Lot 2** : G406 (modèle/presence — noms de phases, liste ORDONNÉE via `Document.Phases`),
  G407 (modèle/**`sequence`** — même lecture que G406 partagée par `PhaseReader`, une seule
  traversée ; règle : la cible doit être une sous-séquence ordonnée de la liste réelle,
  éléments intercalés tolérés, ordre relatif exigé), G507 (modèle/**`presenceProjet`** —
  paramètres partagés attendus, **liste variable par projet** comme G508 ; inventaire
  `SharedParameterElement`+`GuidValue` toujours relevé ; distinction G502 = ParameterBindings).
  API vérifiée identique 2024/2025.
- **Lot NOMMAGE** : G404 uniquement (modèle/nommage — sous-projets UTILISATEUR via
  `FilteredWorksetCollector.OfKind(WorksetKind.UserWorkset)` → `Workset.Name` ; les
  sous-projets système vues/familles/normes sont exclus par `OfKind` ; « Niveaux et
  quadrillages partagés » est classé `UserWorkset` par l'API sans drapeau d'exclusion
  fiable — il reste dans la liste relevée et s'exempte via `exceptions` en config /
  norme maison, jamais par un filtre de nom codé en dur). Scoring **`listePrefixes`**
  via `qc-workset-prefixes-norm.json` (11 préfixes maison, surcharge projet).
  **G203/G205** ont été **refondus** en contrôles d'état (`etatReference`) — voir
  section dédiée. API vérifiée 2024/2025.
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
  3 composantes ns/eo/elev en mètres), G202 (modèle/**`angle`** — angle de rotation du
  **nord projet** via `GetProjectPosition(XYZ.Zero).Angle`, comparé à une cible humaine
  `{angle,tolerance}` — pas au nord géographique comme référence implicite ; sans cible :
  statut NULL).

## Forme de scoreur « nommage » (lot NOMMAGE)

Valide une **liste de noms** relevée par l'extracteur (localisée par `champListe` du
catalogue) contre une convention décrite dans
`qc.project_config.config.controles[<code>].cible` (ou, pour **G404**, la norme maison
versionnée — voir ci-dessous). Chaque nom est marqué conforme ou non : le contrôle
est `conforme` si TOUS les noms passent, `non_conforme` si au moins un échoue, et
`valeur_json.nommage.nomsNonConformes` liste les noms à corriger.
Sans cible (hors G404) : extraction réussie, `statut` NULL. Liste vide (ou tous
les noms exemptés) : `conforme` (vérité par vacuité). Cible malformée ou regex
invalide : `statut` NULL + warn — jamais de faux verdict.

La cible est un **objet** avec un champ `type` (quatre sous-formes) :

1. **`prefixe`** — le nom doit commencer par le préfixe donné. Le cas le plus fréquent
   et le plus lisible :

   ```json
   { "controles": { "G404": { "cible": { "type": "prefixe", "valeur": "TT-" } } } }
   ```

2. **`segments`** — le nom doit être découpé par le séparateur en un nombre de morceaux
   attendu, aucun morceau vide (`A--B` ou `-A-B` sont non conformes). `nbMax` est
   optionnel (absent = pas de plafond) :

   ```json
   { "controles": { "G404": { "cible": { "type": "segments", "separateur": "-", "nbMin": 3, "nbMax": 5 } } } }
   ```

3. **`regex`** — motif d'expression régulière (sémantique **RegExp JavaScript**, le
   scoring est backend). Réservé aux cas tordus, écrit par un développeur :

   ```json
   { "controles": { "G404": { "cible": { "type": "regex", "motif": "^TT-[A-Z0-9-]+$" } } } }
   ```

4. **`listePrefixes`** — le nom est conforme s'il commence par **au moins un** des
   préfixes de la liste (après trim ; `ignoreCasse` comme les autres sous-formes).
   Non conforme s'il ne commence par aucun. Agrégation inchangée (tous hors
   exceptions doivent passer) :

   ```json
   { "type": "listePrefixes", "prefixes": ["ZG_","ZL_","EL_"], "ignoreCasse": false,
     "exceptions": ["Niveaux et quadrillages partagés", "Sous-projet 1"] }
   ```

Options communes aux sous-formes :

- `ignoreCasse` (défaut `false`) : comparaison insensible à la casse si `true` — par
  défaut les conventions de nommage sont sensibles à la casse.
- `exceptions` : liste de noms exacts exemptés de la validation (trim ; casse selon
  `ignoreCasse`). Exemple typique, exempter le sous-projet créé automatiquement par Revit :

  ```json
  { "controles": { "G404": { "cible": {
      "type": "prefixe", "valeur": "TT-",
      "exceptions": ["Niveaux et quadrillages partagés"]
  } } } }
  ```

### G404 — norme maison `listePrefixes` (préfixes sous-projets)

G404 utilise **toujours** la sous-forme `listePrefixes` via la norme maison
`backend/config/qc-workset-prefixes-norm.json` (fichier versionné, même patron que
la grille de criticité / `qc-copy-monitor-norm.json`). **Pas de cible projet
requise** : le verdict est émis dès l'extraction.

Liste maison des **11** préfixes Tetra Tech :

`ZG_`, `ZL_`, `S_`, `CR_`, `EL_`, `GM_`, `PI_`, `PL_`, `VE_`, `PR_`, `TP_`

Exceptions maison par défaut :

- `Niveaux et quadrillages partagés` (observé ELEC)
- `Vues, niveaux et grilles partagés` (variante locale observée M_PR — même rôle système)
- `Sous-projet 1` (Revit FR, avec espace) et `Sous-projet1` (variante sans espace)

**Ajouter un préfixe** = éditer `prefixes` dans `qc-workset-prefixes-norm.json`
(commit versionné).

**Surcharge projet** (`qc.project_config.config.controles.G404`) — une liste projet
**remplace** le champ maison correspondant (pas de fusion) :

```json
{ "controles": { "G404": {
    "prefixes": ["EL_", "ZL_"],
    "exceptions": ["Niveaux et quadrillages partagés"],
    "ignoreCasse": false
} } }
```

`controles.G404.cible` (objet avec `type`) remplace **toute** la cible (ex. bascule
projet vers `regex` / `prefixe`). L'extracteur relève toujours la liste complète
`valeur_json.sousProjets` pour Power BI ; le verdict porte sur la conformité aux
préfixes hors exceptions (`valeur_json.nommage.nomsNonConformes`).

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

### `angle` — G202, angle du nord projet (vs valeur attendue)

G202 mesure l’**angle de rotation du nord projet** (orientation de travail du modèle) :
API `Document.ActiveProjectLocation.GetProjectPosition(XYZ.Zero).Angle`, convertie en
degrés et normalisée sur `[0, 360)`. Cet angle est la rotation du nord projet par
rapport au nord vrai dans Revit — c’est l’orientation du modèle, **pas** une cible
implicite « nord géographique = 0° ».

Le scoreur compare `valeur_num` à une **valeur attendue saisie par le coordonnateur**
dans `controles.G202.cible` + une **tolérance angulaire**. Conforme si la distance
angulaire relevé↔attendu est ≤ tolérance. **Wrap-around** : `359°` et `1°` sont
distants de `2°` (pas `358°`). **Sans cible** : extraction réussie (angle dans
`valeur_json.angleNordProjet`), `statut` NULL — cas fréquent sans exigence d’orientation.

```json
{ "controles": { "G202": { "cible": {
    "angle": 90.0,
    "tolerance": 0.5
} } } }
```

- `angle` : angle de rotation du nord projet **attendu** au PEB, **en degrés**.
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

## Forme « pourcentage » appliquée à G314 (rattachement au niveau) — RÉVISION

G314 vérifie le **rattachement au niveau** via les **paramètres natifs** et une
**table de plages d'étages** (Building Story). Voir `spike/level-attachment/API_VERIFIED.md`.

### Pourquoi l'ancienne méthode a été retirée

L'ancienne approche calculait un « niveau physique » depuis la géométrie Z (balayage
des niveaux). En MEP, les décalages verticaux sont **normaux** (diffuseur au plafond
rattaché au plancher) et les niveaux techniques faussaient le calcul → ~90 % de faux
positifs sur les pilotes (ELEC 6,89 %, M_PR 11,53 %). **Méthode géométrique retirée.**

### Table de plages (une fois par modèle)

1. Niveaux Building Story (`LEVEL_IS_BUILDING_STORY`) ; repli = tous les niveaux.
2. Filtre `hauteurMinEtageMm` (défaut **2500**) : un Building Story n'est retenu comme
   borne d'étage que s'il est à ≥ ce seuil au-dessus du précédent retenu. Sans ce filtre,
   les niveaux techniques serrés (souvent &lt; 1 m) produisent des plages irréalistes et
   des faux positifs massifs sur les pilotes industriels (offsets MEP normaux).
3. Tri par élévation. Plage du niveau i = `[E_i, E_{i+1})` (**semi-ouverte** : pile à
   `E_{i+1}` → niveau suivant).
4. Dernier niveau : **borne basse seule** (pas de borne haute inventée).

### Trois familles (détection automatique)

| Famille | Détection | Règle |
|---------|-----------|--------|
| **C** | Base Level + Top Level présents | Cohérence : niveaux réels et Top > Base. Multi-étages **OK**. |
| **B** | `LocationCurve` (détection seule) | Niveau de référence + élévations **relatives natives** (`RBS_OFFSET_PARAM` / Start-End Middle / arases PIPE·DUCT·CTC). Même formule que A. Extrémmités en plages différentes → **MULTI-NIVEAUX**. **Jamais** le Z `LocationCurve`. Paramètres absents → **NON ÉVALUABLE**. |
| **A** | sinon (Level + Offset) | `élévation effective = niveau déclaré + offset` ; conforme si dans la plage du niveau déclaré. Pas de repli `Element.LevelId`. |

### Quatre états

| État | Sens | Verdict ? |
|------|------|-----------|
| conforme | règle de famille respectée | oui |
| fautif | règle violée | oui |
| multiNiveaux | filaire traversant plusieurs plages | non |
| nonEvaluable | pas de niveau déclaré exploitable | non |

`valeur_num` = `conformes / (conformes + fautifs)`. Contrôle **indicatif** (bonnes
pratiques Revit) : le contrôleur BIM juge.

### Config

- Défauts : `qc-level-attachment-norm.json` — `toleranceMm: 0`, `hauteurMinEtageMm: 2500`,
  MEP + STRUCTURE (**sans axes** ; `OST_StructConnections`).
- Scoring : `pourcentage` / sens `min` via `cible` ou alias `seuil`. **Sans cible :
  statut NULL.**
- Fautifs plafonnés à 100 ; ventilation par famille A/B/C et MEP/structure.

## Forme « hygieneModele » — G412 (hygiène du modèle)

G412 combine **trois indicateurs** dans une seule ligne `control_results`. Voir
`spike/model-hygiene/API_VERIFIED.md`.

| Indicateur | Mesure | Rôle statut |
|------------|--------|-------------|
| Groupes à instance unique | `valeur_num` = nb types avec `Groups.Size == 1` | **Tolérance zéro** (mesure exacte) → `conforme` si 0, `non_conforme` si ≥ 1 |
| Familles in place | `valeur_json.famillesInPlace` | INDICATIF ; verdict seulement si `seuilFamillesInPlace` |
| Total de types de groupes | `valeur_json.groupes.nbTypesGroupes` (+ instances) | INDICATIF (tendance jalon) ; verdict seulement si `seuilTypesGroupes` |

### Choix de code : G412 (pas G106)

G106 reste réservé à la notion documentaire « Fichier purgé » (**Manuel**, hors outil).
G412 = section Organisation Revit (à côté de G411 groupes inutilisés).

### Retrait de l'indicateur « groupes miroir »

`Group` / `GroupType` **n'exposent pas** `Mirrored` (2024/2025). L'heuristique
`FamilyInstance.Mirrored` (PR #179 initiale) produisait massivement des indéterminés
et n'était pas fiable → **retirée**. Remplacée par les comptes exacts ci-dessus.

### Groupes à instance unique (logique pyRevit)

Pour chaque `GroupType`, si `gt.Groups.Size == 1` → type placé une seule fois (devrait
être explosé). Liste : nom, catégorie, nb membres (`GetMemberIds`), pinned, viewSpecific.

### Config

- Défaut strict instance unique : seuil 0 (aucune cible projet requise).
- Surcharge : `controles.G412.seuilGroupesInstanceUnique` (ou `seuil` / `cible`).
- Optionnel : `seuilFamillesInPlace`, `seuilTypesGroupes`.
- Listes plafonnées à 100.

## Forme « etatReference » — G203 / G205 / G111 (pinné + design option)

Refonte des contrôles d'éléments de référence. Voir
`da-appbundle/QcExtractor/spike/reference-state/API_VERIFIED.md`.

### Changement de nature G203 / G205

| Code | Ancien | Nouveau |
|------|--------|---------|
| G203 | Nommage des niveaux | **État** : tous les niveaux pinnés |
| G205 | Nommage des axes | **État** : axes pinnés **et** dans l'option principale nommée |

Les niveaux/axes viennent du copie-contrôle : leurs noms sont hérités du maître, la
convention de nommage **ne s'applique pas**. On **relève toujours** la liste complète
avec les **noms** dans `valeur_json` (Power BI + identification des fautifs), mais le
**verdict** porte uniquement sur l'état.

### G203 — Niveaux pinnés

- Collecte : `OfClass(Level)`.
- Règle : `Element.Pinned == true`. Pas de vérif design option (impossible en Revit).
- `valeur_num` = nb fautifs (non pinnés). Tolérance zéro.
- Vacuité (0 niveau) : `vacuite=true`, statut NULL.

### G205 — Axes pinnés + design option principale

- Collecte : `OfClass(Grid)` (chaque instance, pas de Distinct).
- Règle : pinné **ET** `DesignOption != null`, `IsPrimary == true`, nom == attendu.
- Défaut nom d'option : `"Quadrillages"` ; config :
  `controles.G205.designOptionNom`.
- **Normalisation** : `DesignOption.Name` peut contenir le suffixe ` <primary>` —
  retiré avant comparaison (voir API_VERIFIED).
- Raisons fautives : `non pinne` / `dans main model` / `option secondaire` /
  `mauvaise option`.
- Vacuité (0 axe, ex. M_PR) : statut NULL.

### G111 — Liens dans la design option principale (nouveau)

Code **G111** (section 1 Fichier / références externes). Collecte
`RevitLinkInstance` ; nom via `Element.Name` **sans** charger le lien.
Règle : option primaire nommée uniquement (**pas** d'exigence pinné).
Défaut `"Liens"` ; config `controles.G111.designOptionNom`. Vacuité → NULL.

### Scoring commun `etatReference`

- `conforme` si `valeur_num == 0` (aucun fautif).
- `non_conforme` si ≥ 1 fautif.
- `vacuite` → statut NULL.
- Fautifs plafonnés à 100 ; liste complète des éléments (avec noms) toujours présente.

## G102 — taille fichier en Mo (méta)

`valeur_num` = taille en **mégaoctets binaires** (`storageSize / 1 048 576`), arrondi
à 2 décimales. `valeur_json` conserve `{ octets, mo, unite: "Mo", facteur: 1048576 }`.
La **cible** `controles.G102.cible` (forme `seuil`, sens `max`) s'exprime désormais
**en Mo** (ex. `150`), plus en octets. Aucune config locale existante ne dépendait
de l'ancienne unité octets (vérifié sur `qc.project_config`).

## G507 — présence de paramètres partagés (liste projet, comme G508)

Structure alignée sur G508 :

```json
{ "controles": { "G507": { "parametres": [ { "nom": "Tt_TXT_Exemple" } ] } } }
```

- **Sans liste** : inventaire de tous les `SharedParameterElement` (`parametresPartages` /
  `detail`), `aucunParametre=true`, **statut NULL**.
- **Avec liste** : rapport `parametres[]` `{nom, present, guid}` ; conforme si tous
  `present` ; `valeur_num` = nb absents. Forme scoreur `presenceProjet`.

## Retraits G309 / G310 (parc actif)

| Code | Raison du retrait |
|------|-------------------|
| G309 | Juger si le système assigné est le **bon** exige un jugement humain |
| G310 | Compte brut de connecteurs ouverts trop bruyant, sans valeur de verdict |

Retirés du **registre** `ControlRunner`, du **catalogue**, et de la doc active.
Classes d'extracteurs **supprimées** du bundle (propre). **Aucune** migration, **aucune**
suppression de lignes historiques `qc.control_results` (réversible côté données).

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

## Lot G314 — à exécuter par l'utilisateur EN LOCAL (procédure) — RÉVISION

Mêmes garde-fous (base **locale**, rebuild + re-provisioning). **25 lignes**/run.

**Attendu vs ancienne méthode.** Le % de conformité doit être **nettement plus élevé**
que 6,89 % / 11,53 % (faux positifs géométriques). Ventiler les 4 états par famille A/B/C.

**Scoring.** Sans cible → NULL. Avec `seuil`/`cible` de test → conforme/non_conforme.

**Isolation.** `simulerEchec: "G314"` ⇒ G314 `echec`, 24 autres intactes.

## Limites assumées de la tranche

- Un seul contrôle (G408), un seul engine (Revit 2024), régions US/EMEA (repli Canada à
  brancher plus tard dans l'addin via `IModelSource`, point de bascule unique).
- Patterns « critiques » codés en dur dans l'addin ; `qc.project_config` créée mais vide.
- Aucun scoring, aucune comparaison à une cible. Pas de planification cron des jobs qc.
