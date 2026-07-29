/**
 * Remote PC agents — browser stays on cloud URL; processing runs on user's PC.
 * Agent opens outbound HTTPS to cloud (no port-forward, no redirect).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data", "auth");
const TOKENS_FILE = path.join(DATA_DIR, "agent-tokens.json");
const ONLINE_MS = 45 * 1000; // heartbeat window

/** @type {Map<string, { userId: string, token: string, label: string, createdAt: string }>} */
const tokensByKey = new Map();
/** @type {Map<string, { lastSeen: number, label: string, token: string }>} */
const onlineByUser = new Map();

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

loadTokens();

/** HMAC secret — must be stable across Render instances (set SESSION_SECRET in env). */
function tokenSecret() {
  return (
    process.env.AGENT_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    "clipforge-agent-dev-secret-change-me"
  );
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
      createdAt: data.iat
        ? new Date(Number(data.iat)).toISOString()
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function issueToken(userId, label) {
  const lab = String(label || "Mój PC").slice(0, 40);
  // Signed token works on every Render instance without shared disk
  const token = signTokenPayload({
    u: String(userId),
    l: lab,
    n: crypto.randomBytes(8).toString("hex"),
    iat: Date.now(),
  });
  const row = {
    userId: String(userId),
    token,
    label: lab,
    createdAt: new Date().toISOString(),
  };
  // One active token per user in local cache (replace old)
  for (const [k, v] of tokensByKey) {
    if (v.userId === row.userId) tokensByKey.delete(k);
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

function heartbeat(token, label) {
  const row = resolveToken(token);
  if (!row) return null;
  onlineByUser.set(row.userId, {
    lastSeen: Date.now(),
    label: label || row.label || "PC",
    token: row.token,
  });
  return {
    userId: row.userId,
    online: true,
    label: label || row.label,
  };
}

function isOnline(userId) {
  if (userId == null) return false;
  const o = onlineByUser.get(String(userId));
  if (!o) return false;
  if (Date.now() - o.lastSeen > ONLINE_MS) {
    onlineByUser.delete(String(userId));
    return false;
  }
  return true;
}

function statusFor(userId) {
  const online = isOnline(userId);
  const o = onlineByUser.get(String(userId));
  return {
    online,
    label: o?.label || null,
    lastSeen: o?.lastSeen || null,
  };
}

function listOnline() {
  const now = Date.now();
  const out = [];
  for (const [userId, o] of onlineByUser) {
    if (now - o.lastSeen <= ONLINE_MS) {
      out.push({ userId, label: o.label, lastSeen: o.lastSeen });
    }
  }
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
};
