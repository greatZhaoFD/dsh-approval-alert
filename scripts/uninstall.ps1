#requires -Version 5.1
<#
  dsh-approval-alert — local uninstaller.

  Removes the copied package from the DSH Desktop profile and strips the
  marker-delimited mount block that scripts/install.ps1 appended.
  Restart DSH afterwards.
#>
[CmdletBinding()]
param(
  [string]$PluginName = 'dsh-approval-alert',
  [string]$ProfileName = 'desktop'
)

$ErrorActionPreference = 'Stop'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$ProfileName"
$dest = Join-Path $profileDir "node_modules\$PluginName"
$patchFile = Join-Path $profileDir 'cordis.patch.yml'

if (-not (Test-Path -LiteralPath $profileDir)) { throw "DSH profile not found: $profileDir" }

if (Test-Path -LiteralPath $dest) {
  Write-Host "==> removing $dest"
  Remove-Item -LiteralPath $dest -Recurse -Force
} else {
  Write-Host "==> package directory already absent: $dest"
}

if (Test-Path -LiteralPath $patchFile) {
  $beginMarker = "# >>> $PluginName (managed by scripts/install.ps1)"
  $endMarker = "# <<< $PluginName"
  $patchText = Get-Content -LiteralPath $patchFile -Raw -Encoding UTF8
  if ($patchText.Contains($beginMarker)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$patchFile.bak-$PluginName-remove-$stamp"
    Copy-Item -LiteralPath $patchFile -Destination $backup -Force
    Write-Host "==> backup: $backup"
    $escapedBegin = [regex]::Escape($beginMarker)
    $escapedEnd = [regex]::Escape($endMarker)
    $pattern = "(?s)\r?\n?$escapedBegin.*?$escapedEnd\r?\n?"
    $next = [regex]::Replace($patchText, $pattern, "`n")
    Set-Content -LiteralPath $patchFile -Value $next -Encoding UTF8 -NoNewline
    Write-Host "==> removed mount block from cordis.patch.yml"
  } else {
    Write-Host "==> mount block not found (installed through the Plugin Manager? disable it there instead)"
  }
}

Write-Host ''
Write-Host 'Done. Fully quit and restart DSH Desktop for the removal to take effect.'
