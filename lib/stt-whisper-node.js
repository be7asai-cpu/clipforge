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

/**
 * Load mono PCM wav as Float32Array for transformers.js (no AudioContext in Node).
 * @see https://huggingface.co/docs/transformers.js/guides/node-audio-processing
 */
function loadWavAsFloat32(wavPath) {
  const buf = fs.readFileSync(wavPath);
  // Prefer wavefile package when present
  try {
    const WaveFile = require("wavefile").WaveFile;
    const wav = new WaveFile(buf);
    wav.toBitDepth("32f");
    wav.toSampleRate(16000);
    let samples = wav.getSamples(false, Float32Array);
    if (Array.isArray(samples)) {
      // multi-channel → first channel
      samples = samples[0];
    }
    if (samples && samples.length) return { audio: samples, sample_rate: 16000 };
  } catch {
    /* manual PCM s16le parse */
  }
  // Manual RIFF parse for our ffmpeg output (pcm_s16le mono 16k)
  if (buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Whisper Node: nieprawidłowy WAV");
  }
  // find 'data' chunk
  let offset = 12;
  let dataStart = -1;
  let dataSize = 0;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let numChannels = 1;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      numChannels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataStart = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0) throw new Error("Whisper Node: brak chunk data w WAV");
  const samplesCount = Math.floor(dataSize / (bitsPerSample / 8) / numChannels);
  const audio = new Float32Array(samplesCount);
  if (bitsPerSample === 16) {
    for (let i = 0; i < samplesCount; i++) {
      // first channel only
      const sampleOffset = dataStart + i * numChannels * 2;
      const s = buf.readInt16LE(sampleOffset);
      audio[i] = s / 32768;
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < samplesCount; i++) {
      audio[i] = buf.readFloatLE(dataStart + i * numChannels * 4);
    }
  } else {
    throw new Error("Whisper Node: nieobsługiwany bit depth " + bitsPerSample);
  }
  return { audio, sample_rate: sampleRate || 16000 };
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

    // Node has no AudioContext — pass Float32Array, not file path
    const { audio, sample_rate } = loadWavAsFloat32(wav);
    if (!audio || !audio.length) {
      out.error = "Whisper Node: puste audio po dekodowaniu WAV";
      out.failed = 1;
      return out;
    }
    out.audioDuration = audio.length / (sample_rate || 16000);

    const result = await transcriber(audio, {
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
        let s0 = Number(ts[0]);
        let s1 = Number(ts[1]);
        if (!Number.isFinite(s0)) s0 = 0;
        if (!Number.isFinite(s1)) s1 = s0 + 0.5;
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
    // Filter pure non-speech hallucinations on silence
    if (
      text &&
      /^[\s.]*$|^\(.*\)$|^\[.*\]$|subtitle|subscribe|thanks for watching/i.test(
        text
      ) &&
      text.length < 40 &&
      out.audioDuration < 3
    ) {
      text = "";
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
    }
    if (!text) {
      // Empty speech is valid (silence) — not a hard failure for short clips
      out.error = null;
      out.failed = 0;
      out.engine = out.engine || "whisper-node";
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
