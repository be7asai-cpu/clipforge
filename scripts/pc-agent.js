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

async function downloadInput(job, destPath) {
  const res = await request("GET", `/api/studio/agent/jobs/${job.id}/input`, {
    token: agentToken,
    raw: true,
  });
  if (res.status >= 400) {
    const hint = res.buf
      ? res.buf.toString("utf8").slice(0, 180)
      : "";
    throw new Error(
      "Pobieranie input nieudane HTTP " + res.status + " " + hint
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
