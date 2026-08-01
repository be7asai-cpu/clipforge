/**
 * Per-language "Pro Lektor" profiles — exact timed narrator quality.
 * No cloud LLM tokens: pure timing / density / TTS heuristics.
 *
 * Fields (all optional; missing → DEFAULT):
 * - charsPerSec: estimated speak density (spaces incl.) for film-fit + auto rate
 * - hopSec: edit-field / timeline hop (seconds)
 * - minCueDur / maxCueDur: TTS cue duration bounds
 * - cueGap: silence between non-overlapping cues (s)
 * - mergeSilenceBelow: join adjacent cues if gap < this (s)
 * - maxSegmentChars: soft max chars per TTS piece (Edge stability)
 * - speechRateBias: multiply final Edge rate (1 = neutral)
 * - pauseAfterSentenceMs: (meta) preferred pause feel after .!?
 * - preferTimedSlots: force 1:1 timed TTS when segments exist
 * - label: UI name
 */

const DEFAULT = {
  id: "default",
  label: "Default",
  charsPerSec: 13.5,
  hopSec: 6,
  minCueDur: 0.35,
  maxCueDur: 8.5,
  cueGap: 0.06,
  mergeSilenceBelow: 0.28,
  maxSegmentChars: 220,
  speechRateBias: 1.0,
  pauseAfterSentenceMs: 180,
  preferTimedSlots: true,
};

/** @type {Record<string, Partial<typeof DEFAULT> & { id?: string, label?: string }>} */
const PROFILES = {
  pl: {
    id: "pl",
    label: "Polski",
    // Polish is denser / longer words — slightly slower density + rate
    charsPerSec: 12.2,
    hopSec: 6,
    minCueDur: 0.4,
    maxCueDur: 8,
    cueGap: 0.07,
    mergeSilenceBelow: 0.32,
    maxSegmentChars: 200,
    speechRateBias: 0.96,
    pauseAfterSentenceMs: 200,
  },
  en: {
    id: "en",
    label: "English",
    charsPerSec: 14.5,
    hopSec: 5.5,
    minCueDur: 0.32,
    maxCueDur: 7.5,
    cueGap: 0.05,
    mergeSilenceBelow: 0.25,
    maxSegmentChars: 240,
    speechRateBias: 1.0,
    pauseAfterSentenceMs: 160,
  },
  de: {
    id: "de",
    label: "Deutsch",
    charsPerSec: 12.0,
    hopSec: 6.5,
    minCueDur: 0.42,
    maxCueDur: 9,
    cueGap: 0.08,
    mergeSilenceBelow: 0.35,
    maxSegmentChars: 210,
    speechRateBias: 0.94,
    pauseAfterSentenceMs: 210,
  },
  fr: {
    id: "fr",
    label: "Français",
    charsPerSec: 13.8,
    hopSec: 6,
    minCueDur: 0.38,
    maxCueDur: 8,
    cueGap: 0.06,
    mergeSilenceBelow: 0.28,
    maxSegmentChars: 230,
    speechRateBias: 0.98,
    pauseAfterSentenceMs: 190,
  },
  es: {
    id: "es",
    label: "Español",
    charsPerSec: 14.2,
    hopSec: 5.5,
    minCueDur: 0.35,
    maxCueDur: 7.5,
    cueGap: 0.05,
    mergeSilenceBelow: 0.26,
    maxSegmentChars: 230,
    speechRateBias: 1.02,
    pauseAfterSentenceMs: 170,
  },
  it: {
    id: "it",
    label: "Italiano",
    charsPerSec: 14.0,
    hopSec: 5.5,
    minCueDur: 0.35,
    maxCueDur: 7.5,
    cueGap: 0.05,
    mergeSilenceBelow: 0.26,
    maxSegmentChars: 230,
    speechRateBias: 1.01,
    pauseAfterSentenceMs: 170,
  },
  pt: {
    id: "pt",
    label: "Português",
    charsPerSec: 13.8,
    hopSec: 6,
    minCueDur: 0.36,
    maxCueDur: 8,
    cueGap: 0.06,
    mergeSilenceBelow: 0.28,
    maxSegmentChars: 220,
    speechRateBias: 1.0,
    pauseAfterSentenceMs: 180,
  },
  ru: {
    id: "ru",
    label: "Русский",
    charsPerSec: 12.5,
    hopSec: 6.5,
    minCueDur: 0.4,
    maxCueDur: 8.5,
    cueGap: 0.07,
    mergeSilenceBelow: 0.33,
    maxSegmentChars: 200,
    speechRateBias: 0.95,
    pauseAfterSentenceMs: 200,
  },
  uk: {
    id: "uk",
    label: "Українська",
    charsPerSec: 12.6,
    hopSec: 6.5,
    minCueDur: 0.4,
    maxCueDur: 8.5,
    cueGap: 0.07,
    mergeSilenceBelow: 0.33,
    maxSegmentChars: 200,
    speechRateBias: 0.95,
    pauseAfterSentenceMs: 200,
  },
  ar: {
    id: "ar",
    label: "العربية",
    charsPerSec: 11.5,
    hopSec: 6.5,
    minCueDur: 0.45,
    maxCueDur: 9,
    cueGap: 0.08,
    mergeSilenceBelow: 0.35,
    maxSegmentChars: 180,
    speechRateBias: 0.93,
    pauseAfterSentenceMs: 220,
  },
  hi: {
    id: "hi",
    label: "हिन्दी",
    charsPerSec: 12.8,
    hopSec: 6,
    minCueDur: 0.4,
    maxCueDur: 8,
    cueGap: 0.07,
    mergeSilenceBelow: 0.3,
    maxSegmentChars: 200,
    speechRateBias: 0.97,
    pauseAfterSentenceMs: 190,
  },
  zh: {
    id: "zh",
    label: "中文",
    // CJK: count chars denser; lower charsPerSec for fit budget
    charsPerSec: 8.5,
    hopSec: 5,
    minCueDur: 0.35,
    maxCueDur: 7,
    cueGap: 0.05,
    mergeSilenceBelow: 0.22,
    maxSegmentChars: 120,
    speechRateBias: 0.98,
    pauseAfterSentenceMs: 150,
  },
  ja: {
    id: "ja",
    label: "日本語",
    charsPerSec: 8.0,
    hopSec: 5,
    minCueDur: 0.35,
    maxCueDur: 7,
    cueGap: 0.05,
    mergeSilenceBelow: 0.22,
    maxSegmentChars: 100,
    speechRateBias: 0.97,
    pauseAfterSentenceMs: 160,
  },
  ko: {
    id: "ko",
    label: "한국어",
    charsPerSec: 9.0,
    hopSec: 5.5,
    minCueDur: 0.35,
    maxCueDur: 7.5,
    cueGap: 0.05,
    mergeSilenceBelow: 0.24,
    maxSegmentChars: 110,
    speechRateBias: 0.98,
    pauseAfterSentenceMs: 160,
  },
  tr: {
    id: "tr",
    label: "Türkçe",
    charsPerSec: 13.0,
    hopSec: 6,
    minCueDur: 0.38,
    maxCueDur: 8,
    cueGap: 0.06,
    mergeSilenceBelow: 0.28,
    maxSegmentChars: 210,
    speechRateBias: 0.99,
    pauseAfterSentenceMs: 180,
  },
  nl: {
    id: "nl",
    label: "Nederlands",
    charsPerSec: 13.5,
    hopSec: 6,
    minCueDur: 0.36,
    maxCueDur: 8,
    cueGap: 0.06,
    mergeSilenceBelow: 0.28,
    maxSegmentChars: 220,
    speechRateBias: 1.0,
    pauseAfterSentenceMs: 175,
  },
  cs: {
    id: "cs",
    label: "Čeština",
    charsPerSec: 12.4,
    hopSec: 6,
    minCueDur: 0.4,
    maxCueDur: 8,
    cueGap: 0.07,
    mergeSilenceBelow: 0.3,
    maxSegmentChars: 200,
    speechRateBias: 0.96,
    pauseAfterSentenceMs: 195,
  },
  sk: {
    id: "sk",
    label: "Slovenčina",
    charsPerSec: 12.4,
    hopSec: 6,
    minCueDur: 0.4,
    maxCueDur: 8,
    cueGap: 0.07,
    mergeSilenceBelow: 0.3,
    maxSegmentChars: 200,
    speechRateBias: 0.96,
    pauseAfterSentenceMs: 195,
  },
  ro: {
    id: "ro",
    label: "Română",
    charsPerSec: 13.2,
    hopSec: 6,
    minCueDur: 0.38,
    maxCueDur: 8,
    cueGap: 0.06,
    mergeSilenceBelow: 0.28,
    maxSegmentChars: 220,
    speechRateBias: 0.99,
    pauseAfterSentenceMs: 180,
  },
  hu: {
    id: "hu",
    label: "Magyar",
    charsPerSec: 12.0,
    hopSec: 6.5,
    minCueDur: 0.4,
    maxCueDur: 8.5,
    cueGap: 0.07,
    mergeSilenceBelow: 0.32,
    maxSegmentChars: 200,
    speechRateBias: 0.95,
    pauseAfterSentenceMs: 200,
  },
  sv: {
    id: "sv",
    label: "Svenska",
    charsPerSec: 13.2,
    hopSec: 6,
    minCueDur: 0.36,
    maxCueDur: 8,
    cueGap: 0.06,
    mergeSilenceBelow: 0.28,
    maxSegmentChars: 220,
    speechRateBias: 1.0,
    pauseAfterSentenceMs: 175,
  },
  no: {
    id: "no",
    label: "Norsk",
    charsPerSec: 13.2,
    hopSec: 6,
    minCueDur: 0.36,
    maxCueDur: 8,
    cueGap: 0.06,
    mergeSilenceBelow: 0.28,
    maxSegmentChars: 220,
    speechRateBias: 1.0,
    pauseAfterSentenceMs: 175,
  },
  da: {
    id: "da",
    label: "Dansk",
    charsPerSec: 13.0,
    hopSec: 6,
    minCueDur: 0.36,
    maxCueDur: 8,
    cueGap: 0.06,
    mergeSilenceBelow: 0.28,
    maxSegmentChars: 220,
    speechRateBias: 1.0,
    pauseAfterSentenceMs: 175,
  },
  fi: {
    id: "fi",
    label: "Suomi",
    charsPerSec: 11.8,
    hopSec: 6.5,
    minCueDur: 0.4,
    maxCueDur: 8.5,
    cueGap: 0.07,
    mergeSilenceBelow: 0.32,
    maxSegmentChars: 200,
    speechRateBias: 0.94,
    pauseAfterSentenceMs: 200,
  },
};

function normalizeLangCode(code) {
  let c = String(code || "auto").toLowerCase().trim();
  if (!c || c === "auto" || c === "unknown") return "auto";
  if (c.startsWith("zh")) return "zh";
  if (c.includes("-")) c = c.split("-")[0];
  if (c === "nb" || c === "nn") return "no";
  if (c === "iw") return "he";
  return c.slice(0, 8);
}

/**
 * Resolve pro-narrator profile for target language.
 * @param {string} langCode
 * @param {{ proNarrator?: boolean }} [opts]
 */
function getNarratorLangProfile(langCode, opts = {}) {
  const enabled = opts.proNarrator !== false;
  const code = normalizeLangCode(langCode);
  const base = { ...DEFAULT };
  if (!enabled) {
    return {
      ...base,
      id: "off",
      label: "Pro off",
      preferTimedSlots: true,
      speechRateBias: 1,
    };
  }
  const p = PROFILES[code];
  if (!p) {
    return { ...base, id: code === "auto" ? "auto" : code, label: code };
  }
  return { ...base, ...p };
}

/** List all profiles (for UI / debug). */
function listNarratorLangProfiles() {
  return Object.keys(PROFILES)
    .sort()
    .map((k) => getNarratorLangProfile(k));
}

module.exports = {
  DEFAULT,
  PROFILES,
  getNarratorLangProfile,
  listNarratorLangProfiles,
  normalizeLangCode,
};
