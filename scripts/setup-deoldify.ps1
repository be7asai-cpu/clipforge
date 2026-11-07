# ClipForge DeOldify setup (setup11). ASCII-only for Windows PowerShell 5.1.
# Idempotent: each step is skipped when its artifact is already good.
# Install root survives agent reinstall: %LOCALAPPDATA%\ClipForge-Agent-data\deoldify
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$script:Commit = '5f86c28923799036ad4b1bf7af8c629ac65efd75'
$script:WeightsUrl = 'https://data.deepai.org/deoldify/ColorizeVideo_gen.pth'
$script:WeightsBytes = [int64]874066230
$script:ResnetUrl = 'https://download.pytorch.org/models/resnet101-63fe2227.pth'
$script:ResnetBytes = [int64]178793939
$script:ResnetName = 'resnet101-63fe2227.pth'
$log = Join-Path $env:TEMP 'clipforge-deoldify-setup.log'

function L([string]$m) {
  $t = (Get-Date).ToString('s') + ' ' + $m
  Add-Content -Path $log -Value $t
  Write-Host $t
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Invoke-Native {
  param([string]$Exe, [string[]]$ArgList)
  L ('> ' + $Exe + ' ' + ($ArgList -join ' '))
  $stdout = Join-Path $env:TEMP ('cf-native-' + [guid]::NewGuid().ToString('n').Substring(0, 8) + '.log')
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $Exe @ArgList > $stdout 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if (Test-Path -LiteralPath $stdout) {
    Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue | ForEach-Object { L ([string]$_) }
    Remove-Item -LiteralPath $stdout -Force -ErrorAction SilentlyContinue
  }
  if ($code -ne 0) {
    throw ('Command failed (' + $code + '): ' + $Exe)
  }
}

function Get-RobustFile {
  param(
    [string]$Url,
    [string]$Dest,
    [int64]$MinBytes = 10000
  )
  function Ok-File([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) { return $false }
    try { return ((Get-Item -LiteralPath $p).Length -ge $MinBytes) } catch { return $false }
  }
  $node = $null
  foreach ($c in @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
    (Join-Path $env:SystemDrive 'nodejs\node.exe')
  )) {
    if ($c -and (Test-Path -LiteralPath $c)) { $node = $c; break }
  }
  if (-not $node) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { $node = $cmd.Source }
  }
  if ($node) {
    $nodeDl = @'
const https = require("https");
const http = require("http");
const fs = require("fs");
const { URL } = require("url");
const dest = process.argv[2];
const url = process.argv[3];
function get(u, redirects) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(u);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { "User-Agent": "ClipForge-DeOldify/setup11", Accept: "*/*", Connection: "close" },
      timeout: 1800000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, u).href, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("HTTP " + res.statusCode));
      }
      const total = parseInt(res.headers["content-length"] || "0", 10) || 0;
      const f = fs.createWriteStream(dest);
      let got = 0;
      let last = 0;
      res.on("data", (c) => {
        got += c.length;
        if (total > 0 && got - last > total * 0.1) {
          last = got;
          process.stdout.write("  DL " + Math.round((100 * got) / total) + "%\n");
        }
      });
      res.pipe(f);
      f.on("finish", () => f.close(() => resolve(dest)));
      f.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}
get(url, 8).then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
'@
    $nd = Join-Path $env:TEMP ('cf-deoldify-dl-' + [guid]::NewGuid().ToString('n').Substring(0, 8) + '.js')
    Write-Utf8NoBom $nd $nodeDl
    for ($ni = 1; $ni -le 3; $ni++) {
      try {
        if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
        L ("Pobieram przez Node (proba $ni/3)...")
        $old = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $node $nd $Dest $Url
        $nc = $LASTEXITCODE
        $ErrorActionPreference = $old
        if ($nc -eq 0 -and (Ok-File $Dest)) {
          Remove-Item -LiteralPath $nd -Force -ErrorAction SilentlyContinue
          L ('Pobrano Node: ' + (Get-Item -LiteralPath $Dest).Length + ' B')
          return $true
        }
        L ('Node download exit=' + $nc)
      } catch { L ('Node download fail: ' + $_) }
      Start-Sleep -Seconds (2 * $ni)
    }
    Remove-Item -LiteralPath $nd -Force -ErrorAction SilentlyContinue
  }
  try {
    if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
    L 'Pobieram curl...'
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & curl.exe -L --fail --ssl-no-revoke --http1.1 --retry 2 --retry-all-errors --connect-timeout 30 --max-time 1800 -o $Dest $Url
    $cc = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($cc -eq 0 -and (Ok-File $Dest)) { L 'Pobrano curl'; return $true }
    L ('curl exit=' + $cc)
  } catch { L ('curl fail: ' + $_) }
  try {
    if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
    L 'Pobieram Invoke-WebRequest...'
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec 1800
    if (Ok-File $Dest) { L 'Pobrano IWR'; return $true }
  } catch { L ('IWR fail: ' + $_) }
  return $false
}

function Get-PyVersion([string]$exe) {
  if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { return $null }
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $exe -c "import sys; print('%d.%d.%d' % sys.version_info[:3])" 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($code -ne 0) { return $null }
  $line = $out | Where-Object { "$_" -match '^\d+\.\d+\.\d+$' } | Select-Object -Last 1
  if (-not $line) { return $null }
  return "$line".Trim()
}

function Find-Python310 {
  $pyCmd = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($pyCmd) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & py.exe -3.10 -c "import sys; print(sys.executable)" 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($code -eq 0) {
      $exePath = ($out | Where-Object { Test-Path -LiteralPath "$_" } | Select-Object -Last 1)
      if ($exePath) {
        $vv = Get-PyVersion "$exePath"
        if ($vv -and $vv.StartsWith('3.10.')) { return "$exePath" }
      }
    }
  }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'ClipForge-Agent-data\python310\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python310\python.exe'),
    (Join-Path $env:ProgramFiles 'Python310\python.exe')
  )
  foreach ($p in $candidates) {
    $vv = Get-PyVersion $p
    if ($vv -and $vv.StartsWith('3.10.')) { return $p }
  }
  return $null
}

function Install-Python310 {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($winget) {
    L 'winget install Python.Python.3.10 (user scope)'
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & winget.exe install --id Python.Python.3.10 -e --scope user --accept-package-agreements --accept-source-agreements
    $ErrorActionPreference = $old
    $found = Find-Python310
    if ($found) { return $found }
    L 'winget nie zostawil dzialajacego Python 3.10'
  } else {
    L 'winget niedostepny'
  }
  $ver = '3.10.11'
  $url = 'https://www.python.org/ftp/python/' + $ver + '/python-' + $ver + '-amd64.exe'
  $exe = Join-Path $env:TEMP ('python-' + $ver + '-amd64.exe')
  L ('Pobieram instalator Python ' + $ver)
  if (-not (Get-RobustFile -Url $url -Dest $exe -MinBytes 15000000)) {
    L 'Pobieranie instalatora Python nieudane.'
    return $null
  }
  $target = Join-Path $env:LOCALAPPDATA 'ClipForge-Agent-data\python310'
  $parent = Split-Path -Parent $target
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  L ('Instaluje Python 3.10 do ' + $target)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = '/quiet InstallAllUsers=0 PrependPath=0 Include_test=0 Include_pip=1 Include_launcher=1 Shortcuts=0 TargetDir="' + $target + '"'
  $psi.UseShellExecute = $true
  $proc = [Diagnostics.Process]::Start($psi)
  $proc.WaitForExit()
  L ('Python installer exit=' + $proc.ExitCode)
  $py = Join-Path $target 'python.exe'
  $vv = Get-PyVersion $py
  if ($vv -and $vv.StartsWith('3.10.')) { return $py }
  return (Find-Python310)
}

function Test-NvidiaGpu {
  $smi = $null
  $cmd = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  if ($cmd) { $smi = $cmd.Source }
  if (-not $smi) {
    foreach ($g in @(
      'C:\Windows\System32\nvidia-smi.exe',
      'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe'
    )) {
      if (Test-Path -LiteralPath $g) { $smi = $g; break }
    }
  }
  if ($smi) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $smi -L
    $code = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($code -eq 0) { return $true }
  }
  try {
    $gpus = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue
    foreach ($g in $gpus) {
      if ($g.Name -and ($g.Name -match 'NVIDIA')) {
        L ('NVIDIA w menedzerze urzadzen (' + $g.Name + ') ale nvidia-smi nie dziala  -  torch CPU')
        return $false
      }
    }
  } catch {}
  return $false
}

function Install-Torch([string]$variant) {
  if ($variant -eq 'cu113') {
    $torch = 'https://download.pytorch.org/whl/cu113/torch-1.11.0+cu113-cp310-cp310-win_amd64.whl'
    $tv = 'https://download.pytorch.org/whl/cu113/torchvision-0.12.0+cu113-cp310-cp310-win_amd64.whl'
  } else {
    $torch = 'https://download.pytorch.org/whl/cpu/torch-1.11.0+cpu-cp310-cp310-win_amd64.whl'
    $tv = 'https://download.pytorch.org/whl/cpu/torchvision-0.12.0+cpu-cp310-cp310-win_amd64.whl'
  }
  L ('pip torch/torchvision ' + $variant + ' (Python 3.10 win_amd64)')
  Invoke-Native $script:VenvPy @('-m', 'pip', 'install', '--upgrade', 'pip==23.3.2', 'setuptools==65.7.0', 'wheel==0.38.4')
  Invoke-Native $script:VenvPy @('-m', 'pip', 'install', $torch, $tv)
}

function Install-PyDeps {
  L 'pip fastai==1.0.60 (no-deps) + Pillow==9.3.0 + pozostale piny'
  Invoke-Native $script:VenvPy @(
    '-m', 'pip', 'install',
    'numpy==1.23.5',
    'Pillow==9.3.0',
    'opencv-python==4.6.0.66',
    'matplotlib==3.6.3',
    'scipy==1.9.3',
    'pandas==1.5.3',
    'requests==2.28.2',
    'pyyaml==6.0.1',
    'packaging==21.3',
    'fastprogress==1.0.3',
    'tensorboardX==2.5.1',
    'ffmpeg-python==0.2.0',
    'yt-dlp==2023.11.16',
    'ipython==8.10.0'
  )
  Invoke-Native $script:VenvPy @('-m', 'pip', 'install', '--no-deps', 'fastai==1.0.60')
  Invoke-Native $script:VenvPy @('-m', 'pip', 'install', 'numpy==1.23.5', 'Pillow==9.3.0')
}

function Test-Deps {
  $pyFile = Join-Path $env:TEMP 'cf-deoldify-deps-check.py'
  $src = @"
import matplotlib
matplotlib.use("Agg")
import torch, torchvision, fastai, PIL, cv2, IPython, ffmpeg, yt_dlp, pandas, scipy, yaml, fastprogress
from fastai.vision import models
print("DEPS_OK " + torch.__version__)
"@
  Write-Utf8NoBom $pyFile $src
  $stdout = Join-Path $env:TEMP 'cf-deoldify-deps.log'
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $script:VenvPy $pyFile > $stdout 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  $text = ''
  if (Test-Path -LiteralPath $stdout) {
    $text = [IO.File]::ReadAllText($stdout)
    Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue | ForEach-Object { L ('deps: ' + $_) }
  }
  if ($code -ne 0) { return $false }
  return ($text -match 'DEPS_OK')
}

function Get-TorchVariant {
  $pyFile = Join-Path $env:TEMP 'cf-deoldify-torch-ver.py'
  Write-Utf8NoBom $pyFile "import torch`nprint(torch.__version__)`n"
  $stdout = Join-Path $env:TEMP 'cf-deoldify-torch-ver.log'
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $script:VenvPy $pyFile > $stdout 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if ($code -ne 0 -or -not (Test-Path -LiteralPath $stdout)) { return $null }
  $text = [IO.File]::ReadAllText($stdout)
  if ($text -match '\+cu113') { return 'cu113' }
  if ($text -match '\+cpu') { return 'cpu' }
  return $null
}

function Copy-DeoldifyTree([string]$From, [string]$To) {
  New-Item -ItemType Directory -Path $To -Force | Out-Null
  Get-ChildItem -LiteralPath $From -Force | ForEach-Object {
    if ($_.Name -eq 'venv' -or $_.Name -eq '.git') { return }
    $dest = Join-Path $To $_.Name
    if ($_.Name -eq 'models' -and $_.PSIsContainer) {
      New-Item -ItemType Directory -Path $dest -Force | Out-Null
      Get-ChildItem -LiteralPath $_.FullName -Force | ForEach-Object {
        if ($_.Extension -eq '.pth') { return }
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dest $_.Name) -Recurse -Force
      }
      return
    }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
  }
}

function Ensure-Source {
  $marker = Join-Path $script:Root '.clipforge-commit'
  $vis = Join-Path $script:Root 'deoldify\visualize.py'
  if ((Test-Path -LiteralPath $vis) -and (Test-Path -LiteralPath $marker) -and -not $Force) {
    $have = (Get-Content -LiteralPath $marker -Raw).Trim()
    if ($have -eq $script:Commit) {
      L ('DeOldify source OK - skip ' + $script:Commit)
      return
    }
  }
  $stageParent = Join-Path $env:TEMP ('deoldify-src-' + [guid]::NewGuid().ToString('n').Substring(0, 8))
  New-Item -ItemType Directory -Path $stageParent -Force | Out-Null
  $stage = Join-Path $stageParent 'src'
  $got = $false
  $gitCmd = Get-Command git -ErrorAction SilentlyContinue
  if ($gitCmd) {
    L ('DeOldify: git clone pinned ' + $script:Commit)
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & git clone --depth 1 'https://github.com/jantic/DeOldify.git' $stage
    $cloneCode = $LASTEXITCODE
    if ($cloneCode -eq 0) {
      $head = ((& git -C $stage rev-parse HEAD) | Out-String).Trim()
      if ($head -eq $script:Commit -and (Test-Path -LiteralPath (Join-Path $stage 'deoldify\visualize.py'))) {
        $got = $true
      } else {
        & git -C $stage fetch --depth 1 origin $script:Commit
        & git -C $stage checkout --detach $script:Commit
        $co = $LASTEXITCODE
        if ($co -eq 0 -and (Test-Path -LiteralPath (Join-Path $stage 'deoldify\visualize.py'))) { $got = $true }
      }
    }
    $ErrorActionPreference = $old
    if (-not $got) { L 'git clone/checkout nieudany  -  pobieram ZIP commita' }
  } else {
    L 'git brak  -  pobieram ZIP DeOldify'
  }
  if (-not $got) {
    $zip = Join-Path $env:TEMP 'deoldify-pinned.zip'
    $url = 'https://github.com/jantic/DeOldify/archive/' + $script:Commit + '.zip'
    if (-not (Get-RobustFile -Url $url -Dest $zip -MinBytes 200000)) {
      throw 'Nie udalo sie pobrac zrodel DeOldify (git niedostepny i ZIP nieudany).'
    }
    $unz = Join-Path $stageParent 'unz'
    New-Item -ItemType Directory -Path $unz -Force | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $unz -Force
    $inner = Get-ChildItem -LiteralPath $unz -Directory | Select-Object -First 1
    if (-not $inner) { throw 'ZIP DeOldify nie zawiera katalogu' }
    $stage = $inner.FullName
  }
  if (-not (Test-Path -LiteralPath (Join-Path $stage 'deoldify\visualize.py'))) {
    throw 'Pobrane zrodla DeOldify nie zawieraja deoldify/visualize.py'
  }
  Copy-DeoldifyTree $stage $script:Root
  Set-Content -LiteralPath $marker -Value $script:Commit -Encoding ascii
  L ('DeOldify source zapisane: ' + $script:Commit)
  Remove-Item -LiteralPath $stageParent -Recurse -Force -ErrorAction SilentlyContinue
}

function Move-VerifiedFile([string]$Partial, [string]$Final, [int64]$Expected) {
  if (-not (Test-Path -LiteralPath $Partial)) { throw ('Brak pliku tymczasowego: ' + $Partial) }
  $len = [int64](Get-Item -LiteralPath $Partial).Length
  if ($len -ne $Expected) {
    Remove-Item -LiteralPath $Partial -Force -ErrorAction SilentlyContinue
    throw ('Zly rozmiar ' + $Partial + ': ' + $len + ' B, oczekiwano ' + $Expected)
  }
  if (Test-Path -LiteralPath $Final) {
    $bak = $Final + '.bak'
    [IO.File]::Replace($Partial, $Final, $bak)
    if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue }
  } else {
    [IO.File]::Move($Partial, $Final)
  }
  $finalLen = [int64](Get-Item -LiteralPath $Final).Length
  if ($finalLen -ne $Expected) { throw ('Po zapisie rozmiar sie nie zgadza: ' + $finalLen) }
}

function Ensure-Weights {
  $models = Join-Path $script:Root 'models'
  New-Item -ItemType Directory -Path $models -Force | Out-Null
  $final = Join-Path $models 'ColorizeVideo_gen.pth'
  if ((Test-Path -LiteralPath $final) -and -not $Force) {
    $len = [int64](Get-Item -LiteralPath $final).Length
    if ($len -eq $script:WeightsBytes) {
      L ('Wagi OK - skip ' + $len + ' B')
      return
    }
    L ('Wagi maja zly rozmiar (' + $len + ')  -  pobieram ponownie')
  }
  $partial = $final + '.partial'
  $legacy = @(
    (Join-Path $env:LOCALAPPDATA 'ClipForge-Agent\tools\DeOldify\models\ColorizeVideo_gen.pth')
  )
  if ($env:DEOLDIFY_DIR) {
    $legacy += (Join-Path $env:DEOLDIFY_DIR 'models\ColorizeVideo_gen.pth')
  }
  foreach ($leg in $legacy) {
    if (-not $leg -or -not (Test-Path -LiteralPath $leg)) { continue }
    $fullLeg = [IO.Path]::GetFullPath($leg)
    $fullFinal = [IO.Path]::GetFullPath($final)
    if ($fullLeg -eq $fullFinal) { continue }
    $len = [int64](Get-Item -LiteralPath $leg).Length
    if ($len -eq $script:WeightsBytes) {
      L ('Kopiuje istniejace wagi: ' + $leg)
      Copy-Item -LiteralPath $leg -Destination $partial -Force
      Move-VerifiedFile $partial $final $script:WeightsBytes
      L 'Wagi skopiowane i sprawdzone'
      return
    }
  }
  L ('Pobieram ColorizeVideo_gen.pth (' + $script:WeightsBytes + ' B)...')
  if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue }
  if (-not (Get-RobustFile -Url $script:WeightsUrl -Dest $partial -MinBytes $script:WeightsBytes)) {
    throw 'Pobieranie wag DeOldify nieudane (https://data.deepai.org/deoldify/ColorizeVideo_gen.pth).'
  }
  Move-VerifiedFile $partial $final $script:WeightsBytes
  L 'Wagi zapisane (rozmiar 874066230 sprawdzony, podmiana atomowa)'
}

function Ensure-Resnet {
  $cache = Join-Path $env:USERPROFILE '.cache\torch\hub\checkpoints'
  if ($env:TORCH_HOME) {
    $cache = Join-Path $env:TORCH_HOME 'hub\checkpoints'
  }
  New-Item -ItemType Directory -Path $cache -Force | Out-Null
  $final = Join-Path $cache $script:ResnetName
  if ((Test-Path -LiteralPath $final) -and ((Get-Item -LiteralPath $final).Length -eq $script:ResnetBytes)) {
    L 'ResNet101 backbone OK - skip'
    return
  }
  $partial = $final + '.partial'
  L 'Pobieram backbone ResNet101 (torchvision 0.12, pierwszy import DeOldify go wymaga)...'
  if (-not (Get-RobustFile -Url $script:ResnetUrl -Dest $partial -MinBytes $script:ResnetBytes)) {
    throw 'Nie udalo sie pobrac resnet101-63fe2227.pth (bez tego koloryzacja nie wstanie).'
  }
  Move-VerifiedFile $partial $final $script:ResnetBytes
  L 'ResNet101 zapisany w cache torch hub'
}

function Invoke-Smoke {
  $smoke = Join-Path $PSScriptRoot 'remaster\deoldify_smoke.py'
  if (-not (Test-Path -LiteralPath $smoke)) {
    throw ('Brak ' + $smoke + '  -  paczka agenta nie zawiera scripts/remaster/deoldify_smoke.py. Pobierz swiezy pc-setup.cmd.')
  }
  L 'Smoke test: import + jedna klatka...'
  $stdout = Join-Path $env:TEMP 'cf-deoldify-smoke.log'
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $script:VenvPy $smoke $script:Root > $stdout 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  if (Test-Path -LiteralPath $stdout) {
    Get-Content -LiteralPath $stdout -ErrorAction SilentlyContinue | ForEach-Object { L ('smoke: ' + $_) }
  }
  if ($code -eq 0) { L 'Smoke OK'; return $true }
  L ('Smoke exit=' + $code)
  return $false
}

function Test-SmokeSkipped([string]$variant) {
  $okFile = Join-Path $script:Root '.clipforge-ok.json'
  $weights = Join-Path $script:Root 'models\ColorizeVideo_gen.pth'
  if (-not (Test-Path -LiteralPath $okFile)) { return $false }
  if (-not (Test-Path -LiteralPath $weights)) { return $false }
  if ([int64](Get-Item -LiteralPath $weights).Length -ne $script:WeightsBytes) { return $false }
  try {
    $j = Get-Content -LiteralPath $okFile -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch { return $false }
  if ($j.commit -ne $script:Commit) { return $false }
  if ($j.torch -ne $variant) { return $false }
  if ([int64]$j.weightsBytes -ne $script:WeightsBytes) { return $false }
  if ($j.smoke -ne 'ok') { return $false }
  if (-not (Test-Deps)) { return $false }
  return $true
}

function Save-Ok([string]$variant) {
  $obj = @{
    commit = $script:Commit
    torch = $variant
    weightsBytes = 874066230
    smoke = 'ok'
  }
  Write-Utf8NoBom (Join-Path $script:Root '.clipforge-ok.json') ($obj | ConvertTo-Json)
}

function Save-Config([string]$py, [string]$variant) {
  $agentDir = Join-Path $env:LOCALAPPDATA 'ClipForge-Agent'
  $cfgDir = Join-Path $agentDir 'data'
  New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
  $cfgPath = Join-Path $cfgDir 'agent-config.json'
  $obj = New-Object PSObject
  if (Test-Path -LiteralPath $cfgPath) {
    try { $obj = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $obj = New-Object PSObject }
  }
  $fields = @{
    DEOLDIFY_DIR = $script:Root
    DEOLDIFY_PYTHON = $py
    deoldifyCommit = $script:Commit
    deoldifyTorch = $variant
    deoldifyWeightsBytes = 874066230
  }
  foreach ($k in $fields.Keys) {
    $obj | Add-Member -NotePropertyName $k -NotePropertyValue $fields[$k] -Force
  }
  $json = $obj | ConvertTo-Json
  Write-Utf8NoBom $cfgPath $json
  Write-Utf8NoBom (Join-Path $script:Root 'install.json') $json
  $envBody = "set `"DEOLDIFY_DIR=$($script:Root)`"`r`nset `"DEOLDIFY_PYTHON=$py`"`r`n"
  Write-Utf8NoBom (Join-Path $cfgDir 'deoldify.env.cmd') $envBody
  try {
    [Environment]::SetEnvironmentVariable('DEOLDIFY_DIR', $script:Root, 'User')
    [Environment]::SetEnvironmentVariable('DEOLDIFY_PYTHON', $py, 'User')
  } catch {
    L ('Nie udalo sie zapisac user env (konto bez uprawnien?): ' + $_)
  }
  $env:DEOLDIFY_DIR = $script:Root
  $env:DEOLDIFY_PYTHON = $py
  $batSrc = Join-Path $agentDir 'scripts\SETUP-DEOLDIFY.bat'
  $batDst = Join-Path $agentDir 'SETUP-DEOLDIFY.bat'
  if (Test-Path -LiteralPath $batSrc) {
    Copy-Item -LiteralPath $batSrc -Destination $batDst -Force
  }
  L ('Zapisano DEOLDIFY_DIR i DEOLDIFY_PYTHON (user env + ' + $cfgPath + ')')
}

try {
  L '=== ClipForge DeOldify setup11 ==='
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'DeOldify wymaga 64-bit Windows. Ten system jest 32-bit  -  instalacja Python/torch win_amd64 jest niemozliwa.'
  }
  $script:Root = Join-Path $env:LOCALAPPDATA 'ClipForge-Agent-data\deoldify'
  $script:Venv = Join-Path $script:Root 'venv'
  $script:VenvPy = Join-Path $script:Venv 'Scripts\python.exe'
  New-Item -ItemType Directory -Path $script:Root -Force | Out-Null
  L ('Katalog (przezywa reinstalacje agenta): ' + $script:Root)

  $basePy = Find-Python310
  if ($basePy) { L ('Python 3.10 juz jest - skip install: ' + $basePy) }
  else {
    L 'Brak Python 3.10  -  py launcher, potem winget, potem python.org'
    $basePy = Install-Python310
  }
  if (-not $basePy) {
    throw @'
Nie udalo sie zainstalowac Python 3.10.
Sposoby ktore sprawdzilem: py -3.10, winget (Python.Python.3.10), instalator
https://www.python.org/ftp/python/3.10.11/python-3.10.11-amd64.exe
Pobierz ten instalator recznie (Windows x86-64), zainstaluj i uruchom SETUP-DEOLDIFY.bat ponownie.
'@
  }
  L ('Python 3.10: ' + $basePy + ' (' + (Get-PyVersion $basePy) + ')')

  $venvOk = $false
  if ((Test-Path -LiteralPath $script:VenvPy) -and -not $Force) {
    $vv = Get-PyVersion $script:VenvPy
    if ($vv -and $vv.StartsWith('3.10.')) { $venvOk = $true; L ('venv OK - skip ' + $script:VenvPy) }
  }
  if (-not $venvOk) {
    if (Test-Path -LiteralPath $script:Venv) { Remove-Item -LiteralPath $script:Venv -Recurse -Force }
    L ('Tworze venv: ' + $script:Venv)
    Invoke-Native $basePy @('-m', 'venv', $script:Venv)
    if (-not (Test-Path -LiteralPath $script:VenvPy)) { throw ('venv bez python.exe: ' + $script:VenvPy) }
  }

  Ensure-Source

  $wantCuda = Test-NvidiaGpu
  $variant = 'cpu'
  if ($wantCuda) { $variant = 'cu113'; L 'NVIDIA GPU (nvidia-smi)  -  kola CUDA 11.3' }
  else { L 'Brak dzialajacego nvidia-smi  -  kola CPU' }

  $installedVariant = $null
  if (-not $Force) {
    if (Test-Deps) { $installedVariant = Get-TorchVariant }
  }
  if ($installedVariant -and $installedVariant -eq $variant) {
    L ('zaleznosci OK - skip (' + $variant + ')')
  } else {
    $installed = $false
    if ($wantCuda) {
      try {
        Install-Torch 'cu113'
        Install-PyDeps
        $installed = Test-Deps
        if (-not $installed) { throw 'import po CUDA wheels nieudany' }
        $variant = 'cu113'
      } catch {
        L ('CUDA wheels nieudane (' + $_ + ')  -  instaluje torch CPU')
        Install-Torch 'cpu'
        Install-PyDeps
        $variant = 'cpu'
        $installed = Test-Deps
      }
    } else {
      Install-Torch 'cpu'
      Install-PyDeps
      $variant = 'cpu'
      $installed = Test-Deps
    }
    if (-not $installed) {
      throw 'Import torch/fastai/deoldify deps nie powiodl sie. Szczegoly wyzej w tym logu.'
    }
  }

  Ensure-Weights
  Ensure-Resnet

  if ((Test-SmokeSkipped $variant) -and -not $Force) {
    L 'Smoke test juz zaliczony - skip'
  } else {
    if (-not (Invoke-Smoke)) {
      if ($variant -eq 'cu113') {
        L 'Smoke na CUDA nieudany  -  przeinstalowuje torch CPU i powtarzam test'
        Install-Torch 'cpu'
        Install-PyDeps
        $variant = 'cpu'
        if (-not (Test-Deps)) { throw 'Po przejsciu na CPU import nadal pada.' }
        if (-not (Invoke-Smoke)) { throw 'Smoke test DeOldify nieudany takze na CPU. Zobacz log.' }
      } else {
        throw 'Smoke test DeOldify nieudany. Zobacz log (import / inference).'
      }
    }
    Save-Ok $variant
  }

  Save-Config $script:VenvPy $variant
  L 'DeOldify gotowe.'
  L ('DEOLDIFY_DIR=' + $script:Root)
  L ('DEOLDIFY_PYTHON=' + $script:VenvPy)
  L ('torch=' + $variant)
  exit 0
} catch {
  L ('[BLAD] ' + $_)
  if ($_.ScriptStackTrace) { L $_.ScriptStackTrace }
  Write-Host ''
  Write-Host '===== DEOLDIFY SETUP FAILED ====='
  Write-Host ('Log: ' + $log)
  Write-Host 'Odpal ponownie: %LOCALAPPDATA%\ClipForge-Agent\SETUP-DEOLDIFY.bat'
  Write-Host '================================='
  exit 1
}
