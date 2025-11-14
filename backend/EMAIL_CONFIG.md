# Configuration du Service Email

Ce document explique comment configurer le service de notification par email pour recevoir des alertes lorsque des tâches échouent.

## Variables d'environnement

Ajoutez les variables suivantes dans votre fichier `.env` :

```env
# Activer le service email
EMAIL_ENABLED=true

# Configuration SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-app

# Email expéditeur (optionnel, utilise SMTP_USER par défaut)
EMAIL_FROM=noreply@aps-model-publisher.com
```

## Configuration Gmail

Pour utiliser Gmail comme serveur SMTP :

1. **Activer l'authentification à deux facteurs** sur votre compte Gmail
2. **Générer un mot de passe d'application** :
   - Allez dans [Paramètres Google Account](https://myaccount.google.com/)
   - Sécurité → Authentification à deux facteurs → Mots de passe des applications
   - Créez un nouveau mot de passe d'application
   - Utilisez ce mot de passe dans `SMTP_PASS`

## Configuration d'autres fournisseurs

### Outlook / Office 365
```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
```

### SendGrid
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=votre-api-key-sendgrid
```

### Mailgun
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
```

## Utilisation dans l'interface

1. Lors de la création d'une tâche (Publish ou PDF), cochez la case **"📧 Notification par courriel en cas d'échec"**
2. Par défaut, l'email sera envoyé à l'adresse email de l'utilisateur propriétaire de la tâche
3. Vous pouvez également spécifier des destinataires personnalisés dans le champ `notificationRecipients` (fonctionnalité avancée)

## Format des emails

Les emails d'erreur incluent :
- Nom et type de la tâche
- ID de la tâche et du run
- Détails du projet et du fichier
- Statistiques (succès/échecs)
- Message d'erreur détaillé
- Résultats complets au format JSON

## Désactiver le service

Pour désactiver complètement le service email, définissez :
```env
EMAIL_ENABLED=false
```

Les notifications ne seront pas envoyées même si `notifyOnFailure` est activé sur une tâche.

