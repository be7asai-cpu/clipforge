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

// ── Entry: always login first ──────────────────────────────────────────
app.get(["/", "/index.html"], (req, res) => {
  if (isLoggedIn(req)) return res.redirect(302, "/studio.html");
  return res.redirect(302, "/login.html");
});

app.get(["/studio", "/studio.html"], (req, res) => {
  if (!isLoggedIn(req)) {
    return res.redirect(
      302,
      "/login.html?next=" + encodeURIComponent("/studio.html")
    );
  }
  return res.sendFile(path.join(__dirname, "public", "studio.html"));
});

// Old portal URLs → login (not the ClipWave catalog)
app.get(
  ["/second-life.html", "/portal", "/portal.html", "/clips", "/clips.html"],
  (_req, res) => {
    res.redirect(302, "/login.html");
  }
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "clipforge", studio: true });
});

// Never cache HTML (stops Edge/app showing old "Portal" nav)
app.use((req, res, next) => {
  if (/\.html?$/i.test(req.path) || req.path === "/" || req.path === "") {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// Static assets (login, css, js) — studio.html is gated above, not via static
app.use(
  express.static(path.join(__dirname, "public"), {
    index: false,
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (/\.html?$/i.test(filePath)) {
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, max-age=0"
        );
      } else if (/\.(js|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
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
app.use("/api/studio", (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/health")) return next();
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
  res.json({
    ok: true,
    studio: true,
    busy: myBusy,
    myBusy,
    serverBusy,
    multiUser: true,
    uptime: Math.round(process.uptime()),
    pid: process.pid,
  });
});

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
  if (req.path.startsWith("/api/") || req.path.startsWith("/local/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.redirect(302, "/login.html");
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

