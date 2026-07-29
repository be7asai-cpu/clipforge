/**
 * ClipForge Studio — login → studio.
 * Runs locally or on free PaaS (Render/Fly). No public video library.
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const session = require("express-session");

try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch {
  /* dotenv optional */
}

const auth = require("./lib/auth");

const app = express();
const PORT = Number(process.env.PORT) || 3847;
const isProd = process.env.NODE_ENV === "production";
// Free hosts (Render/Railway/Fly) sit behind HTTPS proxy
const behindProxy =
  process.env.TRUST_PROXY === "1" ||
  process.env.TRUST_PROXY === "true" ||
  Boolean(process.env.RENDER) ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.FLY_APP_NAME);

if (behindProxy) {
  app.set("trust proxy", 1);
}

const PUBLIC_DIR = path.join(__dirname, "public");

/** Stop CDN/browser from caching 404s + HTML (fixes "refresh = different page") */
function noStore(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0, private"
  );
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Cloudflare-CDN-Cache-Control", "no-store");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

app.use((req, res, next) => {
  // Default: never cache app responses on free host / Cloudflare edge
  if (behindProxy || isProd) noStore(res);
  next();
});

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const sessionSecret =
  process.env.SESSION_SECRET ||
  process.env.AUTH_SECRET ||
  (isProd ? null : "clipforge-dev-secret-change-me");
if (!sessionSecret) {
  console.warn(
    "[ClipForge] WARNING: set SESSION_SECRET in production env vars"
  );
}

const cookieSecure =
  process.env.COOKIE_SECURE === "1" ||
  process.env.COOKIE_SECURE === "true" ||
  (behindProxy && process.env.COOKIE_SECURE !== "0");

app.use(
  session({
    name: "clipforge.sid",
    secret: sessionSecret || "clipforge-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure,
      maxAge: 14 * 24 * 60 * 60 * 1000,
    },
  })
);

auth.ensureAuthDir();
auth.configurePassport();
app.use(auth.passport.initialize());
app.use(auth.passport.session());
auth.attachAuthRoutes(app);

function isLoggedIn(req) {
  return Boolean(
    req.isAuthenticated &&
      req.isAuthenticated() &&
      req.user &&
      auth.isEmailVerified(req.user)
  );
}

// ── Health first (Render probes this) ──────────────────────────────────
app.get("/api/health", (_req, res) => {
  noStore(res);
  res.json({
    ok: true,
    service: "clipforge",
    studio: true,
    v: "2026-07-29pc-setup2",
  });
});

function sendPublic(res, relPath) {
  noStore(res);
  const full = path.join(PUBLIC_DIR, relPath);
  if (!fs.existsSync(full)) {
    return res.status(404).type("text").send("Missing: " + relPath);
  }
  return res.sendFile(full);
}

// ── Entry: always the same login page (no flip-flop) ───────────────────
app.get(["/", "/index.html", "/login.html"], (req, res) => {
  if (isLoggedIn(req)) return res.redirect(302, "/studio.html");
  return sendPublic(res, "login.html");
});

app.get(["/studio", "/studio.html"], (req, res) => {
  if (!isLoggedIn(req)) {
    noStore(res);
    return res.redirect(
      302,
      "/login.html?next=" + encodeURIComponent("/studio.html")
    );
  }
  return sendPublic(res, "studio.html");
});

// Old portal URLs → login
app.get(
  ["/second-life.html", "/portal", "/portal.html", "/clips", "/clips.html"],
  (_req, res) => {
    noStore(res);
    res.redirect(302, "/login.html");
  }
);

// Explicit public assets (avoid static 404 cache races on free tier)
app.get(
  [
    "/css/:file",
    "/js/:file",
    "/assets/:file",
    "/manifest.webmanifest",
    "/oauth-setup.html",
    "/clear-cache.html",
  ],
  (req, res, next) => {
    let rel;
    if (req.params.file) {
      // block path traversal
      const base = path.basename(req.params.file);
      if (req.path.startsWith("/css/")) rel = path.join("css", base);
      else if (req.path.startsWith("/js/")) rel = path.join("js", base);
      else if (req.path.startsWith("/assets/")) rel = path.join("assets", base);
      else return next();
    } else {
      rel = path.basename(req.path);
    }
    const full = path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(full)) return next();
    noStore(res);
    return res.sendFile(full);
  }
);

// Fallback static (other files under public/)
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    etag: false,
    lastModified: false,
    setHeaders(res) {
      noStore(res);
    },
  })
);


// ---------------------------------------------------------------------------
// ClipForge Studio — upload, queue, progress, download
// ---------------------------------------------------------------------------
const multer = require("multer");
const studioJobs = require("./lib/studio-jobs");
// pipeline runs in lib/studio-worker.js (child process)

studioJobs.ensureDirs();
// Pipeline runs in child process (studio-worker.js) — HTTP never blocks
studioJobs.setQueueRunner(null);
// Mark interrupted jobs as retriable — do NOT auto-start a flood of old jobs
studioJobs.resumeInterrupted(0);
// Clear any leftover queued backlog from previous sessions
const cleared = studioJobs.clearQueue(
  "Anulowane przy starcie — stara kolejka. Kliknij «Uruchom ponownie» przy wybranym filmie."
);
if (cleared.length) {
  console.log(`ClipForge: wyczyszczono ${cleared.length} starych jobów z kolejki`);
}

// Graceful shutdown — don't leave zombie workers
function shutdown(sig) {
  console.log(`\nClipForge: stop (${sig})…`);
  try {
    studioJobs.killWorker();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Keep process alive & catch crashes
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});

// Legacy open static outputs DISABLED for multi-user privacy.
// Files are served only via authenticated /api/studio/jobs/:id/{download,preview,srt}.

const studioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    studioJobs.ensureDirs();
    cb(null, studioJobs.UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "video.mp4")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 100);
    cb(null, `${Date.now()}_${safe}`);
  },
});

const studioUpload = multer({
  storage: studioStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Input: common containers FFmpeg handles well. Output is always MP4.
    const ok =
      /video\//i.test(file.mimetype) ||
      /\.(mp4|mov|webm|mkv|avi|m4v|mpeg|mpg|wmv|flv|3gp|ts|mts|m2ts)$/i.test(
        file.originalname || ""
      );
    cb(ok ? null : new Error("Unsupported video format"), ok);
  },
});

// Protect Studio APIs when auth is required (health stays public for start scripts)
// PC agent routes use Bearer token auth (not browser session)
app.use("/api/studio", (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/health")) return next();
  if (req.path.startsWith("/agent")) return next();
  // PC agent downloads source bundle with Bearer token (no browser session)
  if (req.path === "/pc-agent-bundle.tgz" || req.path.startsWith("/pc-agent-bundle"))
    return next();
  return auth.requireAuthIfEnabled(req, res, next);
});

/** Stable user id for job ownership (login user, or "local" when auth off) */
function studioUserId(req) {
  if (req.user && req.user.id) return String(req.user.id);
  if (!auth.isAuthRequired()) return "local";
  return null;
}

/** Load job only if the current user owns it */
function getOwnedJob(req, res) {
  const job = studioJobs.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return null;
  }
  const uid = studioUserId(req);
  if (uid != null && !studioJobs.ownsJob(job, uid)) {
    res.status(403).json({ error: "Brak dostępu do tego joba" });
    return null;
  }
  return job;
}

const pcAgent = require("./lib/pc-agent-hub");

app.get("/api/studio/health", (req, res) => {
  // Lightweight — never touch pipeline/ffmpeg here (must stay instant)
  // Optional session: if logged in, "busy" = only MY jobs (multi-user safe)
  const uid =
    req.isAuthenticated && req.isAuthenticated() && req.user?.id
      ? String(req.user.id)
      : !auth.isAuthRequired()
        ? "local"
        : null;
  const serverBusy = studioJobs.isServerBusy();
  const myBusy = uid ? studioJobs.isUserBusy(uid) : serverBusy;
  const pc = uid ? pcAgent.statusFor(uid) : { online: false };
  res.json({
    ok: true,
    studio: true,
    busy: myBusy,
    myBusy,
    serverBusy,
    multiUser: true,
    pcAgent: pc,
    uptime: Math.round(process.uptime()),
    pid: process.pid,
  });
});

// ── PC Agent (browser stays on cloud; processing on user's machine) ────
function agentBearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : String(req.body?.token || req.query?.token || "").trim();
}

function requireAgent(req, res) {
  const row = pcAgent.resolveToken(agentBearer(req));
  if (!row) {
    res.status(401).json({ error: "Nieprawidłowy token agenta" });
    return null;
  }
  pcAgent.heartbeat(row.token, row.label);
  return row;
}

/** Login from PC agent → long-lived token (store on disk) */
app.post("/api/studio/agent/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const label = String(req.body?.label || "Mój PC").slice(0, 40);
    if (!email || !password) {
      return res.status(400).json({ error: "Podaj e-mail i hasło" });
    }
    const bcrypt = require("bcryptjs");
    const u = auth.findByEmail(email);
    if (!u || !u.passwordHash) {
      return res.status(401).json({ error: "Złe e-mail lub hasło" });
    }
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: "Złe e-mail lub hasło" });
    const tok = pcAgent.issueToken(u.id, label);
    pcAgent.heartbeat(tok.token, label);
    res.json({
      ok: true,
      token: tok.token,
      userId: u.id,
      label: tok.label,
      cloudUrl: auth.baseUrl(),
    });
  } catch (err) {
    console.error("agent login:", err);
    res.status(500).json({ error: err.message || "Błąd logowania agenta" });
  }
});

/** Browser (logged in) can mint a token without password re-entry */
app.post("/api/studio/agent/token", (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: "Zaloguj się w przeglądarce" });
  }
  // require session auth — this path is under /agent so re-check
  if (auth.isAuthRequired() && !(req.isAuthenticated && req.isAuthenticated())) {
    return res.status(401).json({ error: "Zaloguj się" });
  }
  const label = String(req.body?.label || "Mój PC").slice(0, 40);
  const tok = pcAgent.issueToken(req.user.id, label);
  res.json({ ok: true, token: tok.token, label: tok.label });
});

// Session-auth wrapper for token mint (mounted with manual check above)
// Re-enable session for token route only via separate path under studio with auth
app.post("/api/studio/pc-token", auth.requireAuthIfEnabled, (req, res) => {
  if (!req.user?.id) return res.status(401).json({ error: "Zaloguj się" });
  const label = String(req.body?.label || "Mój PC").slice(0, 40);
  const tok = pcAgent.issueToken(req.user.id, label);
  res.json({
    ok: true,
    token: tok.token,
    label: tok.label,
    cloudUrl: auth.baseUrl() || `${req.protocol}://${req.get("host")}`,
    hint: "Pobierz gotowy plik: /api/studio/pc-setup.cmd",
  });
});

/**
 * Source tarball for PC agent (private GitHub → download from THIS server instead).
 * Auth: agent Bearer token OR logged-in session.
 */
app.get("/api/studio/pc-agent-bundle.tgz", (req, res) => {
  const token =
    agentBearer(req) || String(req.query.token || "").trim();
  const row = token ? pcAgent.resolveToken(token) : null;
  const sessionOk =
    req.isAuthenticated &&
    req.isAuthenticated() &&
    req.user &&
    req.user.id;
  if (!row && !sessionOk) {
    return res.status(401).json({ error: "Zaloguj sie lub podaj token agenta" });
  }

  const { spawn } = require("child_process");
  const root = __dirname;
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="clipforge-agent.tgz"'
  );
  res.setHeader("Cache-Control", "no-store");

  // Portable: package.json + lock + lib + agent script (npm install on PC)
  const args = [
    "-czf",
    "-",
    "package.json",
    "package-lock.json",
    "lib",
    "scripts/pc-agent.js",
  ];
  const child = spawn("tar", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let err = "";
  child.stderr.on("data", (d) => {
    err += d.toString();
  });
  child.on("error", (e) => {
    if (!res.headersSent) {
      res.status(500).json({ error: "tar: " + (e.message || e) });
    }
  });
  child.on("close", (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({
        error: "Nie udalo sie spakowac agenta",
        detail: err.slice(-300),
      });
    }
  });
  child.stdout.pipe(res);
});

/**
 * One-click PC agent — .cmd downloads bundle from cloud (not private GitHub).
 */
function sendPcSetupCmd(req, res) {
  if (!req.user?.id) {
    return res
      .status(401)
      .type("text")
      .send("Zaloguj sie w przegladarce i sprobuj ponownie.");
  }
  const label = String(req.query.label || "Moj PC")
    .slice(0, 40)
    .replace(/[^\w\s.-]/g, "");
  const tok = pcAgent.issueToken(req.user.id, label || "Moj PC");
  const cloud = (
    auth.baseUrl() ||
    process.env.RENDER_EXTERNAL_URL ||
    `${req.protocol}://${req.get("host")}`
  ).replace(/\/$/, "");

  const psQ = (s) => String(s).replace(/'/g, "''");

  const ps1 = `
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'clipforge-agent-setup.log'
function L($m) { $t = (Get-Date).ToString('s') + ' ' + $m; Add-Content -Path $log -Value $t; Write-Host $t }

try {
  L '=== ClipForge PC Agent setup ==='
  $cloud = '${psQ(cloud)}'
  $token = '${psQ(tok.token)}'
  $label = '${psQ(label || "Moj PC")}'
  $agentDir = Join-Path $env:LOCALAPPDATA 'ClipForge-Agent'

  $env:CLIPFORGE_CLOUD_URL = $cloud
  $env:CLIPFORGE_AGENT_TOKEN = $token
  $env:CLIPFORGE_PC_LABEL = $label

  $nodePaths = @(
    (Join-Path $env:ProgramFiles 'nodejs'),
    (Join-Path \${env:ProgramFiles(x86)} 'nodejs'),
    (Join-Path $env:LOCALAPPDATA 'Programs\\node')
  )
  foreach ($p in $nodePaths) {
    if (Test-Path (Join-Path $p 'node.exe')) { $env:Path = "$p;" + $env:Path }
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    L '[BLAD] Brak Node.js. Zainstaluj LTS: https://nodejs.org (Add to PATH).'
    exit 2
  }
  L ("Node: " + (node -v))

  # 1) Prefer existing local project (dev machine)
  $localCandidates = @(
    (Join-Path $env:USERPROFILE 'Projects\\clips-tv'),
    (Join-Path $env:USERPROFILE 'Projects\\clipforge'),
    'C:\\Users\\londy\\Projects\\clips-tv'
  )
  $localSrc = $null
  foreach ($c in $localCandidates) {
    if (Test-Path (Join-Path $c 'scripts\\pc-agent.js')) { $localSrc = $c; break }
  }

  if (-not (Test-Path (Join-Path $agentDir 'package.json'))) {
    $ok = $false

    if ($localSrc) {
      L "Kopiuje lokalny projekt: $localSrc"
      if (Test-Path $agentDir) { Remove-Item $agentDir -Recurse -Force }
      New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
      foreach ($name in @('package.json','package-lock.json','lib','scripts')) {
        $src = Join-Path $localSrc $name
        $dst = Join-Path $agentDir $name
        if (Test-Path $src) {
          if (Test-Path $src -PathType Container) {
            Copy-Item $src $dst -Recurse -Force
          } else {
            Copy-Item $src $dst -Force
          }
        }
      }
      if (Test-Path (Join-Path $agentDir 'scripts\\pc-agent.js')) { $ok = $true }
    }

    if (-not $ok) {
      L 'Pobieram paczke agenta z chmury (nie z prywatnego GitHuba)...'
      $tgz = Join-Path $env:TEMP 'clipforge-agent.tgz'
      $uri = $cloud.TrimEnd('/') + '/api/studio/pc-agent-bundle.tgz'
      $headers = @{ Authorization = "Bearer $token" }
      try {
        Invoke-WebRequest -Uri $uri -Headers $headers -OutFile $tgz -UseBasicParsing
      } catch {
        L ('Pobieranie z chmury nieudane: ' + $_)
        throw 'Nie mozna pobrac kodu agenta. Zdeployuj najnowszy ClipForge na Render i sprobuj ponownie.'
      }
      if (Test-Path $agentDir) { Remove-Item $agentDir -Recurse -Force }
      New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
      tar -xzf $tgz -C $agentDir
      if (-not (Test-Path (Join-Path $agentDir 'package.json'))) {
        throw 'Paczka z chmury jest pusta lub uszkodzona'
      }
      $ok = $true
    }

    if (-not $ok) { throw 'Brak zrodel agenta' }

    L 'npm install (raz, moze potrwac kilka minut)...'
    Push-Location $agentDir
    npm install --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm install failed: $LASTEXITCODE" }
    Pop-Location
  } else {
    L "Folder agenta juz istnieje: $agentDir"
    # Refresh code from local project if available (pipeline fixes)
    if ($localSrc) {
      foreach ($name in @('lib','scripts/pc-agent.js')) {
        $src = Join-Path $localSrc $name
        $dst = Join-Path $agentDir $name
        if (Test-Path $src) {
          if (Test-Path $src -PathType Container) {
            Copy-Item $src $dst -Recurse -Force
          } else {
            $dstDir = Split-Path $dst -Parent
            if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item $src $dst -Force
          }
        }
      }
      L 'Odswiezono lib/ i pc-agent.js z lokalnego projektu'
    }
  }

  # FFmpeg must actually run (npm ffmpeg-static sometimes blocked / broken on Windows)
  function Test-Ffmpeg($bin) {
    if (-not $bin -or -not (Test-Path $bin)) { return $false }
    try { Unblock-File -Path $bin -ErrorAction SilentlyContinue } catch {}
    $p = Start-Process -FilePath $bin -ArgumentList '-version' -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:TEMP 'cf-ff-out.txt') -RedirectStandardError (Join-Path $env:TEMP 'cf-ff-err.txt') -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    return ($p.ExitCode -eq 0)
  }
  $ffBin = Join-Path $agentDir 'node_modules\\ffmpeg-static\\ffmpeg.exe'
  if (-not (Test-Ffmpeg $ffBin)) {
    L 'FFmpeg agenta nie dziala — proboje naprawic...'
    # Prefer known-good binary from local ClipForge install
    $goodCandidates = @()
    if ($localSrc) { $goodCandidates += (Join-Path $localSrc 'node_modules\\ffmpeg-static\\ffmpeg.exe') }
    $goodCandidates += (Join-Path $env:USERPROFILE 'Projects\\clips-tv\\node_modules\\ffmpeg-static\\ffmpeg.exe')
    $fixed = $false
    foreach ($g in $goodCandidates) {
      if (Test-Path $g) {
        $destDir = Split-Path $ffBin -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        Copy-Item $g $ffBin -Force
        try { Unblock-File -Path $ffBin -ErrorAction SilentlyContinue } catch {}
        if (Test-Ffmpeg $ffBin) { L "Skopiowano dzialajacy FFmpeg z: $g"; $fixed = $true; break }
      }
    }
    if (-not $fixed) {
      L 'Proboje ponownie zainstalowac ffmpeg-static...'
      Push-Location $agentDir
      npm install ffmpeg-static@5.3.0 --force
      Pop-Location
      try { Unblock-File -Path $ffBin -ErrorAction SilentlyContinue } catch {}
      $fixed = Test-Ffmpeg $ffBin
    }
    if (-not $fixed) {
      throw 'FFmpeg nie dziala na tym PC (Windows blokuje plik albo uszkodzony binary). Zainstaluj FFmpeg systemowo albo skopiuj dzialajacy ffmpeg.exe do %LOCALAPPDATA%\\ClipForge-Agent\\node_modules\\ffmpeg-static\\'
    }
  } else {
    L 'FFmpeg OK'
  }

  L 'Startuje agent — wroc do strony (PC · ON). Nie zamykaj okna.'
  Set-Location $agentDir
  node .\\scripts\\pc-agent.js
  L ("Agent zakonczyl, kod=" + $LASTEXITCODE)
  exit $LASTEXITCODE
} catch {
  L ('[BLAD] ' + $_)
  if ($_.ScriptStackTrace) { L $_.ScriptStackTrace }
  exit 1
}
`.trim();

  const launcher = [
    "@echo off",
    "chcp 65001 >nul",
    "title ClipForge PC Agent",
    "cd /d \"%~dp0\"",
    "echo.",
    "echo  ========================================",
    "echo   ClipForge PC Agent",
    "echo  ========================================",
    "echo.",
    "echo  Trwa przygotowanie... (log: %TEMP%\\clipforge-agent-setup.log)",
    "echo.",
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$b='${Buffer.from(ps1, "utf8").toString("base64")}'; $p=Join-Path $env:TEMP 'ClipForge-PC-Agent.setup.ps1'; [IO.File]::WriteAllBytes($p,[Convert]::FromBase64String($b)); & $p; exit $LASTEXITCODE"`,
    "set ERR=%ERRORLEVEL%",
    "echo.",
    "if not \"%ERR%\"==\"0\" (",
    "  echo [BLAD] Cos poszlo nie tak. Kod: %ERR%",
    "  echo.",
    "  echo --- log ---",
    "  if exist \"%TEMP%\\clipforge-agent-setup.log\" type \"%TEMP%\\clipforge-agent-setup.log\"",
    "  echo -----------",
    ")",
    "echo.",
    "echo  Wcisnij dowolny klawisz, zeby zamknac to okno...",
    "pause >nul",
    "exit /b %ERR%",
    "",
  ].join("\r\n");

  res.setHeader("Content-Type", "application/octet-stream; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="ClipForge-PC-Agent.cmd"'
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(launcher);
}

// Both URLs (some proxies choke on ".cmd" in path)
app.get("/api/studio/pc-setup", auth.requireAuthIfEnabled, sendPcSetupCmd);
app.get("/api/studio/pc-setup.cmd", auth.requireAuthIfEnabled, sendPcSetupCmd);

app.post("/api/studio/agent/heartbeat", (req, res) => {
  const row = pcAgent.resolveToken(agentBearer(req));
  if (!row) return res.status(401).json({ error: "Zły token" });
  const label = String(req.body?.label || row.label || "PC");
  const st = pcAgent.heartbeat(row.token, label);
  res.json({ ok: true, ...st });
});

app.post("/api/studio/agent/claim", (req, res) => {
  const row = requireAgent(req, res);
  if (!row) return;
  const job = studioJobs.claimPcJob(row.userId);
  if (!job) return res.json({ ok: true, job: null });
  res.json({
    ok: true,
    job: {
      id: job.id,
      originalName: job.originalName,
      options: job.options || {},
      userId: job.userId,
    },
  });
});

app.get("/api/studio/agent/jobs/:id/input", (req, res) => {
  const row = requireAgent(req, res);
  if (!row) return;
  const job = studioJobs.getJob(req.params.id);
  if (!job || !studioJobs.ownsJob(job, row.userId)) {
    return res.status(404).json({ error: "Job not found" });
  }
  if (!job.inputPath || !fs.existsSync(job.inputPath)) {
    return res.status(404).json({ error: "Brak pliku źródłowego" });
  }
  res.download(job.inputPath, job.originalName || "input.mp4");
});

app.post("/api/studio/agent/jobs/:id/progress", (req, res) => {
  const row = requireAgent(req, res);
  if (!row) return;
  const job = studioJobs.getJob(req.params.id);
  if (!job || !studioJobs.ownsJob(job, row.userId)) {
    return res.status(404).json({ error: "Job not found" });
  }
  if (job.executor !== "pc") {
    return res.status(400).json({ error: "To nie jest job PC" });
  }
  const patch = req.body || {};
  const allowed = {};
  if (typeof patch.progress === "number") allowed.progress = patch.progress;
  if (patch.stage) allowed.stage = patch.stage;
  if (patch.log) allowed.log = patch.log;
  if (patch.liveOriginal) allowed.liveOriginal = patch.liveOriginal;
  if (patch.liveScript) allowed.liveScript = patch.liveScript;
  if (patch.livePhase) allowed.livePhase = patch.livePhase;
  studioJobs.updateJob(job.id, allowed);
  res.json({ ok: true });
});

app.post("/api/studio/agent/jobs/:id/fail", (req, res) => {
  const row = requireAgent(req, res);
  if (!row) return;
  const job = studioJobs.getJob(req.params.id);
  if (!job || !studioJobs.ownsJob(job, row.userId)) {
    return res.status(404).json({ error: "Job not found" });
  }
  studioJobs.updateJob(job.id, {
    status: "failed",
    error: String(req.body?.error || "Błąd na PC"),
    stage: "Błąd",
    finishedAt: new Date().toISOString(),
    canRetry: true,
    log: "PC agent: " + String(req.body?.error || "błąd"),
  });
  res.json({ ok: true });
});

app.post(
  "/api/studio/agent/jobs/:id/complete",
  (req, res, next) => {
    // multer for agent upload
    const agentOut = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          studioJobs.ensureDirs();
          cb(null, studioJobs.OUTPUT_DIR);
        },
        filename: (_req, file, cb) => {
          const id = String(_req.params.id || "out");
          if (file.fieldname === "preview") cb(null, `studio_${id}_preview.jpg`);
          else if (file.fieldname === "srt") cb(null, `studio_${id}.srt`);
          else cb(null, `studio_${id}.mp4`);
        },
      }),
      limits: { fileSize: 500 * 1024 * 1024 },
    });
    agentOut.fields([
      { name: "video", maxCount: 1 },
      { name: "preview", maxCount: 1 },
      { name: "srt", maxCount: 1 },
    ])(req, res, next);
  },
  (req, res) => {
    const row = requireAgent(req, res);
    if (!row) return;
    const job = studioJobs.getJob(req.params.id);
    if (!job || !studioJobs.ownsJob(job, row.userId)) {
      return res.status(404).json({ error: "Job not found" });
    }
    const video = req.files?.video?.[0];
    if (!video) return res.status(400).json({ error: "Brak pliku video" });
    let result = {};
    try {
      if (req.body?.result) result = JSON.parse(req.body.result);
    } catch {
      result = {};
    }
    const preview = req.files?.preview?.[0];
    const srt = req.files?.srt?.[0];
    if (srt) result.srtPath = srt.path;
    studioJobs.updateJob(job.id, {
      status: "done",
      progress: 100,
      stage: "Gotowe",
      finishedAt: new Date().toISOString(),
      outputPath: video.path,
      previewPath: preview ? preview.path : job.previewPath,
      result: { ...(job.result || {}), ...result },
      log: "Wynik z Twojego PC zapisany w chmurze (UI bez przekierowania).",
    });
    res.json({ ok: true, job: studioJobs.publicJob(studioJobs.getJob(job.id)) });
  }
);

app.get("/api/studio/languages", (_req, res) => {
  const { listLanguageModels } = require("./lib/lang-utils");
  res.json(listLanguageModels());
});

app.get("/api/studio/jobs", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const uid = studioUserId(req);
  res.json({
    jobs: studioJobs.listJobs(limit, uid).map(studioJobs.publicJob),
  });
});

/** Must be before /jobs/:id so "latest" is not parsed as id */
app.get("/api/studio/jobs/latest/active", (req, res) => {
  const uid = studioUserId(req);
  const all = studioJobs.listJobs(50, uid);
  // Prefer finished complete files over interrupted failures — ONLY this user's
  const active =
    all.find((j) => j.status === "running") ||
    all.find((j) => j.status === "queued") ||
    all.find((j) => j.status === "done") ||
    all.find((j) => j.status === "failed") ||
    null;
  res.json({ job: active ? studioJobs.publicJob(active) : null });
});

app.get("/api/studio/jobs/:id", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  res.json({ job: studioJobs.publicJob(job) });
});

/** Authenticated file download — only owner can fetch */
function sendOwnedFile(req, res, filePath, downloadName) {
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Plik nie istnieje" });
  }
  if (downloadName) {
    return res.download(filePath, downloadName);
  }
  return res.sendFile(path.resolve(filePath));
}

app.get("/api/studio/jobs/:id/download", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  if (job.status !== "done" || !job.outputPath) {
    return res.status(404).json({ error: "Brak gotowego pliku" });
  }
  const name =
    (job.originalName || "clip").replace(/\.[^.]+$/, "") + "_clipforge.mp4";
  sendOwnedFile(req, res, job.outputPath, name);
});

app.get("/api/studio/jobs/:id/preview", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  sendOwnedFile(req, res, job.previewPath);
});

app.get("/api/studio/jobs/:id/srt", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  if (!job.outputPath) {
    return res.status(404).json({ error: "Brak SRT" });
  }
  const srt = job.outputPath.replace(/\.mp4$/i, ".srt");
  sendOwnedFile(req, res, srt, path.basename(srt));
});

app.post("/api/studio/jobs", (req, res) => {
  studioUpload.single("video")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Brak pliku wideo (pole: video)" });
    }
    const uid = studioUserId(req);
    if (auth.isAuthRequired() && !uid) {
      return res.status(401).json({ error: "Wymagane logowanie" });
    }
    let options = {};
    try {
      if (req.body?.options) options = JSON.parse(req.body.options);
    } catch {
      options = {};
    }
    // sensible defaults
    if (options.upscale == null) options.upscale = "fast";
    if (options.targetHeight == null) options.targetHeight = 1080;
    if (options.speedMode == null) options.speedMode = "auto";

    // Ensure pipeline can read filename for auto narrator text
    options.originalName = req.file.originalname;
    options.filename = req.file.originalname;
    if (options.narrator == null) options.narrator = true;
    if (options.autoTranslate == null) options.autoTranslate = true;
    if (!options.targetLang) options.targetLang = "pl";

    const job = studioJobs.createJob({
      originalName: req.file.originalname,
      inputPath: req.file.path,
      options,
      userId: uid || "local",
    });
    studioJobs.enqueuePump();
    res.status(201).json({ job: studioJobs.publicJob(job) });
  });
});

/** Retry / resume failed job — owner only */
app.post("/api/studio/jobs/:id/retry", (req, res) => {
  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const result = studioJobs.retryJob(
    req.params.id,
    patch,
    studioUserId(req)
  );
  if (!result.ok) {
    const code = result.code === "FORBIDDEN" ? 403 : 400;
    return res.status(code).json({ error: result.error });
  }
  res.json({ job: studioJobs.publicJob(result.job) });
});

/** Clear only this user's queued jobs */
app.post("/api/studio/queue/clear", (req, res) => {
  const cancelled = studioJobs.clearQueue(
    "Anulowane — wyczyszczono kolejkę. Uruchom ponownie tylko ten film, który chcesz.",
    studioUserId(req)
  );
  res.json({ ok: true, cancelled: cancelled.length, ids: cancelled });
});

/** Cancel one job (queued or running) — owner only */
app.post("/api/studio/jobs/:id/cancel", (req, res) => {
  const result = studioJobs.cancelJob(req.params.id, studioUserId(req));
  if (!result.ok) {
    const code = result.code === "FORBIDDEN" ? 403 : 400;
    return res.status(code).json({ error: result.error });
  }
  res.json({ ok: true, job: studioJobs.publicJob(result.job) });
});

/**
 * Reset only THIS user's jobs (does not cancel other users).
 * Used by „Nowy proces / Anuluj” button.
 */
app.post("/api/studio/reset", (req, res) => {
  const result = studioJobs.resetStudio(
    "Anulowane — wracasz do startu (nowy proces)",
    studioUserId(req)
  );
  res.json({
    ok: true,
    cancelled: result.cancelled.length,
    ids: result.cancelled,
  });
});

/** Reveal output in Windows Explorer — owner only, local host */
app.post("/api/studio/jobs/:id/reveal", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  if (job.status !== "done" || !job.outputPath) {
    return res.status(404).json({ error: "Brak gotowego pliku" });
  }
  if (!fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: "Plik nie istnieje na dysku" });
  }
  try {
    const { spawn } = require("child_process");
    spawn("explorer", [`/select,${job.outputPath}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    res.json({ ok: true, path: job.outputPath });
  } catch (e) {
    res.status(500).json({ error: e.message || "Nie otwarto Explorera" });
  }
});

/** Open file with default Windows app — owner only */
app.post("/api/studio/jobs/:id/open-native", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  if (job.status !== "done" || !job.outputPath) {
    return res.status(404).json({ error: "Brak gotowego pliku" });
  }
  if (!fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: "Plik nie istnieje na dysku" });
  }
  try {
    const { spawn } = require("child_process");
    spawn("cmd", ["/c", "start", "", job.outputPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Nie otwarto pliku" });
  }
});

/** Windows share sheet (best-effort) — owner only */
app.post("/api/studio/jobs/:id/share-windows", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  if (job.status !== "done" || !job.outputPath) {
    return res.status(404).json({ error: "Brak gotowego pliku" });
  }
  if (!fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: "Plik nie istnieje na dysku" });
  }
  try {
    const { spawn } = require("child_process");
    const ps = `
$p = '${job.outputPath.replace(/'/g, "''")}'
try {
  $f = Get-Item -LiteralPath $p
  if (Get-Command -Name Start-Process -ErrorAction SilentlyContinue) {
    explorer.exe "/select,$p"
  }
} catch {}
`;
    spawn("powershell", ["-NoProfile", "-Command", ps], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    spawn(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Set-Clipboard -Value '${job.outputPath.replace(/'/g, "''")}'`,
      ],
      { windowsHide: true }
    );
    res.json({
      ok: true,
      message:
        "Otworzono folder (plik zaznaczony). Ścieżka skopiowana do schowka — wklej w FacePub / Messenger / Discord.",
      path: job.outputPath,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Share failed" });
  }
});

/** Share payload for UI (URLs, paths, text) — owner only */
app.get("/api/studio/jobs/:id/share", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  const pub = studioJobs.publicJob(job);
  if (job.status !== "done" || !pub.downloadUrl) {
    return res.status(400).json({ error: "Job nie jest gotowy do udostępnienia" });
  }
  const host = req.get("host") || `localhost:${PORT}`;
  const proto = req.protocol || "http";
  const absoluteUrl = `${proto}://${host}${pub.downloadUrl}`;
  const script = job.result?.script || "";
  const title = pub.shareTitle || "FacePub clip";
  res.json({
    ok: true,
    share: {
      title,
      text: script
        ? `${title}\n\n${script}\n\n— FacePub Studio`
        : `${title}\n\n— FacePub Studio`,
      url: absoluteUrl,
      path: pub.absolutePath,
      folder: pub.folderPath,
      downloadUrl: pub.downloadUrl,
      srtUrl: pub.srtUrl,
      previewUrl: pub.previewUrl,
      webShareSupported: true,
    },
  });
});

// Unknown pages → login (not portal)
app.get("*", (req, res) => {
  noStore(res);
  if (req.path.startsWith("/api/") || req.path.startsWith("/local/")) {
    return res.status(404).json({ error: "Not found" });
  }
  // Always same destination — never bare platform 404 for unknown HTML paths
  return sendPublic(res, "login.html");
});

// Local default 127.0.0.1; free PaaS / Docker → 0.0.0.0
const HOST =
  process.env.HOST ||
  (isProd || behindProxy ? "0.0.0.0" : "127.0.0.1");
app.listen(PORT, HOST, () => {
  console.log("");
  console.log("  ClipForge ONLINE  (Studio only — no video hosting library)");
  console.log(`  Studio:  http://127.0.0.1:${PORT}/studio.html`);
  if (process.env.BASE_URL) {
    console.log(`  Public:  ${process.env.BASE_URL}`);
  }
  if (HOST === "0.0.0.0" || HOST === "::") {
    const os = require("os");
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets || {})) {
      for (const n of nets[name] || []) {
        if (n.family === "IPv4" && !n.internal) {
          console.log(`  LAN:     http://${n.address}:${PORT}/studio.html`);
        }
      }
    }
  }
  console.log("  Polityka: filmy tylko tymczasowo do obróbki, auto-usuwanie.");
  console.log("");
});

