# build-bundle.ps1
# Compile l'addin QcExtractor (Revit 2024) et produit le zip AppBundle pour Design Automation.
# Sortie : output/QcExtractor.bundle.zip (structure: QcExtractor.bundle/PackageContents.xml + Contents/*.dll)
#
# Usage :  pwsh ./build-bundle.ps1  [-RevitApiDir "C:\Program Files\Autodesk\Revit 2024"]

param(
    [string]$RevitApiDir = "C:\Program Files\Autodesk\Revit 2024"
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host "==> Build QcExtractor (Release, net48, RevitApiDir=$RevitApiDir)"
dotnet build "$root\QcExtractor.csproj" -c Release -p:RevitApiDir="$RevitApiDir"
if ($LASTEXITCODE -ne 0) { throw "Build echoue" }

$binDir = Join-Path $root "bin\Release"
$outDir = Join-Path $root "output"
$bundleDir = Join-Path $outDir "QcExtractor.bundle"
$contentsDir = Join-Path $bundleDir "Contents"

if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
New-Item -ItemType Directory -Force $contentsDir | Out-Null

# DLLs embarquees : l'addin + le bridge DA + Newtonsoft (RevitAPI.dll est fournie par le moteur)
Copy-Item (Join-Path $binDir "QcExtractor.dll") $contentsDir
Copy-Item (Join-Path $binDir "DesignAutomationBridge.dll") $contentsDir
Copy-Item (Join-Path $binDir "Newtonsoft.Json.dll") $contentsDir
Copy-Item (Join-Path $root "QcExtractor.addin") $contentsDir
Copy-Item (Join-Path $root "PackageContents.xml") $bundleDir

$zipPath = Join-Path $outDir "QcExtractor.bundle.zip"
Compress-Archive -Path $bundleDir -DestinationPath $zipPath -Force

Write-Host "==> Bundle pret: $zipPath"
Get-ChildItem -Recurse $bundleDir | Select-Object FullName
