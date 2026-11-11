<#
  Turns off QZ Tray's "Allow" prompt for a shop's offline site.

  Run as Administrator on the shop PC, from the folder TapNtrade prepared for
  this store. Two files must sit beside this script:
    qz-signing.env   this store's signing key and certificate (secret)
    override.crt     TapNtrade's root certificate for QZ Tray (public)

  What it does, each part only if it applies to this PC:
    1. Store server: adds the two QZ_SIGNING_ lines to
       C:\ProgramData\TapNtrade\config\server.env (the old file is kept as
       server.env.before-qz) and restarts the TapNtrade server.
    2. Printing station: copies override.crt into the QZ Tray folder.

  Safe to run again: the lines are replaced, never duplicated. On a PC that
  only prints (no store server), part 1 is skipped.
#>
param(
  [string]$DataDir = "$env:ProgramData\TapNtrade",
  [string]$QzDir = "$env:ProgramFiles\QZ Tray"
)

$ErrorActionPreference = 'Stop'
function Step($text) { Write-Host "==> $text" }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this as Administrator: right-click PowerShell and choose "Run as administrator".' }

$signing = Join-Path $PSScriptRoot 'qz-signing.env'
$root = Join-Path $PSScriptRoot 'override.crt'
$envFile = Join-Path $DataDir 'config\server.env'

if (-not (Test-Path $signing)) { throw "qz-signing.env is not next to this script ($PSScriptRoot)." }
if (-not (Test-Path $root)) { throw "override.crt is not next to this script ($PSScriptRoot)." }

$lines = @(Get-Content -Path $signing | Where-Object { $_ -match '^QZ_SIGNING_(KEY|CERT)=.+' })
if ($lines.Count -ne 2) { throw 'qz-signing.env must hold exactly one QZ_SIGNING_KEY line and one QZ_SIGNING_CERT line.' }

# ---------------------------------------------------------- store server
if (Test-Path $envFile) {
  Step 'Adding the signing key to the store server'
  Copy-Item -Path $envFile -Destination "$envFile.before-qz" -Force
  $kept = @(Get-Content -Path $envFile | Where-Object { $_ -notmatch '^QZ_SIGNING_(KEY|CERT)=' })
  # ascii, as setup.ps1 writes it: a byte-order mark would break the first line.
  ($kept + $lines) | Set-Content -Path $envFile -Encoding ascii

  Step 'Restarting the TapNtrade server'
  Restart-Service -Name TapNtradeServer
} else {
  Write-Warning "No store server on this PC ($envFile was not found). Skipping the server part."
}

# ------------------------------------------------------ printing station
if (Test-Path $QzDir) {
  Step 'Giving QZ Tray the TapNtrade root certificate'
  Copy-Item -Path $root -Destination (Join-Path $QzDir 'override.crt') -Force
  Write-Host ''
  Write-Host 'Now quit QZ Tray from its tray icon and open it again from the Start menu,'
  Write-Host 'so it reads the certificate.'
} else {
  Write-Warning "QZ Tray was not found in $QzDir. Install QZ Tray 2.1 or newer, then run this again."
}

Write-Host ''
Write-Host 'Done. In the POS open Settings > Printer and press Test print.'
Write-Host 'The slip should print with no QZ Tray dialog.'
