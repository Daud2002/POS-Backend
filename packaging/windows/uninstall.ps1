<#
  Removes the TapNtrade services, firewall rule and backup task. The data
  folder (database, keys, backups) is kept unless -RemoveData is given, so
  reinstalling brings the shop back exactly as it was.
#>
param(
  [string]$InstallDir = "$env:ProgramFiles\TapNtrade Server",
  [string]$DataDir = "$env:ProgramData\TapNtrade",
  [switch]$RemoveData
)
$ErrorActionPreference = 'Continue'
$winsw = Join-Path $InstallDir 'winsw\TapNtradeServer.exe'
if (Get-Service TapNtradeServer -ErrorAction SilentlyContinue) { & $winsw stop; & $winsw uninstall }
if (Get-Service TapNtradeDB -ErrorAction SilentlyContinue) {
  Stop-Service TapNtradeDB -Force
  & (Join-Path $InstallDir 'pgsql\bin\pg_ctl.exe') unregister -N TapNtradeDB
}
Get-NetFirewallRule -DisplayName 'TapNtrade Server' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Unregister-ScheduledTask -TaskName 'TapNtrade backup' -Confirm:$false -ErrorAction SilentlyContinue
if ($RemoveData) { Remove-Item -Recurse -Force $DataDir }
