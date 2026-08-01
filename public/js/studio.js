/**
 * ClipForge Studio — client
 * Manual logo region picker, quality options, language hint + i18n.
 */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const tr = (key, fallback) =>
    (window.ClipForgeI18n && window.ClipForgeI18n.t(key)) || fallback || key;

  /** Cache last job so language switch re-renders live boxes without waiting for poll */
  let lastRenderedJob = null;

  /**
   * Map Polish server status strings in live boxes → current UI language.
   * Real transcript/translation text is left unchanged.
   */
  function translateLiveBoxText(text, emptyKey) {
    const raw = text == null ? "" : String(text).trim();
    if (!raw || raw === "—" || raw === "-") {
      return tr(emptyKey || "live.wait", "—");
    }
    // Exact / known status lines from pipeline (PL + EN)
    const exact = {
      "— wrzuć film i start —": "live.wait",
      "— drop a video and start —": "live.wait",
      "— czekam na wyodrębnienie i tłumaczenie… —": "live.wait2",
      "— waiting for extract & translate… —": "live.wait2",
      "— w kolejce —": "live.msg.queued",
      "— queued —": "live.msg.queued",
      "… słucham ścieżki audio / transkrypcja …": "live.msg.listening",
      "… listening to audio / transcription …": "live.msg.listening",
      "… najpierw TRANSKRYPCJA, potem tłumaczenie …": "live.msg.firstStt",
      "… first TRANSCRIPTION, then translation …": "live.msg.firstStt",
      "… najpierw TRANSKRYPCJA, potem pełny opis …": "live.msg.firstSttDesc",
      "… first TRANSCRIPTION, then full description …": "live.msg.firstSttDesc",
      "… rozpoznawanie mowy od początku do końca …": "live.msg.recognizing",
      "… recognizing speech from start to end …": "live.msg.recognizing",
      "… mam TRANSKRYPCJĘ — tłumaczę na język docelowy …": "live.msg.haveStt",
      "… transcript ready — translating to target language …": "live.msg.haveStt",
      "… mam tekst źródłowy — tłumaczę na żywo …": "live.msg.haveSource",
      "… source text ready — translating live …": "live.msg.haveSource",
      "… tłumaczenie transkrypcji w toku …": "live.msg.translating",
      "… translating transcript…": "live.msg.translating",
      "… buduję pełny opis sytuacji …": "live.msg.buildingDesc",
      "… building full situation description …": "live.msg.buildingDesc",
      "… brak transkrypcji — fallback …": "live.msg.noStt",
      "… no transcript — filename fallback …": "live.msg.noStt",
    };
    if (exact[raw]) return tr(exact[raw], raw);

    // "… pełna transkrypcja (en, 120 znaków) → tłumaczę …"
    let m = raw.match(
      /pełna transkrypcja\s*\(([^,]+),\s*(\d+)\s*znak/i
    );
    if (m) {
      return tr("live.msg.fullStt", raw)
        .replace("{lang}", m[1].trim())
        .replace("{n}", m[2]);
    }
    m = raw.match(/full transcript\s*\(([^,]+),\s*(\d+)\s*char/i);
    if (m) {
      return tr("live.msg.fullStt", raw)
        .replace("{lang}", m[1].trim())
        .replace("{n}", m[2]);
    }
    // Status prefixes (keep trailing detail after …)
    const prefixes = [
      [/słucham ścieżki audio/i, "live.msg.listening"],
      [/najpierw TRANSKRYPCJA,\s*potem pełny opis/i, "live.msg.firstSttDesc"],
      [/najpierw TRANSKRYPCJA/i, "live.msg.firstStt"],
      [/first TRANSCRIPTION,\s*then full/i, "live.msg.firstSttDesc"],
      [/first TRANSCRIPTION/i, "live.msg.firstStt"],
      [/rozpoznawanie mowy/i, "live.msg.recognizing"],
      [/recognizing speech/i, "live.msg.recognizing"],
      [/mam TRANSKRYPCJ/i, "live.msg.haveStt"],
      [/transcript ready/i, "live.msg.haveStt"],
      [/mam tekst źródłowy/i, "live.msg.haveSource"],
      [/source text ready/i, "live.msg.haveSource"],
      [/tłumaczenie transkrypcji/i, "live.msg.translating"],
      [/translating transcript/i, "live.msg.translating"],
      [/buduję pełny opis/i, "live.msg.buildingDesc"],
      [/building full situation/i, "live.msg.buildingDesc"],
      [/brak transkrypcji/i, "live.msg.noStt"],
      [/no transcript/i, "live.msg.noStt"],
      [/w kolejce/i, "live.msg.queued"],
      [/^queued$/i, "live.msg.queued"],
    ];
    for (const [re, key] of prefixes) {
      if (re.test(raw) && raw.length < 180) return tr(key, raw);
    }
    // Real STT / translation content — do not rewrite
    return raw;
  }

  /** Map pipeline stage labels (Polish/EN from server) → UI language */
  function translateStageLabel(label) {
    if (!label) return "—";
    const s = String(label).trim();
    const exact = {
      "Analiza pliku": "stage.probe",
      "File analysis": "stage.probe",
      "Auto-korekcja kolorów": "stage.autoColor",
      "Auto color correction": "stage.autoColor",
      "Usuwanie logo / znaku wodnego": "stage.delogo",
      "Usuwanie logo": "stage.delogoShort",
      "Removing logo / watermark": "stage.delogo",
      "Removing logo": "stage.delogoShort",
      "Ekstrakcja klatek": "stage.extract",
      "Frame extraction": "stage.extract",
      "Klatki + delogo": "stage.extractDelogo",
      "Frames + delogo": "stage.extractDelogo",
      "AI upscale (Real-ESRGAN)": "stage.ai",
      "AI upscale": "stage.aiShort",
      // Live AI progress uses "AI realesr-… x2 n/total (pct%) · turbo" — leave as-is via prefix rule below
      "Składanie wideo HD": "stage.assemble",
      "Assembling HD video": "stage.assemble",
      "Poprawa wideo HD": "stage.fast",
      "HD video polish": "stage.fast",
      "Kodowanie obrazu": "stage.encode",
      "Video encode": "stage.encode",
      "Wyodrębnianie tekstu z wideo": "stage.stt",
      "Extracting text from video": "stage.stt",
      "Transkrypcja gotowa": "stage.sttDone",
      "Transcription ready": "stage.sttDone",
      "Tłumaczenie na żywo": "stage.translate",
      "Live translation": "stage.translate",
      "Treść do opisu": "stage.sttDescribe",
      "Content for description": "stage.sttDescribe",
      "Pełny opis sytuacji": "stage.translateDescribe",
      "Full situation description": "stage.translateDescribe",
      "Język / lektor": "stage.lang",
      "Language / narrator": "stage.lang",
      "Mikser audio + final": "stage.mix",
      "Audio mix + final": "stage.mix",
      "Gotowe": "stage.done",
      Done: "stage.done",
      Start: "stage.start",
      "Błąd": "stage.error",
      Error: "stage.error",
      "W kolejce": "stage.queued",
      Queued: "stage.queued",
      "W kolejce (ponownie)": "stage.queuedAgain",
      "Anulowane": "stage.cancelled",
      Cancelled: "stage.cancelled",
      "Zatrzymane (timeout)": "stage.stuck",
      "przetwarzanie…": "stage.processing",
      "— w kolejce —": "stage.queuedWait",
      Lektor: "stage.narrator",
      Narrator: "stage.narrator",
      Napisy: "stage.subs",
      Captions: "stage.subs",
    };
    if (exact[s]) return tr(exact[s], s);

    // Live AI ESRGAN progress: "AI realesr-animevideov3 x2 690/1011 (68%) · turbo"
    // Keep model/frame counts visible — do not rewrite.
    if (
      /^AI\s+realesr/i.test(s) ||
      /^AI\s+[\w.-]+\s+x\d+/i.test(s) ||
      /\brealesr[-_]?animevideov3\b/i.test(s)
    ) {
      return s;
    }

    // Prefix patterns: "Lektor TTS (pl)", "Napisy (en)", "Lektor …"
    const mNarr = s.match(/^Lektor TTS\s*(\([^)]*\))?/i) || s.match(/^Narrator TTS\s*(\([^)]*\))?/i);
    if (mNarr) return tr("stage.narratorTts", "Narrator TTS") + (mNarr[1] ? " " + mNarr[1] : "");
    if (/^Lektor\b/i.test(s) || /^Narrator\b/i.test(s)) {
      const rest = s.replace(/^(Lektor|Narrator)\b\s*/i, "");
      return tr("stage.narrator", "Narrator") + (rest ? " " + rest : "");
    }
    if (/^Napisy\b/i.test(s) || /^Captions\b/i.test(s)) {
      const rest = s.replace(/^(Napisy|Captions)\b\s*/i, "");
      return tr("stage.subs", "Captions") + (rest ? " " + rest : "");
    }
    // Partial contains known Polish stage names
    for (const [pl, key] of Object.entries(exact)) {
      if (s.includes(pl) || s.toLowerCase().includes(String(pl).toLowerCase())) {
        // only use if pl is long enough to avoid false positives
        if (String(pl).length >= 6) {
          const translated = tr(key, pl);
          // keep trailing details after " · " or "…"
          const tail = s.slice(s.indexOf(pl) + pl.length);
          return translated + tail;
        }
      }
    }
    return s;
  }

  const dropzone = $("#dropzone");
  const fileInput = $("#file-input");
  const fileLabel = $("#file-label");
  const btnStart = $("#btn-start");
  const optNarrator = $("#opt-narrator");
  const optNarratorOnly = $("#opt-narrator-only");
  const narratorOpts = $("#narrator-opts");
  const optSubs = $("#opt-subs");
  const burnWrap = $("#burn-wrap");
  const optBg = $("#opt-bg");
  const optBgVal = $("#opt-bg-val");
  const optDelogo = $("#opt-delogo");
  const delogoOpts = $("#delogo-opts");
  const panelFilmik = document.querySelector(".panel-filmik");
  const logoPicker = $("#logo-picker");
  const canvas = $("#logo-canvas");
  const ctx = canvas.getContext("2d");
  const logoCoords = $("#logo-coords");
  const langBadge = $("#lang-badge");

  let selectedFile = null;
  /** Blob URL of selected file — used as "before" player when job finishes */
  let selectedFileObjectUrl = null;
  let activeJobId = null;
  let pollTimer = null;
  let lastDoneJob = null;
  let videoNatural = { w: 0, h: 0 };
  let frameBitmap = null;
  let syncSeekLock = false;
  /** @type {{x:number,y:number,w:number,h:number}[]} */
  let logoBoxes = [];
  let drag = null; // {x0,y0,x1,y1} in canvas CSS pixels mapped to video

  // --- UI wiring ---
  optNarrator.addEventListener("change", () => {
    narratorOpts.classList.toggle("hidden", !optNarrator.checked);
    if (!optNarrator.checked && optNarratorOnly?.checked) {
      optNarratorOnly.checked = false;
      optNarratorOnly.dispatchEvent(new Event("change"));
    }
  });
  optSubs.addEventListener("change", () => {
    burnWrap.classList.toggle("hidden", !optSubs.checked);
  });
  optBg.addEventListener("input", () => {
    optBgVal.textContent = optBg.value + "%";
  });
  burnWrap.classList.add("hidden");

  optDelogo.addEventListener("change", () => {
    delogoOpts.classList.toggle("hidden", !optDelogo.checked);
  });

  /** One-click: skip video enhance → narrator/STT only */
  function setNarratorOnlyBadgeText() {
    const badge = document.getElementById("narrator-only-badge");
    if (!badge) return;
    badge.textContent = tr(
      "narrator.onlyBadge",
      "⚡ tylko lektor — poprawa wideo wyłączona"
    );
  }
  function applyNarratorOnlyUi(on) {
    if (panelFilmik) {
      panelFilmik.classList.toggle("panel-dimmed", !!on);
      panelFilmik.querySelectorAll("input, select, button, textarea").forEach((el) => {
        if (el.id === "file-input") return; // still allow picking a file
        el.disabled = !!on;
      });
    }
    const badge = document.getElementById("narrator-only-badge");
    if (badge) {
      setNarratorOnlyBadgeText();
      badge.classList.toggle("hidden", !on);
    }
    if (on) {
      if (optNarrator && !optNarrator.checked) {
        optNarrator.checked = true;
        optNarrator.dispatchEvent(new Event("change"));
      }
    }
  }
  optNarratorOnly?.addEventListener("change", () => {
    applyNarratorOnlyUi(optNarratorOnly.checked);
  });
  // Sync badge with current language + checkbox state
  setNarratorOnlyBadgeText();
  if (optNarratorOnly?.checked) applyNarratorOnlyUi(true);
  else applyNarratorOnlyUi(false);

  function polishMode() {
    return (
      document.querySelector('input[name="polish-mode"]:checked')?.value ||
      "auto"
    );
  }

  function audioMode() {
    return (
      document.querySelector('input[name="audio-mode"]:checked')?.value ||
      "auto"
    );
  }

  function syncAudioModeUi() {
    const on = $("#opt-audio")?.checked !== false;
    const audioOpts = $("#audio-opts");
    const sliders = $("#audio-sliders");
    const hint = $("#audio-auto-hint");
    const bitrate = $("#opt-audio-bitrate");
    if (audioOpts) audioOpts.classList.toggle("hidden", !on);
    const auto = audioMode() === "auto";
    if (sliders) {
      sliders.classList.toggle("is-disabled", auto);
      sliders.querySelectorAll("input").forEach((el) => {
        el.disabled = auto;
      });
    }
    // Bitrate always editable; voice/normalize too
    if (hint) hint.classList.toggle("hidden", !auto || !on);
    const voice = $("#opt-audio-voice");
    const norm = $("#opt-audio-normalize");
    if (voice) voice.disabled = auto;
    if (norm) norm.disabled = auto;
    if (bitrate) bitrate.disabled = false;
  }

  $("#opt-audio")?.addEventListener("change", syncAudioModeUi);
  document.querySelectorAll('input[name="audio-mode"]').forEach((el) => {
    el.addEventListener("change", syncAudioModeUi);
  });
  [
    ["opt-audio-volume", "opt-audio-volume-val", ""],
    ["opt-audio-bass", "opt-audio-bass-val", ""],
    ["opt-audio-treble", "opt-audio-treble-val", ""],
    ["opt-audio-denoise", "opt-audio-denoise-val", ""],
  ].forEach(([id, vid]) => {
    const inp = $("#" + id);
    const lab = $("#" + vid);
    if (inp && lab) {
      inp.addEventListener("input", () => {
        lab.textContent = inp.value;
      });
    }
  });
  syncAudioModeUi();
  function syncPolishModeUi() {
    const on = $("#opt-polish")?.checked;
    const polishOpts = $("#polish-opts");
    const sliders = $("#quality-sliders");
    const rgbSliders = $("#rgb-sliders");
    const rgbBlock = $("#rgb-block");
    const hint = $("#polish-auto-hint");
    const preset = $("#opt-quality-preset");
    if (polishOpts) polishOpts.classList.toggle("hidden", !on);
    if (rgbBlock) rgbBlock.classList.toggle("hidden", !on);
    const auto = polishMode() === "auto";
    if (sliders) {
      sliders.classList.toggle("is-disabled", auto);
      sliders.querySelectorAll("input,select").forEach((el) => {
        el.disabled = auto;
      });
    }
    if (rgbSliders) {
      rgbSliders.classList.toggle("is-disabled", auto);
      rgbSliders.querySelectorAll("input").forEach((el) => {
        el.disabled = auto;
      });
    }
    const rgbReset = $("#btn-rgb-reset");
    if (rgbReset) rgbReset.disabled = auto || !on;
    if (hint) hint.classList.toggle("hidden", !auto || !on);
    if (preset) {
      // auto analysis chooses soft/balanced/sharp/punch; hide forced preset when auto
      preset.disabled = auto;
      if (auto) {
        // keep a placeholder option value
        if (![...preset.options].some((o) => o.value === "auto")) {
          const o = document.createElement("option");
          o.value = "auto";
          o.textContent = "Auto";
          o.setAttribute("data-i18n", "quality.polishAuto");
          preset.insertBefore(o, preset.firstChild);
        }
        preset.value = "auto";
      } else if (preset.value === "auto") {
        preset.value = "balanced";
      }
    }
  }
  $("#opt-polish")?.addEventListener("change", syncPolishModeUi);
  document.querySelectorAll('input[name="polish-mode"]').forEach((el) => {
    el.addEventListener("change", syncPolishModeUi);
  });
  syncPolishModeUi();

  function delogoMode() {
    return document.querySelector('input[name="delogo-mode"]:checked')?.value || "manual";
  }

  document.querySelectorAll('input[name="delogo-mode"]').forEach((el) => {
    el.addEventListener("change", () => {
      logoPicker.classList.toggle("hidden", delogoMode() !== "manual" || !frameBitmap);
    });
  });

  // sliders labels
  [
    ["opt-brightness", "opt-brightness-val"],
    ["opt-shadows", "opt-shadows-val"],
    ["opt-highlights", "opt-highlights-val"],
    ["opt-temperature", "opt-temperature-val"],
    ["opt-sharpen", "opt-sharpen-val"],
    ["opt-contrast", "opt-contrast-val"],
    ["opt-sat", "opt-sat-val"],
    ["opt-denoise", "opt-denoise-val"],
    ["opt-rgb-r", "opt-rgb-r-val"],
    ["opt-rgb-g", "opt-rgb-g-val"],
    ["opt-rgb-b", "opt-rgb-b-val"],
  ].forEach(([id, vid]) => {
    const el = $("#" + id);
    const lab = $("#" + vid);
    if (el && lab) {
      el.addEventListener("input", () => {
        lab.textContent = el.value;
      });
    }
  });
  $("#btn-rgb-reset")?.addEventListener("click", () => {
    ["opt-rgb-r", "opt-rgb-g", "opt-rgb-b"].forEach((id) => {
      const el = $("#" + id);
      const lab = $("#" + id + "-val");
      if (el) el.value = "50";
      if (lab) lab.textContent = "50";
    });
  });

  const LANG_NAMES = {
    auto: "auto",
    en: "angielski",
    zh: "chiński",
    hi: "hindi",
    es: "hiszpański",
    fr: "francuski",
    ar: "arabski",
    it: "włoski",
    pt: "portugalski",
    ru: "rosyjski",
    de: "niemiecki",
    pl: "polski",
    bn: "bengalski",
    ur: "urdu",
    ja: "japoński",
    he: "hebrajski",
    ko: "koreański",
  };

  function nmtPair(src, tgt) {
    const s = src || "auto";
    const t = tgt || "pl";
    if (s === t) return { id: `passthrough-${t}`, name: `Passthrough ${t.toUpperCase()}` };
    return {
      id: `nmt-google-${s}-${t}`,
      name: `Google NMT · ${s.toUpperCase()}→${t.toUpperCase()}`,
    };
  }

  // language hint client-side (mirrors server top languages)
  function detectLangClient(text) {
    const t = String(text || "");
    if (!t.trim()) return null;
    const letters = (t.match(/\S/g) || []).length || 1;
    const ratio = (re) => ((t.match(re) || []).length) / letters;
    if (ratio(/[\u0600-\u06FF]/g) > 0.12) return "ar";
    if (ratio(/[\u0900-\u097F]/g) > 0.12) return "hi";
    if (ratio(/[\u0980-\u09FF]/g) > 0.12) return "bn";
    if (ratio(/[\u4E00-\u9FFF]/g) > 0.12) return "zh";
    if (ratio(/[\u3040-\u30FF]/g) > 0.08) return "ja";
    if (ratio(/[\u0400-\u04FF]/g) > 0.12) return "ru";
    if (ratio(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) > 0.04) return "pl";
    if (/\b(the|and|you|this|video|not|worth)\b/i.test(t)) return "en";
    if (/\b(el|la|que|los|para)\b/i.test(t)) return "es";
    if (/\b(le|les|des|une|pour)\b/i.test(t)) return "fr";
    if (/\b(o|uma|não|para|com)\b/i.test(t)) return "pt";
    if (/\b(il|che|per|una|non|sono)\b/i.test(t)) return "it";
    if (/\b(der|die|das|und|ist|nicht)\b/i.test(t)) return "de";
    if (/[A-Za-z]{3,}/.test(t)) return "en";
    return null;
  }

  function narratorMode() {
    return (
      document.querySelector('input[name="narrator-mode"]:checked')?.value ||
      "translate"
    );
  }

  function targetLang() {
    return $("#opt-target-lang")?.value || "pl";
  }

  /** targetLang code → Edge TTS voices from /api/studio/languages */
  let voiceCatalog = null;

  function genderMark(g) {
    if (g === "male") return "♂";
    if (g === "female") return "♀";
    return "";
  }

  /**
   * Rebuild #opt-voice for current target language (many named Edge voices).
   */
  function rebuildVoiceSelect(preserveValue) {
    const sel = $("#opt-voice");
    if (!sel) return;
    const lang = targetLang();
    const prev =
      preserveValue != null
        ? preserveValue
        : sel.value || localStorage.getItem("clipforge.voice") || "";

    const voicesFromApi = (() => {
      if (!voiceCatalog) return null;
      const list =
        voiceCatalog.targetLanguages ||
        voiceCatalog.sourceLanguages ||
        [];
      const hit = list.find((x) => x.code === lang);
      return hit && Array.isArray(hit.ttsVoices) && hit.ttsVoices.length
        ? hit.ttsVoices
        : null;
    })();

    // Static fallbacks when API not loaded
    const FALLBACK = {
      pl: [
        { id: "pl-PL-ZofiaNeural", label: "Zofia", gender: "female" },
        { id: "pl-PL-MarekNeural", label: "Marek", gender: "male" },
        { id: "en-US-JennyNeural", label: "Jenny (EN)", gender: "female" },
        { id: "en-US-AriaNeural", label: "Aria (EN)", gender: "female" },
        { id: "en-US-AvaNeural", label: "Ava (EN)", gender: "female" },
        { id: "en-GB-SoniaNeural", label: "Sonia (UK)", gender: "female" },
        { id: "en-US-GuyNeural", label: "Guy (EN)", gender: "male" },
        { id: "en-US-AndrewNeural", label: "Andrew (EN)", gender: "male" },
        { id: "en-US-BrianNeural", label: "Brian (EN)", gender: "male" },
        { id: "en-GB-RyanNeural", label: "Ryan (UK)", gender: "male" },
      ],
      en: [
        { id: "en-US-JennyNeural", label: "Jenny (US)", gender: "female" },
        { id: "en-US-AriaNeural", label: "Aria (US)", gender: "female" },
        { id: "en-US-AvaNeural", label: "Ava (US)", gender: "female" },
        { id: "en-US-EmmaNeural", label: "Emma (US)", gender: "female" },
        { id: "en-US-MichelleNeural", label: "Michelle (US)", gender: "female" },
        { id: "en-GB-SoniaNeural", label: "Sonia (UK)", gender: "female" },
        { id: "en-GB-LibbyNeural", label: "Libby (UK)", gender: "female" },
        { id: "en-US-GuyNeural", label: "Guy (US)", gender: "male" },
        { id: "en-US-AndrewNeural", label: "Andrew (US)", gender: "male" },
        { id: "en-US-BrianNeural", label: "Brian (US)", gender: "male" },
        { id: "en-US-ChristopherNeural", label: "Christopher (US)", gender: "male" },
        { id: "en-GB-RyanNeural", label: "Ryan (UK)", gender: "male" },
        { id: "en-GB-ThomasNeural", label: "Thomas (UK)", gender: "male" },
      ],
    };

    const voices =
      voicesFromApi ||
      FALLBACK[lang] ||
      FALLBACK.en ||
      [
        { id: "female", label: tr("narrator.female", "Female (neural)"), gender: "female" },
        { id: "male", label: tr("narrator.male", "Male (neural)"), gender: "male" },
      ];

    const females = voices.filter((v) => v.gender === "female");
    const males = voices.filter((v) => v.gender === "male");
    const other = voices.filter(
      (v) => v.gender !== "female" && v.gender !== "male"
    );

    sel.innerHTML = "";
    function addGroup(label, items) {
      if (!items.length) return;
      const og = document.createElement("optgroup");
      og.label = label;
      for (const v of items) {
        const opt = document.createElement("option");
        opt.value = v.id;
        const mark = genderMark(v.gender);
        opt.textContent = mark ? `${v.label} ${mark}` : v.label;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
    addGroup(tr("narrator.voiceFemaleGroup", "Żeńskie"), females);
    addGroup(tr("narrator.voiceMaleGroup", "Męskie"), males);
    addGroup(tr("narrator.voiceOtherGroup", "Inne"), other);

    // Always keep generic fallbacks at the end
    const ogDef = document.createElement("optgroup");
    ogDef.label = tr("narrator.voiceDefaultGroup", "Domyślne");
    for (const [val, lab] of [
      ["female", tr("narrator.female", "Żeński (neural)")],
      ["male", tr("narrator.male", "Męski (neural)")],
    ]) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = lab;
      ogDef.appendChild(opt);
    }
    sel.appendChild(ogDef);

    // Restore selection if still available
    const values = Array.from(sel.options).map((o) => o.value);
    if (prev && values.includes(prev)) {
      sel.value = prev;
    } else if (voices[0]) {
      sel.value = voices[0].id;
    }

    const hint = $("#voice-hint");
    if (hint) {
      hint.textContent = tr(
        "narrator.voiceHintN",
        "{n} głosów dla języka {lang}"
      )
        .replace("{n}", String(voices.length))
        .replace("{lang}", LANG_NAMES[lang] || lang);
    }
  }

  async function loadVoiceCatalog() {
    try {
      const res = await fetch("/api/studio/languages", {
        credentials: "same-origin",
      });
      if (!res.ok) return;
      voiceCatalog = await res.json();
      rebuildVoiceSelect();
    } catch (_) {
      rebuildVoiceSelect();
    }
  }

  function describeStyle() {
    const v = $("#opt-describe-style")?.value || "neutral";
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
    return ok.includes(v) ? v : "neutral";
  }

  function refreshDescribeStyleUi() {
    const wrap = $("#describe-style-wrap");
    if (!wrap) return;
    wrap.classList.toggle("hidden", narratorMode() !== "describe");
  }

  function refreshModeHint() {
    const hint = $("#mode-hint");
    if (!hint) return;
    const tgt = LANG_NAMES[targetLang()] || targetLang();
    if (narratorMode() === "describe") {
      hint.textContent =
        tr("narrator.modeHintD", "Full description monologue") + ` (${tgt})`;
    } else {
      hint.textContent =
        tr("narrator.modeHintT", "Exact live translation") + ` → ${tgt}`;
    }
    refreshDescribeStyleUi();
  }

  function transcriptSource() {
    return (
      document.querySelector('input[name="transcript-source"]:checked')
        ?.value || "stt"
    );
  }

  function refreshTranscriptHint() {
    const hint = $("#transcript-source-hint");
    if (!hint) return;
    if (transcriptSource() === "captions") {
      hint.textContent = tr(
        "narrator.transcriptHintCaps",
        "Przy Start (pole puste): gotowe napisy z filmu / YouTube."
      );
    } else {
      hint.textContent = tr(
        "narrator.transcriptHintStt",
        "Przy Start (pole puste): STT z dźwięku. Osobna opcja «Źródło wyodrębniania» jest przy przycisku Wyodrębnij."
      );
    }
  }

  /** Extract-only: stt = audio STT, captions = YouTube/film subs */
  function extractSource() {
    return (
      document.querySelector('input[name="extract-source"]:checked')?.value ||
      "stt"
    );
  }

  /** Drop [Music], [muzyka], (Applause), ♪ — non-speech caption tags */
  function stripNonSpeechLabelsClient(text) {
    let t = String(text || "");
    t = t.replace(/[♪♫♬♩]+/g, " ");
    t = t.replace(
      /[\[\(【]\s*(?:music|muzyka|applause|oklaski|laughter|śmiech|smiech|silence|cisza|cheering|sings?|śpiew|spiew|instrumental|noise|hałas|halas|crowd|inaudible)[^\]\)】]{0,40}[\]\)】]/gi,
      " "
    );
    t = t.replace(/\[\s*(?!\d{1,2}:\d{2})[^\]]{1,36}\]/g, " ");
    t = t.replace(
      /(?:^|[\s,;])(?:Music|Muzyka|Applause|Oklaski|Laughter|Śmiech|Silence|Cisza)(?=[\s,;.!?]|$)/gi,
      " "
    );
    return t.replace(/\s+/g, " ").trim();
  }

  /** Continuous paragraph only — strip [mm:ss → mm:ss] lines if present */
  function toPlainScriptText(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (countExactCues(s) < 1) {
      return stripNonSpeechLabelsClient(s.replace(/\s+/g, " ").trim());
    }
    const parts = [];
    for (const line of s.split(/\r?\n/)) {
      const t = String(line || "").trim();
      if (!t) continue;
      const body = stripNonSpeechLabelsClient(
        t
          .replace(
            /^\s*\[\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*[–—→\-]+\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*s?\s*\]\s*/i,
            ""
          )
          .trim()
      );
      if (body) parts.push(body);
    }
    return stripNonSpeechLabelsClient(
      (parts.join(" ") || s).replace(/\s+/g, " ").trim()
    );
  }

  function refreshLangBadge() {
    const sel = $("#opt-source-lang")?.value || "auto";
    const tgt = targetLang();
    const t = [$("#opt-title").value, $("#opt-script").value].join(" ");
    const detected = detectLangClient(t);
    const mode = narratorMode() === "describe" ? "opis" : "tłumaczenie";
    const srcForModel = sel === "auto" ? detected || "auto" : sel;
    const model = nmtPair(srcForModel, tgt);

    if (sel === "auto") {
      langBadge.textContent = detected
        ? `${LANG_NAMES[detected] || detected} → ${LANG_NAMES[tgt] || tgt} · ${mode}`
        : `auto → ${LANG_NAMES[tgt] || tgt} · ${mode}`;
    } else {
      langBadge.textContent = `${LANG_NAMES[sel] || sel} → ${LANG_NAMES[tgt] || tgt} · ${mode}${
        detected && detected !== sel
          ? ` · (tekst: ${LANG_NAMES[detected] || detected})`
          : ""
      }`;
    }

    const mb = $("#model-badge");
    if (mb) {
      mb.textContent = `model: ${model.id} · ${model.name}`;
      mb.title = model.name;
    }
  }

  document.querySelectorAll('input[name="narrator-mode"]').forEach((el) => {
    el.addEventListener("change", () => {
      refreshModeHint();
      refreshLangBadge();
    });
  });
  refreshDescribeStyleUi();
  document.querySelectorAll('input[name="transcript-source"]').forEach((el) => {
    el.addEventListener("change", () => {
      refreshTranscriptHint();
    });
  });
  $("#opt-source-lang")?.addEventListener("change", () => {
    refreshModeHint();
    refreshLangBadge();
  });
  $("#opt-target-lang")?.addEventListener("change", () => {
    rebuildVoiceSelect();
    refreshModeHint();
    refreshLangBadge();
  });
  $("#opt-title").addEventListener("input", refreshLangBadge);
  $("#opt-script").addEventListener("input", refreshLangBadge);

  // Tempo mowy: Auto / Wyłącz / suwak ±0.1
  $("#opt-text-speed-auto")?.addEventListener("change", () => {
    if ($("#opt-text-speed-auto")?.checked && $("#opt-text-speed-off")) {
      $("#opt-text-speed-off").checked = false;
    }
    syncTextSpeedControls();
  });
  $("#opt-text-speed-off")?.addEventListener("change", () => {
    if ($("#opt-text-speed-off")?.checked && $("#opt-text-speed-auto")) {
      $("#opt-text-speed-auto").checked = false;
    }
    syncTextSpeedControls();
  });
  $("#opt-text-speed")?.addEventListener("input", () => {
    setTextSpeedUi($("#opt-text-speed").value);
  });
  $("#opt-text-speed-num")?.addEventListener("change", () => {
    setTextSpeedUi($("#opt-text-speed-num").value);
  });
  $("#opt-text-speed-num")?.addEventListener("input", () => {
    setTextSpeedUi($("#opt-text-speed-num").value);
  });
  $("#btn-text-speed-minus")?.addEventListener("click", () => {
    setTextSpeedUi(getTextSpeedValue() - 0.1);
  });
  $("#btn-text-speed-plus")?.addEventListener("click", () => {
    setTextSpeedUi(getTextSpeedValue() + 0.1);
  });
  syncTextSpeedControls();

  refreshModeHint();
  refreshTranscriptHint();
  refreshLangBadge();

  /** Prefer exact STT timed transcription unless user fully disabled it */
  function wantSmartRewrite() {
    const el = $("#opt-smart-rewrite");
    return el ? !!el.checked : true;
  }
  function wantUseOllama() {
    const el = $("#opt-use-ollama");
    // Ollama only meaningful when smart rewrite is on
    return wantSmartRewrite() && (el ? !!el.checked : true);
  }

  function wantTimedTranscript() {
    const el = $("#opt-timed-transcript");
    // default ON when control missing
    if (!el) return true;
    return !!el.checked;
  }

  /** textSpeedMode: auto | off | manual */
  function getTextSpeedMode() {
    if ($("#opt-text-speed-off")?.checked) return "off";
    if ($("#opt-text-speed-auto")?.checked) return "auto";
    return "manual";
  }

  /** Slider value 0.5–2.0 step 0.1 (used when mode=manual) */
  function getTextSpeedValue() {
    const n = Number($("#opt-text-speed")?.value);
    if (!Number.isFinite(n)) return 1;
    return Math.round(Math.min(2, Math.max(0.5, n)) * 10) / 10;
  }

  function clampTextSpeedUi(v) {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 1;
    n = Math.min(2, Math.max(0.5, n));
    return Math.round(n * 10) / 10;
  }

  function setTextSpeedUi(val) {
    const v = clampTextSpeedUi(val);
    const range = $("#opt-text-speed");
    const num = $("#opt-text-speed-num");
    const lab = $("#opt-text-speed-val");
    if (range) range.value = String(v);
    if (num) num.value = String(v);
    if (lab) {
      const mode = getTextSpeedMode();
      lab.textContent =
        mode === "off"
          ? "1.0× · " + tr("narrator.speedOffShort", "wył.")
          : mode === "auto"
            ? tr("narrator.speedAutoShort", "auto")
            : v.toFixed(1) + "×";
    }
  }

  function syncTextSpeedControls() {
    const off = !!$("#opt-text-speed-off")?.checked;
    const auto = !!$("#opt-text-speed-auto")?.checked;
    // Mutual exclusion: off wins over auto
    if (off && auto && $("#opt-text-speed-auto")) {
      $("#opt-text-speed-auto").checked = false;
    }
    const locked = off || !!$("#opt-text-speed-auto")?.checked;
    ["opt-text-speed", "opt-text-speed-num", "btn-text-speed-minus", "btn-text-speed-plus"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = locked;
      }
    );
    setTextSpeedUi(getTextSpeedValue());
  }

  /** Count exact cue lines [mm:ss → mm:ss] text */
  function countExactCues(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let n = 0;
    for (const l of lines) {
      if (/^\[\s*\d{1,2}:\d{2}/.test(l)) n += 1;
    }
    return n;
  }

  /**
   * Clean timed lines: keep [mm:ss → mm:ss], strip [Music]/non-speech from body.
   */
  function cleanTimedScriptText(raw) {
    const lines = [];
    for (const line of String(raw || "").split(/\r?\n/)) {
      const t = String(line || "").trim();
      if (!t) continue;
      const m = t.match(
        /^(\[\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*[–—→\-]+\s*\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*s?\s*\])\s*(.*)$/i
      );
      if (m) {
        const body = stripNonSpeechLabelsClient(m[2] || "");
        if (body) lines.push(m[1].replace(/\s+/g, " ").trim() + " " + body);
        continue;
      }
      const plain = stripNonSpeechLabelsClient(t);
      if (plain) lines.push(plain);
    }
    return lines.join("\n");
  }

  /**
   * Apply extract → ONLY #opt-script (Tekst do tłumaczenia).
   * Does not change voice, Start path, or other options beyond this field.
   * wantTimed ON  → segment lines [start → end] 1:1 with source STT/captions
   * wantTimed OFF → continuous plain paragraph
   */
  function applyExtractPayload(data, wantTimed, onlyOriginal, tgtLang, setSt) {
    const plainPrefer = String(
      data.plainText || data.plainOriginal || ""
    ).trim();
    const raw = String(data.text || data.script || "").trim();
    const timed = String(data.timedText || data.timedScript || "").trim();
    // Prefer dedicated timed payload; also accept timed lines inside text/script
    const timedRaw =
      timed ||
      (countExactCues(raw) >= 1 ? raw : "") ||
      (countExactCues(plainPrefer) >= 1 ? plainPrefer : "");
    const timedClean = cleanTimedScriptText(timedRaw);
    const plainClean = toPlainScriptText(
      plainPrefer || (countExactCues(raw) ? "" : raw) || timed
    );
    let useText = "";
    let isTimed = false;
    if (wantTimed && timedClean && countExactCues(timedClean) >= 1) {
      // ONLY the translation textarea — segment clocks from source
      useText = timedClean;
      isTimed = true;
    } else if (wantTimed && plainClean) {
      // Timed requested but API sent plain only — still show plain in field
      useText = plainClean;
      isTimed = false;
    } else {
      useText = plainClean || toPlainScriptText(timedClean);
      isTimed = false;
    }
    if (!useText) {
      setSt(
        data.error ||
          tr(
            "narrator.extractEmpty",
            "Brak mowy w audio (muzyka / cisza). Spróbuj napisów z filmu albo wklej tekst ręcznie."
          ),
        "err"
      );
      return false;
    }
    // Touch ONLY the translation/script field (+ empty title if missing)
    const ta = $("#opt-script");
    if (ta) {
      ta.value = useText;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const titleEl = $("#opt-title");
    if (titleEl && !String(titleEl.value || "").trim() && data.title) {
      titleEl.value = data.title;
      titleEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    refreshLangBadge();
    const nCues = isTimed ? countExactCues(useText) : 0;
    const meta = [
      isTimed
        ? tr(
            "narrator.extractMetaExact",
            "pole tekstu · {n} segmentów 1:1 ze źródłem"
          ).replace("{n}", String(nCues || data.exactCueCount || "?"))
        : tr("narrator.extractMetaPlain", "pole tekstu · ciągły"),
      data.translated && !onlyOriginal
        ? tr("narrator.extractMetaTr", "przetłumaczono") +
          " → " +
          (data.targetLang || tgtLang)
        : tr("narrator.extractMetaOrig", "oryginał"),
      data.engine ? String(data.engine) : null,
      data.durationSec
        ? "~" + Math.round(Number(data.durationSec)) + "s"
        : null,
      data.rewriteEngine === "ollama"
        ? tr("narrator.rewriteMetaOllama", "Ollama") +
          (data.ollamaModel ? " · " + data.ollamaModel : "")
        : data.rewriteEngine === "offline"
          ? tr("narrator.rewriteMetaOffline", "przeredag. offline")
          : data.rewriteEngine === "simple"
            ? tr("narrator.rewriteMetaSimple", "proste skrócenie")
            : null,
      data.fromUrl ? "URL" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const okMsg = isTimed
      ? tr(
          "narrator.extractOkExact",
          "W polu «Tekst do tłumaczenia»: segmenty z czasem 1:1 jak w źródle."
        )
      : tr(
          "narrator.extractOk",
          "W polu «Tekst do tłumaczenia»: tekst ciągły."
        );
    setSt(okMsg + (meta ? " (" + meta + ")" : ""), "ok");
    return true;
  }

  /** Poll pre-transcribe job from platform URL until script ready */
  async function pollPreTranscribeJob(jobId, wantTimed, onlyOriginal, tgtLang, setSt) {
    const t0 = Date.now();
    const maxMs = 12 * 60 * 1000;
    while (Date.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 1800));
      const res = await fetch("/api/studio/jobs/" + jobId + "?_=" + Date.now(), {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      const job = data.job;
      if (!job) continue;
      const stage = job.stage || "";
      const live = job.liveScript || job.liveOriginal || "";
      if (job.status === "running" || job.status === "queued") {
        setSt(
          tr("narrator.extractBusyUrl", "Z linku: {stage}")
            .replace("{stage}", stage || "…") +
            (live ? " · " + String(live).slice(0, 40) + "…" : ""),
          "busy"
        );
        continue;
      }
      if (job.status === "failed") {
        throw new Error(job.error || "STT z linku nieudane");
      }
      if (job.status === "done") {
        const r = job.result || {};
        return applyExtractPayload(
          {
            text: r.scriptPlain || r.script || job.liveScript || "",
            plainText:
              r.scriptPlain ||
              r.plainText ||
              r.script ||
              job.liveScript ||
              "",
            timedText: r.timedScript || r.language?.timedScript || "",
            originalText: r.originalText || r.language?.original || job.liveOriginal,
            translated: !!(r.language && r.language.translated),
            engine: r.engine || null,
            langCode: r.language?.sourceLang?.code || null,
            targetLang: tgtLang,
            durationSec: r.duration || null,
            exactCueCount: r.exactCueCount || r.segments || null,
            transcriptMode: r.transcriptMode || null,
            segments: r.exactCueCount || r.segments || null,
            rewriteEngine: r.rewriteEngine || null,
            ollamaModel: r.ollamaModel || null,
            fromUrl: true,
            title: job.originalName,
          },
          wantTimed,
          onlyOriginal,
          tgtLang,
          setSt
        );
      }
    }
    throw new Error(
      tr(
        "narrator.extractUrlTimeout",
        "Timeout STT z linku — sprawdź agenta PC i spróbuj ponownie."
      )
    );
  }

  /** Pre-job STT + exact translate → fill #opt-script (file OR link) */
  async function extractTranscriptToField() {
    const status = $("#extract-transcript-status");
    const btn = $("#btn-extract-transcript");
    const setSt = (msg, kind) => {
      if (!status) return;
      status.textContent = msg || "";
      status.classList.remove("is-busy", "is-ok", "is-err");
      if (kind) status.classList.add("is-" + kind);
    };
    const url = videoUrlInput();
    if (!selectedFile && !url) {
      setSt(
        tr(
          "narrator.extractNeedFile",
          "Najpierw wrzuć wideo albo wklej link w kolumnie 1."
        ),
        "err"
      );
      return;
    }
    const wantTimed = wantTimedTranscript();
    const smartRewrite = wantSmartRewrite();
    const useOllama = wantUseOllama();
    const onlyOriginal = !!$("#opt-extract-no-tr")?.checked;
    const srcLang = $("#opt-source-lang")?.value || "auto";
    const tgtLang = targetLang() || "pl";
    // Prefer exact-translate mode when doing full extract+translate
    if (!onlyOriginal) {
      const trRadio = document.querySelector(
        'input[name="narrator-mode"][value="translate"]'
      );
      if (trRadio && !trRadio.checked) {
        trRadio.checked = true;
        trRadio.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const autoTr = $("#opt-auto-translate");
      if (autoTr) autoTr.checked = true;
    }
    if (btn) btn.disabled = true;
    // Dedicated extract option (not the Start/lektor radios above)
    const srcMode = extractSource(); // stt | captions
    setSt(
      selectedFile
        ? srcMode === "captions"
          ? tr(
              "narrator.extractBusyCaps",
              "Pobieram napisy z filmu… (może potrwać)"
            )
          : onlyOriginal
            ? tr(
                "narrator.extractBusy",
                "Rozpoznaję mowę z dźwięku… (może potrwać)"
              )
            : tr(
                "narrator.extractBusyTr",
                "STT z dźwięku + tłumaczenie… (może potrwać)"
              )
        : srcMode === "captions"
          ? tr(
              "narrator.extractBusyFromUrlCaps",
              "Z linku: napisy YouTube… (PC · ON)"
            )
          : tr(
              "narrator.extractBusyFromUrl",
              "Z linku: pobieram wideo + STT z dźwięku… (PC · ON)"
            ),
      "busy"
    );
    try {
      let res;
      let data;
      if (selectedFile) {
        const fd = new FormData();
        fd.append("video", selectedFile, selectedFile.name || "video.mp4");
        fd.append("sourceLang", srcLang);
        fd.append("targetLang", tgtLang);
        fd.append("autoTranslate", onlyOriginal ? "0" : "1");
        fd.append("timedTranscript", wantTimed ? "1" : "0");
        fd.append("smartRewrite", smartRewrite ? "1" : "0");
        fd.append("useOllama", useOllama ? "1" : "0");
        fd.append("transcriptSource", srcMode);
        const speedMode = getTextSpeedMode();
        fd.append("speechPace", speedMode);
        fd.append("textSpeedMode", speedMode);
        fd.append("textSpeed", String(getTextSpeedValue()));
        res = await fetch("/api/studio/transcribe", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        });
        data = await res.json().catch(() => ({}));
      } else {
        const speedMode = getTextSpeedMode();
        res = await fetch("/api/studio/transcribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            sourceLang: srcLang,
            targetLang: tgtLang,
            autoTranslate: !onlyOriginal,
            timedTranscript: wantTimed,
            smartRewrite,
            useOllama,
            transcriptSource: srcMode,
            speechPace: speedMode,
            textSpeechPace: speedMode,
            textSpeedMode: speedMode,
            textSpeed: getTextSpeedValue(),
          }),
        });
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        throw new Error(data.error || "HTTP " + res.status);
      }
      // Platform URL → agent job — poll until script ready
      if (data.pending && data.jobId) {
        setSt(
          srcMode === "captions"
            ? tr(
                "narrator.extractBusyAgentCaps",
                "Agent PC: napisy YouTube z linku…"
              )
            : tr(
                "narrator.extractBusyAgent",
                "Agent PC: pobieranie + STT z dźwięku…"
              ),
          "busy"
        );
        await pollPreTranscribeJob(
          data.jobId,
          wantTimed,
          onlyOriginal,
          tgtLang,
          setSt
        );
        return;
      }
      applyExtractPayload(data, wantTimed, onlyOriginal, tgtLang, setSt);
    } catch (e) {
      setSt(
        tr("narrator.extractFail", "Błąd transkrypcji: ") +
          (e.message || e),
        "err"
      );
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  $("#btn-extract-transcript")?.addEventListener("click", () => {
    extractTranscriptToField();
  });

  // Smart rewrite ↔ Ollama checkbox linkage + status probe
  function syncOllamaCheckbox() {
    const smart = $("#opt-smart-rewrite");
    const oll = $("#opt-use-ollama");
    const wrap = $("#opt-use-ollama-wrap");
    if (oll) oll.disabled = smart ? !smart.checked : false;
    if (wrap) wrap.style.opacity = smart && !smart.checked ? "0.5" : "";
  }
  $("#opt-smart-rewrite")?.addEventListener("change", syncOllamaCheckbox);
  syncOllamaCheckbox();

  async function refreshOllamaStatus() {
    const el = $("#ollama-status");
    if (!el) return;
    try {
      const res = await fetch("/api/studio/ollama-status", {
        credentials: "same-origin",
      });
      const st = await res.json().catch(() => ({}));
      if (st && st.ok && st.model) {
        el.textContent = tr(
          "narrator.ollamaStatusOn",
          "Ollama: ON · model {model}"
        ).replace("{model}", st.model);
        el.classList.remove("is-err");
        el.classList.add("is-ok");
      } else if (st && st.online) {
        el.textContent = tr(
          "narrator.ollamaStatusNoModel",
          "Ollama działa, ale brak modelu — ollama pull llama3.2"
        );
        el.classList.remove("is-ok");
      } else {
        el.textContent = tr(
          "narrator.ollamaStatusOff",
          "Ollama: OFF — uruchom Ollamę na PC, żeby użyć lokalnego AI"
        );
        el.classList.remove("is-ok");
      }
    } catch {
      el.textContent = tr(
        "narrator.ollamaStatusOff",
        "Ollama: OFF — uruchom Ollamę na PC, żeby użyć lokalnego AI"
      );
    }
  }
  refreshOllamaStatus();
  setInterval(refreshOllamaStatus, 45000);

  // --- file + first frame for logo picker ---
  function setFile(file) {
    if (!file) return;
    if (
      !/\.(mp4|mov|webm|mkv|avi|m4v|mpeg|mpg|wmv|flv|3gp|ts|mts|m2ts)$/i.test(
        file.name
      ) &&
      !file.type.startsWith("video/")
    ) {
      alert(
        tr(
          "err.video",
          "Choose a video file (mp4, mov, webm, mkv, avi, m4v, mpeg, wmv, flv, 3gp, ts…)."
        )
      );
      return;
    }
    selectedFile = file;
    if (selectedFileObjectUrl) {
      try {
        URL.revokeObjectURL(selectedFileObjectUrl);
      } catch (_) {}
    }
    selectedFileObjectUrl = URL.createObjectURL(file);
    fileLabel.textContent = `${file.name} · ${(file.size / 1e6).toFixed(1)} MB`;
    dropzone.classList.add("has-file");
    logoBoxes = [];
    loadVideoFrame(file);
    updateStartEnabled();
  }

  function loadVideoFrame(file) {
    // Reuse selectedFileObjectUrl when possible — do NOT revoke it (needed for compare player)
    const reused = !!selectedFileObjectUrl;
    const url = selectedFileObjectUrl || URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const done = () => {
      try {
        videoNatural = { w: video.videoWidth, h: video.videoHeight };
        // display size max 360 height
        const maxH = 360;
        const scale = Math.min(1, maxH / video.videoHeight);
        const dw = Math.round(video.videoWidth * scale);
        const dh = Math.round(video.videoHeight * scale);
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.style.width = dw + "px";
        canvas.style.height = dh + "px";
        ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        frameBitmap = ctx.getImageData(0, 0, canvas.width, canvas.height);
        logoPicker.classList.toggle(
          "hidden",
          !optDelogo.checked || delogoMode() !== "manual"
        );
        redraw();
      } finally {
        if (!reused) {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {}
        }
      }
    };

    video.addEventListener("loadeddata", () => {
      // seek a bit into video for better logo visibility
      const t = Math.min(1.5, (video.duration || 2) * 0.1);
      video.currentTime = t || 0.1;
    });
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", () => {
      if (!reused) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
      logoPicker.classList.add("hidden");
    });
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.round((clientX - rect.left) * sx),
      y: Math.round((clientY - rect.top) * sy),
    };
  }

  function redraw(tempBox) {
    if (frameBitmap) {
      ctx.putImageData(frameBitmap, 0, 0);
    }
    const drawBox = (b, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, Math.round(canvas.width / 280));
      ctx.fillStyle = "rgba(88, 224, 200, 0.18)";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    };
    logoBoxes.forEach((b) => drawBox(b, "#58e0c8"));
    if (tempBox) drawBox(tempBox, "#ff8b6a");
    if (!logoBoxes.length && !tempBox) {
      logoCoords.textContent = tr(
        "delogo.draw",
        "brak obszaru — narysuj prostokąt na logo"
      );
    } else {
      const parts = logoBoxes.map(
        (b, i) => `#${i + 1} x=${b.x} y=${b.y} ${b.w}×${b.h}`
      );
      logoCoords.textContent = parts.join(" · ");
    }
  }

  function onDown(e) {
    if (!frameBitmap || delogoMode() !== "manual") return;
    e.preventDefault();
    const p = canvasPoint(e);
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }
  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    const p = canvasPoint(e);
    drag.x1 = p.x;
    drag.y1 = p.y;
    const b = normDrag(drag);
    redraw(b);
  }
  function onUp(e) {
    if (!drag) return;
    e.preventDefault();
    const b = normDrag(drag);
    drag = null;
    if (b.w >= 8 && b.h >= 8) {
      logoBoxes.push(b);
    }
    redraw();
  }
  function normDrag(d) {
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    return {
      x: Math.max(0, Math.min(x, canvas.width - 1)),
      y: Math.max(0, Math.min(y, canvas.height - 1)),
      w: Math.min(w, canvas.width - x),
      h: Math.min(h, canvas.height - y),
    };
  }

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("touchend", onUp);

  $("#btn-logo-clear").addEventListener("click", () => {
    logoBoxes = [];
    redraw();
  });
  $("#btn-logo-undo").addEventListener("click", () => {
    logoBoxes.pop();
    redraw();
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) setFile(fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  });

  function applyAutoPolishPreview(ap) {
    if (!ap) return;
    const setRange = (id, valId, v) => {
      const el = $(id);
      const lab = $(valId);
      if (el && v != null && !Number.isNaN(Number(v))) {
        el.value = String(Math.round(Number(v)));
        if (lab) lab.textContent = el.value;
      }
    };
    setRange("#opt-brightness", "#opt-brightness-val", ap.brightness);
    setRange("#opt-shadows", "#opt-shadows-val", ap.shadows);
    setRange("#opt-highlights", "#opt-highlights-val", ap.highlights);
    setRange("#opt-temperature", "#opt-temperature-val", ap.temperature);
    setRange("#opt-sharpen", "#opt-sharpen-val", ap.sharpen);
    setRange("#opt-contrast", "#opt-contrast-val", ap.contrast);
    setRange("#opt-sat", "#opt-sat-val", ap.saturation);
    setRange("#opt-denoise", "#opt-denoise-val", ap.denoise);
    setRange("#opt-rgb-r", "#opt-rgb-r-val", ap.rgbR);
    setRange("#opt-rgb-g", "#opt-rgb-g-val", ap.rgbG);
    setRange("#opt-rgb-b", "#opt-rgb-b-val", ap.rgbB);
    const preset = $("#opt-quality-preset");
    if (preset && ap.qualityPreset && ap.qualityPreset !== "auto") {
      // show chosen preset as value while keeping disabled in auto mode
      if (![...preset.options].some((o) => o.value === ap.qualityPreset)) {
        const o = document.createElement("option");
        o.value = ap.qualityPreset;
        o.textContent = ap.qualityPreset;
        preset.appendChild(o);
      }
      // temporary enable to set, then re-sync disabled
      const was = preset.disabled;
      preset.disabled = false;
      preset.value = ap.qualityPreset;
      preset.disabled = was;
    }
    const box = $("#polish-auto-result");
    if (box) {
      const t = (k, f) =>
        (window.ClipForgeI18n && window.ClipForgeI18n.t(k)) || f;
      box.classList.remove("hidden");
      box.textContent =
        t("quality.polishAutoResult", "Auto set") +
        `: ${t("quality.brightness", "jasność")} ${ap.brightness}` +
        ` · ${t("quality.shadows", "cienie")} ${ap.shadows}` +
        ` · ${t("quality.highlights", "światła")} ${ap.highlights}` +
        ` · ${t("quality.temperature", "temp")} ${ap.temperature}` +
        ` · ${t("quality.contrast", "kontrast")} ${ap.contrast}` +
        ` · ${t("quality.sat", "sat")} ${ap.saturation}` +
        ` · ${t("quality.sharpen", "ostrość")} ${ap.sharpen}` +
        ` · ${t("quality.denoise", "denoise")} ${ap.denoise}` +
        (ap.rgbR != null
          ? ` · RGB ${ap.rgbR}/${ap.rgbG}/${ap.rgbB}`
          : "") +
        (ap.qualityPreset ? ` · ${ap.qualityPreset}` : "");
    }
  }

  function collectOptions() {
    const narratorOnly = !!(optNarratorOnly && optNarratorOnly.checked);
    let upscale =
      document.querySelector('input[name="upscale"]:checked')?.value || "ai";
    const mode = delogoMode();
    const opts = {
      narratorOnly,
      delogo: narratorOnly ? false : optDelogo.checked,
      delogoMode: mode,
      delogoMethod: $("#opt-delogo-method").value,
      delogoBoxes: mode === "manual" ? logoBoxes.slice() : [],
      delogoBox: mode === "manual" && logoBoxes[0] ? logoBoxes[0] : null,
      polish: narratorOnly ? false : $("#opt-polish").checked,
      polishMode: narratorOnly ? "off" : polishMode(),
      speedMode: $("#opt-speed")?.value || "auto",
      qualityPreset: narratorOnly
        ? "off"
        : polishMode() === "auto"
          ? "auto"
          : $("#opt-quality-preset").value,
      // sliders only for manual; auto fills on server after analysis
      sharpen:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-sharpen").value),
      contrast:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-contrast").value),
      saturation:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-sat").value),
      denoise:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-denoise").value),
      brightness:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-brightness")?.value ?? 50),
      shadows:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-shadows")?.value ?? 50),
      highlights:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-highlights")?.value ?? 50),
      temperature:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-temperature")?.value ?? 50),
      // RGB balance 0–100 (50 neutral); null in auto → server fills after analysis
      rgbR:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-rgb-r")?.value ?? 50),
      rgbG:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-rgb-g")?.value ?? 50),
      rgbB:
        polishMode() === "auto" || narratorOnly
          ? null
          : Number($("#opt-rgb-b")?.value ?? 50),
      upscale: narratorOnly ? "off" : upscale,
      aiScale: Number($("#opt-ai-scale").value) || 2,
      aiModel: $("#opt-ai-model")?.value || "animevideov3",
      targetHeight: Number($("#opt-height").value) || 1080,
      /** "source" | 24 | 25 | 30 | 60 — output frame rate */
      targetFps: (() => {
        const v = String($("#opt-fps")?.value || "source").trim();
        if (!v || v === "source" || v === "auto") return "source";
        const n = Number(v);
        return Number.isFinite(n) && n >= 1 ? n : "source";
      })(),
      crf: Number($("#opt-crf").value) || 15,
      crfPreset: Number($("#opt-crf").value) <= 15 ? "slow" : "medium",
      // Creative video FX (FFmpeg — free)
      videoStyle: narratorOnly
        ? "off"
        : $("#opt-video-style")?.value || "off",
      videoAspect: narratorOnly
        ? "original"
        : $("#opt-video-aspect")?.value || "original",
      stabilize: narratorOnly
        ? "off"
        : $("#opt-stabilize")?.value || "off",
      playbackSpeed: narratorOnly
        ? 1
        : Number($("#opt-playback-speed")?.value) || 1,
      maxDurationSec: narratorOnly
        ? 0
        : Number($("#opt-max-duration")?.value) || 0,
      fadeEdges: narratorOnly ? false : !!$("#opt-fade-edges")?.checked,
      narrator: narratorOnly ? true : optNarrator.checked,
      narratorMode: narratorMode(),
      describeStyle: describeStyle(),
      /** stt = speech-to-text (default, as before); captions = video subs → timed transcript */
      transcriptSource:
        document.querySelector('input[name="transcript-source"]:checked')
          ?.value || "stt",
      sourceLang: $("#opt-source-lang")?.value || "auto",
      targetLang: targetLang(),
      autoTranslate: $("#opt-auto-translate").checked,
      /** true = script as timed transcription [mm:ss–mm:ss]; false = plain continuous text */
      timedTranscript: wantTimedTranscript(),
      textSpeedMode: getTextSpeedMode(),
      speechPace: getTextSpeedMode(),
      textSpeechPace: getTextSpeedMode(),
      textSpeed: getTextSpeedValue(),
      narratorVoice: $("#opt-voice").value,
      title: $("#opt-title").value.trim(),
      narratorScript: $("#opt-script").value.trim(),
      bgVolume: Number(optBg.value) / 100,
      // Audio enhance (column 2, under narrator)
      audioEnhance: $("#opt-audio")?.checked !== false,
      audioMode: $("#opt-audio")?.checked === false ? "off" : audioMode(),
      audioBitrate: Number($("#opt-audio-bitrate")?.value) || 160,
      audioVolume:
        audioMode() === "auto" ? null : Number($("#opt-audio-volume")?.value),
      audioBass:
        audioMode() === "auto" ? null : Number($("#opt-audio-bass")?.value),
      audioTreble:
        audioMode() === "auto" ? null : Number($("#opt-audio-treble")?.value),
      audioDenoise:
        audioMode() === "auto" ? null : Number($("#opt-audio-denoise")?.value),
      audioVoiceOnly:
        audioMode() === "auto"
          ? null
          : !!$("#opt-audio-voice")?.checked,
      audioNormalize:
        audioMode() === "auto"
          ? null
          : $("#opt-audio-normalize")?.checked !== false,
      subtitles: optSubs.checked,
      burnSubtitles: $("#opt-burn").checked,
      videoSize: videoNatural,
    };
    return opts;
  }

  /** Stop polling, kill active/queued jobs on server, return UI to idle */
  async function resetToIdle(opts = {}) {
    const { confirm: needConfirm = true, clearFile = false } = opts;
    if (needConfirm) {
      const ok = window.confirm(
        tr(
          "confirm.reset",
          "Anulować bieżący proces i wrócić do startu?\n\nStary job zostanie zatrzymany — możesz od razu zacząć nowy."
        )
      );
      if (!ok) return false;
    }
    const resetBtn = $("#btn-reset");
    const cancelBtn = $("#btn-cancel");
    const newBtn = $("#btn-new-process");
    const labelReset = tr("btn.reset", "⟲ Nowy");
    const labelCancel = tr("btn.cancel", "■ Anuluj proces");
    const labelNew = tr("btn.newProcess", "⟲ Nowy proces (od startu)");
    if (resetBtn) {
      resetBtn.disabled = true;
      resetBtn.textContent = tr("btn.resetting", "Resetuję…");
    }
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.textContent = tr("btn.cancelling", "Anuluję…");
    }
    if (newBtn) {
      newBtn.disabled = true;
      newBtn.textContent = tr("btn.resetting", "Resetuję…");
    }
    stopPolling();
    try {
      await fetch("/api/studio/reset", {
        method: "POST",
        cache: "no-store",
      }).catch(() => null);
    } catch {
      /* ignore network */
    }
    activeJobId = null;
    lastRenderedJob = null;
    lastDoneJob = null;
    lastProg = { p: -1, t: 0, stage: "" };

    if (clearFile) {
      selectedFile = null;
      if (selectedFileObjectUrl) {
        try {
          URL.revokeObjectURL(selectedFileObjectUrl);
        } catch (_) {}
        selectedFileObjectUrl = null;
      }
      clearCompareVideos();
      if (fileInput) fileInput.value = "";
      if (fileLabel) {
        fileLabel.textContent = tr("drop.sub", "max ~500 MB · tymczasowa obróbka");
      }
      dropzone?.classList.remove("has-file");
    }

    const idle = $("#idle-state");
    const jobState = $("#job-state");
    const resBox = $("#result-box");
    const errBox = $("#error-box");
    if (idle) {
      idle.classList.remove("hidden");
      idle.textContent = tr(
        "reset.done",
        "Gotowe — możesz wrzucić film i zacząć od nowa."
      );
    }
    if (jobState) jobState.classList.add("hidden");
    if (resBox) {
      resBox.classList.add("hidden");
      delete resBox.dataset.scrolledFor;
    }
    if (errBox) {
      errBox.classList.add("hidden");
      errBox.textContent = "";
    }
    $("#btn-retry")?.classList.add("hidden");
    cancelBtn?.classList.add("hidden");
    newBtn?.classList.add("hidden");

    const lo = $("#live-original");
    const ls = $("#live-script");
    const lp = $("#live-phase");
    if (lo) {
      lo.removeAttribute("data-i18n-lock");
      lo.textContent = tr("live.wait", "— wrzuć film i start —");
    }
    if (ls) {
      ls.removeAttribute("data-i18n-lock");
      ls.textContent = tr("live.wait2", "— czekam na wyodrębnienie i tłumaczenie… —");
    }
    if (lp) lp.textContent = "";

    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.textContent = labelReset;
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = labelCancel;
    }
    if (newBtn) {
      newBtn.disabled = false;
      newBtn.textContent = labelNew;
    }
    if (btnStart) {
      btnStart.disabled = !selectedFile;
      btnStart.textContent = tr("btn.start", "Start obróbki");
    }
    return true;
  }

  /** One-click PC agent — fetch+blob (cookie session; works when <a href> fails) */
  async function downloadPcAgentSetup() {
    try {
      sessionStorage.setItem("clipforge_pc_setup_offered", "1");
    } catch (_) {}
    const url =
      "/api/studio/pc-setup?label=" + encodeURIComponent("Moj PC") + "&_=" + Date.now();
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        alert(
          "Musisz być zalogowany, żeby pobrać agenta.\nZaloguj się i kliknij ⬇ PC ponownie.\n\nKażda osoba pobiera SWÓJ plik po zalogowaniu — nie wysyłaj .cmd koledze."
        );
        location.href =
          "/login.html?next=" + encodeURIComponent("/studio.html");
        return;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        alert(
          "Nie można pobrać agenta (HTTP " +
            res.status +
            ").\n" +
            (t || "").slice(0, 200) +
            "\n\nOdśwież stronę albo zdeployuj najnowszy kod na Render."
        );
        return;
      }
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = "ClipForge-PC-Agent.cmd";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 2000);
      alert(
        "Pobrano ClipForge-PC-Agent.cmd\n\n" +
          "• Kod agenta ściąga się Z CHMURY na TEN komputer\n" +
          "  (folder %LOCALAPPDATA%\\ClipForge-Agent) — nie z dysku kolegi.\n" +
          "• Odpal pobrany .cmd i zostaw okno otwarte.\n" +
          "• Potrzebny Node.js LTS: https://nodejs.org\n\n" +
          "Każda osoba loguje się sama i klika ⬇ PC (nie wysyłaj swojego .cmd)."
      );
    } catch (err) {
      alert(
        "Błąd pobierania agenta: " +
          (err && err.message ? err.message : String(err)) +
          "\nSprawdź czy jesteś zalogowany i czy strona jest Live."
      );
    }
  }

  /**
   * @param {boolean|object} pcState - true/false or health.pcAgent object
   */
  /** Live flag for URL import (platform links need agent) */
  let pcAgentOnline = false;
  /** Last full PC agent status (for i18n re-apply) */
  let lastPcAgentState = { online: false };

  function updateUrlImportHint() {
    const hint = $("#url-import-hint");
    if (!hint) return;
    if (pcAgentOnline) {
      hint.innerHTML = tr(
        "pc.hintOnHtml",
        "<strong>PC · ON</strong> — możesz wkleić YouTube / TikTok / Instagram / Vimeo (agent pobierze yt-dlp) albo bezpośredni .mp4. Job liczy się na Twoim PC."
      );
    } else {
      hint.innerHTML = tr(
        "pc.hintOffHtml",
        "Plik .mp4/.webm — zawsze. YouTube/TikTok — tylko przy <strong>PC · ON</strong> (odpal agent / ⬇ PC). Bez agenta wklej bezpośredni link do pliku."
      );
    }
  }

  function ensurePcAgentUi(pcState) {
    const head = document.querySelector(".panel-progress-actions") ||
      document.querySelector(".panel-progress-head");
    if (!head) return;

    const pc =
      pcState && typeof pcState === "object"
        ? pcState
        : { online: !!pcState };
    lastPcAgentState = pc;
    pcAgentOnline = !!pc.online;
    updateUrlImportHint();

    let chip = document.getElementById("pc-agent-chip");
    if (!chip) {
      chip = document.createElement("span");
      chip.id = "pc-agent-chip";
      chip.style.cssText =
        "font:600 0.65rem Orbitron,sans-serif;letter-spacing:0.06em;padding:4px 8px;border-radius:999px;border:1px solid rgba(0,240,255,0.35);margin-right:8px;cursor:default;";
      head.prepend(chip);
    }
    const btn = document.getElementById("btn-pc-setup");
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", async () => {
        await downloadPcAgentSetup();
      });
    }

    const pcOnline = !!pc.online;
    if (pcOnline) {
      chip.textContent = tr("pc.chipOn", "PC · ON");
      chip.style.color = "#00ff9d";
      chip.style.borderColor = "rgba(0,255,157,0.5)";
      chip.title =
        tr(
          "pc.tipOn",
          "Twój PC połączony — joby liczone u Ciebie, strona zostaje w chmurze"
        ) + (pc.label ? " (" + pc.label + ")" : "");
      if (btn) btn.style.opacity = "0.55";
    } else if (pc.needLogin && pc.anyOnline) {
      chip.textContent = tr("pc.chipNeedLogin", "PC · ?");
      chip.style.color = "#ffcc66";
      chip.style.borderColor = "rgba(255,200,80,0.5)";
      chip.title = tr(
        "pc.tipNeedLogin",
        "Agent działa, ale nie jesteś zalogowany w przeglądarce — zaloguj się tym samym kontem"
      );
      if (btn) btn.style.opacity = "1";
    } else if (pc.otherAccount) {
      chip.textContent = tr("pc.chipOther", "PC · INNE");
      chip.style.color = "#ffcc66";
      chip.style.borderColor = "rgba(255,200,80,0.5)";
      chip.title = tr(
        "pc.tipOther",
        "Agent online jest pod innym kontem. Zaloguj się na to samo konto co przy ⬇ PC, albo pobierz agenta ponownie."
      );
      if (btn) btn.style.opacity = "1";
    } else {
      chip.textContent = tr("pc.chipOff", "PC · OFF");
      chip.style.color = "#7eb8c9";
      chip.style.borderColor = "rgba(0,240,255,0.25)";
      chip.title = tr(
        "pc.tipOff",
        "Agent offline. Kliknij ⬇ PC, uruchom RUN-AGENT.bat i zostań zalogowany w przeglądarce."
      );
      if (btn) btn.style.opacity = "1";
    }

    // Soft auto-offer once per browser session when offline
    try {
      if (
        !pcOnline &&
        !sessionStorage.getItem("clipforge_pc_setup_offered") &&
        !sessionStorage.getItem("clipforge_pc_banner")
      ) {
        sessionStorage.setItem("clipforge_pc_banner", "1");
        const bar = document.createElement("div");
        bar.id = "pc-setup-banner";
        bar.style.cssText =
          "margin:0 0 12px;padding:10px 12px;border:1px solid rgba(0,240,255,0.35);background:rgba(0,40,60,0.5);font:0.85rem Exo 2,sans-serif;color:#e0f7ff;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;";
        bar.innerHTML =
          "<span>" +
          tr(
            "pc.bannerHtml",
            "<strong>Twój PC</strong> — żeby każdy liczył u siebie (bez kolejki w chmurze), pobierz raz gotowy agent. Strona zostaje tutaj."
          ) +
          "</span>";
        const go = document.createElement("button");
        go.type = "button";
        go.textContent = tr("pc.bannerBtn", "Pobierz agent PC");
        go.className = "btn-go";
        go.style.cssText =
          "width:auto;margin:0;padding:8px 14px;font-size:0.7rem;";
        go.addEventListener("click", () => {
          downloadPcAgentSetup();
          bar.remove();
        });
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.textContent = "Później";
        dismiss.style.cssText =
          "background:transparent;border:none;color:#7eb8c9;cursor:pointer;font:inherit;";
        dismiss.addEventListener("click", () => bar.remove());
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:8px;align-items:center;";
        actions.appendChild(go);
        actions.appendChild(dismiss);
        bar.appendChild(actions);
        const idle = document.getElementById("idle-state");
        const panel = document.querySelector(".panel-progress");
        if (idle && idle.parentNode) idle.parentNode.insertBefore(bar, idle);
        else if (panel) panel.insertBefore(bar, panel.firstChild);
      }
    } catch (_) {}
  }

  /** Busy = only MY job (multi-user: other people don't block Start) */
  async function isStudioBusy() {
    try {
      const res = await fetch("/api/studio/health?_=" + Date.now(), {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) return false;
      const data = await res.json();
      ensurePcAgentUi(data.pcAgent || { online: false });
      // Prefer myBusy (per-user). Fallback busy for older servers.
      if (typeof data.myBusy === "boolean") return data.myBusy;
      return !!data.busy;
    } catch {
      return !!(
        activeJobId &&
        lastRenderedJob &&
        (lastRenderedJob.status === "running" ||
          lastRenderedJob.status === "queued")
      );
    }
  }

  // Refresh PC-agent status periodically (faster so chip tracks 120s heartbeat window)
  setInterval(() => {
    isStudioBusy().catch(() => {});
  }, 4000);
  setTimeout(() => isStudioBusy().catch(() => {}), 400);

  function videoUrlInput() {
    return ($("#opt-video-url")?.value || "").trim();
  }

  function hasVideoSource() {
    return !!(selectedFile || videoUrlInput());
  }

  function updateStartEnabled() {
    if (btnStart) btnStart.disabled = !hasVideoSource();
  }

  $("#opt-video-url")?.addEventListener("input", () => {
    updateStartEnabled();
    const u = videoUrlInput();
    if (u && !selectedFile && fileLabel) {
      fileLabel.textContent = "Link: " + u.slice(0, 72) + (u.length > 72 ? "…" : "");
      dropzone?.classList.add("has-file");
    }
  });
  $("#btn-url-clear")?.addEventListener("click", () => {
    const inp = $("#opt-video-url");
    if (inp) inp.value = "";
    if (!selectedFile) {
      dropzone?.classList.remove("has-file");
      if (fileLabel) {
        fileLabel.textContent = tr(
          "drop.sub",
          "max ~500 MB · tymczasowa obróbka · wiele formatów → wynik MP4"
        );
      }
    }
    updateStartEnabled();
  });

  btnStart.addEventListener("click", async () => {
    const url = videoUrlInput();
    if (!selectedFile && !url) return;
    if (
      !(optNarratorOnly && optNarratorOnly.checked) &&
      optDelogo.checked &&
      delogoMode() === "manual" &&
      logoBoxes.length === 0
    ) {
      const go = confirm(
        tr(
          "confirm.delogo",
          "No logo area marked.\n\nOK = start anyway\nCancel = go back"
        )
      );
      if (!go) return;
      // force auto if no boxes
      document.querySelector('input[name="delogo-mode"][value="auto"]').checked = true;
      logoPicker.classList.add("hidden");
    }

    // If old job still running/queued — free the queue first
    if (await isStudioBusy()) {
      const go = window.confirm(
        tr(
          "confirm.busyStart",
          "Trwa inny proces. Anulować go i zacząć ten nowy?"
        )
      );
      if (!go) return;
      await resetToIdle({ confirm: false, clearFile: false });
    }

    btnStart.disabled = true;
    btnStart.textContent = selectedFile
      ? tr("btn.sending", "Wysyłanie…")
      : "Pobieram z linku…";
    try {
      let res;
      let data;
      if (selectedFile) {
        const fd = new FormData();
        fd.append("video", selectedFile);
        fd.append("options", JSON.stringify(collectOptions()));
        res = await fetch("/api/studio/jobs", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload nieudany");
      } else {
        const looksPlatform =
          /youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|vimeo\.com|twitter\.com|\bx\.com\b|reddit\.com|twitch\.tv/i.test(
            url
          );
        if (looksPlatform && !pcAgentOnline) {
          throw new Error(
            tr(
              "pc.needAgentErr",
              "Link z platformy (YouTube/TikTok/…) wymaga PC · ON.\n\n1) Odpal RUN-AGENT.bat / ⬇ PC\n2) Poczekaj na zielony chip PC · ON\n3) Start ponownie\n\nAlbo wklej bezpośredni plik .mp4."
            )
          );
        }
        btnStart.textContent = looksPlatform
          ? tr("pc.queueYtdlp", "Kolejka PC (yt-dlp)…")
          : tr("pc.fetchUrl", "Pobieram z linku…");
        res = await fetch("/api/studio/jobs/from-url", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            options: collectOptions(),
          }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || "Pobieranie z linku nieudane");
      }

      activeJobId = data.job.id;
      showJob(data.job);
      startPolling(activeJobId);
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      updateStartEnabled();
      btnStart.textContent = tr("btn.start", "Start obróbki");
    }
  });

  function showJob(job) {
    $("#idle-state").classList.add("hidden");
    $("#job-state").classList.remove("hidden");
    renderJob(job);
  }

  function renderJob(job) {
    lastRenderedJob = job;
    $("#job-name").textContent = job.originalName || job.id;
    $("#job-meta").textContent = `${statusPl(job.status)} · id ${job.id}`;
    if (job.autoPolish) applyAutoPolishPreview(job.autoPolish);
    const pct = Math.round(job.progress || 0);
    $("#job-pct").textContent = pct + "%";
    $("#bar-fill").style.width = pct + "%";
    const bar = document.querySelector(".bar");
    if (bar) bar.setAttribute("aria-valuenow", String(pct));
    let stageTxt = translateStageLabel(job.stage || "—");
    // Strip Polish freeze suffix then re-append translated
    stageTxt = stageTxt
      .replace(/\s*·\s*nadal pracuje…[^·]*/i, "")
      .replace(/\s*·\s*still working…[^·]*/i, "");
    if (job.status === "running" && job.updatedAt) {
      const age = Math.round((Date.now() - new Date(job.updatedAt).getTime()) / 1000);
      if (age >= 0 && age < 3600)
        stageTxt += " · " + tr("ago", "upd. {n}s ago").replace("{n}", String(age));
    }
    if (
      job.status === "running" &&
      /nadal pracuje|still working/i.test(String(job.stage || ""))
    ) {
      stageTxt += tr("live.msg.working", " · still working…");
    }
    $("#job-stage").textContent = stageTxt;

    // Live translation panel — always refresh both boxes with i18n
    const lo = $("#live-original");
    const ls = $("#live-script");
    const lp = $("#live-phase");
    if (lo) {
      const srcText =
        job.liveOriginal ||
        job.result?.language?.original ||
        (job.status === "queued" ? tr("live.msg.queued", "— queued —") : null) ||
        (job.status === "running" && !job.liveOriginal
          ? tr("live.msg.hdWait", "… HD video processing — transcription after picture …")
          : null);
      lo.textContent = translateLiveBoxText(srcText, "live.wait");
      // Lock when real transcript is showing so apply() won't wipe it
      if (job.liveOriginal || job.result?.language?.original) {
        lo.setAttribute("data-i18n-lock", "1");
      } else {
        lo.removeAttribute("data-i18n-lock");
      }
    }
    if (ls) {
      const live =
        job.liveScript ||
        job.result?.script ||
        (job.status === "queued" ? tr("live.msg.queued", "— queued —") : null) ||
        (job.status === "running" && !job.liveScript
          ? tr("live.wait2", "— waiting for extract & translate… —")
          : null);
      ls.textContent = translateLiveBoxText(live, "live.wait2");
      if (job.liveScript || job.result?.script) {
        ls.setAttribute("data-i18n-lock", "1");
      } else {
        ls.removeAttribute("data-i18n-lock");
      }
    }
    if (lp) {
      const phase = job.livePhase;
      lp.textContent =
        phase === "extracting"
          ? tr("live.phase.stt", "… extracting (STT)")
          : phase === "translating"
            ? tr("live.phase.tr", "… live translation")
            : phase === "done"
              ? tr("live.phase.voice", "… generating voice")
              : phase === "source"
                ? tr("live.phase.src", "… start translation")
                : phase === "same-lang"
                  ? tr("live.phase.same", "same language — no NMT")
                  : job.status === "running"
                    ? tr("status.running", "running")
                    : "";
    }

    const list = $("#stages-list");
    list.innerHTML = "";
    (job.stages || []).forEach((s) => {
      const li = document.createElement("li");
      li.className = s.status || "pending";
      // Prefer server label (covers STT vs describe modes), then stage id
      const idKey = {
        probe: "stage.probe",
        delogo: "stage.delogo",
        extract: "stage.extract",
        ai: "stage.ai",
        assemble: "stage.assemble",
        fast: "stage.fast",
        encode: "stage.encode",
        stt: "stage.stt",
        translate: "stage.translate",
        narrator: "stage.narrator",
        subs: "stage.subs",
        mix: "stage.mix",
      }[s.id];
      let label = s.label
        ? translateStageLabel(s.label)
        : idKey
          ? tr(idKey, s.id)
          : s.id || "—";
      // If label was unknown Polish and unchanged, try id
      if (s.label && label === s.label && idKey) {
        label = tr(idKey, s.label);
      }
      li.innerHTML = `<span class="dot"></span><span>${escapeHtml(label)}</span>`;
      list.appendChild(li);
    });

    const logs = $("#job-logs");
    logs.innerHTML = (job.logs || [])
      .slice(-14)
      .map((l) => escapeHtml(l.msg))
      .join("<br>");

    const errBox = $("#error-box");
    const resBox = $("#result-box");

    const retryBtn = $("#btn-retry");
    const cancelBtn = $("#btn-cancel");
    const newProcBtn = $("#btn-new-process");
    const isActive = job.status === "running" || job.status === "queued";
    const isTerminal =
      job.status === "done" ||
      job.status === "failed" ||
      job.status === "cancelled";
    if (cancelBtn) {
      cancelBtn.classList.toggle("hidden", !isActive);
      cancelBtn.disabled = !isActive;
      cancelBtn.dataset.jobId = job.id || "";
    }
    if (newProcBtn) {
      // After finish/fail — big CTA to free UI; also available while running via header
      newProcBtn.classList.toggle("hidden", !isTerminal && !isActive);
      newProcBtn.dataset.jobId = job.id || "";
    }

    if (job.status === "failed") {
      errBox.classList.remove("hidden");
      const msg = job.error || tr("job.unknownErr", "Unknown error");
      const cancelled = /Anulowane|cancelled/i.test(msg);
      const interrupted = /przerwane|restart|interrupt/i.test(msg);
      errBox.innerHTML = cancelled
        ? escapeHtml(
            tr("reset.done", "Gotowe — możesz wrzucić film i zacząć od nowa.")
          )
        : interrupted
          ? escapeHtml(tr("job.interrupted", "Job interrupted — retry Fast HD."))
          : escapeHtml(msg);
      resBox.classList.add("hidden");
      if (retryBtn) {
        if (!cancelled && job.canRetry !== false) {
          retryBtn.classList.remove("hidden");
          retryBtn.disabled = false;
          retryBtn.dataset.jobId = job.id;
          retryBtn.textContent = interrupted
            ? tr("btn.retryHd", "▶ Run again (Fast HD)")
            : tr("btn.retry", "▶ Run again");
          // No auto-retry — it re-started heavy jobs and looked like a freeze
        } else {
          retryBtn.classList.add("hidden");
        }
      }
    } else {
      errBox.classList.add("hidden");
      if (retryBtn) retryBtn.classList.add("hidden");
    }

    if (job.status === "done" && job.downloadUrl) {
      resBox.classList.remove("hidden");
      // Scroll result panel (under col 2+3) into view once
      try {
        if (!resBox.dataset.scrolledFor || resBox.dataset.scrolledFor !== job.id) {
          resBox.dataset.scrolledFor = job.id;
          setTimeout(() => {
            resBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 120);
        }
      } catch (_) {}
      lastDoneJob = job;
      const r = job.result || {};
      const lang = r.language;
      $("#result-info").textContent = [
        job.localDisk || r.localDisk
          ? tr("result.localDisk", "💾 dysk PC (bez limitu 500 MB chmury)")
          : null,
        r.width && r.height ? `${r.width}×${r.height}` : null,
        r.mb != null ? `${r.mb} MB` : null,
        r.duration ? `${Number(r.duration).toFixed(1)}s` : null,
        r.hasNarrator ? tr("result.tagNarrator", "lektor") : null,
        r.hasSubtitles ? tr("result.tagSubs", "napisy") : null,
        lang?.modeLabel || null,
        lang?.sourceLang
          ? `źródło: ${lang.sourceLang.label}`
          : lang?.detected
            ? `język: ${lang.detected.label}`
            : null,
        lang?.targetLang
          ? `cel: ${lang.targetLang.label || lang.targetLang.code}`
          : r.targetLang
            ? `cel: ${r.targetLang}`
            : null,
        lang?.model?.name || lang?.model?.id || null,
        lang?.translated ? "przetłumaczono" : null,
        job.userCopyPath || r.userCopyPath
          ? "Videos\\ClipForge"
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const dl = $("#btn-download");
      dl.href = job.downloadUrl;
      dl.download =
        (job.originalName || "clip").replace(/\.[^.]+$/, "") + "_studio.mp4";

      const audioBtn = $("#btn-audio");
      if (audioBtn) {
        if (job.audioUrl) {
          audioBtn.classList.remove("hidden");
          audioBtn.hidden = false;
          audioBtn.href = job.audioUrl;
          audioBtn.download =
            (job.originalName || "clip").replace(/\.[^.]+$/, "") + "_audio.mp3";
          audioBtn.title = tr(
            "result.audioHint",
            "Pobierz sam dźwięk z wyniku (mp3)"
          );
        } else {
          audioBtn.classList.add("hidden");
          audioBtn.hidden = true;
          audioBtn.removeAttribute("href");
        }
      }

      const open = $("#btn-open");
      open.href = job.downloadUrl;

      // Codec export panel (H.264 High / HEVC / AAC) for app uploads
      wireResultExport(job);

      // Before / after embedded players
      fillComparePlayers(job, r);

      const prev = $("#result-preview");
      if (prev) {
        if (job.previewUrl) {
          prev.src = job.previewUrl + "?t=" + Date.now();
        } else {
          prev.removeAttribute("src");
        }
      }

      // Prefer timed transcription (with clocks); fall back to plain script
      const timedTgt =
        r.timedScript ||
        lang?.timedScript ||
        (r.script && String(r.script).includes("[") ? r.script : null);
      const timedSrc =
        r.timedOriginal ||
        lang?.timedOriginal ||
        null;
      let scriptTxt =
        timedTgt ||
        r.scriptPlain ||
        r.script ||
        "(brak tekstu lektora)";
      if (timedSrc || (lang?.original && lang.translated)) {
        const tgt = lang?.targetLang?.label || "docelowy";
        const srcBlock =
          timedSrc ||
          (lang?.original
            ? String(lang.original)
            : "");
        if (srcBlock) {
          scriptTxt =
            "— oryginał (z czasem) —\n" +
            srcBlock +
            "\n\n— " +
            tgt +
            " (z czasem) —\n" +
            (timedTgt || r.scriptPlain || r.script || "");
        }
      }
      $("#result-script").textContent = scriptTxt;

      // SRT download
      const srtBtn = $("#share-srt");
      if (srtBtn) {
        if (job.srtUrl) {
          srtBtn.hidden = false;
          srtBtn.href = job.srtUrl;
          srtBtn.download =
            (job.originalName || "clip").replace(/\.[^.]+$/, "") + ".srt";
        } else {
          srtBtn.hidden = true;
        }
      }
      setShareStatus("", "");
    } else if (job.status !== "done") {
      resBox.classList.add("hidden");
      lastDoneJob = null;
      clearCompareVideos();
    }
  }

  function clearCompareVideos() {
    ["result-video-orig", "result-video-out"].forEach((id) => {
      const v = document.getElementById(id);
      if (!v) return;
      try {
        v.pause();
      } catch (_) {}
      v.removeAttribute("src");
      v.load();
    });
    const om = $("#result-orig-meta");
    const rm = $("#result-out-meta");
    if (om) om.textContent = "—";
    if (rm) rm.textContent = "—";
  }

  /**
   * Result panel: re-encode download with best app codecs (H.264 High / HEVC / AAC).
   */
  function wireResultExport(job) {
    const box = $("#result-export");
    const status = $("#export-status");
    if (!box || !job || !job.id) return;
    box.dataset.jobId = job.id;
    const setEx = (msg, kind) => {
      if (!status) return;
      status.textContent = msg || "";
      status.classList.remove("is-busy", "is-ok", "is-err");
      if (kind) status.classList.add("is-" + kind);
    };
    setEx("", null);

    // Disable HEVC button if server reports no encoder (best-effort probe)
    fetch("/api/studio/export-profiles", { credentials: "same-origin" })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        const hevc = (data.profiles || []).find((p) => p.id === "hevc");
        const btn = $("#btn-export-hevc");
        if (btn && hevc && hevc.available === false) {
          btn.disabled = true;
          btn.title = hevc.reason || "HEVC niedostępne";
        } else if (btn) {
          btn.disabled = false;
          btn.title = "";
        }
      })
      .catch(() => {});

    if (box.dataset.exportWired === "1") return;
    box.dataset.exportWired = "1";

    box.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("[data-export]");
      if (!btn || btn.disabled) return;
      const profile = btn.getAttribute("data-export") || "app";
      const jid = box.dataset.jobId || (lastDoneJob && lastDoneJob.id);
      if (!jid) {
        setEx(
          tr("result.exportNoJob", "Brak gotowego joba do eksportu."),
          "err"
        );
        return;
      }
      const labels = {
        app: tr("result.exportApp", "App / Social (H.264 + AAC)"),
        hq: tr("result.exportHq", "Max jakość H.264"),
        hevc: tr("result.exportHevc", "HEVC H.265"),
        audio: tr("result.exportAudio", "Dźwięk AAC 320k"),
      };
      setEx(
        tr("result.exportBusy", "Koduję: {name}… (może potrwać)")
          .replace("{name}", labels[profile] || profile),
        "busy"
      );
      const allBtns = box.querySelectorAll("[data-export]");
      allBtns.forEach((b) => {
        b.disabled = true;
      });
      try {
        const url =
          "/api/studio/jobs/" +
          encodeURIComponent(jid) +
          "/export?profile=" +
          encodeURIComponent(profile) +
          "&_=" +
          Date.now();
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) {
          let errMsg = "HTTP " + res.status;
          try {
            const j = await res.json();
            if (j && j.error) errMsg = j.error;
          } catch (_) {
            /* ignore */
          }
          throw new Error(errMsg);
        }
        const blob = await res.blob();
        if (!blob || blob.size < 200) {
          throw new Error(
            tr("result.exportEmpty", "Pusty plik eksportu — spróbuj ponownie.")
          );
        }
        let filename =
          (job.originalName || lastDoneJob?.originalName || "clip")
            .replace(/\.[^.]+$/, "") +
          "_clipforge_" +
          profile;
        const cd = res.headers.get("Content-Disposition") || "";
        const m = cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
        if (m && m[1]) {
          try {
            filename = decodeURIComponent(m[1].replace(/"/g, "").trim());
          } catch (_) {
            filename = m[1].replace(/"/g, "").trim();
          }
        } else {
          const ext =
            profile === "audio"
              ? ".m4a"
              : blob.type && blob.type.includes("audio")
                ? ".m4a"
                : ".mp4";
          if (!/\.(mp4|m4a|mov)$/i.test(filename)) filename += ext;
        }
        const a = document.createElement("a");
        const obj = URL.createObjectURL(blob);
        a.href = obj;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(obj), 4000);
        setEx(
          tr("result.exportOk", "Zapisano: {name}")
            .replace("{name}", filename) +
            " · " +
            (Math.round((blob.size / (1024 * 1024)) * 10) / 10) +
            " MB",
          "ok"
        );
      } catch (e) {
        setEx(
          tr("result.exportFail", "Eksport: ") + (e.message || e),
          "err"
        );
      } finally {
        allBtns.forEach((b) => {
          // re-enable; HEVC may be re-disabled by probe on next wire
          b.disabled = false;
        });
        // re-run probe for hevc
        fetch("/api/studio/export-profiles", { credentials: "same-origin" })
          .then((r) => r.json().catch(() => ({})))
          .then((data) => {
            const hevc = (data.profiles || []).find((p) => p.id === "hevc");
            const hb = $("#btn-export-hevc");
            if (hb && hevc && hevc.available === false) hb.disabled = true;
          })
          .catch(() => {});
      }
    });
  }

  function fillComparePlayers(job, result) {
    const vOrig = $("#result-video-orig");
    const vOut = $("#result-video-out");
    const metaOrig = $("#result-orig-meta");
    const metaOut = $("#result-out-meta");
    if (!vOrig || !vOut) return;

    // Prefer server original (survives refresh), else blob of selected file
    const origSrc =
      job.originalUrl ||
      selectedFileObjectUrl ||
      null;
    const outSrc = job.downloadUrl
      ? job.downloadUrl + (job.downloadUrl.includes("?") ? "&" : "?") + "t=" + Date.now()
      : null;

    if (origSrc && vOrig.dataset.src !== String(origSrc)) {
      vOrig.dataset.src = String(origSrc);
      vOrig.src = origSrc;
    } else if (!origSrc) {
      vOrig.removeAttribute("src");
      vOrig.removeAttribute("data-src");
      vOrig.load();
    }

    if (outSrc && vOut.dataset.src !== String(outSrc).split("?")[0]) {
      vOut.dataset.src = String(outSrc).split("?")[0];
      vOut.src = outSrc;
    }

    if (metaOrig) {
      if (origSrc) {
        metaOrig.textContent = [
          job.originalName || "oryginał",
          selectedFile
            ? (selectedFile.size / 1e6).toFixed(1) + " MB"
            : job.options?.sourcePlatform || null,
        ]
          .filter(Boolean)
          .join(" · ");
      } else if (
        job.options?.sourceKind === "platform" ||
        /youtube|tiktok|instagram/i.test(job.options?.sourceUrl || "")
      ) {
        metaOrig.textContent = tr(
          "result.origPlatformWait",
          "Oryginał z YouTube/platformy — pojawi się po zakończeniu joba (agent wyśle plik źródłowy). Odśwież wynik / poczekaj na 100%."
        );
      } else {
        metaOrig.textContent = tr(
          "result.origMissing",
          "Brak podglądu oryginału (brak pliku źródłowego na serwerze)"
        );
      }
    }
    if (metaOut) {
      const r = result || {};
      metaOut.textContent = [
        r.width && r.height ? `${r.width}×${r.height}` : null,
        r.mb != null ? `${r.mb} MB` : null,
        r.duration ? `${Number(r.duration).toFixed(1)} s` : null,
        tr("result.outLabel", "wynik"),
      ]
        .filter(Boolean)
        .join(" · ");
    }

    // One-time metadata listeners for nicer labels
    const tagDim = (video, el, prefix) => {
      if (!video || !el) return;
      const apply = () => {
        if (!video.videoWidth) return;
        const base = el.textContent || "";
        if (base.includes("×")) return;
        el.textContent =
          (prefix ? prefix + " · " : "") +
          `${video.videoWidth}×${video.videoHeight}` +
          (video.duration && isFinite(video.duration)
            ? ` · ${video.duration.toFixed(1)} s`
            : "");
      };
      video.addEventListener("loadedmetadata", apply, { once: true });
    };
    tagDim(
      vOrig,
      metaOrig,
      job.originalName || tr("compare.original", "Oryginał")
    );
    tagDim(vOut, metaOut, tr("result.outLabel", "wynik"));
  }

  // Compare players: play both / pause / optional seek sync
  (function wireCompareSync() {
    const vOrig = () => $("#result-video-orig");
    const vOut = () => $("#result-video-out");
    const syncOn = () => $("#opt-sync-seek")?.checked;

    $("#btn-sync-play")?.addEventListener("click", () => {
      const a = vOrig();
      const b = vOut();
      try {
        if (a) {
          a.currentTime = 0;
          a.play().catch(() => {});
        }
        if (b) {
          b.currentTime = 0;
          b.play().catch(() => {});
        }
      } catch (_) {}
    });
    $("#btn-sync-pause")?.addEventListener("click", () => {
      try {
        vOrig()?.pause();
        vOut()?.pause();
      } catch (_) {}
    });

    const bindSeek = (src, dst) => {
      if (!src || !dst || src.dataset.syncBound) return;
      src.dataset.syncBound = "1";
      src.addEventListener("seeked", () => {
        if (!syncOn() || syncSeekLock) return;
        syncSeekLock = true;
        try {
          if (Math.abs((dst.currentTime || 0) - src.currentTime) > 0.12) {
            dst.currentTime = src.currentTime;
          }
        } catch (_) {}
        setTimeout(() => {
          syncSeekLock = false;
        }, 80);
      });
      src.addEventListener("play", () => {
        if (!syncOn()) return;
        try {
          if (dst.paused) dst.play().catch(() => {});
        } catch (_) {}
      });
      src.addEventListener("pause", () => {
        if (!syncOn()) return;
        try {
          if (!dst.paused) dst.pause();
        } catch (_) {}
      });
    };
    // Bind when players exist (DOM ready)
    bindSeek(vOrig(), vOut());
    bindSeek(vOut(), vOrig());
  })();

  function setShareStatus(msg, kind) {
    const el = $("#share-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "share-status" + (kind ? " " + kind : "");
  }

  async function copyText(text) {
    if (!text) throw new Error(tr("err.noContent", "No content"));
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  async function handleShare(action) {
    const job = lastDoneJob;
    if (!job || !job.id) {
      setShareStatus(tr("share.needDone", "Finish processing first."), "err");
      return;
    }
    setShareStatus("…", "");
    try {
      if (action === "folder") {
        const res = await fetch(`/api/studio/jobs/${job.id}/reveal`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || tr("share.errGeneric", "Błąd"));
        setShareStatus(
          tr("share.folderOk", "Otwarto folder z zaznaczonym plikiem."),
          "ok"
        );
        return;
      }
      if (action === "native") {
        const res = await fetch(`/api/studio/jobs/${job.id}/open-native`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || tr("share.errGeneric", "Błąd"));
        setShareStatus(tr("share.playOk", "Opened Windows player."), "ok");
        return;
      }
      if (action === "windows") {
        const res = await fetch(`/api/studio/jobs/${job.id}/share-windows`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || tr("share.errGeneric", "Błąd"));
        setShareStatus(
          data.message ||
            tr("share.windowsOk", "Folder otwarty · ścieżka w schowku."),
          "ok"
        );
        return;
      }
      if (action === "copy-path") {
        const path =
          job.absolutePath ||
          (
            await (await fetch(`/api/studio/jobs/${job.id}/share`)).json()
          )?.share?.path;
        await copyText(path);
        setShareStatus(tr("share.pathOk", "Path copied."), "ok");
        return;
      }
      if (action === "copy-url") {
        const url = location.origin + job.downloadUrl;
        await copyText(url);
        setShareStatus(
          tr("share.urlOk", "Skopiowano link: {url}").replace("{url}", url),
          "ok"
        );
        return;
      }
      if (action === "copy-script") {
        const script = job.result?.script || $("#result-script")?.textContent || "";
        await copyText(script);
        setShareStatus(
          tr("share.copiedScript", "Skopiowano tekst lektora."),
          "ok"
        );
        return;
      }
      if (action === "copy-pack") {
        const shareRes = await fetch(`/api/studio/jobs/${job.id}/share`);
        const data = await shareRes.json();
        if (!shareRes.ok) throw new Error(data.error || tr("share.errGeneric", "Błąd"));
        const s = data.share;
        const pack = [
          s.title,
          "",
          s.text,
          "",
          tr("share.fileLabel", "Plik:") + " " + (s.path || ""),
          tr("share.linkLabel", "Link:") + " " + (s.url || ""),
        ]
          .filter((x) => x != null)
          .join("\n");
        await copyText(pack);
        setShareStatus(tr("share.packOk", "Package copied."), "ok");
        return;
      }
      if (action === "webshare") {
        const shareRes = await fetch(`/api/studio/jobs/${job.id}/share`);
        const data = await shareRes.json();
        if (!shareRes.ok) throw new Error(data.error || tr("share.errGeneric", "Błąd"));
        const s = data.share;
        if (navigator.share) {
          // Try file share if possible
          let files;
          try {
            const blob = await fetch(job.downloadUrl).then((r) => r.blob());
            const file = new File(
              [blob],
              (job.originalName || "clip").replace(/\.[^.]+$/, "") +
                "_studio.mp4",
              { type: blob.type || "video/mp4" }
            );
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              files = [file];
            }
          } catch {
            /* no file share */
          }
          await navigator.share(
            files
              ? { title: s.title, text: s.text, files }
              : { title: s.title, text: s.text, url: s.url }
          );
          setShareStatus(tr("share.webOk", "Shared via system."), "ok");
        } else {
          await copyText(s.text + "\n" + s.url);
          setShareStatus(
            tr("share.webFallback", "Web Share unavailable — copied to clipboard."),
            "ok"
          );
        }
        return;
      }
    } catch (err) {
      setShareStatus(err.message || String(err), "err");
    }
  }

  document.getElementById("share-actions")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-share]");
    if (!btn) return;
    e.preventDefault();
    handleShare(btn.getAttribute("data-share"));
  });

  function statusPl(s) {
    return (
      {
        queued: tr("status.queued", "w kolejce"),
        running: tr("status.running", "w toku"),
        done: tr("status.done", "gotowe"),
        failed: tr("status.failed", "błąd"),
        cancelled: tr("status.cancelled", "anulowane"),
      }[s] || s
    );
  }

  // Re-apply i18n after lang switch (labels + live boxes + stages)
  window.addEventListener("clipforge:lang", () => {
    try {
      if (window.ClipForgeI18n) window.ClipForgeI18n.apply();
      // PC agent hint + chip labels follow UI language
      updateUrlImportHint();
      ensurePcAgentUi(lastPcAgentState || { online: pcAgentOnline });
      setNarratorOnlyBadgeText();
      // Empty-state placeholders on live pre boxes
      document.querySelectorAll("[data-i18n-empty]").forEach((el) => {
        const key = el.getAttribute("data-i18n-empty");
        // Only reset if no live job content is showing
        if (!lastRenderedJob || lastRenderedJob.status === "done" || lastRenderedJob.status === "failed") {
          // still re-render job below if present
        }
        if (!lastRenderedJob) el.textContent = tr(key, el.textContent);
      });
      const btn = $("#btn-start");
      if (btn && !btn.disabled) btn.textContent = tr("btn.start", "Start");
      // Instant re-render from cache (live boxes + stages in new UI language)
      if (lastRenderedJob) {
        renderJob(lastRenderedJob);
      } else if (lastDoneJob) {
        renderJob(lastDoneJob);
      }
      // Fresh fetch if active
      if (activeJobId) {
        fetch("/api/studio/jobs/" + activeJobId + "?_=" + Date.now())
          .then((r) => r.json())
          .then((job) => {
            if (job && job.id) showJob(job);
          })
          .catch(() => {});
      }
    } catch (_) {}
  });

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  let lastProg = { p: -1, t: 0, stage: "" };

  function startPolling(id) {
    stopPolling();
    lastProg = { p: -1, t: Date.now(), stage: "" };
    // First fetch immediately
    (async () => {
      try {
        const res = await fetch("/api/studio/jobs/" + id + "?_=" + Date.now());
        if (res.ok) {
          const data = await res.json();
          renderJob(data.job);
        }
      } catch {
        /* ignore */
      }
    })();
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(
          "/api/studio/jobs/" + id + "?_=" + Date.now(),
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = await res.json();
        const job = data.job;
        // Detect freeze: same % for > 45s while running
        const now = Date.now();
        if (job.status === "running") {
          if (job.progress !== lastProg.p || job.stage !== lastProg.stage) {
            lastProg = { p: job.progress, t: now, stage: job.stage || "" };
          } else if (now - lastProg.t > 45000) {
            job.stage =
              (job.stage || tr("status.running", "running")) +
              tr("live.msg.working", " · still working… (normal for narrator/HD)");
          }
        }
        renderJob(job);
        if (job.status === "done" || job.status === "failed") {
          stopPolling();
        }
      } catch {
        /* network blip */
      }
    }, 600);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  $("#btn-retry")?.addEventListener("click", async (ev) => {
    const btn = $("#btn-retry");
    const jobId = btn?.dataset?.jobId || activeJobId;
    if (!jobId) return;
    const labelBefore = btn.textContent || "";
    btn.disabled = true;
    btn.textContent = tr("btn.retrying", "Restarting…");
    try {
      await fetch("/api/studio/queue/clear", { method: "POST" }).catch(
        () => null
      );
      // Safer AI retry by default (×2 + turbo). Shift-click or HD label = Szybki HD.
      const forceHd =
        !!(ev && ev.shiftKey) || /Szybki HD|Fast HD/i.test(labelBefore);
      const body = forceHd
        ? { forceFast: true, upscale: "fast", speedMode: "turbo" }
        : {
            forceFast: false,
            upscale: "ai",
            aiScale: 2,
            aiModel: "animevideov3",
            speedMode: "turbo",
            targetHeight: 1080,
          };
      const res = await fetch(`/api/studio/jobs/${jobId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tr("share.err", "Error"));
      activeJobId = data.job.id;
      showJob(data.job);
      startPolling(activeJobId);
      btn.textContent = tr("btn.retry", "▶ Run again");
    } catch (err) {
      alert(err.message || String(err));
      btn.disabled = false;
      btn.textContent = tr("btn.retry", "▶ Run again");
    }
  });

  // Header „Nowy” + bottom cancel / new process → full reset
  $("#btn-reset")?.addEventListener("click", () => {
    resetToIdle({ confirm: true, clearFile: false });
  });
  $("#btn-new-process")?.addEventListener("click", () => {
    resetToIdle({ confirm: true, clearFile: false });
  });
  $("#btn-cancel")?.addEventListener("click", async () => {
    const btn = $("#btn-cancel");
    const jobId = btn?.dataset?.jobId || activeJobId;
    if (!jobId) {
      await resetToIdle({ confirm: false, clearFile: false });
      return;
    }
    const ok = window.confirm(
      tr(
        "confirm.reset",
        "Anulować bieżący proces i wrócić do startu?\n\nStary job zostanie zatrzymany — możesz od razu zacząć nowy."
      )
    );
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = tr("btn.cancelling", "Anuluję…");
    try {
      await fetch(`/api/studio/jobs/${jobId}/cancel`, {
        method: "POST",
        cache: "no-store",
      }).catch(() => null);
      // Also clear any leftover queue
      await fetch("/api/studio/reset", { method: "POST" }).catch(() => null);
    } catch {
      /* ignore */
    }
    await resetToIdle({ confirm: false, clearFile: false });
  });

  // Voice catalog + restore job after refresh
  (async () => {
    try {
      await loadVoiceCatalog();
    } catch {
      rebuildVoiceSelect();
    }
    $("#opt-voice")?.addEventListener("change", () => {
      try {
        localStorage.setItem("clipforge.voice", $("#opt-voice").value || "");
      } catch (_) {}
    });
    try {
      const res = await fetch("/api/studio/jobs/latest/active");
      if (!res.ok) return;
      const data = await res.json();
      if (data.job) {
        activeJobId = data.job.id;
        showJob(data.job);
        if (data.job.status === "running" || data.job.status === "queued") {
          startPolling(data.job.id);
        }
      }
    } catch {
      /* ignore */
    }
  })();

  // --- PWA / install as app ---
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  let deferredInstall = null;
  const installBtn = $("#btn-install-app");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (installBtn) {
      installBtn.classList.remove("hidden");
      installBtn.textContent = "⬇ Zainstaluj aplikację";
    }
  });

  // Always show button — with fallback instructions
  if (installBtn) {
    installBtn.classList.remove("hidden");
    installBtn.addEventListener("click", async () => {
      if (deferredInstall) {
        deferredInstall.prompt();
        const choice = await deferredInstall.userChoice;
        if (choice.outcome === "accepted") {
          installBtn.textContent = "✓ Zainstalowano";
        }
        deferredInstall = null;
        return;
      }
      // Fallback: Windows app-mode instructions
      const tip =
        "Jak uruchomić jako aplikację Windows:\n\n" +
        "1) Skrót na pulpicie:  „ClipForge App”\n" +
        "   (okno bez paska przeglądarki)\n\n" +
        "2) Albo w Edge/Chrome:\n" +
        "   ⋮ menu → Aplikacje → Zainstaluj tę witrynę jako aplikację\n\n" +
        "3) Adres serwera musi być: http://127.0.0.1:3847/studio.html\n" +
        "   (nie https)";
      alert(tip);
    });
  }

  window.addEventListener("appinstalled", () => {
    if (installBtn) installBtn.textContent = "✓ Aplikacja";
  });
})();
