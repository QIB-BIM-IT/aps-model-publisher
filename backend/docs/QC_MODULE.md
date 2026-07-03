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
| `QC_DA_ACTIVITY_ID` | **oui** (active le module DA) | Id qualifié de l'activity, ex. `MonNickname.QcExtractG408+prod`. Affiché par `setup-da.js`. Absent ⇒ mode dégradé explicite (503), le reste de l'app n'est pas affecté. |
| `QC_OSS_BUCKET` | non | Bucket OSS transient des résultats (défaut dérivé du client id). |
| `QC_CALLBACK_BASE_URL` | non | Base publique pour le callback `onComplete` (ex. `https://<app>.azurewebsites.net`). Absent ⇒ polling seul. |
| `QC_CALLBACK_SECRET` | non | Secret HMAC du callback (défaut : `WEBHOOK_SECRET` puis `JWT_SECRET`). |
| `QC_DA_NICKNAME` / `QC_DA_APPBUNDLE` / `QC_DA_ACTIVITY` / `QC_DA_ALIAS` / `QC_DA_ENGINE` | non | Défauts : client id / `QcExtractor` / `QcExtractG408` / `prod` / `Autodesk.Revit+2024`. |
| `QC_POLL_INTERVAL_MS` / `QC_POLL_TIMEOUT_MS` | non | Polling de secours (30 000 / 1 200 000). |

**Scopes** : ajouter `code:all` à `APS_SCOPES` (3 legs, pour les prochains logins) et il est
demandé automatiquement par le token 2 legs privé du module QC. Montée progressive : aucune
session existante n'est cassée ; un utilisateur QC dont le token ne porte pas `code:all`
reçoit une erreur explicite l'invitant à se reconnecter.

## Mise en route

1. **Build de l'addin** (nécessite Revit 2024 + dotnet SDK) :
   `pwsh da-appbundle/QcExtractor/build-bundle.ps1`
2. **Provisioning DA** (nickname, AppBundle, Activity, alias, bucket — idempotent) :
   `node backend/scripts/setup-da.js --zip da-appbundle/QcExtractor/output/QcExtractor.bundle.zip`
   puis poser `QC_DA_ACTIVITY_ID` (valeur affichée en fin de script).
3. **Migrations** : appliquées automatiquement au boot (après `connectDB()`/sync), ou à la main :
   `node backend/scripts/qc-migrate.js up | down | down-all | status`
   (`down-all` = rollback complet : tables + types + schéma qc supprimés).
4. **Lancer un run** :
   ```
   POST /api/qc/runs   (Authorization: Bearer <JWT applicatif>)
   { "region": "US", "projectGuid": "<guid ACC>", "modelGuid": "<guid ACC>", "runType": "quotidien" }
   ```

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
