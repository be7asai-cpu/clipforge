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
 * ttsVoices = full list for UI (id = Edge ShortName).
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
    ttsVoices: [
      { id: "en-US-JennyNeural", label: "Jenny (US)", gender: "female", key: "jenny" },
      { id: "en-US-AriaNeural", label: "Aria (US)", gender: "female", key: "aria" },
      { id: "en-US-AvaNeural", label: "Ava (US)", gender: "female", key: "ava" },
      { id: "en-US-EmmaNeural", label: "Emma (US)", gender: "female", key: "emma" },
      { id: "en-US-AnaNeural", label: "Ana (US child)", gender: "female", key: "ana" },
      { id: "en-US-MichelleNeural", label: "Michelle (US)", gender: "female", key: "michelle" },
      { id: "en-US-AvaMultilingualNeural", label: "Ava multi (US)", gender: "female", key: "ava-multi" },
      { id: "en-US-EmmaMultilingualNeural", label: "Emma multi (US)", gender: "female", key: "emma-multi" },
      { id: "en-GB-SoniaNeural", label: "Sonia (UK)", gender: "female", key: "sonia" },
      { id: "en-GB-LibbyNeural", label: "Libby (UK)", gender: "female", key: "libby" },
      { id: "en-GB-MaisieNeural", label: "Maisie (UK)", gender: "female", key: "maisie" },
      { id: "en-US-GuyNeural", label: "Guy (US)", gender: "male", key: "guy" },
      { id: "en-US-AndrewNeural", label: "Andrew (US)", gender: "male", key: "andrew" },
      { id: "en-US-BrianNeural", label: "Brian (US)", gender: "male", key: "brian" },
      { id: "en-US-ChristopherNeural", label: "Christopher (US)", gender: "male", key: "christopher" },
      { id: "en-US-EricNeural", label: "Eric (US)", gender: "male", key: "eric" },
      { id: "en-US-RogerNeural", label: "Roger (US)", gender: "male", key: "roger" },
      { id: "en-US-SteffanNeural", label: "Steffan (US)", gender: "male", key: "steffan" },
      { id: "en-US-AndrewMultilingualNeural", label: "Andrew multi (US)", gender: "male", key: "andrew-multi" },
      { id: "en-US-BrianMultilingualNeural", label: "Brian multi (US)", gender: "male", key: "brian-multi" },
      { id: "en-GB-RyanNeural", label: "Ryan (UK)", gender: "male", key: "ryan" },
      { id: "en-GB-ThomasNeural", label: "Thomas (UK)", gender: "male", key: "thomas" },
    ],
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
    ttsVoices: [
      { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao", gender: "female", key: "xiaoxiao" },
      { id: "zh-CN-XiaoyiNeural", label: "Xiaoyi", gender: "female", key: "xiaoyi" },
      { id: "zh-CN-YunxiNeural", label: "Yunxi", gender: "male", key: "yunxi" },
      { id: "zh-CN-YunjianNeural", label: "Yunjian", gender: "male", key: "yunjian" },
      { id: "zh-CN-YunxiaNeural", label: "Yunxia", gender: "male", key: "yunxia" },
      { id: "zh-CN-YunyangNeural", label: "Yunyang", gender: "male", key: "yunyang" },
    ],
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
    ttsVoices: [
      { id: "hi-IN-SwaraNeural", label: "Swara", gender: "female", key: "swara" },
      { id: "hi-IN-MadhurNeural", label: "Madhur", gender: "male", key: "madhur" },
    ],
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
    ttsVoices: [
      { id: "es-ES-ElviraNeural", label: "Elvira (ES)", gender: "female", key: "elvira" },
      { id: "es-ES-XimenaNeural", label: "Ximena (ES)", gender: "female", key: "ximena" },
      { id: "es-MX-DaliaNeural", label: "Dalia (MX)", gender: "female", key: "dalia" },
      { id: "es-ES-AlvaroNeural", label: "Álvaro (ES)", gender: "male", key: "alvaro" },
      { id: "es-MX-JorgeNeural", label: "Jorge (MX)", gender: "male", key: "jorge" },
    ],
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
    ttsVoices: [
      { id: "fr-FR-DeniseNeural", label: "Denise", gender: "female", key: "denise" },
      { id: "fr-FR-EloiseNeural", label: "Éloise", gender: "female", key: "eloise" },
      { id: "fr-FR-VivienneMultilingualNeural", label: "Vivienne multi", gender: "female", key: "vivienne" },
      { id: "fr-FR-HenriNeural", label: "Henri", gender: "male", key: "henri" },
      { id: "fr-FR-RemyMultilingualNeural", label: "Rémy multi", gender: "male", key: "remy" },
    ],
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
    ttsVoices: [
      { id: "ar-SA-ZariyahNeural", label: "Zariyah (SA)", gender: "female", key: "zariyah" },
      { id: "ar-EG-SalmaNeural", label: "Salma (EG)", gender: "female", key: "salma" },
      { id: "ar-SA-HamedNeural", label: "Hamed (SA)", gender: "male", key: "hamed" },
      { id: "ar-EG-ShakirNeural", label: "Shakir (EG)", gender: "male", key: "shakir" },
    ],
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
    ttsVoices: [
      { id: "it-IT-ElsaNeural", label: "Elsa", gender: "female", key: "elsa" },
      { id: "it-IT-IsabellaNeural", label: "Isabella", gender: "female", key: "isabella" },
      { id: "it-IT-DiegoNeural", label: "Diego", gender: "male", key: "diego" },
      { id: "it-IT-GiuseppeMultilingualNeural", label: "Giuseppe multi", gender: "male", key: "giuseppe" },
    ],
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
    ttsVoices: [
      { id: "pt-BR-FranciscaNeural", label: "Francisca (BR)", gender: "female", key: "francisca" },
      { id: "pt-BR-ThalitaMultilingualNeural", label: "Thalita multi (BR)", gender: "female", key: "thalita" },
      { id: "pt-BR-AntonioNeural", label: "Antônio (BR)", gender: "male", key: "antonio" },
    ],
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
    ttsVoices: [
      { id: "ru-RU-SvetlanaNeural", label: "Svetlana", gender: "female", key: "svetlana" },
      { id: "ru-RU-DmitryNeural", label: "Dmitry", gender: "male", key: "dmitry" },
    ],
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
    ttsVoices: [
      { id: "de-DE-KatjaNeural", label: "Katja", gender: "female", key: "katja" },
      { id: "de-DE-AmalaNeural", label: "Amala", gender: "female", key: "amala" },
      { id: "de-DE-SeraphinaMultilingualNeural", label: "Seraphina multi", gender: "female", key: "seraphina" },
      { id: "de-DE-ConradNeural", label: "Conrad", gender: "male", key: "conrad" },
      { id: "de-DE-KillianNeural", label: "Killian", gender: "male", key: "killian" },
      { id: "de-DE-FlorianMultilingualNeural", label: "Florian multi", gender: "male", key: "florian" },
    ],
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
    ttsVoices: [
      { id: "pl-PL-ZofiaNeural", label: "Zofia", gender: "female", key: "zofia" },
      { id: "pl-PL-MarekNeural", label: "Marek", gender: "male", key: "marek" },
      // Edge has only 2 PL neural voices — also offer popular EN as optional (script PL still works OK for names)
      { id: "en-US-JennyNeural", label: "Jenny (EN)", gender: "female", key: "jenny" },
      { id: "en-US-AriaNeural", label: "Aria (EN)", gender: "female", key: "aria" },
      { id: "en-US-AvaNeural", label: "Ava (EN)", gender: "female", key: "ava" },
      { id: "en-GB-SoniaNeural", label: "Sonia (UK)", gender: "female", key: "sonia" },
      { id: "en-US-GuyNeural", label: "Guy (EN)", gender: "male", key: "guy" },
      { id: "en-US-AndrewNeural", label: "Andrew (EN)", gender: "male", key: "andrew" },
      { id: "en-US-BrianNeural", label: "Brian (EN)", gender: "male", key: "brian" },
      { id: "en-GB-RyanNeural", label: "Ryan (UK)", gender: "male", key: "ryan" },
    ],
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

/**
 * Resolve Edge TTS ShortName from UI value (female/male/key/full id).
 */
function resolveEdgeVoice(langOrCode, voiceKey) {
  const lang =
    typeof langOrCode === "object" && langOrCode
      ? langOrCode
      : getLanguageModel(langOrCode || "pl");
  const raw = String(voiceKey || "female").trim();
  const key = raw.toLowerCase();
  const voices = Array.isArray(lang.ttsVoices) ? lang.ttsVoices : [];

  // Full Edge ShortName
  if (/neural/i.test(raw) || /^[a-z]{2,3}-[a-z]{2}-/i.test(raw)) {
    const hit = voices.find((v) => String(v.id).toLowerCase() === key);
    return hit ? hit.id : raw;
  }

  // Explicit short keys / labels
  const byMeta = voices.find(
    (v) =>
      (v.key && String(v.key).toLowerCase() === key) ||
      (v.label && String(v.label).toLowerCase() === key) ||
      String(v.id).toLowerCase().includes(key)
  );
  if (byMeta) return byMeta.id;

  // Legacy gender / SAPI names
  if (key === "male" || key === "adam" || key === "marek") {
    return (
      lang.ttsVoiceMale ||
      voices.find((v) => v.gender === "male")?.id ||
      lang.ttsVoice ||
      "en-US-GuyNeural"
    );
  }
  if (
    key === "female" ||
    key === "paulina" ||
    key === "zofia" ||
    key === "auto"
  ) {
    return (
      lang.ttsVoice ||
      voices.find((v) => v.gender === "female")?.id ||
      lang.ttsVoiceMale ||
      "en-US-JennyNeural"
    );
  }

  return (
    lang.ttsVoice ||
    voices[0]?.id ||
    lang.ttsVoiceMale ||
    "en-US-JennyNeural"
  );
}

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

// --- situation wrappers (FULL narrator — length scales with video duration) ---
/**
 * Target spoken length for "opis sytuacji" mode.
 * Neural TTS ≈ 13–15 Latin chars/s; leave a little headroom so voice ≤ video.
 */
function situationTargetChars(durationSec) {
  const dur = Math.max(0, Number(durationSec) || 0);
  if (dur <= 0) return 320; // unknown → medium
  // ~14 chars/s ≈ denser monologue (2× previous ~7) so lektor fills the clip
  const raw = Math.round(dur * 14);
  // ~8s min … ~2.5 min of speech max
  return Math.max(120, Math.min(1800, raw));
}

/** Pack sentence list into ~targetChars (prefer whole sentences). */
function fitSituationSentences(sentences, targetChars) {
  const parts = (sentences || [])
    .map((s) => String(s || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  if (targetChars < 100) {
    let o = parts[0];
    if (parts[1] && o.length + 1 + parts[1].length <= targetChars * 1.08) {
      o = o + " " + parts[1];
    }
    return o;
  }

  let out = "";
  for (const s of parts) {
    const next = out ? out + " " + s : s;
    if (out && next.length > targetChars * 1.08) {
      if (out.length >= targetChars * 0.55) break;
      if (s.length > 100) break;
    }
    out = next;
    if (out.length >= targetChars) break;
  }
  // Light pad if still short of target (repeat mid/late beats once)
  let i = 0;
  while (
    out.length < targetChars * 0.88 &&
    parts.length > 2 &&
    i < Math.min(parts.length, 6)
  ) {
    const s = parts[2 + (i % Math.max(1, parts.length - 2))];
    const next = out + " " + s;
    if (next.length > targetChars * 1.12) break;
    out = next;
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

function normalizeDescribeStyle(style) {
  const s = String(style || "neutral").toLowerCase().trim();
  const ok = [
    "neutral",
    "funny",
    "critical",
    "epic",
    "calm",
    "sarcastic",
    "doc",
    "hype",
  ];
  return ok.includes(s) ? s : "neutral";
}

/**
 * Beat banks per language × style. Length still scaled by duration outside.
 */
function situationBeatBank(code, body, dur, style = "neutral") {
  const d = Math.max(0, Number(dur) || 0);
  const secLabel = d >= 1 ? Math.round(d) : 0;
  const st = normalizeDescribeStyle(style);
  const hasBody = Boolean(body);
  const lang = code === "pl" ? "pl" : "en";

  /** @type {Record<string, Record<string, {openEmpty:string[], openBody:string[], rise:string[], mid:string[], late:string[], close:string[]}>>} */
  const STYLES = {
    pl: {
      neutral: {
        openEmpty: [
          secLabel
            ? `Oglądasz nagranie trwające około ${secLabel} sekund.`
            : "Oglądasz nagranie z internetu.",
          "Na pierwszy rzut oka scena wygląda zwyczajnie, ale warto śledzić każdy detal.",
          "To typowy klip, w którym kontekst buduje się z klatki na klatkę.",
        ],
        openBody: [
          `Na tym nagraniu rozgrywa się konkretna sytuacja: ${body}.`,
          "Od pierwszych sekund widać kontekst, bohaterów i miejsce akcji.",
          "Scena na starcie wydaje się niewinna, lecz tempo szybko rośnie.",
        ],
        rise: [
          "Z każdą chwilą pojawiają się nowe gesty, reakcje i szczegóły w tle.",
          "Napięcie rośnie — drobne elementy układają się w jedną historię.",
          "Obserwuj twarze i ruchy: to one zdradzają, dokąd zmierza całość.",
          "W tle widać sygnały, które na początku łatwo przeoczyć.",
        ],
        mid: [
          "W środkowej części nagrania następuje wyraźny zwrot akcji.",
          "To moment, w którym odbiór sytuacji całkowicie się zmienia.",
          "Bohaterowie reagują inaczej, niż można by się spodziewać.",
          "Szczegóły, które wydawały się przypadkowe, nagle nabierają sensu.",
        ],
        late: [
          "Im bliżej końca, tym mocniej widać, o co naprawdę chodziło.",
          "Kulminacja zbiera wcześniejsze tropy w jedną puentę.",
          "Warto dotrwać do ostatnich sekund — domknięcie jest kluczowe.",
          "Zakończenie domyka opowieść i zostawia jasny przekaz.",
        ],
        close: [
          "To właśnie ten rodzaj klipu, który ogląda się do samego końca.",
          "Dopiero w finale widać, na czym polega żart albo dramat sytuacji.",
        ],
      },
      funny: {
        openEmpty: [
          secLabel
            ? `Masz przed sobą ${secLabel} sekund czystego internetowego absurdu.`
            : "Masz przed sobą klasyczny kawałek internetowego absurdu.",
          "Na starcie wygląda niewinnie — a potem mózg dostaje update, którego nie prosił.",
          "Siądź wygodnie: tu logika idzie na urlop.",
        ],
        openBody: [
          `Sytuacja w skrócie: ${body}. Brzmi prosto? No właśnie, nie będzie.`,
          "Bohaterowie wchodzą w to, jakby nic się nie działo — a zaraz będzie się działo.",
          "Kamera łapie detale, z których normalny człowiek zrobiłby meme w 0,2 sekundy.",
        ],
        rise: [
          "Każda kolejna sekunda dokładana jest jak punchline w złym stand-upie: coraz gorzej i coraz śmieszniej.",
          "Reakcje na ekranie są warte osobnego lajku — serio, twarze mówią więcej niż dialog.",
          "W tle dzieją się rzeczy, które wyglądają jak błąd w Matrixie, ale to po prostu życie.",
          "Tempo rośnie, godność spada, a Ty już wiesz, że to nie skończy się godnie.",
        ],
        mid: [
          "I nagle — zwrot, po którym nie da się zachować powagi.",
          "Tu scenariusz postanawia, że realność jest opcjonalna.",
          "Gdyby to był serial, w napisach byłoby: «based on true chaos».",
          "Moment, w którym myślisz «nie, oni tego nie zrobią» — i robią.",
        ],
        late: [
          "Finał schodzi na poziom, którego nie przewidział nawet sam autor nagrania.",
          "Puenta wpada jak mem o 3 w nocy: nieproszona i nie do zapomnienia.",
          "Ostatnie sekundy domykają żart tak, że aż przewracasz oczami — i przewijasz jeszcze raz.",
          "Tak kończą się legendy internetu: krótko, głupio i genialnie.",
        ],
        close: [
          "Podsumowując: nie wiemy, czy śmiać się, czy wzywać pomoc — więc śmiejemy się.",
          "Klasyczny content: zero budżetu, maksimum chaosu, pełen sukces.",
        ],
      },
      critical: {
        openEmpty: [
          secLabel
            ? `Patrzymy na ${secLabel} sekund nagrania, które zasługuje na chłodną ocenę.`
            : "Patrzymy na nagranie, które zasługuje na chłodną ocenę.",
          "Zamiast oklasków — pytania: po co, dla kogo i jakim kosztem.",
          "To nie jest «zabawny wpadka» bez kontekstu; kontekst właśnie się liczy.",
        ],
        openBody: [
          `Oto sytuacja: ${body}. Brzmi znajomo — i właśnie dlatego warto przyjrzeć się jej krytycznie.`,
          "Od początku widać wybory ludzi na ekranie: nie zawsze rozsądne, nie zawsze niewinne.",
          "Kamera nie kłamie, ale montaż i narracja internetu lubią upraszczać.",
        ],
        rise: [
          "Z każdą chwilą widać eskalację — nie bohaterstwo, tylko brak hamulców.",
          "Reakcje otoczenia mówią dużo o normach, które tu się rozjeżdżają.",
          "Detale w tle podpowiadają, że to nie jest izolowany incydent, tylko styl zachowania.",
          "Im dalej, tym mniej «przypadku», a więcej świadomego ryzyka.",
        ],
        mid: [
          "W środku nagrania przekraczana jest granica, której nie da się już zamieść pod dywan.",
          "Tu kończy się żart, a zaczyna problem: skutki, świadkowie, odpowiedzialność.",
          "Zamiast brawo — pytanie, kto na tym korzysta, a kto płaci rachunek.",
          "Zwrot akcji nie usprawiedliwia tego, co widać wcześniej.",
        ],
        late: [
          "Finał nie wybiela sytuacji — domyka obraz lekkomyślności.",
          "Puenta jest gorzka: wiralowość nagradza to, czego nie powinno się nagradzać.",
          "Warto dotrwać do końca, żeby zobaczyć pełny bilans, nie sam «highlight».",
          "Zakończenie zostawia pytanie: czy to jeszcze rozrywka, czy już zaniedbanie?",
        ],
        close: [
          "Podsumowanie bez cukru: nagranie bawi część widzów i jednocześnie stawia czerwoną flagę.",
          "Krytycznie: oglądajmy, ale nie normalizujmy głupoty tylko dlatego, że ma ładny kadr.",
        ],
      },
      epic: {
        openEmpty: [
          secLabel
            ? `Przed nami ${secLabel} sekund, które budują się jak mały epos.`
            : "Przed nami nagranie, które buduje się jak mały epos.",
          "Scena otwiera się spokojnie — a pod spodem rośnie dramat.",
          "Każda klatka dokłada cegiełkę do większej opowieści.",
        ],
        openBody: [
          `Oto oś historii: ${body}.`,
          "Na prologu poznajemy bohaterów i stawkę — jeszcze cicho, już napięto.",
          "Światło, ruch, oddech chwili: wszystko gra na nadchodzący zwrot.",
        ],
        rise: [
          "Akcja nabiera ciężaru — gesty stają się decyzjami, a sekundy liczą się podwójnie.",
          "Los jakby testuje bohaterów: mały błąd, wielki cień konsekwencji.",
          "Tłum, tło, cisza między dźwiękami — epopeja w miniaturze.",
          "Napięcie rośnie falami, nie krzykiem; właśnie to robi dramat.",
        ],
        mid: [
          "W samym środku pęka równowaga — punkt bez powrotu.",
          "Tu narracja zmienia barwę: z opowieści w starcie o sens.",
          "Bohater staje oko w oko z chwilą, której nie da się cofnąć.",
          "Zwrot jest czysty, filmowy, nie do przeoczenia.",
        ],
        late: [
          "Zbliżamy się do kulminacji jak do szczytu — powietrze gęstnieje.",
          "Ostatnie ruchy domykają łuk, który zaczął się od niewinnego detalu.",
          "Finał nie prosi o oklaski — wymaga ich.",
          "Puenta spada ciężko i zostaje w głowie dłużej niż sam klip.",
        ],
        close: [
          "Tak kończą się małe epopeje internetu: krótko, ostro, z echem.",
          "Warto było iść tą ścieżką do ostatniej klatki.",
        ],
      },
      calm: {
        openEmpty: [
          secLabel
            ? `Spokojnie oglądamy około ${secLabel} sekund nagrania.`
            : "Spokojnie oglądamy to nagranie.",
          "Bez pośpiechu: oddychamy z kadrem i pozwalamy scenie się ułożyć.",
          "Tu nie ma krzyku — jest uważność.",
        ],
        openBody: [
          `W tej chwili dzieje się to: ${body}.`,
          "Zaczynamy od prostego obrazu — ludzie, miejsce, rytm dnia.",
          "Wszystko płynie miękko, a detale same się pojawiają.",
        ],
        rise: [
          "Powoli dostrzegamy więcej: gest, spojrzenie, dźwięk w tle.",
          "Nie musimy gonić puenty — ona dojrzewa w swoim tempie.",
          "Scena oddycha; my tylko towarzyszymy.",
          "Każda sekunda ma swój spokojny ciężar.",
        ],
        mid: [
          "W środku pojawia się delikatna zmiana — ledwo zauważalna, ważna.",
          "To nie eksplozja, tylko przesunięcie nastroju.",
          "Bohaterowie reagują ciszej, a przez to prawdziwiej.",
          "Zatrzymaj wzrok: tu jest sedno bez krzyku.",
        ],
        late: [
          "Zbliżamy się do końca bez pośpiechu.",
          "Domknięcie jest ciche, ale czytelne.",
          "Ostatnie kadry domykają nastrój, nie efekt specjalny.",
          "Puenta ląduje miękko — i zostaje.",
        ],
        close: [
          "Taki klip ogląda się uważnie, nie łapczywie.",
          "Cisza po finale też jest częścią opowieści.",
        ],
      },
      sarcastic: {
        openEmpty: [
          secLabel
            ? `O tak, kolejne ${secLabel} sekund « arcydzieła » internetu.`
            : "O tak, kolejne arcydzieło internetu.",
          "Na pewno nikt nie mógł tego przewidzieć. Na pewno.",
          "Przygotuj popcorn ironii — serwują full porcję.",
        ],
        openBody: [
          `Sytuacja, proszę państwa: ${body}. Genialne, prawda?`,
          "Bohaterowie wchodzą pewni siebie — klasyka gatunku «co może pójść nie tak».",
          "Spoiler: może. I idzie.",
        ],
        rise: [
          "Patrzymy, jak ktoś konsekwentnie wybiera najgorszą możliwą opcję.",
          "Reakcje otoczenia? Dokładnie takie, jakich byśmy nie chcieli w CV.",
          "Detale w tle krzyczą głośniej niż narrator — a ja tylko tłumaczę.",
          "Eskalacja idzie planowo: najpierw głupio, potem jeszcze głupiej.",
        ],
        mid: [
          "I tu — o dziwo — robi się jeszcze lepiej. W sensie: gorzej.",
          "Zwrot akcji, którego nikt nie chciał, a algorytm pokocha.",
          "Gdyby istniała nagroda za unikanie rozsądku, nominacja leci.",
          "Moment «serio?» powtarzany w nieskończoność.",
        ],
        late: [
          "Finał nie zawodzi fanów chaosu — i zawodzi resztę ludzkości.",
          "Puenta jak pieczątka: «można było tego nie robić».",
          "Ostatnie sekundy: koronacja złych decyzji.",
          "Brawo. Naprawdę. (Sarkazm w cenie biletu.)",
        ],
        close: [
          "Podsumowując: internet znowu wygrał, a my straciliśmy kilka komórek mózgowych.",
          "Dzięki za uwagę. Następnym razem może będzie mądrzej. Raczej nie.",
        ],
      },
      doc: {
        openEmpty: [
          secLabel
            ? `Materiał trwa około ${secLabel} sekund. Poniżej zwięzły opis przebiegu zdarzeń.`
            : "Poniżej zwięzły opis przebiegu zdarzeń na nagraniu.",
          "Rejestrujemy fakty widoczne w kadrze, bez domysłów wykraczających poza obraz.",
          "Kolejność: kontekst, rozwój, zwrot, domknięcie.",
        ],
        openBody: [
          `Zdarzenie wyjściowe: ${body}.`,
          "Na otwarciu ustalony jest kontekst przestrzenny i uczestnicy.",
          "Warunki początkowe wyglądają stabilnie; dynamika rośnie w kolejnych ujęciach.",
        ],
        rise: [
          "Obserwujemy narastanie bodźców: ruch, interakcje, zmiany pozycji.",
          "Reakcje uczestników są mierzalne w geście i czasie odpowiedzi.",
          "Elementy tła korelują z główną osią zdarzenia.",
          "Sekwencja utrzymuje ciągłość przyczynowo-skutkową.",
        ],
        mid: [
          "W środkowej fazie następuje istotna zmiana stanu.",
          "To punkt, w którym trajektoria zdarzenia odchyla się od stanu wyjściowego.",
          "Uczestnicy adaptują zachowanie do nowych warunków.",
          "Dane wizualne potwierdzają eskalację, nie tylko sugestię montażu.",
        ],
        late: [
          "Faza końcowa porządkuje wcześniejsze sygnały w jeden wynik.",
          "Kulminacja jest czytelna w czasie i przestrzeni kadru.",
          "Domknięcie sekwencji następuje w ostatnich sekundach materiału.",
          "Stan końcowy różni się od początkowego w sposób obserwowalny.",
        ],
        close: [
          "Podsumowanie: pełny przebieg jest czytelny dopiero po obejrzeniu całości.",
          "To zapis sytuacji, nie komentarz wartościujący.",
        ],
      },
      hype: {
        openEmpty: [
          secLabel
            ? `ALE MAMY TO! ${secLabel} sekund czystej energii na taśmie!`
            : "ALE MAMY TO! Czysta energia na taśmie!",
          "Publiczność w domach — cisza przed burzą!",
          "Zegary tykają, kamera gotowa, leci akcja!",
        ],
        openBody: [
          `Sytuacja wyjściowa: ${body} — i od razu czuć, że będzie się działo!`,
          "Bohaterowie w polu, stawką jest wszystko albo… no, przynajmniej ten klip!",
          "Start jak z armaty — zero rozgrzewki, full gaz!",
        ],
        rise: [
          "Tempo rośnie! Gest za gestem, decyzja za decyzją!",
          "Nie spuszczajcie oczu z kadru — tu każda setna sekundy ma znaczenie!",
          "Tłum (nawet jeśli to trzy osoby w tle) już wie, że idzie o wielkie rzeczy!",
          "Eskalacja! Jeszcze wyżej! Jeszcze mocniej!",
        ],
        mid: [
          "ZWROT! Właśnie tu pęka mecz!",
          "Nie do wiary — tak się nie planuje, tak się WYGRYWA moment!",
          "Replay w głowie leci już teraz, a my wciąż w grze!",
          "To jest ta akcja, o której będzie głośno!",
        ],
        late: [
          "Finisz! Ostatnie metry, ostatnie sekundy!",
          "Puenta wlatuje jak gol w doliczonym czasie!",
          "Stoimy, klaszczemy, nie wierzymy — a trzeba wierzyć!",
          "Domknięcie sezonu w jednym klipie!",
        ],
        close: [
          "KONIEC! Co za materiał! Co za emocje!",
          "Dziękujemy za ten show — do następnego virala!",
        ],
      },
    },
    en: {
      neutral: {
        openEmpty: [
          secLabel
            ? `You are watching a clip that runs about ${secLabel} seconds.`
            : "You are watching an online clip.",
          "At first the scene looks ordinary, but every detail matters.",
          "Context builds frame by frame.",
        ],
        openBody: [
          `Here is what happens in this video: ${body}.`,
          "From the first seconds you see the setup, the people, and the place.",
          "It looks harmless at the start, then the pace picks up.",
        ],
        rise: [
          "Moment by moment new gestures, reactions, and background clues appear.",
          "Tension rises as small pieces form one clear story.",
          "Watch faces and timing — they reveal where this is going.",
          "Background details that seem random start to matter.",
        ],
        mid: [
          "Around the middle there is a clear turn in the action.",
          "That beat changes how you read everything that came before.",
          "People react in ways you would not expect.",
          "Clues click into place and the story sharpens.",
        ],
        late: [
          "Toward the end it becomes obvious what this was really about.",
          "The climax pulls earlier threads into one punchline.",
          "Stay for the final seconds — the close is the point.",
          "The ending seals the story with a clear payoff.",
        ],
        close: [
          "This is the kind of clip you watch all the way through.",
          "Only at the finish does the joke or the drama fully land.",
        ],
      },
      funny: {
        openEmpty: [
          secLabel
            ? `About ${secLabel} seconds of premium internet nonsense incoming.`
            : "Premium internet nonsense incoming.",
          "It starts innocent. Your brain will file a complaint.",
          "Sit down — logic has left the chat.",
        ],
        openBody: [
          `Plot: ${body}. Simple? Yeah, no.`,
          "Everyone walks in like nothing will go wrong. Famous last vibe.",
          "The camera catches details made for memes.",
        ],
        rise: [
          "Each second stacks like a worse-and-funnier punchline.",
          "The faces alone deserve a laugh track.",
          "Background chaos enters the chat.",
          "Pace up, dignity down.",
        ],
        mid: [
          "Plot twist your sense of humor wasn't ready for.",
          "Reality becomes optional mid-clip.",
          "If this were a show, the title would be «Based on True Chaos».",
          "You think they won't — they will.",
        ],
        late: [
          "The ending goes places nobody budgeted for.",
          "Punchline hits like a 3 a.m. meme.",
          "Last seconds seal the joke. Rewind energy: high.",
          "Internet legend behavior, short form.",
        ],
        close: [
          "Laugh first, ask questions never.",
          "Zero budget, maximum chaos, full marks.",
        ],
      },
      critical: {
        openEmpty: [
          secLabel
            ? `A cold look at about ${secLabel} seconds of footage.`
            : "A cold look at this footage.",
          "Skip the applause — ask why, for whom, at what cost.",
          "Context is not optional here.",
        ],
        openBody: [
          `The situation: ${body}. Familiar — and worth scrutinizing.`,
          "From the start, choices on screen are not always careful or harmless.",
          "The lens is honest; internet framing often is not.",
        ],
        rise: [
          "Escalation reads less like bravery, more like missing brakes.",
          "Bystander reactions say a lot about shifting norms.",
          "Background details suggest a pattern, not a one-off.",
          "Less «accident», more accepted risk.",
        ],
        mid: [
          "A line gets crossed that cannot be laughed off.",
          "Joke ends; consequences and responsibility begin.",
          "Who benefits, who pays — keep that question open.",
          "The turn does not excuse what led here.",
        ],
        late: [
          "The ending does not whitewash the recklessness.",
          "Virality rewards what should not be rewarded.",
          "Watch through for the full ledger, not just the highlight.",
          "Entertainment or negligence? The clip forces the question.",
        ],
        close: [
          "Summary without sugar: funny to some, a red flag to anyone paying attention.",
          "Watch it — do not normalize the worst of it.",
        ],
      },
      epic: {
        openEmpty: [
          secLabel
            ? `${secLabel} seconds that build like a pocket epic.`
            : "A pocket epic on a short timeline.",
          "Quiet open. Drama underneath.",
          "Every frame lays another brick.",
        ],
        openBody: [
          `The spine of the story: ${body}.`,
          "Prologue: people, place, stakes — still quiet, already tense.",
          "Light, motion, breath — all aim at the turn.",
        ],
        rise: [
          "Actions gain weight; seconds count double.",
          "Fate stress-tests the leads.",
          "Crowd, silence, shadow — epic in miniature.",
          "Tension rises in waves, not shouts.",
        ],
        mid: [
          "Balance breaks — the point of no return.",
          "Tone shifts from tale to trial.",
          "Hero meets the un-undoable moment.",
          "A clean, cinematic turn.",
        ],
        late: [
          "Climb to the peak; air thickens.",
          "Last moves close the arc that started on a small detail.",
          "The finale does not ask for applause — it earns it.",
          "Payoff lands heavy and lingers.",
        ],
        close: [
          "Short-form epics end sharp, with echo.",
          "Worth every frame to the last.",
        ],
      },
      calm: {
        openEmpty: [
          secLabel
            ? `We sit with about ${secLabel} seconds of footage, slowly.`
            : "We sit with this footage, slowly.",
          "No rush. Breathe with the frame.",
          "Attention over noise.",
        ],
        openBody: [
          `In this moment: ${body}.`,
          "A simple open — people, place, daily rhythm.",
          "Soft flow; details arrive on their own.",
        ],
        rise: [
          "Gently more appears: a gesture, a glance, a sound.",
          "No chase for the punch — it ripens.",
          "The scene breathes; we only accompany.",
          "Each second has quiet weight.",
        ],
        mid: [
          "A soft shift mid-way — easy to miss, important.",
          "Not an explosion; a change of weather.",
          "Quieter reactions, truer ones.",
          "Hold your gaze: the core is here.",
        ],
        late: [
          "We near the end without hurry.",
          "Closure is quiet and clear.",
          "Last frames finish mood, not VFX.",
          "The point lands soft — and stays.",
        ],
        close: [
          "Watch with care, not greed.",
          "The silence after is part of the story.",
        ],
      },
      sarcastic: {
        openEmpty: [
          secLabel
            ? `Yes, another ${secLabel} seconds of «masterpiece» content.`
            : "Yes, another «masterpiece».",
          "Nobody could have seen this coming. Nobody.",
          "Irony popcorn: large size.",
        ],
        openBody: [
          `The situation, ladies and gentlemen: ${body}. Brilliant.`,
          "Confidence level: pre-disaster.",
          "Spoiler: it can go wrong. It does.",
        ],
        rise: [
          "Watch someone pick the worst option on purpose, apparently.",
          "Bystander reactions: not résumé material.",
          "Background details yell louder than any narrator.",
          "Escalation schedule: dumb, then dumber.",
        ],
        mid: [
          "Somehow it gets «better». Meaning worse.",
          "A twist nobody ordered, algorithm loved.",
          "Award season for bad judgment is open.",
          "The eternal «seriously?» beat.",
        ],
        late: [
          "Ending thrills chaos fans, disappoints humanity.",
          "Stamp it: «could have not done that».",
          "Final seconds: coronation of bad calls.",
          "Bravo. Really. (Sarcasm included.)",
        ],
        close: [
          "Internet wins again; we lose a few brain cells.",
          "Thanks for watching. Next time: wiser. Probably not.",
        ],
      },
      doc: {
        openEmpty: [
          secLabel
            ? `Runtime approximately ${secLabel} seconds. Concise event description follows.`
            : "Concise event description follows.",
          "We report what the frame shows, without speculation beyond the image.",
          "Order: context, development, turn, close.",
        ],
        openBody: [
          `Initial event: ${body}.`,
          "Opening establishes space and participants.",
          "Initial conditions appear stable; dynamics increase over time.",
        ],
        rise: [
          "Rising stimuli: motion, interaction, position change.",
          "Participant reactions are visible in gesture and timing.",
          "Background elements correlate with the main axis of action.",
          "Sequence keeps cause-and-effect continuity.",
        ],
        mid: [
          "Mid phase: material state change.",
          "Trajectory diverges from the opening condition.",
          "Participants adapt behavior to new constraints.",
          "Visual data confirm escalation, not only edit suggestion.",
        ],
        late: [
          "Closing phase consolidates earlier signals into one outcome.",
          "Culmination is readable in time and frame space.",
          "Sequence closure occurs in the final seconds.",
          "End state differs observably from the start.",
        ],
        close: [
          "Summary: full course is clear only after the complete viewing.",
          "A record of a situation, not a value judgment.",
        ],
      },
      hype: {
        openEmpty: [
          secLabel
            ? `HERE WE GO — ${secLabel} seconds of pure heat!`
            : "HERE WE GO — pure heat!",
          "Crowd noise in your head — let's fly!",
          "Clocks ticking, cameras hot, ACTION!",
        ],
        openBody: [
          `Opening situation: ${body} — and you already feel the surge!`,
          "Players on the field, stakes high, zero warm-up!",
          "Kickoff like a cannon — full send!",
        ],
        rise: [
          "Pace UP! Gesture after gesture!",
          "Do not blink — every tenth of a second matters!",
          "Even the background knows this is big!",
          "Escalation! Higher! Louder!",
        ],
        mid: [
          "TURNAROUND! The match flips HERE!",
          "Unreal — you don't plan this, you CATCH it!",
          "Mental replay already running!",
          "This is the highlight clip of the night!",
        ],
        late: [
          "FINAL STRETCH! Last meters!",
          "Punchline like a stoppage-time goal!",
          "On your feet — believe it!",
          "Season sealed in one short!",
        ],
        close: [
          "FULL TIME! What a tape! What a ride!",
          "Thanks for the show — see you at the next viral!",
        ],
      },
    },
  };

  const pack =
    (STYLES[lang] && STYLES[lang][st]) ||
    (STYLES.en && STYLES.en[st]) ||
    STYLES.en.neutral;
  const seq = [];
  const open = hasBody ? pack.openBody : pack.openEmpty;
  // 2× denser than previous cut — more open/rise/mid/late beats
  if (d > 0 && d < 12) {
    seq.push(open[0]);
    if (open[1]) seq.push(open[1]);
  } else {
    seq.push(...open.slice(0, d >= 35 ? 3 : 2));
  }
  const riseN = d >= 90 ? 4 : d >= 45 ? 3 : d >= 22 ? 2 : d >= 12 ? 1 : 1;
  const midN = d >= 70 ? 3 : d >= 40 ? 2 : d >= 20 ? 1 : 0;
  const lateN = d >= 90 ? 4 : d >= 45 ? 3 : d >= 22 ? 2 : d >= 12 ? 1 : 1;
  for (let i = 0; i < riseN; i++) seq.push(pack.rise[i % pack.rise.length]);
  for (let i = 0; i < midN; i++) seq.push(pack.mid[i % pack.mid.length]);
  for (let i = 0; i < lateN; i++) seq.push(pack.late[i % pack.late.length]);
  if (pack.close[0]) seq.push(pack.close[0]);
  if (d >= 30 && pack.close[1]) seq.push(pack.close[1]);
  return seq;
}

function toSituationScript(text, targetCode, durationSec = 0, describeStyle = "neutral") {
  const body = String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?…]+$/, "");
  const dur = Math.max(0, Number(durationSec) || 0);
  const targetChars = situationTargetChars(dur);
  const code = LANGUAGE_MODELS[targetCode] ? targetCode : "en";
  const style = normalizeDescribeStyle(describeStyle);

  // Already a long situation monologue — scale pad/trim to duration
  if (
    body.length > 220 &&
    /^(na tym|na filmie|here is what|in this|en este|voici|ecco|veja|вот|إليك|इस|这段)/i.test(
      body
    )
  ) {
    let s = body.endsWith(".") || body.endsWith("。") ? body : body + ".";
    if (dur > 0 && s.length < targetChars * 0.75) {
      const extra = situationBeatBank(code, "", dur, style).slice(2);
      s = fitSituationSentences([s, ...extra], targetChars);
    } else if (dur > 0 && s.length > targetChars * 1.35) {
      const cut = s.slice(0, Math.floor(targetChars * 1.05));
      const sp = cut.lastIndexOf(". ");
      s = (sp > 40 ? cut.slice(0, sp + 1) : cut).trim();
      if (!/[.!?…。]$/.test(s)) s += code === "zh" ? "。" : ".";
    }
    return s;
  }

  const beats = situationBeatBank(code, body, dur, style);
  let script = fitSituationSentences(beats, targetChars);

  if (!script) {
    script =
      code === "pl"
        ? "Oglądasz krótki filmik. Spójrz uważnie — zaraz zobaczysz, o co chodzi."
        : "You are watching a short clip. Watch closely — the point lands soon.";
  }

  if (!/[.!?…。؟।]$/.test(script)) {
    script += code === "zh" ? "。" : ".";
  }

  return script;
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
  // Full clip when possible — allow long videos (up to 3 h) for local PC STT
  const maxSec = Math.round(
    Math.min(Math.max(Number(opts.maxSeconds) || 600, 5), 10800)
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

/** Seconds per STT segment — exact translate uses 3s windows. */
const STT_SEGMENT_SEC = 3;

/**
 * Merge two STT strings at the BOUNDARY only (shared word suffix/prefix).
 * Never drop unique content of b (that was cutting full transcripts short).
 */
function mergeOverlapSpeechText(a, b) {
  a = String(a || "").replace(/\s+/g, " ").trim();
  b = String(b || "").replace(/\s+/g, " ").trim();
  if (!a) return b;
  if (!b) return a;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return a;
  // Near-full duplicate of a as b → keep longer
  if (bl.length >= 12 && al.includes(bl) && bl.length >= al.length * 0.9) return a;
  if (al.length >= 12 && bl.includes(al) && al.length >= bl.length * 0.9) return b;
  // Short echo only (≤2 words fully inside previous) → skip
  const wb = b.split(/\s+/).filter(Boolean);
  const wa = a.split(/\s+/).filter(Boolean);
  if (wb.length <= 2 && al.includes(bl)) return a;

  let best = 0;
  const maxK = Math.min(wa.length, wb.length, 48);
  for (let k = maxK; k >= 1; k--) {
    const left = wa.slice(-k).map((x) => x.toLowerCase());
    const right = wb.slice(0, k).map((x) => x.toLowerCase());
    if (left.length === right.length && left.every((w, i) => w === right[i])) {
      best = k;
      break;
    }
  }
  if (best >= 1) return wa.concat(wb.slice(best)).join(" ").trim();
  // Always keep all of b (unique speech)
  return (a + " " + b).replace(/\s+/g, " ").trim();
}

/**
 * Merge speech segments by time order — only collapse true time-overlaps.
 * Keeps all unique words (does not drop later dialogue).
 */
function dedupeSpeechSegments(segs) {
  if (!Array.isArray(segs) || !segs.length) return [];
  const ordered = [...segs]
    .filter((s) => s && String(s.text || "").trim())
    .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
  const out = [];
  for (const s of ordered) {
    const t = String(s.text || "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (!out.length) {
      out.push({ ...s, text: t });
      continue;
    }
    const prev = out[out.length - 1];
    const pe = Number(prev.end) || 0;
    const ss = Number(s.start) || 0;
    const se = Number(s.end) || ss;
    // Strong time overlap → boundary-merge text
    if (ss <= pe + 0.35) {
      prev.text = mergeOverlapSpeechText(prev.text, t);
      prev.end = Math.max(pe, se);
      continue;
    }
    out.push({ ...s, text: t });
  }
  return out;
}

/** Join timeline slot texts — keep ALL unique speech in order. */
function joinSpeechTexts(texts) {
  let joined = "";
  for (const t of texts || []) {
    const s = String(t || "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    joined = joined ? mergeOverlapSpeechText(joined, s) : s;
  }
  return joined;
}

/**
 * Probe video duration in seconds (robust Duration parse).
 */
function probeVideoDurationSec(videoPath, ffmpegBin) {
  if (!videoPath || !fs.existsSync(videoPath)) return 0;
  let ff = ffmpegBin;
  if (!ff) {
    try {
      ff = require("ffmpeg-static");
    } catch {
      ff = "ffmpeg";
    }
  }
  try {
    const r = spawnSync(ff, ["-hide_banner", "-i", videoPath], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    const err = String((r.stderr || "") + (r.stdout || ""));
    const m =
      err.match(/Duration:\s*(\d+):(\d+):(\d+[.,]\d+)/) ||
      err.match(/Duration:\s*(\d+):(\d+):(\d+)\b/);
    if (m) {
      const sec = Number(String(m[3]).replace(",", "."));
      const d =
        Number(m[1]) * 3600 +
        Number(m[2]) * 60 +
        (Number.isFinite(sec) ? sec : 0);
      if (d > 0.2 && d < 86400) return d;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

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
  // Prefer real file duration when maxSeconds was only a default guess
  let totalDur = Math.max(1, Math.min(Number(opts.maxSeconds) || 600, 10800));
  const probed = probeVideoDurationSec(videoPath, opts.ffmpeg);
  if (probed > 0.5) {
    // Always cover full film if we know length (unless caller asked for shorter)
    if (!opts.maxSeconds || Number(opts.maxSeconds) >= probed - 0.5) {
      totalDur = Math.min(probed + 0.5, 10800);
    } else {
      totalDur = Math.min(Number(opts.maxSeconds), probed + 0.5, 10800);
    }
  }

  // STT recognition: LONG windows (Google needs context). 3s hops were too short → incomplete text.
  // hop advances the scan; win is how much audio each Google call hears.
  const hopSec = Math.max(
    2,
    Math.min(Number(opts.hopSec) || Number(opts.segmentSec) || 8, 20)
  );
  const winSec = Math.max(
    hopSec,
    Math.min(Number(opts.sttWindowSec) || 15, 45)
  );
  const nSeg =
    totalDur > hopSec * 1.05 ? Math.ceil(totalDur / hopSec) : 1;

  const merged = {
    text: "",
    engine: null,
    langCode: null,
    chunks: 0,
    error: null,
    partial: [],
    segments: [],
    timelineSegments: [],
    audioDuration: totalDur,
    coverageStart: null,
    coverageEnd: null,
    attempted: 0,
    failed: 0,
    lockedLang: null,
    sttSegments: nSeg,
    probedDuration: probed || null,
    hopSec,
    winSec,
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
    const startSec = i * hopSec;
    if (startSec >= totalDur - 0.05) break;
    // Longer recognition window (may extend past hop) — captures full phrases
    const lenSec = Math.max(0.5, Math.min(winSec, totalDur - startSec));

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

    let part = extractSpeechFromVideo(videoPath, {
      sourceLang: lockedSource,
      maxSeconds: Math.ceil(lenSec + 0.25),
      startSec,
      workDir: path.join(baseWork, "seg_" + String(i).padStart(3, "0")),
      ffmpeg: opts.ffmpeg,
      onProgress: opts.onProgress,
    });

    // Retry empty window once with auto lang (often recovers missed dialogue)
    const partEmpty =
      !String(part.text || "").trim() &&
      !(Array.isArray(part.segments) && part.segments.some((s) => s && s.text));
    if (partEmpty && opts.noEarlyExit !== false) {
      part = extractSpeechFromVideo(videoPath, {
        sourceLang: "auto",
        maxSeconds: Math.ceil(lenSec + 0.25),
        startSec,
        workDir: path.join(baseWork, "seg_" + String(i).padStart(3, "0") + "_r"),
        ffmpeg: opts.ffmpeg,
      });
    }

    merged.attempted += Number(part.attempted) || 1;
    merged.failed += Number(part.failed) || (partEmpty ? 1 : 0);
    if (part.engine) merged.engine = part.engine;
    if (part.lockedLang) merged.lockedLang = part.lockedLang;

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

    // Collect speech with absolute times (from python + startSec offset already applied)
    const sliceTexts = [];
    if (Array.isArray(part.segments) && part.segments.length) {
      for (const s of part.segments) {
        if (s && s.text) {
          merged.segments.push({
            start: Number(s.start) || startSec,
            end: Number(s.end) || startSec + lenSec,
            text: String(s.text).replace(/\s+/g, " ").trim(),
          });
          sliceTexts.push(String(s.text).trim());
        }
      }
    } else if (part.text && String(part.text).trim().length >= 2) {
      const t = String(part.text).replace(/\s+/g, " ").trim();
      merged.segments.push({
        start: startSec,
        end: startSec + lenSec,
        text: t,
      });
      sliceTexts.push(t);
    }

    // Slot text for this hop: prefer raw part.text if richer than merged slice
    let slotText = joinSpeechTexts(sliceTexts);
    const rawPart = String(part.text || "").replace(/\s+/g, " ").trim();
    if (rawPart.length > slotText.length + 5) {
      slotText = mergeOverlapSpeechText(slotText, rawPart);
    }
    merged.timelineSegments.push({
      start: startSec,
      end: Math.min(totalDur, startSec + hopSec),
      text: slotText,
      silent: !slotText,
      sttIndex: i,
      winEnd: startSec + lenSec,
    });

    // Full running transcript — ALL slots, never drop later speech
    const running = joinSpeechTexts(
      merged.timelineSegments.map((s) => s.text).filter(Boolean)
    );
    // Light time-merge of fine segments (overlap only)
    merged.segments = dedupeSpeechSegments(merged.segments);
    // Prefer longest available full text
    const fromFine = joinSpeechTexts(merged.segments.map((s) => s.text));
    merged.text =
      fromFine.length >= running.length ? fromFine : running;
    if (rawPart && !merged.text.includes(rawPart.slice(0, Math.min(40, rawPart.length)))) {
      merged.text = mergeOverlapSpeechText(merged.text, rawPart);
    }
    merged.partial = merged.timelineSegments.map((s) => s.text).filter(Boolean);
    merged.chunks = merged.timelineSegments.length;
    merged.coverageStart = 0;
    merged.coverageEnd = Math.min(
      totalDur,
      startSec + lenSec
    );

    if (typeof opts.onSegment === "function") {
      opts.onSegment({
        index: i,
        total: nSeg,
        startSec,
        lenSec,
        pct: Math.round(((i + 1) / nSeg) * 100),
        phase: "done",
        textSoFar: merged.text,
        segText: slotText,
        langCode: merged.langCode || lockedSource,
        engine: part.engine,
        ok: !!slotText,
        chars: (merged.text || "").length,
      });
    }

    const silentRun = merged.timelineSegments.filter((s) => s.silent).length;
    const spokenRun = merged.timelineSegments.filter((s) => !s.silent).length;
    const ratio =
      opts.minScanRatio != null
        ? Math.min(0.98, Math.max(0.5, Number(opts.minScanRatio) || 0.9))
        : 0.9;
    const minScan = Math.min(nSeg, Math.max(8, Math.ceil(nSeg * ratio)));
    // Only early-exit when explicitly allowed AND no speech at all for long time
    if (
      opts.noEarlyExit !== true &&
      !opts.noEarlyExit &&
      i + 1 >= minScan &&
      spokenRun === 0 &&
      silentRun >= minScan &&
      nSeg > 8 &&
      startSec + lenSec >= 45
    ) {
      merged.error =
        "Brak mowy w większej części nagrania — STT puste (spróbuj napisów z filmu albo wklej tekst)";
      merged.musicLikely = true;
      break;
    }
  }

  // Final full-text rebuild from fine segments (best coverage)
  merged.segments = dedupeSpeechSegments(merged.segments);
  const finalFromSegs = joinSpeechTexts(merged.segments.map((s) => s.text));
  const finalFromSlots = joinSpeechTexts(
    merged.timelineSegments.map((s) => s.text).filter(Boolean)
  );
  merged.text =
    finalFromSegs.length >= finalFromSlots.length
      ? finalFromSegs
      : finalFromSlots;

  // Pad timeline to full duration
  const lastEnd =
    merged.timelineSegments.length > 0
      ? Number(merged.timelineSegments[merged.timelineSegments.length - 1].end) ||
        0
      : 0;
  if (totalDur > lastEnd + 0.5) {
    merged.timelineSegments.push({
      start: lastEnd,
      end: totalDur,
      text: "",
      silent: true,
      sttIndex: merged.timelineSegments.length,
    });
  }
  merged.audioDuration = totalDur;
  merged.coverageStart = 0;
  merged.coverageEnd = totalDur;
  merged.sttSegments = merged.timelineSegments.length;
  merged.fullLength = true;
  merged.charCount = (merged.text || "").length;

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

/**
 * Strip [mm:ss → mm:ss] markers → plain paragraph.
 */
function stripTimedMarkers(text) {
  return String(text || "")
    .replace(
      /\[\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*[–—→\-]+\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*s?\s*\]\s*/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Human speech pace presets (approx. characters/sec including spaces).
 * Wolno ~11, normalnie ~14, szybko ~17; speechRate for Edge TTS.
 */
const SPEECH_PACE = {
  slow: { id: "slow", charsPerSec: 11, speechRate: 0.85, label: "wolno" },
  normal: { id: "normal", charsPerSec: 14, speechRate: 1.0, label: "normalnie" },
  fast: { id: "fast", charsPerSec: 17, speechRate: 1.2, label: "szybko" },
  auto: { id: "auto", charsPerSec: 14, speechRate: null, label: "auto" },
};

function resolveSpeechPace(paceOrOpts) {
  let key = "normal";
  if (paceOrOpts && typeof paceOrOpts === "object") {
    key = String(
      paceOrOpts.speechPace ||
        paceOrOpts.textSpeechPace ||
        paceOrOpts.pace ||
        paceOrOpts.textSpeedMode ||
        "normal"
    ).toLowerCase();
  } else if (paceOrOpts != null) {
    key = String(paceOrOpts).toLowerCase();
  }
  if (key === "wolno" || key === "slow" || key === "0.85") key = "slow";
  else if (key === "szybko" || key === "fast" || key === "quick") key = "fast";
  else if (key === "auto" || key === "automatycznie") key = "auto";
  else if (
    key === "normalnie" ||
    key === "normal" ||
    key === "manual" ||
    key === ""
  )
    key = "normal";
  return SPEECH_PACE[key] || SPEECH_PACE.normal;
}

/**
 * Pack ALL whole words into nSeg buckets by character weight (never split a word).
 * Longer words take more of the segment budget. Order preserved.
 * @param {string[]} words
 * @param {number} nSeg
 * @returns {string[][]}
 */
function packWholeWordsByChars(words, nSeg) {
  const n = Math.max(1, Math.floor(Number(nSeg) || 1));
  if (!words.length) return Array.from({ length: n }, () => []);
  if (n === 1) return [words.slice()];

  const full = words.join(" ");
  const totalChars = Math.max(1, full.length);
  const buckets = Array.from({ length: n }, () => []);
  let pos = 0;
  let lastIdx = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i > 0) pos += 1; // space between words
    const mid = pos + w.length / 2;
    let idx = Math.floor((mid / totalChars) * n);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    // Keep chronological order (never put a later word in an earlier bucket)
    if (idx < lastIdx) idx = lastIdx;
    // Leave room for remaining words in later buckets when possible
    const wordsLeft = words.length - i;
    const segsLeft = n - idx;
    if (wordsLeft > segsLeft && idx < n - 1) {
      // ok — multiple words can share a segment
    } else if (wordsLeft === segsLeft && buckets[idx].length > 0 && idx < n - 1) {
      // one word per remaining segment
      idx = Math.min(n - 1, idx + 1);
    }
    buckets[idx].push(w);
    lastIdx = idx;
    pos += w.length;
  }

  // If some early buckets empty, leave them (timeline still spans film).
  // Push any unassigned — shouldn't happen
  return buckets;
}

/**
 * Split FULL text across whole video timeline.
 * - Fixed ~segmentSec windows covering 0→duration
 * - ALL characters used; ONLY whole words (never cut mid-word)
 * - Optional pace (slow/normal/fast) sets chars/s meta + packing density target
 *
 * @param {string} text
 * @param {number} durationSec
 * @param {number} [segmentSec=3]
 * @param {{ speechPace?: string, textSpeechPace?: string, charsPerSec?: number }} [opts]
 * @returns {{start:number,end:number,text:string,silent:boolean,sttIndex:number,chars:number,pace?:string}[]}
 */
function distributeTextOnTimeline(text, durationSec, segmentSec = 3, opts = {}) {
  const plain = stripTimedMarkers(text);
  const words = plain.split(/\s+/).filter(Boolean);
  const dur = Math.max(1, Number(durationSec) || 30);
  const step = Math.max(1, Math.min(30, Number(segmentSec) || 3));
  const pace = resolveSpeechPace(opts);
  const charsPerSec =
    Number(opts.charsPerSec) > 0
      ? Number(opts.charsPerSec)
      : pace.charsPerSec || 14;

  // Prefer film-length grid; if text is very dense vs pace, allow more segments
  // so ~charsPerSec*step chars of whole words land per window when possible
  const totalChars = plain.length || 0;
  const nByTime = Math.max(1, Math.ceil(dur / step));
  const nByPace =
    totalChars > 0
      ? Math.max(1, Math.ceil(totalChars / Math.max(8, charsPerSec * step)))
      : 1;
  // Use time grid for lektor sync to video; pace mainly affects TTS rate + char packing balance
  const nSeg = Math.max(nByTime, Math.min(nByPace, nByTime * 2));
  // Cap: never more segments than words (whole-word rule)
  const nFinal = Math.max(1, Math.min(nSeg, Math.max(1, words.length)));

  if (!words.length) {
    return Array.from({ length: nByTime }, (_, i) => {
      const start = (i / nByTime) * dur;
      const end = ((i + 1) / nByTime) * dur;
      return {
        start,
        end: Math.max(start + 0.3, end),
        text: "",
        silent: true,
        sttIndex: i,
        chars: 0,
        pace: pace.id,
        charsPerSec,
      };
    });
  }

  const buckets = packWholeWordsByChars(words, nFinal);
  const out = [];
  for (let i = 0; i < nFinal; i++) {
    const start = (i / nFinal) * dur;
    const end = ((i + 1) / nFinal) * dur;
    const slice = buckets[i] || [];
    const body = slice.join(" ");
    out.push({
      start,
      end: Math.max(start + 0.3, Math.min(dur, end)),
      text: body,
      silent: !body,
      sttIndex: i,
      chars: body.length,
      pace: pace.id,
      charsPerSec,
    });
  }
  // Safety: if any word lost, append to last
  const used = out.map((s) => s.text).join(" ").split(/\s+/).filter(Boolean);
  if (used.length < words.length) {
    const missing = words.slice(used.length);
    const last = out[out.length - 1];
    last.text = (last.text + " " + missing.join(" ")).replace(/\s+/g, " ").trim();
    last.silent = !last.text;
    last.chars = last.text.length;
  }
  return out;
}

/**
 * Speech windows with real STT clocks (only when speech was recognized).
 */
function exactSpeechWindows(sttSegments) {
  if (!Array.isArray(sttSegments)) return [];
  return sttSegments
    .filter((s) => s && String(s.text || "").replace(/\s+/g, " ").trim())
    .map((s, i) => {
      const start = Math.max(0, Number(s.start) || 0);
      const end = Math.max(start + 0.25, Number(s.end) || start + 1);
      const text = String(s.text || "").replace(/\s+/g, " ").trim();
      return {
        start,
        end,
        text,
        silent: false,
        sttIndex: s.sttIndex != null ? s.sttIndex : i,
        exactStt: true,
      };
    })
    .sort((a, b) => a.start - b.start);
}

/** Exact timed transcription = STT lines with real times (not even 3s packs). */
function buildExactTranscriptSegments(sttSegments) {
  return exactSpeechWindows(sttSegments);
}

/**
 * Map full text (e.g. translation) onto exact STT speech times.
 * Whole words; weight by characters of original STT per window.
 */
function mapTextOntoExactStt(fullText, sttSegments) {
  const windows = exactSpeechWindows(sttSegments);
  if (!windows.length) return null;
  const words = stripTimedMarkers(fullText)
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) {
    return windows.map((w) => ({ ...w, text: "", silent: true }));
  }
  const weights = windows.map((s) =>
    Math.max(1, String(s.text || "").replace(/\s+/g, " ").trim().length)
  );
  const wsum = weights.reduce((a, b) => a + b, 0) || windows.length;
  const raw = weights.map((w) => (words.length * w) / wsum);
  const take = raw.map((x) => Math.floor(x));
  let rem = words.length - take.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) take[order[k % take.length].i] += 1;
  for (let i = 0; i < take.length; i++) {
    if (take[i] === 0 && words.length >= windows.length) {
      let maxI = 0;
      for (let j = 0; j < take.length; j++) if (take[j] > take[maxI]) maxI = j;
      if (take[maxI] > 1) {
        take[maxI] -= 1;
        take[i] = 1;
      }
    }
  }
  const out = [];
  let idx = 0;
  for (let i = 0; i < windows.length; i++) {
    const n =
      i === windows.length - 1 ? Math.max(0, words.length - idx) : take[i];
    const slice = words.slice(idx, idx + Math.max(0, n));
    idx += slice.length;
    out.push({
      start: windows[i].start,
      end: windows[i].end,
      text: slice.join(" "),
      silent: slice.length === 0,
      sttIndex: windows[i].sttIndex,
      exactStt: true,
    });
  }
  if (idx < words.length) {
    const rest = words.slice(idx).join(" ");
    for (let j = out.length - 1; j >= 0; j--) {
      if (!out[j].silent || j === 0) {
        out[j].text = (out[j].text + " " + rest).replace(/\s+/g, " ").trim();
        out[j].silent = !out[j].text;
        break;
      }
    }
  }
  return out;
}

/**
 * Prefer exact STT transcription; fallback to even timeline if no speech times.
 * @param {object} opts
 * @param {string} opts.text - plain full text (source or translated)
 * @param {Array} [opts.sttSegments] - STT windows with real times + text
 * @param {number} [opts.durationSec]
 * @param {string} [opts.speechPace]
 * @param {boolean} [opts.forceEven] - force even packing (ignore STT clocks)
 */
function buildTimedScriptFromText(opts = {}) {
  const text = stripTimedMarkers(opts.text || "");
  const sttSegs = opts.sttSegments;
  const speech = exactSpeechWindows(sttSegs);
  if (!opts.forceEven && speech.length >= 1) {
    // Exact: keep STT clocks; if text ≈ STT join use STT text as-is (true transcription)
    const sttPlain = speech
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const tNorm = text.toLowerCase().replace(/\s+/g, " ").trim();
    const sNorm = sttPlain.toLowerCase();
    if (
      !text ||
      tNorm === sNorm ||
      sNorm.includes(tNorm.slice(0, 40)) ||
      tNorm.includes(sNorm.slice(0, 40))
    ) {
      // Same language / original transcript — use exact STT lines
      if (!text || tNorm === sNorm || Math.abs(text.length - sttPlain.length) < text.length * 0.15) {
        return {
          segments: speech,
          mode: "exact-stt",
          plainText: sttPlain || text,
        };
      }
    }
    // Translated (or edited) full text → map onto exact STT times
    const mapped = mapTextOntoExactStt(text || sttPlain, speech);
    return {
      segments: mapped || speech,
      mode: "exact-stt-mapped",
      plainText: text || sttPlain,
    };
  }
  // No STT times — even pack on film duration
  const dur = Math.max(1, Number(opts.durationSec) || 30);
  const segs = distributeTextOnTimeline(text, dur, 3, {
    speechPace: opts.speechPace || "normal",
  });
  return {
    segments: segs,
    mode: "even-timeline",
    plainText: text,
  };
}

/**
 * @deprecated keep name for callers — now just whole-text translate + proportional timeline
 * Prefer: translateText + distributeTextOnTimeline
 */
async function translateSegments1to1(segments, sourceLang, targetLang, opts = {}) {
  // Fallback: join segments → translate once → re-spread on same time grid
  const segs = Array.isArray(segments) ? segments : [];
  const plain = segs
    .map((s) => String(s && s.text ? s.text : "").trim())
    .filter(Boolean)
    .join(" ");
  const tr = await translateText(plain, sourceLang, targetLang, null, {
    force: true,
  });
  const outText =
    tr && tr.ok && tr.text ? String(tr.text).replace(/\s+/g, " ").trim() : plain;
  const dur =
    segs.length > 0
      ? Math.max(
          ...segs.map((s) => Number(s.end) || 0),
          Number(opts.durationSec) || 0
        )
      : Number(opts.durationSec) || 30;
  const step =
    segs.length >= 2
      ? Math.max(
          1,
          (Number(segs[1].start) || 3) - (Number(segs[0].start) || 0)
        )
      : 3;
  const distributed = distributeTextOnTimeline(outText, dur, step || 3, opts);
  return {
    segments: distributed,
    count: distributed.length,
    inputCount: segs.length,
    sameCount: true,
    translated: !!(tr && tr.ok && !tr.skipped),
    engine: (tr && tr.engine) || "nmt-proportional",
    plainText: outText,
  };
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
  describeStyle = "neutral",
  fromTranscript = false,
  /** STT/timeline segments (duration hint) */
  sttSegments = null,
  /** wolno | normalnie | szybko | auto */
  speechPace = "normal",
  textSpeechPace = null,
  textSpeedMode = null,
  onLive,
}) {
  const mode = narratorMode === "describe" ? "describe" : "translate";
  const tgt = targetLang && LANGUAGE_MODELS[targetLang] ? targetLang : "pl";
  const tgtModel = getLanguageModel(tgt);
  const descStyle = normalizeDescribeStyle(describeStyle);

  // Prefer EXPLICIT script (STT transcript). When fromTranscript, NEVER fall back to title.
  let raw = (narratorScript && narratorScript.trim()) || "";
  if (!raw && !fromTranscript) {
    raw = [title, description].filter(Boolean).join(". ").trim();
  }

  if (!raw) {
    const fallback = toSituationScript("", tgt, durationSec, descStyle);
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

  /** Timed segments: FULL text spread evenly on 0→duration (not STT speech holes) */
  let timedSegmentsOut = null;
  const timelineStep = 3; // exact translate cadence

  if (mustTranslate) {
    if (onLive) {
      onLive({
        phase: "translating",
        liveOriginal: raw,
        liveScript: "… tłumaczenie całego tekstu w toku …",
      });
    }
    let srcForNmt = "auto";
    if (source.forced && source.code && source.code !== "unknown") {
      srcForNmt = source.code;
    } else if (detected.code && detected.code !== "unknown") {
      srcForNmt = detected.code;
    }
    if (
      srcForNmt === "pl" &&
      !POLISH_CHARS.test(raw) &&
      detected.code === "en" &&
      (detected.confidence || 0) >= 0.25
    ) {
      srcForNmt = "en";
    }

    // 1) Translate FULL transcript as one coherent text (quality)
    const plainSrc = stripTimedMarkers(raw);
    const tr = await translateText(
      plainSrc,
      srcForNmt,
      tgt,
      (partial, i, n) => {
        if (onLive) {
          onLive({
            phase: "translating",
            liveOriginal: plainSrc,
            liveScript: partial,
            chunk: i,
            chunks: n,
          });
        }
      },
      { force: true }
    );
    if (tr.ok && tr.text) {
      outText = String(tr.text).replace(/\s+/g, " ").trim();
      if (
        outText.trim().toLowerCase() === plainSrc.trim().toLowerCase() &&
        tgt !== srcForNmt
      ) {
        const tr2 = await translateText(plainSrc, "auto", tgt, null, {
          force: true,
        });
        if (
          tr2.ok &&
          tr2.text &&
          tr2.text.trim().toLowerCase() !== plainSrc.trim().toLowerCase()
        ) {
          outText = String(tr2.text).replace(/\s+/g, " ").trim();
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
      original = plainSrc;
      if (tr.sourceUsed && tr.sourceUsed !== "auto") {
        source.code = tr.sourceUsed;
        source.label = getLanguageModel(tr.sourceUsed).label;
        source.model = getLanguageModel(tr.sourceUsed);
      }
    } else {
      translateError = tr.error || "tłumaczenie niedostępne";
      outText = plainSrc;
      original = plainSrc;
      usedModel = tr.model || usedModel;
    }

    // 2) Exact timed transcript from STT clocks (real speech times), not artificial even packs
    if (mode === "translate") {
      const dur = Math.max(
        1,
        Number(durationSec) ||
          (Array.isArray(sttSegments) && sttSegments.length
            ? Math.max(...sttSegments.map((s) => Number(s.end) || 0))
            : 30)
      );
      const paceKey = textSpeechPace || speechPace || textSpeedMode || "normal";
      const built = buildTimedScriptFromText({
        text: outText,
        sttSegments,
        durationSec: dur,
        speechPace: paceKey,
      });
      timedSegmentsOut = built.segments;
      const nSeg = timedSegmentsOut ? timedSegmentsOut.length : 0;
      const pace = resolveSpeechPace(paceKey);
      engine = (engine || "nmt") + "+" + (built.mode || "timeline");
      usedModel = {
        ...usedModel,
        modelName:
          (usedModel.modelName || modelNameFor(srcForNmt, tgt)) +
          (built.mode === "exact-stt" || built.mode === "exact-stt-mapped"
            ? ` · dokładna transkrypcja STT · ${nSeg} cue`
            : ` · ${pace.label} · ${nSeg} seg (fallback równomierny)`),
        segmentCount: nSeg,
        transcriptMode: built.mode,
        speechPace: pace.id,
        charsPerSec: pace.charsPerSec,
      };
    }
  } else if (onLive) {
    onLive({ phase: "same-lang", liveOriginal: raw, liveScript: raw });
    if (mode === "translate") {
      const plainSrc = stripTimedMarkers(raw);
      outText = plainSrc;
      original = plainSrc;
      const dur = Math.max(
        1,
        Number(durationSec) ||
          (Array.isArray(sttSegments) && sttSegments.length
            ? Math.max(...sttSegments.map((s) => Number(s.end) || 0))
            : 30)
      );
      const paceKey = textSpeechPace || speechPace || textSpeedMode || "normal";
      const built = buildTimedScriptFromText({
        text: plainSrc,
        sttSegments,
        durationSec: dur,
        speechPace: paceKey,
      });
      timedSegmentsOut = built.segments;
    }
  }

  let script = outText;
  if (mode === "describe") {
    script = toSituationScript(
      outText || raw || "",
      tgt,
      durationSec,
      descStyle
    );
    if (onLive) {
      onLive({
        phase: "done",
        liveOriginal: original || raw || "",
        liveScript: script,
      });
    }
  } else {
    // Exact translation: continuous script (timeline is separate timedSegments)
    script = stripTimedMarkers(outText || raw || "")
      .replace(/\s+/g, " ")
      .trim();
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
    describeStyle: mode === "describe" ? descStyle : null,
    model: usedModel,
    /** Full text split evenly on 0→duration (e.g. ~3 words/seg when short) */
    timedSegments: timedSegmentsOut,
    segmentCount: timedSegmentsOut ? timedSegmentsOut.length : null,
  };
}

// --- TTS multi-language via edge-tts (segmented like STT / AI video) ---
/**
 * ~chars per TTS segment ≈ 3 seconds of speech (exact translate cadence).
 * Neural voices ≈ 14–16 chars/s → ~45 for 3s.
 */
const TTS_SEGMENT_CHARS = 45;
/** Target speech seconds per TTS segment (for logs / progress). */
const TTS_SEGMENT_SEC = 3;

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
 * Clamp speech rate to one decimal place, 0.5× … 2.0× (1.0 = normal).
 */
function clampSpeechRate(rate) {
  let r = Number(rate);
  if (!Number.isFinite(r)) r = 1;
  r = Math.min(2, Math.max(0.5, r));
  return Math.round(r * 10) / 10;
}

/**
 * Edge-TTS rate string: 1.0 → "+0%", 1.2 → "+20%", 0.8 → "-20%".
 */
function edgeRateString(speechRate) {
  const r = clampSpeechRate(speechRate);
  const pct = Math.round((r - 1) * 100);
  if (pct === 0) return "+0%";
  return (pct > 0 ? "+" : "") + pct + "%";
}

/**
 * Auto / manual speech rate for narrator text.
 * Auto: estimate chars/s vs video duration → speed up or slow down (0.1 steps).
 * @param {{ textSpeedMode?: string, textSpeed?: number, speechRate?: number }} opts
 * @param {string} script
 * @param {number} videoDurSec
 */
function resolveSpeechRate(opts, script, videoDurSec) {
  const pace = resolveSpeechPace(opts);
  const mode = String(
    opts?.textSpeedMode || opts?.speechPace || opts?.textSpeechPace || pace.id || "normal"
  )
    .toLowerCase()
    .trim();

  // Named paces: wolno / normalnie / szybko
  if (mode === "slow" || mode === "wolno") return clampSpeechRate(0.85);
  if (mode === "fast" || mode === "szybko") return clampSpeechRate(1.2);
  if (mode === "normal" || mode === "normalnie") return clampSpeechRate(1.0);

  if (mode === "manual" || mode === "ręcznie" || mode === "recznie") {
    return clampSpeechRate(
      opts?.textSpeed != null
        ? opts.textSpeed
        : opts?.speechRate != null
          ? opts.speechRate
          : 1
    );
  }

  // Auto: fit estimated speech length into ~92% of video (using pace chars/s)
  const plain = stripTimedMarkers(String(script || ""));
  const chars = plain.length;
  const dur = Math.max(0, Number(videoDurSec) || 0);
  if (chars < 8 || dur < 1.5) return 1.0;
  const cps = pace.charsPerSec || 14;
  const estSec = chars / cps;
  const target = Math.max(1, dur * 0.92);
  let ratio = estSec / target;
  if (ratio < 0.75) {
    ratio = Math.max(0.7, ratio);
  }
  return clampSpeechRate(ratio);
}

/**
 * One Edge TTS segment. Text via UTF-8 file (not argv) — Windows CMD length limits.
 * @param {number} [speechRate=1] 0.5–2.0 (1 decimal)
 */
function generateEdgeTtsOne(text, voice, outMp3, speechRate = 1) {
  const dir = path.dirname(outMp3);
  fs.mkdirSync(dir, { recursive: true });
  const txtPath = outMp3.replace(/\.mp3$/i, ".txt");
  fs.writeFileSync(txtPath, String(text || "").trim(), "utf8");
  const rateStr = edgeRateString(speechRate);
  const py = `
import asyncio, sys
import edge_tts

async def main():
    path = sys.argv[1]
    voice = sys.argv[2]
    out = sys.argv[3]
    rate = sys.argv[4] if len(sys.argv) > 4 else "+0%"
    with open(path, "r", encoding="utf-8") as f:
        text = f.read().strip()
    if not text:
        raise SystemExit("empty text")
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(out)

asyncio.run(main())
`;
  const r = runPython(["-c", py, txtPath, voice, outMp3, rateStr], {
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

    const speechRate = clampSpeechRate(opts.speechRate != null ? opts.speechRate : 1);
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        // Even single-word cues must be spoken
        generateEdgeTtsOne(cueText, voice, mp3, speechRate);
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
  const speechRate = clampSpeechRate(opts.speechRate != null ? opts.speechRate : 1);
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
        generateEdgeTtsOne(chunks[i], voice, mp3, speechRate);
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
 * gender / voice: female | male | adam | Edge ShortName | short key (jenny, zofia…)
 * onSegment: ({ index, total, phase, pct, preview }) => void
 * videoDur + timedSegments: place speech on timeline (full video, not stop at ~26s)
 */
function generateNarratorAudio(
  script,
  targetLang,
  outWav,
  {
    gender = "female",
    voice = null,
    rate = 0,
    speechRate = null,
    textSpeedMode = "auto",
    textSpeed = 1,
    onSegment = null,
    videoDur = 0,
    timedSegments = null,
  } = {}
) {
  const lang = getLanguageModel(targetLang || "pl");
  const voiceKey = voice != null && voice !== "" ? voice : gender;
  const edgeVoice = resolveEdgeVoice(lang, voiceKey);
  const voiceMeta = (lang.ttsVoices || []).find((v) => v.id === edgeVoice);
  const preferMale =
    String(voiceKey || "").toLowerCase() === "male" ||
    String(voiceKey || "").toLowerCase() === "adam" ||
    String(voiceMeta?.gender || "").toLowerCase() === "male" ||
    edgeVoice === lang.ttsVoiceMale;

  // speechRate: explicit 0.5–2.0, or resolve from textSpeedMode/textSpeed + video length
  let resolvedRate =
    speechRate != null && Number.isFinite(Number(speechRate))
      ? clampSpeechRate(speechRate)
      : resolveSpeechRate(
          { textSpeedMode, textSpeed, speechRate: rate },
          script,
          videoDur
        );
  // Legacy SAPI rate was integer -10..10; if rate is in that range and no speechRate, map roughly
  if (
    speechRate == null &&
    textSpeedMode === "manual" &&
    Number.isFinite(Number(rate)) &&
    Math.abs(Number(rate)) > 0.01 &&
    Math.abs(Number(rate)) <= 10 &&
    Number(rate) !== 1
  ) {
    // SAPI rate 0 = normal; map ±10 → ~0.5–1.5
    const legacy = Number(rate);
    if (Math.abs(legacy) >= 1.5 || Number.isInteger(legacy)) {
      resolvedRate = clampSpeechRate(1 + legacy / 20);
    }
  }

  // 1) Edge neural voices — timed to video when duration known
  if (edgeVoice) {
    try {
      const useTimed = Number(videoDur) > 5;
      const ttsOpts = { onSegment, speechRate: resolvedRate };
      const p = useTimed
        ? generateTimedNarratorAudio(
            script,
            edgeVoice,
            outWav,
            videoDur,
            timedSegments,
            ttsOpts
          )
        : generateEdgeTts(script, edgeVoice, outWav, ttsOpts);
      const cues = useTimed
        ? buildTimedNarratorCues(script, videoDur, timedSegments)
        : null;
      return {
        path: p,
        voice: edgeVoice,
        engine: useTimed ? "edge-tts-timed" : "edge-tts-seg",
        lang: lang.code,
        speechRate: resolvedRate,
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
  const mapTts = (m) =>
    (m.ttsVoices || []).map((v) => ({
      id: v.id,
      label: v.label,
      gender: v.gender,
      key: v.key || null,
    }));
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
      ttsVoices: mapTts(m),
    })),
    targetLanguages: TARGET_LANGS.map((m) => ({
      code: m.code,
      label: m.label,
      labelEn: m.labelEn,
      modelId: `nmt-google-*-${m.code}`,
      modelName: `Google NMT · *→${m.code.toUpperCase()}`,
      ttsVoice: m.ttsVoice,
      ttsVoiceMale: m.ttsVoiceMale,
      ttsVoices: mapTts(m),
    })),
    // backward-compatible key
    languages: WORLD_LANGS.map((m) => ({
      code: m.code,
      label: m.label,
      modelId: `nmt-google-${m.code}-pl`,
      modelName: `Google NMT · ${m.code.toUpperCase()}→PL`,
      ttsVoice: m.ttsVoice,
      ttsVoices: mapTts(m),
    })),
  };
}

module.exports = {
  LANGUAGE_MODELS,
  WORLD_LANGS,
  TARGET_LANGS,
  LANG_LABELS,
  getLanguageModel,
  resolveEdgeVoice,
  listLanguageModels,
  detectLanguage,
  translateText,
  translateToPolish,
  preparePolishScript,
  prepareNarratorScript,
  toSituationScript,
  extractSpeechFromVideo,
  extractSpeechFromVideoSegmented,
  mergeOverlapSpeechText,
  dedupeSpeechSegments,
  joinSpeechTexts,
  probeVideoDurationSec,
  translateSegments1to1,
  distributeTextOnTimeline,
  stripTimedMarkers,
  SPEECH_PACE,
  resolveSpeechPace,
  packWholeWordsByChars,
  exactSpeechWindows,
  buildExactTranscriptSegments,
  mapTextOntoExactStt,
  buildTimedScriptFromText,
  STT_SEGMENT_SEC,
  TTS_SEGMENT_SEC,
  TTS_SEGMENT_CHARS,
  sttLocale,
  generateNarratorAudio,
  modelIdFor,
  modelNameFor,
  clampSpeechRate,
  edgeRateString,
  resolveSpeechRate,
};
