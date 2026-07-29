/**
 * In-memory job store for ClipForge Studio.
 * Jobs persist on disk under data/studio/jobs.json for reload.
 * Interrupted jobs (server restart) are auto-resumed if source file still exists.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const STUDIO_DIR = path.join(ROOT, "data", "studio");
const JOBS_FILE = path.join(STUDIO_DIR, "jobs.json");
const UPLOAD_DIR = path.join(STUDIO_DIR, "uploads");
const OUTPUT_DIR = path.join(STUDIO_DIR, "outputs");
const WORK_DIR = path.join(STUDIO_DIR, "work");

const jobs = new Map();
let queue = [];
let running = false;

function ensureDirs() {
  for (const d of [STUDIO_DIR, UPLOAD_DIR, OUTPUT_DIR, WORK_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function isInterruptedError(err) {
  return /przerwane|restart/i.test(String(err || ""));
}

function load() {
  ensureDirs();
  if (!fs.existsSync(JOBS_FILE)) return;
  try {
    const rows = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
    for (const j of rows) {
      // Keep as-is for now; resumeInterrupted() will re-queue if possible
      if (j.status === "running" || j.status === "queued") {
        j.status = "failed";
        j.error = j.error || "Przerwane — serwer został zrestartowany.";
        j.canRetry = true;
        j.finishedAt = j.finishedAt || new Date().toISOString();
      }
      if (j.status === "failed" && isInterruptedError(j.error)) {
        j.canRetry = true;
      }
      jobs.set(j.id, j);
    }
  } catch {
    /* ignore corrupt store */
  }
}

function save() {
  ensureDirs();
  const rows = [...jobs.values()]
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 80);
  fs.writeFileSync(JOBS_FILE, JSON.stringify(rows, null, 2));
}

function id() {
  return crypto.randomBytes(6).toString("hex");
}

/**
 * Ownership helper.
 * - When userId is null/undefined → no filter (admin / internal).
 * - Legacy jobs without userId are only owned by "local" (AUTH off).
 */
function ownsJob(job, userId) {
  if (!job) return false;
  if (userId == null || userId === "") return true;
  const owner = job.userId != null ? String(job.userId) : null;
  if (owner) return owner === String(userId);
  // Old jobs without owner: visible only in local single-user mode
  return String(userId) === "local";
}

/**
 * @param {object} opts
 * @param {'cloud'|'pc'} [opts.executor] - force executor; default: pc if agent online
 */
function createJob({ originalName, inputPath, options, userId, executor }) {
  const uid = userId != null && userId !== "" ? String(userId) : "local";
  let exec = executor === "cloud" || executor === "pc" ? executor : null;
  if (!exec) {
    try {
      const hub = require("./pc-agent-hub");
      exec = hub.isOnline(uid) ? "pc" : "cloud";
    } catch {
      exec = "cloud";
    }
  }
  const job = {
    id: id(),
    userId: uid,
    /** cloud = Render server; pc = user's local agent (UI stays on cloud) */
    executor: exec,
    originalName: originalName || "video.mp4",
    inputPath,
    outputPath: null,
    previewPath: null,
    status: "queued", // queued | running | done | failed | cancelled
    progress: 0,
    stage: exec === "pc" ? "Czeka na Twój PC…" : "W kolejce",
    stages: [],
    options: options || {},
    error: null,
    canRetry: false,
    result: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date().toISOString(),
    logs: [
      {
        t: new Date().toISOString(),
        msg:
          exec === "pc"
            ? "Job dla agenta na Twoim PC (strona zostaje w chmurze)."
            : "Job w kolejce serwera w chmurze.",
      },
    ],
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  save();
  // Cloud pump only runs cloud jobs; PC agent claims pc jobs
  if (exec !== "pc") enqueuePump();
  return job;
}

/** Next queued job for a PC agent (same userId, executor=pc) */
function claimPcJob(userId) {
  const uid = String(userId);
  for (const qid of queue) {
    const j = jobs.get(qid);
    if (!j || j.status !== "queued") continue;
    if (j.executor !== "pc") continue;
    if (String(j.userId) !== uid) continue;
    j.status = "running";
    j.startedAt = new Date().toISOString();
    j.updatedAt = j.startedAt;
    j.progress = 1;
    j.stage = "Na Twoim PC…";
    j.logs = j.logs || [];
    j.logs.push({ t: j.startedAt, msg: "Agent PC przejął job." });
    save();
    return j;
  }
  // orphan pc jobs not in queue array
  for (const j of jobs.values()) {
    if (j.status !== "queued" || j.executor !== "pc") continue;
    if (String(j.userId) !== uid) continue;
    if (!queue.includes(j.id)) queue.push(j.id);
    return claimPcJob(userId);
  }
  return null;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function listJobs(limit = 30, userId = null) {
  return [...jobs.values()]
    .filter((j) => ownsJob(j, userId))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, limit);
}

/** True if this user has a running or queued job */
function isUserBusy(userId) {
  if (userId == null) {
    return [...jobs.values()].some(
      (j) => j.status === "running" || j.status === "queued"
    );
  }
  return listJobs(50, userId).some(
    (j) => j.status === "running" || j.status === "queued"
  );
}

/** True if any job on the machine is active (shared worker) */
function isServerBusy() {
  return [...jobs.values()].some(
    (j) => j.status === "running" || j.status === "queued"
  );
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  // Always stamp last update so UI can detect freezes
  job.updatedAt = new Date().toISOString();
  if (patch.log) {
    job.logs = job.logs || [];
    job.logs.push({ t: job.updatedAt, msg: patch.log });
    delete job.log;
    if (job.logs.length > 100) job.logs = job.logs.slice(-100);
  }
  // Persist often so progress % survives and polling sees real values
  if (
    patch.status ||
    patch.error ||
    patch.stage ||
    typeof patch.progress === "number"
  ) {
    save();
  }
  return job;
}

/**
 * Re-queue a failed/interrupted job if source file still exists.
 * @param {string} jobId
 * @param {object} [patchOpts] - optional option overrides (e.g. forceFast)
 */
function retryJob(jobId, patchOpts = {}, userId = null) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, error: "Job nie istnieje" };
  if (userId != null && !ownsJob(job, userId)) {
    return { ok: false, error: "Brak dostępu do tego joba", code: "FORBIDDEN" };
  }
  if (job.status === "running" || job.status === "queued") {
    return { ok: false, error: "Job już jest w kolejce / w toku" };
  }
  if (!job.inputPath || !fs.existsSync(job.inputPath)) {
    return {
      ok: false,
      error: "Brak pliku źródłowego — wrzuć filmik ponownie.",
    };
  }
  job.options = { ...(job.options || {}), ...(patchOpts || {}) };
  // After interrupt, prefer Szybki HD so user is not stuck on AI again
  if (patchOpts.forceFast || patchOpts.upscale === "fast") {
    job.options.upscale = "fast";
    job.options.speedMode = "turbo";
    // Drop insane 4K/CRF settings that hang long clips
    if (Number(job.options.targetHeight) > 1080) {
      job.options.targetHeight = 1080;
    }
    if (job.options.crf == null || Number(job.options.crf) < 20) {
      job.options.crf = 20;
    }
    job.options.crfPreset = "veryfast";
  }
  job.status = "queued";
  job.progress = 0;
  job.stage = "W kolejce (ponownie)";
  job.error = null;
  job.canRetry = false;
  job.result = null;
  job.outputPath = null;
  job.previewPath = null;
  job.startedAt = null;
  job.finishedAt = null;
  job.stages = [];
  job.logs = job.logs || [];
  job.logs.push({
    t: new Date().toISOString(),
    msg:
      "Ponowne uruchomienie joba…" +
      (job.options.upscale === "fast" ? " (Szybki HD)" : ""),
  });
  if (!queue.includes(job.id)) queue.push(job.id);
  save();
  enqueuePump();
  return { ok: true, job };
}

/**
 * Do NOT auto-start old jobs on boot (that flooded the queue and looked "broken").
 * Only mark them as retriable so user can click "Uruchom ponownie".
 */
function resumeInterrupted(_maxResume = 0) {
  let marked = 0;
  for (const job of jobs.values()) {
    if (job.status !== "failed") continue;
    if (isInterruptedError(job.error) || job.canRetry) {
      if (job.inputPath && fs.existsSync(job.inputPath)) {
        job.canRetry = true;
        marked++;
      } else {
        job.canRetry = false;
        job.error =
          "Przerwane — brak pliku źródłowego. Wrzuć filmik ponownie do ClipForge.";
      }
    }
  }
  if (marked) save();
  return []; // never auto-queue on boot
}

/**
 * Cancel queued jobs (optionally only for one user).
 * Does not touch the currently running job.
 */
function clearQueue(reason, userId = null) {
  const msg =
    reason || "Anulowano — kolejka wyczyszczona (stare joby po restarcie).";
  const cancelled = [];
  for (const job of jobs.values()) {
    if (job.status !== "queued") continue;
    if (!ownsJob(job, userId)) continue;
    job.status = "failed";
    job.error = msg;
    job.canRetry = !!(job.inputPath && fs.existsSync(job.inputPath));
    job.stage = "Anulowane";
    job.finishedAt = new Date().toISOString();
    job.logs = job.logs || [];
    job.logs.push({ t: new Date().toISOString(), msg });
    cancelled.push(job.id);
  }
  queue = queue.filter((id) => {
    const j = jobs.get(id);
    return j && j.status === "queued";
  });
  save();
  return cancelled;
}

/**
 * Cancel one job if queued; if running — kill worker and fail so queue continues.
 * @param {string} jobId
 * @param {string|null} [userId] - when set, only owner may cancel
 */
function cancelJob(jobId, userId = null) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, error: "Brak joba" };
  if (userId != null && !ownsJob(job, userId)) {
    return { ok: false, error: "Brak dostępu do tego joba", code: "FORBIDDEN" };
  }
  if (job.status === "done") return { ok: false, error: "Job już zakończony" };
  if (job.status === "failed" && /Anulowane/i.test(job.error || "")) {
    return { ok: true, job, already: true };
  }
  if (job.status === "running") {
    killWorker();
    job.status = "failed";
    job.error = "Anulowane przez użytkownika (w toku)";
    job.canRetry = !!(job.inputPath && fs.existsSync(job.inputPath));
    job.stage = "Anulowane";
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    job.logs = job.logs || [];
    job.logs.push({ t: job.finishedAt, msg: job.error });
    running = false;
    queue = queue.filter((id) => id !== jobId);
    save();
    // do NOT enqueuePump immediately — pump.finally will resume after worker dies
    return { ok: true, job };
  }
  if (job.status !== "queued") {
    return { ok: false, error: "Job nie jest aktywny" };
  }
  job.status = "failed";
  job.error = "Anulowane przez użytkownika";
  job.canRetry = !!(job.inputPath && fs.existsSync(job.inputPath));
  job.stage = "Anulowane";
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  job.logs = job.logs || [];
  job.logs.push({ t: job.finishedAt, msg: job.error });
  queue = queue.filter((id) => id !== jobId);
  save();
  return { ok: true, job };
}

/**
 * Cancel running + queued jobs for one user (or everyone if userId is null).
 * Other users' jobs stay in the shared queue untouched.
 * @returns {{ ok:true, cancelled: string[] }}
 */
function cancelAllActive(reason, userId = null) {
  const msg =
    reason || "Anulowane — reset Studio (nowy proces)";
  const cancelled = [];

  const runningJobs = [...jobs.values()].filter(
    (j) => j.status === "running" && ownsJob(j, userId)
  );
  // Only kill worker if THIS user's job is the one currently running
  if (runningJobs.length) {
    killWorker();
    for (const job of runningJobs) {
      job.status = "failed";
      job.error = msg;
      job.canRetry = !!(job.inputPath && fs.existsSync(job.inputPath));
      job.stage = "Anulowane";
      job.finishedAt = new Date().toISOString();
      job.updatedAt = job.finishedAt;
      job.logs = job.logs || [];
      job.logs.push({ t: job.finishedAt, msg });
      cancelled.push(job.id);
    }
    running = false;
  }

  const qIds = clearQueue(msg, userId);
  for (const id of qIds) {
    if (!cancelled.includes(id)) cancelled.push(id);
  }
  // Rebuild queue from remaining queued jobs (other users keep their place)
  queue = queue.filter((id) => {
    const j = jobs.get(id);
    return j && j.status === "queued";
  });
  save();
  // If we killed our running job, pump will resume others via worker exit / finally
  if (!runningJobs.length) {
    enqueuePump();
  }
  return { ok: true, cancelled };
}

/** Full Studio reset for one user (or all if userId null) */
function resetStudio(reason, userId = null) {
  return cancelAllActive(
    reason || "Anulowane — wracasz do startu (nowy proces)",
    userId
  );
}

function publicJob(job) {
  if (!job) return null;
  const baseName =
    job.status === "done" && job.outputPath
      ? path.basename(job.outputPath)
      : null;
  const srtName = baseName ? baseName.replace(/\.mp4$/i, ".srt") : null;
  const srtPath = srtName ? path.join(OUTPUT_DIR, srtName) : null;
  const canRetry =
    job.status === "failed" &&
    !!(job.inputPath && fs.existsSync(job.inputPath));
  // Authenticated download routes (not open static) — ownership checked in server
  const dlBase =
    job.status === "done" ? `/api/studio/jobs/${job.id}` : null;
  return {
    id: job.id,
    // Never expose raw userId to other clients; ownership is enforced server-side
    mine: true,
    executor: job.executor || "cloud",
    originalName: job.originalName,
    status: job.status,
    progress: Number(job.progress) || 0,
    stage: job.stage,
    updatedAt: job.updatedAt || job.startedAt || job.createdAt || null,
    stages: job.stages,
    options: job.options,
    error: job.error,
    canRetry,
    result: job.result,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    logs: (job.logs || []).slice(-20),
    // Live translation stream for UI
    liveScript: job.liveScript || null,
    liveOriginal: job.liveOriginal || null,
    livePhase: job.livePhase || null,
    // Auto color correction result for read-only slider preview
    autoPolish: job.autoPolish || null,
    downloadUrl:
      dlBase && job.outputPath && fs.existsSync(job.outputPath)
        ? `${dlBase}/download`
        : null,
    previewUrl:
      dlBase && job.previewPath && fs.existsSync(job.previewPath)
        ? `${dlBase}/preview`
        : null,
    absolutePath:
      job.status === "done" && job.outputPath ? job.outputPath : null,
    folderPath:
      job.status === "done" && job.outputPath
        ? path.dirname(job.outputPath)
        : null,
    srtUrl:
      dlBase && srtPath && fs.existsSync(srtPath) ? `${dlBase}/srt` : null,
    srtAbsolutePath:
      job.status === "done" && srtPath && fs.existsSync(srtPath) ? srtPath : null,
    shareTitle: job.originalName
      ? String(job.originalName).replace(/\.[^.]+$/, "")
      : "ClipForge",
  };
}

function setQueueRunner(runnerFn) {
  // Kept for API compat — pump uses child process instead
  setQueueRunner._fn = runnerFn;
}

let workerChild = null;
let saveTimer = null;

function saveDebounced() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      save();
    } catch {
      /* ignore */
    }
  }, 400);
}

// Override updateJob save thrashing for progress-only patches: use debounce
const _updateJob = updateJob;
function updateJobSoft(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  job.updatedAt = new Date().toISOString();
  if (patch.log) {
    job.logs = job.logs || [];
    job.logs.push({ t: job.updatedAt, msg: patch.log });
    delete job.log;
    if (job.logs.length > 100) job.logs = job.logs.slice(-100);
  }
  if (patch.status || patch.error || patch.progress === 100) {
    save();
  } else {
    saveDebounced();
  }
  return job;
}

/**
 * Run pipeline in a separate Node process so HTTP stays responsive.
 * CRITICAL: never use unpiped stdio without readers — full pipe = deadlock freeze.
 */
function runJobInWorker(job) {
  return new Promise((resolve, reject) => {
    const { fork } = require("child_process");
    const workerPath = path.join(__dirname, "studio-worker.js");
    console.log(`[ClipForge] fork worker for job ${job.id}`);
    const child = fork(workerPath, [], {
      cwd: ROOT,
      // ignore stdout/stderr so child never blocks on full pipes
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, CLIPFORGE_WORKER: "1" },
    });
    workerChild = child;
    job._workerPid = child.pid;

    let settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (workerChild === child) workerChild = null;
      try {
        if (!child.killed) {
          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              if (!child.killed) child.kill("SIGKILL");
            } catch {
              /* ignore */
            }
          }, 2000).unref?.();
        }
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(result);
    };

    child.on("message", (msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === "ready") {
        // worker booted — start already sent or send now
        return;
      }
      if (msg.type === "progress" && msg.patch) {
        updateJobSoft(job.id, msg.patch);
        // Keep local job object in sync for paths/result mid-flight
        if (msg.job) {
          if (msg.job.outputPath) job.outputPath = msg.job.outputPath;
          if (msg.job.previewPath) job.previewPath = msg.job.previewPath;
          if (msg.job.result) job.result = msg.job.result;
        }
      } else if (msg.type === "done") {
        if (msg.job) {
          job.outputPath = msg.job.outputPath || job.outputPath;
          job.previewPath = msg.job.previewPath || job.previewPath;
          job.result = msg.job.result || job.result;
        }
        finish(null, true);
      } else if (msg.type === "error") {
        finish(new Error(msg.error || "Worker error"));
      }
    });

    child.on("error", (err) => {
      console.error("[ClipForge] worker error:", err.message);
      finish(err);
    });
    child.on("exit", (code, signal) => {
      if (!settled) {
        finish(
          new Error(
            signal
              ? "Worker przerwany (" + signal + ")"
              : code === 0
                ? "Worker zakończył bez wyniku"
                : "Worker padł (kod " + code + ")"
          )
        );
      }
    });

    // Send job snapshot (plain JSON) immediately — handler is already attached
    const payload = {
      id: job.id,
      originalName: job.originalName,
      inputPath: job.inputPath,
      options: job.options || {},
      outputPath: null,
      previewPath: null,
      result: null,
    };
    try {
      child.send({ type: "start", job: payload });
    } catch (e) {
      finish(e);
    }
  });
}

async function pump() {
  if (running) {
    const anyRun = [...jobs.values()].some((j) => j.status === "running");
    if (!anyRun) {
      console.log("[ClipForge] pump: running flag stale — reset");
      running = false;
    } else {
      return;
    }
  }
  // Cloud queue only — skip jobs reserved for user's PC agent
  const isCloudQueued = (j) =>
    j && j.status === "queued" && j.executor !== "pc";
  let nextId = queue.find((qid) => isCloudQueued(jobs.get(qid)));
  if (!nextId) {
    const orphan = [...jobs.values()].find((j) => isCloudQueued(j));
    if (orphan) {
      nextId = orphan.id;
      if (!queue.includes(nextId)) queue.push(nextId);
    }
  }
  if (!nextId) return;
  const job = jobs.get(nextId);
  if (!job) return;
  running = true;
  console.log(`[ClipForge] pump start ${job.id} · ${job.originalName}`);
  updateJob(job.id, {
    status: "running",
    startedAt: new Date().toISOString(),
    progress: 1,
    stage: "Start",
    error: null,
    canRetry: false,
    log: "Job started (worker)",
  });
  try {
    if (!job.inputPath || !fs.existsSync(job.inputPath)) {
      throw new Error("Brak pliku źródłowego — wrzuć filmik ponownie.");
    }
    // Non-blocking for HTTP: child process
    await runJobInWorker(job);
    updateJob(job.id, {
      status: "done",
      progress: 100,
      stage: "Gotowe",
      finishedAt: new Date().toISOString(),
      log: "Job finished",
    });
    save();
    console.log(`[ClipForge] pump done ${job.id}`);
  } catch (err) {
    // User cancel/reset already set status — don't overwrite with worker kill noise
    if (
      job.status === "failed" &&
      /Anulowane/i.test(String(job.error || ""))
    ) {
      console.log(`[ClipForge] pump stop (cancelled) ${job.id}`);
      save();
    } else {
      console.error(`[ClipForge] pump fail ${job.id}:`, err.message || err);
      updateJob(job.id, {
        status: "failed",
        error: err.message || String(err),
        canRetry: !!(job.inputPath && fs.existsSync(job.inputPath)),
        stage: "Błąd",
        finishedAt: new Date().toISOString(),
        log: "Error: " + (err.message || String(err)),
      });
      save();
    }
  } finally {
    running = false;
    queue = queue.filter((qid) => qid !== nextId);
    setImmediate(() => pump());
  }
}

function enqueuePump() {
  setImmediate(() => {
    try {
      pump();
    } catch (e) {
      console.error("[ClipForge] pump crash:", e);
      running = false;
    }
  });
}

/** Kill active worker (e.g. on shutdown) */
function killWorker() {
  if (workerChild && !workerChild.killed) {
    try {
      workerChild.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      // Windows: kill process tree
      const { spawnSync } = require("child_process");
      if (workerChild.pid) {
        spawnSync(
          "taskkill",
          ["/F", "/T", "/PID", String(workerChild.pid)],
          { windowsHide: true }
        );
      }
    } catch {
      /* ignore */
    }
    workerChild = null;
  }
}

/**
 * If a job has been "running" with no updates for too long, kill worker and fail it.
 * Prevents permanent "stoi w miejscu" freezes.
 */
const STUCK_MS = 4 * 60 * 1000; // 4 minutes without progress
function watchStuckJobs() {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.status !== "running") continue;
    const t = Date.parse(job.updatedAt || job.startedAt || job.createdAt || 0);
    if (!t || now - t < STUCK_MS) continue;
    console.warn(
      `[ClipForge] STUCK job ${job.id} (${job.stage} ${job.progress}%) — kill`
    );
    killWorker();
    updateJob(job.id, {
      status: "failed",
      error:
        "Zatrzymane — brak postępu przez 4 min. Kliknij «Uruchom ponownie» (zalecane: Szybki HD).",
      canRetry: !!(job.inputPath && fs.existsSync(job.inputPath)),
      stage: "Zatrzymane (timeout)",
      finishedAt: new Date().toISOString(),
      log: "Watchdog: stuck timeout",
    });
    running = false;
    queue = queue.filter((qid) => qid !== job.id);
    save();
    enqueuePump();
  }
  // Also recover if flag stuck with no running job
  if (running) {
    const any = [...jobs.values()].some((j) => j.status === "running");
    if (!any) {
      running = false;
      enqueuePump();
    }
  }
}

/**
 * Delete files/dirs for a job (no permanent video hosting).
 */
function rmSafe(p) {
  if (!p || typeof p !== "string") return;
  try {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      fs.rmSync(p, { recursive: true, force: true });
    } else {
      fs.unlinkSync(p);
    }
  } catch {
    /* ignore */
  }
}

function purgeJobFiles(job, { keepOutput = false } = {}) {
  if (!job) return;
  if (job.inputPath) rmSafe(job.inputPath);
  if (!keepOutput) {
    if (job.outputPath) rmSafe(job.outputPath);
    if (job.previewPath) rmSafe(job.previewPath);
    if (job.result?.srtPath) rmSafe(job.result.srtPath);
  }
  // work folder per job
  rmSafe(path.join(WORK_DIR, job.id));
}

/** How long finished/failed job files stay on disk (default 2h). */
const FILE_TTL_MS = Number(process.env.STUDIO_FILE_TTL_MS) || 2 * 60 * 60 * 1000;

function purgeExpiredJobs() {
  const now = Date.now();
  let n = 0;
  for (const job of [...jobs.values()]) {
    if (job.status === "running" || job.status === "queued") continue;
    const t = Date.parse(job.finishedAt || job.updatedAt || job.createdAt || 0);
    if (!t || now - t < FILE_TTL_MS) continue;
    purgeJobFiles(job, { keepOutput: false });
    jobs.delete(job.id);
    n++;
  }
  if (n) {
    save();
    console.log(`[ClipForge] auto-purge: usunięto ${n} starych jobów (brak trwałego hostingu)`);
  }
  // Also scrub orphan upload files older than TTL
  try {
    if (fs.existsSync(UPLOAD_DIR)) {
      for (const name of fs.readdirSync(UPLOAD_DIR)) {
        const p = path.join(UPLOAD_DIR, name);
        try {
          const st = fs.statSync(p);
          if (now - st.mtimeMs > FILE_TTL_MS) rmSafe(p);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return n;
}

// Start watchdog once (parent process only — not in worker fork)
if (!process.env.CLIPFORGE_WORKER) {
  setInterval(watchStuckJobs, 20000).unref?.();
  setInterval(purgeExpiredJobs, 10 * 60 * 1000).unref?.(); // every 10 min
  // purge old junk shortly after boot
  setTimeout(() => {
    try {
      purgeExpiredJobs();
    } catch {
      /* ignore */
    }
  }, 15000).unref?.();
}

load();

module.exports = {
  ROOT,
  STUDIO_DIR,
  UPLOAD_DIR,
  OUTPUT_DIR,
  WORK_DIR,
  createJob,
  claimPcJob,
  getJob,
  listJobs,
  ownsJob,
  isUserBusy,
  isServerBusy,
  updateJob,
  publicJob,
  retryJob,
  resumeInterrupted,
  clearQueue,
  cancelJob,
  cancelAllActive,
  resetStudio,
  setQueueRunner,
  enqueuePump,
  ensureDirs,
  killWorker,
  purgeJobFiles,
  purgeExpiredJobs,
  FILE_TTL_MS,
};
