/**
 * ClipForge AdSense — Auto ads + manual display units.
 * Client: ca-pub-4395681148586201
 *
 * Manual slots (optional): set window.CLIPFORGE_ADS_SLOTS = { banner: "123..." }
 * or data-ad-slot on each .cf-ad element.
 * Create units: AdSense → Ads → By ad unit → Display ads.
 */
(function () {
  const CLIENT = "ca-pub-4395681148586201";
  const slots =
    (typeof window !== "undefined" && window.CLIPFORGE_ADS_SLOTS) || {};

  function ensureScript(cb) {
    if (window.adsbygoogle && window.adsbygoogle.loaded) {
      cb();
      return;
    }
    const existing = document.querySelector(
      'script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]'
    );
    if (existing) {
      existing.addEventListener("load", cb);
      // already loaded?
      if (window.adsbygoogle) setTimeout(cb, 50);
      return;
    }
    const s = document.createElement("script");
    s.async = true;
    s.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" +
      encodeURIComponent(CLIENT);
    s.crossOrigin = "anonymous";
    s.onload = cb;
    s.onerror = function () {
      markFailed("Skrypt AdSense zablokowany (adblock / sieć).");
    };
    document.head.appendChild(s);
  }

  function markFailed(msg) {
    document.querySelectorAll(".cf-ad").forEach(function (box) {
      if (box.getAttribute("data-cf-ad-status") === "ok") return;
      box.setAttribute("data-cf-ad-status", "fail");
      const hint = box.querySelector(".cf-ad-hint");
      if (hint) hint.textContent = msg;
    });
  }

  function enableAutoAds() {
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      // Page-level / Auto ads (needs Auto ads ON in AdSense dashboard)
      window.adsbygoogle.push({
        google_ad_client: CLIENT,
        enable_page_level_ads: true,
        tag_partner: "clipforge",
      });
    } catch (e) {
      /* ignore duplicate push */
    }
  }

  function fillUnit(box) {
    if (!box || box.getAttribute("data-cf-ad-filled") === "1") return;
    const role = box.getAttribute("data-cf-ad") || "banner";
    const slot =
      box.getAttribute("data-ad-slot") ||
      slots[role] ||
      slots.banner ||
      "";

    // Clear placeholder chrome but keep label
    let ins = box.querySelector("ins.adsbygoogle");
    if (!ins) {
      ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      box.appendChild(ins);
    }
    ins.style.display = "block";
    ins.style.minHeight = box.getAttribute("data-min-h") || "100px";
    ins.style.width = "100%";
    ins.setAttribute("data-ad-client", CLIENT);
    ins.setAttribute("data-ad-format", box.getAttribute("data-ad-format") || "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    if (slot) {
      ins.setAttribute("data-ad-slot", String(slot));
    }

    box.setAttribute("data-cf-ad-filled", "1");
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      box.setAttribute("data-cf-ad-status", "ok");
      const hint = box.querySelector(".cf-ad-hint");
      if (hint) {
        // hide soft placeholder after a while if ad paints
        setTimeout(function () {
          if (ins && ins.getAttribute("data-ad-status") === "unfilled") {
            box.setAttribute("data-cf-ad-status", "unfilled");
            hint.textContent = slot
              ? "Brak reklamy (unfilled) — mało ruchu / nowa witryna. Czekaj 24–48 h."
              : "Włącz Auto ads w AdSense LUB wklej data-ad-slot jednostki Display.";
            hint.hidden = false;
          } else {
            hint.hidden = true;
          }
        }, 3500);
      }
    } catch (e) {
      box.setAttribute("data-cf-ad-status", "fail");
      const hint = box.querySelector(".cf-ad-hint");
      if (hint) hint.textContent = "AdSense error: " + (e.message || e);
    }
  }

  function init() {
    ensureScript(function () {
      enableAutoAds();
      document.querySelectorAll(".cf-ad").forEach(fillUnit);
      // re-try late DOM
      setTimeout(function () {
        document.querySelectorAll(".cf-ad:not([data-cf-ad-filled='1'])").forEach(fillUnit);
      }, 1500);
    });

    // Adblock heuristic
    setTimeout(function () {
      const probe = document.createElement("div");
      probe.className = "adsbox adsbygoogle ad-placement";
      probe.style.cssText =
        "position:absolute;left:-9999px;width:1px;height:1px;pointer-events:none";
      document.body.appendChild(probe);
      setTimeout(function () {
        const blocked =
          !probe.offsetParent && probe.offsetHeight === 0
            ? false
            : probe.clientHeight === 0 &&
              getComputedStyle(probe).display === "none";
        // classic: element removed or zero size by blocker
        if (
          !document.body.contains(probe) ||
          probe.offsetHeight === 0 ||
          getComputedStyle(probe).display === "none" ||
          getComputedStyle(probe).visibility === "hidden"
        ) {
          // only warn if no adsbygoogle loaded
          if (!window.adsbygoogle || !window.adsbygoogle.loaded) {
            markFailed("Wygląda na adblock — wyłącz bloker reklam dla ClipForge.");
          }
        }
        try {
          probe.remove();
        } catch (_) {}
      }, 400);
    }, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
