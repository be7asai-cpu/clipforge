/**
 * ClipForge login / register page
 */
(() => {
  const $ = (s) => document.querySelector(s);

  const form = $("#auth-form");
  const emailEl = $("#email");
  const passwordEl = $("#password");
  const nameEl = $("#name");
  const nameField = $("#name-field");
  const btnSubmit = $("#btn-submit");
  const btnToggle = $("#btn-toggle");
  const switchText = $("#switch-text");
  const titleEl = $("#auth-title");
  const subEl = $("#auth-sub");
  const errEl = $("#auth-error");
  const okEl = $("#auth-ok");
  const btnGoogle = $("#btn-google");
  const btnFacebook = $("#btn-facebook");
  const oauthHint = $("#oauth-hint");

  let mode = "login"; // login | register | forgot | reset

  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "/studio.html";
  const urlError = params.get("error");
  const resetToken = (params.get("reset") || "").trim();
  const btnForgot = $("#btn-forgot");
  const forgotRow = $("#forgot-row");
  const switchRow = $("#auth-switch-row");

  const errorMessages = {
    google_failed: "Logowanie Google nie powiodło się.",
    google_not_configured: "Google nie jest skonfigurowany (brak kluczy w .env).",
    facebook_failed: "Logowanie Facebook nie powiodło się.",
    facebook_not_configured:
      "Facebook nie jest skonfigurowany (brak kluczy w .env).",
    activate_missing: "Brak tokenu aktywacyjnego.",
    activate_invalid: "Link aktywacyjny jest nieprawidłowy.",
    activate_expired:
      "Link aktywacyjny wygasł. Zarejestruj się ponownie lub wyślij link jeszcze raz.",
    activate_session: "Konto aktywne, ale sesja nie wystartowała — zaloguj się.",
    activate_failed: "Aktywacja nie powiodła się.",
  };

  function showError(msg) {
    errEl.textContent = msg || "";
    errEl.classList.toggle("hidden", !msg);
    if (msg) okEl.classList.add("hidden");
  }

  function showOk(msg) {
    okEl.textContent = msg || "";
    okEl.classList.toggle("hidden", !msg);
    if (msg) errEl.classList.add("hidden");
  }

  if (urlError) {
    showError(errorMessages[urlError] || "Błąd logowania.");
  }

  function tr(key, fallback) {
    return (window.ClipForgeI18n && window.ClipForgeI18n.t(key)) || fallback || key;
  }

  function setMode(m) {
    mode = m;
    const isReg = mode === "register";
    const isForgot = mode === "forgot";
    const isReset = mode === "reset";

    if (isForgot) {
      titleEl.textContent = "Nie pamiętam hasła";
      subEl.textContent =
        "Podaj e-mail konta — wyślemy link do ustawienia nowego hasła (albo pokażemy link na stronie, jeśli brak SMTP).";
      btnSubmit.textContent = "Wyślij link resetu";
    } else if (isReset) {
      titleEl.textContent = "Nowe hasło";
      subEl.textContent = "Ustaw hasło (min. 8 znaków). Potem wejdziesz do Studio.";
      btnSubmit.textContent = "Zapisz hasło i zaloguj";
    } else {
      titleEl.textContent = isReg
        ? tr("login.registerTitle", "Utwórz konto")
        : tr("login.title", "Zaloguj się do ClipForge");
      subEl.textContent = isReg
        ? tr("login.subReg", "Zarejestruj się e-mailem albo użyj Google / Facebook.")
        : tr("login.sub", "Wejście do Studio: e-mail + hasło.");
      btnSubmit.textContent = isReg
        ? tr("login.register", "Zarejestruj")
        : tr("login.submit", "Zaloguj");
    }

    switchText.textContent = isReg
      ? tr("login.haveAccount", "Masz już konto?")
      : tr("login.noAccount", "Nie masz konta?");
    btnToggle.textContent = isReg
      ? tr("login.switchLog", "Zaloguj się")
      : isForgot || isReset
        ? "Wróć do logowania"
        : tr("login.switchReg", "Zarejestruj się");

    nameField.hidden = !isReg;
    // forgot: only email; reset: only password
    if (emailEl.closest("label")) {
      emailEl.closest("label").hidden = isReset;
    }
    if (passwordEl.closest("label")) {
      passwordEl.closest("label").hidden = isForgot;
    }
    emailEl.required = !isReset;
    passwordEl.required = !isForgot;
    passwordEl.autocomplete =
      isReg || isReset ? "new-password" : "current-password";
    if (forgotRow) forgotRow.hidden = isForgot || isReset || isReg;
    if (switchRow) switchRow.hidden = false;
    showError("");
    showOk("");
  }

  btnToggle.addEventListener("click", () => {
    if (mode === "forgot" || mode === "reset") {
      // clear reset token from URL when going back
      if (resetToken) {
        const u = new URL(location.href);
        u.searchParams.delete("reset");
        history.replaceState({}, "", u.pathname + u.search);
      }
      setMode("login");
      return;
    }
    setMode(mode === "login" ? "register" : "login");
  });

  if (btnForgot) {
    btnForgot.addEventListener("click", () => setMode("forgot"));
  }

  async function loadProviders() {
    try {
      const res = await fetch("/api/auth/providers", { credentials: "include" });
      const data = await res.json();
      const p = data.providers || {};

      if (p.google) {
        btnGoogle.classList.remove("disabled");
        btnGoogle.href =
          "/api/auth/google?next=" + encodeURIComponent(next);
      } else {
        btnGoogle.classList.add("disabled");
        btnGoogle.href = "#";
      }

      if (p.facebook) {
        btnFacebook.classList.remove("disabled");
        btnFacebook.href =
          "/api/auth/facebook?next=" + encodeURIComponent(next);
      } else {
        btnFacebook.classList.add("disabled");
        btnFacebook.href = "#";
      }

      const hints = [];
      if (!data.smtpConfigured && !p.smtp) {
        hints.push(
          "⚠ Wysyłka e-mail WYŁĄCZONA — w .env uzupełnij SMTP (Gmail: App Password). Bez tego link aktywacyjny pokaże się na stronie, ale nie dotrze na skrzynkę."
        );
      }
      if (!p.google || !p.facebook) {
        hints.push(
          "Google/Facebook: dodaj klucze w .env → instrukcja: /oauth-setup.html"
        );
      }
      if (oauthHint) oauthHint.textContent = hints.join(" · ");
    } catch {
      if (oauthHint)
        oauthHint.textContent =
          "Nie udało się sprawdzić dostępnych metod logowania.";
    }
  }

  // Already logged in? go to studio
  fetch("/api/auth/me", { credentials: "include" })
    .then((r) => r.json())
    .then((data) => {
      if (data.authenticated) {
        location.replace(next.startsWith("/") ? next : "/studio.html");
      }
    })
    .catch(() => {});

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    showOk("");

    const email = emailEl.value.trim();
    const password = passwordEl.value;
    const name = nameEl.value.trim();

    if (mode === "forgot") {
      if (!email) {
        showError("Podaj e-mail konta.");
        return;
      }
      btnSubmit.disabled = true;
      try {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.error || "Nie udało się wysłać resetu.");
          return;
        }
        showOk(data.message || "Sprawdź e-mail.");
        if (data.resetUrl) showResetLink(data.resetUrl);
      } catch (err) {
        showError(err.message || "Błąd sieci");
      } finally {
        btnSubmit.disabled = false;
      }
      return;
    }

    if (mode === "reset") {
      if (password.length < 8) {
        showError(tr("err.passShort", "Hasło musi mieć co najmniej 8 znaków."));
        return;
      }
      const token =
        resetToken ||
        new URLSearchParams(location.search).get("reset") ||
        "";
      if (!token) {
        showError("Brak tokenu resetu. Poproś o nowy link.");
        return;
      }
      btnSubmit.disabled = true;
      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.error || "Reset nie powiódł się.");
          return;
        }
        showOk(data.message || "Hasło zmienione.");
        if (data.loggedIn) {
          setTimeout(() => {
            location.href = next.startsWith("/") ? next : "/studio.html";
          }, 400);
        } else {
          setMode("login");
        }
      } catch (err) {
        showError(err.message || "Błąd sieci");
      } finally {
        btnSubmit.disabled = false;
      }
      return;
    }

    if (!email || !password) {
      showError(tr("err.needEmailPass", "Podaj e-mail i hasło."));
      return;
    }
    if (mode === "register" && password.length < 8) {
      showError(tr("err.passShort", "Hasło musi mieć co najmniej 8 znaków."));
      return;
    }

    btnSubmit.disabled = true;
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
        showError(data.error || "Operacja nie powiodła się.");
        if (data.canResend && data.email) {
          showResend(data.email);
        }
        return;
      }

      if (data.needsActivation) {
        showOk(data.message || "Konto wymaga aktywacji.");
        if (data.devActivateUrl) {
          showDevLink(data.devActivateUrl);
        }
        if (data.hint) {
          oauthHint.textContent = data.hint;
        }
        setMode("login");
        emailEl.value = email;
        return;
      }

      // Auto-activated (no SMTP) or normal login success
      showOk(
        data.autoActivated
          ? data.message || "Konto gotowe — wchodzę do Studio…"
          : "Zalogowano…"
      );
      setTimeout(() => {
        location.href = next.startsWith("/") ? next : "/studio.html";
      }, 350);
    } catch (err) {
      showError(err.message || "Błąd sieci");
    } finally {
      btnSubmit.disabled = false;
    }
  });

  function showResetLink(url) {
    let a = document.getElementById("dev-reset-link");
    if (!a) {
      a = document.createElement("a");
      a.id = "dev-reset-link";
      a.className = "auth-submit";
      a.style.display = "block";
      a.style.textAlign = "center";
      a.style.textDecoration = "none";
      a.style.marginTop = "0.75rem";
      form.parentNode.insertBefore(a, form.nextSibling);
    }
    a.href = url;
    a.textContent = "▶ Ustaw nowe hasło (kliknij ten link)";
    a.style.background =
      "linear-gradient(180deg, rgba(61,255,154,0.35), rgba(0,168,192,0.2))";
  }

  function showDevLink(url) {
    let a = document.getElementById("dev-activate-link");
    if (!a) {
      a = document.createElement("a");
      a.id = "dev-activate-link";
      a.className = "auth-submit";
      a.style.display = "block";
      a.style.textAlign = "center";
      a.style.textDecoration = "none";
      a.style.marginTop = "0.75rem";
      form.parentNode.insertBefore(a, form.nextSibling);
    }
    a.href = url;
    a.textContent = tr(
      "login.activate",
      "▶ Aktywuj konto teraz (kliknij ten link)"
    );
    a.style.background =
      "linear-gradient(180deg, rgba(61,255,154,0.35), rgba(0,168,192,0.2))";
  }

  function showResend(email) {
    let btn = document.getElementById("btn-resend");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "btn-resend";
      btn.className = "link-btn";
      btn.style.display = "block";
      btn.style.margin = "0.75rem auto 0";
      btn.textContent = tr("login.resend", "Wyślij ponownie link aktywacyjny");
      errEl.parentNode.insertBefore(btn, errEl.nextSibling);
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
          if (data.devActivateUrl) showDevLink(data.devActivateUrl);
          showOk(data.message || "Wysłano link.");
          showError("");
        } catch (e) {
          showError(e.message || "Błąd wysyłki");
        } finally {
          btn.disabled = false;
        }
      });
    }
  }

  loadProviders();

  // Open reset form when landing from e-mail link
  if (resetToken) {
    setMode("reset");
  }
})();
