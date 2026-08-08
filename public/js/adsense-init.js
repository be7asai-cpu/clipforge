/**
 * ClipForge AdSense — only pushes unfilled units (exact Google pattern).
 * Do NOT rewrite attributes after push — that breaks fill.
 * Slot 4962479768 · fluid · layout-key -fb+5w+4e-db+86
 */
(function () {
  function pushPending() {
    var nodes = document.querySelectorAll("ins.adsbygoogle");
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // already requested by AdSense
      if (el.getAttribute("data-adsbygoogle-status")) continue;
      if (el.getAttribute("data-cf-pushed") === "1") continue;
      el.setAttribute("data-cf-pushed", "1");
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        el.setAttribute("data-cf-pushed", "0");
        console.warn("[AdSense] push failed", e);
      }
    }
  }

  function run() {
    pushPending();
    // script async — retry after load
    setTimeout(pushPending, 500);
    setTimeout(pushPending, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  window.addEventListener("load", function () {
    setTimeout(pushPending, 300);
  });
})();
