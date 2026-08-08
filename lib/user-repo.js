/**
 * User repository — file JSON or Postgres (DATABASE_URL).
 * All methods are async.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const DATA_DIR = path.join(
  process.env.AUTH_DATA_DIR || path.join(__dirname, "..", "data", "auth")
);
const USERS_FILE = path.join(DATA_DIR, "users.json");

let fileCache = null;

function ensureAuthDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]\n", "utf8");
  }
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || null,
    name: row.name || null,
    avatar: row.avatar || null,
    passwordHash: row.password_hash || null,
    providers: row.providers || [],
    providerIds: row.provider_ids || {},
    emailVerified:
      row.email_verified === null || row.email_verified === undefined
        ? undefined
        : Boolean(row.email_verified),
    activationToken: row.activation_token || null,
    activationExpires: row.activation_expires
      ? new Date(row.activation_expires).toISOString()
      : null,
    resetToken: row.reset_token || null,
    resetExpires: row.reset_expires
      ? new Date(row.reset_expires).toISOString()
      : null,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : null,
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : null,
  };
}

// ── File backend ───────────────────────────────────────────────────────

function loadFileUsers() {
  ensureAuthDir();
  if (Array.isArray(fileCache)) {
    try {
      const st = fs.statSync(USERS_FILE);
      if (fileCache._mtimeMs && st.mtimeMs > fileCache._mtimeMs) {
        fileCache = null;
      } else {
        return fileCache.map((u) => ({ ...u }));
      }
    } catch {
      return fileCache.map((u) => ({ ...u }));
    }
  }
  try {
    const list = JSON.parse(fs.readFileSync(USERS_FILE, "utf8") || "[]");
    const arr = Array.isArray(list) ? list : [];
    fileCache = arr.map((u) => ({ ...u }));
    try {
      fileCache._mtimeMs = fs.statSync(USERS_FILE).mtimeMs;
    } catch {
      fileCache._mtimeMs = Date.now();
    }
    return arr.map((u) => ({ ...u }));
  } catch (err) {
    console.error("[user-repo] load file failed:", err.message);
    return [];
  }
}

/** Never persist plaintext password field — only passwordHash (bcrypt). */
function scrubUser(u) {
  if (!u || typeof u !== "object") return u;
  const out = { ...u };
  delete out.password;
  delete out.pass;
  delete out.plaintextPassword;
  return out;
}

function saveFileUsers(users) {
  ensureAuthDir();
  const list = (Array.isArray(users) ? users : []).map(scrubUser);
  const tmp = USERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, USERS_FILE);
  fileCache = list.map((u) => ({ ...u }));
  try {
    fileCache._mtimeMs = fs.statSync(USERS_FILE).mtimeMs;
  } catch {
    fileCache._mtimeMs = Date.now();
  }
}

// ── Public API ─────────────────────────────────────────────────────────

function backend() {
  return db.usingPostgres() ? "postgres" : "file";
}

async function userCount() {
  if (db.usingPostgres()) {
    const r = await db.query("SELECT COUNT(*)::int AS n FROM clipforge_users");
    return r.rows[0]?.n || 0;
  }
  return loadFileUsers().length;
}

async function findById(id) {
  if (!id) return null;
  if (db.usingPostgres()) {
    const r = await db.query(
      "SELECT * FROM clipforge_users WHERE id = $1 LIMIT 1",
      [String(id)]
    );
    return rowToUser(r.rows[0]);
  }
  return loadFileUsers().find((u) => u.id === id) || null;
}

async function findByEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  if (!e) return null;
  if (db.usingPostgres()) {
    const r = await db.query(
      "SELECT * FROM clipforge_users WHERE lower(email) = $1 LIMIT 1",
      [e]
    );
    return rowToUser(r.rows[0]);
  }
  return (
    loadFileUsers().find((u) => (u.email || "").toLowerCase() === e) || null
  );
}

async function findByProvider(provider, providerId) {
  const p = String(provider);
  const pid = String(providerId);
  if (db.usingPostgres()) {
    const r = await db.query(
      `SELECT * FROM clipforge_users
       WHERE provider_ids ? $1 AND provider_ids->>$1 = $2
       LIMIT 1`,
      [p, pid]
    );
    return rowToUser(r.rows[0]);
  }
  return (
    loadFileUsers().find(
      (u) =>
        u.providerIds &&
        u.providerIds[p] &&
        String(u.providerIds[p]) === pid
    ) || null
  );
}

async function findByActivationToken(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  if (db.usingPostgres()) {
    const r = await db.query(
      "SELECT * FROM clipforge_users WHERE activation_token = $1 LIMIT 1",
      [t]
    );
    return rowToUser(r.rows[0]);
  }
  return loadFileUsers().find((u) => u.activationToken === t) || null;
}

async function findByResetToken(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  if (db.usingPostgres()) {
    const r = await db.query(
      "SELECT * FROM clipforge_users WHERE reset_token = $1 LIMIT 1",
      [t]
    );
    return rowToUser(r.rows[0]);
  }
  return loadFileUsers().find((u) => u.resetToken === t) || null;
}

async function createUser(partial) {
  const p = scrubUser(partial || {});
  const user = {
    id: crypto.randomBytes(12).toString("hex"),
    email: p.email
      ? String(p.email).trim().toLowerCase()
      : null,
    name: p.name || null,
    avatar: p.avatar || null,
    passwordHash: p.passwordHash || null,
    providers: p.providers || [],
    providerIds: p.providerIds || {},
    emailVerified:
      p.emailVerified !== undefined ? p.emailVerified : false,
    activationToken: p.activationToken || null,
    activationExpires: p.activationExpires || null,
    resetToken: p.resetToken || null,
    resetExpires: p.resetExpires || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (db.usingPostgres()) {
    await db.query(
      `INSERT INTO clipforge_users (
        id, email, name, avatar, password_hash, providers, provider_ids,
        email_verified, activation_token, activation_expires,
        reset_token, reset_expires, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14
      )`,
      [
        user.id,
        user.email,
        user.name,
        user.avatar,
        user.passwordHash,
        JSON.stringify(user.providers),
        JSON.stringify(user.providerIds),
        user.emailVerified,
        user.activationToken,
        user.activationExpires,
        user.resetToken,
        user.resetExpires,
        user.createdAt,
        user.updatedAt,
      ]
    );
    return user;
  }

  const users = loadFileUsers();
  users.push(user);
  saveFileUsers(users);
  return user;
}

async function updateUser(id, patch) {
  const cleanPatch = scrubUser(patch || {});
  if (db.usingPostgres()) {
    const cur = await findById(id);
    if (!cur) return null;
    const next = scrubUser({
      ...cur,
      ...cleanPatch,
      updatedAt: new Date().toISOString(),
    });
    await db.query(
      `UPDATE clipforge_users SET
        email = $2,
        name = $3,
        avatar = $4,
        password_hash = $5,
        providers = $6::jsonb,
        provider_ids = $7::jsonb,
        email_verified = $8,
        activation_token = $9,
        activation_expires = $10,
        reset_token = $11,
        reset_expires = $12,
        updated_at = $13
      WHERE id = $1`,
      [
        id,
        next.email,
        next.name,
        next.avatar,
        next.passwordHash ?? null,
        JSON.stringify(next.providers || []),
        JSON.stringify(next.providerIds || {}),
        next.emailVerified,
        next.activationToken ?? null,
        next.activationExpires ?? null,
        next.resetToken ?? null,
        next.resetExpires ?? null,
        next.updatedAt,
      ]
    );
    return next;
  }

  const users = loadFileUsers();
  const i = users.findIndex((u) => u.id === id);
  if (i < 0) return null;
  users[i] = scrubUser({
    ...users[i],
    ...cleanPatch,
    updatedAt: new Date().toISOString(),
  });
  saveFileUsers(users);
  return users[i];
}

/** One-time: copy users.json into Postgres if table empty */
async function migrateFileUsersToPostgres() {
  if (!db.usingPostgres()) return { migrated: 0 };
  const n = await userCount();
  if (n > 0) return { migrated: 0, reason: "table_not_empty" };
  ensureAuthDir();
  if (!fs.existsSync(USERS_FILE)) return { migrated: 0, reason: "no_file" };
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(USERS_FILE, "utf8") || "[]");
  } catch {
    return { migrated: 0, reason: "bad_file" };
  }
  if (!Array.isArray(list) || !list.length) {
    return { migrated: 0, reason: "empty" };
  }
  let migrated = 0;
  for (const u of list) {
    if (!u || !u.id) continue;
    try {
      await db.query(
        `INSERT INTO clipforge_users (
          id, email, name, avatar, password_hash, providers, provider_ids,
          email_verified, activation_token, activation_expires,
          reset_token, reset_expires, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14
        ) ON CONFLICT (id) DO NOTHING`,
        [
          u.id,
          u.email || null,
          u.name || null,
          u.avatar || null,
          u.passwordHash || null,
          JSON.stringify(u.providers || []),
          JSON.stringify(u.providerIds || {}),
          u.emailVerified,
          u.activationToken || null,
          u.activationExpires || null,
          u.resetToken || null,
          u.resetExpires || null,
          u.createdAt || new Date().toISOString(),
          u.updatedAt || new Date().toISOString(),
        ]
      );
      migrated += 1;
    } catch (err) {
      console.error("[user-repo] migrate user failed:", u.email, err.message);
    }
  }
  console.log("[user-repo] migrated", migrated, "users from file → Postgres");
  return { migrated };
}

async function initUserRepo() {
  ensureAuthDir();
  if (db.usingPostgres()) {
    await db.initDb();
    await migrateFileUsersToPostgres();
    const n = await userCount();
    console.log("[user-repo] backend=postgres users=", n);
  } else {
    const n = loadFileUsers().length;
    console.log("[user-repo] backend=file users=", n, USERS_FILE);
  }
}

module.exports = {
  backend,
  initUserRepo,
  ensureAuthDir,
  userCount,
  findById,
  findByEmail,
  findByProvider,
  findByActivationToken,
  findByResetToken,
  createUser,
  updateUser,
  migrateFileUsersToPostgres,
};
