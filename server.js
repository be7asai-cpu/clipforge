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

const { FileSessionStore } = require("./lib/file-session-store");
const { PgSessionStore } = require("./lib/pg-session-store");
const db = require("./lib/db");
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000; // 30 days
const authDataDir =
  process.env.AUTH_DATA_DIR || path.join(__dirname, "data", "auth");

function createSessionStore() {
  if (db.usingPostgres()) {
    console.log("[session] store=postgres (Neon/Supabase)");
    return new PgSessionStore({ ttlMs: sessionTtlMs });
  }
  console.log("[session] store=file", path.join(authDataDir, "sessions"));
  return new FileSessionStore({
    dir: path.join(authDataDir, "sessions"),
    ttlMs: sessionTtlMs,
  });
}

app.use(
  session({
    name: "clipforge.sid",
    secret: sessionSecret || "clipforge-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true, // refresh cookie on each request while active
    store: createSessionStore(),
    proxy: behindProxy, // honor X-Forwarded-Proto for secure cookies on Render
    cookie: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: cookieSecure,
      maxAge: sessionTtlMs,
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
app.get("/api/health", async (_req, res) => {
  noStore(res);
  let users = 0;
  let dbError = null;
  try {
    users = await auth.userCount();
  } catch (e) {
    users = -1;
    dbError = e && e.message ? String(e.message).slice(0, 160) : "query failed";
  }
  const urlRaw = db.databaseUrl();
  const urlSet = Boolean(urlRaw);
  // Safe fingerprint only (no password): host + db name
  let dbHost = null;
  if (urlRaw) {
    try {
      const u = new URL(urlRaw.replace(/^postgres(ql)?:/i, "http:"));
      dbHost = u.hostname + (u.pathname || "");
    } catch {
      dbHost = "(unparseable)";
    }
  }
  res.json({
    ok: true,
    service: "clipforge",
    studio: true,
    v: "2026-07-29agent7",
    users,
    authStore: db.usingPostgres() ? "postgres" : "file",
    // Help debug Render env without leaking secrets
    databaseUrlConfigured: urlSet,
    dbHost,
    dbError,
    hint: !urlSet
      ? "Render NIE przekazuje DATABASE_URL do kontenera. Wejdź w tę samą usługę co clipforge-45ti → Environment → dodaj dokładnie DATABASE_URL → Save → Manual Deploy."
      : dbError
        ? "DATABASE_URL jest, ale połączenie pada: " + dbError
        : "Postgres OK — konta trwałe.",
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

// Google Search Console verification files — exact body, no login wrap
app.get(/^\/google[a-f0-9]+\.html$/i, (req, res) => {
  const name = path.basename(req.path);
  const full = path.join(PUBLIC_DIR, name);
  if (!fs.existsSync(full)) {
    return res.status(404).type("text/plain").send("not found");
  }
  const body = fs.readFileSync(full, "utf8");
  // Google expects plain text line; avoid charset quirks / SPA shell
  res.status(200);
  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", "no-store");
  return res.send(body.endsWith("\n") ? body : body + "\n");
});

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
  if (req.path === "/whisper-status" || req.path === "/ollama-status")
    return next();
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
  const loggedIn =
    req.isAuthenticated && req.isAuthenticated() && req.user?.id;
  const uid = loggedIn
    ? String(req.user.id)
    : !auth.isAuthRequired()
      ? "local"
      : null;
  const email = loggedIn ? req.user.email || null : null;
  const serverBusy = studioJobs.isServerBusy();
  const myBusy = uid ? studioJobs.isUserBusy(uid) : serverBusy;
  // Match by userId OR email (token may predate re-register / file-auth wipe)
  const pc = pcAgent.statusFor(uid, email);
  if (!uid && !email) {
    // Not logged in: still report if *any* agent is online (UI can say "zaloguj się")
    const any = pcAgent.listOnline();
    pc.online = false;
    pc.anyOnline = any.length > 0;
    pc.agentsOnline = any.length;
    pc.needLogin = true;
  }
  res.json({
    ok: true,
    studio: true,
    busy: myBusy,
    myBusy,
    serverBusy,
    multiUser: true,
    auth: !!loggedIn,
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

/**
 * Resolve agent token and remap userId via email when account was recreated.
 * Async — email lookup against current user store.
 */
async function resolveAgentSession(req) {
  const row = pcAgent.resolveToken(agentBearer(req));
  if (!row) return null;
  let userId = String(row.userId);
  let email = row.email || null;
  if (email) {
    try {
      const u = await auth.findByEmail(email);
      if (u?.id) userId = String(u.id);
    } catch {
      /* keep token userId */
    }
  }
  return {
    ...row,
    userId,
    email,
    tokenUserId: String(row.userId),
  };
}

async function requireAgent(req, res) {
  const row = await resolveAgentSession(req);
  if (!row) {
    res.status(401).json({ error: "Nieprawidłowy token agenta" });
    return null;
  }
  pcAgent.heartbeat(row.token, row.label, {
    userId: row.userId,
    email: row.email,
  });
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
    const u = await auth.findByEmail(email);
    if (!u || !u.passwordHash) {
      return res.status(401).json({ error: "Złe e-mail lub hasło" });
    }
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: "Złe e-mail lub hasło" });
    const tok = pcAgent.issueToken(u.id, label, email);
    pcAgent.heartbeat(tok.token, label, { userId: u.id, email });
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
  const tok = pcAgent.issueToken(req.user.id, label, req.user.email || null);
  res.json({ ok: true, token: tok.token, label: tok.label });
});

// Session-auth wrapper for token mint (mounted with manual check above)
// Re-enable session for token route only via separate path under studio with auth
app.post("/api/studio/pc-token", auth.requireAuthIfEnabled, (req, res) => {
  if (!req.user?.id) return res.status(401).json({ error: "Zaloguj się" });
  const label = String(req.body?.label || "Mój PC").slice(0, 40);
  const tok = pcAgent.issueToken(req.user.id, label, req.user.email || null);
  res.json({
    ok: true,
    token: tok.token,
    label: tok.label,
    cloudUrl: auth.baseUrl() || `${req.protocol}://${req.get("host")}`,
    hint: "Pobierz gotowy plik: /api/studio/pc-setup.cmd",
  });
});

/**
 * PC agent source bundle (ZIP, pure Node — works on every PC, no tar required).
 * Auth: signed agent token (Bearer or ?token=) OR logged-in session.
 */
function authorizeAgentBundle(req, res) {
  const token = agentBearer(req) || String(req.query.token || "").trim();
  const row = token ? pcAgent.resolveToken(token) : null;
  const sessionOk =
    req.isAuthenticated &&
    req.isAuthenticated() &&
    req.user &&
    req.user.id;
  if (!row && !sessionOk) {
    res.status(401).json({ error: "Zaloguj sie lub podaj token agenta" });
    return false;
  }
  return true;
}

function sendAgentZipBundle(req, res) {
  if (!authorizeAgentBundle(req, res)) return;
  try {
    const { createAgentZip } = require("./lib/zip-pack");
    const buf = createAgentZip(__dirname);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="clipforge-agent.zip"'
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(buf.length));
    res.send(buf);
  } catch (e) {
    res.status(500).json({
      error: "Nie udalo sie spakowac agenta",
      detail: String(e && e.message ? e.message : e).slice(0, 300),
    });
  }
}

app.get("/api/studio/pc-agent-bundle.zip", sendAgentZipBundle);
// Keep old URL as alias (now ZIP bytes; setup prefers .zip)
app.get("/api/studio/pc-agent-bundle.tgz", sendAgentZipBundle);

/**
 * Full PC-agent setup PowerShell (can be long).
 * ASCII-only body: Windows PowerShell 5.1 mis-parses UTF-8 scripts without BOM
 * (em-dash / Polish chars break strings -> "Missing closing }" / parser errors).
 */
function buildPcSetupPs1({ cloud, token, label }) {
  const psQ = (s) =>
    String(s)
      .replace(/'/g, "''")
      // keep payload ASCII-safe for PS 5.1
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
  // Entire script must stay ASCII (no em-dash, no fancy dots).
  // CLOUD-ONLY: never copy from developer disk / Projects / C:\\Users\\...
  const body = `
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'clipforge-agent-setup.log'
function L($m) { $t = (Get-Date).ToString('s') + ' ' + $m; Add-Content -Path $log -Value $t; Write-Host $t }

try {
  L '=== ClipForge PC Agent (setup9-cloud-only) ==='
  L ("PS version: " + $PSVersionTable.PSVersion)
  L ("User: " + $env:USERNAME + "  PC: " + $env:COMPUTERNAME)
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  } catch {}

  $cloud = '${psQ(cloud)}'
  $token = '${psQ(token)}'
  $label = '${psQ(label || "Moj PC")}'
  # ALWAYS per-user folder on THIS machine (not developer disk, not shared path)
  $agentDir = Join-Path $env:LOCALAPPDATA 'ClipForge-Agent'
  $authDir = Join-Path $agentDir 'data\\auth'

  Write-Host ''
  Write-Host ' ========================================'
  Write-Host '  ClipForge - instalacja TYLKO Z CHMURY'
  Write-Host ' ========================================'
  Write-Host ('  Serwer:  ' + $cloud)
  Write-Host ('  Folder:  ' + $agentDir)
  Write-Host '  Kod NIE jest brany z dysku kolegi / dev.'
  Write-Host '  Kazdy uzytkownik: wlasne konto + wlasny plik ⬇ PC.'
  Write-Host ''

  L ("Cloud: $cloud")
  L ("Agent dir: $agentDir")
  L ("Token prefix: " + $token.Substring(0, [Math]::Min(12, $token.Length)) + "...")

  $env:CLIPFORGE_CLOUD_URL = $cloud
  $env:CLIPFORGE_AGENT_TOKEN = $token
  $env:CLIPFORGE_PC_LABEL = $label

  New-Item -ItemType Directory -Path $authDir -Force | Out-Null
  Set-Content -Path (Join-Path $authDir 'pc-agent.token') -Value $token -Encoding ascii -NoNewline

  # --- Node.js (required runtime on this PC) ---
  $nodeExe = $null
  $nodeCandidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\\nodejs\\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\\node\\node.exe'),
    (Join-Path $env:SystemDrive 'nodejs\\node.exe')
  )
  $pf86 = \${env:ProgramFiles(x86)}
  if ($pf86) { $nodeCandidates += (Join-Path $pf86 'nodejs\\node.exe') }
  foreach ($c in $nodeCandidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { $nodeExe = $c; break }
  }
  if (-not $nodeExe) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source)) { $nodeExe = $cmd.Source }
  }
  if (-not $nodeExe) {
    L '[BLAD] Brak Node.js na TYM komputerze.'
    Write-Host '1) Pobierz Node LTS: https://nodejs.org'
    Write-Host '2) Zaznacz Add to PATH, zainstaluj'
    Write-Host '3) Zamknij to okno i odpal .cmd ponownie'
    exit 2
  }
  $nodeDir = Split-Path -Parent $nodeExe
  $env:Path = $nodeDir + ';' + $env:Path
  L ("Node: " + $nodeExe)
  & $nodeExe -v | ForEach-Object { L ("Node version: " + $_) }

  function Expand-AgentZip($zip, $dest) {
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    $ok = $false
    try {
      Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
      $ok = $true
      L 'Rozpakowano: Expand-Archive'
    } catch { L ('Expand-Archive fail: ' + $_) }
    if (-not $ok) {
      try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
        $ok = $true
        L 'Rozpakowano: ZipFile'
      } catch { L ('ZipFile fail: ' + $_) }
    }
    if (-not $ok) {
      try {
        $shell = New-Object -ComObject Shell.Application
        $zipItem = $shell.NameSpace((Resolve-Path $zip).Path)
        $destItem = $shell.NameSpace((Resolve-Path $dest).Path)
        $destItem.CopyHere($zipItem.Items(), 16)
        Start-Sleep -Seconds 2
        $ok = $true
        L 'Rozpakowano: Shell'
      } catch { L ('Shell unzip fail: ' + $_) }
    }
    if (-not $ok) { throw 'Nie udalo sie rozpakowac ZIP z chmury' }
  }

  # --- ALWAYS download code from cloud (never from developer disk) ---
  L 'Pobieram paczke agenta Z CHMURY (nie z dysku dev)...'
  $zip = Join-Path $env:TEMP ('clipforge-agent-' + [guid]::NewGuid().ToString('n').Substring(0,8) + '.zip')
  $uri = $cloud.TrimEnd('/') + '/api/studio/pc-agent-bundle.zip?token=' + [uri]::EscapeDataString($token)
  L ("URL: " + $cloud.TrimEnd('/') + '/api/studio/pc-agent-bundle.zip?token=***')

  function Test-ZipOk($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $len = (Get-Item -LiteralPath $path).Length
    if ($len -lt 50000) { return $false }
    try {
      $fs = [IO.File]::OpenRead($path)
      try {
        $buf = New-Object byte[] 4
        [void]$fs.Read($buf, 0, 4)
        # PK\\x03\\x04 or PK\\x05\\x06
        if (-not ($buf[0] -eq 0x50 -and $buf[1] -eq 0x4B)) { return $false }
        # End of central directory signature near end
        $fs.Seek([Math]::Max(0, $len - 65557), 'Begin') | Out-Null
        $tail = New-Object byte[] ([Math]::Min(65557, $len))
        $n = $fs.Read($tail, 0, $tail.Length)
        $ok = $false
        for ($i = 0; $i -le $n - 4; $i++) {
          if ($tail[$i] -eq 0x50 -and $tail[$i+1] -eq 0x4B -and $tail[$i+2] -eq 0x05 -and $tail[$i+3] -eq 0x06) {
            $ok = $true; break
          }
        }
        return $ok
      } finally { $fs.Close() }
    } catch { return $false }
  }

  # Windows curl uses Schannel — SEC_E_DECRYPT_FAILURE (0x80090330) mid-download is common.
  # PRIMARY: Node OpenSSL (proven stable on this OS). Curl only as short fallback.
  function Get-RobustFile {
    param(
      [string]$Url,
      [string]$Dest,
      [hashtable]$Headers = @{},
      [long]$MinBytes = 10000,
      [scriptblock]$Validate = $null
    )
    function Ok-File([string]$p) {
      if (-not (Test-Path -LiteralPath $p)) { return $false }
      try {
        if ((Get-Item -LiteralPath $p).Length -lt $MinBytes) { return $false }
      } catch { return $false }
      if ($Validate) { return [bool](& $Validate $p) }
      return $true
    }

    # 1) Node.js https FIRST (OpenSSL — omija Windows Schannel SEC_E_DECRYPT)
    if ($nodeExe -and (Test-Path $nodeExe)) {
      for ($ni = 1; $ni -le 3; $ni++) {
        try {
          if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
          L ("Pobieram przez Node/OpenSSL (proba $ni/3, bez Schannel)...")
          $hdrJson = ($Headers | ConvertTo-Json -Compress)
          if (-not $hdrJson) { $hdrJson = '{}' }
          $nodeDl = @'
const https = require("https");
const http = require("http");
const fs = require("fs");
const { URL } = require("url");
const dest = process.argv[2];
const url = process.argv[3];
let headers = {};
try { headers = JSON.parse(process.argv[4] || "{}"); } catch (e) {}
function get(u, redirects) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(u);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: Object.assign(
          { "User-Agent": "ClipForge-Setup/2.0", Accept: "*/*", Connection: "close" },
          headers
        ),
        timeout: 600000,
      },
      (res) => {
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
        let lastLog = 0;
        res.on("data", (c) => {
          got += c.length;
          if (total > 0 && got - lastLog > total * 0.2) {
            lastLog = got;
            process.stdout.write("  Node DL " + Math.round((100 * got) / total) + "%\\n");
          }
        });
        res.pipe(f);
        f.on("finish", () =>
          f.close(() => {
            const sz = fs.statSync(dest).size;
            process.stdout.write("  Node DL OK " + sz + " B\\n");
            resolve(dest);
          })
        );
        f.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}
get(url, 8)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
'@
          $ndPath = Join-Path $env:TEMP ('cf-dl-' + [guid]::NewGuid().ToString('n').Substring(0,8) + '.js')
          Set-Content -Path $ndPath -Value $nodeDl -Encoding UTF8
          & $nodeExe $ndPath $Dest $Url $hdrJson
          $nc = $LASTEXITCODE
          try { Remove-Item $ndPath -Force -ErrorAction SilentlyContinue } catch {}
          if ($nc -eq 0 -and (Ok-File $Dest)) { L 'Pobrano: Node OpenSSL'; return $true }
          L ('Node download exit=' + $nc + ' size=' + $(if (Test-Path $Dest) { (Get-Item $Dest).Length } else { 0 }))
        } catch { L ('Node download fail: ' + $_) }
        Start-Sleep -Seconds (2 * $ni)
      }
    }

    # 2) curl short attempt (often fails on this PC — do not spam 8 long retries)
    $hdrArgs = @()
    foreach ($k in $Headers.Keys) {
      $hdrArgs += @('-H', ($k + ': ' + $Headers[$k]))
    }
    $curlBase = @(
      '-L', '--fail',
      '--ssl-no-revoke',
      '--http1.1',
      '--retry', '2',
      '--retry-all-errors',
      '--retry-delay', '2',
      '--connect-timeout', '30',
      '--max-time', '300'
    )
    try {
      if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
      L 'Pobieram curl (krotko, Schannel moze padac)...'
      $args1 = $curlBase + $hdrArgs + @('-o', $Dest, $Url)
      & curl.exe @args1
      if ($LASTEXITCODE -eq 0 -and (Ok-File $Dest)) { L 'Pobrano: curl'; return $true }
      L ('curl exit=' + $LASTEXITCODE)
    } catch { L ('curl fail: ' + $_) }

    # 3) BITS
    try {
      if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
      Import-Module BitsTransfer -ErrorAction SilentlyContinue
      Start-BitsTransfer -Source $Url -Destination $Dest -ErrorAction Stop
      if (Ok-File $Dest) { L 'Pobrano: BitsTransfer'; return $true }
    } catch { L ('BITS fail: ' + $_) }

    # 4) IWR last
    try {
      if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
      $iwrHdr = @{}
      foreach ($k in $Headers.Keys) { $iwrHdr[$k] = $Headers[$k] }
      Invoke-WebRequest -Uri $Url -Headers $iwrHdr -OutFile $Dest -UseBasicParsing -TimeoutSec 900
      if (Ok-File $Dest) { L 'Pobrano: IWR'; return $true }
    } catch { L ('IWR fail: ' + $_) }
    return $false
  }

  function Get-AgentZip($dest) {
    return (Get-RobustFile -Url $uri -Dest $dest -Headers @{ Authorization = ('Bearer ' + $token) } -MinBytes 50000 -Validate { param($p) Test-ZipOk $p })
  }

  $dlOk = $false
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    L ("Download proba $attempt/5 ...")
    if (Get-AgentZip $zip) { $dlOk = $true; break }
    Start-Sleep -Seconds (3 * $attempt)
  }
  if (-not $dlOk) {
    throw 'Download z chmury nieudany (Windows TLS/Schannel SEC_E_DECRYPT). Sprobuj: 1) odpal setup jeszcze raz 2) inna siec/VPN off 3) wyjatki antywirusa. Node fallback powinien ominac Schannel.'
  }
  $head = Get-Content -LiteralPath $zip -Encoding Byte -TotalCount 4 -ErrorAction SilentlyContinue
  if ($head -and $head[0] -eq 0x3C) {
    throw 'Serwer zwrocil HTML zamiast ZIP (zly token). Zaloguj sie na stronie i kliknij ⬇ PC ponownie.'
  }
  L ("ZIP z chmury OK: " + (Get-Item $zip).Length + " B (sprawdzony)")

  # Wipe old code; keep only data/ (token, local work folders)
  if (Test-Path $agentDir) {
    Get-ChildItem $agentDir -Force | Where-Object { $_.Name -ne 'data' } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
  try {
    Expand-AgentZip $zip $agentDir
  } catch {
    L ('Rozpakowanie fail: ' + $_)
    throw 'ZIP uszkodzony mimo checku. Odpal setup jeszcze raz (swiezy ⬇ PC).'
  }
  try { Remove-Item $zip -Force -ErrorAction SilentlyContinue } catch {}

  if (-not (Test-Path (Join-Path $agentDir 'package.json'))) {
    $sub = Get-ChildItem $agentDir -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($sub -and (Test-Path (Join-Path $sub.FullName 'package.json'))) {
      L ("Paczka ma podfolder: " + $sub.Name + " - przenosze")
      Get-ChildItem $sub.FullName -Force | ForEach-Object { Move-Item $_.FullName -Destination $agentDir -Force }
      Remove-Item $sub.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not (Test-Path (Join-Path $agentDir 'package.json'))) {
    Get-ChildItem $agentDir -Recurse -ErrorAction SilentlyContinue | Select-Object -First 25 FullName | ForEach-Object { L $_.FullName }
    throw 'Paczka z chmury uszkodzona (brak package.json)'
  }
  if (-not (Test-Path (Join-Path $agentDir 'scripts\\pc-agent.js'))) {
    throw 'Paczka z chmury uszkodzona (brak scripts/pc-agent.js)'
  }
  L 'Kod agenta Z CHMURY gotowy (zero sciezek z dysku dev)'

  # --- Real-ESRGAN (AI upscale) for this PC ---
  $esrganExe = Join-Path $agentDir 'tools\\realesrgan\\realesrgan-ncnn-vulkan.exe'
  $esrganModel = Join-Path $agentDir 'tools\\realesrgan\\models\\realesr-animevideov3-x2.bin'
  $x4plus = Join-Path $agentDir 'tools\\realesrgan\\models\\realesrgan-x4plus.bin'
  $needEsrgan = (-not (Test-Path $esrganExe)) -or (-not (Test-Path $esrganModel))
  $needX4 = -not (Test-Path $x4plus)
  if ($needEsrgan -or $needX4) {
    L 'Real-ESRGAN: dociagam modele z GitHub (osobno od paczki agenta)...'
    $esrZip = Join-Path $env:TEMP 'realesrgan-ncnn-windows.zip'
    $esrUrl = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip'
    try {
      if (Test-Path $esrZip) { Remove-Item $esrZip -Force -ErrorAction SilentlyContinue }
      $esrOk = Get-RobustFile -Url $esrUrl -Dest $esrZip -MinBytes 1000000
      if (-not $esrOk) { throw 'Real-ESRGAN ZIP download fail (TLS/Schannel?)' }
      $esrTmp = Join-Path $env:TEMP ('cf-esrgan-' + [guid]::NewGuid().ToString('n').Substring(0,8))
      New-Item -ItemType Directory -Path $esrTmp -Force | Out-Null
      Expand-Archive -LiteralPath $esrZip -DestinationPath $esrTmp -Force
      $found = Get-ChildItem -Path $esrTmp -Recurse -Filter 'realesrgan-ncnn-vulkan.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $found) { throw 'Brak exe w ZIP Real-ESRGAN' }
      $srcRoot = $found.Directory.FullName
      $dest = Join-Path $agentDir 'tools\\realesrgan'
      New-Item -ItemType Directory -Path (Join-Path $dest 'models') -Force | Out-Null
      if ($needEsrgan) {
        Copy-Item (Join-Path $srcRoot 'realesrgan-ncnn-vulkan.exe') $dest -Force
        if (Test-Path (Join-Path $srcRoot 'vcomp140.dll')) { Copy-Item (Join-Path $srcRoot 'vcomp140.dll') $dest -Force }
        if (Test-Path (Join-Path $srcRoot 'vcomp140d.dll')) { Copy-Item (Join-Path $srcRoot 'vcomp140d.dll') $dest -Force }
      }
      $modelsSrc = Join-Path $srcRoot 'models'
      if (Test-Path $modelsSrc) {
        Get-ChildItem $modelsSrc -File | Where-Object {
          $_.Name -like 'realesr-animevideov3*' -or
          $_.Name -like 'realesrgan-x4plus*'
        } | ForEach-Object {
          Copy-Item $_.FullName (Join-Path $dest 'models') -Force
        }
      }
      try { Unblock-File -Path (Join-Path $dest 'realesrgan-ncnn-vulkan.exe') -ErrorAction SilentlyContinue } catch {}
      Remove-Item $esrTmp -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item $esrZip -Force -ErrorAction SilentlyContinue
      L 'Real-ESRGAN modele OK (animevideov3 + x4plus jesli byly w paczce GitHub)'
    } catch {
      L ('[OSTRZEZENIE] Real-ESRGAN extra modele: ' + $_ + ' - AI animevideov3 z paczki agenta / Szybki HD')
    }
  } else {
    L 'Real-ESRGAN OK (AI upscale + x4plus)'
  }

  # --- npm install dependencies from internet (npm registry), not from local project ---
  $ffBin = Join-Path $agentDir 'node_modules\\ffmpeg-static\\ffmpeg.exe'
  L 'npm install (paczki z internetu, 2-5 min)...'
  Push-Location $agentDir
  & npm.cmd install --omit=dev
  $npmCode = $LASTEXITCODE
  if ($npmCode -ne 0) {
    L 'npm.cmd fail - proboje npm-cli.js...'
    $npmCli = Join-Path $nodeDir 'node_modules\\npm\\bin\\npm-cli.js'
    if (Test-Path $npmCli) {
      & $nodeExe $npmCli install --omit=dev
      $npmCode = $LASTEXITCODE
    }
  }
  Pop-Location
  if ($npmCode -ne 0) {
    throw "npm install failed: $npmCode (internet / antywirus?)"
  }
  L 'npm install OK'

  # restore token after wipe
  New-Item -ItemType Directory -Path $authDir -Force | Out-Null
  Set-Content -Path (Join-Path $authDir 'pc-agent.token') -Value $token -Encoding ascii -NoNewline

  function Test-Ffmpeg($bin) {
    if (-not $bin -or -not (Test-Path -LiteralPath $bin)) { return $false }
    try {
      $sz = (Get-Item -LiteralPath $bin).Length
      # Good win x64 ffmpeg-static ~80MB; broken TLS partials often ~20-40MB with MZ header
      if ($sz -lt 20000000) { L ("FFmpeg za maly: $sz B (uszkodzony download?)"); return $false }
      $fs = [IO.File]::OpenRead($bin)
      try {
        $mz = New-Object byte[] 2
        [void]$fs.Read($mz, 0, 2)
        if (-not ($mz[0] -eq 0x4D -and $mz[1] -eq 0x5A)) { return $false }
      } finally { $fs.Close() }
    } catch { return $false }
    try { Unblock-File -Path $bin -ErrorAction SilentlyContinue } catch {}
    try {
      $outF = Join-Path $env:TEMP 'cf-ff-out.txt'
      $errF = Join-Path $env:TEMP 'cf-ff-err.txt'
      $proc = Start-Process -FilePath $bin -ArgumentList '-version' -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $outF -RedirectStandardError $errF -ErrorAction Stop
      if (-not $proc) { return $false }
      if ($proc.ExitCode -ne 0) { return $false }
      $ver = ''
      try { $ver = Get-Content -LiteralPath $outF -Raw -ErrorAction SilentlyContinue } catch {}
      return ($ver -match 'ffmpeg|FFmpeg')
    } catch {
      # "%1 is not a valid Win32 application" = corrupt PE after mid-TLS download
      L ('FFmpeg nie startuje: ' + $_)
      return $false
    }
  }

  function Repair-FfmpegBinary($destExe) {
    # Direct binary from ffmpeg-static GitHub (gunzip) — more reliable than re-npm after TLS glitch
    $gz = Join-Path $env:TEMP ('ffmpeg-static-' + [guid]::NewGuid().ToString('n').Substring(0,8) + '.gz')
    $url = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz'
    L 'FFmpeg: pobieram oficjalny bin (win32-x64.gz)...'
    $ok = Get-RobustFile -Url $url -Dest $gz -MinBytes 5000000
    if (-not $ok) {
      L 'FFmpeg gz fail — proboje npm force...'
      Push-Location $agentDir
      try { Remove-Item -LiteralPath $destExe -Force -ErrorAction SilentlyContinue } catch {}
      & npm.cmd install ffmpeg-static@5.3.0 --force
      Pop-Location
      return (Test-Ffmpeg $destExe)
    }
    try {
      $dir = Split-Path -Parent $destExe
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
      if (Test-Path -LiteralPath $destExe) { Remove-Item -LiteralPath $destExe -Force -ErrorAction SilentlyContinue }
      # gunzip via Node (always available — we require Node for agent)
      $gunzipJs = @'
const fs=require("fs");const zlib=require("zlib");
const gz=process.argv[2], out=process.argv[3];
const i=fs.createReadStream(gz);
const o=fs.createWriteStream(out);
i.pipe(zlib.createGunzip()).pipe(o);
o.on("finish",()=>{const s=fs.statSync(out).size; if(s<20000000) process.exit(2); console.log("gunzip",s); process.exit(0);});
o.on("error",e=>{console.error(e); process.exit(1);});
i.on("error",e=>{console.error(e); process.exit(1);});
'@
      $jsPath = Join-Path $env:TEMP ('cf-gunzip-' + [guid]::NewGuid().ToString('n').Substring(0,8) + '.js')
      Set-Content -Path $jsPath -Value $gunzipJs -Encoding UTF8
      & $nodeExe $jsPath $gz $destExe
      $gc = $LASTEXITCODE
      try { Remove-Item $jsPath -Force -ErrorAction SilentlyContinue } catch {}
      try { Remove-Item $gz -Force -ErrorAction SilentlyContinue } catch {}
      if ($gc -ne 0) { L ("gunzip fail code=$gc"); return $false }
      try { Unblock-File -Path $destExe -ErrorAction SilentlyContinue } catch {}
      return (Test-Ffmpeg $destExe)
    } catch {
      L ('Repair-Ffmpeg: ' + $_)
      return $false
    }
  }

  if (-not (Test-Ffmpeg $ffBin)) {
    L 'FFmpeg uszkodzony lub brak — naprawiam...'
    if (-not (Repair-FfmpegBinary $ffBin)) {
      throw 'FFmpeg nie dziala (uszkodzony download / antywirus). Wyjatek na folder: %LOCALAPPDATA%\\ClipForge-Agent i odpal setup ponownie.'
    }
  }
  L ('FFmpeg OK: ' + (Get-Item -LiteralPath $ffBin).Length + ' B')

  # --- yt-dlp (YouTube/TikTok/…) — must exist before first job; agent can re-download if missing ---
  $toolsDir = Join-Path $agentDir 'tools'
  $ytdlpBin = Join-Path $toolsDir 'yt-dlp.exe'
  New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  $needYt = $true
  if (Test-Path $ytdlpBin) {
    try {
      $ysz = (Get-Item -LiteralPath $ytdlpBin).Length
      if ($ysz -gt 500000) { $needYt = $false; L ("yt-dlp juz jest: $ysz B") }
    } catch { $needYt = $true }
  }
  if ($needYt) {
    L 'Pobieram yt-dlp.exe (GitHub releases, YouTube/TikTok)...'
    $ytUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    $ytOk = Get-RobustFile -Url $ytUrl -Dest $ytdlpBin -MinBytes 500000
    if (-not $ytOk) {
      # pinned release if /latest fails mid-stream
      $ytUrl2 = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp.exe'
      L 'yt-dlp latest fail — proboje pinned 2026.07.04...'
      $ytOk = Get-RobustFile -Url $ytUrl2 -Dest $ytdlpBin -MinBytes 500000
    }
    if ($ytOk) {
      try { Unblock-File -Path $ytdlpBin -ErrorAction SilentlyContinue } catch {}
      L ('yt-dlp OK: ' + (Get-Item -LiteralPath $ytdlpBin).Length + ' B')
    } else {
      L '[OSTRZEZENIE] yt-dlp nie pobrany w setup — agent sprobue przy pierwszym YouTube'
    }
  }

  # RUN-AGENT.bat — only this PC + cloud URL (no other user paths)
  $runBat = Join-Path $agentDir 'RUN-AGENT.bat'
  $batLines = @(
    '@echo off',
    'cd /d "%~dp0"',
    ('set "PATH=' + $nodeDir + ';%PATH%"'),
    ('set "CLIPFORGE_CLOUD_URL=' + $cloud + '"'),
    ('set "CLIPFORGE_PC_LABEL=' + $label + '"'),
    'if exist "data\\auth\\pc-agent.token" set /p CLIPFORGE_AGENT_TOKEN=<"data\\auth\\pc-agent.token"',
    'echo ClipForge PC Agent - NIE ZAMYKAJ',
    ('echo Strona: ' + $cloud + '/studio.html'),
    'echo Zaloguj sie na TO SAMO konto co przy ⬇ PC.',
    ('"' + $nodeExe + '" scripts\\pc-agent.js'),
    'echo Kod: %ERRORLEVEL%',
    'pause'
  )
  Set-Content -Path $runBat -Value ($batLines -join ([char]13+[char]10)) -Encoding ascii
  L ("RUN-AGENT: $runBat")

  $help = Join-Path $agentDir 'CZYTAJ-MNIE.txt'
  $helpLines = @(
    'ClipForge PC Agent - TYLKO Z CHMURY',
    '================================',
    ('Cloud: ' + $cloud),
    ('Folder na TYM PC: ' + $agentDir),
    '',
    '1. Zostaw agent OTWARTY (to okno albo RUN-AGENT.bat)',
    '2. Wejdz na strone w chmurze (powyzej)',
    '3. Zaloguj sie na TO SAMO konto, ktore pobralo PC',
    '4. Chip: PC ON',
    '',
    'Kazdy uzytkownik = wlasne konto + wlasny PC agent.',
    'Nie dawaj .cmd znajomemu (ma TWOJ token).',
    ('Log: ' + $log)
  )
  Set-Content -Path $help -Value ($helpLines -join ([char]13+[char]10)) -Encoding ascii

  try {
    $hbUri = $cloud.TrimEnd('/') + '/api/studio/agent/heartbeat'
    $hb = Invoke-RestMethod -Uri $hbUri -Method POST -Headers @{ Authorization = ("Bearer " + $token); 'Content-Type' = 'application/json' } -Body '{"label":"setup"}' -TimeoutSec 45
    L ("Heartbeat OK userId=" + $hb.userId + " email=" + $hb.email)
  } catch {
    L ('[OSTRZEZENIE] Heartbeat: ' + $_ + ' (Render free moze spic 30-60s)')
  }

  L 'Start agenta. UI = chmura, liczenie = TEN PC. Nie zamykaj okna.'
  Write-Host ''
  Write-Host ('  Strona: ' + $cloud + '/studio.html')
  Write-Host ('  Kod z chmury w: ' + $agentDir)
  Write-Host ''
  Set-Location $agentDir
  & $nodeExe .\\scripts\\pc-agent.js
  L ("Agent exit=" + $LASTEXITCODE)
  exit $LASTEXITCODE
} catch {
  L ('[BLAD] ' + $_)
  if ($_.ScriptStackTrace) { L $_.ScriptStackTrace }
  Write-Host ''
  Write-Host '===== BLAD ====='
  Write-Host ('Log: ' + $log)
  Write-Host '================'
  exit 1
}
`.trim();
  return body.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "-");
}

function resolvePcSetupCloud(req) {
  return (
    auth.baseUrl() ||
    process.env.RENDER_EXTERNAL_URL ||
    `${req.protocol}://${req.get("host")}`
  ).replace(/\/$/, "");
}

/**
 * Full setup .ps1 — session cookie OR agent Bearer token.
 * Short .cmd downloads this (avoids Windows 8191-char CMD limit).
 */
function sendPcSetupPs1(req, res) {
  const bearer = agentBearer(req) || String(req.query.token || "").trim();
  const row = bearer ? pcAgent.resolveToken(bearer) : null;
  const sessionUser = req.user?.id ? req.user : null;

  let token = bearer;
  let label = String(req.query.label || "Moj PC")
    .slice(0, 40)
    .replace(/[^\w\s.-]/g, "");

  if (row) {
    token = row.token;
    label = row.label || label || "Moj PC";
  } else if (sessionUser) {
    const tok = pcAgent.issueToken(
      sessionUser.id,
      label || "Moj PC",
      sessionUser.email || null
    );
    token = tok.token;
    label = tok.label || label;
  } else {
    return res
      .status(401)
      .type("text")
      .send("Zaloguj sie albo podaj token agenta.");
  }

  const cloud = resolvePcSetupCloud(req);
  const ps1 = buildPcSetupPs1({ cloud, token, label });
  // UTF-8 BOM so Windows PowerShell 5.1 parses correctly if any non-ASCII slips in
  const bom = "\uFEFF";
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="ClipForge-PC-Agent.setup.ps1"'
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(bom + ps1.replace(/\n/g, "\r\n"));
}

/**
 * One-click PC agent — self-contained .cmd.
 * Payload lives in ::B64 comment lines (read by PowerShell) — avoids CMD echo
 * corruption and 8191-char -Command limits. No second HTTP (no 401).
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
  const tok = pcAgent.issueToken(
    req.user.id,
    label || "Moj PC",
    req.user.email || null
  );
  const cloud = resolvePcSetupCloud(req);
  const ps1 = buildPcSetupPs1({
    cloud,
    token: tok.token,
    label: label || "Moj PC",
  });
  const b64 = Buffer.from(ps1, "ascii").toString("base64");
  const chunks = b64.match(/.{1,76}/g) || [];

  // PowerShell bootstrap: read ::B64 lines from this .cmd, decode, run
  // Trim each chunk (CR/spaces). Clear errors if payload missing = stary plik.
  const bootstrap =
    "powershell -NoProfile -ExecutionPolicy Bypass -Command " +
    "\"try { " +
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); " +
    "$cmd = $env:CF_CMD; " +
    "Write-Host ('Plik: ' + $cmd); " +
    "Write-Host ('PS: ' + $PSVersionTable.PSVersion); " +
    "if (-not $cmd -or -not (Test-Path -LiteralPath $cmd)) { throw 'Brak sciezki CF_CMD do pliku .cmd' }; " +
    "$lines = Get-Content -LiteralPath $cmd -ErrorAction Stop; " +
    "$parts = @($lines | Where-Object { $_ -match '^::B64\\s+' } | ForEach-Object { ($_ -replace '^::B64\\s+','').Trim() }); " +
    "Write-Host ('B64 chunks: ' + $parts.Count); " +
    "if ($parts.Count -lt 5) { throw 'Stary lub uszkodzony plik .cmd (brak ::B64). Pobierz SWIEZY agent ze strony po zalogowaniu.' }; " +
    "$b64 = $parts -join ''; " +
    "$ps1Path = Join-Path $env:TEMP 'ClipForge-PC-Agent.setup.ps1'; " +
    "$bytes = [Convert]::FromBase64String($b64); " +
    "[IO.File]::WriteAllBytes($ps1Path, $bytes); " +
    "Unblock-File -Path $ps1Path -ErrorAction SilentlyContinue; " +
    "Write-Host ('Setup: ' + $ps1Path + ' (' + $bytes.Length + ' B)'); " +
    "& $ps1Path; exit $LASTEXITCODE " +
    "} catch { Write-Host ('[BLAD] ' + $_); Write-Host '---'; Write-Host 'Wyslij kumplowi: ten komunikat + %TEMP%\\clipforge-agent-setup.log'; exit 1 }\"";

  // ASCII-only launcher. Do NOT require node in .cmd — PowerShell setup finds it.
  // Hardcode common node dirs into PATH (32-bit cmd has wrong ProgramFiles).
  const launcher = [
    "@echo off",
    "setlocal EnableExtensions",
    "title ClipForge PC Agent",
    "cd /d \"%~dp0\"",
    "set \"CF_CMD=%~f0\"",
    "echo.",
    "echo  ========================================",
    "echo   ClipForge PC Agent  (setup10)",
    "echo  ========================================",
    "echo.",
    "echo  Plik: %~f0",
    "echo  Log:  %TEMP%\\clipforge-agent-setup.log",
    "echo  Folder: %LOCALAPPDATA%\\ClipForge-Agent",
    "echo  Kod: Z CHMURY na TEN PC (nie z dysku dev).",
    "echo.",
    "REM Prepend node paths (works even when PATH empty / 32-bit cmd)",
    "if exist \"C:\\Program Files\\nodejs\\node.exe\" set \"PATH=C:\\Program Files\\nodejs;%PATH%\"",
    "if exist \"%LOCALAPPDATA%\\Programs\\nodejs\\node.exe\" set \"PATH=%LOCALAPPDATA%\\Programs\\nodejs;%PATH%\"",
    "if exist \"%SystemDrive%\\nodejs\\node.exe\" set \"PATH=%SystemDrive%\\nodejs;%PATH%\"",
    "if defined ProgramW6432 if exist \"%ProgramW6432%\\nodejs\\node.exe\" set \"PATH=%ProgramW6432%\\nodejs;%PATH%\"",
    "if defined ProgramFiles if exist \"%ProgramFiles%\\nodejs\\node.exe\" set \"PATH=%ProgramFiles%\\nodejs;%PATH%\"",
    "echo  Trwa instalacja z chmury - NIE ZAMYKAJ okna...",
    "echo.",
    "REM Prefer 64-bit PowerShell (sysnative when launched as 32-bit)",
    "set \"PS_EXE=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\"",
    "if exist \"%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe\" set \"PS_EXE=%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe\"",
    "if not exist \"%PS_EXE%\" set \"PS_EXE=powershell.exe\"",
    bootstrap.replace(
      /^powershell /,
      "\"%PS_EXE%\" "
    ),
    "set ERR=%ERRORLEVEL%",
    "echo.",
    "if not \"%ERR%\"==\"0\" (",
    "  echo [BLAD] Kod: %ERR%",
    "  echo.",
    "  echo Jesli brak Node: https://nodejs.org  (LTS, Add to PATH)",
    "  echo Potem odpal ten .cmd ponownie.",
    "  echo.",
    "  echo --- log ---",
    "  if exist \"%TEMP%\\clipforge-agent-setup.log\" type \"%TEMP%\\clipforge-agent-setup.log\"",
    "  echo -----------",
    ")",
    "echo.",
    "echo  Enter = zamknij okno...",
    "pause >nul",
    "exit /b %ERR%",
    "",
    "REM --- payload (do not edit) ---",
    ...chunks.map((line) => "::B64 " + line),
    "",
  ].join("\r\n");

  // Pure binary-ish download: avoid charset mangling by browsers
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="ClipForge-PC-Agent.cmd"'
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(Buffer.from(launcher, "ascii"));
}

// Both URLs (some proxies choke on ".cmd" in path)
app.get("/api/studio/pc-setup", auth.requireAuthIfEnabled, sendPcSetupCmd);
app.get("/api/studio/pc-setup.cmd", auth.requireAuthIfEnabled, sendPcSetupCmd);
app.get("/api/studio/pc-setup.ps1", sendPcSetupPs1);

app.post("/api/studio/agent/heartbeat", async (req, res) => {
  try {
    const row = await resolveAgentSession(req);
    if (!row) return res.status(401).json({ error: "Zły token" });
    const label = String(req.body?.label || row.label || "PC");
    const st = pcAgent.heartbeat(row.token, label, {
      userId: row.userId,
      email: row.email,
    });
    // While agent is alive, unstick orphans claimed then abandoned (setup reinstall etc.)
    let reclaimed = 0;
    try {
      reclaimed = studioJobs.reclaimStalePcJobs(row.userId, row.email) || 0;
    } catch {
      reclaimed = 0;
    }
    res.json({ ok: true, ...st, reclaimed });
  } catch (err) {
    res.status(500).json({ error: err.message || "heartbeat" });
  }
});

app.post("/api/studio/agent/claim", async (req, res) => {
  const row = await requireAgent(req, res);
  if (!row) return;
  // Prefer live account userId + email (jobs survive re-login); also token's original userId
  let job = studioJobs.claimPcJob(row.userId, row.email);
  if (!job && row.tokenUserId && row.tokenUserId !== row.userId) {
    job = studioJobs.claimPcJob(row.tokenUserId, row.email);
  }
  if (!job) return res.json({ ok: true, job: null });
  const opts = job.options || {};
  res.json({
    ok: true,
    job: {
      id: job.id,
      originalName: job.originalName,
      options: opts,
      userId: job.userId,
      /** Platform / remote source for PC agent (yt-dlp) when no cloud input file */
      sourceUrl: opts.sourceUrl || null,
      sourceKind: opts.sourceKind || null,
      sourcePlatform: opts.sourcePlatform || null,
      hasCloudInput: !!(job.inputPath && fs.existsSync(job.inputPath)),
    },
  });
});

function agentOwnsJob(job, row) {
  if (!job || !row) return false;
  if (studioJobs.ownsJob(job, row.userId)) return true;
  if (row.tokenUserId && studioJobs.ownsJob(job, row.tokenUserId)) return true;
  return false;
}

app.get("/api/studio/agent/jobs/:id/input", async (req, res) => {
  const row = await requireAgent(req, res);
  if (!row) return;
  const job = studioJobs.getJob(req.params.id);
  if (!job || !agentOwnsJob(job, row)) {
    return res.status(404).json({ error: "Job not found" });
  }
  if (!job.inputPath || !fs.existsSync(job.inputPath)) {
    // Platform jobs: agent must download itself
    if (job.options?.sourceUrl && job.options?.sourceKind === "platform") {
      return res.status(409).json({
        error: "Brak pliku na chmurze — pobierz sourceUrl lokalnie (yt-dlp)",
        sourceUrl: job.options.sourceUrl,
        sourceKind: "platform",
      });
    }
    return res.status(404).json({ error: "Brak pliku źródłowego na serwerze" });
  }
  const st = fs.statSync(job.inputPath);
  if (st.size < 64) {
    return res.status(404).json({ error: "Plik źródłowy pusty na serwerze" });
  }
  // sendFile is more reliable for agents than res.download (Content-Disposition)
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(st.size));
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="input' +
      (path.extname(job.originalName || "") || ".mp4") +
      '"'
  );
  res.sendFile(path.resolve(job.inputPath));
});

app.post("/api/studio/agent/jobs/:id/progress", async (req, res) => {
  const row = await requireAgent(req, res);
  if (!row) return;
  const job = studioJobs.getJob(req.params.id);
  if (!job || !agentOwnsJob(job, row)) {
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

app.post("/api/studio/agent/jobs/:id/fail", async (req, res) => {
  const row = await requireAgent(req, res);
  if (!row) return;
  const job = studioJobs.getJob(req.params.id);
  if (!job || !agentOwnsJob(job, row)) {
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

/**
 * Large PC results: no video upload to free cloud (500 MB limit).
 * Agent serves files from 127.0.0.1; UI streams from local disk.
 */
app.post("/api/studio/agent/jobs/:id/complete-local", async (req, res) => {
  try {
    const row = await requireAgent(req, res);
    if (!row) return;
    const job = studioJobs.getJob(req.params.id);
    if (!job || !agentOwnsJob(job, row)) {
      return res.status(404).json({ error: "Job not found" });
    }
    const lm = req.body?.localMedia || {};
    const host = String(lm.host || "127.0.0.1").replace(/[^\w.:[\]]/g, "");
    const port = Number(lm.port) || 0;
    const token = String(lm.token || "").trim();
    if (!port || port < 1 || port > 65535 || !token || token.length < 8) {
      return res.status(400).json({ error: "Brak localMedia (host/port/token)" });
    }
    // Only loopback — never accept remote hosts (security)
    if (!/^(127\.0\.0\.1|localhost|::1)$/i.test(host)) {
      return res.status(400).json({ error: "localMedia.host musi być 127.0.0.1" });
    }
    let result = req.body?.result || {};
    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch {
        result = {};
      }
    }
    const patch = {
      status: "done",
      progress: 100,
      stage: "Gotowe (dysk PC)",
      finishedAt: new Date().toISOString(),
      // No cloud video files — free tier 500 MB avoided
      outputPath: null,
      previewPath: null,
      localMedia: {
        host,
        port,
        token,
        hasOriginal: !!lm.hasOriginal,
        hasPreview: !!lm.hasPreview,
        hasSrt: !!lm.hasSrt,
        resultBytes: Number(lm.resultBytes) || 0,
        originalBytes: Number(lm.originalBytes) || 0,
        resultPath: lm.resultPath ? String(lm.resultPath).slice(0, 400) : null,
        originalPath: lm.originalPath
          ? String(lm.originalPath).slice(0, 400)
          : null,
        userCopyPath: lm.userCopyPath
          ? String(lm.userCopyPath).slice(0, 400)
          : null,
      },
      result: {
        ...(job.result || {}),
        ...result,
        localDisk: true,
      },
      log:
        "Wynik na dysku PC (localhost:" +
        port +
        ") — podgląd/porównanie bez limitu 500 MB chmury." +
        (lm.userCopyPath ? " Kopia: " + String(lm.userCopyPath).slice(0, 120) : ""),
    };
    studioJobs.updateJob(job.id, patch);
    res.json({ ok: true, job: studioJobs.publicJob(studioJobs.getJob(job.id)) });
  } catch (err) {
    console.error("complete-local:", err);
    res.status(500).json({ error: err.message || "complete-local" });
  }
});

app.post(
  "/api/studio/agent/jobs/:id/complete",
  (req, res, next) => {
    // multer for agent upload
    const agentOut = multer({
      storage: multer.diskStorage({
        destination: (_req, file, cb) => {
          studioJobs.ensureDirs();
          // original (YouTube source) → uploads; results → outputs
          if (file.fieldname === "original") {
            cb(null, studioJobs.UPLOAD_DIR);
          } else {
            cb(null, studioJobs.OUTPUT_DIR);
          }
        },
        filename: (_req, file, cb) => {
          const id = String(_req.params.id || "out");
          if (file.fieldname === "preview") cb(null, `studio_${id}_preview.jpg`);
          else if (file.fieldname === "srt") cb(null, `studio_${id}.srt`);
          else if (file.fieldname === "original") {
            const ext = path.extname(file.originalname || "") || ".mp4";
            cb(null, `studio_${id}_original${ext}`);
          } else cb(null, `studio_${id}.mp4`);
        },
      }),
      limits: { fileSize: 500 * 1024 * 1024 },
    });
    agentOut.fields([
      { name: "video", maxCount: 1 },
      { name: "preview", maxCount: 1 },
      { name: "srt", maxCount: 1 },
      { name: "original", maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        // Multer LIMIT_FILE_SIZE etc. — fail fast, don't hang the agent forever
        console.error("agent complete multer:", err.code || err.message);
        return res.status(413).json({
          error:
            err.code === "LIMIT_FILE_SIZE"
              ? "Plik przekracza limit 500 MB na chmurze (wynik lub oryginał do porównania). Agent powinien użyć complete-local (dysk PC)."
              : err.message || "Błąd uploadu",
          code: err.code || "UPLOAD_ERROR",
          useLocalDisk: true,
        });
      }
      next();
    });
  },
  async (req, res) => {
    const row = await requireAgent(req, res);
    if (!row) return;
    const job = studioJobs.getJob(req.params.id);
    if (!job || !agentOwnsJob(job, row)) {
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
    const original = req.files?.original?.[0];
    if (srt) result.srtPath = srt.path;
    // YouTube/platform: store source so UI can compare PRZED/PO
    const patch = {
      status: "done",
      progress: 100,
      stage: "Gotowe",
      finishedAt: new Date().toISOString(),
      outputPath: video.path,
      previewPath: preview ? preview.path : job.previewPath,
      localMedia: null,
      result: { ...(job.result || {}), ...result },
      log: "Wynik z Twojego PC zapisany w chmurze (UI bez przekierowania).",
    };
    if (original && original.path) {
      patch.inputPath = original.path;
      patch.log =
        "Wynik + oryginał z PC zapisane w chmurze (porównanie PRZED/PO).";
    }
    studioJobs.updateJob(job.id, patch);
    res.json({ ok: true, job: studioJobs.publicJob(studioJobs.getJob(job.id)) });
  }
);

app.get("/api/studio/languages", (_req, res) => {
  const { listLanguageModels } = require("./lib/lang-utils");
  res.json(listLanguageModels());
});

/** Ollama status for Studio UI (local rewrite option). */
app.get("/api/studio/ollama-status", async (_req, res) => {
  try {
    const { probeOllamaStatus } = require("./lib/lang-utils");
    const st =
      typeof probeOllamaStatus === "function"
        ? await probeOllamaStatus()
        : { ok: false, online: false, model: null };
    res.json(st);
  } catch {
    res.json({ ok: false, online: false, model: null });
  }
});

/** Whisper install status for Studio UI (local STT — separate from Ollama). */
app.get("/api/studio/whisper-status", async (_req, res) => {
  try {
    // Prefer Node transformers.js (works without pip / Python 3.14 issues)
    try {
      const { probeWhisperNode } = require("./lib/stt-whisper-node");
      const nodeSt = await probeWhisperNode();
      if (nodeSt && nodeSt.ok) {
        return res.json({
          ok: true,
          engine: nodeSt.engine || "transformers.js",
          model: nodeSt.model || "base",
          via: "node",
        });
      }
    } catch {
      /* try python */
    }
    const { spawnSync } = require("child_process");
    const py =
      process.env.PYTHON ||
      process.env.PYTHON_PATH ||
      (process.platform === "win32" ? "python" : "python3");
    const code = `
import json
out={"ok":False,"engine":None,"error":None,"modelDefault":"base"}
try:
  from faster_whisper import WhisperModel
  out["ok"]=True
  out["engine"]="faster-whisper"
except Exception as e1:
  try:
    import whisper
    out["ok"]=True
    out["engine"]="openai-whisper"
  except Exception as e2:
    out["error"]="npm install @xenova/transformers  (lub pip install faster-whisper)"
print(json.dumps(out))
`;
    const r = spawnSync(py, ["-c", code], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    const raw = String(r.stdout || "").trim();
    let st = { ok: false, engine: null, error: null };
    try {
      const line = raw.split(/\r?\n/).filter(Boolean).pop();
      st = JSON.parse(line || "{}");
    } catch {
      st = {
        ok: false,
        error:
          (r.stderr || raw || "Whisper: zainstaluj @xenova/transformers").slice(
            0,
            240
          ),
      };
    }
    st.python = py;
    st.via = st.ok ? "python" : null;
    res.json(st);
  } catch (e) {
    res.json({ ok: false, error: (e && e.message) || String(e) });
  }
});

/**
 * Shared pre-job STT + optional exact translate (file path on disk).
 */
async function runPreTranscribeOnFile(videoPath, {
  sourceLang = "auto",
  targetLang = "pl",
  autoTranslate = true,
  timedTranscript = true,
  speechPace = "normal",
  textSpeechPace = null,
  maxSeconds = 10800,
  originalName = "video.mp4",
  workDir = null,
  smartRewrite = true,
  useOllama = true,
  sttEngine = "google",
  whisperModel = null,
  transcriptSource = "stt",
} = {}) {
  const {
    extractSpeechFromVideoSegmented,
    translateText,
    joinSpeechTexts,
    distributeTextOnTimeline,
    stripTimedMarkers,
    buildTimedScriptFromText,
    buildExactTranscriptSegments,
    formatExactTranscript,
  } = require("./lib/lang-utils");
  // joinSpeechTexts may not exist on older agent copies — local fallback
  const stitch =
    typeof joinSpeechTexts === "function"
      ? joinSpeechTexts
      : (arr) =>
          (arr || [])
            .map((t) => String(t || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" ");

  const wd =
    workDir ||
    path.join(
      studioJobs.WORK_DIR || path.join(__dirname, "data", "studio", "work"),
      "pre_stt_" + Date.now().toString(36)
    );
  fs.mkdirSync(wd, { recursive: true });

  /** Same format as lektor field: [00:00.50 → 00:03.20] text */
  function formatTimed(segs) {
    if (typeof formatExactTranscript === "function") {
      return formatExactTranscript(segs);
    }
    if (!Array.isArray(segs) || !segs.length) return "";
    return segs
      .filter((s) => s && String(s.text || "").trim())
      .map((s) => {
        const a = Number(s.start) || 0;
        const b = Math.max(a + 0.25, Number(s.end) || a + 1);
        const mm = (x) => {
          const m0 = Math.floor(x / 60);
          const s0 = (x - m0 * 60).toFixed(2).padStart(5, "0");
          return String(m0).padStart(2, "0") + ":" + s0;
        };
        return `[${mm(a)} → ${mm(b)}] ${String(s.text).replace(/\s+/g, " ").trim()}`;
      })
      .join("\n");
  }

  let durationSec = 0;
  try {
    const { ffmpegPath } = require("./lib/studio-pipeline");
    const ff = ffmpegPath();
    const { spawnSync } = require("child_process");
    const pr = spawnSync(ff, ["-hide_banner", "-i", videoPath], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    const errOut = (pr.stderr || "") + (pr.stdout || "");
    const m =
      errOut.match(/Duration:\s*(\d+):(\d+):(\d+[.,]\d+)/) ||
      errOut.match(/Duration:\s*(\d+):(\d+):(\d+)\b/);
    if (m) {
      const sec = Number(String(m[3]).replace(",", "."));
      durationSec =
        Number(m[1]) * 3600 + Number(m[2]) * 60 + (Number.isFinite(sec) ? sec : 0);
    }
  } catch {
    /* ignore probe */
  }

  // ALWAYS scan the whole film (not capped at 10 min). Hard max 3 h.
  const hardMax = Math.min(10800, Math.max(5, Number(maxSeconds) || 10800));
  const maxScan =
    durationSec > 0.5
      ? Math.min(durationSec + 1.5, hardMax)
      : hardMax;
  // Full-film STT: long recognition windows (15s) + hop 8s — 3s was too short (incomplete text)
  // After STT, text is packed onto 3s timeline for display/lektor separately
  // whisper | google — separate engines (Whisper ≠ Ollama)
  const engine =
    String(sttEngine || transcriptSource || "google").toLowerCase() ===
      "whisper" ||
    String(transcriptSource || "").toLowerCase() === "whisper"
      ? "whisper"
      : "google";
  const sttOpts = {
    maxSeconds: maxScan,
    noEarlyExit: true,
    minScanRatio: 0.99,
    hopSec: 8,
    segmentSec: 8,
    sttWindowSec: 15,
    sttEngine: engine,
    whisperModel:
      whisperModel || process.env.WHISPER_MODEL || "base",
  };
  let stt = extractSpeechFromVideoSegmented(videoPath, {
    sourceLang,
    workDir: path.join(wd, "stt"),
    ...sttOpts,
  });
  let originalText = stitch([stt.text]);
  // Google: retry lang variants. Whisper already did full pass — skip multi-lang spam.
  if (!originalText && engine !== "whisper" && sourceLang && sourceLang !== "auto") {
    stt = extractSpeechFromVideoSegmented(videoPath, {
      sourceLang: "auto",
      workDir: path.join(wd, "stt_auto"),
      ...sttOpts,
    });
    originalText = stitch([stt.text]);
  }
  if (!originalText && engine !== "whisper") {
    for (const langTry of ["en", "pl"]) {
      if (sourceLang === langTry) continue;
      stt = extractSpeechFromVideoSegmented(videoPath, {
        sourceLang: langTry,
        workDir: path.join(wd, "stt_" + langTry),
        ...sttOpts,
      });
      originalText = stitch([stt.text]);
      if (originalText) break;
    }
  }

  const titleGuess = String(originalName || "video")
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim()
    .slice(0, 120);

  const segs = Array.isArray(stt.timelineSegments) ? stt.timelineSegments : [];
  let timedOriginal = formatTimed(segs);

  if (!originalText) {
    return {
      ok: true,
      text: "",
      originalText: "",
      timedText: "",
      timedOriginal: "",
      title: titleGuess,
      translated: false,
      engine: stt.engine || null,
      langCode: stt.langCode || sourceLang || null,
      targetLang,
      durationSec: durationSec || stt.audioDuration || null,
      segments: segs.length,
      error: stt.error || "Brak rozpoznanej mowy",
      musicLikely: !!stt.musicLikely,
      workDir: wd,
    };
  }

  let text = originalText;
  let timedText = timedOriginal;
  let translated = false;
  let translateEngine = null;
  let translateError = null;
  const srcForTr = stt.langCode || sourceLang || "auto";

  // Real film length only — never invent longer than probed video
  const filmDur = Math.max(
    1,
    durationSec > 0.5
      ? durationSec
      : Number(stt.audioDuration) > 0.5
        ? Number(stt.audioDuration)
        : Math.min(maxScan, hardMax) || 30
  );

  // Text for translation must not "speak longer" than the film (~13 chars/s).
  // UI: smartRewrite + useOllama (default on).
  const {
    formatEditField8sTranscript,
    buildEditField8sSegments,
    fitTextToFilmDuration: fitFilm,
    fitTextToFilmDurationAsync: fitFilmAsync,
  } = require("./lib/lang-utils");
  const fitOpts = {
    smartRewrite: smartRewrite !== false,
    useOllama: useOllama !== false,
    returnMeta: true,
  };
  let rewriteEngine = null;
  let ollamaModel = null;
  async function fitWithMeta(t) {
    if (!(filmDur > 0.5) || !t) return t;
    try {
      if (typeof fitFilmAsync === "function") {
        const r = await fitFilmAsync(t, filmDur, fitOpts);
        if (r && typeof r === "object" && r.text != null) {
          if (r.engine) rewriteEngine = r.engine;
          if (r.ollamaModel) ollamaModel = r.ollamaModel;
          return r.text || t;
        }
        return r || t;
      }
      if (typeof fitFilm === "function") return fitFilm(t, filmDur) || t;
    } catch {
      if (typeof fitFilm === "function") return fitFilm(t, filmDur) || t;
    }
    return t;
  }
  originalText = await fitWithMeta(originalText);
  text = originalText;

  if (autoTranslate) {
    try {
      const plainSrc =
        typeof stripTimedMarkers === "function"
          ? stripTimedMarkers(originalText)
          : originalText;
      const tr = await translateText(plainSrc, srcForTr, targetLang, null, {
        force: true,
      });
      if (tr && tr.ok && tr.text && String(tr.text).trim()) {
        text = stitch([tr.text]);
        translated = !tr.skipped;
        translateEngine = (tr.engine || "nmt") + "+timeline";
        // Target language may expand — re-rewrite so speech still ≤ film
        text = await fitWithMeta(text);
      } else if (tr && tr.error) {
        translateError = tr.error;
      }
    } catch (te) {
      translateError = (te && te.message) || String(te);
    }
  }

  // EDIT FIELD ONLY: 8 equal parts over film duration. Does not drive lektor/TTS.
  const paceKey = textSpeechPace || speechPace || "manual";
  const sttSlots =
    (Array.isArray(stt.timelineSegments) && stt.timelineSegments.length
      ? stt.timelineSegments
      : null) ||
    (Array.isArray(stt.segments) && stt.segments.length
      ? stt.segments
      : null) ||
    [];
  let exactCueCount = 0;
  let transcriptMode = "plain";

  if (typeof formatEditField8sTranscript === "function") {
    timedOriginal = formatEditField8sTranscript(originalText, sttSlots, {
      durationSec: filmDur,
      maxDurationSec: filmDur,
    });
    timedText = formatEditField8sTranscript(text, sttSlots, {
      durationSec: filmDur,
      maxDurationSec: filmDur,
    });
    const nSegs =
      (typeof buildEditField8sSegments === "function" &&
        buildEditField8sSegments(sttSlots, text, {
          durationSec: filmDur,
          maxDurationSec: filmDur,
        })) ||
      [];
    exactCueCount = nSegs.length || timedText.split(/\n/).filter((l) => l.trim()).length;
    transcriptMode = "edit-field-hop6s";
  } else if (typeof buildTimedScriptFromText === "function") {
    const exactOrig = buildTimedScriptFromText({
      text: originalText,
      sttSegments: sttSlots,
      durationSec: filmDur,
      speechPace: paceKey,
    });
    timedOriginal = formatTimed(exactOrig.segments || []);
    exactCueCount = (exactOrig.segments || []).filter((s) => s && s.text).length;
    transcriptMode = exactOrig.mode || transcriptMode;
    const exactTr = buildTimedScriptFromText({
      text: text,
      sttSegments: sttSlots,
      durationSec: filmDur,
      speechPace: paceKey,
    });
    timedText = formatTimed(exactTr.segments || []);
  }

  // Field: timed 8s lines when option on; plain continuous when off. Lektor unchanged.
  const useTimed = timedTranscript !== false;
  const primaryText =
    useTimed && timedText
      ? timedText
      : useTimed && timedOriginal
        ? timedOriginal
        : text;
  const primaryOriginal =
    useTimed && timedOriginal ? timedOriginal : originalText;

  const trLineCount = timedText
    ? timedText.split(/\r?\n/).filter((l) => l.trim()).length
    : 0;
  const charCount = String(text || "").replace(/\s+/g, " ").trim().length;

  return {
    ok: true,
    text: primaryText,
    originalText: primaryOriginal,
    timedText: useTimed ? timedText : "",
    timedOriginal: useTimed ? timedOriginal : "",
    plainText: text,
    plainOriginal: originalText,
    title: titleGuess,
    translated,
    translateEngine,
    translateError,
    autoTranslate: !!autoTranslate,
    timedTranscript: useTimed,
    speechPace: paceKey,
    engine: stt.engine || null,
    langCode: stt.langCode || sourceLang || null,
    targetLang,
    durationSec: filmDur,
    segments: exactCueCount || trLineCount || 0,
    exactCueCount,
    transcriptMode,
    charsPerSegment:
      trLineCount > 0
        ? Math.round((charCount / trLineCount) * 10) / 10
        : null,
    error: null,
    musicLikely: !!stt.musicLikely,
    smartRewrite: fitOpts.smartRewrite,
    useOllama: fitOpts.useOllama,
    rewriteEngine,
    ollamaModel,
    workDir: wd,
  };
}

/**
 * Pre-job STT + exact translate → fill narrator script.
 * - multipart: video file
 * - JSON/multipart field url: direct file or platform (PC agent)
 */
app.post("/api/studio/transcribe", (req, res) => {
  const ct = String(req.headers["content-type"] || "");
  const isJson = ct.includes("application/json");

  const handle = async (file, body) => {
    const uid = studioUserId(req);
    if (auth.isAuthRequired() && !uid) {
      return res.status(401).json({ error: "Wymagane logowanie" });
    }
    const email = req.user?.email || null;
    const sourceLang = String(body?.sourceLang || "auto").trim() || "auto";
    const targetLang = String(body?.targetLang || "pl").trim() || "pl";
    const autoTranslate =
      body?.autoTranslate == null ||
      body?.autoTranslate === "" ||
      body?.autoTranslate === "1" ||
      body?.autoTranslate === "true" ||
      body?.autoTranslate === true;
    const maxSeconds = Math.min(
      10800,
      Math.max(5, Number(body?.maxSeconds) || 10800)
    );
    const timedTranscript =
      body?.timedTranscript == null ||
      body?.timedTranscript === "" ||
      body?.timedTranscript === "1" ||
      body?.timedTranscript === "true" ||
      body?.timedTranscript === true;
    const smartRewrite =
      body?.smartRewrite == null ||
      body?.smartRewrite === "" ||
      body?.smartRewrite === "1" ||
      body?.smartRewrite === "true" ||
      body?.smartRewrite === true;
    const useOllama =
      body?.useOllama == null ||
      body?.useOllama === "" ||
      body?.useOllama === "1" ||
      body?.useOllama === "true" ||
      body?.useOllama === true;
    const speechPace = String(
      body?.speechPace || body?.textSpeechPace || body?.textSpeedMode || "normal"
    )
      .trim()
      .toLowerCase() || "normal";
    // stt/google | whisper | captions
    let transcriptSource = String(body?.transcriptSource || "stt")
      .trim()
      .toLowerCase();
    if (transcriptSource !== "captions" && transcriptSource !== "whisper") {
      transcriptSource = "stt";
    }
    const sttEngine =
      transcriptSource === "whisper" ||
      String(body?.sttEngine || "").toLowerCase() === "whisper"
        ? "whisper"
        : "google";
    const whisperModel = String(
      body?.whisperModel || process.env.WHISPER_MODEL || "base"
    ).trim() || "base";
    const url = String(body?.url || "").trim();

    // ── URL path (no uploaded file) ──
    if ((!file || !file.path) && url) {
      const urlVideo = require("./lib/url-video");
      const classified = urlVideo.classifyVideoUrl(url);
      if (!classified.ok) {
        return res.status(400).json({ error: classified.error });
      }

      // Platform (YouTube/…) → PC agent only
      if (classified.kind === "platform") {
        const online = pcAgent.isOnline(uid, email);
        if (!online) {
          return res.status(400).json({
            error:
              "Wyodrębnianie z " +
              (classified.platform || "platformy") +
              " wymaga PC · ON. Odpal agenta, potem spróbuj ponownie — albo wrzuć plik lokalnie.",
            needPcAgent: true,
            platform: classified.platform || null,
          });
        }
        const titleGuess =
          (classified.platform || "Platform") +
          " " +
          new Date().toISOString().slice(0, 10) +
          ".mp4";
        const options = normalizeJobOptions(
          {
            preTranscribeOnly: true,
            narrator: false,
            subtitles: false,
            delogo: false,
            upscale: "off",
            polish: false,
            sourceUrl: url.slice(0, 800),
            sourceKind: "platform",
            sourcePlatform: classified.platform || null,
            sourceLang,
            targetLang,
            autoTranslate: !!autoTranslate,
            timedTranscript: !!timedTranscript,
            smartRewrite: !!smartRewrite,
            useOllama: !!useOllama,
            transcriptSource,
            sttEngine,
            whisperModel,
            speechPace,
            textSpeechPace: speechPace,
            textSpeedMode: speechPace,
            maxSeconds,
          },
          titleGuess
        );
        const job = studioJobs.createJob({
          originalName: titleGuess,
          inputPath: null,
          options,
          userId: uid || "local",
          email,
          executor: "pc",
        });
        return res.status(202).json({
          ok: true,
          pending: true,
          jobId: job.id,
          job: studioJobs.publicJob(job),
          transcriptSource,
          hint:
            transcriptSource === "captions"
              ? "Agent PC pobiera napisy z filmu (YouTube) — tekst wpadnie do pola."
              : "Agent PC pobiera wideo i rozpoznaje mowę z dźwięku (STT) — bez napisów YouTube.",
        });
      }

      // Direct file URL → download on server then STT
      let dest = null;
      let workDir = null;
      try {
        studioJobs.ensureDirs();
        const tmpName =
          "trurl_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 8) +
          ".bin";
        dest = path.join(studioJobs.UPLOAD_DIR, tmpName);
        res.setTimeout(300000);
        const info = await urlVideo.downloadDirectVideo(url, dest);
        const finalName = info.originalName || "video.mp4";
        const result = await runPreTranscribeOnFile(dest, {
          sourceLang,
          targetLang,
          autoTranslate,
          timedTranscript,
          smartRewrite,
          useOllama,
          sttEngine,
          whisperModel,
          transcriptSource,
          speechPace,
          textSpeechPace: speechPace,
          maxSeconds,
          originalName: finalName,
        });
        workDir = result.workDir;
        delete result.workDir;
        return res.json(result);
      } catch (e) {
        console.error("[transcribe url]", e);
        return res.status(400).json({
          error: (e && e.message) || "Nie udało się pobrać / przepisać z linku",
        });
      } finally {
        try {
          if (dest && fs.existsSync(dest)) fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        try {
          if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }

    if (!file || !file.path) {
      return res.status(400).json({
        error:
          "Brak pliku lub linku — wrzuć wideo / wklej URL w kolumnie 1, potem wyodrębnij.",
      });
    }

    const videoPath = file.path;
    const originalName = file.originalname || "video.mp4";
    let workDir = null;
    try {
      const result = await runPreTranscribeOnFile(videoPath, {
        sourceLang,
        targetLang,
        autoTranslate,
        timedTranscript,
        smartRewrite,
        useOllama,
        sttEngine,
        whisperModel,
        transcriptSource,
        speechPace,
        textSpeechPace: speechPace,
        maxSeconds,
        originalName,
      });
      workDir = result.workDir;
      delete result.workDir;
      return res.json(result);
    } catch (e) {
      console.error("[transcribe]", e);
      return res.status(500).json({
        error: (e && e.message) || "Transkrypcja nieudana",
      });
    } finally {
      try {
        if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      } catch {
        /* ignore */
      }
      try {
        if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  };

  if (isJson) {
    return handle(null, req.body || {}).catch((e) => {
      console.error("[transcribe json]", e);
      res.status(500).json({ error: e.message || "Transkrypcja nieudana" });
    });
  }

  studioUpload.single("video")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    try {
      await handle(req.file, {
        ...(req.body || {}),
        // allow url field alongside empty file
        url: req.body?.url || req.body?.sourceUrl,
      });
    } catch (e) {
      console.error("[transcribe mp]", e);
      res.status(500).json({ error: e.message || "Transkrypcja nieudana" });
    }
  });
});

/** Agent finishes pre-transcribe-only job (no result video). */
app.post("/api/studio/agent/jobs/:id/complete-transcript", async (req, res) => {
  try {
    const row = await requireAgent(req, res);
    if (!row) return;
    const job = studioJobs.getJob(req.params.id);
    if (!job || !agentOwnsJob(job, row)) {
      return res.status(404).json({ error: "Job not found" });
    }
    const body = req.body || {};
    const text = String(body.text || body.script || "").trim();
    const originalText = String(body.originalText || text).trim();
    const timedText = String(body.timedText || "").trim();
    const timedOriginal = String(body.timedOriginal || "").trim();
    studioJobs.updateJob(job.id, {
      status: "done",
      progress: 100,
      stage: "Transkrypcja gotowa",
      finishedAt: new Date().toISOString(),
      outputPath: null,
      previewPath: null,
      liveScript: text || originalText,
      liveOriginal: originalText,
      livePhase: "done",
      result: {
        ...(job.result || {}),
        // Always continuous plain for UI field (strip any accidental time lines)
        script: text || originalText,
        scriptPlain:
          body.plainText ||
          text ||
          originalText,
        plainText: body.plainText || text || originalText,
        originalText,
        timedScript: timedText || null,
        timedOriginal: timedOriginal || null,
        exactCueCount: body.exactCueCount || body.segments || null,
        transcriptMode: body.transcriptMode || null,
        segments: body.exactCueCount || body.segments || null,
        preTranscribe: true,
        language: {
          original: originalText,
          translated: !!body.translated,
          sourceLang: body.langCode
            ? { code: body.langCode, label: body.langCode }
            : null,
          targetLang: body.targetLang
            ? { code: body.targetLang, label: body.targetLang }
            : null,
          timedScript: timedText || null,
          timedOriginal: timedOriginal || null,
        },
        engine: body.engine || null,
        duration: body.durationSec || null,
        smartRewrite: body.smartRewrite != null ? !!body.smartRewrite : true,
        useOllama: body.useOllama != null ? !!body.useOllama : true,
        rewriteEngine: body.rewriteEngine || null,
        ollamaModel: body.ollamaModel || null,
      },
      log:
        "Pre-STT z linku OK · " +
        (text || originalText).slice(0, 80) +
        ((text || originalText).length > 80 ? "…" : ""),
    });
    res.json({ ok: true, job: studioJobs.publicJob(studioJobs.getJob(job.id)) });
  } catch (err) {
    console.error("complete-transcript:", err);
    res.status(500).json({ error: err.message || "complete-transcript" });
  }
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

/**
 * Available codec export profiles for result panel (H.264 High / HEVC / AAC).
 */
app.get("/api/studio/export-profiles", (_req, res) => {
  try {
    const { availableProfiles } = require("./lib/export-codecs");
    res.json(availableProfiles());
  } catch (e) {
    res.status(500).json({ error: e.message || "export-profiles" });
  }
});

/**
 * Re-encode finished job with best codecs for apps (FacePub / Reels / TikTok).
 * Query: ?profile=app|hq|hevc|audio
 */
app.get("/api/studio/jobs/:id/export", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  if (job.status !== "done") {
    return res.status(404).json({ error: "Job nie jest gotowy" });
  }
  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    // Local-disk agent result: no server file to re-encode
    if (job.localMedia) {
      return res.status(400).json({
        error:
          "Wynik jest na dysku PC (agent). Otwórz folder / użyj «Pobierz MP4», albo przenieś job na serwer, żeby przeenkodować kodeki.",
        localDisk: true,
      });
    }
    return res.status(404).json({ error: "Brak gotowego pliku wideo" });
  }
  const profile = String(req.query.profile || "app").toLowerCase();
  try {
    const { exportWithProfile, PROFILES } = require("./lib/export-codecs");
    const result = exportWithProfile(job.outputPath, profile);
    const base = (job.originalName || "clip").replace(/\.[^.]+$/, "");
    const p = PROFILES[profile] || PROFILES.app || result.profile;
    const name =
      base +
      "_clipforge_" +
      (p.id || profile) +
      (p.ext || path.extname(result.path) || ".mp4");
    if (p.mime) res.setHeader("Content-Type", p.mime);
    res.setHeader("X-ClipForge-Export-Profile", p.id || profile);
    res.setHeader("X-ClipForge-Export-Reused", result.reused ? "1" : "0");
    return sendOwnedFile(req, res, result.path, name);
  } catch (e) {
    console.error("[export codecs]", e.message || e);
    return res.status(500).json({
      error: e.message || "Eksport kodeków nieudany",
    });
  }
});

/**
 * Extract audio only (mp3) from finished result video.
 * Cached next to output as *_audio.mp3. Local-disk jobs use agent /media/.../audio.mp3 instead.
 */
function extractAudioMp3(videoPath, outPath) {
  const { spawnSync } = require("child_process");
  let ff = "ffmpeg";
  try {
    const { ffmpegPath } = require("./lib/studio-pipeline");
    ff = ffmpegPath() || "ffmpeg";
  } catch {
    /* PATH fallback */
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Prefer re-encode mp3 (universal). Fall back to AAC in m4a if lame missing.
  let r = spawnSync(
    ff,
    [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "3",
      "-ar",
      "44100",
      outPath,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 600000, maxBuffer: 8 * 1024 * 1024 }
  );
  if ((r.status || 0) === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 200) {
    return outPath;
  }
  const m4a = outPath.replace(/\.mp3$/i, ".m4a");
  r = spawnSync(
    ff,
    ["-y", "-i", videoPath, "-vn", "-c:a", "aac", "-b:a", "192k", m4a],
    { encoding: "utf8", windowsHide: true, timeout: 600000, maxBuffer: 8 * 1024 * 1024 }
  );
  if ((r.status || 0) === 0 && fs.existsSync(m4a) && fs.statSync(m4a).size > 200) {
    return m4a;
  }
  const err =
    (r.stderr || r.stdout || r.error?.message || "ffmpeg audio extract failed").toString();
  throw new Error(
    "Nie udało się wyodrębnić dźwięku: " + err.slice(-400).replace(/\s+/g, " ")
  );
}

app.get("/api/studio/jobs/:id/audio", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  if (job.status !== "done") {
    return res.status(404).json({ error: "Job nie jest gotowy" });
  }
  // Prefer local agent stream when result lives on PC disk
  const lm = job.localMedia;
  if (lm && lm.host && lm.port && lm.token) {
    const jid = encodeURIComponent(String(job.id));
    const t = encodeURIComponent(String(lm.token));
    return res.redirect(
      302,
      `http://${lm.host}:${lm.port}/media/${jid}/audio.mp3?t=${t}`
    );
  }
  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: "Brak gotowego pliku wideo" });
  }
  try {
    const base = (job.originalName || "clip").replace(/\.[^.]+$/, "");
    const cached = job.outputPath.replace(/\.mp4$/i, "_audio.mp3");
    let audioPath = cached;
    if (!fs.existsSync(cached) || fs.statSync(cached).size < 200) {
      audioPath = extractAudioMp3(job.outputPath, cached);
    }
    const ext = path.extname(audioPath).toLowerCase() || ".mp3";
    const name = base + "_audio" + ext;
    res.setHeader(
      "Content-Type",
      ext === ".m4a" ? "audio/mp4" : "audio/mpeg"
    );
    sendOwnedFile(req, res, audioPath, name);
  } catch (e) {
    console.error("[audio extract]", e.message || e);
    return res.status(500).json({
      error: e.message || "Wyodrębnianie dźwięku nieudane",
    });
  }
});

/** Original upload for before/after compare (owner only; kept while job lives) */
app.get("/api/studio/jobs/:id/original", (req, res) => {
  const job = getOwnedJob(req, res);
  if (!job) return;
  if (!job.inputPath || !fs.existsSync(job.inputPath)) {
    return res.status(404).json({ error: "Brak oryginalnego pliku" });
  }
  const name = job.originalName || "original.mp4";
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  sendOwnedFile(req, res, job.inputPath, name);
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

function normalizeJobOptions(options, originalName) {
  const opts = options && typeof options === "object" ? { ...options } : {};
  if (opts.upscale == null) opts.upscale = "fast";
  if (opts.targetHeight == null) opts.targetHeight = 1080;
  if (opts.speedMode == null) opts.speedMode = "auto";
  opts.originalName = originalName;
  opts.filename = originalName;
  if (opts.narrator == null) opts.narrator = true;
  if (opts.autoTranslate == null) opts.autoTranslate = true;
  // Default: text for translation as timed transcription; false = plain paragraph
  if (opts.timedTranscript == null) opts.timedTranscript = true;
  // stt = recognize speech from audio; captions = YouTube / video subs
  if (
    opts.transcriptSource == null ||
    (opts.transcriptSource !== "captions" && opts.transcriptSource !== "stt")
  ) {
    opts.transcriptSource = "stt";
  }
  // Tempo: auto | off | manual (+ textSpeed 0.5–2.0 step 0.1)
  if (opts.textSpeedMode == null && opts.speechPace == null) {
    opts.textSpeedMode = "manual";
    opts.speechPace = "manual";
  }
  if (opts.speechPace == null) opts.speechPace = opts.textSpeedMode || "manual";
  if (opts.textSpeechPace == null) opts.textSpeechPace = opts.speechPace;
  if (opts.textSpeedMode == null) opts.textSpeedMode = opts.speechPace;
  if (opts.textSpeed != null) {
    let r = Number(opts.textSpeed);
    if (!Number.isFinite(r)) r = 1;
    opts.textSpeed = Math.round(Math.min(2, Math.max(0.5, r)) * 10) / 10;
  } else {
    opts.textSpeed = 1;
  }
  if (!opts.targetLang) opts.targetLang = "pl";
  return opts;
}

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
    options = normalizeJobOptions(options, req.file.originalname);

    const job = studioJobs.createJob({
      originalName: req.file.originalname,
      inputPath: req.file.path,
      options,
      userId: uid || "local",
      email: req.user?.email || null,
    });
    studioJobs.enqueuePump();
    res.status(201).json({ job: studioJobs.publicJob(job) });
  });
});

/**
 * Create job from URL:
 * - direct .mp4/.webm… → cloud downloads, then PC or cloud processes
 * - YouTube/TikTok/… → only when PC agent online; agent downloads with yt-dlp
 */
app.post("/api/studio/jobs/from-url", async (req, res) => {
  try {
    const uid = studioUserId(req);
    if (auth.isAuthRequired() && !uid) {
      return res.status(401).json({ error: "Wymagane logowanie" });
    }
    const url = String(req.body?.url || "").trim();
    if (!url) {
      return res.status(400).json({ error: "Podaj URL wideo" });
    }
    const urlVideo = require("./lib/url-video");
    const classified = urlVideo.classifyVideoUrl(url);
    if (!classified.ok) {
      return res.status(400).json({ error: classified.error });
    }

    let options = {};
    try {
      if (req.body?.options) {
        options =
          typeof req.body.options === "string"
            ? JSON.parse(req.body.options)
            : req.body.options;
      }
    } catch {
      options = {};
    }

    const email = req.user?.email || null;

    // ── Platform (YouTube/TikTok/…) → PC agent only ──
    if (classified.kind === "platform") {
      const online = pcAgent.isOnline(uid, email);
      if (!online) {
        return res.status(400).json({
          error:
            "Link " +
            (classified.platform || "platformy") +
            " wymaga PC · ON. Odpal agenta (⬇ PC / RUN-AGENT.bat), poczekaj na zielony chip i spróbuj ponownie. Bez agenta wklej bezpośredni plik .mp4.",
          needPcAgent: true,
          platform: classified.platform || null,
        });
      }
      const titleGuess =
        (classified.platform || "Platform") +
        " " +
        new Date().toISOString().slice(0, 10) +
        ".mp4";
      options = normalizeJobOptions(options, titleGuess);
      options.sourceUrl = url.slice(0, 800);
      options.sourceKind = "platform";
      options.sourcePlatform = classified.platform || null;

      const job = studioJobs.createJob({
        originalName: titleGuess,
        inputPath: null,
        options,
        userId: uid || "local",
        email,
        executor: "pc",
      });
      // no cloud pump — agent claims
      return res.status(201).json({
        job: studioJobs.publicJob(job),
        fromUrl: true,
        platform: classified.platform,
        executor: "pc",
        hint: "Agent PC pobierze wideo lokalnie (yt-dlp) i zacznie obróbkę.",
      });
    }

    // ── Direct file URL → download on server ──
    studioJobs.ensureDirs();
    const tmpName =
      "url_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8) +
      ".bin";
    const dest = path.join(studioJobs.UPLOAD_DIR, tmpName);

    res.setTimeout(200000);
    const info = await urlVideo.downloadDirectVideo(url, dest);
    const finalName = info.originalName || "video.mp4";
    const finalPath = path.join(
      path.dirname(dest),
      path.basename(dest, path.extname(dest)) +
        (path.extname(finalName) || ".mp4")
    );
    try {
      if (finalPath !== dest) {
        fs.renameSync(dest, finalPath);
      }
    } catch {
      /* keep dest */
    }
    const inputPath = fs.existsSync(finalPath) ? finalPath : dest;
    options = normalizeJobOptions(options, finalName);
    options.sourceUrl = url.slice(0, 500);
    options.sourceKind = "direct";

    const job = studioJobs.createJob({
      originalName: finalName,
      inputPath,
      options,
      userId: uid || "local",
      email,
    });
    studioJobs.enqueuePump();
    res.status(201).json({
      job: studioJobs.publicJob(job),
      fromUrl: true,
      bytes: info.bytes,
      executor: job.executor,
    });
  } catch (err) {
    console.error("from-url:", err);
    res.status(400).json({
      error: err.message || "Nie udało się pobrać wideo z linku",
    });
  }
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

async function start() {
  try {
    const repo = require("./lib/user-repo");
    await repo.initUserRepo();
  } catch (err) {
    console.error("[boot] auth store init failed:", err.message || err);
    if (db.usingPostgres()) {
      console.error(
        "[boot] Sprawdź DATABASE_URL (Neon/Supabase). Konta nie będą działać."
      );
      process.exit(1);
    }
  }

  app.listen(PORT, HOST, () => {
    console.log("");
    console.log("  ClipForge ONLINE  (Studio only — no video hosting library)");
    console.log(`  Studio:  http://127.0.0.1:${PORT}/studio.html`);
    console.log(
      `  Auth:    ${db.usingPostgres() ? "Postgres (trwałe konta)" : "plik users.json (znika po redeploy)"}`
    );
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
}

start().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});

