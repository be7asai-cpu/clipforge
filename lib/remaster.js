/**
 * Last Century remaster pre-pass: clean → stabilize → grade → DeOldify.
 * Real-ESRGAN (×2 animevideov3) runs afterwards in the main pipeline.
 * FFmpeg stages work everywhere (cloud OK for short clips);
 * DeOldify needs Python + torch + models → PC agent only.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

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

function findDeOldify() {
  const dir = process.env.DEOLDIFY_DIR ||
    (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ClipForge-Agent", "tools", "DeOldify"));
  if (!dir) return null;
  const model = path.join(dir, "models", "ColorizeVideo_gen.pth");
  return fs.existsSync(model) ? dir : null;
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
    const dir = findDeOldify();
    if (!dir) {
      say("DeOldify pominięty", "Brak DEOLDIFY_DIR/models/ColorizeVideo_gen.pth — działa tylko na PC Agent");
      return cur;
    }
    const py = process.env.DEOLDIFY_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const fin = path.join(work, "do_in"), fout = path.join(work, "do_out");
    fs.mkdirSync(fin, { recursive: true }); fs.mkdirSync(fout, { recursive: true });
    say("DeOldify: klatki", "ekstrakcja");
    await sh(ffmpeg, ["-y", "-i", cur, path.join(fin, "%06d.png")]);
    const script = path.join(__dirname, "..", "scripts", "remaster", "deoldify_frames.py");
    say("DeOldify: koloryzacja", dir);
    await sh(py, [script, "--deoldify-dir", dir, "--in", fin, "--out", fout,
      "--render-factor", String(opts.deoldifyRenderFactor || 21)], (l) => say("DeOldify", l.trim().slice(-200)));
    const fps = opts._sourceFps || 24;
    const out = path.join(work, "remaster_color.mkv");
    await sh(ffmpeg, ["-y", "-framerate", String(fps), "-i", path.join(fout, "%06d.png"), "-i", cur,
      "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", out]);
    cur = out;
  }
  return cur;
}

module.exports = { PRESETS, applyPreset, cleanFilters, gradeFilters, needsRemaster, findDeOldify, runRemaster };
