# Déploiement Azure avec Docker Container

Ce guide explique comment déployer l'application APS Model Publisher sur Azure en utilisant des containers Docker.

## 🐳 Option 1 : Azure Container Instances (ACI)

Azure Container Instances est la solution la plus simple pour déployer un container unique.

### Prérequis

```bash
# Connexion Azure
az login

# Créer un groupe de ressources
az group create --name aps-model-publisher-rg --location canadacentral

# Créer un registre de containers (ACR)
az acr create \
  --resource-group aps-model-publisher-rg \
  --name apspublisheracr \
  --sku Basic
```

### Construction et push de l'image

```bash
# Se connecter au registre
az acr login --name apspublisheracr

# Construire l'image localement
docker build -t apspublisheracr.azurecr.io/aps-publisher:latest .

# Pousser l'image vers ACR
docker push apspublisheracr.azurecr.io/aps-publisher:latest
```

### Déploiement sur ACI

```bash
# Créer le container instance
az container create \
  --resource-group aps-model-publisher-rg \
  --name aps-publisher-container \
  --image apspublisheracr.azurecr.io/aps-publisher:latest \
  --dns-name-label aps-publisher \
  --ports 3000 \
  --cpu 1 \
  --memory 1.5 \
  --registry-login-server apspublisheracr.azurecr.io \
  --registry-username $(az acr credential show --name apspublisheracr --query username -o tsv) \
  --registry-password $(az acr credential show --name apspublisheracr --query passwords[0].value -o tsv) \
  --environment-variables \
    NODE_ENV=production \
    PORT=3000 \
  --secure-environment-variables \
    DB_HOST=<your-db-host> \
    DB_NAME=aps_publisher \
    DB_USER=<your-db-user> \
    DB_PASSWORD=<your-db-password> \
    APS_CLIENT_ID=<your-client-id> \
    APS_CLIENT_SECRET=<your-client-secret> \
    JWT_SECRET=<your-jwt-secret>
```

### Vérification

```bash
# Obtenir l'adresse IP publique
az container show \
  --resource-group aps-model-publisher-rg \
  --name aps-publisher-container \
  --query ipAddress.fqdn \
  --output tsv

# Tester le healthcheck
curl http://aps-publisher.canadacentral.azurecontainer.io:3000/health

# Voir les logs
az container logs \
  --resource-group aps-model-publisher-rg \
  --name aps-publisher-container
```

## 🚢 Option 2 : Azure App Service avec Container

Azure App Service peut également exécuter des containers Docker avec plus de fonctionnalités (auto-scaling, slots de déploiement, etc.).

### Créer l'App Service

```bash
# Créer un plan App Service pour containers
az appservice plan create \
  --name aps-publisher-plan \
  --resource-group aps-model-publisher-rg \
  --is-linux \
  --sku B1

# Créer la Web App avec container
az webapp create \
  --resource-group aps-model-publisher-rg \
  --plan aps-publisher-plan \
  --name aps-publisher-webapp \
  --deployment-container-image-name apspublisheracr.azurecr.io/aps-publisher:latest
```

### Configurer le registre de containers

```bash
# Configurer les credentials ACR
az webapp config container set \
  --name aps-publisher-webapp \
  --resource-group aps-model-publisher-rg \
  --docker-custom-image-name apspublisheracr.azurecr.io/aps-publisher:latest \
  --docker-registry-server-url https://apspublisheracr.azurecr.io \
  --docker-registry-server-user $(az acr credential show --name apspublisheracr --query username -o tsv) \
  --docker-registry-server-password $(az acr credential show --name apspublisheracr --query passwords[0].value -o tsv)

# Activer le déploiement continu (webhook)
az webapp deployment container config \
  --name aps-publisher-webapp \
  --resource-group aps-model-publisher-rg \
  --enable-cd true
```

### Configurer les variables d'environnement

```bash
az webapp config appsettings set \
  --name aps-publisher-webapp \
  --resource-group aps-model-publisher-rg \
  --settings \
    WEBSITES_PORT=3000 \
    NODE_ENV=production \
    DB_HOST=<your-db> \
    DB_NAME=aps_publisher \
    DB_USER=<user> \
    DB_PASSWORD=<password> \
    APS_CLIENT_ID=<client-id> \
    APS_CLIENT_SECRET=<client-secret> \
    JWT_SECRET=<jwt-secret> \
    CORS_ORIGIN=https://aps-publisher-webapp.azurewebsites.net
```

### Activer les logs

```bash
az webapp log config \
  --name aps-publisher-webapp \
  --resource-group aps-model-publisher-rg \
  --docker-container-logging filesystem

# Stream des logs
az webapp log tail \
  --name aps-publisher-webapp \
  --resource-group aps-model-publisher-rg
```

## 🔄 Mise à jour du container

### Rebuild et redéploiement automatique

```bash
# 1. Rebuild l'image avec un nouveau tag
docker build -t apspublisheracr.azurecr.io/aps-publisher:v1.0.1 .
docker tag apspublisheracr.azurecr.io/aps-publisher:v1.0.1 apspublisheracr.azurecr.io/aps-publisher:latest

# 2. Push vers ACR
docker push apspublisheracr.azurecr.io/aps-publisher:v1.0.1
docker push apspublisheracr.azurecr.io/aps-publisher:latest

# 3a. Pour ACI : recréer le container
az container delete --resource-group aps-model-publisher-rg --name aps-publisher-container --yes
# Puis relancer la commande de création

# 3b. Pour App Service : restart (avec webhook configuré, c'est automatique)
az webapp restart \
  --name aps-publisher-webapp \
  --resource-group aps-model-publisher-rg
```

## 🧪 Test en local avec Docker

Avant de déployer sur Azure, testez localement :

```bash
# Construire l'image
docker build -t aps-publisher:local .

# Créer un fichier .env.local avec vos variables
# Puis lancer le container
docker run -p 3000:3000 \
  --env-file .env.local \
  --name aps-publisher-test \
  aps-publisher:local

# Tester
curl http://localhost:3000/health

# Voir les logs
docker logs aps-publisher-test -f

# Arrêter et supprimer
docker stop aps-publisher-test
docker rm aps-publisher-test
```

## 🐳 Docker Compose pour développement

Pour tester avec une base de données locale :

```bash
# Créer un .env à la racine avec vos variables
cp .env.azure.example .env
# Éditer .env avec vos valeurs

# Lancer les services
docker-compose up -d

# Voir les logs
docker-compose logs -f backend

# Arrêter
docker-compose down

# Arrêter et supprimer les volumes
docker-compose down -v
```

## 🔍 Monitoring et diagnostic

### Healthcheck

Le Dockerfile inclut un healthcheck automatique qui vérifie l'endpoint `/health` toutes les 30 secondes.

```bash
# Vérifier le statut du healthcheck
docker inspect --format='{{json .State.Health}}' aps-publisher-container | jq
```

### Métriques Azure

```bash
# CPU usage
az monitor metrics list \
  --resource /subscriptions/<subscription-id>/resourceGroups/aps-model-publisher-rg/providers/Microsoft.ContainerInstance/containerGroups/aps-publisher-container \
  --metric CPUUsage

# Memory usage
az monitor metrics list \
  --resource /subscriptions/<subscription-id>/resourceGroups/aps-model-publisher-rg/providers/Microsoft.ContainerInstance/containerGroups/aps-publisher-container \
  --metric MemoryUsage
```

## 🔐 Sécurité

### Utiliser Azure Key Vault pour les secrets

```bash
# Créer un Key Vault
az keyvault create \
  --name aps-publisher-kv \
  --resource-group aps-model-publisher-rg \
  --location canadacentral

# Ajouter des secrets
az keyvault secret set --vault-name aps-publisher-kv --name "DB-PASSWORD" --value "<password>"
az keyvault secret set --vault-name aps-publisher-kv --name "APS-CLIENT-SECRET" --value "<secret>"
az keyvault secret set --vault-name aps-publisher-kv --name "JWT-SECRET" --value "<secret>"

# Pour App Service : activer l'identité managée
az webapp identity assign \
  --name aps-publisher-webapp \
  --resource-group aps-model-publisher-rg

# Donner accès au Key Vault
az keyvault set-policy \
  --name aps-publisher-kv \
  --object-id <managed-identity-principal-id> \
  --secret-permissions get list

# Référencer les secrets dans les app settings
az webapp config appsettings set \
  --name aps-publisher-webapp \
  --resource-group aps-model-publisher-rg \
  --settings \
    DB_PASSWORD="@Microsoft.KeyVault(SecretUri=https://aps-publisher-kv.vault.azure.net/secrets/DB-PASSWORD/)" \
    APS_CLIENT_SECRET="@Microsoft.KeyVault(SecretUri=https://aps-publisher-kv.vault.azure.net/secrets/APS-CLIENT-SECRET/)" \
    JWT_SECRET="@Microsoft.KeyVault(SecretUri=https://aps-publisher-kv.vault.azure.net/secrets/JWT-SECRET/)"
```

## 💰 Coûts comparatifs (Canada Central)

### Azure Container Instances
- **1 vCPU, 1.5 GB RAM** : ~30 CAD/mois
- Facturation à la seconde
- Pas de coûts fixes

### Azure App Service avec Container
- **Basic B1** : ~50 CAD/mois
- Plus de fonctionnalités (slots, auto-scaling)
- Coût fixe mensuel

### Azure Container Registry
- **Basic SKU** : ~7 CAD/mois
- Nécessaire pour les deux options

## 📊 Comparaison des options

| Feature | ACI | App Service Container | App Service Standard |
|---------|-----|----------------------|---------------------|
| Coût mensuel | ~30 CAD | ~50 CAD | ~50 CAD |
| Auto-scaling | Non | Oui | Oui |
| Slots de déploiement | Non | Oui | Oui |
| Custom domains/SSL | Limité | Oui | Oui |
| Intégration VNet | Oui | Oui | Oui |
| Facilité de setup | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Flexibilité | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

## 🎯 Recommandation

- **Développement/Test** : Docker Compose en local
- **Production simple** : Azure Container Instances
- **Production avancée** : Azure App Service avec Container
- **Pour démarrer rapidement** : App Service Standard (sans container)

