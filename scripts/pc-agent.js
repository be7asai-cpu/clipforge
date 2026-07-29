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

function request(method, urlPath, { body, token, formData, raw } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath.startsWith("http") ? urlPath : CLOUD + urlPath);
    const lib = u.protocol === "https:" ? https : http;
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    let payload = null;
    if (formData) {
      // formData is { body: Buffer, headers }
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
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (raw) {
            return resolve({ status: res.statusCode, buf, headers: res.headers });
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
    throw new Error("Pobieranie input nieudane HTTP " + res.status);
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
  const workDir = path.join(ROOT, "data", "studio", "work", "pc_" + job.id);
  fs.mkdirSync(workDir, { recursive: true });
  const inputPath = path.join(workDir, "input" + path.extname(job.originalName || ".mp4"));

  await downloadInput(job, inputPath);
  await reportProgress(job.id, {
    progress: 5,
    stage: "Na Twoim PC…",
    log: "Pobrano plik — start pipeline lokalnie",
  });

  const { runPipeline } = require(path.join(ROOT, "lib", "studio-pipeline.js"));
  const localJob = {
    id: job.id,
    originalName: job.originalName,
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
