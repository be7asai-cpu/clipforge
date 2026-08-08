/**
 * ClipForge AdSense — unit from publisher panel
 * client: ca-pub-4395681148586201
 * slot:   4962479768 (fluid / in-feed)
 */
(function () {
  const CLIENT = "ca-pub-4395681148586201";
  const SLOT = "4962479768";
  const LAYOUT_KEY = "-fb+5w+4e-db+86";
  const FORMAT = "fluid";

  function ensureScript(cb) {
    if (document.querySelector('script[src*="adsbygoogle.js"]')) {
      if (window.adsbygoogle) setTimeout(cb, 30);
      else {
        const s = document.querySelector('script[src*="adsbygoogle.js"]');
        s && s.addEventListener("load", cb);
        setTimeout(cb, 400);
      }
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
      markFail("Skrypt AdSense zablokowany (adblock / sieć).");
    };
    document.head.appendChild(s);
  }

  function markFail(msg) {
    document.querySelectorAll(".cf-ad").forEach(function (box) {
      box.setAttribute("data-cf-ad-status", "fail");
      const h = box.querySelector(".cf-ad-hint");
      if (h) {
        h.hidden = false;
        h.textContent = msg;
      }
    });
  }

  function fillBox(box) {
    if (!box || box.getAttribute("data-cf-ad-filled") === "1") return;

    let ins = box.querySelector("ins.adsbygoogle");
    if (!ins) {
      ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      box.appendChild(ins);
    }

    // Already pushed by another script?
    if (
      ins.getAttribute("data-adsbygoogle-status") ||
      ins.getAttribute("data-ad-status")
    ) {
      box.setAttribute("data-cf-ad-filled", "1");
      box.setAttribute("data-cf-ad-status", "ok");
      return;
    }

    // Fluid unit: Google requires variable-height container (no fixed height)
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.style.width = "100%";
    ins.style.height = "auto";
    ins.style.minHeight = "";
    ins.removeAttribute("data-min-h");
    ins.setAttribute("data-ad-format", FORMAT);
    ins.setAttribute("data-ad-layout-key", LAYOUT_KEY);
    ins.setAttribute("data-ad-client", CLIENT);
    ins.setAttribute("data-ad-slot", SLOT);

    box.setAttribute("data-cf-ad-filled", "1");
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      box.setAttribute("data-cf-ad-status", "ok");
      const hint = box.querySelector(".cf-ad-hint");
      if (hint) {
        setTimeout(function () {
          if (ins.getAttribute("data-ad-status") === "unfilled") {
            box.setAttribute("data-cf-ad-status", "unfilled");
            hint.hidden = false;
            hint.textContent =
              "Brak fillu reklam (nowa witryna / mało ruchu). Slot OK: " + SLOT;
          } else {
            hint.hidden = true;
          }
        }, 4000);
      }
    } catch (e) {
      box.setAttribute("data-cf-ad-status", "fail");
      const hint = box.querySelector(".cf-ad-hint");
      if (hint) {
        hint.hidden = false;
        hint.textContent = "AdSense: " + (e.message || e);
      }
    }
  }

  function init() {
    ensureScript(function () {
      document.querySelectorAll(".cf-ad").forEach(fillBox);
      setTimeout(function () {
        document
          .querySelectorAll(".cf-ad:not([data-cf-ad-filled='1'])")
          .forEach(fillBox);
      }, 1200);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
