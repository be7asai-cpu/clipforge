/**
 * FacePub Studio — multi-target NMT + multi-language TTS.
 * Translate FROM any source TO selected target (10 langs + PL).
 * Each language has its own NMT codes + Edge neural voice model.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Resolve a working Python on Windows (avoid Store stub → spawn EFTYPE).
 * Returns { cmd, prefixArgs } e.g. { cmd: "py", prefixArgs: ["-3"] }.
 */
let _pythonResolved = null;
function getPython() {
  if (_pythonResolved) return _pythonResolved;
  const tries =
    process.platform === "win32"
      ? [
          ["py", ["-3"]],
          ["py", []],
          ["python3", []],
          ["python", []],
        ]
      : [
          ["python3", []],
          ["python", []],
        ];
  for (const [cmd, prefixArgs] of tries) {
    try {
      const r = spawnSync(cmd, [...prefixArgs, "--version"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
      });
      const out = String((r.stdout || "") + (r.stderr || ""));
      if (!r.error && /Python\s+\d/i.test(out)) {
        _pythonResolved = { cmd, prefixArgs };
        return _pythonResolved;
      }
    } catch {
      /* try next */
    }
  }
  // last resort — may still EFTYPE on broken installs
  _pythonResolved = { cmd: "python", prefixArgs: [] };
  return _pythonResolved;
}

function runPython(args, opts = {}) {
  const { cmd, prefixArgs } = getPython();
  return spawnSync(cmd, [...prefixArgs, ...args], {
    windowsHide: true,
    ...opts,
  });
}

/**
 * Language registry: NMT codes + Edge TTS neural voice models.
 */
const LANGUAGE_MODELS = {
  en: {
    code: "en",
    label: "Angielski",
    labelEn: "English",
    google: "en",
    mymemory: "en",
    libre: "en",
    ttsVoice: "en-US-JennyNeural",
    ttsVoiceMale: "en-US-GuyNeural",
    sapiVoice: "Microsoft Zira Desktop",
  },
  zh: {
    code: "zh",
    label: "Chiński",
    labelEn: "Chinese",
    google: "zh-CN",
    mymemory: "zh-CN",
    libre: "zh",
    ttsVoice: "zh-CN-XiaoxiaoNeural",
    ttsVoiceMale: "zh-CN-YunxiNeural",
  },
  hi: {
    code: "hi",
    label: "Hindi",
    labelEn: "Hindi",
    google: "hi",
    mymemory: "hi",
    libre: "hi",
    ttsVoice: "hi-IN-SwaraNeural",
    ttsVoiceMale: "hi-IN-MadhurNeural",
  },
  es: {
    code: "es",
    label: "Hiszpański",
    labelEn: "Spanish",
    google: "es",
    mymemory: "es",
    libre: "es",
    ttsVoice: "es-ES-ElviraNeural",
    ttsVoiceMale: "es-ES-AlvaroNeural",
  },
  fr: {
    code: "fr",
    label: "Francuski",
    labelEn: "French",
    google: "fr",
    mymemory: "fr",
    libre: "fr",
    ttsVoice: "fr-FR-DeniseNeural",
    ttsVoiceMale: "fr-FR-HenriNeural",
  },
  ar: {
    code: "ar",
    label: "Arabski",
    labelEn: "Arabic",
    google: "ar",
    mymemory: "ar",
    libre: "ar",
    ttsVoice: "ar-SA-ZariyahNeural",
    ttsVoiceMale: "ar-SA-HamedNeural",
  },
  it: {
    code: "it",
    label: "Włoski",
    labelEn: "Italian",
    google: "it",
    mymemory: "it",
    libre: "it",
    ttsVoice: "it-IT-ElsaNeural",
    ttsVoiceMale: "it-IT-DiegoNeural",
  },
  pt: {
    code: "pt",
    label: "Portugalski",
    labelEn: "Portuguese",
    google: "pt",
    mymemory: "pt",
    libre: "pt",
    ttsVoice: "pt-BR-FranciscaNeural",
    ttsVoiceMale: "pt-BR-AntonioNeural",
  },
  ru: {
    code: "ru",
    label: "Rosyjski",
    labelEn: "Russian",
    google: "ru",
    mymemory: "ru",
    libre: "ru",
    ttsVoice: "ru-RU-SvetlanaNeural",
    ttsVoiceMale: "ru-RU-DmitryNeural",
  },
  de: {
    code: "de",
    label: "Niemiecki",
    labelEn: "German",
    google: "de",
    mymemory: "de",
    libre: "de",
    ttsVoice: "de-DE-KatjaNeural",
    ttsVoiceMale: "de-DE-ConradNeural",
  },
  pl: {
    code: "pl",
    label: "Polski",
    labelEn: "Polish",
    google: "pl",
    mymemory: "pl",
    libre: "pl",
    ttsVoice: "pl-PL-ZofiaNeural",
    ttsVoiceMale: "pl-PL-MarekNeural",
    sapiVoice: "Microsoft Paulina",
    sapiVoiceMale: "Microsoft Adam",
  },
  auto: {
    code: "auto",
    label: "Automatyczne rozpoznawanie",
    labelEn: "Auto-detect",
    google: "auto",
    mymemory: "autodetect",
    libre: "auto",
  },
};

const WORLD_LANGS = [
  LANGUAGE_MODELS.en,
  LANGUAGE_MODELS.zh,
  LANGUAGE_MODELS.hi,
  LANGUAGE_MODELS.es,
  LANGUAGE_MODELS.fr,
  LANGUAGE_MODELS.ar,
  LANGUAGE_MODELS.it,
  LANGUAGE_MODELS.pt,
  LANGUAGE_MODELS.ru,
  LANGUAGE_MODELS.de,
];

const TARGET_LANGS = [...WORLD_LANGS, LANGUAGE_MODELS.pl];

const LANG_LABELS = Object.fromEntries(
  Object.values(LANGUAGE_MODELS).map((m) => [m.code, m.label])
);
LANG_LABELS.unknown = "nieznany";
LANG_LABELS.ja = "Japoński";
LANG_LABELS.he = "Hebrajski";
LANG_LABELS.ko = "Koreański";

function getLanguageModel(code) {
  if (!code) return LANGUAGE_MODELS.auto;
  if (LANGUAGE_MODELS[code]) return LANGUAGE_MODELS[code];
  if (code === "zh-CN" || code === "zh-TW") return LANGUAGE_MODELS.zh;
  return {
    code,
    label: LANG_LABELS[code] || code,
    google: code,
    mymemory: code,
    libre: code,
    ttsVoice: "en-US-JennyNeural",
  };
}

function modelIdFor(src, tgt) {
  const s = src === "auto" || !src ? "auto" : src;
  const t = tgt || "pl";
  if (s === t) return `passthrough-${t}`;
  return `nmt-google-${s}-${t}`;
}

function modelNameFor(src, tgt) {
  const s = (src === "auto" || !src ? "AUTO" : String(src).toUpperCase());
  const t = String(tgt || "pl").toUpperCase();
  if (s.toLowerCase() === t.toLowerCase()) return `Passthrough ${t}`;
  return `Google NMT · ${s}→${t}`;
}

// --- detection ---
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const HEBREW = /[\u0590-\u05FF]/;
const CYRILLIC = /[\u0400-\u04FF]/;
const DEVANAGARI = /[\u0900-\u097F]/;
const CJK_HAN = /[\u4E00-\u9FFF]/;
const HIRAGANA_KATA = /[\u3040-\u30FF]/;
const HANGUL = /[\uAC00-\uD7AF]/;
const POLISH_CHARS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const LATIN = /[A-Za-zÀ-ÿ]/;

function ratio(re, text) {
  const chars = [...String(text || "")].filter((c) => /\S/.test(c));
  if (!chars.length) return 0;
  return chars.filter((c) => re.test(c)).length / chars.length;
}

function wordHits(text, words) {
  const t = String(text || "").toLowerCase();
  let n = 0;
  for (const w of words) {
    if (new RegExp(`\\b${w}\\b`, "i").test(t)) n++;
  }
  return n;
}

function detectLanguage(text) {
  const t = String(text || "").trim();
  if (!t) return { code: "unknown", label: LANG_LABELS.unknown, confidence: 0 };

  const scores = [
    { code: "ar", conf: ratio(ARABIC, t) },
    { code: "he", conf: ratio(HEBREW, t) },
    { code: "ru", conf: ratio(CYRILLIC, t) * (wordHits(t, ["и", "в", "на", "не"]) ? 1.15 : 1) },
    { code: "hi", conf: ratio(DEVANAGARI, t) },
    { code: "zh", conf: ratio(CJK_HAN, t) * (ratio(HIRAGANA_KATA, t) > 0.05 ? 0.3 : 1) },
    { code: "ja", conf: ratio(HIRAGANA_KATA, t) },
    { code: "ko", conf: ratio(HANGUL, t) },
    {
      code: "pl",
      conf:
        ratio(POLISH_CHARS, t) * 2.2 +
        (wordHits(t, ["się", "jest", "nie", "jak", "to", "że"]) >= 2 ? 0.25 : 0),
    },
  ];

  const latin = ratio(LATIN, t);
  if (latin > 0.45 && (scores.find((s) => s.code === "pl")?.conf || 0) < 0.15) {
    const en = wordHits(t, ["the", "and", "you", "this", "that", "with", "from", "what", "not"]);
    const es = wordHits(t, ["el", "la", "de", "que", "en", "los", "una", "por"]);
    const fr = wordHits(t, ["le", "la", "les", "des", "une", "dans", "pour", "est"]);
    const pt = wordHits(t, ["o", "a", "de", "que", "em", "uma", "para", "não"]);
    const de = wordHits(t, ["der", "die", "das", "und", "ist", "nicht", "ein"]);
    const it = wordHits(t, ["il", "lo", "la", "di", "che", "per", "una", "non", "sono"]);
    scores.push({ code: "en", conf: en >= 1 ? 0.35 + en * 0.08 : latin * 0.35 });
    scores.push({ code: "es", conf: es >= 2 ? 0.35 + es * 0.07 : 0 });
    scores.push({ code: "fr", conf: fr >= 2 ? 0.35 + fr * 0.07 : 0 });
    scores.push({ code: "pt", conf: pt >= 2 ? 0.32 + pt * 0.07 : 0 });
    scores.push({ code: "de", conf: de >= 2 ? 0.32 + de * 0.07 : 0 });
    scores.push({ code: "it", conf: it >= 2 ? 0.32 + it * 0.07 : 0 });
  }

  scores.sort((a, b) => b.conf - a.conf);
  const top = scores[0];
  if (!top || top.conf < 0.08) {
    if (latin > 0.4)
      return { code: "en", label: LANG_LABELS.en, confidence: 0.28, model: getLanguageModel("en") };
    return { code: "unknown", label: LANG_LABELS.unknown, confidence: 0 };
  }
  return {
    code: top.code,
    label: getLanguageModel(top.code).label,
    confidence: Math.min(1, top.conf),
    model: getLanguageModel(top.code),
  };
}

function resolveSourceLang(requested, detected) {
  if (requested && requested !== "auto" && requested !== "unknown") {
    const model = getLanguageModel(requested);
    return { code: model.code, label: model.label, confidence: 1, forced: true, model };
  }
  const model = getLanguageModel(detected.code === "unknown" ? "auto" : detected.code);
  return {
    code: detected.code,
    label: detected.label || model.label,
    confidence: detected.confidence,
    forced: false,
    model: detected.model || model,
  };
}

// --- translation ---
function chunkText(text, maxLen = 900) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t.length <= maxLen) return [t];
  const parts = [];
  // split by sentences first
  const sentences = t.split(/(?<=[.!?…。؟])\s+/);
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).trim().length > maxLen) {
      if (buf.trim()) parts.push(buf.trim());
      if (s.length > maxLen) {
        // hard split long sentence
        for (let i = 0; i < s.length; i += maxLen) {
          parts.push(s.slice(i, i + maxLen));
        }
        buf = "";
      } else {
        buf = s;
      }
    } else {
      buf = (buf + " " + s).trim();
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.length ? parts : [t.slice(0, maxLen)];
}

function nmtGoogleCodes(sourceCode, targetCode) {
  const srcModel = getLanguageModel(sourceCode || "auto");
  const tgtModel = getLanguageModel(targetCode || "pl");
  let src = srcModel.google || "auto";
  let tgt = tgtModel.google || "pl";
  if (src === "autodetect" || src === "unknown") src = "auto";
  // deep_translator / gtx expect plain codes; zh-CN ok for google
  return { src, tgt };
}

/**
 * Free Google Translate web endpoint (no API key) — reliable EN↔PL and multi-lang.
 */
async function translateGoogleGtx(text, sourceCode, targetCode) {
  const t = String(text || "").trim();
  if (!t) return null;
  const { src, tgt } = nmtGoogleCodes(sourceCode, targetCode);
  if (src === tgt && sourceCode !== "auto") return t;
  const sl = src === "auto" ? "auto" : src;
  const tl = tgt || "pl";
  try {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" +
      encodeURIComponent(sl) +
      "&tl=" +
      encodeURIComponent(tl) +
      "&dt=t&q=" +
      encodeURIComponent(t.slice(0, 4500));
    const res = await fetch(url, {
      headers: {
        Accept: "*/*",
        "User-Agent": "ClipForge/1.0",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const out = (json?.[0] || [])
      .map((row) => (row && row[0] ? row[0] : ""))
      .join("");
    const cleaned = String(out || "").trim();
    return cleaned || null;
  } catch {
    return null;
  }
}

function translateGooglePythonChunk(text, sourceCode, targetCode) {
  const t = String(text || "").trim();
  if (!t) return null;
  const { src, tgt } = nmtGoogleCodes(sourceCode, targetCode);
  if (src === tgt && sourceCode !== "auto" && sourceCode === targetCode) {
    return t;
  }
  const payload = JSON.stringify({
    text: t.slice(0, 4500),
    source: src === "auto" ? "auto" : src,
    target: tgt,
  });
  const py = `
import json, sys
cfg = json.loads(sys.argv[1])
src = cfg.get("source") or "auto"
if src in ("autodetect", "unknown", ""): src = "auto"
tgt = cfg.get("target") or "pl"
text = cfg.get("text") or ""
out = None
err = None
# 1) deep_translator
try:
    from deep_translator import GoogleTranslator
    out = GoogleTranslator(source=src, target=tgt).translate(text)
except Exception as e1:
    err = str(e1)
    # 2) googletrans if present
    try:
        from googletrans import Translator
        tr = Translator()
        r = tr.translate(text, src=src if src != "auto" else "auto", dest=tgt)
        out = r.text if r else None
    except Exception as e2:
        err = (err or "") + " | " + str(e2)
if out:
    print(json.dumps({"ok": True, "text": out}, ensure_ascii=False))
else:
    print(json.dumps({"ok": False, "error": err or "no translator"}, ensure_ascii=False))
`;
  const r = runPython(["-c", py, payload], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 45000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  try {
    const line = (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
    const j = JSON.parse(line);
    if (j.ok && j.text) return String(j.text).trim();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Full text translation — chunks so long scripts are not cut mid-way.
 * onChunk(partialText, i, total) for live UI.
 */
function translateGooglePython(text, sourceCode, targetCode, onChunk) {
  const t = String(text || "").trim();
  if (!t) return null;
  const srcModel = getLanguageModel(sourceCode || "auto");
  const tgtModel = getLanguageModel(targetCode || "pl");
  let src = srcModel.google || "auto";
  let tgt = tgtModel.google || "pl";
  if (src === "autodetect") src = "auto";
  if (src === tgt || (sourceCode === targetCode && sourceCode !== "auto")) {
    if (onChunk) onChunk(t, 1, 1);
    return t;
  }
  const chunks = chunkText(t, 900);
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const tr = translateGooglePythonChunk(chunks[i], sourceCode, targetCode);
    if (!tr) return out.length ? out.join(" ") : null;
    out.push(tr);
    if (onChunk) onChunk(out.join(" "), i + 1, chunks.length);
  }
  return out.join(" ").trim();
}

async function translateMyMemory(text, srcCode, tgtCode) {
  const srcM = getLanguageModel(srcCode);
  const tgtM = getLanguageModel(tgtCode);
  let src = srcM.mymemory || "en";
  let tgt = tgtM.mymemory || "pl";
  // MyMemory has no true "auto" — leave as en only if completely unknown
  if (src === "autodetect" || src === "auto" || src === "unknown") {
    const det = detectLanguage(text);
    src = det.code && det.code !== "unknown" ? det.code : "en";
    if (src === "zh") src = "zh-CN";
  }
  try {
    const url =
      "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(String(text).slice(0, 480)) +
      "&langpair=" +
      encodeURIComponent(`${src}|${tgt}`);
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "FacePubStudio/1.3" },
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const out = json?.responseData?.translatedText;
    if (out && typeof out === "string" && out.trim() && !/^MYMEMORY WARNING/i.test(out)) {
      return out.trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function translateLibre(text, srcCode, tgtCode) {
  const srcM = getLanguageModel(srcCode);
  const tgtM = getLanguageModel(tgtCode);
  try {
    const res = await fetch("https://libretranslate.com/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        q: String(text).slice(0, 900),
        source:
          !srcM.libre || srcM.libre === "auto" ? "auto" : srcM.libre,
        target: tgtM.libre || "pl",
        format: "text",
      }),
      signal: AbortSignal.timeout(16000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.translatedText) return String(json.translatedText).trim();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Translate text using per-language NMT model pair.
 * @param {function} [onLive] (partial, i, n) => void — live chunk callback
 */
async function translateText(
  text,
  sourceCode = "auto",
  targetCode = "pl",
  onLive,
  options = {}
) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, text: t, error: "pusty tekst" };
  const force = options && options.force === true;

  const det = detectLanguage(t);
  const tgt = targetCode && targetCode !== "auto" ? targetCode : "pl";
  const tgtModel = getLanguageModel(tgt);

  let src =
    sourceCode && sourceCode !== "auto" && sourceCode !== "unknown"
      ? sourceCode
      : det.code !== "unknown"
        ? det.code
        : "auto";

  // already target language — skip only when NOT forced (STT path always forces)
  if (
    !force &&
    (src === tgt ||
      (det.code === tgt && det.confidence > 0.3 && sourceCode === "auto"))
  ) {
    if (typeof onLive === "function") onLive(t, 1, 1);
    return {
      ok: true,
      text: t,
      detected: det,
      skipped: true,
      sourceUsed: det.code,
      target: tgt,
      model: {
        modelId: modelIdFor(tgt, tgt),
        modelName: modelNameFor(tgt, tgt),
        code: tgt,
        nmt: "none",
        ...tgtModel,
      },
    };
  }
  // Forced + same code: still run NMT with auto source so real translation can happen
  if (force && src === tgt) {
    src = "auto";
  }

  const pairModel = {
    ...getLanguageModel(src === "auto" ? "auto" : src),
    modelId: modelIdFor(src, tgt),
    modelName: modelNameFor(src, tgt),
    target: tgt,
    nmt: "google",
  };

  // Prefer free Google web API (works without deep_translator, all language pairs)
  const gtx = await translateGoogleGtx(t, src, tgt);
  if (gtx) {
    if (typeof onLive === "function") onLive(gtx, 1, 1);
    if (ARABIC.test(t) && ARABIC.test(gtx) && tgt !== "ar" && src !== "ar") {
      return translateText(t, "ar", tgt, onLive, options);
    }
    return {
      ok: true,
      text: gtx,
      detected: det,
      engine: "google-gtx",
      sourceUsed: src,
      target: tgt,
      model: pairModel,
    };
  }

  const g = translateGooglePython(
    t,
    src,
    tgt,
    typeof onLive === "function" ? onLive : null
  );
  if (g) {
    if (ARABIC.test(t) && ARABIC.test(g) && tgt !== "ar" && src !== "ar") {
      return translateText(t, "ar", tgt, onLive, options);
    }
    return {
      ok: true,
      text: g,
      detected: det,
      engine: "google-nmt",
      sourceUsed: src,
      target: tgt,
      model: pairModel,
    };
  }

  // chunked gtx for long text if single call failed
  if (t.length > 400) {
    const chunks = chunkText(t, 900);
    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      const part = await translateGoogleGtx(chunks[i], src, tgt);
      if (!part) break;
      out.push(part);
      if (typeof onLive === "function") onLive(out.join(" "), i + 1, chunks.length);
    }
    if (out.length === chunks.length && out.length) {
      return {
        ok: true,
        text: out.join(" ").trim(),
        detected: det,
        engine: "google-gtx-chunked",
        sourceUsed: src,
        target: tgt,
        model: pairModel,
      };
    }
  }

  const mm = await translateMyMemory(t, src === "auto" ? "auto" : src, tgt);
  if (mm) {
    if (typeof onLive === "function") onLive(mm, 1, 1);
    return {
      ok: true,
      text: mm,
      detected: det,
      engine: "mymemory",
      sourceUsed: src,
      target: tgt,
      model: { ...pairModel, nmt: "mymemory" },
    };
  }

  const lb = await translateLibre(t, src, tgt);
  if (lb) {
    if (typeof onLive === "function") onLive(lb, 1, 1);
    return {
      ok: true,
      text: lb,
      detected: det,
      engine: "libretranslate",
      sourceUsed: src,
      target: tgt,
      model: { ...pairModel, nmt: "libre" },
    };
  }

  return {
    ok: false,
    text: t,
    detected: det,
    target: tgt,
    model: pairModel,
    error: "Model NMT nie zwrócił tłumaczenia. Wklej tekst ręcznie.",
  };
}

/** @deprecated use translateText */
async function translateToPolish(text, sourceCode = "auto") {
  return translateText(text, sourceCode, "pl");
}

// --- situation wrappers (FULL narrator — multi-sentence, not a one-liner) ---
function toSituationScript(text, targetCode, durationSec = 0) {
  const body = String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?…]+$/, "");
  const dur = Number(durationSec) || 0;
  const longClip = dur >= 45;

  const templates = {
    pl: {
      empty: longClip
        ? "Oglądasz dłuższy klip, w którym akcja rozwija się stopniowo. Na początku scena wygląda zwyczajnie, ale z każdą chwilą napięcie rośnie. Bohaterowie reagują w sposób, którego trudno się spodziewać. W połowie nagrania widać zwrot akcji, a pod koniec całość układa się w zaskakującą puentę. Warto oglądać do samego końca — dopiero wtedy widać, o co naprawdę chodziło."
        : "Oglądasz krótki viralowy filmik. Na starcie wszystko wygląda zwyczajnie, ale sytuacja szybko wymyka się spod kontroli. Obserwuj reakcje ludzi na ekranie — w kulminacyjnym momencie widać, o co chodzi. To klasyczny moment internetowy: puenta przychodzi nagle i zostaje w pamięci.",
      full: (b) =>
        `Na tym nagraniu rozgrywa się konkretna sytuacja. ${b}. ` +
        `Na początku widać kontekst i bohaterów — scena wygląda niewinnie, ale szybko nabiera tempa. ` +
        `W miarę trwania filmu napięcie rośnie: gesty, reakcje i szczegóły w tle składają się w jedną historię. ` +
        (longClip
          ? `W środkowej części pojawia się zwrot, który zmienia odbiór całości, a zakończenie domyka opowieść z jasną puentą. `
          : `W kulminacyjnym momencie wszystko się wyjaśnia. `) +
        `To właśnie ten rodzaj klipu, który ogląda się do końca — bo dopiero wtedy widać, na czym polega żart albo dramat.`,
    },
    en: {
      empty: longClip
        ? "You are watching a longer clip where the story builds step by step. At first the scene feels ordinary, but tension rises as it goes. The people on screen react in ways you would not expect. Midway there is a clear turn, and the ending delivers the real punchline. Stay until the end — that is when it all clicks."
        : "You are watching a short viral clip. It starts ordinary, then quickly goes off the rails. Watch the reactions carefully — the payoff lands in a single beat. Classic internet moment: sudden punchline, hard to forget.",
      full: (b) =>
        `Here is what happens in this video. ${b}. ` +
        `At the start you see the setup and the people involved — it looks innocent, then the pace picks up. ` +
        `As the clip continues, details pile up: gestures, timing, and background clues form one story. ` +
        (longClip
          ? `In the middle there is a turn that changes how you read the whole thing, and the ending closes it with a clear punchline. `
          : `At the peak moment everything clicks into place. `) +
        `This is the kind of clip you watch to the end — the joke or the drama only lands in the final beat.`,
    },
    de: {
      empty:
        "Du siehst einen kurzen Clip. Zuerst wirkt alles normal, dann eskaliert die Situation. Achte auf die Reaktionen — die Pointe kommt plötzlich. Bis zum Ende schauen lohnt sich.",
      full: (b) =>
        `In diesem Video passiert Folgendes. ${b}. ` +
        `Am Anfang sieht man den Kontext und die Personen — harmlos, dann wird es schneller. ` +
        `Spannung und Details bauen sich auf, bis die Pointe greift. Bis zum Schluss schauen.`,
    },
    es: {
      empty:
        "Estás viendo un clip corto. Empieza normal y de pronto se complica. Mira las reacciones: el remate llega de golpe. Vale la pena verlo hasta el final.",
      full: (b) =>
        `En este vídeo ocurre lo siguiente. ${b}. ` +
        `Al inicio se ve el contexto y las personas; parece inocente y luego sube el ritmo. ` +
        `Los detalles se acumulan hasta la culminación. Conviene verlo hasta el final.`,
    },
    fr: {
      empty:
        "Tu regardes une courte vidéo. Au début tout paraît normal, puis la situation dérape. Regarde les réactions — la chute arrive d’un coup. À voir jusqu’au bout.",
      full: (b) =>
        `Voici ce qui se passe dans cette vidéo. ${b}. ` +
        `Au départ on voit le contexte et les personnages — ça a l’air anodin, puis le rythme monte. ` +
        `Les détails s’accumulent jusqu’au moment fort. À regarder jusqu’à la fin.`,
    },
    it: {
      empty:
        "Stai guardando un clip breve. Parte normale, poi la situazione sfugge. Guarda le reazioni: la battuta arriva di colpo. Vale la pena arrivare alla fine.",
      full: (b) =>
        `Ecco cosa succede in questo video. ${b}. ` +
        `All’inizio si vedono il contesto e le persone — sembra innocente, poi il ritmo sale. ` +
        `I dettagli si accumulano fino al momento clou. Da vedere fino alla fine.`,
    },
    pt: {
      empty:
        "Você está vendo um clipe curto. Começa normal e logo complica. Observe as reações — a punchline vem de repente. Vale ver até o fim.",
      full: (b) =>
        `Veja o que acontece neste vídeo. ${b}. ` +
        `No início aparece o contexto e as pessoas — parece inocente e o ritmo sobe. ` +
        `Os detalhes se acumulam até o clímax. Vale assistir até o final.`,
    },
    ru: {
      empty:
        "Вы смотрите короткий ролик. Сначала всё обычно, потом ситуация выходит из-под контроля. Смотрите реакции — пуанта приходит внезапно. Досмотрите до конца.",
      full: (b) =>
        `Вот что происходит в этом ролике. ${b}. ` +
        `Сначала виден контекст и герои — выглядит безобидно, затем темп растёт. ` +
        `Детали складываются к кульминации. Смотрите до конца.`,
    },
    ar: {
      empty:
        "تشاهد مقطعاً قصيراً. يبدأ بشكل عادي ثم تتفاقم الأمور. راقب ردود الفعل — الخاتمة تأتي فجأة. يستحق المشاهدة حتى النهاية.",
      full: (b) =>
        `إليك ما يحدث في هذا الفيديو. ${b}. ` +
        `في البداية يظهر السياق والأشخاص — يبدو بريئاً ثم يتسارع الإيقاع. ` +
        `التفاصيل تتراكم حتى لحظة الذروة. شاهد حتى النهاية.`,
    },
    hi: {
      empty:
        "आप एक छोटा क्लिप देख रहे हैं। शुरू में सब सामान्य लगता है, फिर स्थिति बिगड़ती है। प्रतिक्रियाएँ देखें — अंत अचानक आता है। अंत तक देखें।",
      full: (b) =>
        `इस वीडियो में यह होता है। ${b}. ` +
        `शुरू में संदर्भ और लोग दिखते हैं — निर्दोष लगता है, फिर रफ्तार बढ़ती है। ` +
        `विवरण चरम क्षण तक जुड़ते हैं। अंत तक देखें।`,
    },
    zh: {
      empty:
        "你正在看一段短视频。一开始很平常，随后局面失控。注意人物反应——笑点或转折来得很突然。建议看到最后。",
      full: (b) =>
        `这段视频里发生了这些事。${b}。` +
        `开头能看到场景和人物——看似平常，随后节奏加快。` +
        `细节一路堆积到高潮。建议看到最后。`,
    },
  };

  const t = templates[targetCode] || templates.en;
  if (!body) return t.empty;

  // Already a long situation monologue — keep, maybe pad lightly
  if (
    body.length > 220 &&
    /^(na tym|na filmie|here is what|in this|en este|voici|ecco|veja|вот|إليك|इस|这段)/i.test(
      body
    )
  ) {
    return body.endsWith(".") || body.endsWith("。") ? body : body + ".";
  }

  return t.full(body);
}

/**
 * Google STT locale tags for SpeechRecognition.
 */
function sttLocale(code) {
  const map = {
    en: "en-US",
    pl: "pl-PL",
    ar: "ar-SA",
    zh: "zh-CN",
    hi: "hi-IN",
    es: "es-ES",
    fr: "fr-FR",
    it: "it-IT",
    pt: "pt-BR",
    ru: "ru-RU",
    de: "de-DE",
  };
  return map[code] || null;
}

/**
 * Extract spoken / audible text from a video via ffmpeg + Google Web Speech.
 * Chunks audio (~40s) so free STT limit is not hit. Returns best-effort text.
 *
 * @param {string} videoPath
 * @param {{ sourceLang?: string, maxSeconds?: number, workDir?: string, ffmpeg?: string, onProgress?: Function }} opts
 * @returns {{ text: string, engine: string|null, chunks: number, error: string|null, partial: string[] }}
 */
function localeToLangCode(locale) {
  if (!locale) return null;
  const base = String(locale).split("-")[0].toLowerCase();
  if (base === "zh" || base === "cmn") return "zh";
  if (base === "uk") return "uk"; // keep; NMT path may remap
  if (LANGUAGE_MODELS[base]) return base;
  return base.length === 2 ? base : null;
}

function extractSpeechFromVideo(videoPath, opts = {}) {
  const result = {
    text: "",
    engine: null,
    langCode: null,
    chunks: 0,
    error: null,
    partial: [],
    segments: [],
  };
  if (!videoPath || !fs.existsSync(videoPath)) {
    result.error = "brak pliku wideo";
    return result;
  }

  let ffmpegBin = opts.ffmpeg;
  if (!ffmpegBin) {
    try {
      ffmpegBin = require("ffmpeg-static");
    } catch {
      ffmpegBin = "ffmpeg";
    }
  }

  const workDir =
    opts.workDir ||
    path.join(require("os").tmpdir(), "clipforge-stt-" + Date.now());
  fs.mkdirSync(workDir, { recursive: true });
  // Full clip when possible — cap at 20 min (or one segment length)
  const maxSec = Math.round(
    Math.min(Math.max(Number(opts.maxSeconds) || 600, 5), 1200)
  );
  const startSec = Math.max(0, Number(opts.startSec) || 0);
  const srcCode =
    opts.sourceLang &&
    opts.sourceLang !== "auto" &&
    opts.sourceLang !== "unknown"
      ? opts.sourceLang
      : "auto";
  const locale = srcCode === "auto" ? "auto" : sttLocale(srcCode) || "en-US";

  const resultJsonPath = path.join(workDir, "stt_result.json");
  const sttScript = path.join(__dirname, "stt-google.py");

  function readResultFile() {
    if (!fs.existsSync(resultJsonPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(resultJsonPath, "utf8"));
    } catch {
      return null;
    }
  }

  function applyParsed(parsed) {
    if (!parsed) return result;
    result.text = String(parsed.text || "").trim();
    result.engine = parsed.engine || null;
    result.langCode =
      parsed.langCode ||
      localeToLangCode(
        parsed.engine && String(parsed.engine).includes(":")
          ? String(parsed.engine).split(":")[1]
          : parsed.lockedLang || null
      );
    result.chunks = Number(parsed.chunks) || 0;
    result.error = parsed.error || null;
    result.partial = Array.isArray(parsed.partial) ? parsed.partial : [];
    result.segments = Array.isArray(parsed.segments)
      ? parsed.segments
          .map((s) => ({
            start: Number(s.start) || 0,
            end: Number(s.end) || 0,
            text: String(s.text || "").trim(),
          }))
          .filter((s) => s.text)
      : [];
    result.audioDuration = Number(parsed.audioDuration) || 0;
    result.coverageStart =
      parsed.coverageStart != null ? Number(parsed.coverageStart) : null;
    result.coverageEnd =
      parsed.coverageEnd != null ? Number(parsed.coverageEnd) : null;
    result.attempted = Number(parsed.attempted) || 0;
    result.failed = Number(parsed.failed) || 0;
    result.lockedLang = parsed.lockedLang || null;
    if (result.segments.length) {
      // Offset segment times to absolute video timeline when startSec set
      if (startSec > 0) {
        result.segments = result.segments.map((s) => ({
          ...s,
          start: s.start + startSec,
          end: s.end + startSec,
        }));
        if (result.coverageStart != null)
          result.coverageStart += startSec;
        if (result.coverageEnd != null) result.coverageEnd += startSec;
      }
      result.text = result.segments
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      result.partial = result.segments.map((s) => s.text);
      result.chunks = result.segments.length;
    }
    // Partial success is still success — clear error if we have text
    if (result.text && result.text.length >= 3) {
      result.error = null;
    }
    return result;
  }

  try {
    if (typeof opts.onProgress === "function") {
      opts.onProgress({
        phase: "extracting",
        msg:
          startSec > 0
            ? `Wyodrębniam mowę · segment od ${startSec.toFixed(0)}s…`
            : "Wyodrębniam mowę z wideo…",
      });
    }
    if (!fs.existsSync(sttScript)) {
      result.error = "Brak lib/stt-google.py";
      return result;
    }
    // Per-segment shorter timeout; full-video path keeps longer budget
    const timeoutMs = Math.min(
      startSec > 0 || maxSec <= 40 ? 8 * 60 * 1000 : 45 * 60 * 1000,
      Math.max(90 * 1000, maxSec * (startSec > 0 ? 8000 : 10000))
    );
    const pyArgs = [
      sttScript,
      videoPath,
      ffmpegBin,
      workDir,
      String(maxSec),
      locale || "auto",
      resultJsonPath,
      String(startSec || 0),
    ];
    const r = runPython(pyArgs, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 40 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });
    const rawOut = (r.stdout || "").trim();
    const rawErr = (r.stderr || "").trim();
    let parsed = readResultFile();
    if (!parsed && rawOut) {
      const lines = rawOut.split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const line = JSON.parse(lines[i]);
          if (line && line.path && fs.existsSync(line.path)) {
            parsed = JSON.parse(fs.readFileSync(line.path, "utf8"));
            break;
          }
          if (line && (line.text != null || line.error != null)) {
            parsed = line;
            break;
          }
        } catch {
          /* try previous */
        }
      }
    }
    // Timeout / kill: still use partial transcript if written
    if (!parsed) {
      result.error =
        rawErr.slice(-400) ||
        (rawOut
          ? "STT: zły JSON: " + rawOut.slice(0, 180)
          : "STT: brak odpowiedzi (kod " + r.status + ")");
      return result;
    }
    applyParsed(parsed);
    if (
      !result.text &&
      (r.status == null || r.error || r.signal) &&
      !result.error
    ) {
      result.error =
        "STT przerwany (timeout/signal) bez tekstu — spróbuj krótszego klipu lub ustaw język źródłowy ręcznie";
    } else if (
      result.text &&
      (r.status == null || r.status !== 0) &&
      !result.error
    ) {
      // partial recovered after timeout — OK
      result.engine = (result.engine || "stt") + "+partial";
    }
    return result;
  } catch (e) {
    // Last chance: partial file
    const partial = readResultFile();
    if (partial && (partial.text || (partial.segments && partial.segments.length))) {
      return applyParsed(partial);
    }
    result.error = e && e.message ? e.message : String(e);
    return result;
  }
}

/** Seconds per STT segment (user: 6s). */
const STT_SEGMENT_SEC = 6;

/**
 * Segmented STT: split video timeline into ~STT_SEGMENT_SEC parts,
 * run STT per segment, report progress after each (UI no longer stuck at 10%).
 *
 * @param {string} videoPath
 * @param {{
 *   sourceLang?: string,
 *   maxSeconds?: number,
 *   workDir?: string,
 *   ffmpeg?: string,
 *   segmentSec?: number,
 *   onSegment?: (info: object) => void,
 *   onProgress?: Function
 * }} opts
 */
function extractSpeechFromVideoSegmented(videoPath, opts = {}) {
  const totalDur = Math.max(
    1,
    Math.min(Number(opts.maxSeconds) || 600, 1200)
  );
  const segSec = Math.max(
    5,
    Math.min(Number(opts.segmentSec) || STT_SEGMENT_SEC, 20)
  );
  // Only split when long enough — short clips one pass
  const nSeg =
    totalDur > segSec * 1.15 ? Math.ceil(totalDur / segSec) : 1;
  const chunkDur = totalDur / nSeg;

  const merged = {
    text: "",
    engine: null,
    langCode: null,
    chunks: 0,
    error: null,
    partial: [],
    segments: [],
    /** One entry per outer STT time slice (e.g. 10×10s) — for TTS 1:1 */
    timelineSegments: [],
    audioDuration: totalDur,
    coverageStart: null,
    coverageEnd: null,
    attempted: 0,
    failed: 0,
    lockedLang: null,
    sttSegments: nSeg,
  };

  let lockedSource =
    opts.sourceLang &&
    opts.sourceLang !== "auto" &&
    opts.sourceLang !== "unknown"
      ? opts.sourceLang
      : "auto";

  const baseWork =
    opts.workDir ||
    path.join(require("os").tmpdir(), "clipforge-stt-seg-" + Date.now());
  fs.mkdirSync(baseWork, { recursive: true });

  for (let i = 0; i < nSeg; i++) {
    const startSec = i * chunkDur;
    const lenSec =
      i === nSeg - 1
        ? Math.max(0.5, totalDur - startSec)
        : chunkDur;

    if (typeof opts.onSegment === "function") {
      opts.onSegment({
        index: i,
        total: nSeg,
        startSec,
        lenSec,
        pct: Math.round((i / nSeg) * 100),
        phase: "start",
      });
    }

    const part = extractSpeechFromVideo(videoPath, {
      sourceLang: lockedSource,
      maxSeconds: Math.ceil(lenSec + 0.5),
      startSec,
      workDir: path.join(baseWork, "seg_" + String(i).padStart(2, "0")),
      ffmpeg: opts.ffmpeg,
      onProgress: opts.onProgress,
    });

    merged.attempted += Number(part.attempted) || 0;
    merged.failed += Number(part.failed) || 0;
    if (part.engine) merged.engine = part.engine;
    if (part.lockedLang) merged.lockedLang = part.lockedLang;

    // Lock language after first successful segment (faster, more consistent)
    if (
      (lockedSource === "auto" || !lockedSource) &&
      part.langCode &&
      getLanguageModel(part.langCode).code === part.langCode
    ) {
      lockedSource = part.langCode;
      merged.langCode = part.langCode;
    } else if (part.langCode && !merged.langCode) {
      merged.langCode = part.langCode;
    }

    // Collect all speech inside this outer 10s (or N s) window
    const sliceTexts = [];
    if (Array.isArray(part.segments) && part.segments.length) {
      for (const s of part.segments) {
        if (s && s.text) {
          merged.segments.push(s);
          sliceTexts.push(String(s.text).trim());
        }
      }
    } else if (part.text && part.text.trim().length >= 2) {
      const t = part.text.trim();
      merged.segments.push({
        start: startSec,
        end: startSec + lenSec,
        text: t,
      });
      sliceTexts.push(t);
    }
    // Outer timeline slot — always one per STT segment (for lektor 1:1)
    const slotText = sliceTexts.join(" ").replace(/\s+/g, " ").trim();
    merged.timelineSegments.push({
      start: startSec,
      end: startSec + lenSec,
      text: slotText,
      silent: !slotText,
      sttIndex: i,
    });

    // Build running text for live UI
    const running = merged.timelineSegments
      .map((s) => s.text)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    merged.text = running ||
      merged.segments
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    merged.partial = merged.timelineSegments.map((s) => s.text).filter(Boolean);
    merged.chunks = merged.timelineSegments.length;
    if (merged.timelineSegments.length) {
      merged.coverageStart = merged.timelineSegments[0].start;
      const lastWith = [...merged.timelineSegments].reverse().find((s) => s.text);
      merged.coverageEnd = lastWith
        ? lastWith.end
        : merged.timelineSegments[merged.timelineSegments.length - 1].end;
    }

    if (typeof opts.onSegment === "function") {
      opts.onSegment({
        index: i,
        total: nSeg,
        startSec,
        lenSec,
        pct: Math.round(((i + 1) / nSeg) * 100),
        phase: "done",
        textSoFar: running,
        segText: slotText || part.text || "",
        langCode: merged.langCode || lockedSource,
        engine: part.engine,
        ok: !!slotText,
      });
    }

    // Intro often has music/silence — do NOT abort after only 3 empty windows
    // (speech may start mid-clip). Scan enough of the file first.
    const silentRun = merged.timelineSegments.filter((s) => s.silent).length;
    const spokenRun = merged.timelineSegments.filter((s) => !s.silent).length;
    const minScan = Math.min(
      nSeg,
      Math.max(6, Math.ceil(nSeg * 0.55))
    );
    if (
      i + 1 >= minScan &&
      spokenRun === 0 &&
      silentRun >= minScan &&
      nSeg > 5
    ) {
      merged.error =
        "Brak mowy w większej części nagrania — STT puste (spróbuj napisów z filmu albo wklej tekst)";
      merged.musicLikely = true;
      if (typeof opts.onSegment === "function") {
        opts.onSegment({
          index: i,
          total: nSeg,
          pct: 100,
          phase: "done",
          textSoFar: "",
          segText: "",
          ok: false,
          earlyExit: true,
          musicLikely: true,
        });
      }
      break;
    }
    // Sparse speech: only stop near the end if hit rate stays tiny
    if (
      i + 1 >= Math.max(10, Math.ceil(nSeg * 0.7)) &&
      spokenRun > 0 &&
      spokenRun / (i + 1) < 0.12 &&
      nSeg > 12
    ) {
      merged.musicLikely = spokenRun < 3;
      merged.error =
        merged.error ||
        "Słaba rozpoznawalność mowy — kończę STT (mam częściowy tekst)";
      break;
    }
  }

  if (merged.text && merged.text.length >= 3) {
    merged.error = null;
  } else {
    merged.error =
      merged.error ||
      "Brak mowy / STT nie rozpoznał tekstu w żadnym segmencie (typowe dla czystej muzyki bez napisów YT)";
  }
  return merged;
}

/**
 * Prepare narrator/subtitle script in TARGET language.
 */
async function preparePolishScript(opts) {
  // keep name for compatibility; now multi-target
  return prepareNarratorScript(opts);
}

async function prepareNarratorScript({
  title,
  description,
  narratorScript,
  forceTranslate,
  narratorMode = "translate",
  sourceLang = "auto",
  targetLang = "pl",
  durationSec = 0,
  fromTranscript = false,
  onLive,
}) {
  const mode = narratorMode === "describe" ? "describe" : "translate";
  const tgt = targetLang && LANGUAGE_MODELS[targetLang] ? targetLang : "pl";
  const tgtModel = getLanguageModel(tgt);

  // Prefer EXPLICIT script (STT transcript). When fromTranscript, NEVER fall back to title.
  let raw = (narratorScript && narratorScript.trim()) || "";
  if (!raw && !fromTranscript) {
    raw = [title, description].filter(Boolean).join(". ").trim();
  }

  if (!raw) {
    const fallback = toSituationScript("", tgt, durationSec);
    if (onLive) onLive({ phase: "done", liveScript: fallback, liveOriginal: "" });
    return {
      script: fallback,
      detected: { code: tgt, label: tgtModel.label, confidence: 1 },
      sourceLang: { code: tgt, label: tgtModel.label, forced: false, model: tgtModel },
      targetLang: { code: tgt, label: tgtModel.label, model: tgtModel },
      translated: false,
      mode,
      modeLabel: mode === "describe" ? "Opis sytuacji" : "Dokładne tłumaczenie",
      model: {
        modelId: modelIdFor(tgt, tgt),
        modelName: modelNameFor(tgt, tgt),
        ...tgtModel,
      },
    };
  }

  if (onLive) {
    onLive({
      phase: "source",
      liveOriginal: raw,
      liveScript:
        mode === "translate"
          ? fromTranscript
            ? "… mam TRANSKRYPCJĘ — tłumaczę na język docelowy …"
            : "… mam tekst źródłowy — tłumaczę na żywo …"
          : "… buduję pełny opis sytuacji …",
    });
  }

  const detected = detectLanguage(raw);
  // STT language is only a HINT — text detector often more accurate for Latin langs
  const source = resolveSourceLang(sourceLang, detected);
  const sttForced =
    sourceLang &&
    sourceLang !== "auto" &&
    sourceLang !== "unknown" &&
    LANGUAGE_MODELS[sourceLang];
  if (sttForced) {
    // Trust STT locale only when detector agrees OR detector is weak/unknown
    const agree =
      detected.code === "unknown" ||
      detected.code === sourceLang ||
      (detected.confidence || 0) < 0.28;
    if (agree) {
      source.code = sourceLang;
      source.label = getLanguageModel(sourceLang).label;
      source.forced = true;
      source.model = getLanguageModel(sourceLang);
    } else {
      // e.g. STT said pl-PL but text is clearly English → use detector
      source.code = detected.code;
      source.label = detected.label || getLanguageModel(detected.code).label;
      source.forced = false;
      source.confidence = detected.confidence;
      source.model = getLanguageModel(detected.code);
      source.sttHint = sourceLang;
    }
  }

  let outText = raw;
  let translated = false;
  let engine = null;
  let translateError = null;
  let original = null;
  let usedModel = {
    modelId: modelIdFor(source.code, tgt),
    modelName: modelNameFor(source.code, tgt),
    ...getLanguageModel(source.code === "unknown" ? "auto" : source.code),
    target: tgt,
  };

  // Need translation whenever target language differs from actual text language
  const textLooksLikeTarget =
    detected.code === tgt && (detected.confidence || 0) > 0.5;
  const sourceIsTarget = source.code === tgt;
  const sameLang =
    !fromTranscript &&
    textLooksLikeTarget &&
    (sourceIsTarget || sourceLang === "auto");

  // ALWAYS translate transcript / user script when target differs from detected/source
  const mustTranslate =
    forceTranslate !== false &&
    tgt &&
    !(sourceIsTarget && textLooksLikeTarget) &&
    (fromTranscript ||
      !sameLang ||
      (detected.code !== "unknown" && detected.code !== tgt) ||
      (source.code !== "unknown" && source.code !== tgt));

  if (mustTranslate) {
    if (onLive) {
      onLive({
        phase: "translating",
        liveOriginal: raw,
        liveScript: "… tłumaczenie transkrypcji w toku …",
      });
    }
    // Prefer auto for NMT when STT and detector disagree, or source unknown
    let srcForNmt = "auto";
    if (source.forced && source.code && source.code !== "unknown") {
      srcForNmt = source.code;
    } else if (detected.code && detected.code !== "unknown") {
      srcForNmt = detected.code;
    }
    // Never force wrong PL when text has no Polish chars and detector says EN
    if (
      srcForNmt === "pl" &&
      !POLISH_CHARS.test(raw) &&
      detected.code === "en" &&
      (detected.confidence || 0) >= 0.25
    ) {
      srcForNmt = "en";
    }

    const tr = await translateText(
      raw,
      srcForNmt,
      tgt,
      (partial, i, n) => {
        if (onLive) {
          onLive({
            phase: "translating",
            liveOriginal: raw,
            liveScript: partial,
            chunk: i,
            chunks: n,
          });
        }
      },
      { force: true }
    );
    if (tr.ok && tr.text) {
      outText = tr.text;
      // If engine returned identical text but languages should differ, retry auto
      if (
        outText.trim().toLowerCase() === raw.trim().toLowerCase() &&
        tgt !== srcForNmt
      ) {
        const tr2 = await translateText(raw, "auto", tgt, null, {
          force: true,
        });
        if (
          tr2.ok &&
          tr2.text &&
          tr2.text.trim().toLowerCase() !== raw.trim().toLowerCase()
        ) {
          outText = tr2.text;
          translated = true;
          engine = tr2.engine || tr.engine;
          usedModel = tr2.model || usedModel;
        } else {
          translated = !tr.skipped;
          engine = tr.engine || null;
          usedModel = tr.model || usedModel;
        }
      } else {
        translated = !tr.skipped;
        engine = tr.engine || null;
        usedModel = tr.model || usedModel;
      }
      original = raw;
      if (tr.sourceUsed && tr.sourceUsed !== "auto") {
        source.code = tr.sourceUsed;
        source.label = getLanguageModel(tr.sourceUsed).label;
        source.model = getLanguageModel(tr.sourceUsed);
      }
    } else {
      translateError = tr.error || "tłumaczenie niedostępne";
      outText = raw;
      original = raw;
      usedModel = tr.model || usedModel;
    }
  } else if (onLive) {
    onLive({ phase: "same-lang", liveOriginal: raw, liveScript: raw });
  }

  let script = outText;
  if (mode === "describe") {
    // Always build a full monologue — even from short seed / empty STT
    script = toSituationScript(outText || raw || "", tgt, durationSec);
    if (onLive) {
      onLive({
        phase: "done",
        liveOriginal: original || raw || "",
        liveScript: script,
      });
    }
  } else {
    // Exact translation: keep full extracted/translated text, light cleanup
    script = outText
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1");
    if (script && !/[.!?…。؟।]$/.test(script)) script += tgt === "zh" ? "。" : ".";
  }

  if (onLive) {
    onLive({
      phase: "done",
      liveOriginal: original || raw,
      liveScript: script,
      translated,
    });
  }

  return {
    script,
    detected,
    sourceLang: source,
    targetLang: { code: tgt, label: tgtModel.label, model: tgtModel },
    translated,
    engine,
    original,
    translateError,
    mode,
    modeLabel: mode === "describe" ? "Opis sytuacji" : "Dokładne tłumaczenie",
    model: usedModel,
  };
}

// --- TTS multi-language via edge-tts (segmented like STT / AI video) ---
/**
 * ~chars per TTS segment ≈ 6 seconds of speech.
 * Neural voices ≈ 14–16 chars/s → ~90 for 6s (user request: co 6 s).
 */
const TTS_SEGMENT_CHARS = 90;
/** Target speech seconds per TTS segment (for logs / progress). */
const TTS_SEGMENT_SEC = 6;

function getFfmpeg() {
  try {
    return require("ffmpeg-static");
  } catch {
    return "ffmpeg";
  }
}

function ffmpegConcatPath(p) {
  return String(p).replace(/\\/g, "/").replace(/'/g, "'\\''");
}

/**
 * One Edge TTS segment. Text via UTF-8 file (not argv) — Windows CMD length limits.
 */
function generateEdgeTtsOne(text, voice, outMp3) {
  const dir = path.dirname(outMp3);
  fs.mkdirSync(dir, { recursive: true });
  const txtPath = outMp3.replace(/\.mp3$/i, ".txt");
  fs.writeFileSync(txtPath, String(text || "").trim(), "utf8");
  const py = `
import asyncio, sys
import edge_tts

async def main():
    path = sys.argv[1]
    voice = sys.argv[2]
    out = sys.argv[3]
    with open(path, "r", encoding="utf-8") as f:
        text = f.read().strip()
    if not text:
        raise SystemExit("empty text")
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(out)

asyncio.run(main())
`;
  const r = runPython(["-c", py, txtPath, voice, outMp3], {
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  });
  try {
    fs.unlinkSync(txtPath);
  } catch {
    /* ignore */
  }
  if (r.status !== 0 || !fs.existsSync(outMp3) || fs.statSync(outMp3).size < 200) {
    try {
      if (fs.existsSync(outMp3) && fs.statSync(outMp3).size < 200) {
        fs.unlinkSync(outMp3);
      }
    } catch {
      /* ignore */
    }
    throw new Error(
      "edge-tts failed: " + ((r.stderr || r.stdout || "") + "").slice(0, 400)
    );
  }
  return outMp3;
}

/**
 * Probe media duration in seconds (ffprobe via ffmpeg -i).
 */
function probeMediaDuration(file) {
  const ffmpeg = getFfmpeg();
  const r = spawnSync(ffmpeg, ["-i", file], {
    encoding: "utf8",
    windowsHide: true,
  });
  const err = (r.stderr || "") + (r.stdout || "");
  const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Build timed TTS cues — ALWAYS 1:1 with STT segments when provided
 * (same count, all words spoken including single-word windows).
 * @param {string} script - full target-language text
 * @param {number} videoDur
 * @param {{start:number,end:number,text?:string,silent?:boolean}[]} [sttSegments]
 */
function buildTimedNarratorCues(script, videoDur, sttSegments) {
  const text = String(script || "").trim();
  if (!text) return [];
  const dur = Math.max(1, Number(videoDur) || 30);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  // Prefer STT windows — keep EXACT same count as transcription segments
  if (Array.isArray(sttSegments) && sttSegments.length >= 1) {
    const segs = sttSegments
      .map((s, i) => ({
        start: Math.max(0, Number(s.start) || 0),
        end: Math.max(
          Number(s.start) || 0,
          Number(s.end) || Number(s.start) + TTS_SEGMENT_SEC
        ),
        text: String(s.text || "").trim(),
        silent: !!s.silent,
        sttIndex: s.sttIndex != null ? s.sttIndex : i,
      }))
      .sort((a, b) => a.start - b.start);

    if (!segs.length) return [];

    // If segments already carry the final language text (mapped or original STT),
    // use them 1:1 — only re-split when joined text differs a lot from full script.
    const joinedSeg = segs
      .map((s) => s.text)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
    const sameContent =
      joinedSeg &&
      (norm(joinedSeg) === norm(text) ||
        norm(text).includes(norm(joinedSeg).slice(0, 40)) ||
        norm(joinedSeg).includes(norm(text).slice(0, 40)));

    if (sameContent || segs.every((s) => s.text || s.silent)) {
      // 1:1 — keep every STT slot; use segment text if present, else allocate from script
      const hasAnyText = segs.some((s) => s.text);
      if (hasAnyText && sameContent) {
        return segs.map((seg) => ({
          start: seg.start,
          end: Math.min(dur, Math.max(seg.end, seg.start + 0.5)),
          text: seg.text, // includes single words
          silent: !seg.text,
          sttIndex: seg.sttIndex,
        }));
      }
    }

    // Redistribute FULL script onto N STT slots (all words, same N)
    const n = segs.length;
    const weights = segs.map((s) => {
      const nW = String(s.text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      return Math.max(1, nW);
    });
    const wsum = weights.reduce((a, b) => a + b, 0) || n;
    const raw = weights.map((w) => (words.length * w) / wsum);
    const take = raw.map((x) => Math.floor(x));
    let rem = words.length - take.reduce((a, b) => a + b, 0);
    const order = raw
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < rem; k++) take[order[k % n].i] += 1;
    // STT had words → at least 1 word when possible
    for (let i = 0; i < n; i++) {
      if (segs[i].text && take[i] === 0) {
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
      const t = i === n - 1 ? words.length - idx : take[i];
      const slice = words.slice(idx, idx + Math.max(0, t));
      idx += slice.length;
      out.push({
        start: segs[i].start,
        end: Math.min(dur, Math.max(segs[i].end, segs[i].start + 0.5)),
        text: slice.join(" "),
        silent: slice.length === 0,
        sttIndex: i,
      });
    }
    if (idx < words.length && out.length) {
      const rest = words.slice(idx).join(" ");
      for (let j = out.length - 1; j >= 0; j--) {
        if (!out[j].silent) {
          out[j].text = (out[j].text + " " + rest).trim();
          break;
        }
        if (j === 0) {
          out[0].text = rest;
          out[0].silent = false;
        }
      }
    }
    return out; // length === STT segments
  }

  // No STT times: every TTS_SEGMENT_SEC across full video — all words
  const n = Math.max(1, Math.ceil(dur / TTS_SEGMENT_SEC));
  const raw = Array(n).fill(words.length / n);
  const take = raw.map((x) => Math.floor(x));
  let rem = words.length - take.reduce((a, b) => a + b, 0);
  for (let k = 0; k < rem; k++) take[k % n] += 1;
  const out = [];
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const start = i * TTS_SEGMENT_SEC;
    const end = Math.min(dur, start + TTS_SEGMENT_SEC);
    const t = i === n - 1 ? words.length - idx : take[i];
    const slice = words.slice(idx, idx + Math.max(0, t));
    idx += slice.length;
    out.push({
      start,
      end,
      text: slice.join(" "),
      silent: slice.length === 0,
      sttIndex: i,
    });
  }
  return out;
}

/**
 * Timed narrator: TTS per ~10s window at STT timestamps, so voice spans full video
 * (not one continuous monologue that ends at ~26s while video continues).
 */
function generateTimedNarratorAudio(
  script,
  voice,
  outWav,
  videoDur,
  timedSegments,
  opts = {}
) {
  const ffmpeg = getFfmpeg();
  const dir = path.dirname(outWav);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(outWav, path.extname(outWav));
  const dur = Math.max(1, Number(videoDur) || 30);

  let cues = buildTimedNarratorCues(script, dur, timedSegments);
  if (!cues || !cues.length) {
    // fallback continuous segmented TTS
    return generateEdgeTts(script, voice, outWav, opts);
  }

  // Keep ALL cues in STT order (including single-word). Only skip pure silence.
  cues = cues
    .slice()
    .sort((a, b) => a.start - b.start);

  const partWavs = [];
  const spokenWords = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const cueText = String(c.text || "").trim();
    const window = Math.max(0.8, (c.end || c.start + TTS_SEGMENT_SEC) - c.start);
    if (typeof opts.onSegment === "function") {
      opts.onSegment({
        index: i,
        total: cues.length,
        phase: "start",
        preview: cueText.slice(0, 60) || "(cisza)",
        start: c.start,
        end: c.end,
      });
    }
    // Silence STT window → no TTS (but count still matches progress total)
    if (!cueText || c.silent) {
      if (typeof opts.onSegment === "function") {
        opts.onSegment({
          index: i,
          total: cues.length,
          phase: "done",
          pct: Math.round(((i + 1) / cues.length) * 100),
          skipped: true,
          silent: true,
          start: c.start,
          end: c.end,
        });
      }
      continue;
    }
    spokenWords.push(...cueText.split(/\s+/).filter(Boolean));

    const mp3 = path.join(dir, `${base}_t${String(i).padStart(3, "0")}.mp3`);
    const rawWav = path.join(dir, `${base}_t${String(i).padStart(3, "0")}_raw.wav`);
    const fitWav = path.join(dir, `${base}_t${String(i).padStart(3, "0")}_fit.wav`);

    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        // Even single-word cues must be spoken
        generateEdgeTtsOne(cueText, voice, mp3);
        ok = true;
      } catch {
        /* retry */
      }
    }
    if (!ok) {
      // Last resort: still try continuous later if nothing produced
      if (typeof opts.onSegment === "function") {
        opts.onSegment({
          index: i,
          total: cues.length,
          phase: "done",
          pct: Math.round(((i + 1) / cues.length) * 100),
          skipped: true,
          start: c.start,
          end: c.end,
        });
      }
      continue;
    }

    // mp3 → wav
    spawnSync(
      ffmpeg,
      [
        "-y",
        "-i",
        mp3,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        rawWav,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 120000 }
    );
    if (!fs.existsSync(rawWav)) continue;

    let voiceDur = probeMediaDuration(rawWav) || window;
    // Fit speech into its time window: speed up if longer, pad if shorter
    let filter = "anull";
    if (voiceDur > window * 1.08) {
      // atempo only accepts 0.5–2.0; chain if needed
      let ratio = voiceDur / window;
      const tempos = [];
      while (ratio > 2.0) {
        tempos.push(2.0);
        ratio /= 2.0;
      }
      while (ratio < 0.5) {
        tempos.push(0.5);
        ratio /= 0.5;
      }
      tempos.push(Math.max(0.5, Math.min(2.0, ratio)));
      filter = tempos.map((t) => `atempo=${t.toFixed(4)}`).join(",");
    }
    // pad to exact window length
    filter =
      (filter === "anull" ? "" : filter + ",") +
      `apad=whole_dur=${window.toFixed(3)}`;

    const fit = spawnSync(
      ffmpeg,
      [
        "-y",
        "-i",
        rawWav,
        "-af",
        filter,
        "-t",
        window.toFixed(3),
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        fitWav,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 120000 }
    );
    if (fit.status !== 0 || !fs.existsSync(fitWav)) {
      // use raw without fit
      partWavs.push({ path: rawWav, start: c.start });
    } else {
      partWavs.push({ path: fitWav, start: c.start });
    }

    if (typeof opts.onSegment === "function") {
      opts.onSegment({
        index: i,
        total: cues.length,
        phase: "done",
        pct: Math.round(((i + 1) / cues.length) * 100),
        start: c.start,
        end: c.end,
      });
    }
  }

  // Safety: if we lost words vs full script, fall back to continuous full TTS
  const scriptWords = String(script || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (
    !partWavs.length ||
    (scriptWords.length >= 3 && spokenWords.length < scriptWords.length * 0.85)
  ) {
    // Missing too much text — speak full script continuously then pad to video length
    const cont = generateEdgeTts(script, voice, outWav, opts);
    // Pad/stretch continuous voice to full video duration
    const voiceDur = probeMediaDuration(cont) || 0;
    if (voiceDur > 0.5 && dur > voiceDur + 1) {
      const padded = outWav.replace(/\.wav$/i, "_pad.wav");
      const pad = spawnSync(
        ffmpeg,
        [
          "-y",
          "-i",
          cont,
          "-af",
          `apad=whole_dur=${dur.toFixed(3)}`,
          "-t",
          dur.toFixed(3),
          "-acodec",
          "pcm_s16le",
          "-ar",
          "48000",
          "-ac",
          "2",
          padded,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 120000 }
      );
      if (pad.status === 0 && fs.existsSync(padded)) {
        try {
          fs.copyFileSync(padded, outWav);
        } catch {
          return padded;
        }
      }
    }
    return cont;
  }

  // Place each part at its start via adelay, mix onto silence of full video duration
  const inputs = [];
  partWavs.forEach((p) => {
    inputs.push("-i", p.path);
  });
  const silenceArgs = [
    "-f",
    "lavfi",
    "-t",
    dur.toFixed(3),
    "-i",
    "anullsrc=r=48000:cl=stereo",
  ];

  const filters = [];
  partWavs.forEach((p, i) => {
    const ms = Math.max(0, Math.round(p.start * 1000));
    filters.push(
      `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},apad=whole_dur=${dur.toFixed(3)}[a${i}]`
    );
  });
  const silenceIdx = partWavs.length;
  filters.push(
    `[${silenceIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${dur.toFixed(3)}[base]`
  );
  const mixIn =
    "[base]" +
    partWavs.map((_, i) => `[a${i}]`).join("") +
    `amix=inputs=${partWavs.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`;
  filters.push(mixIn);

  const args = [
    "-y",
    ...inputs,
    ...silenceArgs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[aout]",
    "-t",
    dur.toFixed(3),
    "-acodec",
    "pcm_s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    outWav,
  ];
  const mix = spawnSync(ffmpeg, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 300000,
  });
  if (mix.status !== 0 || !fs.existsSync(outWav)) {
    return generateEdgeTts(script, voice, outWav, opts);
  }
  return outWav;
}

/**
 * Segmented Edge TTS: split script → mp3 per part → ffmpeg concat → wav.
 * @param {string} script
 * @param {string} voice
 * @param {string} outWav
 * @param {{ onSegment?: (info: object) => void }} [opts]
 */
function generateEdgeTts(script, voice, outWav, opts = {}) {
  const text = String(script || "").trim();
  if (!text) throw new Error("Pusty tekst TTS");
  const ffmpeg = getFfmpeg();
  const dir = path.dirname(outWav);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(outWav, path.extname(outWav));
  // Sentence-aware segments (like STT/AI chunks — progress + reliability)
  const chunks = chunkText(text, TTS_SEGMENT_CHARS);
  const n = chunks.length;
  const mp3s = [];

  for (let i = 0; i < n; i++) {
    if (typeof opts.onSegment === "function") {
      opts.onSegment({
        index: i,
        total: n,
        phase: "start",
        preview: chunks[i].slice(0, 60),
        chars: chunks[i].length,
      });
    }
    const mp3 = path.join(dir, `${base}_part${String(i).padStart(3, "0")}.mp3`);
    let ok = false;
    let lastErr = null;
    // retry once (network blips on free Edge TTS)
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        if (fs.existsSync(mp3)) {
          try {
            fs.unlinkSync(mp3);
          } catch {
            /* ignore */
          }
        }
        generateEdgeTtsOne(chunks[i], voice, mp3);
        ok = true;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!ok) {
      throw new Error(
        `TTS segment ${i + 1}/${n}: ` + (lastErr && lastErr.message ? lastErr.message : lastErr)
      );
    }
    mp3s.push(mp3);
    if (typeof opts.onSegment === "function") {
      opts.onSegment({
        index: i,
        total: n,
        phase: "done",
        preview: chunks[i].slice(0, 60),
        chars: chunks[i].length,
        pct: Math.round(((i + 1) / n) * 100),
      });
    }
  }

  let mergedMp3 = path.join(dir, `${base}_full.mp3`);
  if (mp3s.length === 1) {
    mergedMp3 = mp3s[0];
  } else {
    const listFile = path.join(dir, `${base}_list.txt`);
    fs.writeFileSync(
      listFile,
      mp3s.map((p) => `file '${ffmpegConcatPath(p)}'`).join("\n") + "\n",
      "utf8"
    );
    const cat = spawnSync(
      ffmpeg,
      ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", mergedMp3],
      { encoding: "utf8", windowsHide: true, timeout: 180000 }
    );
    if (cat.status !== 0 || !fs.existsSync(mergedMp3)) {
      const inputs = [];
      mp3s.forEach((p) => inputs.push("-i", p));
      const filter =
        mp3s.map((_, i) => `[${i}:a]`).join("") +
        `concat=n=${mp3s.length}:v=0:a=1[a]`;
      const cat2 = spawnSync(
        ffmpeg,
        ["-y", ...inputs, "-filter_complex", filter, "-map", "[a]", mergedMp3],
        { encoding: "utf8", windowsHide: true, timeout: 240000 }
      );
      if (cat2.status !== 0 || !fs.existsSync(mergedMp3)) {
        throw new Error(
          "TTS montaż segmentów: " +
            ((cat.stderr || cat2.stderr || "") + "").slice(-200)
        );
      }
    }
  }

  const conv = spawnSync(
    ffmpeg,
    [
      "-y",
      "-i",
      mergedMp3,
      "-acodec",
      "pcm_s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      outWav,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 180000 }
  );
  if (conv.status !== 0 || !fs.existsSync(outWav)) {
    if (fs.existsSync(mergedMp3)) return mergedMp3;
    throw new Error("ffmpeg convert tts failed");
  }
  return outWav;
}

function generateSapiTts(script, voiceName, outWav, rate = 0) {
  const safeScript = String(script || "")
    .replace(/`/g, "")
    .replace(/"/g, "'")
    .replace(/\r?\n/g, " ");
  const safeOut = outWav.replace(/'/g, "''");
  const v = voiceName || "Microsoft Paulina";
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice('${v}') } catch { try { $s.SelectVoice('Microsoft Paulina Desktop') } catch {} }
$s.Rate = ${Number(rate) || 0}
$s.Volume = 100
$s.SetOutputToWaveFile('${safeOut}')
$s.Speak("${safeScript}")
$s.Dispose()
`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  });
  if (r.status !== 0 || !fs.existsSync(outWav)) {
    throw new Error("SAPI TTS failed");
  }
  return outWav;
}

/**
 * Generate narrator audio for target language (segmented Edge TTS by default).
 * gender: female | male | auto
 * onSegment: ({ index, total, phase, pct, preview }) => void
 * videoDur + timedSegments: place speech on timeline (full video, not stop at ~26s)
 */
function generateNarratorAudio(
  script,
  targetLang,
  outWav,
  {
    gender = "female",
    rate = 0,
    onSegment = null,
    videoDur = 0,
    timedSegments = null,
  } = {}
) {
  const lang = getLanguageModel(targetLang || "pl");
  const preferMale = gender === "male" || gender === "adam";
  const edgeVoice = preferMale
    ? lang.ttsVoiceMale || lang.ttsVoice
    : lang.ttsVoice || lang.ttsVoiceMale;

  // 1) Edge neural voices — timed to video when duration known
  if (edgeVoice) {
    try {
      const useTimed = Number(videoDur) > 5;
      const p = useTimed
        ? generateTimedNarratorAudio(
            script,
            edgeVoice,
            outWav,
            videoDur,
            timedSegments,
            { onSegment }
          )
        : generateEdgeTts(script, edgeVoice, outWav, { onSegment });
      const cues = useTimed
        ? buildTimedNarratorCues(script, videoDur, timedSegments)
        : null;
      return {
        path: p,
        voice: edgeVoice,
        engine: useTimed ? "edge-tts-timed" : "edge-tts-seg",
        lang: lang.code,
        segments:
          (cues && cues.length) ||
          chunkText(String(script || "").trim(), TTS_SEGMENT_CHARS).length,
      };
    } catch (e) {
      // fall through with last error noted
      if (typeof onSegment === "function") {
        try {
          onSegment({
            phase: "error",
            message: e && e.message ? e.message : String(e),
          });
        } catch {
          /* ignore */
        }
      }
    }
  }

  // 2) Windows SAPI for pl / en — also segment long text
  if (lang.code === "pl" || lang.code === "en") {
    const sapi = preferMale
      ? lang.sapiVoiceMale || lang.sapiVoice || "Microsoft Adam"
      : lang.sapiVoice || "Microsoft Paulina";
    try {
      const parts = chunkText(String(script || "").trim(), TTS_SEGMENT_CHARS);
      if (parts.length <= 1) {
        return {
          path: generateSapiTts(script, sapi, outWav, rate),
          voice: sapi,
          engine: "sapi",
          lang: lang.code,
        };
      }
      const dir = path.dirname(outWav);
      const base = path.basename(outWav, path.extname(outWav));
      const wavParts = [];
      for (let i = 0; i < parts.length; i++) {
        if (typeof onSegment === "function") {
          onSegment({
            index: i,
            total: parts.length,
            phase: "start",
            preview: parts[i].slice(0, 60),
          });
        }
        const wp = path.join(dir, `${base}_sapi${i}.wav`);
        generateSapiTts(parts[i], sapi, wp, rate);
        wavParts.push(wp);
        if (typeof onSegment === "function") {
          onSegment({
            index: i,
            total: parts.length,
            phase: "done",
            pct: Math.round(((i + 1) / parts.length) * 100),
          });
        }
      }
      const listFile = path.join(dir, `${base}_sapi_list.txt`);
      fs.writeFileSync(
        listFile,
        wavParts.map((p) => `file '${ffmpegConcatPath(p)}'`).join("\n") + "\n",
        "utf8"
      );
      const ffmpeg = getFfmpeg();
      const cat = spawnSync(
        ffmpeg,
        ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outWav],
        { encoding: "utf8", windowsHide: true, timeout: 180000 }
      );
      if (cat.status === 0 && fs.existsSync(outWav)) {
        return {
          path: outWav,
          voice: sapi,
          engine: "sapi-seg",
          lang: lang.code,
          segments: parts.length,
        };
      }
      // fallback first part only
      return {
        path: generateSapiTts(parts[0], sapi, outWav, rate),
        voice: sapi,
        engine: "sapi",
        lang: lang.code,
      };
    } catch {
      /* fall through */
    }
  }

  // 3) gTTS fallback — short segments
  const gttsLang =
    lang.google === "zh-CN" ? "zh-CN" : lang.code === "auto" ? "en" : lang.code;
  const parts = chunkText(String(script || "").trim(), TTS_SEGMENT_CHARS);
  const dir = path.dirname(outWav);
  const base = path.basename(outWav, path.extname(outWav));
  const mp3s = [];
  const py = `
from gtts import gTTS
import sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    text = f.read()
tts = gTTS(text=text, lang=sys.argv[2])
tts.save(sys.argv[3])
print("ok")
`;
  for (let i = 0; i < parts.length; i++) {
    if (typeof onSegment === "function") {
      onSegment({
        index: i,
        total: parts.length,
        phase: "start",
        preview: parts[i].slice(0, 60),
      });
    }
    const txt = path.join(dir, `${base}_g${i}.txt`);
    const mp3 = path.join(dir, `${base}_g${i}.mp3`);
    fs.writeFileSync(txt, parts[i], "utf8");
    const r = runPython(["-c", py, txt, gttsLang, mp3], {
      encoding: "utf8",
      timeout: 90000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    try {
      fs.unlinkSync(txt);
    } catch {
      /* ignore */
    }
    if (r.status !== 0 || !fs.existsSync(mp3)) {
      if (mp3s.length) break;
      continue;
    }
    mp3s.push(mp3);
    if (typeof onSegment === "function") {
      onSegment({
        index: i,
        total: parts.length,
        phase: "done",
        pct: Math.round(((i + 1) / parts.length) * 100),
      });
    }
  }
  if (mp3s.length) {
    const ffmpeg = getFfmpeg();
    let merged = mp3s[0];
    if (mp3s.length > 1) {
      merged = path.join(dir, `${base}_gtts_full.mp3`);
      const listFile = path.join(dir, `${base}_gtts_list.txt`);
      fs.writeFileSync(
        listFile,
        mp3s.map((p) => `file '${ffmpegConcatPath(p)}'`).join("\n") + "\n",
        "utf8"
      );
      spawnSync(
        ffmpeg,
        ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", merged],
        { encoding: "utf8", windowsHide: true, timeout: 120000 }
      );
    }
    const conv = spawnSync(
      ffmpeg,
      ["-y", "-i", merged, "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", outWav],
      { encoding: "utf8", windowsHide: true, timeout: 120000 }
    );
    if (conv.status === 0 && fs.existsSync(outWav)) {
      return {
        path: outWav,
        voice: `gtts-${gttsLang}`,
        engine: "gtts-seg",
        lang: lang.code,
        segments: mp3s.length,
      };
    }
    if (fs.existsSync(merged)) {
      return {
        path: merged,
        voice: `gtts-${gttsLang}`,
        engine: "gtts-seg",
        lang: lang.code,
      };
    }
  }

  throw new Error(
    `TTS niedostępne dla języka ${lang.label}. Zainstaluj edge-tts (pip install edge-tts).`
  );
}

function listLanguageModels() {
  return {
    auto: {
      code: "auto",
      label: LANGUAGE_MODELS.auto.label,
      modelId: "nmt-google-auto-*",
      modelName: "Google NMT · AUTO→TARGET",
      nmt: "google",
    },
    sourceLanguages: WORLD_LANGS.map((m) => ({
      code: m.code,
      label: m.label,
      labelEn: m.labelEn,
      modelId: `nmt-google-${m.code}-*`,
      modelName: `Google NMT · ${m.code.toUpperCase()}→TARGET`,
      nmt: "google",
      google: m.google,
      ttsVoice: m.ttsVoice,
      ttsVoiceMale: m.ttsVoiceMale,
    })),
    targetLanguages: TARGET_LANGS.map((m) => ({
      code: m.code,
      label: m.label,
      labelEn: m.labelEn,
      modelId: `nmt-google-*-${m.code}`,
      modelName: `Google NMT · *→${m.code.toUpperCase()}`,
      ttsVoice: m.ttsVoice,
      ttsVoiceMale: m.ttsVoiceMale,
    })),
    // backward-compatible key
    languages: WORLD_LANGS.map((m) => ({
      code: m.code,
      label: m.label,
      modelId: `nmt-google-${m.code}-pl`,
      modelName: `Google NMT · ${m.code.toUpperCase()}→PL`,
      ttsVoice: m.ttsVoice,
    })),
  };
}

module.exports = {
  LANGUAGE_MODELS,
  WORLD_LANGS,
  TARGET_LANGS,
  LANG_LABELS,
  getLanguageModel,
  listLanguageModels,
  detectLanguage,
  translateText,
  translateToPolish,
  preparePolishScript,
  prepareNarratorScript,
  toSituationScript,
  extractSpeechFromVideo,
  extractSpeechFromVideoSegmented,
  STT_SEGMENT_SEC,
  TTS_SEGMENT_SEC,
  TTS_SEGMENT_CHARS,
  sttLocale,
  generateNarratorAudio,
  modelIdFor,
  modelNameFor,
};
