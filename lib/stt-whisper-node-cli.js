/**
 * CLI wrapper for Node Whisper (spawnSync-friendly).
 * node stt-whisper-node-cli.js <video> <ffmpeg> <workDir> <maxSec> <lang> <result.json> [startSec] [model]
 */
const fs = require("fs");
const path = require("path");

const video = process.argv[2];
const ffmpeg = process.argv[3];
const work = process.argv[4];
const maxSec = Number(process.argv[5]) || 0;
const lang = process.argv[6] || "auto";
const resultPath = process.argv[7] || path.join(work, "stt_result.json");
const startSec = Number(process.argv[8]) || 0;
const model = process.argv[9] || process.env.WHISPER_MODEL || "base";

async function main() {
  const { extractSpeechWhisperNode } = require("./stt-whisper-node");
  const out = await extractSpeechWhisperNode(video, {
    ffmpeg,
    workDir: work,
    maxSeconds: maxSec,
    startSec,
    sourceLang: lang,
    whisperModel: model,
  });
  try {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify(out), "utf8");
  } catch (e) {
    out.error = (out.error || "") + " | write: " + e.message;
  }
  process.stdout.write(
    JSON.stringify({ ok: true, path: resultPath, engine: out.engine || null }) +
      "\n"
  );
  process.exit(out.text ? 0 : 1);
}

main().catch((e) => {
  const out = {
    text: "",
    error: e && e.message ? e.message : String(e),
    engine: null,
    segments: [],
    failed: 1,
  };
  try {
    fs.writeFileSync(resultPath, JSON.stringify(out), "utf8");
  } catch {
    /* ignore */
  }
  process.stdout.write(JSON.stringify({ ok: false, path: resultPath }) + "\n");
  process.exit(1);
});
