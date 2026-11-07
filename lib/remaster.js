/**
 * Last Century remaster pre-pass: clean → stabilize → grade → DeOldify.
 * Real-ESRGAN (×2 animevideov3) runs afterwards in the main pipeline.
 * FFmpeg stages work everywhere (cloud OK for short clips);
 * DeOldify needs Python + torch + models → PC agent only.
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const PRESETS = {
  lastCentury: {
    remasterClean: "nlmeans", // off | hqdn3d | nlmeans | atadenoise
    remasterCleanStrength: 50,
    remasterDeflicker: true,
    remasterDeblock: true,
    remasterStabilize: "light", // off | light | strong (separate from main stabilize)
    remasterGrade: "archival", // off | archival | warm | neutral
    deoldify: true,
    deoldifyRenderFactor: 21,
    upscale: "ai",
    aiModel: "animevideov3",
    aiScale: 2,
    narrator: false,
    subtitles: false,
  },
};

function applyPreset(opts) {
  const p = opts && opts.remasterPreset && PRESETS[opts.remasterPreset];
  if (!p) return opts;
  for (const [k, v] of Object.entries(p)) if (opts[k] == null || opts.remasterPresetForce) opts[k] = v;
  return opts;
}

function cleanFilters(opts) {
  const out = [];
  const s = Math.max(0, Math.min(100, Number(opts.remasterCleanStrength ?? 50))) / 100;
  if (opts.remasterDeflicker) out.push("deflicker=mode=pm:size=5");
  if (opts.remasterDeblock) out.push("deblock=filter=weak:block=4");
  switch (String(opts.remasterClean || "off")) {
    case "hqdn3d": {
      const l = (1 + s * 5).toFixed(1), t = (2 + s * 6).toFixed(1);
      out.push(`hqdn3d=${l}:${l}:${t}:${t}`);
      break;
    }
    case "nlmeans":
      // slow but best for film grain; keep chunks short on cloud
      out.push(`nlmeans=s=${(1 + s * 5).toFixed(1)}:p=7:r=9`);
      break;
    case "atadenoise":
      out.push("atadenoise=0a=0.02:0b=0.04:1a=0.02:1b=0.04:s=9");
      break;
  }
  return out;
}

function stabFilters(opts) {
  const v = String(opts.remasterStabilize || "off");
  if (v === "off") return [];
  return [v === "strong" ? "deshake=rx=32:ry=32:edge=mirror" : "deshake=rx=16:ry=16:edge=mirror"];
}

function gradeFilters(opts) {
  const g = String(opts.remasterGrade || "off");
  if (opts.remasterLut && fs.existsSync(opts.remasterLut)) return [`lut3d=file='${opts.remasterLut.replace(/'/g, "")}'`];
  if (g === "archival")
    return ["eq=contrast=1.08:brightness=0.01:gamma=0.97", "curves=master='0/0.03 0.5/0.5 1/0.97'", "unsharp=5:5:0.4"];
  if (g === "warm") return ["eq=contrast=1.05", "colorbalance=rs=0.04:bs=-0.04:rm=0.03:bm=-0.03"];
  if (g === "neutral") return ["eq=contrast=1.04:gamma=0.98"];
  return [];
}

function needsRemaster(opts) {
  return (
    (opts.remasterClean && opts.remasterClean !== "off") ||
    opts.remasterDeflicker || (opts.remasterStabilize && opts.remasterStabilize !== "off") ||
    (opts.remasterGrade && opts.remasterGrade !== "off") ||
    opts.remasterLut || opts.deoldify
  );
}

const DEOLDIFY_WEIGHTS_BYTES = 874066230;

function readJsonFile(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    let raw = fs.readFileSync(file, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch (_) {
    return null;
  }
}

/** Agent config written by scripts/setup-deoldify.ps1 (user env is a second copy). */
function readAgentConfig() {
  const root = path.join(__dirname, "..");
  const la = process.env.LOCALAPPDATA;
  const files = [
    path.join(root, "data", "agent-config.json"),
    la && path.join(la, "ClipForge-Agent", "data", "agent-config.json"),
    la && path.join(la, "ClipForge-Agent-data", "deoldify", "install.json"),
  ].filter(Boolean);
  const merged = {};
  for (const file of files) {
    const data = readJsonFile(file);
    if (!data) continue;
    for (const [k, v] of Object.entries(data)) {
      if (merged[k] == null && v != null && v !== "") merged[k] = v;
    }
  }
  return merged;
}

function configValue(key) {
  const v = readAgentConfig()[key];
  return v == null ? "" : String(v);
}

function findDeOldify() {
  const la = process.env.LOCALAPPDATA;
  const candidates = [
    process.env.DEOLDIFY_DIR,
    configValue("DEOLDIFY_DIR"),
    la && path.join(la, "ClipForge-Agent-data", "deoldify"),
    la && path.join(la, "ClipForge-Agent", "tools", "DeOldify"),
    path.join(__dirname, "..", "tools", "DeOldify"),
    "/workspace/nosferatu/DeOldify",
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "models", "ColorizeVideo_gen.pth"))) return dir;
    } catch (_) {}
  }
  return null;
}

function findDeOldifyPython() {
  const la = process.env.LOCALAPPDATA;
  const root = path.join(__dirname, "..");
  const candidates = [
    process.env.DEOLDIFY_PYTHON,
    configValue("DEOLDIFY_PYTHON"),
    la && path.join(la, "ClipForge-Agent-data", "deoldify", "venv", "Scripts", "python.exe"),
    la && path.join(la, "ClipForge-Agent-data", "deoldify", "venv", "bin", "python"),
    la && path.join(la, "ClipForge-Agent", "tools", "venv_deoldify", "Scripts", "python.exe"),
    path.join(root, "tools", "venv_deoldify", "Scripts", "python.exe"),
    path.join(root, "tools", "venv_deoldify", "bin", "python"),
    "/workspace/nosferatu/venv_deoldify/bin/python",
  ].filter(Boolean);
  for (const py of candidates) {
    try { if (fs.existsSync(py)) return py; } catch (_) {}
  }
  // A bare "python" on Windows is often the Store stub and is not the DeOldify venv.
  if (process.platform === "win32") return null;
  return "python3";
}

function deoldifyScriptPath() {
  return path.join(__dirname, "..", "scripts", "remaster", "deoldify_frames.py");
}

function deoldifyNotReadyMessage(parts) {
  const lines = [
    "DeOldify jest wlaczone, a instalacja na tym PC jest niepelna. Job zatrzymany (wynik bez koloru nie jest sukcesem).",
  ];
  if (!parts.dir) {
    lines.push(
      "Brak modelu models\\ColorizeVideo_gen.pth (oczekiwany rozmiar " + DEOLDIFY_WEIGHTS_BYTES + " B)."
    );
  }
  if (!parts.py) {
    lines.push("Brak Pythona venv DeOldify (Windows: venv\\Scripts\\python.exe).");
  }
  if (!parts.script) {
    lines.push("Brak scripts\\remaster\\deoldify_frames.py w instalacji agenta.");
  }
  lines.push("Zaloguj sie w Studio, kliknij PC i uruchom swiezy pc-setup.cmd (setup11).");
  lines.push("Albo na tym komputerze: %LOCALAPPDATA%\\ClipForge-Agent\\SETUP-DEOLDIFY.bat");
  lines.push(
    "Setup wstawia Python 3.10, DeOldify i wagi do %LOCALAPPDATA%\\ClipForge-Agent-data\\deoldify (to przezywa reinstalacje agenta)."
  );
  lines.push("Log instalacji: %TEMP%\\clipforge-deoldify-setup.log");
  return lines.join(" ");
}

class DeOldifyNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeOldifyNotReadyError";
    this.code = "DEOLDIFY_NOT_READY";
  }
}

function remasterErrorIsFatal(err, opts) {
  if (opts && opts.remasterStrict) return true;
  const code = err && err.code;
  return code === "DEOLDIFY_NOT_READY" || code === "DEOLDIFY_FAILED";
}

function buildDeoldifyArgs({ script, dir, fin, fout, renderFactor, gpu }) {
  const args = [
    script,
    "--deoldify-dir",
    dir,
    "--in",
    fin,
    "--out",
    fout,
    "--render-factor",
    String(renderFactor || 21),
  ];
  if (gpu) args.push("--gpu");
  return args;
}

let cudaProbeCache = null;
function probeDeoldifyCuda(py) {
  if (!py) return false;
  if (cudaProbeCache && cudaProbeCache.py === py) return cudaProbeCache.ok;
  let ok = false;
  try {
    const r = spawnSync(
      py,
      ["-c", "import torch; print('1' if torch.cuda.is_available() else '0')"],
      { encoding: "utf8", timeout: 180000, windowsHide: true }
    );
    ok = !r.error && r.status === 0 && /1/.test(String(r.stdout || ""));
  } catch (_) {
    ok = false;
  }
  cudaProbeCache = { py, ok };
  return ok;
}

function sh(cmd, args, onLine) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = "";
    const f = (d) => { const s = String(d); err = (err + s).slice(-4000); onLine && onLine(s); };
    p.stdout.on("data", f); p.stderr.on("data", f);
    p.on("error", rej);
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(cmd + " exit " + c + ": " + err.slice(-600)))));
  });
}

/** Returns path of remastered intermediate (lossless-ish) or the input if nothing to do. */
async function runRemaster({ ffmpeg, input, work, opts, onUpdate }) {
  applyPreset(opts);
  if (!needsRemaster(opts)) return input;
  const say = (stage, log) => onUpdate && onUpdate({ stage, log });
  const vf = [...cleanFilters(opts), ...stabFilters(opts), ...gradeFilters(opts)];
  let cur = input;
  if (vf.length) {
    say("Remaster: clean → stabilize → grade", vf.join(","));
    const out = path.join(work, "remaster_ffmpeg.mkv");
    await sh(ffmpeg, ["-y", "-i", cur, "-vf", vf.join(","), "-c:v", "libx264", "-crf", "12", "-preset", "medium",
      "-pix_fmt", "yuv420p", "-c:a", "copy", out]);
    cur = out;
  }
  if (opts.deoldify) {
    try {
      const dir = findDeOldify();
      const py = findDeOldifyPython();
      const script = deoldifyScriptPath();
      const scriptOk = fs.existsSync(script);
      if (!dir || !py || !scriptOk) {
        const msg = deoldifyNotReadyMessage({ dir, py, script: scriptOk });
        say("DeOldify niegotowy", msg);
        throw new DeOldifyNotReadyError(msg);
      }
      const fin = path.join(work, "do_in"), fout = path.join(work, "do_out");
      fs.mkdirSync(fin, { recursive: true }); fs.mkdirSync(fout, { recursive: true });
      say("DeOldify: klatki", "ekstrakcja");
      await sh(ffmpeg, ["-y", "-i", cur, path.join(fin, "%06d.png")]);
      const gpu = probeDeoldifyCuda(py);
      say(gpu ? "DeOldify: CUDA" : "DeOldify: CPU", dir);
      await sh(
        py,
        buildDeoldifyArgs({
          script,
          dir,
          fin,
          fout,
          renderFactor: opts.deoldifyRenderFactor || 21,
          gpu,
        }),
        (l) => say("DeOldify", l.trim().slice(-200))
      );
      const fps = opts._sourceFps || 24;
      const out = path.join(work, "remaster_color.mkv");
      await sh(ffmpeg, ["-y", "-framerate", String(fps), "-i", path.join(fout, "%06d.png"), "-i", cur,
        "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", out]);
      cur = out;
    } catch (e) {
      if (e && e.code === "DEOLDIFY_NOT_READY") throw e;
      const err = new Error(
        "DeOldify nie ukonczylo koloryzacji: " +
          (e && e.message ? e.message : e) +
          " Uruchom %LOCALAPPDATA%\\ClipForge-Agent\\SETUP-DEOLDIFY.bat i sprawdz %TEMP%\\clipforge-deoldify-setup.log. Job zatrzymany."
      );
      err.code = "DEOLDIFY_FAILED";
      say("DeOldify blad", err.message);
      throw err;
    }
  }
  return cur;
}

module.exports = {
  PRESETS,
  applyPreset,
  cleanFilters,
  gradeFilters,
  needsRemaster,
  findDeOldify,
  findDeOldifyPython,
  runRemaster,
  readAgentConfig,
  deoldifyNotReadyMessage,
  deoldifyScriptPath,
  buildDeoldifyArgs,
  probeDeoldifyCuda,
  remasterErrorIsFatal,
  DeOldifyNotReadyError,
  DEOLDIFY_WEIGHTS_BYTES,
};
