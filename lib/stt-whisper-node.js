/**
 * Local Whisper STT via @xenova/transformers (no Python required).
 * Separate from Google STT and Ollama rewrite.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const os = require("os");

const MODEL_MAP = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
  medium: "Xenova/whisper-base", // medium too heavy in browsers/node — map to base
};

let _pipelinePromise = null;
let _pipelineModelId = null;

function ffmpegBin(opts) {
  if (opts && opts.ffmpeg) return opts.ffmpeg;
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return "ffmpeg";
}

function extractWav(videoPath, outWav, opts = {}) {
  const ff = ffmpegBin(opts);
  const maxSec = Math.max(0, Number(opts.maxSeconds) || 0);
  const startSec = Math.max(0, Number(opts.startSec) || 0);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (startSec > 0.05) args.push("-ss", String(startSec));
  args.push("-i", videoPath);
  if (maxSec > 0.5) args.push("-t", String(maxSec));
  args.push(
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outWav
  );
  const r = spawnSync(ff, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: Math.max(120000, maxSec * 2000 + 60000),
    maxBuffer: 8 * 1024 * 1024,
  });
  if ((r.status || 0) !== 0 || !fs.existsSync(outWav) || fs.statSync(outWav).size < 1000) {
    const err = String(r.stderr || r.stdout || r.error || "ffmpeg fail").slice(-400);
    throw new Error("Whisper Node: ffmpeg: " + err.replace(/\s+/g, " "));
  }
  return outWav;
}

function resolveModelId(name) {
  const key = String(name || process.env.WHISPER_MODEL || "base")
    .toLowerCase()
    .trim();
  return MODEL_MAP[key] || MODEL_MAP.base;
}

async function getTranscriber(modelName) {
  const modelId = resolveModelId(modelName);
  if (_pipelinePromise && _pipelineModelId === modelId) {
    return _pipelinePromise;
  }
  _pipelineModelId = modelId;
  _pipelinePromise = (async () => {
    let transformers;
    try {
      transformers = await import("@xenova/transformers");
    } catch (e) {
      throw new Error(
        "Brak @xenova/transformers — w folderze projektu: npm install @xenova/transformers (" +
          (e && e.message) +
          ")"
      );
    }
    const { pipeline, env } = transformers;
    // Cache models next to project
    try {
      const cacheDir = path.join(
        process.env.LOCALAPPDATA || os.homedir(),
        "ClipForge-Whisper"
      );
      fs.mkdirSync(cacheDir, { recursive: true });
      env.cacheDir = cacheDir;
      env.allowLocalModels = true;
    } catch {
      /* default cache */
    }
    return pipeline("automatic-speech-recognition", modelId, {
      quantized: true,
    });
  })();
  try {
    return await _pipelinePromise;
  } catch (e) {
    _pipelinePromise = null;
    _pipelineModelId = null;
    throw e;
  }
}

/**
 * @returns {Promise<{ok:boolean, engine?:string, error?:string, model?:string}>}
 */
async function probeWhisperNode() {
  try {
    require.resolve("@xenova/transformers");
    return {
      ok: true,
      engine: "transformers.js",
      model: resolveModelId(process.env.WHISPER_MODEL || "base"),
    };
  } catch {
    return {
      ok: false,
      error: "npm install @xenova/transformers",
      engine: null,
    };
  }
}

/**
 * Transcribe video with local Whisper (Node).
 * @returns {Promise<object>} same shape as stt-google / stt-whisper.py
 */
async function extractSpeechWhisperNode(videoPath, opts = {}) {
  const out = {
    text: "",
    engine: null,
    langCode: null,
    chunks: 0,
    error: null,
    partial: [],
    segments: [],
    audioDuration: 0,
    coverageStart: null,
    coverageEnd: null,
    attempted: 1,
    failed: 0,
    lockedLang: null,
  };
  if (!videoPath || !fs.existsSync(videoPath)) {
    out.error = "brak pliku wideo";
    out.failed = 1;
    return out;
  }
  const workDir =
    opts.workDir ||
    path.join(os.tmpdir(), "clipforge-whisper-node-" + Date.now());
  fs.mkdirSync(workDir, { recursive: true });
  const wav = path.join(workDir, "audio.wav");
  try {
    extractWav(videoPath, wav, opts);
  } catch (e) {
    out.error = e.message || String(e);
    out.failed = 1;
    return out;
  }

  try {
    const transcriber = await getTranscriber(opts.whisperModel);
    const lang =
      opts.sourceLang &&
      opts.sourceLang !== "auto" &&
      opts.sourceLang !== "unknown"
        ? String(opts.sourceLang).split("-")[0]
        : null;

    const result = await transcriber(wav, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      // language hint when known
      ...(lang ? { language: lang } : {}),
    });

    const startOff = Math.max(0, Number(opts.startSec) || 0);
    const chunks = result && result.chunks ? result.chunks : null;
    const segments = [];
    if (Array.isArray(chunks) && chunks.length) {
      for (const c of chunks) {
        const t = String(c.text || "").trim();
        if (!t) continue;
        const ts = c.timestamp || [0, 0];
        const s0 = Number(ts[0]) || 0;
        const s1 = Number(ts[1]) || s0 + 0.5;
        segments.push({
          start: s0 + startOff,
          end: Math.max(s0 + startOff + 0.15, s1 + startOff),
          text: t,
        });
      }
    }
    let text = String((result && result.text) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text && segments.length) {
      text = segments
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    out.text = text;
    out.segments = segments;
    out.partial = segments.map((s) => s.text);
    out.chunks = segments.length || (text ? 1 : 0);
    out.engine =
      "whisper-node:" +
      String(opts.whisperModel || process.env.WHISPER_MODEL || "base");
    out.langCode = lang || null;
    out.lockedLang = lang || null;
    if (segments.length) {
      out.coverageStart = segments[0].start;
      out.coverageEnd = segments[segments.length - 1].end;
      out.audioDuration = Math.max(
        0,
        out.coverageEnd - (startOff || 0)
      );
    }
    if (!text) {
      out.error = "Whisper Node: brak rozpoznanej mowy";
      out.failed = 1;
    }
    return out;
  } catch (e) {
    out.error = "Whisper Node: " + (e && e.message ? e.message : String(e));
    out.failed = 1;
    return out;
  }
}

module.exports = {
  extractSpeechWhisperNode,
  probeWhisperNode,
  resolveModelId,
};
