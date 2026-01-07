# 🚀 Déploiement Azure - Guide Rapide

## 📦 Fichiers créés pour Azure

Votre application est maintenant prête pour Azure ! Les fichiers suivants ont été ajoutés :

### 📄 Configuration
- ✅ **package.json** (racine et backend) - Mis à jour avec `engines` Node.js
- ✅ **.deployment** - Configuration du déploiement Azure
- ✅ **web.config** - Configuration IIS pour Azure App Service
- ✅ **.gitignore** - Fichiers à ignorer
- ✅ **.env.azure.example** - Template des variables d'environnement

### 🐳 Docker (optionnel)
- ✅ **Dockerfile** - Image container production
- ✅ **.dockerignore** - Exclusions Docker
- ✅ **docker-compose.yml** - Orchestration locale

### 📚 Documentation
- ✅ **AZURE_DEPLOYMENT.md** - Guide détaillé App Service standard
- ✅ **AZURE_CONTAINER_DEPLOYMENT.md** - Guide Docker/Containers
- ✅ **AZURE_CHECKLIST.md** - Checklist complète étape par étape

### 🛠️ Scripts
- ✅ **deploy-azure.ps1** - Script PowerShell de déploiement automatisé

---

## 🎯 Comment déployer ?

### Option 1 : Script automatisé (Le plus simple)

```powershell
# Exécuter le script interactif
.\deploy-azure.ps1
```

Le script va :
1. Créer l'infrastructure Azure (Resource Group, App Service, PostgreSQL)
2. Vous demander les informations nécessaires (APS credentials, SMTP, etc.)
3. Configurer toutes les variables d'environnement
4. Vous donner les commandes pour déployer le code

### Option 2 : Déploiement manuel

Suivez le guide complet : **[AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md)**

### Option 3 : Déploiement avec Docker

Suivez le guide : **[AZURE_CONTAINER_DEPLOYMENT.md](./AZURE_CONTAINER_DEPLOYMENT.md)**

---

## 📋 Checklist rapide

Avant de déployer, assurez-vous d'avoir :

- [ ] **Azure CLI** installé (`winget install Microsoft.AzureCLI`)
- [ ] **Compte Azure** avec abonnement actif
- [ ] **Credentials APS** (Client ID + Secret depuis [Autodesk Platform Services](https://aps.autodesk.com))
- [ ] **JWT Secret** (générer : `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)
- [ ] **Configuration SMTP** (serveur email)
- [ ] **Git** configuré

---

## ⚡ Démarrage rapide

### 1. Installer Azure CLI (si pas déjà fait)

```powershell
winget install Microsoft.AzureCLI
```

### 2. Se connecter à Azure

```powershell
az login
```

### 3. Lancer le déploiement

```powershell
# Option simple : tout automatique
.\deploy-azure.ps1

# Option avancée : personnaliser les noms
.\deploy-azure.ps1 `
  -ResourceGroup "mon-groupe" `
  -Location "canadacentral" `
  -AppName "mon-application" `
  -PlanName "mon-plan"
```

### 4. Déployer le code

```powershell
# Après avoir exécuté le script, configurer Git
az webapp deployment source config-local-git `
  --name <votre-app> `
  --resource-group <votre-rg>

# Obtenir l'URL Git
$gitUrl = az webapp deployment list-publishing-credentials `
  --name <votre-app> `
  --resource-group <votre-rg> `
  --query scmUri -o tsv

# Ajouter le remote
git remote add azure $gitUrl

# Pousser le code
git push azure main
```

### 5. Vérifier le déploiement

```powershell
# Voir les logs
az webapp log tail `
  --name <votre-app> `
  --resource-group <votre-rg>

# Tester l'API
curl https://<votre-app>.azurewebsites.net/health
```

---

## 📊 Coûts estimés

| Service | SKU | Coût mensuel (CAD) |
|---------|-----|-------------------|
| App Service | B1 (Basic) | ~50 CAD |
| PostgreSQL | B1ms (Burstable) | ~30 CAD |
| Container Registry | Basic | ~7 CAD |
| Application Insights | Pay-as-you-go | ~5 CAD |
| **Total** | | **~80-90 CAD/mois** |

💡 **Astuce** : Utilisez le calculateur Azure pour une estimation précise : [azure.microsoft.com/pricing/calculator](https://azure.microsoft.com/pricing/calculator/)

---

## 🆘 Besoin d'aide ?

### Documentation complète
- **Déploiement standard** : [AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md)
- **Déploiement Docker** : [AZURE_CONTAINER_DEPLOYMENT.md](./AZURE_CONTAINER_DEPLOYMENT.md)
- **Checklist détaillée** : [AZURE_CHECKLIST.md](./AZURE_CHECKLIST.md)

### Ressources externes
- [Documentation Azure App Service](https://docs.microsoft.com/azure/app-service/)
- [Documentation PostgreSQL Azure](https://docs.microsoft.com/azure/postgresql/)
- [Autodesk Platform Services](https://aps.autodesk.com/developer/overview)

### Problèmes courants

#### ❌ L'application ne démarre pas
```powershell
# Voir les logs détaillés
az webapp log tail --name <app> --resource-group <rg>
```

#### ❌ Erreur de connexion base de données
- Vérifier les règles firewall PostgreSQL
- S'assurer que `DB_SSL=true`
- Format utilisateur : `username@servername`

#### ❌ Erreur APS/Autodesk
- Vérifier la Callback URL dans le portail Autodesk
- S'assurer que les scopes sont corrects
- Vérifier Client ID et Secret

---

## ✅ Validation post-déploiement

Après le déploiement, testez ces endpoints :

```powershell
# 1. Healthcheck
curl https://<votre-app>.azurewebsites.net/health

# 2. API disponible
curl https://<votre-app>.azurewebsites.net/api/auth/status

# 3. Ouvrir dans le navigateur
start https://<votre-app>.azurewebsites.net
```

---

## 🎉 Prochaines étapes

Après un déploiement réussi :

1. **Configurer les webhooks APS** avec votre nouvelle URL Azure
2. **Activer Application Insights** pour le monitoring
3. **Configurer les alertes** (CPU, mémoire, erreurs)
4. **Mettre en place les backups** de la base de données
5. **Documenter** les credentials et URLs pour votre équipe
6. **Tester** toutes les fonctionnalités en production

---

## 🔒 Sécurité

### Recommandations importantes

1. ✅ **Ne jamais commiter de fichiers .env**
2. ✅ **Utiliser Azure Key Vault** pour les secrets sensibles
3. ✅ **Activer HTTPS uniquement** (activé par défaut)
4. ✅ **Restreindre l'accès** à la base de données
5. ✅ **Surveiller les logs** régulièrement
6. ✅ **Mettre à jour** les dépendances npm régulièrement

### Migrer vers Key Vault (recommandé)

Voir la section "Sécurité" dans [AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md#-sécurité)

---

## 📞 Support

Pour toute question ou problème :

1. **Consulter** [AZURE_CHECKLIST.md](./AZURE_CHECKLIST.md) pour le troubleshooting
2. **Vérifier** les logs Azure
3. **Consulter** la documentation Microsoft Azure
4. **Tester** localement avec Docker pour isoler les problèmes

---

**Bon déploiement ! 🚀**

