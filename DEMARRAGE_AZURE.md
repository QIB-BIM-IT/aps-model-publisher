# 🚀 Démarrage rapide Azure - APS Model Publisher

> **Guide express pour déployer votre application sur Azure en quelques minutes**

## 📦 Votre projet est maintenant prêt pour Azure !

Tous les fichiers nécessaires ont été créés et configurés. Vous avez 3 options pour déployer :

---

## Option 1️⃣ : Automatique avec PowerShell (⭐ RECOMMANDÉ)

**Temps : ~10 minutes | Difficulté : Facile**

```powershell
# 1. Installer Azure CLI (si nécessaire)
winget install Microsoft.AzureCLI

# 2. Exécuter le script automatique
.\deploy-azure.ps1
```

Le script va tout faire pour vous :
- ✅ Créer les ressources Azure
- ✅ Configurer PostgreSQL
- ✅ Vous demander vos credentials (APS, email, etc.)
- ✅ Tout configurer automatiquement

**C'est la méthode la plus simple !**

---

## Option 2️⃣ : Manuel détaillé

**Temps : ~30 minutes | Difficulté : Moyenne**

Suivez le guide complet : **[AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md)**

Idéal si vous voulez comprendre chaque étape ou personnaliser la configuration.

---

## Option 3️⃣ : Avec Docker

**Temps : ~45 minutes | Difficulté : Avancée**

Suivez le guide : **[AZURE_CONTAINER_DEPLOYMENT.md](./AZURE_CONTAINER_DEPLOYMENT.md)**

Pour un environnement 100% reproductible et une flexibilité maximale.

---

## 📋 Ce dont vous avez besoin

Avant de commencer, préparez ces informations :

### 🔑 Autodesk APS
- **Client ID** (depuis [aps.autodesk.com](https://aps.autodesk.com))
- **Client Secret**
- Scopes : `data:read data:write data:create bucket:read bucket:create`

### 🔐 Sécurité
- **JWT Secret** : Générez-en un avec cette commande :
  ```powershell
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- **Email admin** : Votre adresse email
- **Mot de passe admin** : Un mot de passe sécurisé

### 📧 Email (SMTP)
- Serveur SMTP (ex: `smtp.office365.com`)
- Port (généralement `587`)
- Utilisateur et mot de passe SMTP
- Adresse d'expédition

### 💳 Azure
- Compte Azure avec abonnement actif
- Carte de crédit enregistrée (pour la facturation)

---

## ⚡ Démarrage en 3 étapes

### Étape 1 : Préparer l'environnement

```powershell
# Installer Azure CLI
winget install Microsoft.AzureCLI

# Se connecter à Azure
az login

# Vérifier que tout fonctionne localement
cd backend
npm install
npm start

# Dans un autre terminal, tester
curl http://localhost:3000/health
```

### Étape 2 : Déployer sur Azure

```powershell
# Lancer le script automatique
.\deploy-azure.ps1

# Suivre les instructions à l'écran
# Le script va vous demander toutes les infos nécessaires
```

### Étape 3 : Pousser votre code

```powershell
# Après l'exécution du script, configurez Git
az webapp deployment source config-local-git `
  --name <nom-de-votre-app> `
  --resource-group aps-model-publisher-rg

# Ajoutez le remote Azure (l'URL sera affichée par la commande précédente)
git remote add azure <url-git-azure>

# Déployez votre code
git push azure main

# Surveillez les logs
az webapp log tail `
  --name <nom-de-votre-app> `
  --resource-group aps-model-publisher-rg
```

---

## 🎯 Vérification rapide

Après le déploiement, testez ces points :

```powershell
# 1. Healthcheck de l'API
curl https://<votre-app>.azurewebsites.net/health

# Résultat attendu :
# {"ok":true,"env":"production","time":"2026-01-07T..."}
```

```powershell
# 2. Ouvrir l'application dans le navigateur
start https://<votre-app>.azurewebsites.net
```

```powershell
# 3. Vérifier les logs
az webapp log tail --name <votre-app> --resource-group aps-model-publisher-rg
```

---

## 💰 Coûts mensuels estimés

| Service | Coût (CAD/mois) |
|---------|-----------------|
| App Service B1 | ~50 $ |
| PostgreSQL B1ms | ~30 $ |
| Stockage | ~5 $ |
| **TOTAL** | **~85 $/mois** |

💡 Vous pouvez ajuster les SKU pour réduire ou augmenter les coûts selon vos besoins.

---

## 📚 Documentation complète

| Document | Description | Quand l'utiliser |
|----------|-------------|------------------|
| **[AZURE_README.md](./AZURE_README.md)** | Vue d'ensemble et démarrage rapide | Pour commencer |
| **[AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md)** | Guide complet App Service | Déploiement manuel détaillé |
| **[AZURE_CONTAINER_DEPLOYMENT.md](./AZURE_CONTAINER_DEPLOYMENT.md)** | Guide Docker/Containers | Pour utiliser Docker |
| **[AZURE_CHECKLIST.md](./AZURE_CHECKLIST.md)** | Checklist pas à pas | Pour ne rien oublier |
| **[AZURE_CHANGES.md](./AZURE_CHANGES.md)** | Liste des modifications | Voir ce qui a changé |

---

## 🆘 Problèmes courants

### ❌ "L'application ne démarre pas"

```powershell
# Vérifiez les logs
az webapp log tail --name <app> --resource-group <rg>

# Vérifiez les variables d'environnement
az webapp config appsettings list --name <app> --resource-group <rg>

# Redémarrez l'application
az webapp restart --name <app> --resource-group <rg>
```

### ❌ "Erreur de connexion à la base de données"

- ✅ Vérifiez que `DB_SSL=true`
- ✅ Format de DB_USER : `username@servername`
- ✅ Vérifiez les règles firewall PostgreSQL
- ✅ Testez la connexion depuis Azure Portal

### ❌ "Erreur APS/Autodesk"

- ✅ Vérifiez la Callback URL dans le portail Autodesk
- ✅ Format : `https://<app>.azurewebsites.net/api/auth/callback`
- ✅ Vérifiez que les scopes sont corrects
- ✅ Testez vos credentials localement d'abord

### ❌ "Script PowerShell bloqué"

```powershell
# Autoriser l'exécution de scripts
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## 🎓 Ressources utiles

### Microsoft Azure
- [Portail Azure](https://portal.azure.com)
- [Documentation App Service](https://docs.microsoft.com/azure/app-service/)
- [Documentation PostgreSQL](https://docs.microsoft.com/azure/postgresql/)
- [Calculateur de coûts](https://azure.microsoft.com/pricing/calculator/)

### Autodesk
- [Portail APS](https://aps.autodesk.com)
- [Documentation API](https://aps.autodesk.com/developer/documentation)
- [Forum développeurs](https://forums.autodesk.com/)

### Outils
- [Azure CLI](https://docs.microsoft.com/cli/azure/)
- [Visual Studio Code](https://code.visualstudio.com/)
- [Azure Extension pour VS Code](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azureappservice)

---

## ✅ Checklist finale

Avant de dire "C'est bon !" :

- [ ] ✅ Application accessible via HTTPS
- [ ] ✅ Healthcheck répond correctement
- [ ] ✅ Login admin fonctionne
- [ ] ✅ Connexion à PostgreSQL OK
- [ ] ✅ Intégration APS/Autodesk fonctionnelle
- [ ] ✅ Logs visibles et sans erreurs critiques
- [ ] ✅ Webhooks APS mis à jour avec nouvelle URL
- [ ] ✅ Emails de notification fonctionnent
- [ ] ✅ Backups base de données activés
- [ ] ✅ Monitoring configuré (Application Insights)

---

## 🎉 Prochaines étapes après le déploiement

1. **Sécurité renforcée**
   - Migrer les secrets vers Azure Key Vault
   - Configurer l'authentification multi-facteurs
   - Restreindre les accès réseau

2. **Monitoring**
   - Activer Application Insights
   - Configurer des alertes (CPU, mémoire, erreurs)
   - Créer un tableau de bord de monitoring

3. **Optimisation**
   - Configurer le cache
   - Activer la compression
   - Optimiser les requêtes base de données

4. **CI/CD**
   - Mettre en place GitHub Actions
   - Créer des slots de déploiement (staging/production)
   - Automatiser les tests

---

## 💬 Besoin d'aide ?

Si vous êtes bloqué :

1. **Consultez la checklist** : [AZURE_CHECKLIST.md](./AZURE_CHECKLIST.md)
2. **Lisez le guide détaillé** : [AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md)
3. **Vérifiez les logs** Azure
4. **Testez localement** pour isoler le problème
5. **Documentation Microsoft** Azure

---

## 🌟 Récapitulatif

✅ **12 nouveaux fichiers** créés pour Azure
✅ **0 modifications** du code existant
✅ **3 méthodes** de déploiement disponibles
✅ **Documentation complète** en français
✅ **Script automatisé** pour gagner du temps
✅ **Prêt à déployer** en quelques minutes !

---

**Bon déploiement ! 🚀**

*Si vous avez des questions ou rencontrez des problèmes, consultez les guides détaillés ou les logs Azure.*

