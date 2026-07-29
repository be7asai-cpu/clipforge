/**
 * ClipForge Studio — auth header + full-screen login gate
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function showGateError(msg) {
    const el = $("#auth-gate-error");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  }

  function tr(key, fallback) {
    return (window.ClipForgeI18n && window.ClipForgeI18n.t(key)) || fallback || key;
  }

  function setGateMode(mode) {
    const isReg = mode === "register";
    const nameField = $("#gate-name-field");
    const submit = $("#gate-submit");
    const switchText = $("#gate-switch-text");
    const toggle = $("#gate-toggle");
    const title = $("#auth-gate h2");
    if (nameField) nameField.hidden = !isReg;
    if (submit)
      submit.textContent = isReg
        ? tr("login.register", "Register")
        : tr("login.submit", "Log in");
    if (switchText)
      switchText.textContent = isReg
        ? tr("login.haveAccount", "Already have an account?")
        : tr("login.noAccount", "No account?");
    if (toggle)
      toggle.textContent = isReg
        ? tr("gate.toggleLog", "Log in")
        : tr("gate.toggleReg", "Sign up");
    if (title)
      title.textContent = isReg
        ? tr("login.registerTitle", "Create account")
        : tr("login.gateTitle", "Log in to Studio");
    showGateError("");
    window.__clipforgeAuthMode = mode;
  }

  function showGate(show) {
    const gate = $("#auth-gate");
    if (!gate) return;
    gate.hidden = !show;
    document.body.classList.toggle("auth-locked", show);
  }

  function renderUser(user) {
    const box = $("#nav-user");
    if (!box) return;
    if (!user) {
      const loginLabel =
        (window.ClipForgeI18n && window.ClipForgeI18n.t("nav.login")) || "Zaloguj";
      box.innerHTML = `<a class="nav-login-link" id="nav-login-btn" href="/login.html?next=/studio.html">${loginLabel}</a>`;
      return;
    }
    const initial = (user.name || user.email || "?").charAt(0).toUpperCase();
    const avatar = user.avatar
      ? `<img src="${escapeAttr(user.avatar)}" alt="" />`
      : `<span class="avatar-fallback">${escapeHtml(initial)}</span>`;
    box.innerHTML = `
      <div class="nav-user-chip" title="${escapeAttr(user.email || user.name || "")}">
        ${avatar}
        <span>${escapeHtml(user.name || user.email || "User")}</span>
      </div>
      <button type="button" class="nav-logout" id="btn-logout">${
        (window.ClipForgeI18n && window.ClipForgeI18n.t("nav.logout")) || "Wyloguj"
      }</button>
    `;
    $("#btn-logout")?.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        /* ignore */
      }
      location.href = "/login.html?next=/studio.html";
    });
  }

  function wireProviders(providers, next) {
    const g = $("#gate-google");
    const f = $("#gate-facebook");
    const hint = $("#gate-oauth-hint");
    const q = "?next=" + encodeURIComponent(next);

    if (g) {
      if (providers.google) {
        g.classList.remove("disabled");
        g.href = "/api/auth/google" + q;
      } else {
        g.classList.add("disabled");
        g.href = "#";
        g.addEventListener("click", (e) => {
          e.preventDefault();
          showGateError(
            "Google nie jest skonfigurowany. Uzupełnij GOOGLE_CLIENT_ID / SECRET w .env"
          );
        });
      }
    }
    if (f) {
      if (providers.facebook) {
        f.classList.remove("disabled");
        f.href = "/api/auth/facebook" + q;
      } else {
        f.classList.add("disabled");
        f.href = "#";
        f.addEventListener("click", (e) => {
          e.preventDefault();
          showGateError(
            "Facebook nie jest skonfigurowany. Uzupełnij FACEBOOK_APP_ID / SECRET w .env"
          );
        });
      }
    }
    if (hint) {
      const missing = [];
      if (!providers.google) missing.push("Google");
      if (!providers.facebook) missing.push("Facebook");
      hint.innerHTML = missing.length
        ? missing.join(" i ") +
          ': dodaj klucze w <code>.env</code> i zrestartuj. ' +
          '<a href="/oauth-setup.html" style="color:#7df9ff">Instrukcja krok po kroku →</a>'
        : "";
    }
  }

  function wireGateForm() {
    const form = $("#auth-gate-form");
    const toggle = $("#gate-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const next =
          window.__clipforgeAuthMode === "register" ? "login" : "register";
        setGateMode(next);
      });
    }
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = ($("#gate-email")?.value || "").trim();
      const password = $("#gate-password")?.value || "";
      const name = ($("#gate-name")?.value || "").trim();
      const mode = window.__clipforgeAuthMode || "login";
      if (!email || !password) {
        showGateError(tr("err.needEmailPass", "Enter email and password."));
        return;
      }
      if (mode === "register" && password.length < 8) {
        showGateError(tr("err.passShort", "Password min. 8 characters."));
        return;
      }
      const submit = $("#gate-submit");
      if (submit) submit.disabled = true;
      showGateError("");
      try {
        const url =
          mode === "register" ? "/api/auth/register" : "/api/auth/login";
        const body =
          mode === "register" ? { email, password, name } : { email, password };
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showGateError(data.error || "Logowanie nie powiodło się.");
          if (data.canResend) {
            ensureResendBtn(email);
          }
          if (data.canRegister) {
            setGateMode("register");
            showGateError(
              (data.error || "") +
                " → formularz przełączony na rejestrację. To samo hasło utworzy konto od nowa."
            );
          }
          return;
        }

        if (data.needsActivation) {
          let msg =
            data.message ||
            "Sprawdź e-mail i kliknij link aktywacyjny (ważny 24h).";
          if (data.devActivateUrl) {
            msg += " Link dev: " + data.devActivateUrl;
            ensureDevActivateBtn(data.devActivateUrl);
          }
          showGateError("");
          showGateOk(msg);
          setGateMode("login");
          if ($("#gate-email")) $("#gate-email").value = email;
          return;
        }

        // Success — reload studio
        location.reload();
      } catch (err) {
        showGateError(err.message || "Błąd sieci — czy serwer ClipForge działa?");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  function showGateOk(msg) {
    let el = $("#auth-gate-ok");
    if (!el) {
      el = document.createElement("div");
      el.id = "auth-gate-ok";
      el.className = "auth-ok";
      el.setAttribute("role", "status");
      const err = $("#auth-gate-error");
      if (err && err.parentNode) {
        err.parentNode.insertBefore(el, err.nextSibling);
      }
    }
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
    if (msg) showGateError("");
  }

  function ensureDevActivateBtn(url) {
    let a = $("#gate-dev-activate");
    if (!a) {
      a = document.createElement("a");
      a.id = "gate-dev-activate";
      a.className = "auth-submit";
      a.style.display = "block";
      a.style.textAlign = "center";
      a.style.textDecoration = "none";
      a.style.marginTop = "0.75rem";
      const form = $("#auth-gate-form");
      form?.parentNode?.insertBefore(a, form.nextSibling);
    }
    a.href = url;
    a.textContent = "Aktywuj konto (link z e-maila)";
  }

  function ensureResendBtn(email) {
    let btn = $("#gate-resend");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "gate-resend";
      btn.className = "link-btn";
      btn.style.display = "block";
      btn.style.margin = "0.75rem auto 0";
      btn.textContent = tr("login.resend", "Resend activation link");
      const err = $("#auth-gate-error");
      err?.parentNode?.insertBefore(btn, err.nextSibling);
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const res = await fetch("/api/auth/resend-activation", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.devActivateUrl) ensureDevActivateBtn(data.devActivateUrl);
          showGateOk(data.message || "Wysłano link aktywacyjny.");
        } catch (e) {
          showGateError(e.message || "Błąd wysyłki");
        } finally {
          btn.disabled = false;
        }
      });
    }
  }

  async function init() {
    window.__clipforgeAuthMode = "login";
    wireGateForm();

    // Safety: strip any leftover Portal / Second Life links from old cached HTML
    document.querySelectorAll("nav.nav a").forEach((a) => {
      const t = (a.textContent || "").trim().toLowerCase();
      const href = (a.getAttribute("href") || "").toLowerCase();
      if (
        t === "portal" ||
        t.includes("second life") ||
        href === "/" ||
        href === "/index.html" ||
        href.includes("second-life")
      ) {
        a.remove();
      }
    });

    // Show gate immediately so login is always visible in Studio
    renderUser(null);
    showGate(true);
    setGateMode("login");

    let data = null;
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) throw new Error("auth me " + res.status);
      data = await res.json();
    } catch (err) {
      console.warn("[ClipForge auth]", err);
      showGateError(
        "Serwer nie obsługuje logowania (stary proces?). Zamknij stare okno ClipForge i uruchom ponownie start-clipforge.bat."
      );
      return;
    }

    const providers = data.providers || { email: true };
    wireProviders(providers, "/studio.html");

    if (data.authenticated && data.user) {
      renderUser(data.user);
      showGate(false);
      return;
    }

    // Not logged in — keep gate open (always show login in Studio)
    renderUser(null);
    showGate(true);
    setGateMode("login");
    if (data.authRequired === false) {
      // Optional auth: allow dismiss via small skip — still show gate first
      const card = $("#auth-gate .auth-gate-card");
      if (card && !$("#gate-skip")) {
        const skip = document.createElement("button");
        skip.type = "button";
        skip.id = "gate-skip";
        skip.className = "link-btn";
        skip.style.display = "block";
        skip.style.margin = "0.75rem auto 0";
        skip.textContent = "Kontynuuj bez logowania";
        skip.addEventListener("click", () => showGate(false));
        card.appendChild(skip);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
