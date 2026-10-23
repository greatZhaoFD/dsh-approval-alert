#requires -Version 5.1
<#
  dsh-approval-alert — local installer.

  Copies this project into the DSH Desktop profile's node_modules and appends an
  idempotent, marker-delimited mount block to the profile's cordis.patch.yml.
  This is the equivalent of installing the package as a local bundle when the
  in-app Plugin Manager is not used.

  Requires write access to ~/.dsh; the caller must approve that once.
  Re-running replaces the copied package and keeps a single mount block.
#>
[CmdletBinding()]
param(
  [string]$PluginName = 'dsh-approval-alert',
  [string]$ProfileName = 'desktop',
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$ProfileName"
$dest = Join-Path $profileDir "node_modules\$PluginName"
$patchFile = Join-Path $profileDir 'cordis.patch.yml'

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'package.json'))) { throw "not a plugin project: $projectRoot" }
if (-not (Test-Path -LiteralPath $profileDir)) { throw "DSH profile not found: $profileDir (is DSH installed and has it started once?)" }
if (-not (Test-Path -LiteralPath $patchFile)) { throw "profile patch file not found: $patchFile" }

Write-Host "==> installing $PluginName"
Write-Host "    source : $projectRoot"
Write-Host "    target : $dest"

if (Test-Path -LiteralPath $dest) {
  Write-Host "==> removing previous copy"
  Remove-Item -LiteralPath $dest -Recurse -Force
}
New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
Copy-Item -LiteralPath $projectRoot -Destination $dest -Recurse -Force
Remove-Item -LiteralPath (Join-Path $dest 'node_modules') -Recurse -Force -ErrorAction SilentlyContinue

$beginMarker = "# >>> $PluginName (managed by scripts/install.ps1)"
$endMarker = "# <<< $PluginName"
$patchText = Get-Content -LiteralPath $patchFile -Raw -Encoding UTF8
if ($patchText.Contains($beginMarker)) {
  Write-Host "==> mount block already present, leaving cordis.patch.yml unchanged"
} else {
  if (-not $NoBackup) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$patchFile.bak-$PluginName-$stamp"
    Copy-Item -LiteralPath $patchFile -Destination $backup -Force
    Write-Host "==> backup: $backup"
  }
  if (-not $patchText.EndsWith("`n")) { $patchText += "`n" }
  $block = @"

$beginMarker
- insert:
    - id: approval-alert
      name: '$PluginName'
$endMarker
"@
  Set-Content -LiteralPath $patchFile -Value ($patchText + $block) -Encoding UTF8 -NoNewline
  Write-Host "==> appended mount entry to cordis.patch.yml"
}

Write-Host ''
Write-Host 'Done. Now fully quit and restart DSH Desktop (desktop profile patches are not live-reloaded).'
Write-Host 'Uninstall with: pwsh -File scripts\uninstall.ps1'
