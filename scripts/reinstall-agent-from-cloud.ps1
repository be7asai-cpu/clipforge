# Reinstall ClipForge PC Agent from cloud ZIP
$ErrorActionPreference = "Stop"

$base = "https://clipforge-45ti.onrender.com"
if ($env:CLIPFORGE_CLOUD_URL) { $base = $env:CLIPFORGE_CLOUD_URL.TrimEnd("/") }

$agentDir = Join-Path $env:LOCALAPPDATA "ClipForge-Agent"
$tokenFile = Join-Path $agentDir "data\auth\pc-agent.token"

Write-Host "=== ClipForge reinstall from cloud ==="
Write-Host "Cloud: $base"
Write-Host "Dir:   $agentDir"

if (-not (Test-Path -LiteralPath $tokenFile)) {
  Write-Host "[BLAD] Brak tokenu. Zaloguj sie na stronie i kliknij PC (pobierz agenta raz)."
  exit 2
}
$token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host "[BLAD] Pusty token"
  exit 2
}

foreach ($p in @(
  (Join-Path $env:ProgramFiles "nodejs"),
  (Join-Path ${env:ProgramFiles(x86)} "nodejs")
)) {
  $nodeExe = Join-Path $p "node.exe"
  if (Test-Path -LiteralPath $nodeExe) {
    $env:Path = $p + ";" + $env:Path
  }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[BLAD] Brak Node.js - https://nodejs.org"
  exit 2
}
Write-Host ("Node: " + (node -v))

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -like "*pc-agent.js*") } |
  ForEach-Object {
    Write-Host ("Stop pid " + $_.ProcessId)
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 1

# DeOldify weights/venv live in ClipForge-Agent-data (sibling of the agent dir) and are not deleted.
# Also keep a manual tools\DeOldify or tools\venv_deoldify if one was installed inside the agent folder.
$dataRoot = Join-Path $env:LOCALAPPDATA "ClipForge-Agent-data"
Write-Host ("Zachowane (poza folderem agenta): " + $dataRoot)

$stash = Join-Path $env:TEMP ("cf-keep-deoldify-" + [guid]::NewGuid().ToString("n"))
$stashed = @()
foreach ($rel in @("tools\DeOldify", "tools\venv_deoldify")) {
  $src = Join-Path $agentDir $rel
  if (Test-Path -LiteralPath $src) {
    New-Item -ItemType Directory -Path $stash -Force | Out-Null
    $leaf = Split-Path -Leaf $src
    Write-Host ("Zachowuje " + $src)
    Move-Item -LiteralPath $src -Destination (Join-Path $stash $leaf) -Force
    $stashed += $leaf
  }
}

# wipe code, keep data
if (Test-Path -LiteralPath $agentDir) {
  Get-ChildItem -LiteralPath $agentDir -Force | Where-Object { $_.Name -ne "data" } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}
$authDir = Join-Path $agentDir "data\auth"
New-Item -ItemType Directory -Path $authDir -Force | Out-Null
[IO.File]::WriteAllText($tokenFile, $token)

$zip = Join-Path $env:TEMP "clipforge-agent-reinstall.zip"
$uri = $base + "/api/studio/pc-agent-bundle.zip?token=" + [uri]::EscapeDataString($token)
Write-Host "Download ZIP..."
Invoke-WebRequest -Uri $uri -OutFile $zip -UseBasicParsing -TimeoutSec 180
$zipLen = (Get-Item -LiteralPath $zip).Length
Write-Host ("ZIP bytes: " + $zipLen)
if ($zipLen -lt 1000) { throw "ZIP too small" }

$head = [IO.File]::ReadAllBytes($zip)[0]
if ($head -eq 0x3C) { throw "Server returned HTML not ZIP (auth/token?)" }

$tmp = Join-Path $env:TEMP ("cf-unpack-" + [guid]::NewGuid().ToString("n"))
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
Write-Host "Expand ZIP..."
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force

$srcRoot = $null
if (Test-Path -LiteralPath (Join-Path $tmp "package.json")) {
  $srcRoot = $tmp
} else {
  $sub = Get-ChildItem -LiteralPath $tmp -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($sub -and (Test-Path -LiteralPath (Join-Path $sub.FullName "package.json"))) {
    $srcRoot = $sub.FullName
  }
}
if (-not $srcRoot) {
  Write-Host "Contents of unpack dir:"
  Get-ChildItem -LiteralPath $tmp -Recurse | ForEach-Object { Write-Host $_.FullName }
  throw "Cannot find package.json in ZIP"
}

$agentJs = Join-Path $srcRoot "scripts\pc-agent.js"
if (-not (Test-Path -LiteralPath $agentJs)) {
  throw "Cloud ZIP missing scripts/pc-agent.js"
}
Write-Host ("Source root: " + $srcRoot)

foreach ($name in @("package.json", "package-lock.json", "lib", "scripts")) {
  $s = Join-Path $srcRoot $name
  $d = Join-Path $agentDir $name
  if (Test-Path -LiteralPath $s) {
    if (Test-Path -LiteralPath $d) {
      Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -LiteralPath $s -Destination $d -Recurse -Force
    Write-Host ("Copied " + $name)
  }
}
$setupBat = Join-Path $srcRoot "SETUP-DEOLDIFY.bat"
if (Test-Path -LiteralPath $setupBat) {
  Copy-Item -LiteralPath $setupBat -Destination (Join-Path $agentDir "SETUP-DEOLDIFY.bat") -Force
}
$setupBat2 = Join-Path $srcRoot "scripts\SETUP-DEOLDIFY.bat"
if (Test-Path -LiteralPath $setupBat2) {
  Copy-Item -LiteralPath $setupBat2 -Destination (Join-Path $agentDir "SETUP-DEOLDIFY.bat") -Force
}
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
[IO.File]::WriteAllText($tokenFile, $token)

if ($stashed.Count -gt 0) {
  $toolsDest = Join-Path $agentDir "tools"
  New-Item -ItemType Directory -Path $toolsDest -Force | Out-Null
  foreach ($leaf in $stashed) {
    $from = Join-Path $stash $leaf
    $dest = Join-Path $toolsDest $leaf
    if (Test-Path -LiteralPath $from) {
      if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue }
      Move-Item -LiteralPath $from -Destination $dest -Force
      Write-Host ("Przywrocono " + $dest)
    }
  }
  Remove-Item -LiteralPath $stash -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "npm install (may take a few minutes)..."
Push-Location $agentDir
try {
  npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw ("npm install failed: " + $LASTEXITCODE) }
} finally {
  Pop-Location
}

$ff = Join-Path $agentDir "node_modules\ffmpeg-static\ffmpeg.exe"
if (-not (Test-Path -LiteralPath $ff)) { throw "ffmpeg-static missing" }
Write-Host ("FFmpeg OK: " + $ff)

$deoldify = Join-Path $agentDir "scripts\setup-deoldify.ps1"
if (Test-Path -LiteralPath $deoldify) {
  Write-Host "DeOldify setup (idempotent, moze pobrac ~874 MB wag)..."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $deoldify
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[OSTRZEZENIE] DeOldify setup nieudany. Agent i tak startuje. Odpal SETUP-DEOLDIFY.bat. Log: $env:TEMP\clipforge-deoldify-setup.log"
  } else {
    Write-Host "DeOldify setup OK"
  }
} else {
  Write-Host "[OSTRZEZENIE] Brak scripts\setup-deoldify.ps1 w paczce z chmury."
}

$batPath = Join-Path $agentDir "RUN-AGENT.bat"
$bat = @"
@echo off
chcp 65001 >nul
title ClipForge PC Agent - NIE ZAMYKAJ
cd /d "%LOCALAPPDATA%\ClipForge-Agent"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
set CLIPFORGE_CLOUD_URL=https://clipforge-45ti.onrender.com
set /p CLIPFORGE_AGENT_TOKEN=<data\auth\pc-agent.token
set CLIPFORGE_PC_LABEL=Moj PC
if exist "data\deoldify.env.cmd" call "data\deoldify.env.cmd"
echo Cloud: %CLIPFORGE_CLOUD_URL%
echo.
node scripts\pc-agent.js
echo EXIT %ERRORLEVEL%
pause
"@
[IO.File]::WriteAllText($batPath, $bat)

Write-Host "Starting agent..."
Start-Process -FilePath $batPath
Start-Sleep -Seconds 5

$headers = @{
  Authorization = "Bearer $token"
  "Content-Type" = "application/json"
}
try {
  $h = Invoke-WebRequest -Uri ($base + "/api/studio/agent/heartbeat") -Method POST -Headers $headers -Body '{"label":"Moj PC"}' -UseBasicParsing -TimeoutSec 60
  Write-Host ("Heartbeat: " + $h.Content)
} catch {
  Write-Host ("Heartbeat: " + $_.Exception.Message)
}

$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -like "*pc-agent.js*") }
if ($running) {
  Write-Host ("AGENT RUNNING pid=" + $running[0].ProcessId)
} else {
  Write-Host "WARNING: agent process not seen yet - check the new window"
}

Write-Host ""
Write-Host "OK. Leave the agent window open. On website: PC ON."
Write-Host ("Folder: " + $agentDir)
Write-Host ("Later:  " + $batPath)
