/**
 * ClipForge auth — email/password + Google + Facebook OAuth.
 * Email accounts require activation link before login.
 * Users stored in data/auth/users.json (local file, no DB required).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const FacebookStrategy = require("passport-facebook").Strategy;
const mail = require("./mail");

const DATA_DIR = path.join(
  process.env.AUTH_DATA_DIR || path.join(__dirname, "..", "data", "auth")
);
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TTL_MS = 60 * 60 * 1000; // 1h

/** In-process cache — source of truth between disk reads (avoids lost updates). */
let usersCache = null;

function ensureAuthDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]\n", "utf8");
  }
}

function loadUsers() {
  ensureAuthDir();
  // Prefer cache after any write in this process
  if (Array.isArray(usersCache)) {
    try {
      // Refresh from disk if file is newer (another process/instance wrote)
      const st = fs.statSync(USERS_FILE);
      if (usersCache._mtimeMs && st.mtimeMs > usersCache._mtimeMs) {
        usersCache = null;
      } else {
        return usersCache.map((u) => ({ ...u }));
      }
    } catch {
      return usersCache.map((u) => ({ ...u }));
    }
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const list = JSON.parse(raw || "[]");
    const arr = Array.isArray(list) ? list : [];
    usersCache = arr.map((u) => ({ ...u }));
    try {
      usersCache._mtimeMs = fs.statSync(USERS_FILE).mtimeMs;
    } catch {
      usersCache._mtimeMs = Date.now();
    }
    return arr.map((u) => ({ ...u }));
  } catch (err) {
    console.error("[auth] loadUsers failed:", err.message);
    return [];
  }
}

function saveUsers(users) {
  ensureAuthDir();
  const list = Array.isArray(users) ? users : [];
  const tmp = USERS_FILE + ".tmp";
  const payload = JSON.stringify(list, null, 2) + "\n";
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, USERS_FILE);
  // Keep memory cache in sync (strip any helper props)
  usersCache = list.map((u) => ({ ...u }));
  try {
    usersCache._mtimeMs = fs.statSync(USERS_FILE).mtimeMs;
  } catch {
    usersCache._mtimeMs = Date.now();
  }
  console.log("[auth] users saved:", list.length, "→", USERS_FILE);
}

function userCount() {
  return loadUsers().length;
}

/** Legacy accounts (no flag) count as verified. */
function isEmailVerified(user) {
  if (!user) return false;
  if (user.emailVerified === true) return true;
  if (user.emailVerified === false) return false;
  // OAuth always verified
  if ((user.providers || []).some((p) => p === "google" || p === "facebook")) {
    return true;
  }
  // Old local accounts created before activation feature
  if (user.passwordHash && user.emailVerified === undefined) return true;
  return false;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || null,
    name: u.name || u.email || "User",
    avatar: u.avatar || null,
    providers: u.providers || [],
    emailVerified: isEmailVerified(u),
    createdAt: u.createdAt,
  };
}

function findById(id) {
  return loadUsers().find((u) => u.id === id) || null;
}

function findByEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  if (!e) return null;
  return loadUsers().find((u) => (u.email || "").toLowerCase() === e) || null;
}

function findByProvider(provider, providerId) {
  return (
    loadUsers().find(
      (u) =>
        u.providerIds &&
        u.providerIds[provider] &&
        String(u.providerIds[provider]) === String(providerId)
    ) || null
  );
}

function findByActivationToken(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  return loadUsers().find((u) => u.activationToken === t) || null;
}

function findByResetToken(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  return loadUsers().find((u) => u.resetToken === t) || null;
}

function createUser(partial) {
  const users = loadUsers();
  const user = {
    id: crypto.randomBytes(12).toString("hex"),
    email: partial.email
      ? String(partial.email).trim().toLowerCase()
      : null,
    name: partial.name || null,
    avatar: partial.avatar || null,
    passwordHash: partial.passwordHash || null,
    providers: partial.providers || [],
    providerIds: partial.providerIds || {},
    emailVerified:
      partial.emailVerified !== undefined ? partial.emailVerified : false,
    activationToken: partial.activationToken || null,
    activationExpires: partial.activationExpires || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return user;
}

function updateUser(id, patch) {
  const users = loadUsers();
  const i = users.findIndex((u) => u.id === id);
  if (i < 0) return null;
  users[i] = {
    ...users[i],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveUsers(users);
  return users[i];
}

function issueActivationToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const activationExpires = new Date(
    Date.now() + ACTIVATION_TTL_MS
  ).toISOString();
  return updateUser(userId, {
    activationToken: token,
    activationExpires,
    emailVerified: false,
  });
}

function clearActivation(userId) {
  return updateUser(userId, {
    emailVerified: true,
    activationToken: null,
    activationExpires: null,
  });
}

function activationLink(token) {
  return `${baseUrl()}/api/auth/activate?token=${encodeURIComponent(token)}`;
}

function linkProvider(user, provider, providerId, profile) {
  const providers = new Set(user.providers || []);
  providers.add(provider);
  const providerIds = {
    ...(user.providerIds || {}),
    [provider]: String(providerId),
  };
  return updateUser(user.id, {
    providers: [...providers],
    providerIds,
    name: user.name || profile.name || null,
    avatar: user.avatar || profile.avatar || null,
    email: user.email || (profile.email ? profile.email.toLowerCase() : null),
    emailVerified: true,
    activationToken: null,
    activationExpires: null,
  });
}

function upsertOAuthUser(provider, profile) {
  const providerId = String(profile.id);
  const email = profile.emails?.[0]?.value
    ? String(profile.emails[0].value).toLowerCase()
    : profile.email
      ? String(profile.email).toLowerCase()
      : null;
  const name =
    profile.displayName ||
    profile.name?.givenName ||
    [profile.name?.givenName, profile.name?.familyName]
      .filter(Boolean)
      .join(" ") ||
    email ||
    `${provider} user`;
  const avatar =
    profile.photos?.[0]?.value ||
    profile._json?.picture?.data?.url ||
    profile._json?.picture ||
    null;

  let user = findByProvider(provider, providerId);
  if (user) {
    return updateUser(user.id, {
      name: user.name || name,
      avatar: user.avatar || avatar,
      email: user.email || email,
      emailVerified: true,
      activationToken: null,
      activationExpires: null,
    });
  }

  if (email) {
    user = findByEmail(email);
    if (user) {
      return linkProvider(user, provider, providerId, { name, avatar, email });
    }
  }

  return createUser({
    email,
    name,
    avatar,
    providers: [provider],
    providerIds: { [provider]: providerId },
    emailVerified: true,
  });
}

function baseUrl() {
  // Prefer explicit BASE_URL, then Render's free public URL, then request-less fallback
  const raw =
    process.env.BASE_URL ||
    process.env.AUTH_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL || // e.g. https://clipforge-45ti.onrender.com
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    `http://localhost:${process.env.PORT || 3847}`;
  let url = String(raw).trim().replace(/\/$/, "");
  // Railway sometimes gives host without scheme
  if (url && !/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

function envFilled(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function providersStatus() {
  return {
    email: true,
    google: envFilled("GOOGLE_CLIENT_ID") && envFilled("GOOGLE_CLIENT_SECRET"),
    facebook:
      envFilled("FACEBOOK_APP_ID") && envFilled("FACEBOOK_APP_SECRET"),
    smtp: mail.smtpConfigured(),
  };
}

/** Redirect URIs to paste into Google / Meta consoles */
function oauthRedirects() {
  const base = baseUrl();
  return {
    baseUrl: base,
    google: `${base}/api/auth/google/callback`,
    facebook: `${base}/api/auth/facebook/callback`,
  };
}

/** When SMTP is off, expose activate URL in API so local testing still works. */
function exposeDevLinks() {
  if (mail.smtpConfigured()) return false;
  const v = String(process.env.EMAIL_DEV_LINKS || "true").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

async function sendActivationForUser(user) {
  let u = user;
  if (!u.activationToken || !u.activationExpires) {
    u = issueActivationToken(u.id);
  } else {
    const exp = new Date(u.activationExpires).getTime();
    if (!Number.isFinite(exp) || exp < Date.now()) {
      u = issueActivationToken(u.id);
    }
  }
  const activateUrl = activationLink(u.activationToken);
  const result = await mail.sendActivationEmail({
    to: u.email,
    name: u.name,
    activateUrl,
  });
  return { user: u, activateUrl, mail: result };
}

function configurePassport() {
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    try {
      const user = findById(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const user = findByEmail(email);
          if (!user) {
            return done(null, false, {
              message:
                "Nie ma konta z tym e-mailem. Po restarcie serwera (Render free) lista kont bywa czyszczona — zarejestruj się ponownie (to samo hasło zadziała od razu).",
              code: "USER_NOT_FOUND",
            });
          }
          if (!user.passwordHash) {
            return done(null, false, {
              message:
                "To konto jest tylko przez Google/Facebook — zaloguj się przyciskiem OAuth, nie hasłem.",
              code: "NO_PASSWORD",
            });
          }
          const ok = await bcrypt.compare(
            String(password || ""),
            user.passwordHash
          );
          if (!ok) {
            return done(null, false, {
              message:
                "Hasło niepasuje. Użyj „Nie pamiętam hasła” albo zarejestruj się ponownie tym samym e-mailem po resecie.",
              code: "BAD_PASSWORD",
            });
          }
          if (!isEmailVerified(user)) {
            // Without SMTP nobody can activate by mail — unlock on valid password
            if (!mail.smtpConfigured()) {
              const fixed =
                clearActivation(user.id) ||
                updateUser(user.id, {
                  emailVerified: true,
                  activationToken: null,
                  activationExpires: null,
                });
              return done(null, fixed);
            }
            return done(null, false, {
              message:
                "Konto nieaktywne. Sprawdź e-mail z linkiem aktywacyjnym.",
              code: "EMAIL_NOT_VERIFIED",
              email: user.email,
            });
          }
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  const providers = providersStatus();

  if (providers.google) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${baseUrl()}/api/auth/google/callback`,
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            const user = upsertOAuthUser("google", profile);
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  if (providers.facebook) {
    passport.use(
      new FacebookStrategy(
        {
          clientID: process.env.FACEBOOK_APP_ID,
          clientSecret: process.env.FACEBOOK_APP_SECRET,
          callbackURL: `${baseUrl()}/api/auth/facebook/callback`,
          profileFields: ["id", "displayName", "emails", "photos"],
          enableProof: true,
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            const user = upsertOAuthUser("facebook", profile);
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }
}

function isAuthRequired() {
  const v = String(process.env.AUTH_REQUIRED || "true").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    // Block unverified email sessions (shouldn't happen, but safety)
    if (req.user && !isEmailVerified(req.user)) {
      const url = String(req.originalUrl || req.url || "");
      const isApi =
        url.startsWith("/api/") ||
        String(req.baseUrl || "").startsWith("/api");
      if (isApi) {
        return res.status(403).json({
          error: "Potwierdź e-mail linkiem aktywacyjnym.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }
    } else {
      return next();
    }
  }
  const url = String(req.originalUrl || req.url || "");
  const isApi =
    url.startsWith("/api/") ||
    String(req.baseUrl || "").startsWith("/api") ||
    String(req.path || "").startsWith("/api/");
  if (isApi) {
    return res
      .status(401)
      .json({ error: "Wymagane logowanie", loginUrl: "/login.html" });
  }
  if (req.accepts("html")) {
    const nextUrl = encodeURIComponent(req.originalUrl || "/studio.html");
    return res.redirect(`/login.html?next=${nextUrl}`);
  }
  return res
    .status(401)
    .json({ error: "Wymagane logowanie", loginUrl: "/login.html" });
}

function requireAuthIfEnabled(req, res, next) {
  if (!isAuthRequired()) return next();
  return requireAuth(req, res, next);
}

function attachAuthRoutes(app) {
  app.get("/api/auth/me", (req, res) => {
    res.json({
      authenticated: Boolean(req.user && isEmailVerified(req.user)),
      user: publicUser(req.user),
      providers: providersStatus(),
      authRequired: isAuthRequired(),
      smtpConfigured: mail.smtpConfigured(),
      oauthRedirects: oauthRedirects(),
    });
  });

  app.get("/api/auth/providers", (_req, res) => {
    res.json({
      providers: providersStatus(),
      authRequired: isAuthRequired(),
      smtpConfigured: mail.smtpConfigured(),
      oauthRedirects: oauthRedirects(),
      setupGuide: "/OAUTH-SETUP.md",
    });
  });

  /**
   * Auto-activate + session when SMTP is missing or send fails.
   * (Render free without env vars — user can still use Studio.)
   */
  function establishSession(req, res, user, payload) {
    const u = user;
    // Regenerate session id then login — reliable Set-Cookie on free hosts
    const finish = (err) => {
      if (err) {
        console.error("session login error:", err);
        return res.status(500).json({
          error:
            "Konto OK, ale sesja nie wystartowała — spróbuj zalogować się hasłem.",
          email: u.email,
        });
      }
      if (req.session) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      }
      req.session.save((saveErr) => {
        if (saveErr) console.error("session.save error:", saveErr);
        return res.json(payload);
      });
    };

    if (typeof req.session?.regenerate === "function") {
      req.session.regenerate((regenErr) => {
        if (regenErr) console.error("session.regenerate:", regenErr);
        req.login(u, finish);
      });
    } else {
      req.login(u, finish);
    }
  }

  function finishAutoActivate(req, res, user, message) {
    const activated =
      clearActivation(user.id) ||
      updateUser(user.id, {
        emailVerified: true,
        activationToken: null,
        activationExpires: null,
      });
    // Verify password hash still present after activate (paranoia)
    const check = findById(activated.id);
    if (!check || !check.passwordHash) {
      console.error("[auth] user lost passwordHash after activate", activated.id);
    }
    establishSession(req, res, activated, {
      ok: true,
      needsActivation: false,
      autoActivated: true,
      email: activated.email,
      user: publicUser(activated),
      message:
        message ||
        "Konto utworzone i od razu aktywne (brak SMTP — pominięto e-mail).",
    });
  }

  // Email register → SMTP activation, or auto-activate if no mail possible
  app.post("/api/auth/register", async (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const password = String(req.body?.password || "");
      const name = String(req.body?.name || "").trim() || email.split("@")[0];

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Podaj prawidłowy adres e-mail." });
      }
      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: "Hasło musi mieć co najmniej 8 znaków." });
      }

      const existing = findByEmail(email);
      if (existing) {
        // Same email + same password → just log in (common after "I already registered")
        if (existing.passwordHash) {
          const samePass = await bcrypt.compare(password, existing.passwordHash);
          if (samePass) {
            if (!isEmailVerified(existing) && !mail.smtpConfigured()) {
              return finishAutoActivate(
                req,
                res,
                existing,
                "Zalogowano (konto już było w systemie)."
              );
            }
            if (isEmailVerified(existing) || !mail.smtpConfigured()) {
              const u =
                isEmailVerified(existing)
                  ? existing
                  : clearActivation(existing.id) || existing;
              return establishSession(req, res, u, {
                ok: true,
                needsActivation: false,
                autoActivated: false,
                email: u.email,
                user: publicUser(u),
                message: "Konto już istniało — zalogowano tym hasłem.",
              });
            }
          }
        }

        if (!isEmailVerified(existing) && existing.passwordHash) {
          const passwordHash = await bcrypt.hash(password, 12);
          let user = updateUser(existing.id, {
            passwordHash,
            name: name || existing.name,
          });

          // No working SMTP → activate immediately
          if (!mail.smtpConfigured()) {
            return finishAutoActivate(
              req,
              res,
              user,
              "Konto aktywowane od razu (SMTP nie jest ustawione na serwerze)."
            );
          }

          const sent = await sendActivationForUser(user);
          if (!(sent.mail.mode === "smtp" && sent.mail.ok)) {
            return finishAutoActivate(
              req,
              res,
              user,
              "Mail nie wyszedł — konto aktywowane automatycznie. Możesz korzystać ze Studio."
            );
          }
          return res.json({
            ok: true,
            needsActivation: true,
            email,
            mailMode: sent.mail.mode,
            smtpConfigured: true,
            message:
              "Konto czeka na aktywację — wysłaliśmy ponownie link na e-mail.",
          });
        }
        return res.status(409).json({
          error:
            "Konto z tym e-mailem już istnieje, ale hasło jest inne. Użyj „Nie pamiętam hasła” albo Zaloguj z poprawnym hasłem.",
          code: "EMAIL_TAKEN",
          canReset: true,
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const smtpOk = mail.smtpConfigured();

      // ── No SMTP: create already verified + log in ─────────────────────
      if (!smtpOk) {
        const user = createUser({
          email,
          name,
          passwordHash,
          providers: ["email"],
          emailVerified: true,
          activationToken: null,
          activationExpires: null,
        });
        return finishAutoActivate(
          req,
          res,
          user,
          "Konto utworzone — możesz od razu korzystać ze Studio (e-mail aktywacyjny pominięty: brak SMTP na Renderze)."
        );
      }

      // ── SMTP configured: classic activation mail flow ─────────────────
      const token = crypto.randomBytes(32).toString("hex");
      const user = createUser({
        email,
        name,
        passwordHash,
        providers: ["email"],
        emailVerified: false,
        activationToken: token,
        activationExpires: new Date(
          Date.now() + ACTIVATION_TTL_MS
        ).toISOString(),
      });

      const activateUrl = activationLink(token);
      const mailResult = await mail.sendActivationEmail({
        to: email,
        name,
        activateUrl,
      });

      if (mailResult.mode === "smtp" && mailResult.ok) {
        return res.json({
          ok: true,
          needsActivation: true,
          email,
          mailMode: "smtp",
          smtpConfigured: true,
          message:
            "Konto utworzone. Wysłaliśmy e-mail z linkiem aktywacyjnym — sprawdź skrzynkę i folder spam.",
        });
      }

      // SMTP set but send failed → don't lock user out
      console.error(
        "[ClipForge] SMTP send failed, auto-activating:",
        mailResult.error
      );
      return finishAutoActivate(
        req,
        res,
        user,
        "Mail nie wyszedł (błąd SMTP) — konto aktywowane automatycznie. Sprawdź ustawienia SMTP na Renderze."
      );
    } catch (err) {
      console.error("register error:", err);
      res.status(500).json({ error: err.message || "Błąd rejestracji" });
    }
  });

  // Activate via link from email
  app.get("/api/auth/activate", (req, res) => {
    try {
      const token = String(req.query.token || "").trim();
      if (!token) {
        return res.redirect("/login.html?error=activate_missing");
      }
      const user = findByActivationToken(token);
      if (!user) {
        return res.redirect("/login.html?error=activate_invalid");
      }
      const exp = user.activationExpires
        ? new Date(user.activationExpires).getTime()
        : 0;
      if (!Number.isFinite(exp) || exp < Date.now()) {
        return res.redirect("/login.html?error=activate_expired");
      }

      const activated = clearActivation(user.id);
      req.login(activated, (err) => {
        if (err) {
          console.error("activate login error:", err);
          return res.redirect("/login.html?error=activate_session");
        }
        return res.redirect("/studio.html?activated=1");
      });
    } catch (err) {
      console.error("activate error:", err);
      return res.redirect("/login.html?error=activate_failed");
    }
  });

  // Resend activation email
  app.post("/api/auth/resend-activation", async (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      if (!email) {
        return res.status(400).json({ error: "Podaj e-mail." });
      }
      const user = findByEmail(email);
      // Don't reveal whether account exists
      if (!user || isEmailVerified(user) || !user.passwordHash) {
        return res.json({
          ok: true,
          message:
            "Jeśli konto czeka na aktywację, wysłaliśmy nowy link na ten e-mail.",
        });
      }

      const sent = await sendActivationForUser(user);
      const payload = {
        ok: true,
        mailMode: sent.mail.mode,
        smtpConfigured: mail.smtpConfigured(),
      };
      if (sent.mail.mode === "smtp" && sent.mail.ok) {
        payload.message =
          "Wysłano link aktywacyjny (sprawdź skrzynkę i folder spam).";
      } else {
        payload.message =
          "E-mail nie został wysłany (brak SMTP). Użyj przycisku aktywacji poniżej.";
        payload.devActivateUrl = sent.activateUrl;
      }
      return res.json(payload);
    } catch (err) {
      console.error("resend error:", err);
      res.status(500).json({ error: err.message || "Błąd wysyłki" });
    }
  });

  // Email login
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) {
        console.error("login error:", err);
        return res.status(500).json({ error: "Błąd logowania" });
      }
      if (!user) {
        const code = info?.code || null;
        const status = code === "EMAIL_NOT_VERIFIED" ? 403 : 401;
        console.warn(
          "[auth] login fail",
          code || "UNKNOWN",
          String(req.body?.email || "").slice(0, 40),
          "users=",
          userCount()
        );
        return res.status(status).json({
          error: info?.message || "Nieprawidłowy e-mail lub hasło.",
          code,
          email: info?.email || null,
          canResend: code === "EMAIL_NOT_VERIFIED",
          canRegister: code === "USER_NOT_FOUND",
          canReset: code === "BAD_PASSWORD",
          usersOnServer: userCount(),
        });
      }
      establishSession(req, res, user, {
        ok: true,
        user: publicUser(user),
      });
    })(req, res, next);
  });

  /**
   * Forgot password — always returns generic OK (no email enumeration).
   * With SMTP: sends reset link. Without SMTP / send fail: returns resetUrl for UI.
   */
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Podaj prawidłowy adres e-mail." });
      }

      const user = findByEmail(email);
      const generic = {
        ok: true,
        message:
          "Jeśli konto z tym e-mailem istnieje, wyślemy link do resetu hasła (sprawdź skrzynkę i spam).",
      };

      // OAuth-only accounts without password
      if (!user || !user.passwordHash) {
        return res.json(generic);
      }

      const token = crypto.randomBytes(32).toString("hex");
      updateUser(user.id, {
        resetToken: token,
        resetExpires: new Date(Date.now() + RESET_TTL_MS).toISOString(),
      });

      const resetUrl = `${baseUrl()}/login.html?reset=${encodeURIComponent(token)}`;
      const mailResult = await mail.sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
      });

      if (mailResult.mode === "smtp" && mailResult.ok) {
        return res.json(generic);
      }

      // No SMTP or send failed — show link on page (same pattern as activation)
      return res.json({
        ok: true,
        message:
          "E-mail nie wyszedł (brak SMTP lub błąd wysyłki). Użyj linku poniżej, żeby ustawić nowe hasło.",
        resetUrl,
        mailMode: mailResult.mode,
      });
    } catch (err) {
      console.error("forgot-password error:", err);
      res.status(500).json({ error: err.message || "Błąd resetu hasła" });
    }
  });

  /** Set new password with token from e-mail / on-page link */
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const token = String(req.body?.token || "").trim();
      const password = String(req.body?.password || "");
      if (!token) {
        return res.status(400).json({ error: "Brak tokenu resetu." });
      }
      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: "Hasło musi mieć co najmniej 8 znaków." });
      }

      const user = findByResetToken(token);
      if (!user) {
        return res
          .status(400)
          .json({ error: "Link resetu jest nieprawidłowy lub już użyty." });
      }
      const exp = user.resetExpires ? new Date(user.resetExpires).getTime() : 0;
      if (!Number.isFinite(exp) || exp < Date.now()) {
        return res.status(400).json({
          error: "Link resetu wygasł. Poproś o nowy (Nie pamiętam hasła).",
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const updated = updateUser(user.id, {
        passwordHash,
        resetToken: null,
        resetExpires: null,
        // ensure they can log in after reset
        emailVerified: true,
        activationToken: null,
        activationExpires: null,
      });

      req.login(updated, (loginErr) => {
        if (loginErr) {
          return res.json({
            ok: true,
            message: "Hasło zmienione — zaloguj się nowym hasłem.",
            loggedIn: false,
          });
        }
        if (req.session) {
          req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        }
        return res.json({
          ok: true,
          message: "Hasło zmienione — wchodzisz do Studio.",
          loggedIn: true,
          user: publicUser(updated),
        });
      });
    } catch (err) {
      console.error("reset-password error:", err);
      res.status(500).json({ error: err.message || "Błąd resetu hasła" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const finish = () => {
      req.session?.destroy(() => {
        res.clearCookie("clipforge.sid");
        res.json({ ok: true });
      });
    };
    if (typeof req.logout === "function") {
      req.logout((err) => {
        if (err) console.error("logout error:", err);
        finish();
      });
    } else {
      finish();
    }
  });

  // Google OAuth
  app.get("/api/auth/google", (req, res, next) => {
    if (!providersStatus().google) {
      return res.status(503).json({
        error:
          "Google login nie jest skonfigurowany. Ustaw GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET w .env",
      });
    }
    if (req.query.next) {
      req.session.authNext = String(req.query.next);
    }
    passport.authenticate("google", {
      scope: ["profile", "email"],
      prompt: "select_account",
    })(req, res, next);
  });

  app.get(
    "/api/auth/google/callback",
    (req, res, next) => {
      if (!providersStatus().google) {
        return res.redirect("/login.html?error=google_not_configured");
      }
      passport.authenticate("google", {
        failureRedirect: "/login.html?error=google_failed",
      })(req, res, next);
    },
    (req, res) => {
      const nextUrl = safeNext(req.session?.authNext);
      if (req.session) delete req.session.authNext;
      res.redirect(nextUrl);
    }
  );

  // Facebook OAuth
  app.get("/api/auth/facebook", (req, res, next) => {
    if (!providersStatus().facebook) {
      return res.status(503).json({
        error:
          "Facebook login nie jest skonfigurowany. Ustaw FACEBOOK_APP_ID i FACEBOOK_APP_SECRET w .env",
      });
    }
    if (req.query.next) {
      req.session.authNext = String(req.query.next);
    }
    passport.authenticate("facebook", {
      scope: ["email", "public_profile"],
    })(req, res, next);
  });

  app.get(
    "/api/auth/facebook/callback",
    (req, res, next) => {
      if (!providersStatus().facebook) {
        return res.redirect("/login.html?error=facebook_not_configured");
      }
      passport.authenticate("facebook", {
        failureRedirect: "/login.html?error=facebook_failed",
      })(req, res, next);
    },
    (req, res) => {
      const nextUrl = safeNext(req.session?.authNext);
      if (req.session) delete req.session.authNext;
      res.redirect(nextUrl);
    }
  );
}

function safeNext(raw) {
  const fallback = "/studio.html";
  if (!raw || typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("://")) return fallback;
  return raw;
}

module.exports = {
  ensureAuthDir,
  configurePassport,
  attachAuthRoutes,
  requireAuth,
  requireAuthIfEnabled,
  isAuthRequired,
  providersStatus,
  oauthRedirects,
  publicUser,
  baseUrl,
  passport,
  isEmailVerified,
  findByEmail,
  findById,
  userCount,
};
