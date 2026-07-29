/**
 * Remote PC agents — browser stays on cloud URL; processing runs on user's PC.
 * Agent opens outbound HTTPS to cloud (no port-forward, no redirect).
 *
 * Online status is keyed by userId AND email (email survives re-register / file-auth wipe).
 * Also persisted to disk so a single-instance restart does not instantly show PC · OFF.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data", "auth");
const TOKENS_FILE = path.join(DATA_DIR, "agent-tokens.json");
const ONLINE_FILE = path.join(DATA_DIR, "pc-online.json");
/** Heartbeat window — agent polls ~2.5s; keep generous for free-tier wake/jitter */
const ONLINE_MS = Number(process.env.PC_AGENT_ONLINE_MS) || 120 * 1000;

/** @type {Map<string, { userId: string, token: string, label: string, createdAt: string, email?: string|null }>} */
const tokensByKey = new Map();
/**
 * @type {Map<string, { lastSeen: number, label: string, token: string, userId: string, email?: string|null }>}
 * key = "u:" + userId  or  "e:" + email
 */
const onlineMap = new Map();

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadTokens() {
  ensureDir();
  tokensByKey.clear();
  if (!fs.existsSync(TOKENS_FILE)) return;
  try {
    const rows = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    for (const row of rows || []) {
      if (row && row.token && row.userId) {
        tokensByKey.set(String(row.token), {
          userId: String(row.userId),
          token: String(row.token),
          label: row.label || "PC",
          createdAt: row.createdAt || new Date().toISOString(),
          email: row.email ? String(row.email).toLowerCase() : null,
        });
      }
    }
  } catch {
    /* ignore */
  }
}

function saveTokens() {
  ensureDir();
  const rows = [...tokensByKey.values()];
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(rows, null, 2) + "\n", "utf8");
}

function loadOnlineFromDisk() {
  if (!fs.existsSync(ONLINE_FILE)) return;
  try {
    const rows = JSON.parse(fs.readFileSync(ONLINE_FILE, "utf8"));
    const now = Date.now();
    for (const row of rows || []) {
      if (!row || !row.key || !row.lastSeen) continue;
      if (now - Number(row.lastSeen) > ONLINE_MS) continue;
      onlineMap.set(String(row.key), {
        lastSeen: Number(row.lastSeen),
        label: row.label || "PC",
        token: row.token || "",
        userId: row.userId ? String(row.userId) : "",
        email: row.email ? String(row.email).toLowerCase() : null,
      });
    }
  } catch {
    /* ignore */
  }
}

let persistTimer = null;
function schedulePersistOnline() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      ensureDir();
      const now = Date.now();
      const rows = [];
      for (const [key, o] of onlineMap) {
        if (now - o.lastSeen > ONLINE_MS) continue;
        rows.push({
          key,
          lastSeen: o.lastSeen,
          label: o.label,
          token: o.token,
          userId: o.userId,
          email: o.email || null,
        });
      }
      fs.writeFileSync(ONLINE_FILE, JSON.stringify(rows, null, 2) + "\n", "utf8");
    } catch {
      /* ignore */
    }
  }, 400);
}

loadTokens();
loadOnlineFromDisk();

/** HMAC secret — must be stable across Render instances (set SESSION_SECRET in env). */
function tokenSecret() {
  return (
    process.env.AGENT_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    "clipforge-agent-dev-secret-change-me"
  );
}

function normalizeEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return e || null;
}

function signTokenPayload(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString(
    "base64url"
  );
  const sig = crypto
    .createHmac("sha256", tokenSecret())
    .update("cf1." + payload)
    .digest("base64url");
  return "cf1." + payload + "." + sig;
}

function verifySignedToken(token) {
  const t = String(token || "").trim();
  if (!t.startsWith("cf1.")) return null;
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  const sig = parts[2];
  const expect = crypto
    .createHmac("sha256", tokenSecret())
    .update("cf1." + payload)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || data.u == null) return null;
    // 180 days max
    if (data.iat && Date.now() - Number(data.iat) > 180 * 24 * 3600 * 1000) {
      return null;
    }
    return {
      userId: String(data.u),
      token: t,
      label: String(data.l || "PC").slice(0, 40),
      email: data.e ? normalizeEmail(data.e) : null,
      createdAt: data.iat
        ? new Date(Number(data.iat)).toISOString()
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} userId
 * @param {string} [label]
 * @param {string|null} [email]
 */
function issueToken(userId, label, email) {
  const lab = String(label || "Mój PC").slice(0, 40);
  const em = normalizeEmail(email);
  // Signed token works on every Render instance without shared disk
  const payload = {
    u: String(userId),
    l: lab,
    n: crypto.randomBytes(8).toString("hex"),
    iat: Date.now(),
  };
  if (em) payload.e = em;
  const token = signTokenPayload(payload);
  const row = {
    userId: String(userId),
    token,
    label: lab,
    email: em,
    createdAt: new Date().toISOString(),
  };
  // One active token per user in local cache (replace old)
  for (const [k, v] of tokensByKey) {
    if (v.userId === row.userId) tokensByKey.delete(k);
    if (em && v.email === em) tokensByKey.delete(k);
  }
  tokensByKey.set(token, row);
  saveTokens();
  return row;
}

function resolveToken(token) {
  if (!token) return null;
  const t = String(token).trim();
  const mem = tokensByKey.get(t);
  if (mem) return mem;
  // Multi-instance / after restart: verify HMAC without disk
  const signed = verifySignedToken(t);
  if (signed) {
    tokensByKey.set(t, signed);
    return signed;
  }
  return null;
}

/**
 * Mark agent online. Prefer current account userId (after email remap).
 * @param {string} token
 * @param {string} [label]
 * @param {{ userId?: string, email?: string|null }} [opts]
 */
function heartbeat(token, label, opts = {}) {
  const row = resolveToken(token);
  if (!row) return null;
  const userId = String(opts.userId || row.userId);
  const email = normalizeEmail(
    opts.email != null ? opts.email : row.email
  );
  const lab = label || row.label || "PC";
  const entry = {
    lastSeen: Date.now(),
    label: lab,
    token: row.token,
    userId,
    email,
  };
  onlineMap.set("u:" + userId, entry);
  // Also keep token's original userId online (legacy jobs / old session)
  if (String(row.userId) !== userId) {
    onlineMap.set("u:" + String(row.userId), { ...entry, userId: String(row.userId) });
  }
  if (email) {
    onlineMap.set("e:" + email, entry);
  }
  schedulePersistOnline();
  return {
    userId,
    email,
    online: true,
    label: lab,
  };
}

function freshEntry(key) {
  const o = onlineMap.get(key);
  if (!o) return null;
  if (Date.now() - o.lastSeen > ONLINE_MS) {
    onlineMap.delete(key);
    schedulePersistOnline();
    return null;
  }
  return o;
}

function isOnline(userId, email) {
  if (userId != null && userId !== "") {
    if (freshEntry("u:" + String(userId))) return true;
  }
  const em = normalizeEmail(email);
  if (em && freshEntry("e:" + em)) return true;
  return false;
}

/**
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} email
 */
function statusFor(userId, email) {
  const em = normalizeEmail(email);
  let o = null;
  let match = null;
  if (userId != null && userId !== "") {
    o = freshEntry("u:" + String(userId));
    if (o) match = "userId";
  }
  if (!o && em) {
    o = freshEntry("e:" + em);
    if (o) match = "email";
  }
  const any = listOnline();
  return {
    online: !!o,
    label: o?.label || null,
    lastSeen: o?.lastSeen || null,
    match,
    email: em,
    anyOnline: any.length > 0,
    agentsOnline: any.length,
    /** true when some agent is online but not this account */
    otherAccount: !o && any.length > 0,
  };
}

function listOnline() {
  const now = Date.now();
  const seen = new Set();
  const out = [];
  for (const [key, o] of [...onlineMap.entries()]) {
    if (now - o.lastSeen > ONLINE_MS) {
      onlineMap.delete(key);
      continue;
    }
    // Deduplicate by userId
    const id = o.userId || key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      userId: o.userId,
      email: o.email || null,
      label: o.label,
      lastSeen: o.lastSeen,
    });
  }
  if (onlineMap.size !== out.length) schedulePersistOnline();
  return out;
}

module.exports = {
  issueToken,
  resolveToken,
  heartbeat,
  isOnline,
  statusFor,
  listOnline,
  ONLINE_MS,
  normalizeEmail,
};
