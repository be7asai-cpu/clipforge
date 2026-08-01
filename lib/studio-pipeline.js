/**
 * ClipWave Studio pipeline
 * Options: delogo, upscale (ai|fast|off), narrator (pl), subtitles, polish
 * Reports progress 0–100 via onUpdate({ progress, stage, log }).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync, spawn } = require("child_process");
const { OUTPUT_DIR, WORK_DIR, ROOT } = require("./studio-jobs");

function ffmpegPath() {
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* fall through */
  }
  // PATH fallback (system install)
  return "ffmpeg";
}

/** Ensure ffmpeg binary actually starts (Windows often blocks broken/partial npm binaries). */
function assertFfmpegWorks(ffmpeg) {
  if (!ffmpeg) throw new Error("Brak FFmpeg (ffmpeg-static).");
  if (ffmpeg !== "ffmpeg" && !fs.existsSync(ffmpeg)) {
    throw new Error("Brak pliku FFmpeg: " + ffmpeg);
  }
  const r = spawnSync(ffmpeg, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (r.error) {
    const code = r.error.code || "";
    throw new Error(
      "FFmpeg nie startuje (" +
        code +
        "): " +
        (r.error.message || r.error) +
        ". Usuń folder %LOCALAPPDATA%\\ClipForge-Agent i pobierz agenta ponownie (albo skopiuj działający ffmpeg.exe do node_modules\\ffmpeg-static\\)."
    );
  }
  const out = (r.stdout || "") + (r.stderr || "");
  if (!/ffmpeg\s+version/i.test(out) && (r.status || 0) !== 0) {
    throw new Error(
      "FFmpeg nie odpowiada poprawnie (kod " +
        r.status +
        "). Plik może być zablokowany przez Windows / antywirus."
    );
  }
}

function findRealEsrgan() {
  const exe = "realesrgan-ncnn-vulkan.exe";
  const candidates = [
    process.env.REALESRGAN_PATH,
    path.join(ROOT, "tools", "realesrgan", exe),
    // PC agent install dir (same machine as agent process)
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "ClipForge-Agent",
          "tools",
          "realesrgan",
          exe
        )
      : null,
    path.join(
      process.env.USERPROFILE || "",
      "AppData",
      "Local",
      "ClipForge-Agent",
      "tools",
      "realesrgan",
      exe
    ),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Real-ESRGAN model id → files on disk + fixed scale (null = use UI scale 2/3/4).
 * - animevideov3: video-friendly, multi-scale
 * - x4plus: photoreal, stronger, always ×4 (~32 MB)
 * - x4plus-anime: anime stills, always ×4
 */
const ESRGAN_MODELS = {
  animevideov3: {
    id: "realesr-animevideov3",
    label: "Anime/Video (szybki)",
    fixedScale: null,
    files: [
      "realesr-animevideov3-x2.bin",
      "realesr-animevideov3-x3.bin",
      "realesr-animevideov3-x4.bin",
    ],
  },
  x4plus: {
    id: "realesrgan-x4plus",
    label: "Fotoreal x4plus (mocny)",
    fixedScale: 4,
    files: ["realesrgan-x4plus.bin"],
  },
  "x4plus-anime": {
    id: "realesrgan-x4plus-anime",
    label: "Anime x4plus",
    fixedScale: 4,
    files: ["realesrgan-x4plus-anime.bin"],
  },
};

function resolveEsrganModel(modelDir, requested) {
  const key = String(requested || "animevideov3").toLowerCase();
  const order = [key, "animevideov3", "x4plus", "x4plus-anime"].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  for (const k of order) {
    const meta = ESRGAN_MODELS[k];
    if (!meta) continue;
    const ok = meta.files.every((f) =>
      fs.existsSync(path.join(modelDir, f))
    );
    // animevideov3 needs matching scale file; at least one xN is enough if we pick scale later
    if (k === "animevideov3") {
      const any = ["x2", "x3", "x4"].some((s) =>
        fs.existsSync(path.join(modelDir, `realesr-animevideov3-${s}.bin`))
      );
      if (any) {
        return {
          key: k,
          name: meta.id,
          fixedScale: meta.fixedScale,
          label: meta.label,
          fallback: k !== key,
        };
      }
      continue;
    }
    if (ok) {
      return {
        key: k,
        name: meta.id,
        fixedScale: meta.fixedScale,
        label: meta.label,
        fallback: k !== key,
      };
    }
  }
  // Last resort: pass anime name even if files missing (ESRGAN may still fail later)
  return {
    key: "animevideov3",
    name: "realesr-animevideov3",
    fixedScale: null,
    label: "Anime/Video",
    fallback: true,
  };
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
    windowsHide: true,
    ...opts,
  });
  return r;
}

/**
 * Async ffmpeg that keeps the event loop alive (progress heartbeats / IPC work).
 * spawnSync freezes % bar and parent thinks the app is stuck.
 * @returns {Promise<{status:number, stderr:string}>}
 */
function runAsync(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8 * 60 * 1000;
  const onTick = opts.onTick || null;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let settled = false;
    let errBuf = "";
    const tick = onTick
      ? setInterval(() => {
          try {
            onTick();
          } catch {
            /* ignore */
          }
        }, opts.tickMs || 2000)
      : null;
    const kill = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      try {
        if (child.pid) {
          spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
            windowsHide: true,
          });
        }
      } catch {
        /* ignore */
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      kill();
    }, timeoutMs);
    if (child.stderr) {
      child.stderr.on("data", (b) => {
        errBuf += b.toString();
        if (errBuf.length > 12000) errBuf = errBuf.slice(-6000);
      });
    }
    const finish = (status) => {
      if (settled) return;
      settled = true;
      if (tick) clearInterval(tick);
      clearTimeout(timer);
      resolve({ status, stderr: errBuf, stdout: "" });
    };
    child.on("error", (e) => {
      errBuf += String(e && e.message ? e.message : e);
      finish(1);
    });
    child.on("close", (code) => finish(code == null ? 1 : code));
  });
}

function probe(ffmpeg, file) {
  if (!file || !fs.existsSync(file)) {
    return { width: null, height: null, fps: 30, duration: null, error: "Brak pliku: " + file };
  }
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    size = 0;
  }
  if (size < 64) {
    return {
      width: null,
      height: null,
      fps: 30,
      duration: null,
      error: "Plik zbyt mały (" + size + " B) — prawdopodobnie uszkodzony download",
    };
  }
  const r = run(ffmpeg, ["-hide_banner", "-i", file], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) {
    return {
      width: null,
      height: null,
      fps: 30,
      duration: null,
      error:
        "FFmpeg nie startuje: " +
        (r.error.code || "") +
        " " +
        (r.error.message || r.error) +
        " [" +
        ffmpeg +
        "]",
    };
  }
  const err = String((r.stderr || "") + (r.stdout || ""));
  // FFmpeg 6+ lines are long — match WxH flexibly (old regex failed on some builds)
  const m =
    err.match(/Stream\s+#0:\d+[^\r\n]*Video:[^\r\n]*?(\d{2,5})x(\d{2,5})/i) ||
    err.match(/Video:[^\r\n]*?(\d{2,5})x(\d{2,5})/i) ||
    err.match(/(\d{2,5})x(\d{2,5})/);
  const fpsM = err.match(/([\d.]+)\s*fps/);
  // Accept 00:01:05, 00:01:05.12, 00:01:05,50 (comma locale)
  const durM =
    err.match(/Duration:\s*(\d+):(\d+):(\d+[.,]\d+)/) ||
    err.match(/Duration:\s*(\d+):(\d+):(\d+)\b/);
  let duration = null;
  if (durM) {
    const sec = Number(String(durM[3]).replace(",", "."));
    duration =
      Number(durM[1]) * 3600 + Number(durM[2]) * 60 + (Number.isFinite(sec) ? sec : 0);
    if (!Number.isFinite(duration) || duration <= 0) duration = null;
  }
  const nbM = err.match(/,\s*(\d+)\s*frames?/);
  let fps = fpsM ? Number(fpsM[1]) : 30;
  // Many shorts are tagged 60fps but have half the frames
  if (duration && nbM) {
    const real = Number(nbM[1]) / duration;
    if (real > 1 && Math.abs(real - fps) > 10) fps = Math.round(real * 100) / 100;
  }
  if (!m) {
    return {
      width: null,
      height: null,
      fps: fps || 30,
      duration,
      error:
        "brak WxH w ffmpeg (size=" +
        size +
        " B, bin=" +
        ffmpeg +
        "): " +
        err.replace(/\s+/g, " ").slice(-350),
    };
  }
  // Prefer duration-based fps from frame extract later
  return {
    width: Number(m[1]),
    height: Number(m[2]),
    fps: fps || 30,
    duration,
    error: m
      ? null
      : err
        ? "FFmpeg nie widzi strumienia wideo (" + String(err).slice(0, 180).replace(/\s+/g, " ") + ")"
        : "Brak odpowiedzi FFmpeg",
  };
}

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) rmrf(p);
    else {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    /* ignore */
  }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function normalizeBox(box, vw, vh) {
  if (!box) return null;
  let x = Math.round(Number(box.x) || 0);
  let y = Math.round(Number(box.y) || 0);
  let bw = Math.round(Number(box.w ?? box.width) || 0);
  let bh = Math.round(Number(box.h ?? box.height) || 0);
  if (bw < 2 || bh < 2) return null;
  // pad a few px so thin watermarks are fully covered
  const pad = Math.max(2, Math.round(Math.min(vw, vh) * 0.006));
  x = clamp(x - pad, 0, Math.max(0, vw - 2));
  y = clamp(y - pad, 0, Math.max(0, vh - 2));
  bw = clamp(bw + pad * 2, 2, vw - x);
  bh = clamp(bh + pad * 2, 2, vh - y);
  // delogo requires even-ish safe sizes
  if (bw % 2) bw = Math.max(2, bw - 1);
  if (bh % 2) bh = Math.max(2, bh - 1);
  return { x, y, w: bw, h: bh };
}

/**
 * Build delogo / blur / black-box filters for one or more regions.
 * Manual boxes are preferred (from UI canvas). Fallback: bottom watermark band.
 */
function delogoFilters(opts, vw, vh) {
  if (!opts.delogo) return [];
  const method = opts.delogoMethod || "delogo"; // delogo | blur | box
  const boxes = [];

  if (opts.delogoMode === "manual") {
    const list = Array.isArray(opts.delogoBoxes)
      ? opts.delogoBoxes
      : opts.delogoBox
        ? [opts.delogoBox]
        : [];
    for (const b of list) {
      const n = normalizeBox(b, vw, vh);
      if (n) boxes.push(n);
    }
  }

  if (!boxes.length) {
    // Auto: bottom-center watermark + slightly larger band (common FILMIKI.TV etc.)
    const dh = Math.max(40, Math.round((vh || 720) * 0.09));
    const dy = Math.max(0, (vh || 720) - dh - Math.round((vh || 720) * 0.03));
    const dw = Math.round((vw || 550) * 0.62);
    const dx = Math.round(((vw || 550) - dw) / 2);
    boxes.push(normalizeBox({ x: dx, y: dy, w: dw, h: dh }, vw, vh));
  }

  const filters = [];
  for (const b of boxes) {
    if (!b) continue;
    if (method === "blur") {
      // Cover region with strong boxblur via split/overlay crop
      // simpler approach: use delogo first then extra blur via geq — use crop+boxblur+overlay chain
      filters.push(
        `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:show=0`
      );
    } else if (method === "box") {
      // solid dark bar (always hides logo)
      filters.push(
        `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=black@0.92:t=fill`
      );
    } else {
      filters.push(`delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:show=0`);
    }
  }
  return filters.filter(Boolean);
}

/** @deprecated single string helper */
function delogoFilter(opts, w, h) {
  const parts = delogoFilters(opts, w, h);
  return parts.length ? parts.join(",") : null;
}

/**
 * Probe loudness (volumedetect) and suggest audio enhance values (0–100 sliders).
 */
function analyzeAutoAudio(ffmpeg, file, info) {
  const dur = Math.max(1, Number(info.duration) || 20);
  const sampleSec = Math.min(dur, 40);
  const r = run(
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-t",
      String(sampleSec),
      "-vn",
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }
  );
  const text = String((r.stderr || "") + (r.stdout || ""));
  const meanM = text.match(/mean_volume:\s*([-\d.]+)\s*dB/i);
  const maxM = text.match(/max_volume:\s*([-\d.]+)\s*dB/i);
  const mean = meanM ? Number(meanM[1]) : null;
  const max = maxM ? Number(maxM[1]) : null;

  // Defaults (UI 0–100)
  let audioVolume = 55;
  let audioBass = 50;
  let audioTreble = 52;
  let audioDenoise = 22;
  let audioVoiceOnly = false;
  let audioNormalize = true;
  let audioBitrate = 160;
  let qualityHint = "balanced";

  if (mean != null && !Number.isNaN(mean)) {
    // Quiet → boost; loud → lower
    if (mean < -35) {
      audioVolume = 72;
      audioNormalize = true;
      qualityHint = "quiet→boost";
    } else if (mean < -28) {
      audioVolume = 64;
      qualityHint = "soft";
    } else if (mean > -12) {
      audioVolume = 42;
      audioNormalize = true;
      qualityHint = "loud→tame";
    } else if (mean > -18) {
      audioVolume = 48;
      qualityHint = "ok";
    }
  }
  if (max != null && max > -1.5) {
    // Clipping risk
    audioVolume = Math.min(audioVolume, 45);
    audioNormalize = true;
    qualityHint += "+clip";
  }
  // Very quiet max often means noise floor / weak mic
  if (max != null && max < -20 && mean != null && mean < -30) {
    audioDenoise = 35;
    audioVoiceOnly = true;
    audioTreble = 58;
    audioBass = 42;
    qualityHint += "+speech";
  }

  // Prefer higher bitrate when source was loud/clear
  if (mean != null && mean > -22 && mean < -14) audioBitrate = 192;

  return {
    audioVolume,
    audioBass,
    audioTreble,
    audioDenoise,
    audioVoiceOnly,
    audioNormalize,
    // don't override user bitrate if they set one in auto UI — we only suggest when unset
    _autoAudioBitrate: audioBitrate,
    _autoAudioStats: { mean, max, qualityHint, sampleSec },
  };
}

/**
 * Build ffmpeg af chain from enhance options (no labels).
 * Slider range 0–100; 50 ≈ neutral for EQ/volume baseline.
 */
function buildAudioEnhanceChain(opts, role) {
  if (!opts || opts.audioEnhance === false || opts.audioMode === "off") {
    return "";
  }
  const parts = [];
  const voiceOnly = !!opts.audioVoiceOnly;
  const denoise = Number(opts.audioDenoise);
  const bass = Number(opts.audioBass);
  const treble = Number(opts.audioTreble);
  const vol = Number(opts.audioVolume);
  const normalize = opts.audioNormalize !== false;

  if (voiceOnly) {
    // Speech band — cut rumble / hiss
    parts.push("highpass=f=100");
    parts.push("lowpass=f=8500");
  }

  if (!Number.isNaN(denoise) && denoise > 8) {
    // afftdn nr ~6–28
    const nr = Math.round(6 + (Math.min(100, denoise) / 100) * 22);
    parts.push(`afftdn=nr=${nr}:nf=-25`);
  }

  if (!Number.isNaN(bass) && Math.abs(bass - 50) > 2) {
    const g = (((bass - 50) / 50) * 12).toFixed(1);
    parts.push(`bass=g=${g}`);
  }
  if (!Number.isNaN(treble) && Math.abs(treble - 50) > 2) {
    const g = (((treble - 50) / 50) * 10).toFixed(1);
    parts.push(`treble=g=${g}`);
  }

  // Volume: 50 → 0 dB, 100 → +15 dB, 0 → -15 dB
  if (!Number.isNaN(vol) && Math.abs(vol - 50) > 1) {
    const db = (((vol - 50) / 50) * 15).toFixed(1);
    parts.push(`volume=${db}dB`);
  }

  // Light dynamics (not full loudnorm — keeps mux fast)
  if (normalize) {
    parts.push(
      "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=80:makeup=2"
    );
  }

  // Narrator voice track: milder denoise only if nothing else
  if (role === "voice" && parts.length === 0) {
    return "anull";
  }
  return parts.join(",");
}

function audioBitrateK(opts) {
  const n = Number(opts && opts.audioBitrate);
  if ([96, 128, 160, 192, 256, 320].includes(n)) return n;
  return 160;
}

/**
 * Sample frames with FFmpeg signalstats and suggest polish slider values (0–100).
 * Used when polishMode === "auto".
 */
function analyzeAutoPolish(ffmpeg, file, info) {
  const dur = Math.max(1, Number(info.duration) || 20);
  const sampleSec = Math.min(dur, 48);
  // ~1 frame every few seconds, max ~12 samples, small scale for speed
  const fps = Math.max(0.2, Math.min(0.8, 10 / sampleSec));
  const r = run(
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-t",
      String(sampleSec),
      "-an",
      "-vf",
      `fps=${fps.toFixed(3)},scale=480:-2,signalstats=metadata=1,metadata=print:file=-`,
      "-f",
      "null",
      "-",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 90000 }
  );
  const text = String((r.stderr || "") + (r.stdout || ""));
  const yAvgs = [...text.matchAll(/YAVG[=:]([\d.]+)/gi)].map((m) => Number(m[1]));
  const yMins = [...text.matchAll(/YMIN[=:]([\d.]+)/gi)].map((m) => Number(m[1]));
  const yMaxs = [...text.matchAll(/YMAX[=:]([\d.]+)/gi)].map((m) => Number(m[1]));
  const satAvgs = [
    ...text.matchAll(/SATAVG[=:]([\d.]+)/gi),
    ...text.matchAll(/SATMAX[=:]([\d.]+)/gi),
  ].map((m) => Number(m[1]));

  const avg = (arr) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const yAvg = avg(yAvgs);
  const yMin = avg(yMins);
  const yMax = avg(yMaxs);
  const satAvg = avg(satAvgs);

  // Defaults (UI 0–100 → polishFilters mapping)
  let brightness = 50;
  let contrast = 52;
  let saturation = 55;
  let sharpen = 48;
  let denoise = 14;
  let qualityPreset = "balanced";

  if (yAvg != null) {
    // Typical luma ~16–235 or 0–255 depending on build — normalize heuristically
    const y = yAvg > 1.5 ? yAvg : yAvg * 255;
    if (y < 85) {
      // dark / underexposed
      brightness = 62;
      contrast = 62;
      qualityPreset = "punch";
      sharpen = 52;
    } else if (y < 105) {
      brightness = 56;
      contrast = 58;
      qualityPreset = "balanced";
    } else if (y > 175) {
      // bright / washed
      brightness = 42;
      contrast = 54;
      saturation = 58;
      qualityPreset = "soft";
      denoise = 18;
    } else if (y > 155) {
      brightness = 46;
      contrast = 53;
      qualityPreset = "soft";
    }
  }

  if (yMin != null && yMax != null) {
    const ymin = yMin > 1.5 ? yMin : yMin * 255;
    const ymax = yMax > 1.5 ? yMax : yMax * 255;
    const range = Math.max(0, ymax - ymin);
    if (range < 70) {
      // flat / low contrast
      contrast = Math.min(78, contrast + 16);
      sharpen = Math.min(70, sharpen + 10);
      qualityPreset = qualityPreset === "soft" ? "balanced" : "sharp";
    } else if (range < 100) {
      contrast = Math.min(70, contrast + 8);
    } else if (range > 200) {
      // already punchy
      contrast = Math.max(40, contrast - 8);
      qualityPreset = "soft";
    }
  }

  if (satAvg != null) {
    // SATAVG often ~0–100+; if looks like 0–1 scale, expand
    const s = satAvg <= 2 ? satAvg * 100 : satAvg;
    if (s < 25) {
      saturation = 70;
      qualityPreset = qualityPreset === "soft" ? "balanced" : qualityPreset;
    } else if (s < 40) {
      saturation = 62;
    } else if (s > 90) {
      saturation = 48;
    } else if (s > 70) {
      saturation = 52;
    }
  }

  const h = info.height || 720;
  const d = info.duration || 0;
  if (h > 0 && h < 720) {
    sharpen = Math.min(72, sharpen + 12);
    denoise = Math.max(denoise, 18);
  }
  if (h >= 1440) {
    sharpen = Math.max(35, sharpen - 6);
  }
  if (d >= 50) {
    denoise = Math.min(30, denoise + 6);
  } else if (d > 0 && d <= 15) {
    // short social clips — a bit more punch
    sharpen = Math.min(65, sharpen + 6);
    saturation = Math.min(68, saturation + 4);
  }

  // Clamp UI ranges
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
  return {
    polish: true,
    polishAuto: true,
    qualityPreset,
    brightness: clamp(brightness, 30, 72),
    contrast: clamp(contrast, 35, 80),
    saturation: clamp(saturation, 40, 78),
    sharpen: clamp(sharpen, 25, 75),
    denoise: clamp(denoise, 5, 35),
    _autoStats: {
      yAvg,
      yMin,
      yMax,
      satAvg,
      samples: yAvgs.length,
    },
  };
}

function polishFilters(opts) {
  const parts = [];
  if (opts.polish === false && !opts.qualityPreset) return parts;

  const preset = opts.qualityPreset || "balanced"; // soft | balanced | sharp | punch | auto
  let contrast = 1.05;
  let sat = 1.08;
  let bright = 0.01;
  let sharp = 0.55;
  let denoise = 0;

  if (preset === "soft") {
    contrast = 1.02;
    sat = 1.04;
    sharp = 0.25;
    denoise = 2;
  } else if (preset === "sharp") {
    contrast = 1.08;
    sat = 1.1;
    sharp = 1.0;
    denoise = 1;
  } else if (preset === "punch") {
    contrast = 1.12;
    sat = 1.18;
    bright = 0.02;
    sharp = 1.15;
    denoise = 0;
  }

  // manual / auto overrides from UI sliders 0-100 (auto fills these after analysis)
  if (opts.contrast != null) contrast = 0.8 + (Number(opts.contrast) / 100) * 0.6;
  if (opts.saturation != null) sat = 0.8 + (Number(opts.saturation) / 100) * 0.6;
  if (opts.sharpen != null) sharp = (Number(opts.sharpen) / 100) * 1.4;
  if (opts.denoise != null) denoise = Math.round((Number(opts.denoise) / 100) * 6);
  if (opts.brightness != null) bright = ((Number(opts.brightness) - 50) / 100) * 0.12;

  if (denoise > 0) {
    // hqdn3d light temporal+spatial denoise
    const s = (denoise * 0.8).toFixed(1);
    const t = (denoise * 0.5).toFixed(1);
    parts.push(`hqdn3d=${s}:${s}:${t}:${t}`);
  }
  parts.push(
    `eq=contrast=${contrast.toFixed(3)}:saturation=${sat.toFixed(3)}:brightness=${bright.toFixed(3)}`
  );
  if (sharp > 0.05) {
    const luma = sharp.toFixed(2);
    parts.push(`unsharp=5:5:${luma}:5:5:0.0`);
  }
  return parts;
}

/** even dimension for yuv420p */
function evenDim(n) {
  n = Math.max(2, Math.round(Number(n) || 2));
  return n % 2 === 0 ? n : n - 1;
}

/**
 * Creative look presets (pure FFmpeg — free, no extra AI bins).
 * off | cinematic | cartoon | sketch | comic | vhs | noir | warm | cold
 * Keep filters strong + compatible with ffmpeg-static (avoid fragile vignette/noise modes).
 * @param {object} opts
 * @param {{ simple?: boolean }} [flags] simple=true → ultra-compatible fallback chain
 */
function styleFilters(opts, flags = {}) {
  const style = String(opts.videoStyle || "off").toLowerCase();
  if (!style || style === "off" || style === "none") return [];
  const simple = !!flags.simple;
  switch (style) {
    case "cinematic":
      return simple
        ? ["eq=contrast=1.18:saturation=0.85:brightness=-0.04", "unsharp=5:5:0.5:5:5:0.0"]
        : [
            "eq=contrast=1.2:saturation=0.82:brightness=-0.05",
            "colorbalance=rs=0.06:gs=-0.03:bs=-0.08:rm=0.04:bm=-0.05",
            "unsharp=5:5:0.55:5:5:0.0",
            "curves=all='0/0 0.5/0.42 1/1'",
          ];
    case "cartoon":
      return simple
        ? ["eq=contrast=1.45:saturation=1.55:brightness=0.03", "unsharp=5:5:1.8:5:5:0.0"]
        : [
            "hqdn3d=2.5:2.5:4:4",
            "eq=contrast=1.5:saturation=1.65:brightness=0.04",
            "unsharp=5:5:2.0:5:5:0.0",
          ];
    case "sketch":
      // edgedetect is flaky on some builds — simple path is strong B/W contrast
      return simple
        ? ["format=gray", "eq=contrast=1.7:brightness=0.05"]
        : [
            "format=gray",
            "edgedetect=mode=colormix:high=0.12:low=0.04",
            "eq=contrast=1.55:brightness=0.04",
          ];
    case "comic":
      return simple
        ? ["eq=contrast=1.5:saturation=1.7:brightness=0.02", "unsharp=5:5:2.0:5:5:0.0"]
        : [
            "eq=contrast=1.55:saturation=1.75:brightness=0.02",
            "unsharp=5:5:2.1:5:5:0.0",
            "noise=alls=6:allf=t",
          ];
    case "vhs":
      return simple
        ? ["eq=contrast=1.15:saturation=0.7:brightness=0.04", "hue=s=0.75"]
        : [
            "noise=alls=12:allf=t",
            "eq=contrast=1.18:saturation=0.68:brightness=0.05",
            "hue=s=0.72",
            "curves=vintage",
          ];
    case "noir":
      return simple
        ? ["format=gray", "eq=contrast=1.55:brightness=-0.05"]
        : [
            "format=gray",
            "eq=contrast=1.6:brightness=-0.06",
            "curves=all='0/0 0.5/0.38 1/1'",
            "unsharp=5:5:0.6:5:5:0.0",
          ];
    case "warm":
      return simple
        ? ["eq=saturation=1.25:contrast=1.1:brightness=0.03", "colorbalance=rs=0.12:bs=-0.08"]
        : [
            "eq=saturation=1.28:contrast=1.12:brightness=0.03",
            "colorbalance=rs=0.14:gs=0.03:bs=-0.1",
          ];
    case "cold":
      return simple
        ? ["eq=saturation=0.85:contrast=1.12:brightness=-0.02", "colorbalance=rs=-0.08:bs=0.12"]
        : [
            "eq=saturation=0.82:contrast=1.14:brightness=-0.02",
            "colorbalance=rs=-0.1:bs=0.14:bm=0.06",
          ];
    default:
      return [];
  }
}

/** Build -vf chain for style only (used when full creative encode fails). */
function styleOnlyVf(opts, simple) {
  const parts = styleFilters(opts, { simple: !!simple });
  return parts.filter(Boolean).join(",") || null;
}

/**
 * Aspect reframe: original | 16:9 | 9:16 | 1:1
 * Uses scale+crop (center) to target height.
 */
function aspectFilters(opts, targetH) {
  const aspect = String(opts.videoAspect || "original").toLowerCase();
  if (!aspect || aspect === "original" || aspect === "src") return [];
  const th = evenDim(targetH || opts.targetHeight || 1080);
  let tw;
  if (aspect === "16:9" || aspect === "16x9") tw = evenDim((th * 16) / 9);
  else if (aspect === "9:16" || aspect === "9x16" || aspect === "reels")
    tw = evenDim((th * 9) / 16);
  else if (aspect === "1:1" || aspect === "square") tw = th;
  else return [];
  return [
    `scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${tw}:${th}`,
    "setsar=1",
  ];
}

function stabilizeFilters(opts) {
  const s = String(opts.stabilize || "off").toLowerCase();
  if (!s || s === "off" || s === "none" || s === "false") return [];
  // FFmpeg deshake: rx/ry MUST be multiples of 16 (else whole -vf graph fails
  // and we silently fall back to plain HD — style/aspect look "broken")
  if (s === "strong" || s === "high") {
    return ["deshake=rx=32:ry=32:edge=blank"];
  }
  return ["deshake=rx=16:ry=16:edge=blank"];
}

/**
 * Playback speed (video setpts + audio atempo chain).
 * @returns {{ vf: string[], af: string[] }}
 */
function playbackSpeedFilters(opts) {
  const speed = Number(opts.playbackSpeed);
  if (!speed || Math.abs(speed - 1) < 0.02) return { vf: [], af: [] };
  const clamped = Math.min(2, Math.max(0.5, speed));
  const setpts = (1 / clamped).toFixed(4);
  const af = [];
  let s = clamped;
  // atempo range is 0.5–2.0
  while (s > 2.001) {
    af.push("atempo=2.0");
    s /= 2;
  }
  while (s < 0.499) {
    af.push("atempo=0.5");
    s /= 0.5;
  }
  af.push(`atempo=${s.toFixed(3)}`);
  return { vf: [`setpts=${setpts}*PTS`], af };
}

function fadeEdgeFilters(opts, durationSec) {
  if (!opts.fadeEdges) return { vf: [], af: [] };
  const dur = Math.max(0.5, Number(durationSec) || 5);
  const fade = Math.min(0.6, dur * 0.08);
  const st = Math.max(0, dur - fade);
  return {
    vf: [`fade=t=in:st=0:d=${fade.toFixed(2)}`, `fade=t=out:st=${st.toFixed(2)}:d=${fade.toFixed(2)}`],
    af: [
      `afade=t=in:st=0:d=${fade.toFixed(2)}`,
      `afade=t=out:st=${st.toFixed(2)}:d=${fade.toFixed(2)}`,
    ],
  };
}

/**
 * Creative + framing extras after scale/polish.
 * Order: stabilize → aspect → style → speed(vf) → fade
 */
function creativeVideoFilters(opts, targetH, durationSec, flags = {}) {
  const parts = [];
  parts.push(...stabilizeFilters(opts));
  const aspect = aspectFilters(opts, targetH);
  // If aspect does scale+crop, skip redundant setsar later
  parts.push(...aspect);
  parts.push(...styleFilters(opts, flags));
  const spd = playbackSpeedFilters(opts);
  parts.push(...spd.vf);
  const fade = fadeEdgeFilters(opts, durationSec);
  parts.push(...fade.vf);
  return {
    vf: parts.filter(Boolean),
    afExtra: [...spd.af, ...fade.af].filter(Boolean),
    usedAspect: aspect.length > 0,
    styleParts: styleFilters(opts, flags),
  };
}

function needsCreativeVideoFx(opts) {
  if (!opts) return false;
  if (opts.videoStyle && opts.videoStyle !== "off") return true;
  if (opts.videoAspect && opts.videoAspect !== "original") return true;
  if (opts.stabilize && opts.stabilize !== "off") return true;
  if (opts.playbackSpeed && Math.abs(Number(opts.playbackSpeed) - 1) >= 0.02)
    return true;
  if (opts.fadeEdges) return true;
  if (opts.maxDurationSec && Number(opts.maxDurationSec) > 0) return true;
  return false;
}

function generateNarratorWav(
  script,
  voice,
  outWav,
  rate = 1,
  targetLang = "pl",
  onSegment = null,
  videoDur = 0,
  timedSegments = null,
  extraOpts = null
) {
  const { generateNarratorAudio, clampSpeechRate } = require("./lang-utils");
  const voiceKey = String(voice || "female").trim() || "female";
  const gender =
    voiceKey.toLowerCase() === "adam" || voiceKey.toLowerCase() === "male"
      ? "male"
      : voiceKey.toLowerCase() === "female" || voiceKey.toLowerCase() === "paulina"
        ? "female"
        : voiceKey; // pass through named / Edge ShortName
  try {
    const extra = extraOpts && typeof extraOpts === "object" ? extraOpts : {};
    // rate: speech multiplier 0.5–2.0 (one decimal) when pre-resolved
    const speechRate =
      rate != null && Number(rate) >= 0.5 && Number(rate) <= 2.0
        ? clampSpeechRate(rate)
        : extra.speechRate != null
          ? clampSpeechRate(extra.speechRate)
          : null;
    const res = generateNarratorAudio(script, targetLang || "pl", outWav, {
      gender,
      voice: voiceKey,
      rate,
      speechRate,
      textSpeedMode: extra.textSpeedMode || "manual",
      textSpeed: extra.textSpeed != null ? extra.textSpeed : rate,
      onSegment,
      videoDur,
      timedSegments,
    });
    return res;
  } catch (e) {
    throw new Error(
      "TTS nie zadziałało (" +
        (targetLang || "pl") +
        "): " +
        (e.message || String(e)).slice(0, 220) +
        " · pip install edge-tts"
    );
  }
}

function defaultNarratorScript(opts) {
  if (opts.narratorScript && opts.narratorScript.trim()) {
    return opts.narratorScript.trim();
  }
  const title = (opts.title || "").trim();
  const desc = (opts.description || "").trim();
  const parts = [];
  if (title) parts.push(title + ".");
  if (desc) parts.push(desc);
  if (!parts.length) {
    parts.push(
      "Oglądasz krótki filmik. Spójrz uważnie — zaraz zobaczysz, o co chodzi."
    );
  }
  return parts.join(" ");
}

/**
 * Clean human title from upload filename, e.g.
 * new_002_r48_Eksplodujaca-pulapka....mp4 → Eksplodująca pułapka...
 */
function titleFromFilename(name) {
  if (!name) return "";
  let s = String(name);
  s = s.replace(/\.[^.]+$/i, ""); // extension
  // strip upload timestamps / hash prefixes FIRST (e.g. 1785096814824_…)
  s = s.replace(/^\d{10,}_/, "");
  s = s.replace(/^[a-f0-9]{8,}_/i, "");
  // strip common catalog prefixes: HUMOR_63919_, new_002_r48_, 012_r102_
  s = s.replace(
    /^(HUMOR|NEWS|SPORT|AMAZING|ANIMALS|ACCIDENTS|WORK|POLITICS|PATHOLOGY|MOTORIZATION|CURIOSITIES)_\d+_/i,
    ""
  );
  s = s.replace(/^new_\d+_r\d+_/i, "");
  s = s.replace(/^\d+_r\d+_/i, "");
  // leftover "038 r32 " style after underscore→space
  s = s.replace(/^\d+\s*r\d+\s+/i, "");
  s = s.replace(/[_-]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // drop pure garbage
  if (s.length < 4) return "";
  if (/^(test|xxx|gfd|gfre|ggg|vf|cas|asd|qwe|tmp)$/i.test(s)) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isJunkText(t) {
  const s = String(t || "").trim();
  if (!s) return true;
  if (s.length < 4) return true;
  if (/^(test|xxx|gfd|gfre|ggg|vf|cas|asd|qwe|tmp|aaa|bbb|ccc|ddd|fff|abc|xyz)$/i.test(s))
    return true;
  // mostly non-letters
  const letters = (s.match(/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF]/g) || []).length;
  if (letters < 3) return true;
  return false;
}

async function resolveNarratorScript(opts, onUpdate) {
  const {
    prepareNarratorScript,
    getLanguageModel,
    extractSpeechFromVideo,
    extractSpeechFromVideoSegmented,
  } = require("./lang-utils");
  const mode = opts.narratorMode === "describe" ? "describe" : "translate";
  // default source auto when we take text from filename (often PL)
  let sourceLang = opts.sourceLang || "auto";
  const targetLang = opts.targetLang || "pl";
  const tgt = getLanguageModel(targetLang);
  const durationSec = Number(opts.durationSec) || 0;

  let title = (opts.title || "").trim();
  let narratorScript = (opts.narratorScript || "").trim();
  let description = (opts.description || "").trim();
  const fromFile = titleFromFilename(opts.originalName || opts.filename || "");
  const userGaveScript =
    !isJunkText(narratorScript) && narratorScript.trim().length >= 40;

  // User often types junk (gfd/xxx) — use filename as real source text
  if (isJunkText(title) && fromFile) {
    onUpdate?.({ log: `Tytuł z nazwy pliku: ${fromFile}` });
    title = fromFile;
  }
  if (isJunkText(narratorScript) && fromFile) {
    onUpdate?.({
      log: `Podgląd z nazwy pliku (póki nie ma STT): ${fromFile}`,
    });
    narratorScript = fromFile;
    if (sourceLang === "en" && /[ąćęłńóśźż]/i.test(fromFile)) {
      sourceLang = "pl";
    } else if (sourceLang === "en" && !/\b(the|and|you|this)\b/i.test(fromFile)) {
      sourceLang = "auto";
    }
  }

  onUpdate?.({
    log:
      mode === "describe"
        ? `Tryb: opis sytuacji (pełny lektor) → ${tgt.label}`
        : `Tryb: dokładne tłumaczenie → najpierw wyodrębnij tekst z wideo → ${tgt.label}`,
  });

  // --- Transcription: captions (timed) OR STT speech (default, as before) ---
  // User-pasted long script skips both; captions mode uses video subs → timed transcript.
  const videoPath = opts.inputPath || opts.videoPath || null;
  let sttMeta = null;
  let fromTranscript = false;
  const useTimedForm = opts.timedTranscript !== false;
  // User extracted/pasted timed lines + option ON → use that transcript for lektor TTS
  if (useTimedForm && narratorScript) {
    const userTimed = parseTimedTranscriptText(narratorScript);
    if (userTimed.length >= 1) {
      const plain = userTimed
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      sttMeta = {
        text: plain,
        engine: "user-timed-transcript",
        langCode: sourceLang !== "auto" ? sourceLang : null,
        chunks: userTimed.length,
        error: null,
        partial: userTimed.map((s) => s.text),
        segments: userTimed,
        timelineSegments: userTimed,
        audioDuration:
          durationSec ||
          (userTimed.length ? userTimed[userTimed.length - 1].end : 0),
        coverageStart: userTimed[0].start,
        coverageEnd: userTimed[userTimed.length - 1].end,
        attempted: userTimed.length,
        failed: 0,
        musicLikely: false,
        fromUserTimed: true,
      };
      narratorScript = plain;
      title = "";
      description = "";
      fromTranscript = true;
      onUpdate?.({
        progress: 18,
        stage: "Transkrypcja z pola (z czasem)",
        livePhase: "source",
        liveOriginal: formatTimedTranscript(userTimed).slice(0, 1200),
        liveScript: `… ${userTimed.length} okien z pola skryptu → lektor na osi czasu …`,
        log:
          "LEKTOR: używam zaznaczonej transkrypcji z czasem (" +
          userTimed.length +
          " okien, " +
          plain.length +
          " znaków) — bez ponownego STT.",
      });
    }
  } else if (!useTimedForm && narratorScript) {
    // Option fully off: plain paragraph only (strip [time] if user left them)
    const stripped = stripTimedTranscriptMarkers(narratorScript);
    if (stripped && stripped !== narratorScript.replace(/\s+/g, " ").trim()) {
      narratorScript = stripped;
      onUpdate?.({
        log: "Transkrypcja z czasem wyłączona — lektor dostaje ciągły tekst (bez znaczników [czas]).",
      });
    }
  }

  const transcriptSource = String(opts.transcriptSource || "stt").toLowerCase();
  const captionSegs = Array.isArray(opts.captionSegments)
    ? opts.captionSegments.filter(
        (s) => s && String(s.text || "").trim().length > 0
      )
    : [];
  const useCaptions =
    (transcriptSource === "captions" || opts.fromYoutubeCaptions) &&
    (captionSegs.length > 0 ||
      (userGaveScript && opts.fromYoutubeCaptions));

  // Also accept backup captions from agent (STT mode, fetched for fallback)
  if (
    !captionSegs.length &&
    Array.isArray(opts.captionSegmentsBackup)
  ) {
    for (const s of opts.captionSegmentsBackup) {
      if (s && String(s.text || "").trim()) captionSegs.push(s);
    }
  }

  // Captions → timed transcription (skip speech STT when primary captions mode)
  // Do not override user-pasted/extracted timed transcript used for lektor
  if (
    useCaptions &&
    captionSegs.length > 0 &&
    transcriptSource === "captions" &&
    !(sttMeta && sttMeta.fromUserTimed)
  ) {
    const segs = captionSegs.map((s, i) => ({
      start: Math.max(0, Number(s.start) || 0),
      end: Math.max(
        Number(s.start) || 0,
        Number(s.end) || Number(s.start) + 2
      ),
      text: String(s.text || "").trim(),
      silent: !String(s.text || "").trim(),
      sttIndex: s.sttIndex != null ? s.sttIndex : i,
    }));
    const fullText =
      (narratorScript && narratorScript.length >= 20
        ? narratorScript
        : segs.map((s) => s.text).join(" ")
      )
        .replace(/\s+/g, " ")
        .trim();
    sttMeta = {
      text: fullText,
      engine: "video-captions",
      langCode: sourceLang !== "auto" ? sourceLang : null,
      chunks: segs.length,
      error: null,
      partial: segs.map((s) => s.text),
      segments: segs,
      timelineSegments: segs,
      audioDuration: durationSec || (segs.length ? segs[segs.length - 1].end : 0),
      coverageStart: segs[0]?.start ?? 0,
      coverageEnd: segs[segs.length - 1]?.end ?? 0,
      attempted: segs.length,
      failed: 0,
      musicLikely: false,
      fromCaptions: true,
    };
    narratorScript = fullText;
    title = "";
    description = "";
    fromTranscript = true;
    // Live: show timed lines so UI has "transkrypcja w czasie"
    const liveLines = segs
      .slice(0, 12)
      .map(
        (s) =>
          `[${Number(s.start).toFixed(1)}–${Number(s.end).toFixed(1)}s] ${s.text}`
      )
      .join("\n");
    onUpdate?.({
      progress: 22,
      stage: "Transkrypcja z napisów",
      livePhase: "source",
      liveOriginal: liveLines || fullText.slice(0, 800),
      liveScript: `… napisy → ${segs.length} segmentów z czasem → tłumaczę …`,
      log: `TRANSKRYPCJA Z NAPISÓW FILMU: ${segs.length} cue · ${fullText.length} znaków · ${Number(segs[0]?.start || 0).toFixed(1)}s→${Number(segs[segs.length - 1]?.end || 0).toFixed(1)}s`,
    });
  }

  // STT path (default) — skip when user already gave timed/plain script or captions
  const needStt =
    !fromTranscript &&
    !userGaveScript &&
    !(sttMeta && sttMeta.fromUserTimed) &&
    !!videoPath &&
    !useCaptions;

  if (needStt) {
    onUpdate?.({
      progress: 10,
      stage:
        mode === "translate"
          ? "Wyodrębnianie tekstu z wideo"
          : "Wyodrębnianie treści do opisu",
      livePhase: "extracting",
      liveOriginal: "… słucham ścieżki audio / transkrypcja …",
      liveScript:
        mode === "translate"
          ? "… najpierw TRANSKRYPCJA (segmenty), potem tłumaczenie …"
          : "… najpierw TRANSKRYPCJA (segmenty), potem pełny opis …",
      log: "STT: oryginalny dźwięk z wideo, segmenty co ~6s…",
    });
    const workDir = opts.workDir
      ? path.join(opts.workDir, "stt")
      : path.join(WORK_DIR, "stt_" + Date.now());
    // Full video length (was capped at 200s → only a piece of dialogue)
    const maxSeconds = Math.round(
      durationSec > 0 ? Math.min(durationSec + 2, 1200) : 600
    );
    // Progress band for STT: 10% → 42% (then NMT/TTS continues)
    const sttProg0 = 10;
    const sttProg1 = 42;
    sttMeta = extractSpeechFromVideoSegmented(videoPath, {
      sourceLang,
      maxSeconds,
      workDir,
      segmentSec: 6,
      onSegment: (info) => {
        const t = Math.max(0, Math.min(1, (info.index + (info.phase === "done" ? 1 : 0.35)) / info.total));
        const progress = Math.round(sttProg0 + t * (sttProg1 - sttProg0));
        const range = `${info.startSec.toFixed(0)}–${(info.startSec + info.lenSec).toFixed(0)}s`;
        if (info.phase === "start") {
          onUpdate?.({
            progress,
            livePhase: "extracting",
            stage: "Wyodrębnianie tekstu z wideo",
            liveOriginal: `… STT segment ${info.index + 1}/${info.total} (${range}) …`,
            liveScript:
              mode === "translate"
                ? `… transkrypcja ${info.index + 1}/${info.total} …`
                : `… treść ${info.index + 1}/${info.total} …`,
            log: `STT segment ${info.index + 1}/${info.total}: ${range}`,
          });
        } else {
          const preview = (info.textSoFar || "").slice(0, 160);
          onUpdate?.({
            progress,
            livePhase: "extracting",
            stage: "Wyodrębnianie tekstu z wideo",
            liveOriginal:
              preview ||
              `… segment ${info.index + 1}/${info.total} ${info.ok ? "OK" : "pusto"} …`,
            liveScript: `… STT ${info.index + 1}/${info.total} gotowy (${info.pct}%) …`,
            log: `STT segment ${info.index + 1}/${info.total} ${
              info.ok ? "OK" : "pusto"
            } · ${(info.segText || "").slice(0, 80)}${
              (info.segText || "").length > 80 ? "…" : ""
            }`,
          });
        }
      },
    });
    // If forced language failed completely, retry auto multi-lang detect
    if (
      (!sttMeta.text || sttMeta.text.trim().length < 4) &&
      sourceLang &&
      sourceLang !== "auto" &&
      sourceLang !== "unknown"
    ) {
      onUpdate?.({
        log: `STT (${sourceLang}) puste — ponawiam z auto-wykrywaniem (segmenty)…`,
      });
      sttMeta = extractSpeechFromVideoSegmented(videoPath, {
        sourceLang: "auto",
        maxSeconds,
        workDir: workDir + "_auto",
        segmentSec: 6,
        onSegment: (info) => {
          const t = Math.max(
            0,
            Math.min(1, (info.index + (info.phase === "done" ? 1 : 0.35)) / info.total)
          );
          onUpdate?.({
            progress: Math.round(sttProg0 + t * (sttProg1 - sttProg0)),
            livePhase: "extracting",
            stage: "Wyodrębnianie tekstu z wideo",
            liveOriginal: `… auto STT ${info.index + 1}/${info.total} …`,
            log: `STT auto segment ${info.index + 1}/${info.total}`,
          });
        },
      });
    }
    if (sttMeta.text && sttMeta.text.trim().length >= 4) {
      // USE ONLY transcription as source for translation — never filename/title
      narratorScript = sttMeta.text.trim();
      title = ""; // prevent prepareNarratorScript from mixing title
      description = "";
      fromTranscript = true;
      // Prefer STT-detected locale (multi-lang). Map close codes for NMT.
      let sttCode = sttMeta.langCode || null;
      if (!sttCode && sttMeta.engine && /:([a-z]{2,3})/i.test(sttMeta.engine)) {
        const m = sttMeta.engine.match(/:([a-z]{2,3})/i);
        sttCode = m ? m[1].toLowerCase() : null;
      }
      if (sttCode === "zh" || sttCode === "cmn") sttCode = "zh";
      if (sttCode === "uk") sttCode = "ru"; // NMT: Ukrainian → treat as Russian family
      if (sttCode === "pt") sttCode = "pt";
      if (sttCode && getLanguageModel(sttCode).code === sttCode) {
        sourceLang = sttCode;
      } else if (sttCode) {
        // unknown code still better as auto than wrong PL
        sourceLang = "auto";
      }
      const cov0 =
        sttMeta.coverageStart != null
          ? Number(sttMeta.coverageStart).toFixed(1)
          : "?";
      const cov1 =
        sttMeta.coverageEnd != null
          ? Number(sttMeta.coverageEnd).toFixed(1)
          : "?";
      const aud =
        sttMeta.audioDuration != null
          ? Number(sttMeta.audioDuration).toFixed(1)
          : String(durationSec || "?");
      // Prefer timed transcription in live panel (with STT clocks), not one blob
      const timedSrc =
        formatTimedTranscript(
          Array.isArray(sttMeta.timelineSegments) && sttMeta.timelineSegments.length
            ? sttMeta.timelineSegments
            : sttMeta.segments
        ) || narratorScript;
      onUpdate?.({
        progress: 18,
        stage: "Transkrypcja gotowa",
        livePhase: "source",
        liveOriginal: timedSrc,
        liveScript: `… pełna transkrypcja z czasem (${sourceLang}, ${narratorScript.length} znaków) → tłumaczę …`,
        log: `TRANSKRYPCJA FULL z czasem (${sttMeta.engine || "stt"}, ${sourceLang}): ${
          sttMeta.chunks || 0
        } okien / fail ${sttMeta.failed || 0} · audio ${cov0}s→${cov1}s / ${aud}s · ${
          narratorScript.length
        } znaków: ${narratorScript.slice(0, 120)}${
          narratorScript.length > 120 ? "…" : ""
        }${
          Number(cov1) + 3 < Number(aud)
            ? " ⚠ nie do końca pliku — gap-fill mógł nie złapać ciszy/muzyki"
            : ""
        }`,
      });
    } else {
      const musicHint =
        sttMeta.musicLikely ||
        /muzyk|music|brak mowy/i.test(String(sttMeta.error || ""));
      onUpdate?.({
        log:
          "STT FAIL: " +
          (sttMeta.error || "brak mowy") +
          (musicHint
            ? " — mało mowy w audio. Dla piosenek: wybierz «Weź napisy z filmu». " +
              "Tryb «Opis sytuacji» i tak ułoży własny tekst lektora."
            : " — brak STT; używam tytułu/nazwy pliku + tryb lektora."),
        livePhase: "source",
        liveOriginal: fromFile || title || "",
        liveScript:
          mode === "describe"
            ? "… buduję własny opis sytuacji (bez STT) …"
            : musicHint
              ? "… brak mowy — spróbuj napisów z filmu …"
              : "… brak transkrypcji — fallback …",
      });
      // Prefer YouTube captions backup (agent) over empty STT
      const backupSegs = Array.isArray(opts.captionSegmentsBackup)
        ? opts.captionSegmentsBackup.filter(
            (s) => s && String(s.text || "").trim()
          )
        : [];
      if (backupSegs.length) {
        const full = (
          opts.narratorScriptBackup ||
          backupSegs.map((s) => s.text).join(" ")
        )
          .replace(/\s+/g, " ")
          .trim();
        if (full.length >= 12) {
          sttMeta = {
            text: full,
            engine: "video-captions-backup",
            langCode: null,
            chunks: backupSegs.length,
            error: null,
            partial: backupSegs.map((s) => s.text),
            segments: backupSegs,
            timelineSegments: backupSegs.map((s, i) => ({
              start: Number(s.start) || 0,
              end: Number(s.end) || Number(s.start) + 2,
              text: String(s.text || "").trim(),
              silent: false,
              sttIndex: i,
            })),
            audioDuration: durationSec || 0,
            coverageStart: Number(backupSegs[0].start) || 0,
            coverageEnd:
              Number(backupSegs[backupSegs.length - 1].end) || durationSec || 0,
            attempted: backupSegs.length,
            failed: 0,
            musicLikely: false,
            fromCaptions: true,
          };
          narratorScript = full;
          title = "";
          description = "";
          fromTranscript = true;
          onUpdate?.({
            progress: 22,
            stage: "Transkrypcja z napisów (backup)",
            livePhase: "source",
            liveOriginal: full.slice(0, 800),
            liveScript: `… STT puste → napisy YT (${backupSegs.length} cue) → tłumaczę …`,
            log:
              "STT puste — używam napisów YouTube jako transkrypcji (" +
              backupSegs.length +
              " segmentów, " +
              full.length +
              " znaków).",
          });
        }
      }
      if (!fromTranscript) {
        // Always keep a seed for describe/translate — never leave empty if we have a title
        const seed = [title, fromFile, description]
          .filter(Boolean)
          .join(". ")
          .trim();
        if (seed) {
          narratorScript = seed;
          if (!title) title = fromFile || seed;
        } else if (musicHint) {
          narratorScript = "";
        }
        fromTranscript = false;
      }
    }
  } else if (userGaveScript) {
    fromTranscript = true; // treat pasted text as the transcript source
    onUpdate?.({
      log: "Tekst źródłowy z pola lektora (pomijam STT — wklejona transkrypcja).",
      livePhase: "source",
      liveOriginal: narratorScript,
    });
  }

  // Describe mode: never depend only on STT — always produce a full monologue
  if (mode === "describe" && (!narratorScript || isJunkText(narratorScript))) {
    narratorScript = [title, fromFile, description].filter(Boolean).join(". ").trim();
    fromTranscript = false;
    onUpdate?.({
      log: "Opis sytuacji: brak STT — układam własny tekst lektora z tytułu/kontekstu wideo.",
      livePhase: "source",
      liveOriginal: narratorScript || "(szablon opisu)",
      liveScript: "… buduję pełny opis sytuacji …",
    });
  }

  onUpdate?.({
    log: `Źródło do NMT (${fromTranscript ? "TRANSKRYPCJA" : mode === "describe" ? "OPIS" : "fallback"}): ${(
      narratorScript ||
      title ||
      "(brak — szablon)"
    ).slice(0, 160)}`,
  });

  const prep = await prepareNarratorScript({
    title: fromTranscript ? "" : title,
    description: fromTranscript ? "" : description,
    narratorScript,
    forceTranslate: opts.autoTranslate !== false,
    narratorMode: mode,
    sourceLang,
    targetLang,
    durationSec: durationSec || Number(opts.durationSec) || 0,
    describeStyle: opts.describeStyle || "neutral",
    fromTranscript: !!fromTranscript,
    onLive: (live) => {
      // Stream translation / describe to UI in real time
      const patch = {
        liveOriginal: live.liveOriginal || "",
        liveScript: live.liveScript || "",
        livePhase: live.phase || "translating",
        stage:
          live.phase === "done"
            ? mode === "describe"
              ? "Opis gotowy"
              : "Tłumaczenie gotowe"
            : live.phase === "extracting"
              ? "Wyodrębnianie tekstu z wideo"
              : live.chunks
                ? `Tłumaczenie na żywo ${live.chunk || 0}/${live.chunks}`
                : mode === "describe"
                  ? "Budowa opisu sytuacji…"
                  : "Tłumaczenie na żywo…",
        log:
          live.phase === "translating" && live.chunks
            ? `Tłumaczę na żywo ${live.chunk}/${live.chunks}…`
            : live.phase === "done"
              ? mode === "describe"
                ? "Opis sytuacji: gotowy"
                : "Tłumaczenie na żywo: gotowe"
              : live.phase === "source"
                ? "Tekst źródłowy gotowy"
                : live.phase === "extracting"
                  ? "Wyodrębniam mowę z wideo…"
                  : null,
      };
      if (
        live.phase === "translating" ||
        live.phase === "done" ||
        live.phase === "extracting" ||
        live.phase === "source"
      ) {
        patch.progress =
          live.phase === "done"
            ? 87
            : live.phase === "extracting"
              ? 12
              : live.phase === "source"
                ? 20
                : 84;
      }
      onUpdate?.(patch);
    },
  });
  if (sttMeta) {
    prep.stt = {
      engine: sttMeta.engine,
      chunks: sttMeta.chunks,
      error: sttMeta.error,
      used: !!(sttMeta.text && sttMeta.text.length >= 8),
      musicLikely: !!sttMeta.musicLikely,
      fromCaptions: !!sttMeta.fromCaptions,
      // Fine speech windows (optional)
      segments: Array.isArray(sttMeta.segments) ? sttMeta.segments : [],
      // Outer STT slices / caption cues 1:1 — preferred for TTS
      timelineSegments: Array.isArray(sttMeta.timelineSegments)
        ? sttMeta.timelineSegments
        : Array.isArray(sttMeta.segments)
          ? sttMeta.segments
          : [],
      partial: Array.isArray(sttMeta.partial) ? sttMeta.partial : [],
    };
  }

  // Captions mode: keep original cue timing on translated script when possible
  if (sttMeta && sttMeta.fromCaptions && Array.isArray(sttMeta.timelineSegments)) {
    prep.fromCaptions = true;
  }
  if (prep.sourceLang) {
    onUpdate?.({
      log: `Źródło: ${prep.sourceLang.label} (${prep.sourceLang.code})${
        prep.sourceLang.forced ? " · ręcznie" : " · auto"
      }`,
    });
  }
  if (prep.targetLang) {
    onUpdate?.({
      log: `Docelowy: ${prep.targetLang.label} (${prep.targetLang.code})`,
    });
  }
  if (prep.detected && !prep.sourceLang?.forced) {
    onUpdate?.({
      log: `Wykryto: ${prep.detected.label} (${prep.detected.code}, conf ${(prep.detected.confidence || 0).toFixed(2)})`,
    });
  }
  if (prep.modeLabel) {
    onUpdate?.({ log: `Lektor: ${prep.modeLabel}` });
  }
  if (prep.model) {
    onUpdate?.({
      log: `Model: ${prep.model.modelName || prep.model.modelId} (${prep.model.modelId || "—"})`,
    });
  }
  // Build timed views for UI (source + target) whenever STT/caption windows exist
  // useTimedForm already set from opts.timedTranscript at start of resolveNarratorScript
  const timelineForLive =
    (prep.stt &&
      Array.isArray(prep.stt.timelineSegments) &&
      prep.stt.timelineSegments.length &&
      prep.stt.timelineSegments) ||
    (prep.stt && Array.isArray(prep.stt.segments) && prep.stt.segments) ||
    [];
  const timedOriginalText = useTimedForm
    ? formatTimedTranscript(timelineForLive) ||
      prep.original ||
      narratorScript ||
      title ||
      ""
    : prep.original || narratorScript || title || "";
  let timedScriptText = prep.script || "";
  if (useTimedForm && timelineForLive.length && prep.script) {
    const mapped = buildTimedScriptSegments(
      prep.script,
      Number(durationSec) ||
        Number(sttMeta && sttMeta.audioDuration) ||
        30,
      timelineForLive,
      prep.original || narratorScript || "",
      !!prep.translated
    );
    timedScriptText = formatTimedTranscript(mapped) || prep.script;
  } else if (!useTimedForm) {
    timedScriptText = prep.script || "";
  }
  prep.timedOriginal = useTimedForm ? timedOriginalText : "";
  prep.timedScript = useTimedForm ? timedScriptText : "";
  // Primary script for lektor / edits: transcription form when enabled
  if (useTimedForm && timedScriptText && String(timedScriptText).includes("[")) {
    prep.script = timedScriptText;
  }

  if (prep.translated) {
    onUpdate?.({
      log: `Przetłumaczono → ${tgt.label}${prep.engine ? " · " + prep.engine : ""}${
        prep.model?.modelId ? " · " + prep.model.modelId : ""
      }${useTimedForm ? " · transkrypcja z czasem" : " · tekst ciągły"}`,
      liveScript: (useTimedForm ? timedScriptText : null) || prep.script,
      liveOriginal: (useTimedForm ? timedOriginalText : null) || prep.original || narratorScript,
      livePhase: "done",
    });
  } else if (prep.translateError) {
    onUpdate?.({ log: "Tłumaczenie: " + prep.translateError });
  } else {
    onUpdate?.({
      liveScript: (useTimedForm ? timedScriptText : null) || prep.script,
      liveOriginal:
        (useTimedForm ? timedOriginalText : null) ||
        narratorScript ||
        title,
      livePhase: "done",
    });
  }
  return prep;
}

function srtEscape(t) {
  return String(t).replace(/\r?\n/g, " ").trim();
}

/**
 * Split monologue into short subtitle lines (not one giant sentence).
 * Target ~1.5–3.5s per cue, max ~42 chars / ~7 words per line.
 * @returns {string[]}
 */
function splitScriptIntoPhrases(script) {
  let text = String(script || "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];

  // 1) sentences
  let parts = text
    .split(/(?<=[.!?…。؟|])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 2) if still one blob — split on commas / dashes / conjunctions
  if (parts.length <= 1) {
    parts = text
      .split(/(?<=[,;:—–])\s+|(?=\b(?:i|a|ale|oraz|and|but|or|y|и|و)\b\s+)/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (!parts.length) parts = [text];

  // 3) hard-wrap long pieces by words (readable subtitle length)
  const phrases = [];
  const maxWords = 7;
  const maxChars = 42;
  for (const p of parts) {
    const words = p.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords && p.length <= maxChars) {
      phrases.push(p);
      continue;
    }
    let buf = [];
    for (const w of words) {
      const next = buf.concat(w).join(" ");
      if (
        buf.length > 0 &&
        (buf.length >= maxWords || next.length > maxChars)
      ) {
        phrases.push(buf.join(" "));
        buf = [w];
      } else {
        buf.push(w);
      }
    }
    if (buf.length) phrases.push(buf.join(" "));
  }
  return phrases.filter(Boolean);
}

/**
 * Build timed cues covering the FULL video (0 → duration).
 * STT windows keep speech alignment; leftover gaps get filled so text
 * runs from beginning to end instead of only a middle slice.
 * @param {string} script
 * @param {number} duration
 * @param {{start:number,end:number,text:string}[]} [timedSegments] optional STT windows
 * @returns {{start:number,end:number,text:string}[]}
 */
function buildTimedCues(script, duration, timedSegments) {
  const total = Math.max(Number(duration) || 30, 3);

  // Prefer STT windows: split each window's text into short phrases inside that window
  if (Array.isArray(timedSegments) && timedSegments.length > 0) {
    const cues = [];
    for (const seg of timedSegments) {
      const t0 = Math.max(0, Number(seg.start) || 0);
      const t1 = Math.min(total, Math.max(t0 + 0.4, Number(seg.end) || t0 + 2));
      const phrases = splitScriptIntoPhrases(seg.text || "");
      if (!phrases.length) continue;
      const span = Math.max(0.5, t1 - t0);
      const weights = phrases.map((p) => Math.max(1, p.split(/\s+/).length));
      const wsum = weights.reduce((a, b) => a + b, 0) || phrases.length;
      let cursor = t0;
      phrases.forEach((p, i) => {
        const share = span * (weights[i] / wsum);
        let dur = Math.max(0.7, Math.min(3.5, share));
        if (i === phrases.length - 1) {
          const end = t1;
          const start = Math.min(cursor, Math.max(t0, end - 0.5));
          cues.push({ start, end, text: p });
        } else {
          const end = Math.min(t1, cursor + dur);
          cues.push({ start: cursor, end, text: p });
          cursor = end;
        }
      });
    }
    if (cues.length) {
      // Stretch first cue back to 0 and last cue to total so subtitles
      // run start→end of the whole video (not a mid-clip island).
      cues[0].start = 0;
      cues[cues.length - 1].end = total;
      // Remove tiny overlaps / fix order
      for (let i = 1; i < cues.length; i++) {
        if (cues[i].start < cues[i - 1].end) {
          cues[i].start = cues[i - 1].end;
        }
        if (cues[i].end <= cues[i].start) {
          cues[i].end = Math.min(total, cues[i].start + 0.8);
        }
      }
      cues[cues.length - 1].end = total;
      return cues;
    }
  }

  const phrases = splitScriptIntoPhrases(script);
  if (!phrases.length) return [];

  // ALWAYS distribute across full 0→total (beginning to end)
  const weights = phrases.map((p) => Math.max(1, p.split(/\s+/).length));
  const wsum = weights.reduce((a, b) => a + b, 0) || phrases.length;
  const cues = [];
  let t = 0;
  phrases.forEach((p, i) => {
    const remaining = phrases.length - i;
    const left = total - t;
    let dur = left / remaining;
    // keep readable cue lengths when possible
    if (remaining > 1) {
      dur = Math.max(0.9, Math.min(4.2, dur));
    }
    let end = i === phrases.length - 1 ? total : Math.min(total, t + dur);
    if (end <= t) end = Math.min(total, t + 0.9);
    cues.push({ start: t, end, text: p });
    t = end;
  });
  if (cues.length) {
    cues[0].start = 0;
    cues[cues.length - 1].end = total;
  }
  return cues;
}

/**
 * After full-text NMT, redistribute translated words onto original STT time windows
 * so subtitles/TTS stay aligned. ALWAYS same count as STT segments — never drop words.
 */
function mapTranslatedOntoSegments(originalText, translatedText, segments) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const trWords = String(translatedText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!trWords.length) return null;

  const n = segments.length;
  // Weight by original STT word count (empty STT window still gets weight 1 so slot exists)
  const weights = segments.map((s) => {
    const nW = String(s.text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, nW);
  });
  const wsum = weights.reduce((a, b) => a + b, 0) || n;

  // Fair integer allocation of ALL words (no loss, same N buckets as STT)
  const raw = weights.map((w) => (trWords.length * w) / wsum);
  const take = raw.map((x) => Math.floor(x));
  let assigned = take.reduce((a, b) => a + b, 0);
  let rem = trWords.length - assigned;
  // distribute remainder to highest fractional parts
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) {
    take[order[k % n].i] += 1;
  }
  // guarantee: if STT window had speech, give at least 1 word when available
  for (let i = 0; i < n; i++) {
    const had = String(segments[i].text || "").trim().length > 0;
    if (had && take[i] === 0) {
      // steal 1 from largest bucket
      let maxI = 0;
      for (let j = 0; j < n; j++) if (take[j] > take[maxI]) maxI = j;
      if (take[maxI] > 1) {
        take[maxI] -= 1;
        take[i] = 1;
      }
    }
  }

  const out = [];
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const seg = segments[i];
    const start = Number(seg.start) || 0;
    const end = Math.max(start + 0.5, Number(seg.end) || start + 2);
    const t = i === n - 1 ? trWords.length - idx : take[i];
    const slice = trWords.slice(idx, idx + Math.max(0, t));
    idx += slice.length;
    out.push({
      start,
      end,
      text: slice.join(" "), // may be "" for pure silence windows
      sttIndex: i,
      silent: slice.length === 0,
    });
  }
  // any leftover (shouldn't happen) → last segment with text
  if (idx < trWords.length) {
    const rest = trWords.slice(idx).join(" ");
    for (let j = out.length - 1; j >= 0; j--) {
      if (!out[j].silent) {
        out[j].text = (out[j].text + " " + rest).trim();
        out[j].silent = false;
        break;
      }
      if (j === 0) {
        out[j].text = rest;
        out[j].silent = false;
      }
    }
  }
  return out; // always length === segments.length
}

/**
 * Write SRT with short cues timed across the video (not one block sentence).
 * @param {string} script
 * @param {number} duration
 * @param {string} outPath
 * @param {{start:number,end:number,text:string}[]} [timedSegments]
 */
function writeSrtFromScript(script, duration, outPath, timedSegments) {
  const cues = buildTimedCues(script, duration, timedSegments);
  if (!cues.length) return null;
  const lines = [];
  cues.forEach((c, i) => {
    lines.push(String(i + 1));
    lines.push(`${toSrtTime(c.start)} --> ${toSrtTime(c.end)}`);
    // soft line break mid-cue if still long
    const txt = srtEscape(c.text);
    if (txt.length > 38) {
      const words = txt.split(/\s+/);
      const mid = Math.ceil(words.length / 2);
      lines.push(words.slice(0, mid).join(" "));
      lines.push(words.slice(mid).join(" "));
    } else {
      lines.push(txt);
    }
    lines.push("");
  });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  return { path: outPath, cues };
}

function toSrtTime(sec) {
  const x = Math.max(0, Number(sec) || 0);
  const h = Math.floor(x / 3600);
  const m = Math.floor((x % 3600) / 60);
  const s = Math.floor(x % 60);
  const ms = Math.floor((x % 1) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}

/** mm:ss.xx for live panel / plain timed transcript (readable). */
function toClockTime(sec) {
  const x = Math.max(0, Number(sec) || 0);
  const m = Math.floor(x / 60);
  const s = x - m * 60;
  const whole = Math.floor(s);
  const frac = Math.min(99, Math.round((s - whole) * 100));
  return (
    String(m).padStart(2, "0") +
    ":" +
    String(whole).padStart(2, "0") +
    "." +
    String(frac).padStart(2, "0")
  );
}

/**
 * Format segments as timed transcription text (not one continuous blob).
 * Example: [00:00.00 → 00:01.40] wiesz, mieszkam…
 */
function formatTimedTranscript(segments) {
  if (!Array.isArray(segments) || !segments.length) return "";
  const lines = [];
  for (const seg of segments) {
    const text = String(seg && seg.text != null ? seg.text : "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = Number(seg.start) || 0;
    const end = Math.max(start + 0.3, Number(seg.end) || start + 1);
    lines.push(`[${toClockTime(start)} → ${toClockTime(end)}] ${text}`);
  }
  return lines.join("\n");
}

/**
 * Parse user/extracted timed transcription back into segments for lektor TTS.
 * Accepts: [00:00.0 → 00:06.0], [00:00–00:06], [0:00-0:06s], etc.
 * @returns {{start:number,end:number,text:string,silent:boolean,sttIndex:number}[]}
 */
function parseTimedTranscriptText(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const segs = [];
  // Clock: m:ss or mm:ss with optional .frac
  const clock = "(\\d{1,2}):(\\d{2})(?:[.,](\\d{1,3}))?";
  const re = new RegExp(
    "^\\s*\\[\\s*" +
      clock +
      "\\s*[–—→\\-]+\\s*" +
      clock +
      "\\s*s?\\s*\\]\\s*(.+?)\\s*$",
    "i"
  );
  const lines = text.split(/\r?\n/);
  let anyTimed = false;
  for (const line of lines) {
    const t = String(line || "").trim();
    if (!t) continue;
    const m = t.match(re);
    if (m) {
      anyTimed = true;
      const frac = (x) => {
        if (x == null || x === "") return 0;
        const s = String(x);
        // 1 digit → /10, 2 → /100, 3 → /1000
        const n = Number(s);
        if (!Number.isFinite(n)) return 0;
        if (s.length <= 1) return n / 10;
        if (s.length === 2) return n / 100;
        return n / 1000;
      };
      const start =
        Number(m[1]) * 60 + Number(m[2]) + frac(m[3]);
      const end =
        Number(m[4]) * 60 + Number(m[5]) + frac(m[6]);
      const body = String(m[7] || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!body) continue;
      segs.push({
        start: Math.max(0, start),
        end: Math.max(start + 0.3, end),
        text: body,
        silent: false,
        sttIndex: segs.length,
      });
    } else if (anyTimed && t.length >= 2 && !/^\[/.test(t)) {
      // Continuation line without clock — append to last cue
      if (segs.length) {
        segs[segs.length - 1].text =
          (segs[segs.length - 1].text + " " + t).replace(/\s+/g, " ").trim();
      }
    }
  }
  return segs;
}

/** Strip [time] markers → plain paragraph (when timed form disabled). */
function stripTimedTranscriptMarkers(raw) {
  const parsed = parseTimedTranscriptText(raw);
  if (parsed.length >= 1) {
    return parsed
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  // Fallback: strip bracket clocks inline
  return String(raw || "")
    .replace(
      /\[\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*[–—→\-]+\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*s?\s*\]\s*/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build timed segment list for target script (1:1 STT windows or even split).
 */
function buildTimedScriptSegments(script, duration, sttSegments, originalText, translated) {
  const timedSegs = Array.isArray(sttSegments) ? sttSegments : [];
  let segs = null;
  if (timedSegs.length) {
    if (translated && originalText) {
      segs = mapTranslatedOntoSegments(originalText, script, timedSegs);
    } else {
      segs = timedSegs.map((s, i) => ({
        start: Number(s.start) || 0,
        end: Math.max(Number(s.end) || 0, (Number(s.start) || 0) + 0.5),
        text: String(s.text || "").trim(),
        silent: !String(s.text || "").trim(),
        sttIndex: i,
      }));
      // If final script differs a lot from STT join, redistribute full script onto slots
      const joined = segs
        .map((s) => s.text)
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const scriptNorm = String(script || "").replace(/\s+/g, " ").trim();
      if (
        scriptNorm &&
        joined &&
        (scriptNorm.length > joined.length * 1.05 ||
          scriptNorm.toLowerCase() !== joined.toLowerCase())
      ) {
        segs =
          mapTranslatedOntoSegments(joined, scriptNorm, timedSegs) || segs;
      }
    }
  }
  if (segs && segs.length) return segs;
  // Fallback: phrase-split across full duration
  return buildTimedCues(script, duration, null);
}

/**
 * speedMode: turbo | balanced | quality
 * - turbo: more GPU threads, larger tiles, slightly lower jpg quality
 * - balanced: good default for RX 580 class
 * - quality: safer threads, best intermediate quality
 */
function speedProfile(mode) {
  const m = String(mode || "balanced").toLowerCase();
  if (m === "turbo") {
    return {
      id: "turbo",
      // load:proc:save — 4:8:4 hangs / OOM on many consumer GPUs → safer 2:6:2
      esrganJobs: "2:6:2",
      tile: 200,
      jpgQ: 4,
      encodePreset: "veryfast",
      encodeCrf: 18,
      parallelTts: true,
      skipMidEncode: true,
    };
  }
  if (m === "quality") {
    return {
      id: "quality",
      esrganJobs: "1:2:2",
      tile: 0,
      jpgQ: 2,
      encodePreset: "medium",
      encodeCrf: 15,
      parallelTts: true,
      skipMidEncode: true,
    };
  }
  return {
    id: "balanced",
    esrganJobs: "2:4:2",
    tile: 200,
    jpgQ: 3,
    encodePreset: "fast",
    encodeCrf: 16,
    parallelTts: true,
    skipMidEncode: true,
  };
}

/**
 * Max seconds per AI segment — long clips are split, processed, then concatenated.
 * Keep short: 60 fps × 20 s ≈ 1200 klatek w jednym ESRGAN = wygląda jak zawieszenie.
 */
const AI_CHUNK_SEC = 12;
/** Hard cap frames per Real-ESRGAN run (forces more segments even when duration probe is short). */
const AI_MAX_FRAMES_PER_SEG = 280;
/** Default stall (no new output frames) before kill → fallback Szybki HD. 0 via env disables. */
const AI_STALL_MS_DEFAULT = 8 * 60 * 1000;

/**
 * How many AI segments for this clip (by time AND by estimated frames).
 * @returns {{ nChunks: number, chunkDur: number, reason: string }}
 */
function planAiChunks(durationSec, fps, aiMaxFps) {
  const dur = Math.max(0, Number(durationSec) || 0);
  const useFps = Math.max(
    1,
    Math.min(Number(fps) || 30, Number(aiMaxFps) > 0 ? Number(aiMaxFps) : Number(fps) || 30)
  );
  if (dur < 0.15) {
    // Unknown / tiny duration — still force at least one window; caller may walk file
    return { nChunks: 1, chunkDur: AI_CHUNK_SEC, reason: "unknown-duration" };
  }
  const estFrames = Math.max(1, Math.round(dur * useFps));
  const byTime = Math.max(1, Math.ceil(dur / AI_CHUNK_SEC));
  const byFrames = Math.max(1, Math.ceil(estFrames / AI_MAX_FRAMES_PER_SEG));
  const nChunks = Math.max(byTime, byFrames);
  // Cap absurd splits (e.g. bad fps) but allow long videos
  const capped = Math.min(nChunks, 80);
  const chunkDur = dur / capped;
  const reason =
    byFrames > byTime
      ? `frames(~${estFrames}>${AI_MAX_FRAMES_PER_SEG}→${capped}×)`
      : `time(~${Math.round(dur)}s/${AI_CHUNK_SEC}s→${capped}×)`;
  return { nChunks: capped, chunkDur, reason };
}

/** Free disk bytes for a path (Windows-friendly). */
function freeDiskBytes(dirPath) {
  try {
    const resolved = path.resolve(dirPath || process.cwd());
    if (process.platform === "win32") {
      const drive = resolved.slice(0, 2); // "C:"
      const r = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-PSDrive -Name '${drive[0]}').Free`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 8000 }
      );
      const n = Number(String(r.stdout || "").trim());
      if (Number.isFinite(n) && n > 0) return n;
    } else {
      const r = spawnSync("df", ["-k", resolved], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      });
      const lines = String(r.stdout || "").trim().split(/\n/);
      const last = lines[lines.length - 1] || "";
      const parts = last.split(/\s+/);
      const availK = Number(parts[3]);
      if (Number.isFinite(availK) && availK > 0) return availK * 1024;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Escape a path for ffmpeg concat demuxer file list (Windows-safe).
 */
function ffmpegConcatPath(p) {
  return String(p).replace(/\\/g, "/").replace(/'/g, "'\\''");
}

/**
 * AI path for one time window: extract frames → Real-ESRGAN → silent HD part.
 * Returns { partPath, frameCount, useFps } or throws / signals failure via null + opts.
 */
async function aiProcessOneSegment({
  ffmpeg,
  realesrgan,
  sourceVideo,
  work,
  segIndex,
  startSec,
  lenSec,
  info,
  opts,
  sp,
  fuseDelogo,
  aiScale,
  aiModel,
  onExtractProgress,
  onAiProgress,
  onUpdate,
}) {
  const segDir = path.join(work, `ai_seg_${String(segIndex).padStart(2, "0")}`);
  const framesIn = path.join(segDir, "in");
  const framesOut = path.join(segDir, "out");
  fs.mkdirSync(framesIn, { recursive: true });
  fs.mkdirSync(framesOut, { recursive: true });

  const extractVf = [];
  if (fuseDelogo) {
    extractVf.push(...delogoFilters(opts, info.width, info.height));
  }
  // Cap FPS on long clips — full 30–60 fps frames explode disk (AI → forced HD)
  const srcFps = Math.max(1, Number(info.fps) || 30);
  const maxAiFps = Number(opts.aiMaxFps) > 0 ? Number(opts.aiMaxFps) : 0;
  if (maxAiFps > 0 && srcFps > maxAiFps + 0.5) {
    extractVf.push(`fps=${maxAiFps.toFixed(3)}`);
  }
  // Prefer -ss BEFORE -i for mid-segments (fast seek). Tiny accuracy loss vs hanging on re-decode.
  const ss = Math.max(0, Number(startSec) || 0);
  const tt = Math.max(0.05, Number(lenSec) || 0.05);
  const extractArgs = ["-y", "-threads", "0", "-hide_banner", "-loglevel", "error"];
  if (ss >= 0.25) {
    extractArgs.push("-ss", ss.toFixed(3));
  }
  extractArgs.push("-i", sourceVideo);
  if (ss > 0 && ss < 0.25) {
    extractArgs.push("-ss", ss.toFixed(3));
  }
  extractArgs.push(
    "-t",
    tt.toFixed(3),
    "-qscale:v",
    String(sp.jpgQ),
    "-qmin",
    "1",
    "-qmax",
    String(Math.max(sp.jpgQ, 2)),
    "-fps_mode",
    "passthrough"
  );
  if (extractVf.length) extractArgs.push("-vf", extractVf.join(","));
  extractArgs.push(path.join(framesIn, "frame%06d.jpg"));

  const estExtract = Math.max(
    1,
    Math.round(tt * (maxAiFps > 0 ? Math.min(srcFps, maxAiFps) : srcFps))
  );
  if (onExtractProgress) onExtractProgress(0, estExtract);
  // Async extract — spawnSync freezes Node so UI/% and agent heartbeat die → "zawieszenie"
  const er = await runAsync(ffmpeg, extractArgs, {
    timeoutMs: Math.min(
      12 * 60 * 1000,
      Math.max(90 * 1000, Math.round(tt * 15000) + 60000)
    ),
    tickMs: 1500,
    onTick: () => {
      try {
        const n = fs.existsSync(framesIn)
          ? fs.readdirSync(framesIn).filter((f) => /\.jpe?g$/i.test(f)).length
          : 0;
        if (onExtractProgress) onExtractProgress(n, estExtract);
      } catch {
        /* ignore */
      }
    },
  });
  const frameCount = fs
    .readdirSync(framesIn)
    .filter((f) => /\.jpe?g$/i.test(f)).length;
  if (!frameCount) {
    rmrf(segDir);
    throw new Error(
      `Brak klatek w segmencie ${segIndex + 1}: ` + (er.stderr || "").slice(-200)
    );
  }
  let useFps = info.fps || 30;
  if (lenSec > 0 && frameCount > 0) {
    useFps = frameCount / lenSec;
    if (useFps < 1) useFps = 30;
  }

  await upscaleAi(
    realesrgan,
    framesIn,
    framesOut,
    onAiProgress,
    aiScale,
    sp,
    aiModel
  );

  const sample = fs
    .readdirSync(framesOut)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort()[0];
  const sampleSize = sample
    ? fs.statSync(path.join(framesOut, sample)).size
    : 0;
  if (sampleSize < 20000) {
    rmrf(segDir);
    throw new Error("AI klatki podejrzane (za małe) w segmencie " + (segIndex + 1));
  }

  const partPath = path.join(work, `02_ai_part${String(segIndex).padStart(2, "0")}.mp4`);
  const ar = await runAsync(
    ffmpeg,
    [
      "-y",
      "-threads",
      "0",
      "-framerate",
      String(useFps),
      "-i",
      path.join(framesOut, "frame%06d.jpg"),
      "-vf",
      [
        `scale=-2:${opts.targetHeight || 1080}:flags=lanczos`,
        "setsar=1",
        ...polishFilters(opts),
      ].join(","),
      "-c:v",
      "libx264",
      "-preset",
      sp.encodePreset,
      "-crf",
      String(opts.crf != null ? opts.crf : sp.encodeCrf),
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      partPath,
    ],
    {
      timeoutMs: Math.min(
        15 * 60 * 1000,
        Math.max(120 * 1000, frameCount * 400)
      ),
      tickMs: 2500,
      onTick: () => {
        if (onUpdate) {
          onUpdate({
            stage: `AI compose seg ${segIndex + 1}…`,
          });
        }
      },
    }
  );
  // Free disk: drop frame dirs after encode
  rmrf(segDir);
  if (ar.status !== 0 || !fs.existsSync(partPath)) {
    throw new Error(
      "Składanie segmentu " +
        (segIndex + 1) +
        ": " +
        (ar.stderr || "").slice(-300)
    );
  }
  onUpdate({
    log: `AI segment ${segIndex + 1}: ${frameCount} klatek → ${path.basename(partPath)}`,
  });
  return { partPath, frameCount, useFps };
}

async function upscaleAi(
  realesrgan,
  framesIn,
  framesOut,
  onProgress,
  scale = 2,
  speed = null,
  aiModel = "animevideov3"
) {
  fs.mkdirSync(framesOut, { recursive: true });
  const modelDir = path.join(path.dirname(realesrgan), "models");
  const sp = speed || speedProfile("balanced");
  const resolved = resolveEsrganModel(modelDir, aiModel);
  // x4plus* are fixed ×4; animevideov3 supports 2/3/4
  let s = [2, 3, 4].includes(Number(scale)) ? Number(scale) : 2;
  if (resolved.fixedScale) s = resolved.fixedScale;
  // Ensure animevideov3 scale file exists
  if (resolved.key === "animevideov3") {
    const bin = path.join(modelDir, `realesr-animevideov3-x${s}.bin`);
    if (!fs.existsSync(bin)) {
      for (const tryS of [2, 3, 4]) {
        if (
          fs.existsSync(path.join(modelDir, `realesr-animevideov3-x${tryS}.bin`))
        ) {
          s = tryS;
          break;
        }
      }
    }
  }
  const args = [
    "-i",
    framesIn,
    "-o",
    framesOut,
    "-n",
    resolved.name,
    "-s",
    String(s),
    "-f",
    "jpg",
    "-g",
    "0",
    "-j",
    sp.esrganJobs,
  ];
  if (sp.tile > 0) {
    args.push("-t", String(sp.tile));
  }
  if (fs.existsSync(modelDir)) args.push("-m", modelDir);

  const totalIn = fs
    .readdirSync(framesIn)
    .filter((f) => /\.jpe?g$/i.test(f)).length;

  return new Promise((resolve, reject) => {
    const child = spawn(realesrgan, args, {
      cwd: path.dirname(realesrgan),
      windowsHide: true,
    });
    let lastPct = 0;
    let settled = false;
    let lastOutCount = 0;
    let lastProgressAt = Date.now();
    // Stall default ON (8 min no new frames) so hung ESRGAN falls back to Szybki HD.
    // AI_STALL_MS=0 / off disables. AI_HARD_TIMEOUT_MS only if set.
    function envMs(name, defaultMs) {
      const raw = process.env[name];
      if (raw === "0" || /^false|off|no$/i.test(String(raw || ""))) return 0;
      if (raw == null || raw === "") return defaultMs;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : defaultMs;
    }
    const stallMs = envMs("AI_STALL_MS", AI_STALL_MS_DEFAULT);
    const hardTimeoutMs = envMs("AI_HARD_TIMEOUT_MS", 0);

    const killChild = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      try {
        spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
          windowsHide: true,
        });
      } catch {
        /* ignore */
      }
    };

    const countOut = () => {
      try {
        return fs.existsSync(framesOut)
          ? fs.readdirSync(framesOut).filter((f) => /\.jpe?g$/i.test(f)).length
          : 0;
      } catch {
        return 0;
      }
    };

    const tick = () => {
      if (settled) return;
      try {
        const n = countOut();
        if (n > lastOutCount) {
          lastOutCount = n;
          lastProgressAt = Date.now();
        }
        // Near complete: never treat as stalled (realesrgan often pauses after last frame)
        if (totalIn > 0 && n >= totalIn) {
          lastProgressAt = Date.now();
          if (onProgress) onProgress(99, n, totalIn);
          return;
        }
        const pct = totalIn
          ? Math.min(99, Math.round((n / totalIn) * 100))
          : 0;
        if (pct >= lastPct) {
          lastPct = pct;
          if (onProgress) onProgress(pct, n, totalIn);
        }
        // Optional stall only if explicitly enabled AND not near end
        if (
          stallMs > 0 &&
          n < totalIn &&
          Date.now() - lastProgressAt > stallMs
        ) {
          if (settled) return;
          settled = true;
          clearInterval(iv);
          if (hardTimer) clearTimeout(hardTimer);
          killChild();
          reject(
            new Error(
              "AI upscale zawiesił się (brak postępu " +
                Math.round(stallMs / 60000) +
                " min). Użyj Szybki HD."
            )
          );
        }
      } catch {
        /* ignore race */
      }
    };
    const iv = setInterval(tick, 2000);
    tick();

    // Hard timeout OFF unless AI_HARD_TIMEOUT_MS is a positive number
    let hardTimer = null;
    if (hardTimeoutMs > 0) {
      hardTimer = setTimeout(() => {
        if (settled) return;
        // If almost all frames done, do NOT kill — wait for natural exit
        const n = countOut();
        if (totalIn > 0 && n >= Math.floor(totalIn * 0.95)) {
          lastProgressAt = Date.now();
          return; // leave process running; close handler will finish
        }
        settled = true;
        clearInterval(iv);
        killChild();
        reject(
          new Error(
            "AI upscale przekroczył limit czasu. Użyj Szybki HD / Turbo."
          )
        );
      }, hardTimeoutMs);
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearInterval(iv);
      if (hardTimer) clearTimeout(hardTimer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearInterval(iv);
      if (hardTimer) clearTimeout(hardTimer);
      const n = countOut();
      // Accept success if we have essentially all frames (exit code can be non-zero on Windows)
      const enough =
        n > 0 && (totalIn <= 0 || n >= Math.max(1, Math.floor(totalIn * 0.92)));
      if (enough) {
        if (onProgress) onProgress(100, n, totalIn);
        resolve(n);
        return;
      }
      if (code !== 0 || n === 0) {
        reject(
          new Error(
            "Real-ESRGAN nie wyprodukował klatek (kod " +
              code +
              ", out=" +
              n +
              "/" +
              totalIn +
              "). Spróbuj trybu Szybki HD."
          )
        );
      } else {
        if (onProgress) onProgress(100, n, totalIn);
        resolve(n);
      }
    });
  });
}

/**
 * Main entry for a job.
 * @param {object} job
 * @param {(patch: object) => void} onUpdate
 */
async function runPipeline(job, onUpdate) {
  const ffmpeg = ffmpegPath();
  assertFfmpegWorks(ffmpeg);
  const opts = job.options || {};
  const work = path.join(WORK_DIR, job.id);
  rmrf(work);
  fs.mkdirSync(work, { recursive: true });
  let heart = null;

  try {
  // --- probe first (needed for auto speed) ---
  onUpdate({
    progress: 3,
    stage: "Analiza pliku",
    log: "Sondowanie wideo…",
  });
  const info = probe(ffmpeg, job.inputPath);
  if (!info.width) {
    throw new Error(
      "Nie udało się odczytać wideo." +
        (info.error ? " " + info.error : "") +
        " (plik: " +
        String(job.inputPath || "") +
        ")"
    );
  }

  // Auto color correction: sample frames → set polish sliders
  if (
    opts.polish !== false &&
    (opts.polishMode === "auto" || opts.qualityPreset === "auto")
  ) {
    onUpdate({
      progress: 5,
      stage: "Auto-korekcja kolorów",
      log: "Analiza jasności / kontrastu / nasycenia…",
    });
    try {
      const auto = analyzeAutoPolish(ffmpeg, job.inputPath, info);
      Object.assign(opts, auto);
      job.options = { ...(job.options || {}), ...auto };
      const st = auto._autoStats || {};
      const preview = {
        polishMode: "auto",
        qualityPreset: auto.qualityPreset,
        brightness: auto.brightness,
        contrast: auto.contrast,
        saturation: auto.saturation,
        sharpen: auto.sharpen,
        denoise: auto.denoise,
        stats: st,
      };
      onUpdate({
        autoPolish: preview,
        log:
          `Auto-korekcja: preset=${auto.qualityPreset}` +
          ` · jasność=${auto.brightness}` +
          ` · kontrast=${auto.contrast}` +
          ` · saturacja=${auto.saturation}` +
          ` · ostrość=${auto.sharpen}` +
          ` · denoise=${auto.denoise}` +
          (st.samples != null ? ` · próbek=${st.samples}` : "") +
          (st.yAvg != null ? ` · YAVG≈${Number(st.yAvg).toFixed(1)}` : ""),
      });
    } catch (e) {
      onUpdate({
        log:
          "Auto-korekcja: analiza nieudana — używam presetu balanced (" +
          (e.message || e) +
          ")",
      });
      opts.qualityPreset = "balanced";
      opts.polish = true;
    }
  }

  // Auto audio enhance: volumedetect → volume / denoise / EQ / voice focus
  if (
    opts.audioEnhance !== false &&
    (opts.audioMode === "auto" || opts.audioMode == null)
  ) {
    onUpdate({
      progress: 6,
      stage: "Auto-korekcja audio",
      log: "Analiza głośności / szumu…",
    });
    try {
      const aa = analyzeAutoAudio(ffmpeg, job.inputPath, info);
      // Merge only unset / auto fields
      opts.audioVolume = aa.audioVolume;
      opts.audioBass = aa.audioBass;
      opts.audioTreble = aa.audioTreble;
      opts.audioDenoise = aa.audioDenoise;
      opts.audioVoiceOnly = aa.audioVoiceOnly;
      opts.audioNormalize = aa.audioNormalize;
      if (!opts.audioBitrate && aa._autoAudioBitrate) {
        opts.audioBitrate = aa._autoAudioBitrate;
      }
      opts.audioEnhance = true;
      opts.audioMode = "auto";
      job.options = { ...(job.options || {}), ...opts };
      const st = aa._autoAudioStats || {};
      onUpdate({
        autoAudio: {
          audioVolume: opts.audioVolume,
          audioBass: opts.audioBass,
          audioTreble: opts.audioTreble,
          audioDenoise: opts.audioDenoise,
          audioVoiceOnly: opts.audioVoiceOnly,
          audioNormalize: opts.audioNormalize,
          audioBitrate: audioBitrateK(opts),
          stats: st,
        },
        log:
          `Auto-audio: vol=${opts.audioVolume}` +
          ` · bass=${opts.audioBass}` +
          ` · treble=${opts.audioTreble}` +
          ` · denoise=${opts.audioDenoise}` +
          ` · voiceOnly=${!!opts.audioVoiceOnly}` +
          ` · ${audioBitrateK(opts)}k` +
          (st.mean != null ? ` · mean=${Number(st.mean).toFixed(1)}dB` : "") +
          (st.max != null ? ` · max=${Number(st.max).toFixed(1)}dB` : "") +
          (st.qualityHint ? ` · ${st.qualityHint}` : ""),
      });
    } catch (e) {
      onUpdate({
        log:
          "Auto-audio: analiza nieudana — używam ustawień domyślnych (" +
          (e.message || e) +
          ")",
      });
      if (opts.audioVolume == null) opts.audioVolume = 55;
      if (opts.audioBass == null) opts.audioBass = 50;
      if (opts.audioTreble == null) opts.audioTreble = 52;
      if (opts.audioDenoise == null) opts.audioDenoise = 22;
      if (opts.audioNormalize == null) opts.audioNormalize = true;
    }
  }

  // Auto speed: long clips → turbo, short → balanced
  let speedMode = opts.speedMode || "auto";
  if (speedMode === "auto") {
    const dur = info.duration || 0;
    const estFrames = Math.round(dur * (info.fps || 30));
    if (dur >= 50 || estFrames >= 1400) speedMode = "turbo";
    else if (dur <= 20) speedMode = "quality";
    else speedMode = "balanced";
  }
  // Force turbo if user picked AI on very long clip without explicit quality
  if (
    opts.upscale === "ai" &&
    (info.duration || 0) >= 70 &&
    opts.speedMode !== "quality"
  ) {
    speedMode = "turbo";
  }
  const sp = speedProfile(speedMode);
  onUpdate({
    log: `Profil szybkości: ${sp.id} (AI wątki ${sp.esrganJobs})`,
  });

  // Default AI scale: turbo forces x2
  if (opts.upscale === "ai" && sp.id === "turbo" && !opts.aiScale) {
    opts.aiScale = 2;
  }

  const stages = [];
  const pushStage = (id, label) => {
    stages.push({ id, label, status: "pending" });
    onUpdate({ stages: [...stages] });
  };
  const setStage = (id, status) => {
    const s = stages.find((x) => x.id === id);
    if (s) s.status = status;
    onUpdate({ stages: [...stages], stage: s ? s.label : id });
  };

  pushStage("probe", "Analiza pliku");

  // One-click: narrator-only — skip delogo / HD / AI entirely
  if (opts.narratorOnly === true || opts.skipVideoImprove === true) {
    opts.narratorOnly = true;
    opts.delogo = false;
    opts.upscale = "off";
    opts.polish = false;
    opts.qualityPreset = "off";
    opts.videoStyle = "off";
    opts.videoAspect = "original";
    opts.stabilize = "off";
    opts.playbackSpeed = 1;
    opts.maxDurationSec = 0;
    opts.fadeEdges = false;
    opts.narrator = true;
    onUpdate({
      log:
        "Tryb ⚡ TYLKO LEKTOR — pomijam delogo / HD / AI / polish / styl obrazu (włącz styl = odznacz «Tylko lektor»)",
    });
  }

  if (
    opts.videoStyle &&
    opts.videoStyle !== "off" &&
    opts.videoStyle !== "none"
  ) {
    const sf = styleFilters(opts);
    onUpdate({
      log:
        "Styl obrazu: " +
        opts.videoStyle +
        (sf.length
          ? " · filtry: " + sf.join(" → ").slice(0, 120)
          : " · (brak filtrów — nieznany styl)"),
    });
  }

  // AI always runs when user selected it — no length/frame skip.
  // Only "Uruchom ponownie (Szybki HD)" sets forceFast and skips AI.
  const willSkipAi =
    !opts.narratorOnly && opts.upscale === "ai" && opts.forceFast === true;
  if (opts.upscale === "ai" && !willSkipAi && !opts.narratorOnly) {
    const dur = info.duration || 0;
    const est = Math.round(dur * (info.fps || 30));
    const plan0 = planAiChunks(dur, info.fps || 30, opts.aiMaxFps);
    onUpdate({
      log:
        plan0.nChunks > 1
          ? `AI Real-ESRGAN: ${plan0.nChunks} segmentów (${plan0.reason}, max ~${AI_CHUNK_SEC}s / ${AI_MAX_FRAMES_PER_SEG} klatek) · ~${est} klatek / ${dur || "?"}s`
          : `AI Real-ESRGAN WŁĄCZONE (~${est} klatek / ${dur || "?"}s · 1 segment).`,
    });
  }
  // Only fuse delogo into AI extract when AI will actually run
  const fuseDelogoIntoExtract =
    opts.upscale === "ai" &&
    !willSkipAi &&
    opts.delogo &&
    sp.skipMidEncode;

  if (!opts.narratorOnly && opts.delogo && !fuseDelogoIntoExtract) {
    pushStage("delogo", "Usuwanie logo / znaku wodnego");
  }
  if (!opts.narratorOnly && opts.upscale === "ai" && !willSkipAi) {
    pushStage(
      "frames",
      fuseDelogoIntoExtract ? "Klatki + delogo" : "Ekstrakcja klatek"
    );
    pushStage("ai", "AI upscale (Real-ESRGAN)");
    pushStage("assemble", "Składanie wideo HD");
  } else if (!opts.narratorOnly && (opts.upscale === "fast" || willSkipAi)) {
    pushStage(
      "fast",
      willSkipAi
        ? "Poprawa wideo HD (Szybki HD)"
        : "Szybkie skalowanie HD"
    );
    if (willSkipAi) {
      onUpdate({
        log: "AI pominięte — wymuszony Szybki HD (retry / forceFast).",
      });
      opts.upscale = "fast";
      opts._wantedAi = true;
    }
  } else if (!opts.narratorOnly) {
    pushStage("encode", "Kodowanie obrazu");
  }
  if (opts.narrator || opts.subtitles) {
    const nMode = opts.narratorMode === "describe" ? "describe" : "translate";
    if (nMode === "translate") {
      pushStage("stt", "Wyodrębnianie tekstu z wideo");
      pushStage("translate", "Tłumaczenie na żywo");
    } else {
      pushStage("stt", "Treść do opisu");
      pushStage("translate", "Pełny opis sytuacji");
    }
  }
  if (opts.narrator)
    pushStage("narrator", `Lektor TTS (${opts.targetLang || "pl"})`);
  if (opts.subtitles)
    pushStage("subs", `Napisy (${opts.targetLang || "pl"})`);
  pushStage("mix", "Mikser audio + final");

  let progress = 2;
  const setP = (p, stage, log) => {
    // Allow progress to move forward; never stuck below previous except reset
    const next = Math.max(0, Math.min(99, Math.round(p)));
    if (next >= progress) progress = next;
    else if (next > progress - 3) progress = next; // tiny corrections ok
    const patch = { progress };
    if (stage) patch.stage = stage;
    if (log) patch.log = log;
    onUpdate(patch);
  };
  // Heartbeat so % bar never looks frozen during long TTS/encode
  let beat = 0;
  heart = setInterval(() => {
    if (progress >= 99) return;
    beat += 1;
    const ceiling =
      progress < 25 ? 24 : progress < 70 ? 69 : progress < 85 ? 84 : progress < 93 ? 92 : 98;
    if (progress < ceiling && beat % 2 === 0) {
      setP(progress + 1, null, null);
    }
  }, 4000);

  setStage("probe", "done");
  setP(
    8,
    "Analiza pliku",
    `${info.width}x${info.height} ~${info.duration || "?"}s · ${sp.id}`
  );

  let currentVideo = job.inputPath;
  // STT uses spawnSync and would BLOCK video work if started first.
  // Order: VIDEO enhance first, then transcription/TTS.
  // Exception: narratorOnly skips video improve entirely.
  let narratorPrepPromise = null;
  let narratorReady = null;
  opts.originalName = opts.originalName || job.originalName;
  opts.filename = opts.filename || job.originalName;
  opts.inputPath = job.inputPath;
  opts.videoPath = job.inputPath;
  opts.workDir = work;
  // Duration for lektor "opis sytuacji" — match final timeline (max length + speed)
  {
    let d = Number(info.duration) || 0;
    const maxD = Number(opts.maxDurationSec) || 0;
    if (maxD > 0 && d > 0) d = Math.min(d, maxD);
    const spd = Number(opts.playbackSpeed) || 1;
    if (d > 0 && spd > 0.02 && Math.abs(spd - 1) >= 0.02) d = d / spd;
    opts.durationSec = d > 0 ? d : Number(info.duration) || 0;
  }

  // --- delogo as separate encode (only when not fused into AI) ---
  if (!opts.narratorOnly && opts.delogo && !fuseDelogoIntoExtract) {
    setStage("delogo", "active");
    setP(12, "Usuwanie logo", opts.delogoMode === "manual" ? "ręczny" : "auto");
    const dParts = delogoFilters(opts, info.width, info.height);
    const out1 = path.join(work, "01_clean.mp4");
    if (!dParts.length) {
      onUpdate({ log: "Brak poprawnego obszaru logo — pomijam delogo" });
      setStage("delogo", "done");
    } else {
      onUpdate({
        log: `Delogo: ${dParts.length} obszar(y), metoda ${opts.delogoMethod || "delogo"}`,
      });
      // Delogo-only pass (polish comes with HD scale pass for better quality)
      const r = await runAsync(
        ffmpeg,
        [
          "-y",
          "-threads",
          "0",
          "-i",
          currentVideo,
          "-vf",
          dParts.join(","),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "copy",
          out1,
        ],
        {
          timeoutMs: Math.min(8 * 60 * 1000, Math.max(90000, (info.duration || 30) * 3000)),
          onTick: () =>
            setP(Math.min(17, progress + 1), "Usuwanie logo", "delogo…"),
        }
      );
      if (r.status !== 0 || !fs.existsSync(out1)) {
        onUpdate({
          log:
            "Delogo nie powiodło się — kontynuuję bez usuwania logo: " +
            (r.stderr || "").slice(-160),
        });
        setStage("delogo", "done");
      } else {
        currentVideo = out1;
        setStage("delogo", "done");
        setP(18, "Usuwanie logo", "OK");
        onUpdate({ log: "Delogo OK" });
      }
    }
  }

  // --- upscale paths ---
  let frameCount = 0;
  let useFps = info.fps || 30;
  // narratorOnly: copy original video stream in final mux (no re-encode of picture)
  let videoAlreadyFinal = !!opts.narratorOnly;
  if (opts.narratorOnly) {
    setP(15, "Tylko lektor", "bez poprawy wideo — od razu STT…");
    onUpdate({ log: "Wideo oryginalne (copy) — start STT / lektor" });
  }

  if (opts.upscale === "ai") {
    const realesrgan = findRealEsrgan();
    // No duration/frame limit — user requested force AI regardless of length.
    // Only forceFast (Szybki HD retry) skips AI.
    if (!realesrgan) {
      // Not a hard failure — continue with FFmpeg HD (works on every PC / cloud)
      onUpdate({
        stage: "Poprawa wideo HD",
        log:
          "AI (Real-ESRGAN) niedostępne na tym PC — kontynuuję w Szybki HD. " +
          "Żeby włączyć AI: odpal ponownie ⬇ PC (setup instaluje ESRGAN) albo skopiuj tools/realesrgan do %LOCALAPPDATA%\\ClipForge-Agent\\tools\\realesrgan\\",
      });
      opts.upscale = "fast";
      opts._wantedAi = true;
    } else if (opts.forceFast === true) {
      onUpdate({
        log: "AI pominięte — wymuszony Szybki HD (forceFast).",
      });
      opts.upscale = "fast";
      opts._wantedAi = true;
      setP(20, "Poprawa wideo HD", "zamiast AI…");
    } else {
      let duration = Math.max(0, Number(info.duration) || 0);
      // If probe missed Duration (N/A / bad container), walk file in fixed windows
      const durationUnknown = !(duration > 0.5);
      if (durationUnknown) {
        duration = 0;
        onUpdate({
          log:
            "Brak Duration w probe — AI w trybie kroczącym (okna " +
            AI_CHUNK_SEC +
            "s aż do końca pliku)",
        });
      } else {
        duration = Math.max(0.1, duration);
      }
      let useFpsCap = Math.max(1, Number(info.fps) || 30);
      // Cap AI FPS early — 60 fps shorts still produce 1000+ klatek / 15 s bez limitu
      if (duration >= 90) {
        opts.aiMaxFps = Math.min(useFpsCap, 18);
      } else if (duration >= 40) {
        opts.aiMaxFps = Math.min(useFpsCap, 20);
      } else if (duration >= 20 || useFpsCap > 30) {
        opts.aiMaxFps = Math.min(useFpsCap, 24);
      } else if (useFpsCap > 30) {
        opts.aiMaxFps = Math.min(useFpsCap, 30);
      }
      if (opts.aiMaxFps > 0) useFpsCap = opts.aiMaxFps;
      let estFrames = Math.round(duration * useFpsCap);
      // Split by time AND frame cap — never one ESRGAN run with 1000+ frames
      let { nChunks, chunkDur, reason: chunkReason } = planAiChunks(
        duration,
        useFpsCap,
        opts.aiMaxFps || useFpsCap
      );
      let aiScale = [2, 3, 4].includes(Number(opts.aiScale))
        ? Number(opts.aiScale)
        : 2;
      const modelDir = path.join(path.dirname(realesrgan), "models");
      const modelInfo = resolveEsrganModel(
        modelDir,
        opts.aiModel || "animevideov3"
      );
      if (modelInfo.fixedScale) {
        if (aiScale !== modelInfo.fixedScale) {
          onUpdate({
            log: `Model ${modelInfo.label}: skala ×${aiScale}→×${modelInfo.fixedScale} (model fixed)`,
          });
        }
        aiScale = modelInfo.fixedScale;
      }
      // Long video + high scale = huge frame folders → "za duży" / disk fail → HD
      if ((duration >= 60 || durationUnknown) && aiScale > 2 && !modelInfo.fixedScale) {
        onUpdate({
          log: `Długi film (~${durationUnknown ? "?" : Math.round(duration)}s): AI ×${aiScale}→×2 (mniej miejsca na dysku, szybciej).`,
        });
        aiScale = 2;
      }
      if (
        (sp.id === "turbo" || duration >= 50 || durationUnknown) &&
        aiScale > 2 &&
        (estFrames > 800 || durationUnknown) &&
        !modelInfo.fixedScale
      ) {
        onUpdate({
          log: `Turbo/długo: AI ×${aiScale}→×2 (za dużo klatek: ~${estFrames || "?"})`,
        });
        aiScale = 2;
      }
      // Peak disk ~ one segment in+out JPGs (rough)
      const freeB = freeDiskBytes(work);
      const peakEst =
        Math.ceil(AI_CHUNK_SEC * useFpsCap) * 450000 * (1 + Math.pow(aiScale, 1.6));
      if (freeB != null && freeB < 3 * 1024 * 1024 * 1024) {
        onUpdate({
          stage: "Poprawa wideo HD",
          log:
            "Mało miejsca na dysku (" +
            Math.round(freeB / 1e9) +
            " GB wolne) — AI potrzebuje kilka GB na klatki. Przełączam na Szybki HD. " +
            "Zwolnij dysk C: albo skróć film (max 30–60 s) i włącz AI ×2.",
        });
        opts.upscale = "fast";
        opts._wantedAi = true;
      } else if (freeB != null && freeB < peakEst * 2.5) {
        onUpdate({
          log:
            "Dysk blisko limitu AI (wolne ~" +
            Math.round(freeB / 1e9) +
            " GB, peaking ~" +
            Math.round(peakEst / 1e9) +
            " GB/segment) — obniżam skalę/FPS.",
        });
        if (!modelInfo.fixedScale) aiScale = 2;
        opts.aiMaxFps = Math.min(opts.aiMaxFps || useFpsCap, 18);
        useFpsCap = opts.aiMaxFps;
        estFrames = duration > 0 ? Math.round(duration * useFpsCap) : estFrames;
      }
      if (modelInfo.fallback && opts.aiModel) {
        onUpdate({
          log: `Model AI „${opts.aiModel}” niedostępny — używam ${modelInfo.label}`,
        });
      }
      if (opts.upscale !== "ai") {
        // switched to free HD due to disk
      } else {
      // Final plan after scale/fps tweaks
      if (!durationUnknown) {
        const p3 = planAiChunks(duration, useFpsCap, opts.aiMaxFps || useFpsCap);
        nChunks = p3.nChunks;
        chunkDur = p3.chunkDur;
        chunkReason = p3.reason;
        estFrames = Math.round(duration * useFpsCap);
      } else {
        nChunks = 0; // walk until empty
        chunkDur = AI_CHUNK_SEC;
        chunkReason = "walk";
      }
      onUpdate({
        log:
          (durationUnknown
            ? `AI Real-ESRGAN [${modelInfo.name} ×${aiScale}]: tryb krokowy · okna ${AI_CHUNK_SEC}s · ≤${AI_MAX_FRAMES_PER_SEG} klatek/seg`
            : nChunks > 1
              ? `AI Real-ESRGAN [${modelInfo.name} ×${aiScale}]: ${nChunks} segmentów × ~${chunkDur.toFixed(1)}s (${chunkReason}) · ~${estFrames} klatek / ${Math.round(duration)}s${opts.aiMaxFps ? " @≤" + opts.aiMaxFps + "fps" : ""} — montaż na końcu`
              : `AI Real-ESRGAN [${modelInfo.name} ×${aiScale}]: ~${estFrames} klatek / ${Math.round(duration)}s (1 segment)`) +
          (modelInfo.key === "x4plus" ? " · fotoreal (wolniej)" : ""),
      });

      const partPaths = [];
      frameCount = 0;
      try {
        const maxWalkSegs = 80;
        const loopCount = durationUnknown ? maxWalkSegs : nChunks;
        for (let i = 0; i < loopCount; i++) {
          const startSec = durationUnknown ? i * AI_CHUNK_SEC : i * chunkDur;
          const lenSec = durationUnknown
            ? AI_CHUNK_SEC
            : i === nChunks - 1
              ? Math.max(0.05, duration - startSec)
              : chunkDur;
          const totalSegsLabel = durationUnknown ? "?" : String(nChunks);
          const base = durationUnknown
            ? Math.min(75, 20 + i * 3)
            : 20 + (i / nChunks) * 58;
          const span = durationUnknown ? 3 : 58 / nChunks;

          setStage("frames", "active");
          setP(
            base,
            `Klatki seg ${i + 1}/${totalSegsLabel}`,
            `segment ${i + 1} · ${startSec.toFixed(1)}–${(startSec + lenSec).toFixed(1)}s`
          );
          onUpdate({
            log: `AI segment ${i + 1}/${totalSegsLabel}: ${startSec.toFixed(1)}–${(startSec + lenSec).toFixed(1)}s (~${Math.round(lenSec * useFpsCap)} klatek)`,
          });

          setStage("ai", "active");
          let seg;
          try {
            seg = await aiProcessOneSegment({
              ffmpeg,
              realesrgan,
              sourceVideo: currentVideo,
              work,
              segIndex: i,
              startSec,
              lenSec,
              info,
              opts,
              sp,
              fuseDelogo: fuseDelogoIntoExtract,
              aiScale,
              aiModel: modelInfo.key,
              onExtractProgress: (done, total) => {
                const d = Number(done) || 0;
                const tEst = Math.max(1, Number(total) || 1);
                const frac = Math.min(1, d / tEst);
                const stageLine = `Klatki seg ${i + 1}/${totalSegsLabel}: ${d}/${total || "?"}`;
                setP(base + span * 0.1 * Math.max(0.15, frac), stageLine, stageLine);
              },
              onAiProgress: (pct, done, total) => {
                const frames =
                  total > 0
                    ? `${done || 0}/${total} (${pct}%)`
                    : `${pct}%`;
                const stageLine = `AI ${modelInfo.name} x${aiScale} ${frames} · ${sp.id} · seg ${i + 1}/${totalSegsLabel}`;
                setP(
                  base + span * (0.12 + (pct / 100) * 0.75),
                  stageLine,
                  stageLine
                );
              },
              onUpdate,
            });
          } catch (segErr) {
            // Walk mode: empty/end of file → stop; planned mode: rethrow
            if (
              durationUnknown &&
              /Brak klatek/i.test(String(segErr && segErr.message))
            ) {
              if (partPaths.length === 0) throw segErr;
              onUpdate({
                log: `Koniec pliku po segmencie ${i} (brak dalszych klatek)`,
              });
              break;
            }
            throw segErr;
          }
          // Walk: tiny last window means end
          if (durationUnknown && seg.frameCount < 3) {
            if (seg.partPath && fs.existsSync(seg.partPath)) {
              try {
                fs.unlinkSync(seg.partPath);
              } catch {
                /* ignore */
              }
            }
            if (partPaths.length === 0) {
              throw new Error("AI: brak klatek w trybie kroczącym");
            }
            break;
          }
          partPaths.push(seg.partPath);
          frameCount += seg.frameCount;
          if (seg.useFps > 1) useFps = seg.useFps;
          setStage("frames", "done");
          onUpdate({
            log: `AI segment ${i + 1}/${totalSegsLabel} OK · ${seg.frameCount} klatek`,
          });
          // Walk: short segment vs expected → end of media
          if (
            durationUnknown &&
            seg.frameCount < Math.max(8, Math.round(useFpsCap * AI_CHUNK_SEC * 0.35))
          ) {
            onUpdate({
              log: `Ostatni segment krótki (${seg.frameCount} klatek) — koniec wideo`,
            });
            break;
          }
        }
        if (durationUnknown) {
          nChunks = partPaths.length;
        }
      } catch (aiErr) {
        const msg = String(aiErr.message || aiErr);
        const diskish =
          /ENOSPC|no space|za duż|too large|disk|miejsce|I\/O|odmowa dostępu/i.test(
            msg
          );
        onUpdate({
          log:
            "AI fail → Szybki HD: " +
            msg +
            (diskish
              ? " · Wskazówka: zwolnij dysk C:, AI ×2, model anime, albo skróć film / użyj od razu Szybki HD."
              : " · Długi film? Wybierz Szybki HD albo AI ×2 + max 60 s."),
        });
        opts.upscale = "fast";
        for (const p of partPaths) {
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {
            /* ignore */
          }
        }
      }

      if (opts.upscale === "ai" && partPaths.length === nChunks) {
        setStage("ai", "done");
        setP(
          78,
          `AI ${modelInfo.name} x${aiScale} done · ${sp.id}`,
          nChunks > 1 ? `${nChunks} segmentów OK` : "Upscale OK"
        );
        setStage("assemble", "active");
        setP(80, "Składanie wideo HD", nChunks > 1 ? "montaż segmentów…" : "mux audio…");

        let videoOnly = partPaths[0];
        if (nChunks > 1) {
          const listFile = path.join(work, "ai_concat.txt");
          fs.writeFileSync(
            listFile,
            partPaths.map((p) => `file '${ffmpegConcatPath(p)}'`).join("\n") +
              "\n",
            "utf8"
          );
          videoOnly = path.join(work, "02_ai_silent.mp4");
          const cr = run(ffmpeg, [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            listFile,
            "-c",
            "copy",
            videoOnly,
          ]);
          if (cr.status !== 0 || !fs.existsSync(videoOnly)) {
            // Fallback: re-encode concat if stream copy fails
            const cr2 = run(ffmpeg, [
              "-y",
              "-f",
              "concat",
              "-safe",
              "0",
              "-i",
              listFile,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "16",
              "-pix_fmt",
              "yuv420p",
              "-an",
              videoOnly,
            ]);
            if (cr2.status !== 0 || !fs.existsSync(videoOnly)) {
              throw new Error(
                "Montaż segmentów AI: " + (cr.stderr || cr2.stderr || "").slice(-300)
              );
            }
            onUpdate({ log: "Montaż segmentów: re-encode (copy nie przeszedł)" });
          } else {
            onUpdate({
              log: `Montaż ${nChunks} segmentów AI OK → ${path.basename(videoOnly)}`,
            });
          }
        }

        const assembled = path.join(work, "02_hd.mp4");
        const ar = run(ffmpeg, [
          "-y",
          "-threads",
          "0",
          "-i",
          videoOnly,
          "-i",
          job.inputPath,
          "-map",
          "0:v:0",
          "-map",
          "1:a?",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          "-shortest",
          "-movflags",
          "+faststart",
          assembled,
        ]);
        if (ar.status !== 0 || !fs.existsSync(assembled)) {
          // Rare: copy failed — re-encode video + audio
          const ar2 = run(ffmpeg, [
            "-y",
            "-threads",
            "0",
            "-i",
            videoOnly,
            "-i",
            job.inputPath,
            "-map",
            "0:v:0",
            "-map",
            "1:a?",
            "-c:v",
            "libx264",
            "-preset",
            sp.encodePreset,
            "-crf",
            String(opts.crf != null ? opts.crf : sp.encodeCrf),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-shortest",
            "-movflags",
            "+faststart",
            assembled,
          ]);
          if (ar2.status !== 0 || !fs.existsSync(assembled)) {
            throw new Error(
              "Składanie HD (audio): " + (ar.stderr || ar2.stderr || "").slice(-300)
            );
          }
        }
        currentVideo = assembled;
        videoAlreadyFinal = true;
        setStage("assemble", "done");
        setP(
          85,
          "Składanie wideo HD",
          nChunks > 1
            ? `HD gotowe · ${nChunks} części · ${frameCount} klatek`
            : "Wideo HD gotowe"
        );
        onUpdate({
          log:
            nChunks > 1
              ? `AI montaż gotowy: ${nChunks} segmentów, ${frameCount} klatek AI`
              : `AI gotowe: ${frameCount} klatek`,
        });
      } else if (opts.upscale === "ai") {
        // Incomplete parts
        onUpdate({ log: "AI nie dokończyło wszystkich segmentów → Szybki HD" });
        opts.upscale = "fast";
      }
      } // end else (actually run AI after disk checks)
    } // end else (has realesrgan, not forceFast)
  }

  if (opts.upscale === "fast") {
    if (stages.find((s) => s.id === "fast")) setStage("fast", "active");
    // Quality caps: allow up to 1440p for long clips, 1080p floor for very long
    let th = Number(opts.targetHeight) || 1080;
    const dur = info.duration || 0;
    const wantQuality =
      opts.polish !== false ||
      opts._wantedAi ||
      sp.id === "quality" ||
      sp.id === "balanced";
    if (dur >= 120 && th > 1080) {
      onUpdate({
        log: `Bardzo długi klip (${Math.round(dur)}s): cel ${th}p → 1080p`,
      });
      th = 1080;
    } else if (dur >= 70 && th > 1440) {
      onUpdate({
        log: `Długi klip (${Math.round(dur)}s): cel ${th}p → 1440p`,
      });
      th = 1440;
    }
    // Quality-first encode (user complained video improve was missing / washed out)
    let crf =
      opts.crf != null ? Number(opts.crf) : wantQuality ? 16 : sp.encodeCrf;
    if (crf < 14) crf = 14;
    if (crf > 22) crf = 22;
    // veryfast only for pure turbo short jobs; polish needs better preset
    let preset = "fast";
    if (sp.id === "quality") preset = "medium";
    else if (sp.id === "turbo" && !wantQuality && dur >= 60) preset = "veryfast";
    else if (wantQuality) preset = dur >= 90 ? "fast" : "medium";

    const stageLabel = wantQuality
      ? "Poprawa wideo HD"
      : "Szybkie skalowanie HD";
    setP(25, stageLabel, `${th}p · ${preset} · crf${crf} · polish/delogo…`);
    onUpdate({
      log: `Poprawa wideo: scale ${th}p + polish${opts.delogo ? " + delogo" : ""} · ${preset}/crf${crf}`,
    });

    // Apply on CURRENT video (after delogo), never re-read raw upload blindly
    const srcVid = currentVideo || job.inputPath;
    const vfParts = [];
    // If delogo already applied in 01_clean, skip second delogo
    const delogoAlready =
      srcVid !== job.inputPath && /01_clean\.mp4$/i.test(srcVid);
    if (opts.delogo && !delogoAlready) {
      vfParts.push(...delogoFilters(opts, info.width, info.height));
    }
    const creative = creativeVideoFilters(opts, th, dur);
    // Scale only if aspect filter didn't already scale+crop
    if (!creative.usedAspect) {
      vfParts.push(`scale=-2:${th}:flags=lanczos`);
      vfParts.push("setsar=1");
    }
    // Always polish when user enabled it OR when AI was requested (improve path)
    if (opts.polish !== false || opts._wantedAi) {
      // force polish on for AI-fallback quality path
      const polishOpts =
        opts.polish === false
          ? { ...opts, polish: true, qualityPreset: opts.qualityPreset || "balanced" }
          : opts;
      vfParts.push(...polishFilters(polishOpts));
    }
    vfParts.push(...creative.vf);
    const vfFinal = vfParts.filter(Boolean).join(",") || "null";
    const afChain = creative.afExtra.length
      ? creative.afExtra.join(",")
      : null;
    const outF = path.join(work, "02_fast.mp4");
    let tickP = 25;
    const maxDur = Number(opts.maxDurationSec) || 0;
    const encodeArgs = [
      "-y",
      "-threads",
      "0",
      "-i",
      srcVid,
      "-vf",
      vfFinal,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
    ];
    if (afChain) {
      encodeArgs.push("-af", afChain);
    }
    encodeArgs.push(
      "-c:a",
      "aac",
      "-b:a",
      `${audioBitrateK(opts)}k`,
      "-movflags",
      "+faststart"
    );
    if (maxDur > 0) encodeArgs.push("-t", String(maxDur));
    encodeArgs.push(outF);
    if (needsCreativeVideoFx(opts)) {
      onUpdate({
        log:
          `Extra wideo: style=${opts.videoStyle || "off"}` +
          ` · aspect=${opts.videoAspect || "original"}` +
          ` · stab=${opts.stabilize || "off"}` +
          ` · speed=${opts.playbackSpeed || 1}` +
          (maxDur ? ` · max ${maxDur}s` : ""),
      });
    }
    const r = await runAsync(ffmpeg, encodeArgs, {
      timeoutMs: Math.min(12 * 60 * 1000, Math.max(180000, dur * 5000)),
      onTick: () => {
        tickP = Math.min(68, tickP + 1);
        setP(tickP, stageLabel, `encode ${tickP}%…`);
      },
    });
    if (r.status !== 0 || !fs.existsSync(outF) || fs.statSync(outF).size < 2000) {
      const errHint = String(r.stderr || "").replace(/\s+/g, " ").slice(-200);
      onUpdate({
        log: "HD+styl fail — retry bez stabilizacji: " + errHint,
      });
      // Retry 1: keep style/aspect, drop stabilize (common deshake failures)
      const creativeNoStab = creativeVideoFilters(
        { ...opts, stabilize: "off" },
        th,
        dur
      );
      const vfRetry = [];
      if (opts.delogo && !delogoAlready) {
        vfRetry.push(...delogoFilters(opts, info.width, info.height));
      }
      if (!creativeNoStab.usedAspect) {
        vfRetry.push(`scale=-2:${th}:flags=lanczos`, "setsar=1");
      }
      if (opts.polish !== false || opts._wantedAi) {
        vfRetry.push(
          ...polishFilters(
            opts.polish === false
              ? { ...opts, polish: true, qualityPreset: "balanced" }
              : opts
          )
        );
      }
      vfRetry.push(...creativeNoStab.vf);
      const vf2 = vfRetry.filter(Boolean).join(",") || "null";
      const args2 = [
        "-y",
        "-threads",
        "0",
        "-i",
        srcVid,
        "-vf",
        vf2,
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        String(crf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        `${audioBitrateK(opts)}k`,
        "-movflags",
        "+faststart",
        outF,
      ];
      if (maxDur > 0) {
        args2.splice(args2.length - 1, 0, "-t", String(maxDur));
      }
      const r2 = await runAsync(ffmpeg, args2, {
        timeoutMs: 8 * 60 * 1000,
        onTick: () => {
          tickP = Math.min(68, tickP + 1);
          setP(tickP, stageLabel, "retry styl…");
        },
      });
      if (r2.status !== 0 || !fs.existsSync(outF) || fs.statSync(outF).size < 2000) {
        // Retry 2: keep STYLE (simple filters) + scale — never silently drop look
        const simpleStyle = styleOnlyVf(opts, true);
        const vfSimple = [
          `scale=-2:${Math.min(th, 1080)}:flags=lanczos`,
          "setsar=1",
          simpleStyle,
        ]
          .filter(Boolean)
          .join(",");
        onUpdate({
          log:
            "Retry styl (uproszczony, bez deshake/aspect): " +
            (opts.videoStyle || "?") +
            " · " +
            vfSimple.slice(0, 100),
        });
        const r3 = await runAsync(
          ffmpeg,
          [
            "-y",
            "-threads",
            "0",
            "-i",
            srcVid,
            "-vf",
            vfSimple,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            outF,
          ],
          {
            timeoutMs: 6 * 60 * 1000,
            onTick: () => {
              tickP = Math.min(68, tickP + 1);
              setP(tickP, stageLabel, "retry styl…");
            },
          }
        );
        if (r3.status !== 0 || !fs.existsSync(outF)) {
          // Last resort: plain HD only
          onUpdate({
            log:
              "Styl FFmpeg padł nawet w trybie prostym — HD bez stylu. " +
              String(r3.stderr || r2.stderr || r.stderr || "")
                .replace(/\s+/g, " ")
                .slice(-140),
          });
          const r4 = await runAsync(
            ffmpeg,
            [
              "-y",
              "-threads",
              "0",
              "-i",
              srcVid,
              "-vf",
              `scale=-2:${Math.min(th, 1080)}:flags=lanczos,eq=contrast=1.06:saturation=1.08,unsharp=5:5:0.6:5:5:0.0`,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "18",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-b:a",
              "160k",
              "-movflags",
              "+faststart",
              outF,
            ],
            {
              timeoutMs: 6 * 60 * 1000,
              onTick: () => {
                tickP = Math.min(68, tickP + 1);
                setP(tickP, stageLabel, "retry HD…");
              },
            }
          );
          if (r4.status !== 0 || !fs.existsSync(outF)) {
            throw new Error(
              "Poprawa wideo HD: " +
                (r.stderr || r2.stderr || r3.stderr || r4.stderr || "").slice(
                  -300
                )
            );
          }
        } else {
          onUpdate({
            log: "Styl obrazu OK (tryb uproszczony · " + (opts.videoStyle || "") + ")",
          });
        }
      } else {
        onUpdate({ log: "Styl/kadr OK (bez stabilizacji)" });
      }
    }
    currentVideo = outF;
    videoAlreadyFinal = true;
    if (stages.find((s) => s.id === "fast")) setStage("fast", "done");
    setP(72, stageLabel, `OK · ${th}p`);
    onUpdate({ log: `Poprawa wideo gotowa → ${th}p (${preset}/crf${crf})` });
  }

  // After AI upscale path: apply style / aspect / speed if requested
  if (
    !opts.narratorOnly &&
    opts.upscale === "ai" &&
    videoAlreadyFinal &&
    needsCreativeVideoFx(opts) &&
    currentVideo
  ) {
    const th = Number(opts.targetHeight) || 1080;
    const creative = creativeVideoFilters(opts, th, info.duration || 0);
    if (creative.vf.length || creative.afExtra.length || Number(opts.maxDurationSec) > 0) {
      setP(73, "Styl / kadr wideo", "po AI…");
      const outFx = path.join(work, "02_ai_fx.mp4");
      const vf = creative.vf.filter(Boolean).join(",") || "null";
      const afChain = creative.afExtra.length
        ? creative.afExtra.join(",")
        : null;
      const fxArgs = [
        "-y",
        "-threads",
        "0",
        "-i",
        currentVideo,
        ...(vf !== "null" ? ["-vf", vf] : []),
        ...(afChain ? ["-af", afChain] : []),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        String(opts.crf != null ? Number(opts.crf) : 16),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        `${audioBitrateK(opts)}k`,
        "-movflags",
        "+faststart",
      ];
      if (Number(opts.maxDurationSec) > 0) {
        fxArgs.push("-t", String(Number(opts.maxDurationSec)));
      }
      fxArgs.push(outFx);
      onUpdate({
        log: `Po AI: style/aspect/speed (${vf.slice(0, 90)}…)`,
      });
      let rx = await runAsync(ffmpeg, fxArgs, {
        timeoutMs: 20 * 60 * 1000,
        onTick: () => setP(Math.min(76, progress + 1), "Styl / kadr wideo", "…"),
      });
      if (
        (rx.status !== 0 || !fs.existsSync(outFx)) &&
        opts.stabilize &&
        opts.stabilize !== "off"
      ) {
        onUpdate({
          log:
            "Styl po AI + deshake fail — retry bez stabilizacji: " +
            String(rx.stderr || "")
              .replace(/\s+/g, " ")
              .slice(-120),
        });
        const c2 = creativeVideoFilters(
          { ...opts, stabilize: "off" },
          th,
          info.duration || 0
        );
        const vf2 = c2.vf.filter(Boolean).join(",") || "null";
        const fx2 = [
          "-y",
          "-threads",
          "0",
          "-i",
          currentVideo,
          ...(vf2 !== "null" ? ["-vf", vf2] : []),
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          String(opts.crf != null ? Number(opts.crf) : 16),
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          `${audioBitrateK(opts)}k`,
          "-movflags",
          "+faststart",
          outFx,
        ];
        rx = await runAsync(ffmpeg, fx2, {
          timeoutMs: 20 * 60 * 1000,
          onTick: () =>
            setP(Math.min(76, progress + 1), "Styl / kadr wideo", "retry…"),
        });
      }
      if (rx.status === 0 && fs.existsSync(outFx)) {
        currentVideo = outFx;
        onUpdate({ log: "Styl/kadr po AI: OK" });
      } else if (
        opts.videoStyle &&
        opts.videoStyle !== "off" &&
        styleOnlyVf(opts, true)
      ) {
        // Keep style even when full creative chain fails after AI
        const vfS = styleOnlyVf(opts, true);
        onUpdate({
          log: "Styl po AI — retry tylko styl (prosty): " + vfS.slice(0, 90),
        });
        const rs = await runAsync(
          ffmpeg,
          [
            "-y",
            "-threads",
            "0",
            "-i",
            currentVideo,
            "-vf",
            vfS,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            outFx,
          ],
          { timeoutMs: 12 * 60 * 1000 }
        );
        if (rs.status === 0 && fs.existsSync(outFx)) {
          currentVideo = outFx;
          onUpdate({ log: "Styl po AI: OK (prosty)" });
        } else {
          onUpdate({
            log:
              "Styl po AI pominięty: " +
              String(rx.stderr || rs.stderr || "")
                .replace(/\s+/g, " ")
                .slice(-160),
          });
        }
      } else {
        onUpdate({
          log:
            "Styl po AI pominięty: " +
            String(rx.stderr || "")
              .replace(/\s+/g, " ")
              .slice(-160),
        });
      }
      setP(76, "Styl / kadr wideo", "OK");
    }
  }

  if (!opts.narratorOnly && (opts.upscale === "off" || !opts.upscale)) {
    if (
      stages.find((s) => s.id === "encode") ||
      opts.polish !== false ||
      needsCreativeVideoFx(opts)
    ) {
      if (stages.find((s) => s.id === "encode")) setStage("encode", "active");
      // always re-encode with polish if still on raw or only delogo
      const needsPolish =
        opts.polish !== false ||
        (opts.qualityPreset && opts.qualityPreset !== "off") ||
        needsCreativeVideoFx(opts);
      if (needsPolish) {
        const outE = path.join(work, "02_enc.mp4");
        const th = Number(opts.targetHeight) || 1080;
        const creative = creativeVideoFilters(
          opts,
          th,
          info.duration || 0
        );
        const vfParts = [];
        if (!creative.usedAspect && opts.upscale !== "off") {
          /* keep original size when upscale off */
        } else if (creative.usedAspect) {
          /* aspect already scales */
        }
        vfParts.push(...polishFilters(opts));
        vfParts.push(...creative.vf);
        const vf = vfParts.filter(Boolean).join(",") || "null";
        const afChain = creative.afExtra.length
          ? creative.afExtra.join(",")
          : null;
        onUpdate({
          log: `Kodowanie z poprawą obrazu (${vf.slice(0, 100)}…)`,
        });
        const encArgs = [
          "-y",
          "-threads",
          "0",
          "-i",
          currentVideo,
          ...(vf !== "null" ? ["-vf", vf] : []),
          ...(afChain ? ["-af", afChain] : []),
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          String(opts.crf != null ? Math.min(20, Number(opts.crf)) : 17),
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          `${audioBitrateK(opts)}k`,
          "-movflags",
          "+faststart",
        ];
        if (Number(opts.maxDurationSec) > 0) {
          encArgs.push("-t", String(Number(opts.maxDurationSec)));
        }
        encArgs.push(outE);
        const r = await runAsync(ffmpeg, encArgs, {
          timeoutMs: 8 * 60 * 1000,
          onTick: () =>
            setP(Math.min(68, progress + 1), "Kodowanie obrazu", "polish…"),
        });
        if (r.status === 0 && fs.existsSync(outE)) {
          currentVideo = outE;
          videoAlreadyFinal = true;
        } else {
          onUpdate({
            log: "Polish encode fail: " + (r.stderr || "").slice(-120),
          });
        }
      }
      if (stages.find((s) => s.id === "encode")) setStage("encode", "done");
      setP(70, "Kodowanie obrazu", "OK");
    }
  }

  // --- narrator / STT AFTER video improve (STT must not block delogo/HD) ---
  let voiceWav = null;
  let script = "";
  let langMeta = null;
  if (opts.narrator || opts.subtitles) {
    if (opts.narrator) setStage("narrator", "active");
    setP(78, "Język / lektor", "transkrypcja + tłumaczenie…");
    onUpdate({ log: "Wideo poprawione — start transkrypcji / lektora…" });
    // Prefer original audio path for STT (cleaner speech than re-encoded)
    opts.videoPath = job.inputPath;
    opts.inputPath = job.inputPath;
    let prep = null;
    try {
      prep = await resolveNarratorScript(opts, (patch) => {
        if (patch.livePhase === "extracting") setStage("stt", "active");
        if (patch.livePhase === "source" || patch.livePhase === "translating") {
          setStage("stt", "done");
          setStage("translate", "active");
        }
        if (patch.livePhase === "done") {
          setStage("stt", "done");
          setStage("translate", "done");
        }
        onUpdate(patch);
      });
    } catch (e) {
      onUpdate({
        log: "Lektor ostrzeżenie: " + (e && e.message ? e.message : e),
      });
    }
    if (!prep) {
      prep = await resolveNarratorScript(opts, onUpdate);
    }
    script = prep.script;
    // Only disable narrator for exact-translate when there is truly no usable text
    // Describe mode must keep lektor (toSituationScript builds monologue).
    const nMode = opts.narratorMode === "describe" ? "describe" : "translate";
    if (
      nMode === "translate" &&
      prep.stt &&
      prep.stt.musicLikely &&
      opts.narrator &&
      !opts.fromYoutubeCaptions &&
      (!script || isJunkText(script) || String(script).trim().length < 40)
    ) {
      opts.narrator = false;
      onUpdate({
        log:
          "Słaba transkrypcja STT — lektor w trybie tłumaczenia wyłączony. " +
          "Wybierz «Weź napisy z filmu», wklej tekst, albo tryb «Opis sytuacji» (układa własny monolog).",
      });
    } else if (nMode === "describe" && script && String(script).trim().length >= 20) {
      const dSec = Number(opts.durationSec) || 0;
      const st = String(opts.describeStyle || prep.describeStyle || "neutral");
      onUpdate({
        log:
          "Opis sytuacji gotowy (" +
          String(script).trim().length +
          " znaków" +
          (dSec > 0 ? ` · cel pod ~${Math.round(dSec)}s filmu` : "") +
          ` · styl: ${st}` +
          ") — lektor / napisy z tego tekstu.",
        livePhase: "done",
        liveScript: String(script).slice(0, 600),
      });
    }
    langMeta = {
      detected: prep.detected,
      sourceLang: prep.sourceLang || null,
      targetLang: prep.targetLang || {
        code: opts.targetLang || "pl",
      },
      mode: prep.mode || null,
      modeLabel: prep.modeLabel || null,
      translated: prep.translated,
      original: prep.original || prep.stt?.partial?.join?.(" ") || null,
      engine: prep.engine || null,
      translateError: prep.translateError || null,
      sttSegments:
        prep.stt && Array.isArray(prep.stt.timelineSegments) && prep.stt.timelineSegments.length
          ? prep.stt.timelineSegments
          : prep.stt && Array.isArray(prep.stt.segments)
            ? prep.stt.segments
            : [],
      model: prep.model
        ? {
            id: prep.model.modelId,
            name: prep.model.modelName,
            nmt: prep.model.nmt,
            code: prep.model.code,
            target: prep.model.target || opts.targetLang || "pl",
          }
        : null,
    };
  }
  if (opts.narrator) {
    const tgtCode = opts.targetLang || "pl";
    setP(86, "Lektor", `Tłumaczenie/tekst OK · generuję głos (${tgtCode})…`);
    if (!script || isJunkText(script)) {
      const fb = titleFromFilename(job.originalName);
      script =
        fb ||
        "Oglądasz krótki filmik. Spójrz uważnie — zaraz zobaczysz, o co chodzi.";
      onUpdate({ log: "Lektor: używam tekstu zapasowego / z nazwy pliku" });
    }
    const videoDurForTts =
      (info && info.duration) ||
      durationSec ||
      probe(ffmpeg, job.inputPath).duration ||
      0;
    // Timed cues 1:1 with STT segments (same count as transcription)
    let timedForTts = null;
    const sttSegs =
      langMeta && Array.isArray(langMeta.sttSegments)
        ? langMeta.sttSegments.filter(
            (s) => s && (String(s.text || "").trim() || s.end > s.start)
          )
        : [];
    // Prefer segments already on script (user timed transcript / STT / captions)
    // Also re-parse script if it still has [time] markers
    const fromScriptTimed = parseTimedTranscriptText(script);
    if (fromScriptTimed.length >= 1 && opts.timedTranscript !== false) {
      timedForTts = fromScriptTimed.map((s, i) => ({
        start: Number(s.start) || 0,
        end: Math.max(Number(s.end) || 0, (Number(s.start) || 0) + 0.5),
        text: String(s.text || "").trim(),
        silent: !String(s.text || "").trim(),
        sttIndex: i,
      }));
      // Speak plain line text only (never read "[00:00→…]")
      script = timedForTts
        .map((s) => s.text)
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      onUpdate({
        log: `Lektor = transkrypcja z pola · ${timedForTts.length} okien z czasem · film ${Math.round(videoDurForTts)}s`,
      });
    } else if (sttSegs.length && opts.timedTranscript !== false) {
      if (langMeta.translated && langMeta.original) {
        timedForTts = mapTranslatedOntoSegments(
          langMeta.original,
          script,
          sttSegs
        );
      } else {
        // Same language: use STT text 1:1 (every word including single-word windows)
        timedForTts = sttSegs.map((s, i) => ({
          start: Number(s.start) || 0,
          end: Math.max(Number(s.end) || 0, (Number(s.start) || 0) + 0.5),
          text: String(s.text || "").trim(),
          silent: !String(s.text || "").trim(),
          sttIndex: i,
        }));
        // If prep.script cleaned/joined differs, re-map ALL script words onto same N slots
        const joined = timedForTts
          .map((s) => s.text)
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const scriptNorm = String(script || "").replace(/\s+/g, " ").trim();
        if (
          scriptNorm &&
          joined &&
          scriptNorm.length > joined.length * 1.05
        ) {
          // script has more text than raw STT join — redistribute full script 1:1
          timedForTts = mapTranslatedOntoSegments(joined, scriptNorm, sttSegs);
        }
      }
      onUpdate({
        log: `Lektor = STT/transkrypcja 1:1 · ${sttSegs.length} segmentów → ${
          timedForTts ? timedForTts.length : 0
        } okien TTS · film ${Math.round(videoDurForTts)}s`,
      });
    } else {
      // Plain continuous script (timed option off or no clocks)
      if (opts.timedTranscript === false) {
        script = stripTimedTranscriptMarkers(script);
      }
      onUpdate({
        log: `Lektor TTS (${
          opts.timedTranscript === false
            ? "transkrypcja z czasem wyłączona → ciągły"
            : "brak znaczników czasu → co 6s"
        }): ${String(script).length} znaków · film ${Math.round(videoDurForTts)}s · ${tgtCode}`,
      });
    }
    // Tempo tekstu / lektora: auto (fit video) or manual 0.5–2.0 × 0.1
    let speechRate = 1;
    try {
      const { resolveSpeechRate, clampSpeechRate } = require("./lang-utils");
      speechRate = resolveSpeechRate(opts, script, videoDurForTts);
      speechRate = clampSpeechRate(speechRate);
    } catch {
      speechRate = 1;
    }
    const speedMode =
      String(opts.textSpeedMode || "auto").toLowerCase() === "manual"
        ? "manual"
        : "auto";
    onUpdate({
      log:
        "Tempo lektora: " +
        speechRate.toFixed(1) +
        "× (" +
        (speedMode === "auto"
          ? "auto — dopasowanie do czasu filmu"
          : "ręcznie") +
        ")",
    });
    setP(
      86,
      "Lektor",
      "TTS " + speechRate.toFixed(1) + "× · na osi czasu…"
    );
    voiceWav = path.join(work, "lektor.wav");
    const onTtsSeg = (info) => {
      if (info.phase === "error") {
        onUpdate({ log: "TTS segment błąd: " + (info.message || "") });
        return;
      }
      const n = Math.max(1, info.total || 1);
      const i = info.index || 0;
      const t = (i + (info.phase === "done" ? 1 : 0.4)) / n;
      const progress = Math.round(86 + t * 5); // 86 → 91
      const t0 =
        info.start != null ? Number(info.start).toFixed(0) : "?";
      const t1 = info.end != null ? Number(info.end).toFixed(0) : "?";
      if (info.phase === "start") {
        setP(progress, "Lektor", `TTS ${i + 1}/${n} · ${t0}–${t1}s…`);
        onUpdate({
          log: `TTS segment ${i + 1}/${n} (${t0}–${t1}s): ${(info.preview || "").slice(0, 70)}`,
          liveScript: `… lektor ${i + 1}/${n} (${t0}–${t1}s) …`,
        });
      } else if (info.phase === "done") {
        setP(
          progress,
          "Lektor",
          info.skipped
            ? `TTS ${i + 1}/${n} pominięty`
            : `TTS ${i + 1}/${n} OK (${info.pct || 0}%)`
        );
        onUpdate({
          log: `TTS segment ${i + 1}/${n} ${info.skipped ? "pominięty" : "OK"}`,
        });
      }
    };
    try {
      const ttsRes = generateNarratorWav(
        script,
        opts.narratorVoice || "paulina",
        voiceWav,
        speechRate,
        tgtCode,
        onTtsSeg,
        videoDurForTts,
        timedForTts,
        {
          textSpeedMode: "manual",
          speechRate,
          textSpeed: speechRate,
        }
      );
      voiceWav = ttsRes && ttsRes.path ? ttsRes.path : ttsRes;
      const nSeg = ttsRes && ttsRes.segments ? ttsRes.segments : 1;
      const usedRate =
        ttsRes && ttsRes.speechRate != null ? ttsRes.speechRate : speechRate;
      setStage("narrator", "done");
      setP(
        91,
        "Lektor",
        `TTS gotowy · ${usedRate.toFixed(1)}× · ${nSeg} okien · ` +
          String(script).slice(0, 36)
      );
      onUpdate({
        log: `TTS na osi czasu OK (${ttsRes && ttsRes.engine ? ttsRes.engine : "tts"} · tempo ${usedRate.toFixed(1)}× · ${nSeg} okien · film ${Math.round(videoDurForTts)}s)`,
      });
    } catch (ttsErr) {
      onUpdate({
        log: "TTS błąd, próbuję bez osi czasu: " + (ttsErr.message || ttsErr),
      });
      try {
        const ttsRes = generateNarratorWav(
          script,
          opts.narratorVoice || "paulina",
          voiceWav,
          speechRate,
          tgtCode,
          onTtsSeg,
          0,
          null,
          {
            textSpeedMode: "manual",
            speechRate,
            textSpeed: speechRate,
          }
        );
        voiceWav = ttsRes && ttsRes.path ? ttsRes.path : ttsRes;
        setStage("narrator", "done");
        setP(91, "Lektor", "TTS OK (ciągły) · " + String(script).slice(0, 50));
      } catch (e2) {
        onUpdate({
          log: "TTS całkowicie padł — kontynuuję BEZ lektora: " + (e2.message || e2),
        });
        voiceWav = null;
        setStage("narrator", "done");
        setP(91, "Lektor", "pominięty (błąd TTS)");
      }
    }
  }

  // --- timed transcription / SRT (always when we have text — not only with burn-in) ---
  let srtPath = null;
  let timedScriptText = null;
  let timedOriginalText = null;
  let timedCuesForResult = null;
  {
    const text = script || opts.subtitleText || "";
    const videoDurForSubs =
      (info && info.duration) || durationSec || 30;
    const timedSegs =
      langMeta && Array.isArray(langMeta.sttSegments)
        ? langMeta.sttSegments
        : [];
    // Source-language timed transcription (STT / captions windows as-is)
    timedOriginalText =
      formatTimedTranscript(timedSegs) ||
      (langMeta && langMeta.original) ||
      null;
    // Target script mapped onto the same clocks
    let segsForSrt = null;
    if (text) {
      segsForSrt = buildTimedScriptSegments(
        text,
        videoDurForSubs,
        timedSegs,
        (langMeta && langMeta.original) || "",
        !!(langMeta && langMeta.translated)
      );
      timedScriptText = formatTimedTranscript(segsForSrt) || text;
      timedCuesForResult = Array.isArray(segsForSrt)
        ? segsForSrt
            .filter((s) => s && String(s.text || "").trim())
            .map((s) => ({
              start: Number(s.start) || 0,
              end: Math.max(
                Number(s.end) || 0,
                (Number(s.start) || 0) + 0.3
              ),
              text: String(s.text || "").trim(),
            }))
        : null;
    }

    // Always write SRT when we have text (transcript with times for download / burn)
    const wantSrt =
      !!text &&
      (opts.subtitles ||
        opts.narrator ||
        timedSegs.length > 0 ||
        String(text).trim().length >= 8);
    if (wantSrt && text) {
      if (opts.subtitles) setStage("subs", "active");
      const tgtCode = opts.targetLang || "pl";
      setP(
        92,
        opts.subtitles ? "Napisy" : "Transkrypcja",
        `Zapis SRT z czasem (${tgtCode})…`
      );
      srtPath = path.join(work, "subs.srt");
      const written = writeSrtFromScript(
        text,
        videoDurForSubs,
        srtPath,
        segsForSrt && segsForSrt.length ? segsForSrt : null
      );
      if (written && written.cues) {
        timedCuesForResult = written.cues.map((c) => ({
          start: c.start,
          end: c.end,
          text: c.text,
        }));
        timedScriptText =
          formatTimedTranscript(written.cues) || timedScriptText || text;
        onUpdate({
          log: `Transkrypcja z czasem: ${written.cues.length} segmentów → SRT`,
          liveScript:
            timedScriptText.split("\n").slice(0, 12).join("\n") +
            (written.cues.length > 12 ? "\n…" : ""),
          liveOriginal:
            timedOriginalText ||
            (langMeta && langMeta.original) ||
            undefined,
        });
      }
      if (!written) srtPath = null;
      else srtPath = written.path || srtPath;

      // Also save plain timed .txt next to work (copied with SRT later)
      if (timedScriptText && srtPath) {
        try {
          const txtPath = path.join(work, "transcript_timed.txt");
          const body =
            (timedOriginalText
              ? "— oryginał (z czasem) —\n" +
                timedOriginalText +
                "\n\n"
              : "") +
            "— docelowy (z czasem) —\n" +
            timedScriptText +
            "\n";
          fs.writeFileSync(txtPath, body, "utf8");
        } catch {
          /* ignore */
        }
      }
      if (opts.subtitles) setStage("subs", "done");
    } else if (opts.subtitles) {
      setStage("subs", "done");
    }
  }

  // --- final mix ---
  setStage("mix", "active");
  setP(93, "Mikser audio + final", "Finalizacja…");
  const outName = `studio_${job.id}.mp4`;
  const outFile = path.join(OUTPUT_DIR, outName);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const burnSubs =
    opts.subtitles && srtPath && opts.burnSubtitles !== false;
  // SPEED: copy video stream when already HD-encoded and no burn-in
  const canCopyVideo = videoAlreadyFinal && !burnSubs;

  const finalArgs = ["-y", "-threads", "0", "-i", currentVideo];
  let filterComplex = null;
  let maps = ["-map", "0:v:0"];

  // Full video length is master — never cut video to short TTS via -shortest
  let videoDur =
    (info && info.duration) ||
    probe(ffmpeg, currentVideo).duration ||
    0;
  // If encode already applied speed/max-duration, prefer probed output length
  try {
    const pout = probe(ffmpeg, currentVideo);
    if (pout && pout.duration > 0.5) videoDur = pout.duration;
  } catch {
    /* keep */
  }
  if (Number(opts.maxDurationSec) > 0) {
    videoDur = Math.min(videoDur, Number(opts.maxDurationSec));
  }
  const spd = Number(opts.playbackSpeed) || 1;
  if (spd > 0.02 && Math.abs(spd - 1) >= 0.02) {
    // If speed was already applied in 02_fast, duration is already shortened;
    // only adjust if still on original duration heuristic
    /* probed duration above should be correct after creative pass */
  }
  const durStr =
    videoDur > 0 ? Number(videoDur).toFixed(3) : null;
  // When canCopyVideo false and creative not applied yet, rare — skip

  // Don't stream-copy if creative FX were requested but path skipped them
  const canCopyVideoSafe =
    canCopyVideo &&
    !(
      needsCreativeVideoFx(opts) &&
      !/02_(fast|enc|ai_fx)\.mp4$/i.test(String(currentVideo || ""))
    );

  const aBitrate = audioBitrateK(opts);
  // Safer enhance for final mix: skip heavy acompressor (breaks some amix builds)
  const mixEnhanceOpts = {
    ...opts,
    audioNormalize: false,
  };
  let bgEnhance = buildAudioEnhanceChain(mixEnhanceOpts, "bg");
  // Keep chain short for mux stability (afftdn + volume is enough at mix)
  if (bgEnhance && bgEnhance.split(",").length > 4) {
    const bits = bgEnhance.split(",").filter((p) => !p.startsWith("acompressor"));
    bgEnhance = bits.slice(0, 4).join(",");
  }

  if (voiceWav) {
    finalArgs.push("-i", voiceWav);
    // Pad narrator to full video length. NO loudnorm (too slow, freezes UI at 93%).
    // Classic simple mix first — most reliable on PC agent ffmpeg-static
    const pad =
      durStr != null ? `apad=whole_dur=${durStr}` : "apad";
    const bgVol = opts.bgVolume != null ? opts.bgVolume : 0.12;
    const voiceVol = opts.voiceVolume != null ? opts.voiceVolume : 1.85;
    // aformat first so adelay/amix always see stereo
    const bgParts = [
      "aformat=sample_rates=48000:channel_layouts=stereo",
      bgEnhance && bgEnhance !== "anull" ? bgEnhance : null,
      `volume=${bgVol}`,
    ].filter(Boolean);
    const voiceParts = [
      "aformat=sample_rates=48000:channel_layouts=stereo",
      "adelay=400|400",
      `volume=${voiceVol}`,
      pad,
    ];
    filterComplex =
      `[0:a]${bgParts.join(",")}[bg];` +
      `[1:a]${voiceParts.join(",")}[voice];` +
      "[bg][voice]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]";
    maps = ["-map", "0:v:0", "-map", "[aout]"];
    if (bgEnhance) {
      onUpdate({
        log: `Audio enhance (tło, mix-safe): ${bgEnhance.slice(0, 100)} · AAC ${aBitrate}k`,
      });
    }
  } else if (bgEnhance) {
    // No narrator — enhance original audio only
    filterComplex = `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,${bgEnhance}[aout]`;
    maps = ["-map", "0:v:0", "-map", "[aout]"];
    onUpdate({
      log: `Audio enhance: ${bgEnhance.slice(0, 140)}${bgEnhance.length > 140 ? "…" : ""} · AAC ${aBitrate}k`,
    });
  } else {
    maps = ["-map", "0:v:0", "-map", "0:a?"];
  }

  const vfParts = [];
  if (burnSubs) {
    const esc = srtPath
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    vfParts.push(
      `subtitles='${esc}':force_style='FontSize=18,PrimaryColour=&H00FFFFFF,Outline=2'`
    );
  }

  if (filterComplex) finalArgs.push("-filter_complex", filterComplex);
  if (vfParts.length) finalArgs.push("-vf", vfParts.join(","));
  finalArgs.push(...maps);

  // -t locks output to full video duration (not short voice track)
  if (durStr) {
    finalArgs.push("-t", durStr);
  }

  // Prefer ultrafast audio encode — final must not hang for minutes
  const audioEncode = [
    "-c:a",
    "aac",
    "-b:a",
    `${aBitrate}k`,
    "-ac",
    "2",
    "-ar",
    "48000",
  ];

  if (canCopyVideoSafe) {
    onUpdate({
      log:
        "Final: mux wideo+lektor" +
        (durStr ? ` (${durStr}s)` : "") +
        "…",
    });
    setP(94, "Mikser audio + final", "mux…");
    finalArgs.push("-c:v", "copy", ...audioEncode, "-movflags", "+faststart", outFile);
  } else {
    setP(94, "Mikser audio + final", "encode…");
    finalArgs.push(
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      ...audioEncode,
      "-movflags",
      "+faststart",
      outFile
    );
  }

  // Async ffmpeg with progress ticks (spawnSync freezes % bar)
  // Max 3 min — then emergency copy so UI never freezes forever at 93%
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, finalArgs, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let settled = false;
    let muxTick = 94;
    const tick = setInterval(() => {
      muxTick = Math.min(97, muxTick + 1);
      setP(muxTick, "Mikser audio + final", "mux w toku…");
    }, 2500);
    const killAndFallback = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      try {
        if (child.pid) {
          spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
            windowsHide: true,
          });
        }
      } catch {
        /* ignore */
      }
    };
    const killTimer = setTimeout(() => {
      if (settled) return;
      onUpdate({ log: "Final mux timeout 3 min — fallback…" });
      killAndFallback();
    }, 3 * 60 * 1000);

    let errBuf = "";
    if (child.stderr) {
      child.stderr.on("data", (b) => {
        errBuf += b.toString();
        if (errBuf.length > 8000) errBuf = errBuf.slice(-4000);
      });
    }
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      clearTimeout(killTimer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      clearTimeout(killTimer);
      if (code === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
        resolve();
        return;
      }
      onUpdate({
        log:
          "Final mux błąd (kod " +
          code +
          "): " +
          (errBuf || "").replace(/\s+/g, " ").slice(-220),
      });
      // retry without burn-in / without complex filters
      if (opts.subtitles && vfParts.length) {
        onUpdate({ log: "Retry final bez burn-in napisów…" });
        const args2 = finalArgs.filter((a, i, arr) => {
          if (a === "-vf") return false;
          if (arr[i - 1] === "-vf") return false;
          return true;
        });
        const r2 = run(ffmpeg, args2);
        if (r2.status === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
          resolve();
          return;
        }
      }
      // retry: simple lektor mix WITHOUT audio enhance (most reliable)
      if (voiceWav && fs.existsSync(voiceWav)) {
        onUpdate({ log: "Retry final: prosty mix lektora (bez audio-enhance)…" });
        const pad =
          durStr != null ? `apad=whole_dur=${durStr}` : "apad";
        const simpleFc =
          `[0:a]volume=${opts.bgVolume != null ? opts.bgVolume : 0.12},aformat=sample_rates=48000:channel_layouts=stereo[bg];` +
          `[1:a]adelay=400|400,volume=${opts.voiceVolume != null ? opts.voiceVolume : 1.85},aformat=sample_rates=48000:channel_layouts=stereo,${pad}[voice];` +
          "[bg][voice]amix=inputs=2:duration=first:dropout_transition=2[aout]";
        const simpleArgs = [
          "-y",
          "-threads",
          "0",
          "-i",
          currentVideo,
          "-i",
          voiceWav,
          "-filter_complex",
          simpleFc,
          "-map",
          "0:v:0",
          "-map",
          "[aout]",
          ...(durStr ? ["-t", durStr] : []),
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          `${aBitrate}k`,
          "-ac",
          "2",
          "-ar",
          "48000",
          "-movflags",
          "+faststart",
          outFile,
        ];
        const r3 = run(ffmpeg, simpleArgs);
        if (r3.status === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
          resolve();
          return;
        }
        onUpdate({
          log:
            "Prosty mix też padł: " +
            String(r3.stderr || "")
              .replace(/\s+/g, " ")
              .slice(-160),
        });
      }
      // last resort: copy video only, no voice
      onUpdate({ log: "Final awaryjny: tylko wideo (bez lektora w mux)" });
      const emergency = run(ffmpeg, [
        "-y",
        "-i",
        currentVideo,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outFile,
      ]);
      if (emergency.status === 0 && fs.existsSync(outFile)) {
        resolve();
        return;
      }
      reject(
        new Error(
          "Final mux failed (kod " + code + "): " + errBuf.slice(-400)
        )
      );
    });
  });
  setP(98, "Mikser audio + final", "mux OK");

  // copy soft srt + timed transcript next to output
  let srtOutPath = null;
  let timedTxtOutPath = null;
  if (srtPath && fs.existsSync(srtPath)) {
    srtOutPath = path.join(OUTPUT_DIR, `studio_${job.id}.srt`);
    fs.copyFileSync(srtPath, srtOutPath);
  }
  const workTimedTxt = path.join(work, "transcript_timed.txt");
  if (fs.existsSync(workTimedTxt)) {
    timedTxtOutPath = path.join(OUTPUT_DIR, `studio_${job.id}_transcript.txt`);
    try {
      fs.copyFileSync(workTimedTxt, timedTxtOutPath);
    } catch {
      timedTxtOutPath = null;
    }
  } else if (timedScriptText || timedOriginalText) {
    timedTxtOutPath = path.join(OUTPUT_DIR, `studio_${job.id}_transcript.txt`);
    try {
      const body =
        (timedOriginalText
          ? "— oryginał (z czasem) —\n" + timedOriginalText + "\n\n"
          : "") +
        (timedScriptText
          ? "— docelowy (z czasem) —\n" + timedScriptText + "\n"
          : script
            ? "— tekst —\n" + script + "\n"
            : "");
      fs.writeFileSync(timedTxtOutPath, body, "utf8");
    } catch {
      timedTxtOutPath = null;
    }
  }

  // preview frame
  const preview = path.join(OUTPUT_DIR, `studio_${job.id}_preview.jpg`);
  run(ffmpeg, [
    "-y",
    "-ss",
    "2",
    "-i",
    outFile,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    preview,
  ]);

  const after = probe(ffmpeg, outFile);
  const mb = (fs.statSync(outFile).size / 1e6).toFixed(1);

  job.outputPath = outFile;
  job.previewPath = fs.existsSync(preview) ? preview : null;
  try {
    clearInterval(heart);
  } catch {
    /* ignore */
  }
  // Prefer timed transcription in result.script when we have clocks
  const resultScript =
    timedScriptText && timedScriptText.includes("[")
      ? timedScriptText
      : script || null;
  onUpdate({
    progress: 99,
    stage: "Gotowe",
    result: {
      width: after.width,
      height: after.height,
      duration: after.duration,
      mb: Number(mb),
      fps: useFps,
      output: outName,
      hasNarrator: !!opts.narrator && !!voiceWav,
      hasSubtitles: !!opts.subtitles,
      /** Plain continuous target text (for TTS re-use / share) */
      scriptPlain: script || null,
      /** Timed transcription (target language) — preferred display */
      script: resultScript,
      timedScript: timedScriptText || null,
      timedOriginal: timedOriginalText || null,
      timedCues: timedCuesForResult || null,
      srtPath: srtOutPath || null,
      transcriptPath: timedTxtOutPath || null,
      targetLang: opts.targetLang || "pl",
      language: langMeta
        ? {
            ...langMeta,
            timedOriginal: timedOriginalText || null,
            timedScript: timedScriptText || null,
          }
        : null,
    },
    log:
      `Zapisano ${mb} MB  ${after.width}x${after.height}` +
      (srtOutPath
        ? ` · SRT ${timedCuesForResult ? timedCuesForResult.length : "?"} segmentów z czasem`
        : ""),
  });

  setStage("mix", "done");

  // cleanup work dir to save disk
  try {
    rmrf(work);
  } catch {
    /* keep on fail */
  }

  return job;
  } finally {
    try {
      if (heart) clearInterval(heart);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  runPipeline,
  findRealEsrgan,
  resolveEsrganModel,
  ESRGAN_MODELS,
  ffmpegPath,
};
