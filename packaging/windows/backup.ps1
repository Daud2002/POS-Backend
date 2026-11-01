<#
  Nightly backup of the store server's database: a pg_dump custom-format file
  in C:\ProgramData\TapNtrade\backups, keeping the newest 14. Runs at 05:30
  (before the 06:00 order-number cutover) and at boot when the last backup is
  more than a day old, since a shop PC is often off overnight.
  The cloud holds a second copy of everything that has synced.
#>
param(
  [string]$InstallDir = "$env:ProgramFiles\TapNtrade Server",
  [string]$DataDir = "$env:ProgramData\TapNtrade",
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$backups = Join-Path $DataDir 'backups'
$latest = Get-ChildItem $backups -Filter '*.dump' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Force -and $latest -and $latest.LastWriteTime -gt (Get-Date).AddHours(-20)) { return }

$config = @{}
Get-Content (Join-Path $DataDir 'config\server.env') | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $config[$Matches[1]] = $Matches[2] }
}
$env:PGPASSWORD = $config.DATABASE_PASSWORD
$target = Join-Path $backups ("tapntrade-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
& (Join-Path $InstallDir 'pgsql\bin\pg_dump.exe') -h 127.0.0.1 -p $config.DATABASE_PORT -U $config.DATABASE_USER `
  -Fc -f $target $config.DATABASE_NAME
Remove-Item Env:\PGPASSWORD

Get-ChildItem $backups -Filter '*.dump' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item -Force
