<#
  Builds TapNtradeServerSetup.exe. Runs on Windows (the CI job in
  .github/workflows/store-server-windows.yml, or a developer's PC) with
  Node 20+, npm and Inno Setup 6 (iscc.exe) installed.

    pwsh packaging/windows/build.ps1 -FrontendDir ..\POS-Frontend

  Downloads are pinned in versions.json. Each has a sha256; the build stops
  if a download does not match, so a tampered mirror cannot slip into a
  shop's PC. A blank sha256 prints the actual value to pin and stops too.
#>
param(
  [Parameter(Mandatory = $true)][string]$FrontendDir,
  [string]$Version = (Get-Content (Join-Path $PSScriptRoot '..\..\package.json') | ConvertFrom-Json).version
)
$ErrorActionPreference = 'Stop'
$backend = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$stage = Join-Path $PSScriptRoot 'stage'
$cache = Join-Path $PSScriptRoot '.cache'
$pins = Get-Content (Join-Path $PSScriptRoot 'versions.json') | ConvertFrom-Json

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage, $cache | Out-Null

function Get-Pinned($name) {
  $pin = $pins.$name
  $file = Join-Path $cache (Split-Path $pin.url -Leaf)
  if (-not (Test-Path $file)) { Invoke-WebRequest -Uri $pin.url -OutFile $file -UseBasicParsing }
  $actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  if (-not $pin.sha256) { throw "Pin $name in versions.json: sha256 = $actual" }
  if ($actual -ne $pin.sha256.ToLower()) { throw "$name does not match its pinned sha256 (got $actual)" }
  return $file
}

# $ErrorActionPreference does not cover native programs: a failed npm just
# sets $LASTEXITCODE and the script carries on. Every npm call goes through
# here so the first failure stops the build with its name on it.
function Invoke-Checked([string]$what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

function Expand-Into($zip, $target, $innerFolder) {
  $tmp = Join-Path $cache ([guid]::NewGuid())
  Expand-Archive -Path $zip -DestinationPath $tmp
  $source = if ($innerFolder) { Get-ChildItem $tmp -Directory | Where-Object Name -like $innerFolder | Select-Object -First 1 } else { Get-Item $tmp }
  Move-Item $source.FullName $target
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host '==> Node runtime'
Expand-Into (Get-Pinned 'node') (Join-Path $stage 'node') 'node-*-win-x64'

Write-Host '==> PostgreSQL binaries'
Expand-Into (Get-Pinned 'postgres') (Join-Path $stage 'pgsql') 'pgsql'

Write-Host '==> WinSW and the VC++ runtime'
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'winsw') | Out-Null
Copy-Item (Get-Pinned 'winsw') (Join-Path $stage 'winsw\TapNtradeServer.exe')
Copy-Item (Join-Path $PSScriptRoot 'TapNtradeServer.xml') (Join-Path $stage 'winsw\TapNtradeServer.xml')
Copy-Item (Get-Pinned 'vcredist') (Join-Path $stage 'vc_redist.x64.exe')

Write-Host '==> Backend'
Push-Location $backend
Invoke-Checked 'Backend install' { npm ci --no-audit --no-fund }
Invoke-Checked 'Backend build' { npm run build }
Pop-Location
$app = Join-Path $stage 'app'
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item -Recurse (Join-Path $backend 'dist') (Join-Path $app 'dist')
Copy-Item (Join-Path $backend 'package.json'), (Join-Path $backend 'package-lock.json') $app
Push-Location $app
Invoke-Checked 'Backend runtime packages' { npm ci --omit=dev --ignore-scripts --no-audit --no-fund }
Pop-Location

Write-Host '==> Web app (store build)'
Push-Location $FrontendDir
# POS-Frontend keeps no package-lock.json in git, only a bun.lockb from its
# Lovable days that no longer lists every dependency. Without a lock to
# follow, npm resolves from package.json, as Vercel does for the cloud copy.
if (Test-Path 'package-lock.json') {
  Invoke-Checked 'Frontend install' { npm ci --no-audit --no-fund }
} else {
  Invoke-Checked 'Frontend install' { npm install --no-audit --no-fund }
}
Invoke-Checked 'Frontend store build' { npm run build:store }
Pop-Location
Copy-Item -Recurse (Join-Path $FrontendDir 'dist-store') (Join-Path $stage 'web')

Write-Host '==> Scripts'
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'scripts') | Out-Null
Copy-Item (Join-Path $PSScriptRoot '*.ps1') (Join-Path $stage 'scripts') -Exclude 'build.ps1'

Write-Host '==> Installer'
$iscc = (Get-Command iscc.exe -ErrorAction SilentlyContinue)?.Source
if (-not $iscc) { $iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" }
& $iscc "/DAppVersion=$Version" (Join-Path $PSScriptRoot 'TapNtradeServer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed' }

$exe = Join-Path $PSScriptRoot 'out\TapNtradeServerSetup.exe'
if ($env:SIGN_CERT_PFX_BASE64) {
  Write-Host '==> Signing'
  $pfx = Join-Path $cache 'sign.pfx'
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:SIGN_CERT_PFX_BASE64))
  & signtool.exe sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f $pfx /p $env:SIGN_CERT_PASSWORD $exe
  $signed = $LASTEXITCODE
  Remove-Item $pfx -Force
  if ($signed -ne 0) { throw "Signing failed (exit code $signed)" }
} else {
  Write-Warning 'Not signed: Windows SmartScreen will warn when it is run. Set SIGN_CERT_PFX_BASE64 to sign.'
}
Write-Host "Built $exe"
