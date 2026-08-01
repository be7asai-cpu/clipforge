#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ClipForge STT via OpenAI Whisper (local) — separate from Google STT and Ollama.
Usage:
  python stt-whisper.py <video> <ffmpeg> <workDir> <maxSec> <lang|auto> <result.json> [startSec] [model]

Output JSON (same shape as stt-google.py): text, segments[{start,end,text}], engine, langCode, ...
"""
from __future__ import print_function

import json
import os
import subprocess
import sys

video = sys.argv[1]
ffmpeg = sys.argv[2]
work = sys.argv[3]
max_sec = float(sys.argv[4]) if len(sys.argv) > 4 else 0
lang = (sys.argv[5] if len(sys.argv) > 5 else "auto") or "auto"
result_path = sys.argv[6] if len(sys.argv) > 6 else os.path.join(work, "stt_result.json")
start_sec = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0
model_name = (sys.argv[8] if len(sys.argv) > 8 else "") or os.environ.get(
    "WHISPER_MODEL", "base"
)
if start_sec < 0:
    start_sec = 0.0

out = {
    "text": "",
    "engine": None,
    "langCode": None,
    "chunks": 0,
    "error": None,
    "partial": [],
    "segments": [],
    "audioDuration": 0,
    "coverageStart": None,
    "coverageEnd": None,
    "attempted": 1,
    "failed": 0,
    "lockedLang": None,
}


def save():
    try:
        tmp = result_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)
        os.replace(tmp, result_path)
    except Exception as e:
        try:
            with open(result_path, "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False)
        except Exception:
            out["error"] = (out.get("error") or "") + " | save: " + str(e)


def finish():
    save()
    print(json.dumps({"ok": True, "path": result_path}, ensure_ascii=True))
    sys.stdout.flush()


def map_lang(code):
    c = (code or "auto").lower().strip()
    if c in ("", "auto", "unknown", "detect"):
        return None
    # Whisper expects short codes
    if c.startswith("zh"):
        return "zh"
    if "-" in c:
        c = c.split("-")[0]
    return c[:8]


os.makedirs(work, exist_ok=True)
wav = os.path.join(work, "whisper_audio.wav")

# Extract mono 16 kHz wav (Whisper-friendly)
ff_cmd = [
    ffmpeg,
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
]
if start_sec > 0.05:
    ff_cmd += ["-ss", str(start_sec)]
ff_cmd += ["-i", video]
if max_sec and max_sec > 0.5:
    ff_cmd += ["-t", str(max_sec)]
ff_cmd += [
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    wav,
]
try:
    pr = subprocess.run(
        ff_cmd,
        capture_output=True,
        text=True,
        timeout=max(120, int(max_sec or 60) + 60),
    )
    if pr.returncode != 0 or not os.path.isfile(wav) or os.path.getsize(wav) < 1000:
        err = (pr.stderr or pr.stdout or "ffmpeg fail")[-400:]
        out["error"] = "Whisper: ffmpeg audio extract failed: " + err.replace("\n", " ")
        out["failed"] = 1
        finish()
        sys.exit(0)
except Exception as e:
    out["error"] = "Whisper: ffmpeg: " + str(e)
    out["failed"] = 1
    finish()
    sys.exit(0)

# Duration from wav
try:
    import wave

    with wave.open(wav, "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate() or 16000
        out["audioDuration"] = float(frames) / float(rate)
except Exception:
    out["audioDuration"] = float(max_sec or 0)

lang_whisper = map_lang(lang)
segments = []
full_text = ""
engine = None
detected = None

# --- try faster-whisper first (faster on CPU/GPU) ---
try:
    from faster_whisper import WhisperModel  # type: ignore

    compute = os.environ.get("WHISPER_COMPUTE", "int8")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    model = WhisperModel(model_name, device=device, compute_type=compute)
    segs_gen, info = model.transcribe(
        wav,
        language=lang_whisper,
        vad_filter=True,
        beam_size=int(os.environ.get("WHISPER_BEAM", "3")),
    )
    detected = getattr(info, "language", None) or lang_whisper
    parts = []
    for s in segs_gen:
        t = (s.text or "").strip()
        if not t:
            continue
        abs_start = float(s.start or 0) + start_sec
        abs_end = float(s.end or 0) + start_sec
        segments.append(
            {"start": abs_start, "end": max(abs_start + 0.15, abs_end), "text": t}
        )
        parts.append(t)
    full_text = " ".join(parts).replace("  ", " ").strip()
    engine = "whisper-faster:" + model_name
except Exception as e_fast:
    # --- fallback openai-whisper ---
    try:
        import whisper  # type: ignore

        model = whisper.load_model(model_name)
        kwargs = {"fp16": False}
        if lang_whisper:
            kwargs["language"] = lang_whisper
        result = model.transcribe(wav, **kwargs)
        detected = result.get("language") or lang_whisper
        parts = []
        for s in result.get("segments") or []:
            t = (s.get("text") or "").strip()
            if not t:
                continue
            abs_start = float(s.get("start") or 0) + start_sec
            abs_end = float(s.get("end") or 0) + start_sec
            segments.append(
                {
                    "start": abs_start,
                    "end": max(abs_start + 0.15, abs_end),
                    "text": t,
                }
            )
            parts.append(t)
        if not parts and result.get("text"):
            full_text = str(result.get("text") or "").strip()
        else:
            full_text = " ".join(parts).replace("  ", " ").strip()
        engine = "whisper:" + model_name
    except Exception as e_ow:
        msg_fast = str(e_fast)
        msg_ow = str(e_ow)
        out["error"] = (
            "Whisper niedostępny. Zainstaluj JEDNO z: "
            "pip install -U openai-whisper   LUB   pip install -U faster-whisper "
            "(oraz ffmpeg). "
            "faster: " + msg_fast[:180] + " | openai: " + msg_ow[:180]
        )
        out["failed"] = 1
        finish()
        sys.exit(0)

out["text"] = full_text
out["segments"] = segments
out["partial"] = [s["text"] for s in segments]
out["chunks"] = len(segments) or (1 if full_text else 0)
out["engine"] = engine
out["langCode"] = detected
out["lockedLang"] = detected
if segments:
    out["coverageStart"] = segments[0]["start"]
    out["coverageEnd"] = segments[-1]["end"]
elif out["audioDuration"]:
    out["coverageStart"] = start_sec
    out["coverageEnd"] = start_sec + out["audioDuration"]
if not full_text:
    out["error"] = out.get("error") or "Whisper: brak rozpoznanej mowy"
    out["failed"] = 1

finish()
sys.exit(0)
