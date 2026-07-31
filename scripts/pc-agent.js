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
const https = require("https");
const http = require("http");
const { spawnSync } = require("child_process");

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

let agentToken = process.env.CLIPFORGE_AGENT_TOKEN || "";

function log(...a) {
  console.log("[PC-Agent]", ...a);
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
async function downloadPlatformSource(sourceUrl, destPath) {
  const ytdlp = await ensureYtDlp();
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  // Remove prior attempts
  try {
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  } catch {
    /* ignore */
  }
  const outTpl = path.join(dir, "ytdlp_dl.%(ext)s");
  const args = [
    "--no-playlist",
    "--no-warnings",
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "-o",
    outTpl,
    "--restrict-filenames",
    String(sourceUrl),
  ];
  const ffDir = ffmpegDirForYtDlp();
  if (ffDir) {
    args.unshift("--ffmpeg-location", ffDir);
  }
  log("yt-dlp start…", sourceUrl.slice(0, 80));
  const r = spawnSync(ytdlp, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  if (r.error) {
    throw new Error("yt-dlp nie startuje: " + (r.error.message || r.error));
  }
  const errTail = String(r.stderr || r.stdout || "").slice(-400);
  // Find downloaded file
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("ytdlp_dl."))
    .map((n) => path.join(dir, n));
  if (!files.length) {
    throw new Error(
      "yt-dlp nie pobrał pliku (kod " +
        r.status +
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
  return destPath;
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
    await downloadPlatformSource(sourceUrl, destPath);
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
      await downloadPlatformSource(u, destPath);
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
  if (job.sourceKind === "platform" || job.options?.sourceKind === "platform") {
    log(
      "Źródło platformy:",
      job.sourcePlatform || job.options?.sourcePlatform || "?",
      (job.sourceUrl || job.options?.sourceUrl || "").slice(0, 80)
    );
    await reportProgress(job.id, {
      progress: 2,
      stage: "Pobieranie z platformy…",
      log: "yt-dlp: " + (job.sourceUrl || job.options?.sourceUrl || "").slice(0, 100),
    });
  }
  // Short ASCII path — avoids Windows path/encoding issues in FFmpeg
  const workDir = path.join(ROOT, "data", "studio", "work", "pc_" + job.id);
  fs.mkdirSync(workDir, { recursive: true });
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
      " KB) — start pipeline lokalnie",
  });

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

    if (!files.video) throw new Error("Brak pliku wynikowego po pipeline");

    const done = await reportProgress(job.id, {
      progress: 98,
      stage: "Wysyłka wyniku…",
      log: "Wysyłam wynik do chmury…",
    });
    void done;
    const up = await multipartComplete(job.id, files, localJob.result || {});
    if (up.status >= 400) {
      throw new Error(up.data?.error || "Upload wyniku nieudany");
    }
    log("Job gotowy", job.id);
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
  for (;;) {
    try {
      await heartbeat();
      const job = await claim();
      if (job) {
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
