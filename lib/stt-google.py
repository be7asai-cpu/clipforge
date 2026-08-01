#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ClipForge multi-language STT via Google Web Speech (speech_recognition).
Fast path: detect language on a few samples → lock → transcribe all chunks in that locale.
Writes partial results to result_path so Node can recover on timeout.
"""
from __future__ import print_function

import json
import os
import re
import subprocess
import sys
import time
import wave

video = sys.argv[1]
ffmpeg = sys.argv[2]
work = sys.argv[3]
max_sec = int(float(sys.argv[4]))
locale = sys.argv[5] if len(sys.argv) > 5 else "auto"
result_path = sys.argv[6] if len(sys.argv) > 6 else os.path.join(work, "stt_result.json")
# Optional: absolute start in source video (segmented STT from Node)
start_sec = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0
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
    "attempted": 0,
    "failed": 0,
    "lockedLang": None,
}


def save():
    """Atomic-ish partial write for Node timeout recovery."""
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
    # ASCII-only stdout for Windows Node spawn
    print(json.dumps({"ok": True, "path": result_path}, ensure_ascii=True))
    sys.stdout.flush()


try:
    import speech_recognition as sr
except Exception as e:
    out["error"] = "Brak speech_recognition: pip install SpeechRecognition (" + str(e) + ")"
    finish()
    sys.exit(0)

RE_AR = re.compile("[\u0600-\u06FF\u0750-\u077F]")
RE_CYR = re.compile("[\u0400-\u04FF]")
RE_DEV = re.compile("[\u0900-\u097F]")
RE_CJK = re.compile("[\u4E00-\u9FFF]")
RE_LAT = re.compile("[A-Za-z\u00C0-\u00FF]")
RE_PL = re.compile(
    "[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c"
    "\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b]"
)
RE_WORD = re.compile(
    "[A-Za-z0-9_\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF]+"
)

# Probe order for auto-detect (EN first for world clips).
# Script-heavy langs (ar/hi/zh/ru) only win with matching alphabet — see score_hypothesis.
DETECT_LANGS = [
    "en-US",
    "pl-PL",
    "es-ES",
    "de-DE",
    "fr-FR",
    "ru-RU",
    "it-IT",
    "pt-BR",
    "uk-UA",
    "ar-SA",
    "hi-IN",
    "zh-CN",
]
# First-pass probe only these (fast). Expand only if all fail.
PROBE_LANGS = [
    "en-US",
    "pl-PL",
    "es-ES",
    "de-DE",
    "fr-FR",
    "ru-RU",
    "it-IT",
    "pt-BR",
]


def lang_base(lang):
    return str(lang or "").split("-")[0].lower()


def score_hypothesis(text, lang):
    t = (text or "").strip()
    if not t:
        return -1.0
    code = lang_base(lang)
    n = max(1, len(t))
    words = RE_WORD.findall(t)
    # Prefer multi-word real speech over single garbage tokens
    score = float(len(words)) * 3.0 + min(30.0, n * 0.12)
    if len(words) <= 1 and n < 12:
        score *= 0.35
    ar = len(RE_AR.findall(t)) / n
    cyr = len(RE_CYR.findall(t)) / n
    dev = len(RE_DEV.findall(t)) / n
    cjk = len(RE_CJK.findall(t)) / n
    lat = len(RE_LAT.findall(t)) / n
    pl = len(RE_PL.findall(t)) / n

    if code == "ar":
        score *= 4.5 if ar > 0.15 else 0.08
    elif code in ("ru", "uk"):
        score *= 4.5 if cyr > 0.15 else 0.08
    elif code == "hi":
        score *= 4.5 if dev > 0.12 else 0.08
    elif code == "zh":
        score *= 4.5 if cjk > 0.12 else 0.08
    elif code == "pl":
        if pl > 0.01:
            score *= 3.0
        elif lat > 0.4:
            # plain Latin as "Polish" is often forced garbage on EN speech
            score *= 0.25
        else:
            score *= 0.15
    elif code in ("en", "es", "fr", "de", "it", "pt"):
        if cyr > 0.12 or ar > 0.12 or cjk > 0.12 or dev > 0.12:
            score *= 0.1
        elif pl > 0.02:
            score *= 0.3
        elif lat > 0.3:
            score *= 1.8
            low = t.lower()
            hints = {
                "en": ("the", "and", "you", "this", "that", "what", "with", "like", "said", "phone", "fuck"),
                "es": ("el", "la", "que", "de", "los", "una", "por", "como"),
                "fr": ("le", "les", "des", "une", "dans", "pour", "est", "que"),
                "de": ("der", "die", "das", "und", "ist", "nicht", "ein"),
                "it": ("il", "che", "per", "una", "non", "sono", "di"),
                "pt": ("que", "nao", "não", "uma", "para", "com", "por"),
            }
            for w in hints.get(code, ()):
                if re.search(r"\b" + re.escape(w) + r"\b", low):
                    score += 5.0
        else:
            score *= 0.35
    return score


def extract_wav(boost=False):
    """Extract original mono 16kHz audio for STT (no isolation / EQ)."""
    tag = "" if not boost else "_boost"
    wav_full = os.path.join(work, "speech_full%s.wav" % tag)
    # -ss before -i for fast seek; -t limits segment length (Node segmented STT)
    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
    ]
    if start_sec > 0.01:
        cmd += ["-ss", ("%.3f" % start_sec)]
    cmd += [
        "-i",
        video,
        "-t",
        str(max_sec),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
    ]
    if boost:
        # only slight volume lift on retry — still original mix
        cmd += ["-af", "volume=3.0"]
    cmd += ["-f", "wav", wav_full]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0 and os.path.exists(wav_full) and os.path.getsize(wav_full) >= 1000:
        out["voicePrep"] = "original" + ("+vol" if boost else "")
        return wav_full, None

    # fallback raw
    cmd2 = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
    ]
    if start_sec > 0.01:
        cmd2 += ["-ss", ("%.3f" % start_sec)]
    cmd2 += [
        "-i",
        video,
        "-t",
        str(max_sec),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        wav_full,
    ]
    r2 = subprocess.run(cmd2, capture_output=True, text=True)
    if r2.returncode != 0 or not os.path.exists(wav_full) or os.path.getsize(wav_full) < 1000:
        return None, (r.stderr or r2.stderr or "")[-200:]
    out["voicePrep"] = "original"
    return wav_full, None


def load_audio(chunk_path, recognizer):
    try:
        with sr.AudioFile(chunk_path) as source:
            try:
                recognizer.adjust_for_ambient_noise(source, duration=0.15)
            except Exception:
                pass
            return recognizer.record(source)
    except Exception:
        return None


def cut_chunk(wav_full, start, clen, path, boost=False):
    """Cut window from original audio; optional simple volume boost only."""
    ccmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        str(start),
        "-t",
        str(clen),
        "-i",
        wav_full,
        "-ac",
        "1",
        "-ar",
        "16000",
    ]
    if boost:
        ccmd += ["-af", "volume=4"]
    ccmd += ["-f", "wav", path]
    subprocess.run(ccmd, capture_output=True)
    return os.path.exists(path) and os.path.getsize(path) >= 400


def chunk_energy(path):
    """Rough RMS — skip near-silent windows to save API calls."""
    try:
        with wave.open(path, "rb") as w:
            n = w.getnframes()
            if n <= 0:
                return 0.0
            raw = w.readframes(n)
            # 16-bit mono
            import array

            arr = array.array("h")
            arr.frombytes(raw[: len(raw) - (len(raw) % 2)])
            if not arr:
                return 0.0
            step = max(1, len(arr) // 2000)
            s = 0.0
            c = 0
            for i in range(0, len(arr), step):
                s += abs(arr[i])
                c += 1
            return s / max(1, c)
    except Exception:
        return 500.0  # don't skip on error


def recognize_best(audio, langs, recognizer):
    last_err = None
    best = None  # (score, text, lang)
    for lang in langs:
        try:
            got = recognizer.recognize_google(audio, language=lang)
            if got and got.strip():
                got = got.strip()
                sc = score_hypothesis(got, lang)
                if best is None or sc > best[0]:
                    best = (sc, got, lang)
        except sr.UnknownValueError:
            continue
        except sr.RequestError as e:
            last_err = "STT API: " + str(e)
            time.sleep(0.4)
            continue
        except Exception as e:
            last_err = "STT: " + str(e)
            continue
    if best and best[0] > 0.5:
        return best[1], best[2], best[0], last_err
    return None, None, 0.0, last_err


def wav_duration(wav_full):
    with wave.open(wav_full, "rb") as w:
        return w.getnframes() / float(w.getframerate() or 16000)


def build_starts(duration, step=6.0, chunk_len=12.0):
    """Shorter step = better chance to catch sparse dialogue bursts."""
    starts = []
    t = 0.0
    while t < duration - 0.4:
        starts.append(t)
        t += step
    if not starts:
        starts = [0.0]
    return starts, chunk_len


# --- language list ---
preferred = None
if locale and locale != "auto":
    preferred = locale
    langs_try = [locale]
    base = lang_base(locale)
    # close variants only
    variants = {
        "en": ["en-US", "en-GB"],
        "es": ["es-ES", "es-MX"],
        "pt": ["pt-BR", "pt-PT"],
        "zh": ["zh-CN", "zh-TW"],
        "pl": ["pl-PL"],
        "de": ["de-DE"],
        "fr": ["fr-FR"],
        "ru": ["ru-RU"],
        "it": ["it-IT"],
        "ar": ["ar-SA"],
        "hi": ["hi-IN"],
        "uk": ["uk-UA", "ru-RU"],
    }
    for v in variants.get(base, []):
        if v not in langs_try:
            langs_try.append(v)
else:
    langs_try = list(DETECT_LANGS)

os.makedirs(work, exist_ok=True)
wav_full, ferr = extract_wav(False)
if not wav_full:
    out["error"] = "ffmpeg audio extract failed: " + (ferr or "")
    finish()
    sys.exit(0)

try:
    duration = wav_duration(wav_full)
except Exception as e:
    out["error"] = "wave open: " + str(e)
    finish()
    sys.exit(0)

out["audioDuration"] = float(duration)
save()

# Sliding windows: Node already splits long clips into ~6s outer segments.
# Dense step=4 + chunk=12 caused 2–3× duplicated text (user report).
# - short / outer segment (start_sec set or ≤18s): ONE window, whole audio
# - full long clip: mild overlap only (step≈10, chunk=12 → ~2s overlap)
if start_sec > 0.05 or duration <= 18.0 or max_sec <= 18:
    starts = [0.0]
    chunk_len = max(0.8, float(duration))
else:
    starts, chunk_len = build_starts(duration, step=10.0, chunk_len=12.0)
starts = starts[: min(len(starts), 200)]
out["attempted"] = len(starts)

recognizer = sr.Recognizer()
recognizer.energy_threshold = 120
recognizer.dynamic_energy_threshold = True

locked_lang = preferred  # may be None in auto
segments = []
failed = 0
err = None

# ---- Phase A: detect language (auto only) on sparse samples ----
if not locked_lang:
    probe_idx = []
    n = len(starts)
    if n <= 4:
        probe_idx = list(range(n))
    else:
        # start mid regions where dialogue usually sits (prank/music intros are silent)
        for frac in (0.12, 0.28, 0.45, 0.62, 0.78):
            i = min(n - 1, max(0, int(frac * (n - 1))))
            if i not in probe_idx:
                probe_idx.append(i)
    votes = {}  # lang -> total score
    for i in probe_idx:
        start = starts[i]
        clen = min(chunk_len, max(0.8, duration - start))
        cp = os.path.join(work, "probe_%03d.wav" % i)
        if not cut_chunk(wav_full, start, clen, cp, boost=False):
            continue
        if chunk_energy(cp) < 80:
            if not cut_chunk(wav_full, start, clen, cp, boost=True):
                continue
            if chunk_energy(cp) < 50:
                continue  # silence — skip API
        audio = load_audio(cp, recognizer)
        if audio is None:
            continue
        got, lang, sc, e2 = recognize_best(audio, PROBE_LANGS, recognizer)
        if not got or sc < 4.0:
            # second pass: script langs (ru/ar/hi/zh) only if Latin probes weak
            if cut_chunk(wav_full, start, clen, cp, boost=True):
                audio = load_audio(cp, recognizer)
                if audio is not None:
                    got2, lang2, sc2, e3 = recognize_best(
                        audio, DETECT_LANGS, recognizer
                    )
                    if sc2 > sc:
                        got, lang, sc, e2 = got2, lang2, sc2, e3
        if e2:
            err = e2
        # Strict threshold — reject weak garbage (was locking hi-IN etc.)
        if got and lang and sc >= 6.0:
            votes[lang] = votes.get(lang, 0.0) + sc
            if sc >= 8.0:
                segments.append(
                    {
                        "start": float(start),
                        "end": float(min(duration, start + clen)),
                        "text": got,
                        "lang": lang,
                        "score": sc,
                    }
                )
        time.sleep(0.08)
        save()

    if votes:
        top_lang, top_sc = sorted(votes.items(), key=lambda x: -x[1])[0]
        # Require meaningful total score; else default EN (world clips)
        if top_sc >= 8.0:
            locked_lang = top_lang
        else:
            locked_lang = "en-US"
    else:
        locked_lang = "en-US"

out["lockedLang"] = locked_lang
out["engine"] = "google-web-speech:" + locked_lang
out["langCode"] = "zh" if locked_lang.lower().startswith("zh") else lang_base(locked_lang)
save()

# ---- Phase B: full pass with ONLY locked language ----
langs_locked = [locked_lang]
# keep EN as soft fallback if locked is not en and many fails
if not locked_lang.lower().startswith("en"):
    langs_locked.append("en-US")

# drop probe segments that disagree with locked lang (wrong alphabet garbage)
segments = [
    s
    for s in segments
    if lang_base(s.get("lang")) == lang_base(locked_lang)
    or score_hypothesis(s.get("text"), locked_lang) > 4.0
]

seen_starts = {round(float(s["start"]), 1) for s in segments}

def try_window(start, clen, tag, wav_src=None, force=False):
    """Recognize one window with plain + boost + halves. force=ignore low energy."""
    src = wav_src or wav_full
    cp = os.path.join(work, "%s.wav" % tag)
    got = lang = None
    sc = 0.0
    e2 = None
    for boost in (False, True):
        if not cut_chunk(src, start, clen, cp, boost=boost):
            continue
        # Low energy skip only when not forced — music under speech still has energy
        if not force and chunk_energy(cp) < (20 if boost else 30):
            continue
        audio = load_audio(cp, recognizer)
        if audio is None:
            continue
        got, lang, sc, e2 = recognize_best(audio, langs_locked, recognizer)
        if got and sc >= 1.0:
            break
    if (not got or sc < 1.0) and clen >= 5.0:
        halves = []
        half_lang = None
        half_sc = 0.0
        for hi, (hs, hl) in enumerate(
            [(start, clen / 2), (start + clen / 2, clen / 2)]
        ):
            hp = os.path.join(work, "%s_h%d.wav" % (tag, hi))
            if not cut_chunk(src, hs, max(0.8, hl), hp, boost=True):
                continue
            if not force and chunk_energy(hp) < 18:
                continue
            ha = load_audio(hp, recognizer)
            if ha is None:
                continue
            g2, l2, s2, _ = recognize_best(ha, langs_locked, recognizer)
            if g2 and s2 >= 1.0:
                halves.append(g2)
                if s2 > half_sc:
                    half_sc = s2
                    half_lang = l2
        if halves:
            got = " ".join(halves).strip()
            lang = half_lang or locked_lang
            sc = half_sc
    if e2 and not got:
        return None, e2
    if not got or sc < 0.9:
        return None, None
    # Reject only strongly wrong-script garbage
    if lang_base(locked_lang) in ("en", "es", "fr", "de", "it", "pt", "pl"):
        if score_hypothesis(got, locked_lang) < 0.8:
            return None, None
    return {
        "start": float(start),
        "end": float(min(duration, start + clen)),
        "text": got,
        "lang": lang or locked_lang,
        "score": sc,
    }, None


def merge_overlap_texts(a, b):
    """Stitch two STT strings without repeating overlapping words."""
    a = (a or "").strip()
    b = (b or "").strip()
    if not a:
        return b
    if not b:
        return a
    al = a.lower()
    bl = b.lower()
    if bl in al:
        return a
    if al in bl:
        return b
    wa = a.split()
    wb = b.split()
    if not wa:
        return b
    if not wb:
        return a
    max_k = min(len(wa), len(wb), 48)
    best = 0
    for k in range(max_k, 0, -1):
        left = [x.lower() for x in wa[-k:]]
        right = [x.lower() for x in wb[:k]]
        if left == right:
            best = k
            break
    if best >= 1:
        return " ".join(wa + wb[best:]).strip()
    # partial fuzzy: last 3+ words of a appear inside b
    if len(wa) >= 3:
        tail = " ".join(wa[-min(6, len(wa)) :]).lower()
        pos = bl.find(tail)
        if pos >= 0:
            # keep a + remainder of b after the matched tail
            cut = pos + len(tail)
            rest = b[cut:].strip()
            return (a + (" " + rest if rest else "")).strip()
    return (a + " " + b).strip()


def stitch_segments(segs):
    """Merge time-overlapping / repeated STT windows into clean timeline."""
    if not segs:
        return []
    ordered = sorted(segs, key=lambda s: float(s.get("start") or 0))
    out_segs = []
    for seg in ordered:
        t = (seg.get("text") or "").strip()
        if not t:
            continue
        if not out_segs:
            out_segs.append(dict(seg, text=t))
            continue
        prev = out_segs[-1]
        ps = float(prev.get("start") or 0)
        pe = float(prev.get("end") or 0)
        ss = float(seg.get("start") or 0)
        se = float(seg.get("end") or 0)
        pt = (prev.get("text") or "").strip()
        # time overlap / adjacent windows from dense slide
        if ss <= pe + 0.75:
            merged = merge_overlap_texts(pt, t)
            prev["text"] = merged
            prev["end"] = max(pe, se)
            if float(seg.get("score") or 0) > float(prev.get("score") or 0):
                prev["score"] = seg.get("score")
                prev["lang"] = seg.get("lang") or prev.get("lang")
            continue
        # no time overlap but text is almost pure repeat
        merged = merge_overlap_texts(pt, t)
        if merged == pt:
            prev["end"] = max(pe, se)
            continue
        if merged == t and len(t) >= len(pt):
            out_segs[-1] = dict(seg, text=t, start=min(ps, ss))
            continue
        # if merge shortened a lot vs naive join, still adjacent speech
        naive = (pt + " " + t).strip()
        if len(merged) < len(naive) * 0.92 and ss - pe < 2.5:
            prev["text"] = merged
            prev["end"] = max(pe, se)
            continue
        out_segs.append(dict(seg, text=t))
    return out_segs


def add_segment(seg):
    """Append segment if not duplicate of nearby window."""
    if not seg:
        return False
    t = (seg.get("text") or "").strip()
    if not t:
        return False
    for s in segments:
        if abs(float(s["start"]) - float(seg["start"])) < 2.5:
            if len(t) > len(s.get("text") or ""):
                s["text"] = t
                s["end"] = max(float(s["end"]), float(seg["end"]))
                s["lang"] = seg.get("lang") or s.get("lang")
                s["score"] = max(float(s.get("score") or 0), float(seg.get("score") or 0))
            return True
        # same text nearby
        if t == (s.get("text") or "").strip() and abs(
            float(s["start"]) - float(seg["start"])
        ) < 6.0:
            s["end"] = max(float(s["end"]), float(seg["end"]))
            return False
        # high word-overlap near-duplicate
        existing = (s.get("text") or "").strip()
        if existing and abs(float(s["start"]) - float(seg["start"])) < 8.0:
            m = merge_overlap_texts(existing, t)
            if m == existing or len(m) <= len(existing) + 2:
                s["end"] = max(float(s["end"]), float(seg["end"]))
                return False
            if abs(float(s["start"]) - float(seg["start"])) < 4.0:
                s["text"] = m
                s["end"] = max(float(s["end"]), float(seg["end"]))
                return True
    segments.append(seg)
    return True


def publish_partial():
    stitched = stitch_segments(segments)
    # keep global list in sync with stitched content for later appends
    segments[:] = stitched
    texts = [s["text"] for s in segments if (s.get("text") or "").strip()]
    out["segments"] = [
        {
            "start": float(s.get("start") or 0),
            "end": float(s.get("end") or 0),
            "text": (s.get("text") or "").strip(),
            "lang": s.get("lang"),
            "score": s.get("score"),
        }
        for s in segments
        if (s.get("text") or "").strip()
    ]
    out["partial"] = texts
    # final stitch across all texts once more (belt + suspenders)
    joined = ""
    for t in texts:
        joined = merge_overlap_texts(joined, t) if joined else t
    out["text"] = joined.strip()
    out["chunks"] = len(out["segments"])
    out["failed"] = failed
    if segments:
        out["coverageStart"] = float(segments[0]["start"])
        out["coverageEnd"] = float(segments[-1]["end"])
    save()


for i, start in enumerate(starts):
    if round(float(start), 1) in seen_starts:
        continue
    clen = min(chunk_len, max(0.8, duration - start))
    seg, e2 = try_window(start, clen, "chunk_%03d" % i)
    if e2:
        err = e2
    if not seg:
        failed += 1
        continue
    add_segment(seg)
    publish_partial()
    time.sleep(0.08)

# ---- Phase C: ALWAYS fill gaps + finish to end of video ----
# User reported STT stopping at ~26s while file is 60s — force gap scan.
wav_b, _ = extract_wav(True)
if wav_b:
    out["boosted"] = True
    save()

def coverage_gaps():
    segs = sorted(segments, key=lambda s: float(s.get("start") or 0))
    gaps = []
    cur = 0.0
    for s in segs:
        a = float(s.get("start") or 0)
        b = float(s.get("end") or a)
        if a - cur >= 3.5:
            gaps.append((cur, a))
        cur = max(cur, b)
    if duration - cur >= 3.0:
        gaps.append((cur, duration))
    # if first speech late, re-scan intro
    if segs and float(segs[0].get("start") or 0) > 3.0:
        gaps.insert(0, (0.0, float(segs[0]["start"])))
    return gaps


# denser gap windows (6s step 4s) until end
gap_starts = []
for g0, g1 in coverage_gaps():
    t = g0
    while t < g1 - 0.4:
        gap_starts.append(t)
        t += 4.0
# also force last 25% of video even if no gap detected (end speech)
tail0 = max(0.0, duration * 0.65)
t = tail0
while t < duration - 0.4:
    if not any(abs(t - gs) < 2.0 for gs in gap_starts):
        gap_starts.append(t)
    t += 4.0

out["gapScan"] = len(gap_starts)
save()

for i, start in enumerate(gap_starts):
    clen = min(10.0, max(0.8, duration - start))
    src = wav_b or wav_full
    seg, e2 = try_window(start, clen, "gap_%03d" % i, wav_src=src, force=True)
    if e2:
        err = e2
    if seg:
        add_segment(seg)
        publish_partial()
    time.sleep(0.07)

# ---- Phase D: if still sparse, full boosted sweep with short 8s windows ----
if duration > 1 and (
    not segments
    or float(segments[-1].get("end") or 0) < duration * 0.75
    or len(segments) < max(2, int(duration / 25))
):
    out["fullSweep"] = True
    save()
    src = wav_b or wav_full
    t = 0.0
    si = 0
    while t < duration - 0.4:
        clen = min(8.0, duration - t)
        seg, _ = try_window(t, clen, "sweep_%03d" % si, wav_src=src, force=True)
        if seg:
            add_segment(seg)
            publish_partial()
        t += 5.0
        si += 1
        time.sleep(0.06)

# sort + merge overlapping
segments.sort(key=lambda s: (float(s.get("start") or 0), float(s.get("end") or 0)))
merged = []
for s in segments:
    t = (s.get("text") or "").strip()
    if not t:
        continue
    if not merged:
        merged.append(dict(s))
        continue
    prev = merged[-1]
    # overlap / adjacent windows → merge text if complementary
    if float(s["start"]) <= float(prev["end"]) + 1.5:
        if t not in (prev.get("text") or "") and (prev.get("text") or "") not in t:
            # append new words if different
            if abs(float(s["start"]) - float(prev["start"])) < 2.5:
                if len(t) > len(prev.get("text") or ""):
                    prev["text"] = t
            else:
                prev["text"] = ((prev.get("text") or "") + " " + t).strip()
        elif len(t) > len(prev.get("text") or ""):
            prev["text"] = t
        prev["end"] = max(float(prev["end"]), float(s["end"]))
        if s.get("lang"):
            prev["lang"] = s.get("lang")
        continue
    if t == (prev.get("text") or "").strip() and float(s["start"]) - float(prev["end"]) < 2.5:
        prev["end"] = max(float(prev["end"]), float(s["end"]))
        continue
    merged.append(dict(s))

segments = merged
texts = [s["text"] for s in segments]
out["segments"] = segments
out["partial"] = texts
out["text"] = " ".join(texts).strip()
out["chunks"] = len(segments)
out["failed"] = failed
out["attempted"] = len(starts) + len(gap_starts)
if segments:
    out["coverageStart"] = float(segments[0]["start"])
    out["coverageEnd"] = float(segments[-1]["end"])
    votes = {}
    for s in segments:
        lg = s.get("lang") or locked_lang
        votes[lg] = votes.get(lg, 0) + 1
    if votes:
        top = sorted(votes.items(), key=lambda x: -x[1])[0][0]
        locked_lang = top
        out["lockedLang"] = top
        out["engine"] = "google-web-speech:" + top
        out["langCode"] = "zh" if top.lower().startswith("zh") else lang_base(top)
    # note incomplete coverage in log field
    cov_end = float(out["coverageEnd"] or 0)
    if duration > 5 and cov_end < duration - 4:
        out["coverageNote"] = "partial: %.1fs of %.1fs" % (cov_end, duration)
else:
    out["error"] = err or "Brak mowy / cisza / STT nie rozpoznał tekstu"

finish()
