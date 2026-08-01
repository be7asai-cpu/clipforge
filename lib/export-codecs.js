/**
 * Re-export finished Studio results with best practical codecs
 * for ClipForge / FacePub / Reels / TikTok style apps.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let _encCache = null;
let _encCacheAt = 0;

function getFfmpeg() {
  try {
    const { ffmpegPath } = require("./studio-pipeline");
    return ffmpegPath() || "ffmpeg";
  } catch {
    return "ffmpeg";
  }
}

function listEncoders() {
  const now = Date.now();
  if (_encCache && now - _encCacheAt < 10 * 60 * 1000) return _encCache;
  const ff = getFfmpeg();
  const r = spawnSync(ff, ["-hide_banner", "-encoders"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const out = String((r.stdout || "") + (r.stderr || ""));
  _encCache = {
    libx264: /\blibx264\b/.test(out),
    libx265: /\blibx265\b/.test(out),
    h264_nvenc: /\bh264_nvenc\b/.test(out),
    hevc_nvenc: /\bhevc_nvenc\b/.test(out),
    aac: /\baac\b/.test(out),
    libmp3lame: /\blibmp3lame\b/.test(out),
  };
  _encCacheAt = now;
  return _encCache;
}

/** Profiles optimized for mobile apps + social upload. */
const PROFILES = {
  app: {
    id: "app",
    label: "App / Social (H.264 High + AAC)",
    ext: ".mp4",
    mime: "video/mp4",
    desc: "Uniwersalny H.264 High + AAC 320k — FacePub, Reels, TikTok, większość app",
  },
  hq: {
    id: "hq",
    label: "Max jakość H.264",
    ext: ".mp4",
    mime: "video/mp4",
    desc: "H.264 CRF 14 + AAC 320k — największa jakość, większy plik",
  },
  hevc: {
    id: "hevc",
    label: "HEVC H.265 (mniejszy)",
    ext: ".mp4",
    mime: "video/mp4",
    desc: "H.265 + AAC — mniejszy plik, nowsze telefony i appki",
  },
  audio: {
    id: "audio",
    label: "Dźwięk AAC 320k",
    ext: ".m4a",
    mime: "audio/mp4",
    desc: "Sam dźwięk AAC 320 kbit/s (najlepszy uniwersalny audio)",
  },
};

function availableProfiles() {
  const enc = listEncoders();
  const list = [];
  if (enc.libx264 || enc.h264_nvenc) {
    list.push({ ...PROFILES.app, available: true });
    list.push({ ...PROFILES.hq, available: true });
  }
  if (enc.libx265 || enc.hevc_nvenc) {
    list.push({ ...PROFILES.hevc, available: true });
  } else {
    list.push({ ...PROFILES.hevc, available: false, reason: "brak libx265/hevc_nvenc" });
  }
  if (enc.aac) {
    list.push({ ...PROFILES.audio, available: true });
  }
  return { encoders: enc, profiles: list };
}

function cachePathFor(videoPath, profileId, ext) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, base + "_export_" + profileId + ext);
}

/**
 * Re-encode video/audio for the chosen profile.
 * @returns {{ path: string, profile: object, reused: boolean }}
 */
function exportWithProfile(videoPath, profileId) {
  const id = String(profileId || "app").toLowerCase();
  const profile = PROFILES[id] || PROFILES.app;
  const enc = listEncoders();
  const ff = getFfmpeg();

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error("Brak pliku źródłowego do eksportu");
  }

  const outPath = cachePathFor(videoPath, profile.id, profile.ext);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
    const srcM = fs.statSync(videoPath).mtimeMs;
    const outM = fs.statSync(outPath).mtimeMs;
    if (outM >= srcM) {
      return { path: outPath, profile, reused: true };
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (profile.id === "audio") {
    if (!enc.aac) throw new Error("Brak enkodera AAC w FFmpeg");
    const r = spawnSync(
      ff,
      [
        "-y",
        "-i",
        videoPath,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        outPath,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 600000,
        maxBuffer: 12 * 1024 * 1024,
      }
    );
    if ((r.status || 0) !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size < 200) {
      const err = String(r.stderr || r.stdout || r.error || "aac export failed").slice(-500);
      throw new Error("Eksport audio AAC nieudany: " + err.replace(/\s+/g, " "));
    }
    return { path: outPath, profile, reused: false };
  }

  // Video profiles
  let vCodecArgs;
  if (profile.id === "hevc") {
    if (enc.libx265) {
      vCodecArgs = [
        "-c:v",
        "libx265",
        "-preset",
        "medium",
        "-crf",
        "22",
        "-tag:v",
        "hvc1",
        "-pix_fmt",
        "yuv420p",
      ];
    } else if (enc.hevc_nvenc) {
      vCodecArgs = [
        "-c:v",
        "hevc_nvenc",
        "-preset",
        "p5",
        "-rc",
        "vbr",
        "-cq",
        "22",
        "-b:v",
        "0",
        "-tag:v",
        "hvc1",
        "-pix_fmt",
        "yuv420p",
      ];
    } else {
      throw new Error("Brak enkodera HEVC (libx265 / hevc_nvenc)");
    }
  } else {
    // app + hq → H.264 High
    const crf = profile.id === "hq" ? "14" : "17";
    const preset = profile.id === "hq" ? "slow" : "medium";
    if (enc.libx264) {
      vCodecArgs = [
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-level",
        "4.2",
        "-preset",
        preset,
        "-crf",
        crf,
        "-pix_fmt",
        "yuv420p",
      ];
    } else if (enc.h264_nvenc) {
      vCodecArgs = [
        "-c:v",
        "h264_nvenc",
        "-profile:v",
        "high",
        "-preset",
        "p5",
        "-rc",
        "vbr",
        "-cq",
        crf,
        "-b:v",
        "0",
        "-pix_fmt",
        "yuv420p",
      ];
    } else {
      throw new Error("Brak enkodera H.264 (libx264 / h264_nvenc)");
    }
  }

  if (!enc.aac) throw new Error("Brak enkodera AAC");

  const args = [
    "-y",
    "-i",
    videoPath,
    ...vCodecArgs,
    "-c:a",
    "aac",
    "-b:a",
    "320k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outPath,
  ];

  const r = spawnSync(ff, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 45 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if ((r.status || 0) !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
    const err = String(r.stderr || r.stdout || r.error || "export failed").slice(-600);
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    throw new Error("Eksport wideo nieudany: " + err.replace(/\s+/g, " "));
  }
  return { path: outPath, profile, reused: false };
}

module.exports = {
  PROFILES,
  availableProfiles,
  exportWithProfile,
  listEncoders,
  cachePathFor,
};
