# ✅ Checklist de déploiement Azure

## 📦 Fichiers de configuration créés

- [x] `package.json` (racine) - Scripts de build et démarrage
- [x] `backend/package.json` - Configuration backend avec engines Node.js
- [x] `.deployment` - Configuration de déploiement Azure
- [x] `web.config` - Configuration IIS/iisnode pour Azure
- [x] `.gitignore` - Fichiers à exclure du repository
- [x] `.dockerignore` - Fichiers à exclure des images Docker
- [x] `Dockerfile` - Image Docker pour containers
- [x] `docker-compose.yml` - Orchestration locale
- [x] `.env.azure.example` - Template des variables d'environnement
- [x] `deploy-azure.ps1` - Script PowerShell de déploiement automatisé
- [x] `AZURE_DEPLOYMENT.md` - Guide détaillé de déploiement
- [x] `AZURE_CONTAINER_DEPLOYMENT.md` - Guide Docker/Container

## 🎯 Choix de la méthode de déploiement

Choisissez l'une de ces options :

### Option 1️⃣ : Déploiement Standard (Recommandé pour débuter)
**Temps : ~15 minutes | Coût : ~80 CAD/mois**

```powershell
# Utiliser le script automatisé
.\deploy-azure.ps1
```

Ou suivre le guide manuel : `AZURE_DEPLOYMENT.md`

**Avantages :**
- ✅ Configuration la plus simple
- ✅ Déploiement Git direct
- ✅ Bien documenté par Microsoft

**Inconvénients :**
- ❌ Moins de contrôle sur l'environnement

---

### Option 2️⃣ : Déploiement avec Docker Container
**Temps : ~30 minutes | Coût : ~30-50 CAD/mois**

Suivre le guide : `AZURE_CONTAINER_DEPLOYMENT.md`

**Avantages :**
- ✅ Environnement 100% reproductible
- ✅ Test local identique à production
- ✅ Portabilité (peut migrer vers Kubernetes)

**Inconvénients :**
- ❌ Configuration plus complexe
- ❌ Nécessite Azure Container Registry

---

## 📋 Étapes de préparation

### 1. Prérequis techniques
- [ ] Node.js >= 18.0.0 installé localement
- [ ] Azure CLI installé (`winget install Microsoft.AzureCLI`)
- [ ] Compte Azure actif avec abonnement
- [ ] Git configuré
- [ ] Docker Desktop (si option container)

### 2. Informations nécessaires

Rassemblez ces informations avant de commencer :

#### 🗄️ Base de données
- [ ] Nom du serveur PostgreSQL
- [ ] Utilisateur admin
- [ ] Mot de passe sécurisé
- [ ] Nom de la base de données : `aps_publisher`

#### 🔑 Autodesk APS/Forge
- [ ] Client ID (depuis Autodesk Platform Services)
- [ ] Client Secret
- [ ] Callback URL : `https://<votre-app>.azurewebsites.net/api/auth/callback`
- [ ] Scopes nécessaires configurés

#### 🔐 Sécurité
- [ ] JWT Secret (générer : `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)
- [ ] Email admin
- [ ] Mot de passe admin

#### 📧 Configuration Email (optionnel mais recommandé)
- [ ] Serveur SMTP (ex: smtp.office365.com)
- [ ] Port SMTP (généralement 587)
- [ ] Utilisateur SMTP
- [ ] Mot de passe SMTP
- [ ] Adresse d'expédition

### 3. Vérifications du code

- [ ] Le fichier `backend/src/server.js` utilise `process.env.PORT`
- [ ] Endpoint `/health` fonctionnel
- [ ] Toutes les variables d'environnement utilisent `process.env`
- [ ] Pas de valeurs codées en dur (hardcoded)
- [ ] Le dossier `logs/` est dans `.gitignore`
- [ ] Pas de fichiers `.env` dans le repository

### 4. Tests locaux avant déploiement

```powershell
# Backend
cd backend
npm install
npm start

# Tester le healthcheck
curl http://localhost:3000/health

# Frontend
cd frontend
npm install
npm run build
```

- [ ] Backend démarre sans erreur
- [ ] Healthcheck répond `{"ok": true, ...}`
- [ ] Frontend se build correctement
- [ ] Connexion à la base de données fonctionne

---

## 🚀 Déploiement étape par étape

### Phase 1 : Infrastructure Azure

#### Script automatisé (Recommandé)
```powershell
# Lancer le script interactif
.\deploy-azure.ps1

# Options avancées :
.\deploy-azure.ps1 -ResourceGroup "mon-rg" -Location "canadacentral" -AppName "mon-app"
```

#### Ou manuel
```powershell
# 1. Connexion
az login

# 2. Groupe de ressources
az group create --name aps-model-publisher-rg --location canadacentral

# 3. App Service Plan
az appservice plan create `
  --name aps-publisher-plan `
  --resource-group aps-model-publisher-rg `
  --sku B1 `
  --is-linux

# 4. Web App
az webapp create `
  --name aps-model-publisher `
  --resource-group aps-model-publisher-rg `
  --plan aps-publisher-plan `
  --runtime "NODE:18-lts"
```

- [ ] Groupe de ressources créé
- [ ] App Service Plan créé
- [ ] Web App créée

### Phase 2 : Base de données

```powershell
# PostgreSQL Flexible Server
az postgres flexible-server create `
  --name aps-publisher-db `
  --resource-group aps-model-publisher-rg `
  --location canadacentral `
  --admin-user apspublisher `
  --admin-password <VotreMotDePasse> `
  --sku-name Standard_B1ms `
  --tier Burstable `
  --public-access 0.0.0.0 `
  --storage-size 32 `
  --version 14

# Base de données
az postgres flexible-server db create `
  --resource-group aps-model-publisher-rg `
  --server-name aps-publisher-db `
  --database-name aps_publisher

# Firewall
az postgres flexible-server firewall-rule create `
  --resource-group aps-model-publisher-rg `
  --name aps-publisher-db `
  --rule-name AllowAzureServices `
  --start-ip-address 0.0.0.0 `
  --end-ip-address 0.0.0.0
```

- [ ] Serveur PostgreSQL créé
- [ ] Base de données créée
- [ ] Règles firewall configurées

### Phase 3 : Variables d'environnement

Utilisez le template `.env.azure.example` et configurez via :

```powershell
az webapp config appsettings set `
  --name aps-model-publisher `
  --resource-group aps-model-publisher-rg `
  --settings `
    NODE_ENV=production `
    DB_HOST=<votre-serveur>.postgres.database.azure.com `
    DB_NAME=aps_publisher `
    DB_USER=apspublisher `
    DB_PASSWORD=<password> `
    APS_CLIENT_ID=<client-id> `
    APS_CLIENT_SECRET=<client-secret> `
    JWT_SECRET=<jwt-secret> `
    # ... autres variables
```

- [ ] Variables de base de données configurées
- [ ] Variables APS configurées
- [ ] Variables de sécurité configurées
- [ ] Variables SMTP configurées (si applicable)
- [ ] CORS_ORIGIN configuré

### Phase 4 : Déploiement du code

#### Option A : Déploiement Git local

```powershell
# Configuration Git local
az webapp deployment source config-local-git `
  --name aps-model-publisher `
  --resource-group aps-model-publisher-rg

# Ajouter remote Azure
git remote add azure <url-fournie-par-azure>

# Déployer
git add .
git commit -m "Déploiement initial vers Azure"
git push azure main
```

#### Option B : Déploiement depuis GitHub

```powershell
az webapp deployment source config `
  --name aps-model-publisher `
  --resource-group aps-model-publisher-rg `
  --repo-url https://github.com/<votre-org>/<votre-repo> `
  --branch main `
  --manual-integration
```

- [ ] Remote Git configuré
- [ ] Code déployé sur Azure
- [ ] Build terminé avec succès

### Phase 5 : Logs et monitoring

```powershell
# Activer les logs
az webapp log config `
  --name aps-model-publisher `
  --resource-group aps-model-publisher-rg `
  --application-logging filesystem `
  --detailed-error-messages true `
  --web-server-logging filesystem

# Voir les logs en temps réel
az webapp log tail `
  --name aps-model-publisher `
  --resource-group aps-model-publisher-rg
```

- [ ] Logs activés
- [ ] Application démarre sans erreur dans les logs

---

## 🧪 Tests post-déploiement

### 1. Healthcheck
```powershell
curl https://<votre-app>.azurewebsites.net/health
```
**Attendu :** `{"ok": true, "env": "production", "time": "..."}`

- [ ] Healthcheck OK

### 2. API Authentication
```powershell
# Tester le endpoint de login
curl -X POST https://<votre-app>.azurewebsites.net/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"admin@example.com","password":"..."}'
```

- [ ] Endpoint auth accessible

### 3. Base de données
- [ ] Tables créées automatiquement (Sequelize sync)
- [ ] Utilisateur admin créé
- [ ] Connexion fonctionnelle

### 4. Intégration APS
- [ ] Callback URL configuré dans Autodesk Platform Services
- [ ] OAuth flow fonctionne
- [ ] Accès aux projets/fichiers

---

## 🔒 Sécurité post-déploiement

- [ ] **HTTPS forcé** (activé par défaut sur azurewebsites.net)
- [ ] **Certificat SSL** valide
- [ ] **Secrets en Key Vault** (recommandé)
- [ ] **Firewall base de données** restreint aux IPs nécessaires
- [ ] **Authentification forte** activée
- [ ] **Backups base de données** configurés
- [ ] **Application Insights** activé (monitoring)

### Configuration Key Vault (Recommandé)

```powershell
# Créer Key Vault
az keyvault create `
  --name aps-publisher-kv `
  --resource-group aps-model-publisher-rg `
  --location canadacentral

# Activer identité managée
az webapp identity assign `
  --name aps-model-publisher `
  --resource-group aps-model-publisher-rg

# Ajouter secrets
az keyvault secret set --vault-name aps-publisher-kv --name "DB-PASSWORD" --value "<password>"
az keyvault secret set --vault-name aps-publisher-kv --name "APS-CLIENT-SECRET" --value "<secret>"
```

- [ ] Key Vault créé
- [ ] Identité managée activée
- [ ] Secrets migrés vers Key Vault

---

## 📊 Monitoring

### Application Insights

```powershell
# Créer App Insights
az monitor app-insights component create `
  --app aps-publisher-insights `
  --location canadacentral `
  --resource-group aps-model-publisher-rg `
  --application-type Node.JS

# Lier à la Web App
az monitor app-insights component connect-webapp `
  --app aps-publisher-insights `
  --resource-group aps-model-publisher-rg `
  --web-app aps-model-publisher
```

- [ ] Application Insights configuré
- [ ] Métriques visibles dans Azure Portal

### Alertes

- [ ] Alerte CPU > 80%
- [ ] Alerte mémoire > 80%
- [ ] Alerte erreurs HTTP 5xx
- [ ] Alerte temps de réponse

---

## 🎉 Validation finale

### Checklist complète

- [ ] ✅ Application accessible via HTTPS
- [ ] ✅ Healthcheck répond correctement
- [ ] ✅ Login admin fonctionne
- [ ] ✅ Connexion base de données OK
- [ ] ✅ Intégration APS fonctionnelle
- [ ] ✅ Logs accessibles et propres
- [ ] ✅ Monitoring actif
- [ ] ✅ Backups configurés
- [ ] ✅ Documentation à jour

### URLs importantes

| Service | URL |
|---------|-----|
| Application | `https://<votre-app>.azurewebsites.net` |
| Healthcheck | `https://<votre-app>.azurewebsites.net/health` |
| API Docs | `https://<votre-app>.azurewebsites.net/api` |
| Azure Portal | [https://portal.azure.com](https://portal.azure.com) |
| Logs | Via Azure CLI ou Portal |

---

## 🆘 Troubleshooting

### L'application ne démarre pas
```powershell
# Vérifier les logs
az webapp log tail --name <app> --resource-group <rg>

# Vérifier les variables d'environnement
az webapp config appsettings list --name <app> --resource-group <rg>

# Redémarrer
az webapp restart --name <app> --resource-group <rg>
```

### Erreur de connexion base de données
- Vérifier les credentials
- Vérifier les règles firewall
- Vérifier que `DB_SSL=true`
- Vérifier le format de DB_USER : `user@server`

### Erreur APS/Forge
- Vérifier le Client ID et Secret
- Vérifier la Callback URL dans le portail Autodesk
- Vérifier les scopes configurés

---

## 📞 Support et documentation

- **Documentation Azure :** [docs.microsoft.com/azure](https://docs.microsoft.com/azure)
- **Autodesk APS :** [aps.autodesk.com](https://aps.autodesk.com)
- **Logs applicatifs :** Azure Portal > App Service > Logs
- **Portail Azure :** [portal.azure.com](https://portal.azure.com)

---

## 💡 Améliorations futures

- [ ] CI/CD avec GitHub Actions ou Azure DevOps
- [ ] Slots de déploiement (staging/production)
- [ ] Auto-scaling basé sur la charge
- [ ] CDN pour les assets statiques
- [ ] Domaine personnalisé avec certificat SSL custom
- [ ] Azure Front Door pour la distribution globale
- [ ] Tests automatisés dans le pipeline

