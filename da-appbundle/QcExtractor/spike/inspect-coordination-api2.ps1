# SPIKE (branche spike/qc-coordination-review, NON destinée au merge)
# Deuxième passe ciblée : cherche tout état "review/out-of-date/alert" et dump la
# surface exacte de RevitLinkType/RevitLinkInstance + signatures des méthodes de
# monitoring sur Element. Lecture PURE des métadonnées, aucun assembly chargé.
#
# Usage : pwsh ./inspect-coordination-api2.ps1 -DllPath "C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll"
param([string]$DllPath)

$bytes = [System.IO.File]::OpenRead($DllPath)
$pe = [System.Reflection.PortableExecutable.PEReader]::new($bytes)
$md = [System.Reflection.Metadata.PEReaderExtensions]::GetMetadataReader($pe)

$kw = 'Review|OutOfDate|NeedsRefresh|Stale|Obsolete|PendingChange|CoordinationReview|MonitorAlert'

Write-Output ("=== " + $DllPath + " ===")

Write-Output "--- TYPES Autodesk.Revit.DB* dont le nom matche Review/OutOfDate/Stale/... ---"
foreach ($h in $md.TypeDefinitions) {
  $t = $md.GetTypeDefinition($h)
  $ns = $md.GetString($t.Namespace)
  $name = $md.GetString($t.Name)
  if ($ns -like 'Autodesk.Revit*' -and $name -match $kw) { Write-Output ("  $ns.$name") }
}

Write-Output "--- MEMBRES (methodes/proprietes) dont le nom matche Review/OutOfDate/Stale/... ---"
foreach ($h in $md.TypeDefinitions) {
  $t = $md.GetTypeDefinition($h)
  $ns = $md.GetString($t.Namespace)
  $name = $md.GetString($t.Name)
  $full = if ($ns) { "$ns.$name" } else { $name }
  $hits = @()
  foreach ($mh in $t.GetMethods()) {
    $mn = $md.GetString($md.GetMethodDefinition($mh).Name)
    if ($mn -match $kw) { $hits += $mn }
  }
  foreach ($ph in $t.GetProperties()) {
    $pn = $md.GetString($md.GetPropertyDefinition($ph).Name)
    if ($pn -match $kw) { $hits += $pn }
  }
  if ($hits.Count) { Write-Output ("  $full :: " + (($hits | Sort-Object -Unique) -join ', ')) }
}

function Dump-Type($targetFullName) {
  foreach ($h in $md.TypeDefinitions) {
    $t = $md.GetTypeDefinition($h)
    $ns = $md.GetString($t.Namespace)
    $name = $md.GetString($t.Name)
    if ("$ns.$name" -ne $targetFullName) { continue }
    Write-Output ("--- MEMBRES PUBLICS de $targetFullName ---")
    $methods = @()
    foreach ($mh in $t.GetMethods()) {
      $m = $md.GetMethodDefinition($mh)
      if ($m.Attributes -band [System.Reflection.MethodAttributes]::Public) {
        $methods += $md.GetString($m.Name)
      }
    }
    Write-Output ("  methodes: " + (($methods | Sort-Object -Unique) -join ', '))
    $props = @()
    foreach ($ph in $t.GetProperties()) { $props += $md.GetString($md.GetPropertyDefinition($ph).Name) }
    if ($props.Count) { Write-Output ("  proprietes: " + (($props | Sort-Object -Unique) -join ', ')) }
  }
}

Dump-Type 'Autodesk.Revit.DB.RevitLinkType'
Dump-Type 'Autodesk.Revit.DB.RevitLinkInstance'

$pe.Dispose(); $bytes.Dispose()
