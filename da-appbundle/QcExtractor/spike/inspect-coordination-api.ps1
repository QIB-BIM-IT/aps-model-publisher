# SPIKE (branche spike/qc-coordination-review, NON destinée au merge)
# Recense la surface d'API Copy/Monitor & Coordination Review dans RevitAPI.dll
# par LECTURE PURE des métadonnées (System.Reflection.Metadata) : aucun assembly
# n'est chargé, aucun code Revit n'est exécuté. Sert de preuve d'API vérifiée
# contre les DLLs réelles 2024 et 2025.
#
# Usage : pwsh ./inspect-coordination-api.ps1 -DllPath "C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll"
param([string]$DllPath)

$bytes = [System.IO.File]::OpenRead($DllPath)
$pe = [System.Reflection.PortableExecutable.PEReader]::new($bytes)
$md = [System.Reflection.Metadata.PEReaderExtensions]::GetMetadataReader($pe)

$kwType = 'Monitor|Coordinat|CopyMonitor'
$kwMember = 'Monitor|Coordinat'

Write-Output ("=== " + $DllPath + " ===")

Write-Output "--- TYPES (nom matche Monitor/Coordinat) ---"
foreach ($h in $md.TypeDefinitions) {
  $t = $md.GetTypeDefinition($h)
  $ns = $md.GetString($t.Namespace)
  $name = $md.GetString($t.Name)
  $full = if ($ns) { "$ns.$name" } else { $name }
  if ($name -match $kwType) {
    $kind = if ($t.Attributes -band [System.Reflection.TypeAttributes]::Interface) { 'interface' } else { 'class/enum/struct' }
    Write-Output ("  [$kind] $full")
  }
}

Write-Output "--- METHODES (nom matche Monitor/Coordinat) ---"
foreach ($h in $md.TypeDefinitions) {
  $t = $md.GetTypeDefinition($h)
  $ns = $md.GetString($t.Namespace)
  $name = $md.GetString($t.Name)
  $full = if ($ns) { "$ns.$name" } else { $name }
  $hits = @()
  foreach ($mh in $t.GetMethods()) {
    $m = $md.GetMethodDefinition($mh)
    $mn = $md.GetString($m.Name)
    if ($mn -match $kwMember) {
      $vis = if ($m.Attributes -band [System.Reflection.MethodAttributes]::Public) { 'pub' } else { 'nonpub' }
      $hits += "$mn($vis)"
    }
  }
  if ($hits.Count) { Write-Output ("  $full :: " + ($hits -join ', ')) }
}

Write-Output "--- PROPRIETES (nom matche Monitor/Coordinat) ---"
foreach ($h in $md.TypeDefinitions) {
  $t = $md.GetTypeDefinition($h)
  $ns = $md.GetString($t.Namespace)
  $name = $md.GetString($t.Name)
  $full = if ($ns) { "$ns.$name" } else { $name }
  $hits = @()
  foreach ($ph in $t.GetProperties()) {
    $p = $md.GetPropertyDefinition($ph)
    $pn = $md.GetString($p.Name)
    if ($pn -match $kwMember) { $hits += $pn }
  }
  if ($hits.Count) { Write-Output ("  $full :: " + ($hits -join ', ')) }
}

$pe.Dispose(); $bytes.Dispose()
