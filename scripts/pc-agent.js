/**
 * ClipForge PC Agent — runs on YOUR computer.
 * Browser stays on the cloud website; this process pulls jobs and processes them locally.
 *
 * Usage:
 *   set CLIPFORGE_CLOUD_URL=https://clipforge-45ti.onrender.com
 *   set CLIPFORGE_EMAIL=you@email.com
 *   set CLIPFORGE_PASSWORD=yourpassword
 *   node scripts/pc-agent.js
 *
 * Or with existing token:
 *   set CLIPFORGE_AGENT_TOKEN=...
 *   node scripts/pc-agent.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { spawnSync, spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
// Load local .env if present (optional)
try {
  require("dotenv").config({ path: path.join(ROOT, ".env") });
} catch {
  /* optional */
}

const CLOUD = (
  process.env.CLIPFORGE_CLOUD_URL ||
  process.env.BASE_URL ||
  "https://clipforge-45ti.onrender.com"
).replace(/\/$/, "");

const LABEL = process.env.CLIPFORGE_PC_LABEL || "Mój PC";
const POLL_MS = Number(process.env.CLIPFORGE_AGENT_POLL_MS) || 2500;
const TOKEN_FILE = path.join(ROOT, "data", "auth", "pc-agent.token");
/** Soft limit: above this, keep media on local disk (serve via localhost), not free Render 500 MB */
const CLOUD_SAFE_BYTES = Number(process.env.CLIPFORGE_CLOUD_SAFE_MB || 90) * 1024 * 1024;
const LOCAL_MEDIA_PORT = Number(process.env.CLIPFORGE_LOCAL_PORT) || 17865;

let agentToken = process.env.CLIPFORGE_AGENT_TOKEN || "";
let localMediaServer = null;
let localMediaPort = LOCAL_MEDIA_PORT;
const localMediaToken = crypto.randomBytes(18).toString("hex");
/** @type {Map<string, { result?: string, original?: string, preview?: string, srt?: string }>} */
const localMediaFiles = new Map();

function log(...a) {
  console.log("[PC-Agent]", ...a);
}

/**
 * Serve large results from THIS PC (127.0.0.1) so cloud never hits 500 MB multer limit.
 * Browser on same machine loads video from localhost; metadata stays in cloud UI.
 */
function ensureLocalMediaServer() {
  if (localMediaServer) return localMediaPort;
  const server = http.createServer((req, res) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
      res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.searchParams.get("t") !== localMediaToken) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden — zły token local media");
        return;
      }
      const m = /^\/media\/([a-zA-Z0-9_-]+)\/(result|original|preview|srt|audio)(?:\.[\w]+)?$/i.exec(
        u.pathname
      );
      if (!m) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const jobId = m[1];
      const kind = m[2].toLowerCase();
      const entry = localMediaFiles.get(jobId);
      if (!entry) {
        res.writeHead(404);
        res.end("job media expired or unknown");
        return;
      }
      // On-demand: extract audio-only mp3 from result video
      if (kind === "audio") {
        try {
          let audioPath = entry.audio;
          if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size < 200) {
            const videoPath = entry.result;
            if (!videoPath || !fs.existsSync(videoPath)) {
              res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
              res.end("brak wyniku wideo do wyodrębnienia dźwięku");
              return;
            }
            audioPath = ensureLocalAudioMp3(videoPath);
            entry.audio = audioPath;
          }
          const stA = fs.statSync(audioPath);
          const mimeA = /\.m4a$/i.test(audioPath) ? "audio/mp4" : "audio/mpeg";
          res.writeHead(200, {
            "Content-Length": stA.size,
            "Content-Type": mimeA,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Disposition":
              'attachment; filename="clipforge_audio' +
              (/\.m4a$/i.test(audioPath) ? ".m4a" : ".mp3") +
              '"',
          });
          fs.createReadStream(audioPath).pipe(res);
          return;
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("audio extract: " + (e.message || e));
          return;
        }
      }
      const filePath = entry[kind];
      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("file missing on disk");
        return;
      }
      const st = fs.statSync(filePath);
      const total = st.size;
      const mime =
        kind === "preview"
          ? "image/jpeg"
          : kind === "srt"
            ? "text/plain; charset=utf-8"
            : "video/mp4";
      const range = req.headers.range;
      if (range && kind !== "preview" && kind !== "srt") {
        const mR = /bytes=(\d*)-(\d*)/.exec(range);
        let start = 0;
        let end = total - 1;
        if (mR) {
          if (mR[1]) start = Number(mR[1]);
          if (mR[2]) end = Number(mR[2]);
        }
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
          res.writeHead(416, { "Content-Range": `bytes */${total}` });
          res.end();
          return;
        }
        end = Math.min(end, total - 1);
        const chunk = end - start + 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunk,
          "Content-Type": mime,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, {
        "Content-Length": total,
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      try {
        res.writeHead(500);
        res.end(String(e.message || e));
      } catch {
        /* ignore */
      }
    }
  });
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      localMediaPort = LOCAL_MEDIA_PORT + 1 + Math.floor(Math.random() * 20);
      log("Port local media zajęty — próbuję", localMediaPort);
      try {
        server.listen(localMediaPort, "127.0.0.1");
      } catch (e2) {
        log("Local media server fail:", e2.message || e2);
      }
    } else {
      log("Local media server error:", err.message || err);
    }
  });
  server.listen(localMediaPort, "127.0.0.1", () => {
    log(
      "Local media: http://127.0.0.1:" +
        localMediaPort +
        " (duże wideo z dysku PC, nie z chmury 500 MB)"
    );
  });
  localMediaServer = server;
  return localMediaPort;
}

function registerLocalMedia(jobId, files) {
  ensureLocalMediaServer();
  localMediaFiles.set(String(jobId), {
    result: files.video || null,
    original: files.original || null,
    preview: files.preview || null,
    srt: files.srt || null,
    audio: files.audio || null,
  });
}

/** ffmpeg binary for agent (same as pipeline) */
function agentFfmpegPath() {
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* fall through */
  }
  try {
    const { ffmpegPath } = require(path.join(ROOT, "lib", "studio-pipeline.js"));
    const p = ffmpegPath();
    if (p) return p;
  } catch {
    /* fall through */
  }
  return "ffmpeg";
}

/**
 * Extract audio-only file from result video (cached next to mp4).
 * @returns {string} path to mp3 or m4a
 */
function ensureLocalAudioMp3(videoPath) {
  const { spawnSync } = require("child_process");
  const outMp3 = String(videoPath).replace(/\.mp4$/i, "_audio.mp3");
  if (fs.existsSync(outMp3) && fs.statSync(outMp3).size > 200) return outMp3;
  const ff = agentFfmpegPath();
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
      outMp3,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  if ((r.status || 0) === 0 && fs.existsSync(outMp3) && fs.statSync(outMp3).size > 200) {
    return outMp3;
  }
  const outM4a = String(videoPath).replace(/\.mp4$/i, "_audio.m4a");
  r = spawnSync(
    ff,
    ["-y", "-i", videoPath, "-vn", "-c:a", "aac", "-b:a", "192k", outM4a],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  if ((r.status || 0) === 0 && fs.existsSync(outM4a) && fs.statSync(outM4a).size > 200) {
    return outM4a;
  }
  const err = (r.stderr || r.stdout || r.error?.message || "fail").toString();
  throw new Error("ffmpeg audio: " + err.slice(-300).replace(/\s+/g, " "));
}

function fileSizeSafe(p) {
  try {
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  } catch {
    return 0;
  }
}

/** Copy result to Videos/ClipForge for easy Explorer access */
function publishToUserVideos(jobId, videoPath, originalName, extraFiles) {
  try {
    const dir = path.join(os.homedir(), "Videos", "ClipForge");
    fs.mkdirSync(dir, { recursive: true });
    const base =
      String(originalName || "clip")
        .replace(/[^\w.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/gi, "_")
        .replace(/\.[^.]+$/, "")
        .slice(0, 60) || "clip";
    const dest = path.join(dir, `${base}_${jobId}.mp4`);
    fs.copyFileSync(videoPath, dest);
    // Timed transcription next to video (SRT + plain timed .txt)
    if (extraFiles && extraFiles.srt && fs.existsSync(extraFiles.srt)) {
      try {
        fs.copyFileSync(
          extraFiles.srt,
          path.join(dir, `${base}_${jobId}.srt`)
        );
      } catch (e) {
        log("Kopiowanie SRT:", e.message || e);
      }
    }
    if (extraFiles && extraFiles.transcript && fs.existsSync(extraFiles.transcript)) {
      try {
        fs.copyFileSync(
          extraFiles.transcript,
          path.join(dir, `${base}_${jobId}_transcript.txt`)
        );
      } catch (e) {
        log("Kopiowanie transcript:", e.message || e);
      }
    }
    return dest;
  } catch (e) {
    log("Kopiowanie do Videos/ClipForge:", e.message || e);
    return null;
  }
}

function request(method, urlPath, { body, token, formData, raw, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath.startsWith("http") ? urlPath : CLOUD + urlPath);
    const lib = u.protocol === "https:" ? https : http;
    const headers = {};
    if (!raw) headers.Accept = "application/json";
    if (token) headers.Authorization = "Bearer " + token;
    let payload = null;
    if (formData) {
      Object.assign(headers, formData.headers);
      payload = formData.body;
    } else if (body != null) {
      payload = Buffer.from(JSON.stringify(body), "utf8");
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = payload.length;
    }
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        // Follow redirects (Render / CDN)
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          const next = new URL(res.headers.location, u).href;
          res.resume();
          return resolve(
            request(method, next, {
              body,
              token,
              formData,
              raw,
              maxRedirects: maxRedirects - 1,
            })
          );
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (raw) {
            return resolve({
              status: res.statusCode,
              buf,
              headers: res.headers,
            });
          }
          let data = null;
          try {
            data = JSON.parse(buf.toString("utf8") || "null");
          } catch {
            data = { raw: buf.toString("utf8").slice(0, 200) };
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function ensureToken() {
  if (agentToken) return agentToken;
  if (fs.existsSync(TOKEN_FILE)) {
    agentToken = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (agentToken) return agentToken;
  }
  const email = process.env.CLIPFORGE_EMAIL || process.env.SMTP_USER;
  const password = process.env.CLIPFORGE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Brak CLIPFORGE_AGENT_TOKEN ani CLIPFORGE_EMAIL + CLIPFORGE_PASSWORD"
    );
  }
  log("Logowanie do chmury…", CLOUD);
  const res = await request("POST", "/api/studio/agent/login", {
    body: { email, password, label: LABEL },
  });
  if (res.status >= 400 || !res.data?.token) {
    throw new Error(
      res.data?.error || "Login agenta nieudany (HTTP " + res.status + ")"
    );
  }
  agentToken = res.data.token;
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, agentToken, "utf8");
  log("Zalogowano. Token zapisany.");
  return agentToken;
}

async function heartbeat() {
  const res = await request("POST", "/api/studio/agent/heartbeat", {
    token: agentToken,
    body: { label: LABEL },
  });
  if (res.status === 401) {
    agentToken = "";
    try {
      fs.unlinkSync(TOKEN_FILE);
    } catch {
      /* ignore */
    }
    await ensureToken();
    return heartbeat();
  }
  return res.data;
}

async function claim() {
  const res = await request("POST", "/api/studio/agent/claim", {
    token: agentToken,
    body: {},
  });
  if (res.status >= 400) return null;
  return res.data?.job || null;
}

function findYtDlp() {
  const candidates = [
    path.join(ROOT, "tools", "yt-dlp.exe"),
    path.join(ROOT, "tools", "yt-dlp"),
    process.env.YT_DLP_PATH,
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  // PATH
  const which = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["yt-dlp"],
    { encoding: "utf8", windowsHide: true }
  );
  const line = String(which.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (line && fs.existsSync(line)) return line;
  return null;
}

function downloadFileFollow(url, dest, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      { headers: { "User-Agent": "ClipForge-Agent/1.0" } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          return resolve(downloadFileFollow(next, dest, maxRedirects - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode + " download"));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve(dest));
        });
        file.on("error", reject);
      }
    );
    req.on("error", reject);
  });
}

async function ensureYtDlp() {
  let bin = findYtDlp();
  if (bin) {
    // Reject tiny/corrupt HTML stubs (would cause spawn EFTYPE)
    try {
      const st = fs.statSync(bin);
      if (st.size > 500000) return bin;
      log("yt-dlp podejrzanie mały — pobieram ponownie");
    } catch {
      /* redownload */
    }
  }
  log("Brak yt-dlp — pobieram yt-dlp.exe (GitHub releases)…");
  const toolsDir = path.join(ROOT, "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
  const dest = path.join(toolsDir, "yt-dlp.exe");
  const url =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  try {
    // Prefer curl (stable redirects on Windows)
    const curl = spawnSync(
      "curl.exe",
      ["-L", "--fail", "--retry", "3", "-o", dest, url],
      { encoding: "utf8", windowsHide: true, timeout: 300000 }
    );
    if (curl.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size < 500000) {
      await downloadFileFollow(url, dest);
    }
  } catch (e) {
    await downloadFileFollow(url, dest);
  }
  // Verify MZ header (Windows PE)
  try {
    const fd = fs.openSync(dest, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
      throw new Error("yt-dlp.exe nie jest plikiem EXE (uszkodzony download)");
    }
  } catch (e) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    throw e;
  }
  log("yt-dlp gotowy:", dest, fs.statSync(dest).size, "B");
  return dest;
}

function ffmpegDirForYtDlp() {
  try {
    const ff = require("ffmpeg-static");
    if (ff && fs.existsSync(ff)) return path.dirname(ff);
  } catch {
    /* optional */
  }
  return null;
}

/**
 * Download YouTube/TikTok/… with yt-dlp into destPath (.mp4 preferred).
 */
function ensureFfmpegForAgent() {
  try {
    const ff = require("ffmpeg-static");
    if (ff && fs.existsSync(ff) && fs.statSync(ff).size > 1000000) return ff;
  } catch {
    /* missing */
  }
  // After incomplete setup npm install may not have finished
  throw new Error(
    "Brak ffmpeg-static w agencie (npm install nie dokończony). " +
      "W folderze %LOCALAPPDATA%\\ClipForge-Agent uruchom: npm install --omit=dev " +
      "albo odpal setup .cmd ponownie i DOCEKAJ końca npm (bez zamykania okna)."
  );
}

/**
 * Run yt-dlp async so UI can get progress (spawnSync freezes agent + stuck at 1%).
 * @param {string} bin
 * @param {string[]} args
 * @param {{ onLine?: (line: string) => void, timeoutMs?: number }} [opts]
 */
function runYtDlpAsync(bin, args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 25 * 60 * 1000;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      try {
        if (process.platform === "win32" && child.pid) {
          spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
            windowsHide: true,
          });
        }
      } catch {
        /* ignore */
      }
      if (!settled) {
        settled = true;
        reject(new Error("yt-dlp timeout (" + Math.round(timeoutMs / 1000) + "s)"));
      }
    }, timeoutMs);
    const feed = (buf, isErr) => {
      const s = buf.toString("utf8");
      if (isErr) stderr += s;
      else stdout += s;
      // yt-dlp uses \r progress updates — split both
      const parts = s.split(/\r|\n/);
      for (const line of parts) {
        const t = line.trim();
        if (t && opts.onLine) opts.onLine(t);
      }
    };
    child.stdout.on("data", (d) => feed(d, false));
    child.stderr.on("data", (d) => feed(d, true));
    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          status: code,
          stdout,
          stderr,
        });
      }
    });
  });
}

/**
 * @param {string} sourceUrl
 * @param {string} destPath
 * @param {{ onProgress?: (p: { progress: number, stage?: string, log?: string }) => void }} [hooks]
 */
async function downloadPlatformSource(sourceUrl, destPath, hooks = {}) {
  // Need ffmpeg for merge (video+audio) on YouTube
  let ffPath = null;
  try {
    ffPath = ensureFfmpegForAgent();
  } catch (e) {
    log(String(e.message || e));
    throw e;
  }
  const ytdlp = await ensureYtDlp();
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  // Remove prior attempts
  try {
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  } catch {
    /* ignore */
  }
  // Clean old partial ytdlp files
  try {
    for (const n of fs.readdirSync(dir)) {
      if (n.startsWith("ytdlp_dl.")) {
        try {
          fs.unlinkSync(path.join(dir, n));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  const outTpl = path.join(dir, "ytdlp_dl.%(ext)s");
  // Progressive+audio first (format 18 etc.) — fast, no merge hang.
  // Cap 720p by default: music videos ~5 min @1080 AI freeze for ages; 720 is enough for Studio.
  // Then dash merge <=720, then <=1080, then best.
  const formatAttempts = [
    "18/mp4[height<=720][acodec!=none][vcodec!=none]/best[height<=720][ext=mp4]/best[height<=720]",
    "bv*[height<=720]+ba/b[height<=720]/b",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "best",
  ];
  let lastErr = "";
  let r = null;
  let lastReportAt = 0;
  const reportDl = (pct, msg) => {
    const now = Date.now();
    if (now - lastReportAt < 1500 && pct < 99) return; // throttle cloud posts
    lastReportAt = now;
    // Map download 0–100% → job progress 2–14
    const jobPct = Math.min(14, Math.max(2, 2 + Math.round((pct / 100) * 12)));
    if (typeof hooks.onProgress === "function") {
      hooks.onProgress({
        progress: jobPct,
        stage: "Pobieranie z YouTube…",
        log: msg || "yt-dlp " + Math.round(pct) + "%",
      });
    }
  };
  for (const fmt of formatAttempts) {
    // clean partials between format attempts
    try {
      for (const n of fs.readdirSync(dir)) {
        if (n.startsWith("ytdlp_dl.")) {
          try {
            fs.unlinkSync(path.join(dir, n));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--newline",
      "--ffmpeg-location",
      path.dirname(ffPath),
      "-f",
      fmt,
      "--merge-output-format",
      "mp4",
      "-o",
      outTpl,
      "--restrict-filenames",
      "--retries",
      "5",
      "--fragment-retries",
      "5",
      "--socket-timeout",
      "30",
      "--concurrent-fragments",
      "4",
      String(sourceUrl),
    ];
    log("yt-dlp start…", fmt, String(sourceUrl).slice(0, 70));
    reportDl(0, "Start yt-dlp (" + fmt.slice(0, 40) + "…)");
    try {
      r = await runYtDlpAsync(ytdlp, args, {
        timeoutMs: 25 * 60 * 1000,
        onLine: (line) => {
          // [download]  45.2% of  12.34MiB at ...
          const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
          if (m) {
            const pct = Number(m[1]);
            reportDl(pct, "Pobieranie " + pct.toFixed(0) + "%");
            return;
          }
          if (/\[Merger\]|Merging/i.test(line)) {
            reportDl(95, "Łączenie wideo+audio…");
          }
          if (/Destination:|Downloading/i.test(line)) {
            log("yt-dlp:", line.slice(0, 120));
          }
        },
      });
    } catch (e) {
      lastErr = String(e.message || e);
      log("yt-dlp error:", lastErr.slice(0, 160));
      continue;
    }
    lastErr = String(r.stderr || r.stdout || "").slice(-500);
    const found = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("ytdlp_dl."));
    if (found.length) break;
    log("yt-dlp format fail, next…", lastErr.replace(/\s+/g, " ").slice(-160));
  }
  const errTail = lastErr;
  // Find downloaded file
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("ytdlp_dl."))
    .map((n) => path.join(dir, n));
  if (!files.length) {
    throw new Error(
      "yt-dlp nie pobrał pliku (kod " +
        (r && r.status) +
        "): " +
        errTail.replace(/\s+/g, " ")
    );
  }
  // Prefer mp4
  files.sort((a, b) => {
    const am = a.endsWith(".mp4") ? 0 : 1;
    const bm = b.endsWith(".mp4") ? 0 : 1;
    return am - bm;
  });
  const got = files[0];
  if (got !== destPath) {
    try {
      fs.renameSync(got, destPath);
    } catch {
      fs.copyFileSync(got, destPath);
      try {
        fs.unlinkSync(got);
      } catch {
        /* ignore */
      }
    }
  }
  // cleanup extras
  for (const f of files) {
    if (f !== destPath && fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
  const sz = fs.statSync(destPath).size;
  if (sz < 64) throw new Error("yt-dlp: plik pusty");
  log("yt-dlp OK", destPath, sz, "bytes");
  if (typeof hooks.onProgress === "function") {
    hooks.onProgress({
      progress: 14,
      stage: "Pobrano z platformy",
      log: "Pobrano " + Math.round(sz / 1024) + " KB — start obróbki",
    });
  }
  // Side-channel: captions text for music (STT fails on singing)
  if (hooks.captionsOut && typeof hooks.captionsOut === "object") {
    hooks.captionsOut.text = null;
    hooks.captionsOut.file = null;
  }
  return destPath;
}

/**
 * Parse SRT/VTT timestamp → seconds
 */
function parseCaptionTime(h, m, s, ms) {
  const frac = String(ms || "0").padEnd(3, "0").slice(0, 3);
  return (
    Number(h) * 3600 +
    Number(m) * 60 +
    Number(s) +
    Number(frac) / 1000
  );
}

/**
 * Merge two caption strings without repeating overlapping words.
 * YouTube auto-subs "roll": "hello world" + "world how are" → "hello world how are"
 */
function mergeCaptionOverlap(a, b) {
  const left = String(a || "")
    .replace(/\s+/g, " ")
    .trim();
  const right = String(b || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!left) return right;
  if (!right) return left;
  const la = left.toLowerCase();
  const lb = right.toLowerCase();
  if (la === lb) return left;
  // right already fully contained in left
  if (la.includes(lb) && lb.length >= 4) return left;
  // left contained in right → take longer (rolling growth)
  if (lb.includes(la) && la.length >= 4) return right;
  const wa = left.split(/\s+/).filter(Boolean);
  const wb = right.split(/\s+/).filter(Boolean);
  if (!wa.length) return right;
  if (!wb.length) return left;
  const maxK = Math.min(wa.length, wb.length, 40);
  let best = 0;
  for (let k = maxK; k >= 1; k--) {
    const tail = wa
      .slice(-k)
      .map((x) => x.toLowerCase())
      .join(" ");
    const head = wb
      .slice(0, k)
      .map((x) => x.toLowerCase())
      .join(" ");
    if (tail === head) {
      best = k;
      break;
    }
  }
  if (best >= 1) {
    return (wa.concat(wb.slice(best)).join(" ") || left).replace(/\s+/g, " ").trim();
  }
  return (left + " " + right).replace(/\s+/g, " ").trim();
}

/**
 * Collapse YouTube rolling auto-captions into clean non-duplicated cues.
 * Pattern: cue N contains most of cue N-1 plus a few new words.
 */
function dedupeRollingCaptions(segments) {
  if (!Array.isArray(segments) || !segments.length) return [];
  const ordered = [...segments]
    .filter((s) => s && String(s.text || "").trim())
    .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
  const out = [];
  for (const s of ordered) {
    const text = String(s.text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    if (!out.length) {
      out.push({
        start: Math.max(0, Number(s.start) || 0),
        end: Math.max(
          (Number(s.start) || 0) + 0.2,
          Number(s.end) || (Number(s.start) || 0) + 1
        ),
        text,
        silent: false,
      });
      continue;
    }
    const prev = out[out.length - 1];
    const ps = Number(prev.start) || 0;
    const pe = Number(prev.end) || 0;
    const ss = Number(s.start) || 0;
    const se = Number(s.end) || ss + 1;
    const pt = prev.text;
    const pl = pt.toLowerCase();
    const tl = text.toLowerCase();

    // Exact same text (spam)
    if (pl === tl) {
      prev.end = Math.max(pe, se);
      continue;
    }
    // Rolling: new cue is extension of previous (classic YT ASR)
    if (
      tl.startsWith(pl) ||
      (pl.length >= 8 && tl.includes(pl) && tl.length > pl.length)
    ) {
      prev.text = text.length >= pt.length ? text : pt;
      prev.end = Math.max(pe, se);
      if (ss < prev.start) prev.start = ss;
      continue;
    }
    // Rolling reverse: previous already contains new (display lag)
    if (pl.startsWith(tl) || (tl.length >= 8 && pl.includes(tl))) {
      prev.end = Math.max(pe, se);
      continue;
    }
    // Strong time overlap + word-boundary overlap → merge into one cue
    const timeClose = ss <= pe + 0.85;
    if (timeClose) {
      const merged = mergeCaptionOverlap(pt, text);
      const naive = (pt + " " + text).replace(/\s+/g, " ").trim();
      // If merge removed duplication, absorb; if almost no overlap, still may be new sentence
      if (
        merged === pt ||
        merged === text ||
        merged.length < naive.length * 0.92
      ) {
        prev.text = merged;
        prev.end = Math.max(pe, se);
        if (ss < prev.start) prev.start = Math.min(ps, ss);
        continue;
      }
    }
    out.push({
      start: Math.max(0, ss),
      end: Math.max(ss + 0.2, se),
      text,
      silent: false,
    });
  }
  // Second pass: rebuild plain text with boundary merge (safety)
  // and drop cues that are pure subsets of neighbors
  const cleaned = [];
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    const next = out[i + 1];
    if (
      next &&
      next.text.toLowerCase().includes(cur.text.toLowerCase()) &&
      cur.text.length >= 6 &&
      next.text.length > cur.text.length + 2 &&
      Number(next.start) - Number(cur.end) < 1.2
    ) {
      // cur is prefix of next → skip cur, next will keep full line
      continue;
    }
    if (cleaned.length) {
      const prev = cleaned[cleaned.length - 1];
      const merged = mergeCaptionOverlap(prev.text, cur.text);
      const naive = (prev.text + " " + cur.text).replace(/\s+/g, " ").trim();
      if (
        Number(cur.start) <= Number(prev.end) + 0.6 &&
        (merged === prev.text ||
          merged === cur.text ||
          merged.length < naive.length * 0.9)
      ) {
        prev.text = merged;
        prev.end = Math.max(Number(prev.end) || 0, Number(cur.end) || 0);
        continue;
      }
    }
    cleaned.push({ ...cur });
  }
  return cleaned;
}

/**
 * Join caption cues to continuous plain text without word duplicates.
 */
function captionsToPlainText(segments) {
  let joined = "";
  for (const s of segments || []) {
    const t = String(s && s.text != null ? s.text : "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) continue;
    joined = joined ? mergeCaptionOverlap(joined, t) : t;
  }
  return joined.replace(/\s+/g, " ").trim();
}

/**
 * Parse SRT/VTT into timed segments + plain text (for lektor 1:1 timeline).
 * Dedupes YouTube auto-caption rolling repeats.
 * @returns {{ text: string, segments: {start:number,end:number,text:string}[], file: string }}
 */
function parseCaptionsTimed(filePath) {
  try {
    let raw = fs.readFileSync(filePath, "utf8");
    raw = raw
      .replace(/\uFEFF/g, "")
      .replace(/^WEBVTT[^\n]*\n+/i, "");
    const blocks = raw.split(/\n\s*\n+/);
    const segments = [];
    const timeRe =
      /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
    for (const b of blocks) {
      const ls = b
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!ls.length) continue;
      let timeLine = null;
      let textLines = [];
      for (const line of ls) {
        if (/^\d+$/.test(line)) continue;
        if (/^(NOTE|STYLE|REGION)\b/i.test(line)) continue;
        if (timeRe.test(line)) {
          timeLine = line;
          continue;
        }
        // strip HTML / karaoke tags
        const clean = line
          .replace(/<[^>]+>/g, " ")
          .replace(/\{[^}]+\}/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (clean) textLines.push(clean);
      }
      if (!timeLine || !textLines.length) continue;
      const m = timeRe.exec(timeLine);
      if (!m) continue;
      const start = parseCaptionTime(m[1], m[2], m[3], m[4]);
      const end = parseCaptionTime(m[5], m[6], m[7], m[8]);
      // Within one cue, also merge rolling multi-line (karaoke)
      let text = "";
      for (const ln of textLines) {
        text = text ? mergeCaptionOverlap(text, ln) : ln;
      }
      text = text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      segments.push({
        start,
        end: Math.max(end, start + 0.2),
        text,
        silent: false,
      });
    }
    const deduped = dedupeRollingCaptions(segments);
    const text = captionsToPlainText(deduped);
    return { text, segments: deduped, file: filePath };
  } catch {
    return { text: "", segments: [], file: filePath };
  }
}

/**
 * Download YouTube (auto)captions → timed transcription.
 * @returns {{ text: string, segments: object[], file: string|null }|null}
 */
async function tryDownloadYoutubeCaptions(sourceUrl, destDir) {
  if (!/youtube\.com|youtu\.be/i.test(String(sourceUrl || ""))) return null;
  let ytdlp;
  try {
    ytdlp = await ensureYtDlp();
  } catch {
    return null;
  }
  fs.mkdirSync(destDir, { recursive: true });
  const outTpl = path.join(destDir, "ytcaps");
  try {
    for (const n of fs.readdirSync(destDir)) {
      if (/^ytcaps/i.test(n)) {
        try {
          fs.unlinkSync(path.join(destDir, n));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  // Prefer manual + auto; broad lang list; convert to srt for timing
  const args = [
    "--skip-download",
    "--no-warnings",
    "--write-auto-sub",
    "--write-sub",
    "--sub-langs",
    "en.*,pl.*,en,pl,en-US,en-GB,es.*,de.*,fr.*,pt.*,ru.*,it.*,zh.*,ja.*,ko.*,all",
    "--convert-subs",
    "srt",
    "-o",
    outTpl,
    String(sourceUrl),
  ];
  log("Pobieram napisy YT → transkrypcja z czasem…");
  try {
    await runYtDlpAsync(ytdlp, args, { timeoutMs: 120 * 1000 });
  } catch (e) {
    log("napisy YT:", String(e.message || e).slice(0, 120));
  }
  let best = null;
  let bestScore = -1;
  try {
    for (const n of fs.readdirSync(destDir)) {
      if (!/\.(srt|vtt)$/i.test(n)) continue;
      const p = path.join(destDir, n);
      const parsed = parseCaptionsTimed(p);
      if (!parsed.text || parsed.text.length < 12) continue;
      // Prefer official/manual subs over auto (less rolling duplication)
      const name = n.toLowerCase();
      const isAuto =
        /\.auto\./i.test(name) ||
        /auto/i.test(name) ||
        /automatic/i.test(name);
      // Score unique content, not raw length (auto-subs inflate by repeating)
      const score =
        Math.min(parsed.text.length, 8000) +
        parsed.segments.length * 3 +
        (isAuto ? 0 : 2500);
      if (score > bestScore) {
        bestScore = score;
        best = parsed;
      }
    }
  } catch {
    /* ignore */
  }
  if (best && best.text && best.segments.length) {
    log(
      "Napisy YT OK:",
      best.segments.length,
      "cue,",
      best.text.length,
      "znaków z",
      path.basename(best.file)
    );
    return best;
  }
  log("Brak napisów YT (albo puste)");
  return null;
}

function isPlatformUrl(u) {
  return /youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|fb\.com|vimeo\.com|twitter\.com|(^|\/\/)x\.com|reddit\.com|redd\.it|twitch\.tv/i.test(
    String(u || "")
  );
}

async function downloadInput(job, destPath) {
  // Platform URL → download on this PC (yt-dlp), never from cloud
  const sourceUrl = job.sourceUrl || job.options?.sourceUrl || null;
  const sourceKind = job.sourceKind || job.options?.sourceKind || null;
  if (
    sourceUrl &&
    (sourceKind === "platform" ||
      job.hasCloudInput === false ||
      isPlatformUrl(sourceUrl))
  ) {
    log("Pobieram źródło lokalnie (yt-dlp):", String(sourceUrl).slice(0, 90));
    await downloadPlatformSource(sourceUrl, destPath, {
      onProgress: (patch) => {
        reportProgress(job.id, patch);
      },
    });
    return;
  }

  const res = await request("GET", `/api/studio/agent/jobs/${job.id}/input`, {
    token: agentToken,
    raw: true,
  });
  const code = Number(res.status) || 0;
  // 409 or any error body with sourceUrl → local yt-dlp
  if (code >= 400) {
    let data = {};
    try {
      data = JSON.parse((res.buf && res.buf.toString("utf8")) || "{}");
    } catch {
      data = {};
    }
    const u = data.sourceUrl || sourceUrl;
    if (
      u &&
      (code === 409 ||
        data.sourceKind === "platform" ||
        isPlatformUrl(u))
    ) {
      log("Cloud 409/platform → yt-dlp:", String(u).slice(0, 90));
      await downloadPlatformSource(u, destPath, {
        onProgress: (patch) => {
          reportProgress(job.id, patch);
        },
      });
      return;
    }
    const hint = res.buf
      ? res.buf.toString("utf8").slice(0, 180)
      : "";
    throw new Error(
      "Pobieranie input nieudane HTTP " + code + " " + hint
    );
  }
  if (!res.buf || res.buf.length < 64) {
    throw new Error(
      "Pobrany input jest pusty (" + (res.buf ? res.buf.length : 0) + " B)"
    );
  }
  // Detect HTML/JSON error pages saved as "video"
  const head = res.buf.slice(0, 32).toString("utf8");
  if (
    /^\s*</.test(head) ||
    head.startsWith("{") ||
    head.startsWith("Not Found")
  ) {
    throw new Error(
      "Pobrany input nie jest wideo (wygląda na HTML/JSON): " +
        head.replace(/\s+/g, " ").slice(0, 80)
    );
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, res.buf);
}

async function reportProgress(jobId, patch) {
  await request("POST", `/api/studio/agent/jobs/${jobId}/progress`, {
    token: agentToken,
    body: patch || {},
  }).catch(() => null);
}

async function reportFail(jobId, error) {
  await request("POST", `/api/studio/agent/jobs/${jobId}/fail`, {
    token: agentToken,
    body: { error: String(error || "Błąd") },
  }).catch(() => null);
}

function multipartComplete(jobId, files, result) {
  // Build multipart body manually
  const boundary = "----ClipForge" + Date.now();
  const parts = [];
  function addField(name, value) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8"
      )
    );
  }
  function addFile(name, filePath, filename, mime) {
    const data = fs.readFileSync(filePath);
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
        "utf8"
      )
    );
    parts.push(data);
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  if (result) addField("result", JSON.stringify(result));
  if (files.video) addFile("video", files.video, path.basename(files.video), "video/mp4");
  if (files.preview)
    addFile("preview", files.preview, path.basename(files.preview), "image/jpeg");
  if (files.srt) addFile("srt", files.srt, path.basename(files.srt), "text/plain");
  // Original source (YouTube etc.) so cloud UI can show PRZED/PO compare
  if (files.original && fs.existsSync(files.original)) {
    const oname = path.basename(files.original) || "original.mp4";
    const mime = /\.webm$/i.test(oname)
      ? "video/webm"
      : /\.mov$/i.test(oname)
        ? "video/quicktime"
        : "video/mp4";
    addFile("original", files.original, oname, mime);
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  const body = Buffer.concat(parts);
  return request("POST", `/api/studio/agent/jobs/${jobId}/complete`, {
    token: agentToken,
    formData: {
      body,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    },
  });
}

async function runJob(job) {
  log("Start job", job.id, job.originalName);
  // Immediate ack so UI leaves 1% even if yt-dlp is slow / agent dies mid-way can reclaim
  const workDir = path.join(ROOT, "data", "studio", "work", "pc_" + job.id);
  try {
    fs.mkdirSync(workDir, { recursive: true });
  } catch (e) {
    log("mkdir work:", e.message || e);
  }
  await reportProgress(job.id, {
    progress: 2,
    stage: "Start na PC…",
    log: "Agent start — id " + job.id,
  });
  if (job.sourceKind === "platform" || job.options?.sourceKind === "platform") {
    log(
      "Źródło platformy:",
      job.sourcePlatform || job.options?.sourcePlatform || "?",
      (job.sourceUrl || job.options?.sourceUrl || "").slice(0, 80)
    );
    await reportProgress(job.id, {
      progress: 3,
      stage: "Pobieranie z platformy…",
      log: "yt-dlp: " + (job.sourceUrl || job.options?.sourceUrl || "").slice(0, 100),
    });
  }
  // Short ASCII path — avoids Windows path/encoding issues in FFmpeg
  const ext = (path.extname(job.originalName || "") || ".mp4").toLowerCase();
  const safeExt = /^\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(ext) ? ext : ".mp4";
  const inputPath = path.join(workDir, "input" + safeExt);

  await downloadInput(job, inputPath);
  let inputSize = 0;
  try {
    inputSize = fs.statSync(inputPath).size;
  } catch {
    inputSize = 0;
  }
  log("Input saved", inputPath, inputSize, "bytes");
  if (inputSize < 64) {
    throw new Error(
      "Pobrany plik jest pusty/uszkodzony (" +
        inputSize +
        " B). Sprawdź upload na chmurze."
    );
  }

  // Text source: «stt» = audio only; «captions» = YouTube / film subs
  job.options = job.options || {};
  const wantCaptions =
    String(job.options.transcriptSource || "stt").toLowerCase() === "captions";
  // Force pure STT — never pull YouTube caption text into the script
  if (!wantCaptions) {
    job.options.fromYoutubeCaptions = false;
    job.options.captionSegments = null;
    job.options.captionSegmentsBackup = null;
    job.options.narratorScriptBackup = null;
  }
  const platUrl = job.sourceUrl || job.options?.sourceUrl || null;
  if (
    wantCaptions &&
    platUrl &&
    isPlatformUrl(platUrl) &&
    /youtube\.com|youtu\.be/i.test(platUrl)
  ) {
    await reportProgress(job.id, {
      progress: 8,
      stage: "Napisy YouTube…",
      log: "Pobieram napisy z filmu (opcja «Z napisów»)…",
    });
    const caps = await tryDownloadYoutubeCaptions(platUrl, workDir);
    if (caps && caps.text && caps.segments && caps.segments.length) {
      const segs = caps.segments.map((s, i) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        silent: false,
        sttIndex: i,
      }));
      // Continuous plain text only (no time markers in script field)
      const plainCaps = String(caps.text || "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        !job.options.narratorScript ||
        String(job.options.narratorScript).trim().length < 40
      ) {
        job.options.narratorScript = plainCaps;
      }
      job.options.fromYoutubeCaptions = true;
      job.options.transcriptSource = "captions";
      job.options.captionSegments = segs;
      job.options.captionSegmentsBackup = segs;
      job.options.narratorScriptBackup = plainCaps;
      log(
        "Napisy → tekst ciągły:",
        plainCaps.length,
        "znaków,",
        caps.segments.length,
        "cue wewn. do lektora"
      );
      await reportProgress(job.id, {
        progress: 14,
        stage: "Tekst z napisów",
        log:
          "Napisy YouTube → cały tekst ciągły (" +
          plainCaps.length +
          " znaków). Pomijam STT dźwięku.",
        livePhase: "source",
        liveOriginal: plainCaps.slice(0, 1200),
      });
      if (caps.file && fs.existsSync(caps.file)) {
        try {
          const srtDest = path.join(workDir, "youtube_captions.srt");
          fs.copyFileSync(caps.file, srtDest);
          job.options.youtubeCaptionsPath = srtDest;
        } catch {
          /* ignore */
        }
      }
    } else {
      await reportProgress(job.id, {
        progress: 10,
        stage: "Brak napisów — STT z dźwięku",
        log:
          "Brak napisów na filmie. Przełączam na rozpoznawanie mowy z audio.",
      });
      job.options.transcriptSource = "stt";
      job.options.fromYoutubeCaptions = false;
    }
  } else if (
    !wantCaptions &&
    platUrl &&
    isPlatformUrl(platUrl)
  ) {
    await reportProgress(job.id, {
      progress: 8,
      stage: "STT z dźwięku…",
      log:
        "Opcja «Z dźwięku (STT)» — pomijam napisy YouTube, rozpoznaję mowę z audio po pobraniu wideo.",
    });
  }

  // Resolve ffmpeg and preflight probe BEFORE full pipeline
  let ff;
  try {
    ff = require("ffmpeg-static");
  } catch {
    ff = null;
  }
  if (!ff || !fs.existsSync(ff)) {
    throw new Error(
      "Brak ffmpeg-static w agentcie. Usuń %LOCALAPPDATA%\\ClipForge-Agent i pobierz agenta ponownie."
    );
  }
  const { spawnSync } = require("child_process");
  const chk = spawnSync(ff, ["-hide_banner", "-i", inputPath], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  const probeOut = String((chk.stderr || "") + (chk.stdout || ""));
  if (!/Video:/i.test(probeOut) || !/(\d{2,5})x(\d{2,5})/.test(probeOut)) {
    if (chk.error) {
      throw new Error(
        "FFmpeg nie startuje: " +
          (chk.error.code || chk.error.message || chk.error) +
          " [" +
          ff +
          "]"
      );
    }
    throw new Error(
      "FFmpeg nie widzi wideo w pobranym pliku (" +
        inputSize +
        " B). " +
        probeOut.replace(/\s+/g, " ").slice(-280)
    );
  }
  log("Preflight OK", probeOut.match(/(\d{2,5})x(\d{2,5})/)?.[0] || "?");

  // Sanity: Python for STT/TTS (Windows Store stub causes spawn EFTYPE)
  try {
    const pyCheck = spawnSync("py", ["-3", "--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    const pyOut = String((pyCheck.stdout || "") + (pyCheck.stderr || ""));
    if (pyCheck.error || !/Python/i.test(pyOut)) {
      const py2 = spawnSync("python", ["--version"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
      });
      if (py2.error) {
        log(
          "Ostrzeżenie: Python niedostępny (" +
            (py2.error.code || py2.error.message) +
            ") — lektor/STT mogą paść. Zainstaluj Python 3 z python.org (Add to PATH)."
        );
      }
    } else {
      log("Python:", pyOut.trim());
    }
  } catch {
    /* optional */
  }

  await reportProgress(job.id, {
    progress: 5,
    stage: "Na Twoim PC…",
    log:
      "Pobrano plik (" +
      Math.round(inputSize / 1024) +
      " KB) — " +
      (job.options?.preTranscribeOnly
        ? "tylko STT z linku…"
        : "start pipeline lokalnie"),
  });

  // ── Pre-transcribe only (extract text from URL, no full render) ──
  if (job.options?.preTranscribeOnly) {
    await reportProgress(job.id, {
      progress: 20,
      stage: "STT z dźwięku…",
      livePhase: "extracting",
      log: "Wyodrębniam mowę (Google STT)…",
    });
    const {
      extractSpeechFromVideoSegmented,
      translateText,
      joinSpeechTexts,
      distributeTextOnTimeline,
      stripTimedMarkers,
      buildTimedScriptFromText,
      formatExactTranscript,
    } = require(path.join(ROOT, "lib", "lang-utils.js"));
    const stitch =
      typeof joinSpeechTexts === "function"
        ? joinSpeechTexts
        : (arr) =>
            (arr || [])
              .map((t) => String(t || "").replace(/\s+/g, " ").trim())
              .filter(Boolean)
              .join(" ");
    /** Same canonical format as cloud extract + script field + lektor */
    function formatTimedAll(segs) {
      if (typeof formatExactTranscript === "function") {
        return formatExactTranscript(segs);
      }
      if (!Array.isArray(segs) || !segs.length) return "";
      return segs
        .filter((s) => s != null && String(s.text || "").trim())
        .map((s) => {
          const a = Number(s.start) || 0;
          const b = Math.max(a + 0.25, Number(s.end) || a + 1);
          const mm = (x) => {
            const m0 = Math.floor(x / 60);
            const s0 = (x - m0 * 60).toFixed(2).padStart(5, "0");
            return String(m0).padStart(2, "0") + ":" + s0;
          };
          const body = String(s.text || "")
            .replace(/\s+/g, " ")
            .trim();
          return `[${mm(a)} → ${mm(b)}] ${body}`;
        })
        .join("\n");
    }

    // Prefer YouTube captions if already loaded into options
    let originalText = "";
    let timedOriginal = "";
    let engine = null;
    let langCode = job.options.sourceLang || "auto";
    let durationSec = 0;
    let segs = [];

    if (
      job.options.fromYoutubeCaptions &&
      job.options.narratorScript &&
      String(job.options.narratorScript).trim().length > 8
    ) {
      originalText = String(job.options.narratorScript).replace(/\s+/g, " ").trim();
      segs = Array.isArray(job.options.captionSegments)
        ? job.options.captionSegments
        : [];
      engine = "youtube-captions";
      timedOriginal = formatTimedAll(segs);
      await reportProgress(job.id, {
        progress: 55,
        stage: "Napisy z platformy",
        liveOriginal: originalText.slice(0, 1200),
        log: "Używam napisów z filmu (" + originalText.length + " znaków)",
      });
    } else {
      // Probe duration
      try {
        const pr = spawnSync(ff, ["-hide_banner", "-i", inputPath], {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 20 * 1024 * 1024,
        });
        const errOut = String((pr.stderr || "") + (pr.stdout || ""));
        const m =
          errOut.match(/Duration:\s*(\d+):(\d+):(\d+[.,]\d+)/) ||
          errOut.match(/Duration:\s*(\d+):(\d+):(\d+)\b/);
        if (m) {
          const sec = Number(String(m[3]).replace(",", "."));
          durationSec =
            Number(m[1]) * 3600 +
            Number(m[2]) * 60 +
            (Number.isFinite(sec) ? sec : 0);
        }
      } catch {
        /* ignore */
      }
      // Full film (up to 3 h) — text must cover entire duration
      const maxSeconds = Math.min(
        10800,
        Math.max(5, Number(job.options.maxSeconds) || 10800)
      );
      const maxScan =
        durationSec > 0.5
          ? Math.min(durationSec + 1.5, maxSeconds)
          : maxSeconds;
      const sttWork = path.join(workDir, "pre_stt");
      let stt = extractSpeechFromVideoSegmented(inputPath, {
        sourceLang: job.options.sourceLang || "auto",
        maxSeconds: maxScan,
        workDir: sttWork,
        noEarlyExit: true,
        minScanRatio: 0.99,
        // Full text: long STT windows (15s) hop 8s — not 3s (was incomplete)
        hopSec: 8,
        segmentSec: 8,
        sttWindowSec: 15,
        onSegment: (info) => {
          if (info && info.phase === "done") {
            reportProgress(job.id, {
              progress: Math.min(70, 20 + Math.round((info.pct || 0) * 0.5)),
              stage: "STT " + (info.pct || 0) + "%",
              livePhase: "extracting",
              liveOriginal: (info.textSoFar || "").slice(0, 1200),
            }).catch(() => null);
          }
        },
      });
      originalText = stitch([stt.text]);
      engine = stt.engine || "stt";
      langCode = stt.langCode || langCode;
      segs = Array.isArray(stt.timelineSegments) ? stt.timelineSegments : [];
      // Only fall back to captions when user asked for captions (or STT empty after captions→STT fallback)
      const allowCapsFallback =
        String(job.options.transcriptSource || "stt").toLowerCase() ===
          "captions" || !!job.options.fromYoutubeCaptions;
      if (
        !originalText &&
        allowCapsFallback &&
        Array.isArray(job.options.captionSegmentsBackup)
      ) {
        segs = job.options.captionSegmentsBackup;
        originalText = stitch(segs.map((s) => s.text));
        engine = "youtube-captions-backup";
      }
      timedOriginal = segs
        .filter((s) => s && s.text)
        .map((s) => {
          const a = Number(s.start) || 0;
          const b = Math.max(a + 0.3, Number(s.end) || a + 1);
          const mm = (x) => {
            const m0 = Math.floor(x / 60);
            const s0 = (x - m0 * 60).toFixed(1).padStart(4, "0");
            return String(m0).padStart(2, "0") + ":" + s0;
          };
          return `[${mm(a)}–${mm(b)}] ${String(s.text).trim()}`;
        })
        .join("\n");
    }

    if (!originalText) {
      throw new Error(
        "Brak rozpoznanej mowy w audio z linku (muzyka / cisza / brak napisów)."
      );
    }

    let text = originalText;
    let timedText = timedOriginal;
    let translated = false;
    const targetLang = job.options.targetLang || "pl";
    const autoTranslate =
      job.options.autoTranslate == null || job.options.autoTranslate !== false;
    const useTimedForm = job.options.timedTranscript !== false;
    const srcForTr = langCode || job.options.sourceLang || "auto";

    const filmDur = Math.max(
      1,
      durationSec > 0.5
        ? durationSec
        : segs.length
          ? Math.max(...segs.map((s) => Number(s.end) || 0))
          : 30
    );

    if (autoTranslate) {
      await reportProgress(job.id, {
        progress: 78,
        stage: "Tłumaczenie całości…",
        livePhase: "translating",
        liveOriginal: originalText.slice(0, 1200),
        log:
          "Tłumaczę cały tekst → " +
          targetLang +
          ", potem rozkładam proporcjonalnie na oś (" +
          Math.round(filmDur) +
          "s, co 3s)",
      });
      try {
        const plainSrc =
          typeof stripTimedMarkers === "function"
            ? stripTimedMarkers(originalText)
            : originalText;
        const tr = await translateText(
          plainSrc,
          srcForTr,
          targetLang,
          null,
          { force: true }
        );
        if (tr && tr.ok && tr.text && String(tr.text).trim()) {
          text = stitch([tr.text]);
          translated = !tr.skipped;
        }
      } catch (te) {
        log("translate pre-stt:", te.message || te);
      }
    }

    // Exact STT clocks — same format as cloud extract / script field / lektor
    const paceKey =
      job.options.speechPace ||
      job.options.textSpeechPace ||
      job.options.textSpeedMode ||
      "manual";
    // Prefer non-overlapping hop slots when present; fine segs normalized later
    const sttSlots = Array.isArray(segs) && segs.length ? segs : [];
    let exactCueCount = 0;
    let transcriptMode = "plain";
    if (typeof buildTimedScriptFromText === "function") {
      const exactOrig = buildTimedScriptFromText({
        text: originalText,
        sttSegments: sttSlots,
        durationSec: filmDur,
        speechPace: paceKey,
      });
      timedOriginal = formatTimedAll(exactOrig.segments || []);
      exactCueCount = (exactOrig.segments || []).filter(
        (s) => s && s.text
      ).length;
      transcriptMode = exactOrig.mode || transcriptMode;
      const exactTr = buildTimedScriptFromText({
        text: text,
        sttSegments: sttSlots,
        durationSec: filmDur,
        speechPace: paceKey,
      });
      timedText = formatTimedAll(exactTr.segments || []);
      if (exactTr.mode) transcriptMode = exactTr.mode;
      exactCueCount = Math.max(
        exactCueCount,
        (exactTr.segments || []).filter((s) => s && s.text).length
      );
      log(
        "Transkrypcja dokładna:",
        exactTr.mode || "?",
        "·",
        (exactTr.segments || []).length,
        "cue STT"
      );
    } else if (typeof distributeTextOnTimeline === "function") {
      const srcSpread = distributeTextOnTimeline(originalText, filmDur, 3, {
        speechPace: paceKey,
      });
      timedOriginal = formatTimedAll(srcSpread);
      const tgtSpread = distributeTextOnTimeline(text, filmDur, 3, {
        speechPace: paceKey,
      });
      timedText = formatTimedAll(tgtSpread);
      transcriptMode = "even-timeline";
    }

    // Field gets continuous plain text only (no [mm:ss] lines).
    // Timed cues stay in timedText for lektor internals / optional use.
    const outText = text;
    const outOriginal = originalText;

    await reportProgress(job.id, {
      progress: 95,
      stage: "Transkrypcja gotowa",
      livePhase: "done",
      liveScript: outText.slice(0, 2000),
      liveOriginal: outOriginal.slice(0, 2000),
      log:
        "Tekst OK · " +
        outText.length +
        " znaków (ciągły, bez czasu)" +
        (translated ? " · przetłumaczono" : "") +
        (useTimedForm && exactCueCount
          ? " · STT ułoży " + exactCueCount + " cue przy lektorze"
          : ""),
    });

    const up = await request(
      "POST",
      `/api/studio/agent/jobs/${job.id}/complete-transcript`,
      {
        token: agentToken,
        body: {
          text: outText,
          originalText: outOriginal,
          plainText: outText,
          plainOriginal: outOriginal,
          timedText: useTimedForm ? timedText : "",
          timedOriginal: useTimedForm ? timedOriginal : "",
          translated,
          engine,
          langCode,
          targetLang,
          durationSec: durationSec || null,
          timedTranscript: useTimedForm,
          exactCueCount,
          transcriptMode,
          segments: exactCueCount,
        },
      }
    );
    if (up.status >= 400) {
      throw new Error(
        up.data?.error ||
          "complete-transcript HTTP " + up.status + " — zaktualizuj chmurę / agenta"
      );
    }
    log("Pre-transcribe gotowe:", job.id, text.slice(0, 60));
    return;
  }

  // Prefer agent-local pipeline (same folder as this script's install)
  const { runPipeline } = require(path.join(ROOT, "lib", "studio-pipeline.js"));
  const localJob = {
    id: job.id,
    originalName: job.originalName || "input" + safeExt,
    inputPath,
    options: job.options || {},
    outputPath: null,
    previewPath: null,
    result: null,
  };

  try {
    await runPipeline(localJob, (patch) => {
      reportProgress(job.id, patch);
    });
    const files = {};
    if (localJob.outputPath && fs.existsSync(localJob.outputPath)) {
      files.video = localJob.outputPath;
    }
    if (localJob.previewPath && fs.existsSync(localJob.previewPath)) {
      files.preview = localJob.previewPath;
    }
    const srt =
      localJob.result?.srtPath ||
      (localJob.outputPath
        ? localJob.outputPath.replace(/\.mp4$/i, ".srt")
        : null);
    if (srt && fs.existsSync(srt)) files.srt = srt;
    const transcript =
      localJob.result?.transcriptPath ||
      (localJob.outputPath
        ? localJob.outputPath.replace(/\.mp4$/i, "_transcript.txt")
        : null);
    if (transcript && fs.existsSync(transcript)) files.transcript = transcript;

    if (!files.video) throw new Error("Brak pliku wynikowego po pipeline");

    // Platform / no cloud input: original for before/after compare
    const needOrig =
      job.sourceKind === "platform" ||
      job.options?.sourceKind === "platform" ||
      job.hasCloudInput === false ||
      isPlatformUrl(job.sourceUrl || job.options?.sourceUrl);
    if (needOrig && fs.existsSync(inputPath)) {
      files.original = inputPath;
    }

    const outSize = fileSizeSafe(files.video);
    const origSize = files.original ? fileSizeSafe(files.original) : 0;
    const prevSize = files.preview ? fileSizeSafe(files.preview) : 0;
    // Free Render: 500 MB/file. Prefer local disk for anything that would choke cloud / preview.
    const useLocalDisk =
      outSize > CLOUD_SAFE_BYTES ||
      origSize > CLOUD_SAFE_BYTES ||
      outSize + origSize > CLOUD_SAFE_BYTES * 1.8 ||
      outSize + origSize + prevSize > 400 * 1024 * 1024;

    const userCopy = publishToUserVideos(
      job.id,
      files.video,
      job.originalName || localJob.originalName,
      { srt: files.srt || null, transcript: files.transcript || null }
    );

    if (useLocalDisk) {
      await reportProgress(job.id, {
        progress: 98,
        stage: "Zapis na dysku PC…",
        log:
          "Wynik " +
          Math.round(outSize / 1e6) +
          " MB" +
          (origSize ? " + oryginał " + Math.round(origSize / 1e6) + " MB" : "") +
          " — za duży na chmurę 500 MB. Podgląd z dysku twardego (localhost), nie z Render.",
      });
      registerLocalMedia(job.id, files);
      const port = ensureLocalMediaServer();
      const resultPayload = {
        ...(localJob.result || {}),
        localDisk: true,
        mb: Math.round((outSize / 1e6) * 10) / 10,
        userCopyPath: userCopy || null,
      };
      const body = {
        result: resultPayload,
        localMedia: {
          host: "127.0.0.1",
          port,
          token: localMediaToken,
          hasOriginal: !!files.original,
          hasPreview: !!files.preview,
          hasSrt: !!files.srt,
          resultBytes: outSize,
          originalBytes: origSize,
          resultPath: files.video,
          originalPath: files.original || null,
          previewPath: files.preview || null,
          srtPath: files.srt || null,
          userCopyPath: userCopy || null,
        },
      };
      let up = await request("POST", `/api/studio/agent/jobs/${job.id}/complete-local`, {
        token: agentToken,
        body,
      });
      if (up.status >= 400) {
        throw new Error(
          up.data?.error ||
            "complete-local nieudane (HTTP " + up.status + ") — czy chmura ma nowy endpoint?"
        );
      }
      log(
        "Job gotowy (DYSK PC):",
        job.id,
        Math.round(outSize / 1e6) + " MB",
        userCopy ? "→ " + userCopy : ""
      );
    } else {
      await reportProgress(job.id, {
        progress: 98,
        stage: "Wysyłka wyniku…",
        log: files.original
          ? "Wysyłam wynik + oryginał (porównanie) do chmury…"
          : "Wysyłam wynik do chmury…",
      });
      let up = await multipartComplete(job.id, files, {
        ...(localJob.result || {}),
        userCopyPath: userCopy || null,
      });
      // If upload failed (413 / limit) → fall back to local disk serve
      if (up.status >= 400) {
        log(
          "Upload chmura HTTP " +
            up.status +
            " — przełączam na dysk PC (localhost)…"
        );
        registerLocalMedia(job.id, files);
        const port = ensureLocalMediaServer();
        up = await request("POST", `/api/studio/agent/jobs/${job.id}/complete-local`, {
          token: agentToken,
          body: {
            result: {
              ...(localJob.result || {}),
              localDisk: true,
              mb: Math.round((outSize / 1e6) * 10) / 10,
              userCopyPath: userCopy || null,
              cloudUploadError: up.data?.error || "HTTP " + up.status,
            },
            localMedia: {
              host: "127.0.0.1",
              port,
              token: localMediaToken,
              hasOriginal: !!files.original,
              hasPreview: !!files.preview,
              hasSrt: !!files.srt,
              resultBytes: outSize,
              originalBytes: origSize,
              resultPath: files.video,
              originalPath: files.original || null,
              previewPath: files.preview || null,
              srtPath: files.srt || null,
              userCopyPath: userCopy || null,
            },
          },
        });
      }
      if (up.status >= 400) {
        throw new Error(up.data?.error || "Upload wyniku nieudany");
      }
      log("Job gotowy", job.id);
    }
  } catch (err) {
    log("Job błąd", job.id, err.message || err);
    await reportFail(job.id, err.message || String(err));
  }
}

async function main() {
  log("Cloud:", CLOUD);
  log("Label:", LABEL);
  log("UI zostaje w przeglądarce na adresie chmury — tu liczy Twój PC.");
  await ensureToken();
  // One agent only: avoid two processes claiming then abandoning jobs
  try {
    const { spawnSync: ss } = require("child_process");
    if (process.platform === "win32") {
      ss(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `$me=${process.pid}; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'pc-agent\\.js' -and $_.ProcessId -ne $me } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        { windowsHide: true, timeout: 8000 }
      );
    }
  } catch {
    /* best-effort */
  }
  ensureLocalMediaServer();
  log("Agent gotowy — czekam na joby (YouTube wymaga tego okna otwartego).");
  log("Duże wyniki (>~90 MB) zostają na dysku PC → podgląd z 127.0.0.1 (nie chmura 500 MB).");
  for (;;) {
    try {
      const hb = await heartbeat();
      if (hb && hb.reclaimed > 0) {
        log("Odzyskano stuck jobów:", hb.reclaimed);
      }
      const job = await claim();
      if (job) {
        log("Claim OK", job.id, job.sourceKind || job.options?.sourceKind || "");
        await runJob(job);
      }
    } catch (err) {
      log("Błąd pętli:", err.message || err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
