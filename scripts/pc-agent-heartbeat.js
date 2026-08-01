/**
 * Side-car heartbeat for PC agent.
 * Runs as a separate process so progress/touch keep reaching the cloud
 * even when the main agent is blocked in spawnSync (ffmpeg/STT/probe).
 *
 * Env:
 *   CLIPFORGE_CLOUD_URL / CF_HB_URL
 *   CLIPFORGE_AGENT_TOKEN / CF_HB_TOKEN
 *   CF_HB_JOB  — job id
 *   CF_HB_LABEL
 *   CF_HB_MS   — interval ms (default 8000)
 */
const http = require("http");
const https = require("https");

const CLOUD = String(
  process.env.CF_HB_URL ||
    process.env.CLIPFORGE_CLOUD_URL ||
    process.env.BASE_URL ||
    ""
).replace(/\/$/, "");
const TOKEN = String(
  process.env.CF_HB_TOKEN || process.env.CLIPFORGE_AGENT_TOKEN || ""
).trim();
const JOB = String(process.env.CF_HB_JOB || "").trim();
const LABEL = String(process.env.CF_HB_LABEL || "Mój PC").slice(0, 64);
const MS = Math.max(5000, Math.min(30000, Number(process.env.CF_HB_MS) || 8000));

if (!CLOUD || !TOKEN || !JOB) {
  process.exit(0);
}

let n = 0;
function post(path, body) {
  return new Promise((resolve) => {
    try {
      const u = new URL(path, CLOUD);
      const lib = u.protocol === "https:" ? https : http;
      const data = Buffer.from(JSON.stringify(body || {}), "utf8");
      const req = lib.request(
        {
          method: "POST",
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": data.length,
            Authorization: "Bearer " + TOKEN,
          },
          timeout: 12000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode || 0);
        }
      );
      req.on("error", () => resolve(0));
      req.on("timeout", () => {
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        resolve(0);
      });
      req.write(data);
      req.end();
    } catch {
      resolve(0);
    }
  });
}

async function tick() {
  n += 1;
  await post("/api/studio/agent/heartbeat", {
    label: LABEL,
    busyJobId: JOB,
  });
  await post("/api/studio/agent/jobs/" + encodeURIComponent(JOB) + "/progress", {
    touch: true,
    stage: "Na Twoim PC (pracuje)…",
    log:
      n % 3 === 0
        ? "Agent pracuje (sidecar keepalive " + n * Math.round(MS / 1000) + "s)…"
        : undefined,
  });
}

tick().catch(() => null);
const iv = setInterval(() => {
  tick().catch(() => null);
}, MS);

// Exit when parent dies (best-effort on Windows: check PPID periodically)
const parentPid = process.ppid;
setInterval(() => {
  try {
    // throws if parent gone on some platforms; on Windows process.kill(pid, 0) works
    process.kill(parentPid, 0);
  } catch {
    clearInterval(iv);
    process.exit(0);
  }
}, 5000);
