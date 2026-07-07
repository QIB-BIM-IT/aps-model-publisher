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

## Limites assumées de la tranche

- Un seul contrôle (G408), un seul engine (Revit 2024), régions US/EMEA (repli Canada à
  brancher plus tard dans l'addin via `IModelSource`, point de bascule unique).
- Patterns « critiques » codés en dur dans l'addin ; `qc.project_config` créée mais vide.
- Aucun scoring, aucune comparaison à une cible. Pas de planification cron des jobs qc.
