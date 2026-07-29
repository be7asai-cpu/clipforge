/**
 * ClipForge — if local Studio is running, discreetly switch off the cloud host.
 * Cloud (Render) = shared queue. Localhost = your PC only.
 *
 * Skip: already local, ?cloud=1, localStorage clipforge_prefer_cloud=1
 */
(() => {
  const host = location.hostname;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "";

  if (isLocal) return;

  const params = new URLSearchParams(location.search);
  if (params.get("cloud") === "1" || params.get("cloud") === "true") {
    try {
      localStorage.setItem("clipforge_prefer_cloud", "1");
    } catch (_) {}
    return;
  }
  try {
    if (localStorage.getItem("clipforge_prefer_cloud") === "1") return;
  } catch (_) {}

  const LOCAL_ORIGINS = [
    "http://127.0.0.1:3847",
    "http://localhost:3847",
  ];

  const path = location.pathname + location.search + location.hash;
  // Keep user on same path (login / studio / …)
  const targetPath =
    !path || path === "/" ? "/login.html" : path;

  function toast(msg) {
    try {
      const el = document.createElement("div");
      el.setAttribute("role", "status");
      el.textContent = msg;
      el.style.cssText = [
        "position:fixed",
        "bottom:18px",
        "left:50%",
        "transform:translateX(-50%)",
        "z-index:99999",
        "padding:10px 18px",
        "border-radius:8px",
        "font:600 13px/1.3 system-ui,sans-serif",
        "color:#001018",
        "background:linear-gradient(135deg,#00e5ff,#00b8d4)",
        "box-shadow:0 8px 28px rgba(0,229,255,0.35)",
        "opacity:0",
        "transition:opacity .25s",
        "pointer-events:none",
      ].join(";");
      document.documentElement.appendChild(el);
      requestAnimationFrame(() => {
        el.style.opacity = "1";
      });
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
      }, 2200);
    } catch (_) {}
  }

  async function probe(origin) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = setTimeout(() => {
      try {
        ctrl && ctrl.abort();
      } catch (_) {}
    }, 1200);
    try {
      const res = await fetch(origin + "/api/health?localProbe=1", {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        signal: ctrl ? ctrl.signal : undefined,
      });
      clearTimeout(t);
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      return !!(data && data.ok && data.studio);
    } catch (_) {
      clearTimeout(t);
      return false;
    }
  }

  async function trySwitch() {
    for (const origin of LOCAL_ORIGINS) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await probe(origin);
      if (ok) {
        const dest = origin + targetPath;
        toast("Lokalny ClipForge — przełączam na Twój PC…");
        setTimeout(() => {
          location.replace(dest);
        }, 280);
        return true;
      }
    }
    return false;
  }

  // Run ASAP (don't wait for full page)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      trySwitch();
    });
  } else {
    trySwitch();
  }

  // Retry a few times — user may start local Studio a moment later
  let n = 0;
  const iv = setInterval(() => {
    n += 1;
    if (n > 8) {
      clearInterval(iv);
      return;
    }
    trySwitch().then((switched) => {
      if (switched) clearInterval(iv);
    });
  }, 4000);
})();
