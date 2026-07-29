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
  let activeJobId = null;
  let pollTimer = null;
  let lastDoneJob = null;
  let videoNatural = { w: 0, h: 0 };
  let frameBitmap = null;
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
  function applyNarratorOnlyUi(on) {
    if (panelFilmik) {
      panelFilmik.classList.toggle("panel-dimmed", !!on);
      panelFilmik.querySelectorAll("input, select, button, textarea").forEach((el) => {
        if (el.id === "file-input") return; // still allow picking a file
        el.disabled = !!on;
      });
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

  function polishMode() {
    return (
      document.querySelector('input[name="polish-mode"]:checked')?.value ||
      "auto"
    );
  }
  function syncPolishModeUi() {
    const on = $("#opt-polish")?.checked;
    const polishOpts = $("#polish-opts");
    const sliders = $("#quality-sliders");
    const hint = $("#polish-auto-hint");
    const preset = $("#opt-quality-preset");
    if (polishOpts) polishOpts.classList.toggle("hidden", !on);
    const auto = polishMode() === "auto";
    if (sliders) {
      sliders.classList.toggle("is-disabled", auto);
      sliders.querySelectorAll("input,select").forEach((el) => {
        el.disabled = auto;
      });
    }
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
    ["opt-sharpen", "opt-sharpen-val"],
    ["opt-contrast", "opt-contrast-val"],
    ["opt-sat", "opt-sat-val"],
    ["opt-denoise", "opt-denoise-val"],
  ].forEach(([id, vid]) => {
    const el = $("#" + id);
    const lab = $("#" + vid);
    if (el && lab) {
      el.addEventListener("input", () => {
        lab.textContent = el.value;
      });
    }
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
  $("#opt-source-lang")?.addEventListener("change", () => {
    refreshModeHint();
    refreshLangBadge();
  });
  $("#opt-target-lang")?.addEventListener("change", () => {
    refreshModeHint();
    refreshLangBadge();
  });
  $("#opt-title").addEventListener("input", refreshLangBadge);
  $("#opt-script").addEventListener("input", refreshLangBadge);
  refreshModeHint();
  refreshLangBadge();

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
    fileLabel.textContent = `${file.name} · ${(file.size / 1e6).toFixed(1)} MB`;
    dropzone.classList.add("has-file");
    btnStart.disabled = false;
    logoBoxes = [];
    loadVideoFrame(file);
  }

  function loadVideoFrame(file) {
    const url = URL.createObjectURL(file);
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
        URL.revokeObjectURL(url);
      }
    };

    video.addEventListener("loadeddata", () => {
      // seek a bit into video for better logo visibility
      const t = Math.min(1.5, (video.duration || 2) * 0.1);
      video.currentTime = t || 0.1;
    });
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", () => {
      URL.revokeObjectURL(url);
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
    setRange("#opt-sharpen", "#opt-sharpen-val", ap.sharpen);
    setRange("#opt-contrast", "#opt-contrast-val", ap.contrast);
    setRange("#opt-sat", "#opt-sat-val", ap.saturation);
    setRange("#opt-denoise", "#opt-denoise-val", ap.denoise);
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
        `: ${t("quality.contrast", "contrast")} ${ap.contrast}` +
        ` · ${t("quality.sat", "sat")} ${ap.saturation}` +
        ` · ${t("quality.sharpen", "sharp")} ${ap.sharpen}` +
        ` · ${t("quality.denoise", "denoise")} ${ap.denoise}` +
        (ap.brightness != null ? ` · B ${ap.brightness}` : "") +
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
      brightness: polishMode() === "auto" || narratorOnly ? null : 50,
      upscale: narratorOnly ? "off" : upscale,
      aiScale: Number($("#opt-ai-scale").value) || 2,
      targetHeight: Number($("#opt-height").value) || 1080,
      crf: Number($("#opt-crf").value) || 15,
      crfPreset: Number($("#opt-crf").value) <= 15 ? "slow" : "medium",
      narrator: narratorOnly ? true : optNarrator.checked,
      narratorMode: narratorMode(),
      sourceLang: $("#opt-source-lang")?.value || "auto",
      targetLang: targetLang(),
      autoTranslate: $("#opt-auto-translate").checked,
      narratorVoice: $("#opt-voice").value,
      title: $("#opt-title").value.trim(),
      narratorScript: $("#opt-script").value.trim(),
      bgVolume: Number(optBg.value) / 100,
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

  /** Busy = only MY job (multi-user: other people don't block Start) */
  async function isStudioBusy() {
    try {
      const res = await fetch("/api/studio/health?_=" + Date.now(), {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) return false;
      const data = await res.json();
      // Discreet PC-agent chip (processing on your machine, UI stays on cloud)
      try {
        let chip = document.getElementById("pc-agent-chip");
        if (!chip) {
          const head = document.querySelector(".panel-progress-head");
          if (head) {
            chip = document.createElement("span");
            chip.id = "pc-agent-chip";
            chip.style.cssText =
              "font:600 0.65rem Orbitron,sans-serif;letter-spacing:0.06em;padding:4px 8px;border-radius:999px;border:1px solid rgba(0,240,255,0.35);margin-right:8px;";
            head.querySelector(".panel-progress-actions")?.prepend(chip) ||
              head.appendChild(chip);
          }
        }
        if (chip) {
          if (data.pcAgent && data.pcAgent.online) {
            chip.textContent = "PC · ON";
            chip.style.color = "#00ff9d";
            chip.style.borderColor = "rgba(0,255,157,0.5)";
            chip.title =
              "Agent na Twoim PC połączony — joby liczone lokalnie (strona bez przekierowania)";
          } else {
            chip.textContent = "PC · OFF";
            chip.style.color = "#7eb8c9";
            chip.style.borderColor = "rgba(0,240,255,0.25)";
            chip.title =
              "Brak agenta PC — joby na serwerze w chmurze. Odpal start-pc-agent.bat";
          }
        }
      } catch (_) {}
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

  // Refresh PC-agent status periodically
  setInterval(() => {
    isStudioBusy().catch(() => {});
  }, 8000);
  setTimeout(() => isStudioBusy().catch(() => {}), 500);

  btnStart.addEventListener("click", async () => {
    if (!selectedFile) return;
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
    btnStart.textContent = tr("btn.sending", "Wysyłanie…");
    try {
      const fd = new FormData();
      fd.append("video", selectedFile);
      fd.append("options", JSON.stringify(collectOptions()));

      const res = await fetch("/api/studio/jobs", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload nieudany");

      activeJobId = data.job.id;
      showJob(data.job);
      startPolling(activeJobId);
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      btnStart.disabled = !selectedFile;
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
        r.width && r.height ? `${r.width}×${r.height}` : null,
        r.mb != null ? `${r.mb} MB` : null,
        r.duration ? `${Number(r.duration).toFixed(1)}s` : null,
        r.hasNarrator ? "lektor" : null,
        r.hasSubtitles ? "napisy" : null,
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
      ]
        .filter(Boolean)
        .join(" · ");

      const dl = $("#btn-download");
      dl.href = job.downloadUrl;
      dl.download =
        (job.originalName || "clip").replace(/\.[^.]+$/, "") + "_studio.mp4";

      const open = $("#btn-open");
      open.href = job.downloadUrl;

      const prev = $("#result-preview");
      if (job.previewUrl) {
        prev.src = job.previewUrl + "?t=" + Date.now();
        prev.style.display = "";
      } else {
        prev.removeAttribute("src");
        prev.style.display = "none";
      }

      let scriptTxt = r.script || "(brak tekstu lektora)";
      if (lang?.original && lang.translated) {
        const tgt = lang.targetLang?.label || "docelowy";
        scriptTxt =
          "— oryginał —\n" +
          lang.original +
          "\n\n— " +
          tgt +
          " —\n" +
          scriptTxt;
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
    }
  }

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
        if (!res.ok) throw new Error(data.error || "Błąd");
        setShareStatus("Otwarto folder z zaznaczonym plikiem.", "ok");
        return;
      }
      if (action === "native") {
        const res = await fetch(`/api/studio/jobs/${job.id}/open-native`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Błąd");
        setShareStatus(tr("share.playOk", "Opened Windows player."), "ok");
        return;
      }
      if (action === "windows") {
        const res = await fetch(`/api/studio/jobs/${job.id}/share-windows`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Błąd");
        setShareStatus(
          data.message || "Folder otwarty · ścieżka w schowku.",
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
        setShareStatus("Skopiowano link: " + url, "ok");
        return;
      }
      if (action === "copy-script") {
        const script = job.result?.script || $("#result-script")?.textContent || "";
        await copyText(script);
        setShareStatus("Skopiowano tekst lektora.", "ok");
        return;
      }
      if (action === "copy-pack") {
        const shareRes = await fetch(`/api/studio/jobs/${job.id}/share`);
        const data = await shareRes.json();
        if (!shareRes.ok) throw new Error(data.error || "Błąd");
        const s = data.share;
        const pack = [
          s.title,
          "",
          s.text,
          "",
          "Plik: " + (s.path || ""),
          "Link: " + (s.url || ""),
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
        if (!shareRes.ok) throw new Error(data.error || "Błąd");
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

  $("#btn-retry")?.addEventListener("click", async () => {
    const btn = $("#btn-retry");
    const jobId = btn?.dataset?.jobId || activeJobId;
    if (!jobId) return;
    btn.disabled = true;
    btn.textContent = tr("btn.retrying", "Restarting…");
    try {
      await fetch("/api/studio/queue/clear", { method: "POST" }).catch(
        () => null
      );
      // Force safe options: fast HD so it won't hang on AI after restart
      const res = await fetch(`/api/studio/jobs/${jobId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forceFast: true,
          upscale: "fast",
          speedMode: "turbo",
        }),
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
      btn.textContent = tr("btn.retryHd", "▶ Run again (Fast HD)");
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

  // After refresh: restore current job UI
  (async () => {
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
