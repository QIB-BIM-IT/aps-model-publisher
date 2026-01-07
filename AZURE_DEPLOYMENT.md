# Guide de déploiement Azure

## 📋 Prérequis

1. Compte Azure actif
2. Azure CLI installé (`az --version` pour vérifier)
3. Node.js >= 18.0.0
4. Base de données PostgreSQL (Azure Database for PostgreSQL)

## 🚀 Déploiement via Azure CLI

### 1. Connexion à Azure

```bash
az login
```

### 2. Créer un groupe de ressources

```bash
az group create --name aps-model-publisher-rg --location canadacentral
```

### 3. Créer un App Service Plan

```bash
az appservice plan create \
  --name aps-model-publisher-plan \
  --resource-group aps-model-publisher-rg \
  --sku B1 \
  --is-linux
```

### 4. Créer la Web App

```bash
az webapp create \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg \
  --plan aps-model-publisher-plan \
  --runtime "NODE:18-lts"
```

### 5. Configurer les variables d'environnement

```bash
# Variables de base de données
az webapp config appsettings set \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg \
  --settings \
    NODE_ENV=production \
    DB_HOST="<votre-serveur-postgres>.postgres.database.azure.com" \
    DB_NAME="aps_publisher" \
    DB_USER="<username>@<serveur>" \
    DB_PASSWORD="<password>" \
    DB_PORT=5432 \
    DB_DIALECT=postgres \
    DB_SSL=true

# Variables APS/Autodesk
az webapp config appsettings set \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg \
  --settings \
    APS_CLIENT_ID="<your-client-id>" \
    APS_CLIENT_SECRET="<your-client-secret>" \
    APS_CALLBACK_URL="https://aps-model-publisher.azurewebsites.net/api/auth/callback"

# JWT et sécurité
az webapp config appsettings set \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg \
  --settings \
    JWT_SECRET="<generate-a-secure-random-string>" \
    ADMIN_EMAIL="<admin@example.com>" \
    ADMIN_PASSWORD="<secure-admin-password>"

# Configuration email (SMTP)
az webapp config appsettings set \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg \
  --settings \
    SMTP_HOST="<smtp.example.com>" \
    SMTP_PORT=587 \
    SMTP_SECURE=false \
    SMTP_USER="<smtp-user>" \
    SMTP_PASSWORD="<smtp-password>" \
    SMTP_FROM="<noreply@example.com>"

# CORS
az webapp config appsettings set \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg \
  --settings \
    CORS_ORIGIN="https://aps-model-publisher.azurewebsites.net"
```

### 6. Configurer le déploiement depuis Git

#### Option A : Déploiement local Git

```bash
# Activer le déploiement Git local
az webapp deployment source config-local-git \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg

# Obtenir l'URL Git et les credentials
az webapp deployment list-publishing-credentials \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg

# Ajouter Azure comme remote
git remote add azure <url-git-azure>

# Déployer
git push azure main
```

#### Option B : Déploiement depuis GitHub

```bash
az webapp deployment source config \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg \
  --repo-url https://github.com/<your-org>/<your-repo> \
  --branch main \
  --manual-integration
```

### 7. Activer les logs

```bash
az webapp log config \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg \
  --application-logging filesystem \
  --detailed-error-messages true \
  --failed-request-tracing true \
  --web-server-logging filesystem

# Voir les logs en temps réel
az webapp log tail \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg
```

## 🗄️ Configuration de la base de données PostgreSQL

### Créer le serveur PostgreSQL

```bash
az postgres flexible-server create \
  --name aps-publisher-db \
  --resource-group aps-model-publisher-rg \
  --location canadacentral \
  --admin-user apspublisher \
  --admin-password <SecurePassword123!> \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --public-access 0.0.0.0 \
  --storage-size 32 \
  --version 14
```

### Créer la base de données

```bash
az postgres flexible-server db create \
  --resource-group aps-model-publisher-rg \
  --server-name aps-publisher-db \
  --database-name aps_publisher
```

### Configurer le firewall

```bash
# Autoriser les services Azure
az postgres flexible-server firewall-rule create \
  --resource-group aps-model-publisher-rg \
  --name aps-publisher-db \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

## 🔍 Vérification du déploiement

### Tester le healthcheck

```bash
curl https://aps-model-publisher.azurewebsites.net/health
```

Réponse attendue :
```json
{
  "ok": true,
  "env": "production",
  "time": "2025-01-07T..."
}
```

### Accéder à l'application

```
https://aps-model-publisher.azurewebsites.net
```

## 📊 Monitoring et diagnostics

### Activer Application Insights

```bash
# Créer une instance Application Insights
az monitor app-insights component create \
  --app aps-model-publisher-insights \
  --location canadacentral \
  --resource-group aps-model-publisher-rg \
  --application-type Node.JS

# Lier à la Web App
az monitor app-insights component connect-webapp \
  --app aps-model-publisher-insights \
  --resource-group aps-model-publisher-rg \
  --web-app aps-model-publisher
```

### Consulter les métriques

```bash
# CPU
az monitor metrics list \
  --resource /subscriptions/<subscription-id>/resourceGroups/aps-model-publisher-rg/providers/Microsoft.Web/sites/aps-model-publisher \
  --metric "CpuPercentage"

# Mémoire
az monitor metrics list \
  --resource /subscriptions/<subscription-id>/resourceGroups/aps-model-publisher-rg/providers/Microsoft.Web/sites/aps-model-publisher \
  --metric "MemoryPercentage"
```

## 🔄 Mise à jour de l'application

```bash
# Simple push vers Azure
git push azure main

# Ou redémarrer l'application
az webapp restart \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg
```

## 🛠️ Dépannage

### Voir les logs d'application

```bash
az webapp log tail --name aps-model-publisher --resource-group aps-model-publisher-rg
```

### Voir les logs de déploiement

```bash
az webapp log deployment show \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg
```

### SSH dans le container

```bash
az webapp ssh \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg
```

### Vérifier les variables d'environnement

```bash
az webapp config appsettings list \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg
```

## 📝 Checklist de déploiement

- [ ] Groupe de ressources créé
- [ ] App Service Plan créé
- [ ] Web App créée
- [ ] Base de données PostgreSQL configurée
- [ ] Règles de firewall configurées
- [ ] Variables d'environnement configurées
- [ ] Déploiement Git configuré
- [ ] Logs activés
- [ ] Application Insights configuré (optionnel)
- [ ] Healthcheck testé
- [ ] Application fonctionnelle
- [ ] Webhooks APS configurés avec la nouvelle URL Azure

## 🔐 Sécurité

### Recommandations

1. **Utiliser Azure Key Vault** pour les secrets sensibles
2. **Activer HTTPS uniquement**
3. **Configurer un certificat SSL personnalisé** si domaine custom
4. **Activer l'authentification managée** pour la base de données
5. **Restreindre les IPs** dans le firewall PostgreSQL
6. **Activer les backups automatiques** de la base de données

### Configurer Key Vault (recommandé)

```bash
# Créer un Key Vault
az keyvault create \
  --name aps-publisher-kv \
  --resource-group aps-model-publisher-rg \
  --location canadacentral

# Ajouter des secrets
az keyvault secret set \
  --vault-name aps-publisher-kv \
  --name "APS-CLIENT-SECRET" \
  --value "<your-secret>"

# Activer l'identité managée pour la Web App
az webapp identity assign \
  --name aps-model-publisher \
  --resource-group aps-model-publisher-rg

# Donner accès au Key Vault
az keyvault set-policy \
  --name aps-publisher-kv \
  --object-id <managed-identity-object-id> \
  --secret-permissions get list
```

## 💰 Coûts estimés (Canada Central)

- **App Service B1** : ~50 CAD/mois
- **PostgreSQL Flexible Server (B1ms)** : ~30 CAD/mois
- **Application Insights** : Variable selon utilisation
- **Stockage** : ~2-5 CAD/mois

**Total estimé** : ~80-90 CAD/mois

## 📞 Support

Pour toute question ou problème, consultez :
- [Documentation Azure App Service](https://docs.microsoft.com/azure/app-service/)
- [Documentation Azure Database for PostgreSQL](https://docs.microsoft.com/azure/postgresql/)
- Logs de l'application dans Azure Portal

