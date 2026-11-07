<#
  TapNtrade store server: first-run and upgrade setup on the shop's Windows PC.
  Run by the installer as Administrator. Safe to run again: every step checks
  what is already there, so an upgrade keeps the database, keys and config.

  What it does:
    1. A local PostgreSQL, listening on 127.0.0.1 only, as service TapNtradeDB.
    2. C:\ProgramData\TapNtrade\config\server.env with generated secrets.
    3. The TapNtrade server as service TapNtradeServer (starts at boot, before anyone logs in).
    4. Trusts the shop's own certificate on this PC, so https://localhost opens cleanly.
    5. Firewall: ports 80 and 443 on Private networks only.
    6. Keeps the PC awake, the clock synced, and a nightly database backup.
#>
param(
  [string]$InstallDir = "$env:ProgramFiles\TapNtrade Server",
  [string]$DataDir = "$env:ProgramData\TapNtrade",
  [string]$CloudUrl = "https://api.tapntrade.store/api",
  [switch]$MakeNetworkPrivate
)

$ErrorActionPreference = 'Stop'
$pg = Join-Path $InstallDir 'pgsql\bin'
$pgData = Join-Path $DataDir 'pgdata'
$configDir = Join-Path $DataDir 'config'
$envFile = Join-Path $configDir 'server.env'
$logs = Join-Path $DataDir 'logs'
$backups = Join-Path $DataDir 'backups'
$pgPort = 54329

function Step($text) { Write-Host "==> $text" }
function New-Secret([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return [Convert]::ToBase64String($buffer).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}
# $ErrorActionPreference does not cover native programs (initdb, pg_ctl,
# psql, WinSW): a failure only sets $LASTEXITCODE. Every one goes through here.
function Invoke-Native([string]$what, [scriptblock]$command) {
  & $command | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

foreach ($dir in @($DataDir, $configDir, $logs, $backups, (Join-Path $DataDir 'keys'))) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
# The installer runs this hidden, so everything it prints goes to a log too.
Start-Transcript -Path (Join-Path $logs 'setup.log') -Append | Out-Null
try {

# Only Administrators and SYSTEM may read the data folder: it holds the
# database, the shop's certificate key and the server's cloud credential.
icacls $DataDir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null

# --------------------------------------------------------------- database
$dbPassword = $null
if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) {
  Step 'Creating the local database'
  # initdb drops administrator rights before it writes anything (PostgreSQL
  # refuses to run with them), so the Administrators grant above no longer
  # covers it. Give the folder to this user and to the database service
  # account (NETWORK SERVICE) directly.
  New-Item -ItemType Directory -Force -Path $pgData | Out-Null
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  icacls $pgData /grant "*${me}:(OI)(CI)F" "*S-1-5-20:(OI)(CI)F" | Out-Null

  $dbPassword = New-Secret 24
  $pwFile = Join-Path $env:TEMP "tnt-pw-$([guid]::NewGuid()).txt"
  Set-Content -Path $pwFile -Value $dbPassword -NoNewline -Encoding ascii
  try {
    Invoke-Native 'Creating the database (initdb)' {
      & "$pg\initdb.exe" -D $pgData -U postgres -E UTF8 --locale=C --auth=scram-sha-256 --pwfile=$pwFile
    }
  } finally {
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
  }
  Add-Content -Path (Join-Path $pgData 'postgresql.conf') -Value @"

# TapNtrade store server
listen_addresses = '127.0.0.1'
port = $pgPort
timezone = 'UTC'
log_timezone = 'UTC'
"@
}

if (-not (Get-Service TapNtradeDB -ErrorAction SilentlyContinue)) {
  Step 'Registering the database service'
  Invoke-Native 'Registering the database service' { & "$pg\pg_ctl.exe" register -N TapNtradeDB -D $pgData -S auto }
  # The service runs as NETWORK SERVICE, which needs the data folder.
  icacls $pgData /grant "*S-1-5-20:(OI)(CI)F" /T | Out-Null
}
Start-Service TapNtradeDB
$ready = $false
for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
  if (Test-Path "$pg\pg_isready.exe") {
    & "$pg\pg_isready.exe" -h 127.0.0.1 -p $pgPort | Out-Null
    $ready = ($LASTEXITCODE -eq 0)
  } else {
    $ready = (Test-NetConnection 127.0.0.1 -Port $pgPort -WarningAction SilentlyContinue).TcpTestSucceeded
  }
  if (-not $ready) { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw "The database service started but is not accepting connections on port $pgPort." }

# ----------------------------------------------------------------- config
if (-not (Test-Path $envFile)) {
  if (-not $dbPassword) { throw "server.env is missing but the database already exists. Restore server.env from a backup." }
  Step 'Writing server.env'
  $env:PGPASSWORD = $dbPassword
  try {
    Invoke-Native 'Creating the tapntrade database' { & "$pg\psql.exe" -h 127.0.0.1 -p $pgPort -U postgres -c "CREATE DATABASE tapntrade" }
  } finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
  @"
DEPLOYMENT_MODE=store
DATABASE_HOST=127.0.0.1
DATABASE_PORT=$pgPort
DATABASE_USER=postgres
DATABASE_PASSWORD=$dbPassword
DATABASE_NAME=tapntrade
JWT_SECRET=$(New-Secret 48)
HTTPS_PORT=443
HTTP_PORT=80
TAPNTRADE_DATA_DIR=$DataDir
WEB_DIST_DIR=$(Join-Path $InstallDir 'web')
CLOUD_API_URL=$CloudUrl
NODE_ENV=production
"@ | Set-Content -Path $envFile -Encoding ascii
}

# ----------------------------------------------------------------- server
$winsw = Join-Path $InstallDir 'winsw\TapNtradeServer.exe'
if (-not (Get-Service TapNtradeServer -ErrorAction SilentlyContinue)) {
  Step 'Registering the TapNtrade server service'
  Invoke-Native 'Registering the server service' { & $winsw install }
}
Step 'Starting the TapNtrade server'
Invoke-Native 'Starting the server service' { & $winsw restart }

# The server writes the shop's certificate authority on its first start.
$caFile = Join-Path $DataDir 'keys\ca.crt'
for ($i = 0; $i -lt 60 -and -not (Test-Path $caFile); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $caFile) {
  Step 'Trusting the shop certificate on this PC'
  Import-Certificate -FilePath $caFile -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
} else {
  throw "The TapNtrade server did not start within a minute. Its logs are in $logs."
}

# --------------------------------------------------------------- network
Step 'Allowing phones on this network to reach the server'
if (-not (Get-NetFirewallRule -DisplayName 'TapNtrade Server' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'TapNtrade Server' -Direction Inbound -Protocol TCP -LocalPort 80, 443 `
    -Action Allow -Profile Private | Out-Null
}
$public = Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' }
if ($public) {
  if ($MakeNetworkPrivate) {
    $public | ForEach-Object { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private }
  } else {
    Write-Warning "This PC's network is set to Public, so phones cannot reach the server. Set it to Private in Settings > Network."
  }
}

# ------------------------------------------------------------ the PC itself
Step 'Keeping the PC awake and its clock right'
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
Set-Service w32time -StartupType Automatic
Start-Service w32time -ErrorAction SilentlyContinue
w32tm /resync /nowait | Out-Null
try { Add-MpPreference -ExclusionPath $pgData } catch { }

Step 'Scheduling the nightly backup (05:30)'
$backup = Join-Path $InstallDir 'scripts\backup.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backup`""
$triggers = @((New-ScheduledTaskTrigger -Daily -At 5:30am), (New-ScheduledTaskTrigger -AtStartup))
Register-ScheduledTask -TaskName 'TapNtrade backup' -Action $action -Trigger $triggers -User 'SYSTEM' `
  -RunLevel Highest -Force | Out-Null

Step 'Done. Open http://localhost/setup to link this PC to your store.'

} catch {
  Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Details are in $(Join-Path $logs 'setup.log')"
  Stop-Transcript | Out-Null
  exit 1
}
Stop-Transcript | Out-Null
exit 0
