# Webhooks Autodesk APS

## 📋 Vue d'ensemble

Les webhooks permettent de recevoir des notifications en temps réel quand des événements se produisent dans Autodesk APS (publication de modèles, export PDF, etc.).

## ⚙️ Configuration

### Variables d'environnement

```env
# Activer les webhooks (false par défaut)
WEBHOOKS_ENABLED=true

# URL de callback publique (requis pour Azure)
WEBHOOK_CALLBACK_URL=https://votre-app.azurewebsites.net/api/webhooks/aps

# Secret partagé avec Autodesk (requis pour validation signature)
WEBHOOK_SECRET=votre_secret_autodesk
```

### Activation

1. **En local** : Les webhooks ne fonctionnent pas (pas d'URL publique)
2. **Sur Azure** : 
   - Définir `WEBHOOKS_ENABLED=true`
   - Configurer `WEBHOOK_CALLBACK_URL` avec l'URL publique de ton app
   - Obtenir le `WEBHOOK_SECRET` depuis Autodesk Developer Portal

## 🔗 Endpoints

### `POST /api/webhooks/aps`
Endpoint principal pour recevoir les webhooks Autodesk.

**Headers requis :**
- `X-Webhook-Signature` ou `X-Autodesk-Signature` : Signature HMAC-SHA256

**Body :**
```json
{
  "payload": {
    "eventType": "version.created",
    "projectId": "b.xxx",
    "itemId": "urn:...",
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

### `GET /api/webhooks/status`
Vérifier le statut des webhooks (activés/désactivés).

**Réponse :**
```json
{
  "success": true,
  "enabled": false,
  "configured": false,
  "callbackUrl": null,
  "message": "Webhooks désactivés. Activez avec WEBHOOKS_ENABLED=true"
}
```

### `POST /api/webhooks/test` (développement uniquement)
Endpoint de test pour simuler un webhook sans passer par Autodesk.

**Body :**
```json
{
  "event": {
    "payload": {
      "eventType": "export.completed",
      "runId": "xxx-xxx-xxx",
      "timestamp": "2025-01-15T10:30:00Z"
    }
  }
}
```

## 📊 Métriques mises à jour

Quand un webhook est reçu, les métriques suivantes sont mises à jour dans le run :

- `webhookEndTime` : Moment où l'événement s'est produit (temps réel)
- `webhookEventType` : Type d'événement reçu
- `webhookReceived` : `true` si webhook reçu
- `realDurationMs` : Temps réel total (depuis `startedAt` jusqu'à `webhookEndTime`)

## 🔒 Sécurité

Les webhooks sont validés avec HMAC-SHA256 :
1. Autodesk calcule une signature avec le secret partagé
2. Le serveur vérifie la signature avant de traiter l'événement
3. Si la signature est invalide, la requête est rejetée (401)

## 📝 Types d'événements supportés

### Publication (Publish)
- `version.created`
- `item.published`
- `publish.completed`

### Export PDF
- `export.completed`
- `pdf.uploaded`
- `export.finished`

## 🚀 Déploiement sur Azure

1. **Configurer les variables d'environnement** dans Azure App Service
2. **Enregistrer le webhook** dans Autodesk Developer Portal :
   - URL : `https://votre-app.azurewebsites.net/api/webhooks/aps`
   - Secret : Le même que `WEBHOOK_SECRET`
3. **Tester** avec `/api/webhooks/status`

## 🐛 Debugging

Les logs incluent :
- `[Webhooks] 📨 Événement reçu` : Webhook reçu
- `[Webhooks] ✅ Webhook reçu et validé` : Signature valide
- `[Webhooks] ⚠️ Signature invalide` : Signature rejetée
- `[Webhooks] ✅ Run X mis à jour avec temps réel` : Run mis à jour

