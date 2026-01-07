# ============================================
# Script de déploiement Azure
# APS Model Publisher
# ============================================

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "aps-model-publisher-rg",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "canadacentral",
    
    [Parameter(Mandatory=$false)]
    [string]$AppName = "aps-model-publisher",
    
    [Parameter(Mandatory=$false)]
    [string]$PlanName = "aps-publisher-plan",
    
    [Parameter(Mandatory=$false)]
    [string]$DbServerName = "aps-publisher-db",
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("Basic", "Standard", "Premium")]
    [string]$Sku = "Basic",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipDatabase,
    
    [Parameter(Mandatory=$false)]
    [switch]$ConfigureOnly
)

# Couleurs pour les messages
function Write-Success { Write-Host "✅ $args" -ForegroundColor Green }
function Write-Info { Write-Host "ℹ️  $args" -ForegroundColor Cyan }
function Write-Warning { Write-Host "⚠️  $args" -ForegroundColor Yellow }
function Write-Error { Write-Host "❌ $args" -ForegroundColor Red }

# Vérifier si Azure CLI est installé
Write-Info "Vérification d'Azure CLI..."
try {
    $azVersion = az version --output json | ConvertFrom-Json
    Write-Success "Azure CLI version $($azVersion.'azure-cli') détectée"
} catch {
    Write-Error "Azure CLI n'est pas installé. Installez-le depuis https://aka.ms/installazurecliwindows"
    exit 1
}

# Connexion Azure
Write-Info "Vérification de la connexion Azure..."
$account = az account show 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Non connecté à Azure. Connexion en cours..."
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Échec de la connexion à Azure"
        exit 1
    }
}
Write-Success "Connecté à Azure"

# Afficher l'abonnement actif
$subscription = az account show --query name -o tsv
Write-Info "Abonnement actif: $subscription"

if (-not $ConfigureOnly) {
    # Créer le groupe de ressources
    Write-Info "Création du groupe de ressources '$ResourceGroup'..."
    az group create --name $ResourceGroup --location $Location --output none
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Groupe de ressources créé"
    } else {
        Write-Warning "Le groupe de ressources existe peut-être déjà"
    }

    # Créer l'App Service Plan
    Write-Info "Création de l'App Service Plan '$PlanName'..."
    az appservice plan create `
        --name $PlanName `
        --resource-group $ResourceGroup `
        --sku "B1" `
        --is-linux `
        --output none
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "App Service Plan créé"
    } else {
        Write-Warning "L'App Service Plan existe peut-être déjà"
    }

    # Créer la Web App
    Write-Info "Création de la Web App '$AppName'..."
    az webapp create `
        --name $AppName `
        --resource-group $ResourceGroup `
        --plan $PlanName `
        --runtime "NODE:18-lts" `
        --output none
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Web App créée"
    } else {
        Write-Warning "La Web App existe peut-être déjà"
    }

    # Créer la base de données PostgreSQL (si demandé)
    if (-not $SkipDatabase) {
        Write-Info "Création du serveur PostgreSQL '$DbServerName'..."
        Write-Warning "Veuillez entrer un mot de passe sécurisé pour la base de données:"
        $dbPassword = Read-Host -AsSecureString
        $dbPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword))
        
        az postgres flexible-server create `
            --name $DbServerName `
            --resource-group $ResourceGroup `
            --location $Location `
            --admin-user apspublisher `
            --admin-password $dbPasswordPlain `
            --sku-name Standard_B1ms `
            --tier Burstable `
            --public-access 0.0.0.0 `
            --storage-size 32 `
            --version 14 `
            --output none
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Serveur PostgreSQL créé"
            
            # Créer la base de données
            Write-Info "Création de la base de données 'aps_publisher'..."
            az postgres flexible-server db create `
                --resource-group $ResourceGroup `
                --server-name $DbServerName `
                --database-name aps_publisher `
                --output none
            
            Write-Success "Base de données créée"
            
            # Configurer le firewall
            Write-Info "Configuration du firewall pour autoriser les services Azure..."
            az postgres flexible-server firewall-rule create `
                --resource-group $ResourceGroup `
                --name $DbServerName `
                --rule-name AllowAzureServices `
                --start-ip-address 0.0.0.0 `
                --end-ip-address 0.0.0.0 `
                --output none
            
            Write-Success "Firewall configuré"
        } else {
            Write-Warning "Le serveur PostgreSQL existe peut-être déjà ou une erreur s'est produite"
        }
    }

    # Activer les logs
    Write-Info "Activation des logs..."
    az webapp log config `
        --name $AppName `
        --resource-group $ResourceGroup `
        --application-logging filesystem `
        --detailed-error-messages true `
        --failed-request-tracing true `
        --web-server-logging filesystem `
        --output none
    
    Write-Success "Logs activés"
}

# Configuration des variables d'environnement
Write-Info "Configuration des variables d'environnement..."
Write-Warning "Veuillez fournir les informations suivantes:"

# Demander les informations nécessaires
Write-Host "`n📝 Configuration de la base de données:" -ForegroundColor Yellow
$dbHost = Read-Host "DB_HOST (ex: $DbServerName.postgres.database.azure.com)"
$dbUser = Read-Host "DB_USER (ex: apspublisher)"
$dbPassword = Read-Host "DB_PASSWORD" -AsSecureString
$dbPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword))

Write-Host "`n🔑 Configuration APS/Autodesk:" -ForegroundColor Yellow
$apsClientId = Read-Host "APS_CLIENT_ID"
$apsClientSecret = Read-Host "APS_CLIENT_SECRET" -AsSecureString
$apsClientSecretPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apsClientSecret))

Write-Host "`n🔐 Configuration sécurité:" -ForegroundColor Yellow
$jwtSecret = Read-Host "JWT_SECRET (minimum 32 caractères)"
$adminEmail = Read-Host "ADMIN_EMAIL"
$adminPassword = Read-Host "ADMIN_PASSWORD" -AsSecureString
$adminPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPassword))

Write-Host "`n📧 Configuration SMTP (optionnel - Entrée pour passer):" -ForegroundColor Yellow
$smtpHost = Read-Host "SMTP_HOST"
$smtpPort = Read-Host "SMTP_PORT (587)"
if ([string]::IsNullOrWhiteSpace($smtpPort)) { $smtpPort = "587" }
$smtpUser = Read-Host "SMTP_USER"
$smtpPassword = Read-Host "SMTP_PASSWORD" -AsSecureString
$smtpPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($smtpPassword))
$smtpFrom = Read-Host "SMTP_FROM (ex: noreply@example.com)"

# Appliquer les configurations
Write-Info "Application des variables d'environnement..."

$settings = @(
    "NODE_ENV=production",
    "DB_HOST=$dbHost",
    "DB_NAME=aps_publisher",
    "DB_USER=$dbUser",
    "DB_PASSWORD=$dbPasswordPlain",
    "DB_PORT=5432",
    "DB_DIALECT=postgres",
    "DB_SSL=true",
    "APS_CLIENT_ID=$apsClientId",
    "APS_CLIENT_SECRET=$apsClientSecretPlain",
    "APS_CALLBACK_URL=https://$AppName.azurewebsites.net/api/auth/callback",
    "JWT_SECRET=$jwtSecret",
    "JWT_EXPIRES_IN=7d",
    "ADMIN_EMAIL=$adminEmail",
    "ADMIN_PASSWORD=$adminPasswordPlain",
    "CORS_ORIGIN=https://$AppName.azurewebsites.net"
)

if (-not [string]::IsNullOrWhiteSpace($smtpHost)) {
    $settings += @(
        "SMTP_HOST=$smtpHost",
        "SMTP_PORT=$smtpPort",
        "SMTP_SECURE=false",
        "SMTP_USER=$smtpUser",
        "SMTP_PASSWORD=$smtpPasswordPlain",
        "SMTP_FROM=$smtpFrom"
    )
}

az webapp config appsettings set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --settings @settings `
    --output none

if ($LASTEXITCODE -eq 0) {
    Write-Success "Variables d'environnement configurées"
} else {
    Write-Error "Erreur lors de la configuration des variables d'environnement"
    exit 1
}

# Récapitulatif
Write-Host "`n" "=" * 60 -ForegroundColor Cyan
Write-Host "✅ DÉPLOIEMENT TERMINÉ" -ForegroundColor Green
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""
Write-Host "🌐 URL de l'application:" -ForegroundColor Yellow
Write-Host "   https://$AppName.azurewebsites.net" -ForegroundColor White
Write-Host ""
Write-Host "🏥 Healthcheck:" -ForegroundColor Yellow
Write-Host "   https://$AppName.azurewebsites.net/health" -ForegroundColor White
Write-Host ""
Write-Host "📊 Portail Azure:" -ForegroundColor Yellow
Write-Host "   https://portal.azure.com/#@/resource/subscriptions/*/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName" -ForegroundColor White
Write-Host ""
Write-Host "📝 Prochaines étapes:" -ForegroundColor Yellow
Write-Host "   1. Configurer le déploiement Git:" -ForegroundColor White
Write-Host "      az webapp deployment source config-local-git --name $AppName --resource-group $ResourceGroup" -ForegroundColor Gray
Write-Host "   2. Pousser le code:" -ForegroundColor White
Write-Host "      git remote add azure <url-git>" -ForegroundColor Gray
Write-Host "      git push azure main" -ForegroundColor Gray
Write-Host "   3. Surveiller les logs:" -ForegroundColor White
Write-Host "      az webapp log tail --name $AppName --resource-group $ResourceGroup" -ForegroundColor Gray
Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan

# Proposer d'ouvrir le navigateur
$open = Read-Host "`nVoulez-vous ouvrir le portail Azure? (o/N)"
if ($open -eq "o" -or $open -eq "O") {
    Start-Process "https://portal.azure.com/#@/resource/subscriptions/*/resourceGroups/$ResourceGroup"
}

Write-Success "Script terminé avec succès!"

