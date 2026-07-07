# build-bundle.ps1
# Compile l'addin QcExtractor et produit le zip AppBundle Design Automation pour l'engine cible.
#   Revit 2024 -> net48            -> output/QcExtractor2024.bundle.zip
#   Revit 2025 -> net8.0-windows   -> output/QcExtractor2025.bundle.zip
# Le code metier C# est identique ; seuls le targeting et le PackageContents changent.
#
# Usage :
#   pwsh ./build-bundle.ps1 -EngineVersion 2024
#   pwsh ./build-bundle.ps1 -EngineVersion 2025 [-RevitApiDir "C:\Program Files\Autodesk\Revit 2025"]

param(
    [ValidateSet('2024', '2025')]
    [string]$EngineVersion = '2024',
    [string]$RevitApiDir = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$tfMap = @{ '2024' = 'net48'; '2025' = 'net8.0-windows' }
$tf = $tfMap[$EngineVersion]

$buildArgs = @('build', (Join-Path $root 'QcExtractor.csproj'), '-c', 'Release', '-f', $tf)
if ($RevitApiDir) { $buildArgs += "-p:RevitApiDir$EngineVersion=$RevitApiDir" }

Write-Host "==> Build QcExtractor (Release, $tf, Revit $EngineVersion)"
dotnet @buildArgs
if ($LASTEXITCODE -ne 0) { throw "Build echoue (Revit $EngineVersion / $tf)" }

$binDir = Join-Path $root "bin\Release\$tf"
$outDir = Join-Path $root "output"
$stageDir = Join-Path $outDir $EngineVersion
$bundleDir = Join-Path $stageDir "QcExtractor.bundle"
$contentsDir = Join-Path $bundleDir "Contents"

if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
New-Item -ItemType Directory -Force $contentsDir | Out-Null

# DLLs embarquees : l'addin + le bridge DA + Newtonsoft (RevitAPI.dll est fournie par le moteur)
Copy-Item (Join-Path $binDir "QcExtractor.dll") $contentsDir
Copy-Item (Join-Path $binDir "DesignAutomationBridge.dll") $contentsDir
Copy-Item (Join-Path $binDir "Newtonsoft.Json.dll") $contentsDir
Copy-Item (Join-Path $root "QcExtractor.addin") $contentsDir
Copy-Item (Join-Path $root "PackageContents.$EngineVersion.xml") (Join-Path $bundleDir "PackageContents.xml")

$zipPath = Join-Path $outDir "QcExtractor$EngineVersion.bundle.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path $bundleDir -DestinationPath $zipPath -Force

Write-Host "==> Bundle pret: $zipPath"
Get-ChildItem -Recurse $bundleDir | Select-Object FullName
