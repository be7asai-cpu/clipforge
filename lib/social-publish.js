/**
 * ClipForge — one-shot social publish (YouTube / Facebook Page / Instagram Reels / TikTok / X).
 * Credentials are pasted by the user, stored per-user and encrypted at rest (AES-256-GCM).
 * Key: SOCIAL_SECRETS_KEY (preferred) or SESSION_SECRET. Change of key = saved accounts unreadable.
 * File: data/auth/social-accounts.json (gitignored).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");

const STORE = path.join(__dirname, "..", "data", "auth", "social-accounts.json");
const GRAPH = "https://graph.facebook.com/v21.0";
const GRAPH_VIDEO = "https://graph-video.facebook.com/v21.0";

const PLATFORMS = {
  youtube: {
    label: "YouTube",
    fields: [
      { key: "clientId", label: "Client ID", required: true },
      { key: "clientSecret", label: "Client Secret", required: true, secret: true },
      { key: "refreshToken", label: "Refresh Token", required: true, secret: true },
      { key: "apiKey", label: "API key (opcjonalnie)", secret: true },
      { key: "privacy", label: "Prywatność (public/unlisted/private)" },
    ],
    help: "https://console.cloud.google.com/apis/credentials",
    thumb: true,
  },
  facebook: {
    label: "Facebook Page",
    fields: [
      { key: "pageId", label: "Page ID", required: true },
      { key: "pageToken", label: "Page Access Token", required: true, secret: true },
    ],
    help: "https://developers.facebook.com/tools/explorer/",
    thumb: true,
  },
  instagram: {
    label: "Instagram Reels",
    fields: [
      { key: "igUserId", label: "IG Business User ID", required: true },
      { key: "accessToken", label: "Page/User Access Token", required: true, secret: true },
    ],
    help: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    thumb: "url",
  },
  tiktok: {
    label: "TikTok",
    fields: [
      { key: "accessToken", label: "Access Token", required: true, secret: true },
      { key: "openId", label: "open_id (opcjonalnie)" },
      { key: "mode", label: "Tryb: inbox / direct" },
      { key: "privacy", label: "Direct: SELF_ONLY / PUBLIC_TO_EVERYONE…" },
    ],
    help: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    thumb: false,
  },
  x: {
    label: "X (Twitter)",
    fields: [
      { key: "apiKey", label: "API Key", required: true, secret: true },
      { key: "apiSecret", label: "API Secret", required: true, secret: true },
      { key: "accessToken", label: "Access Token", required: true, secret: true },
      { key: "accessSecret", label: "Access Token Secret", required: true, secret: true },
    ],
    help: "https://developer.x.com/en/portal/dashboard",
    thumb: false,
  },
};

/* ---------- storage ---------- */
function key() {
  const raw = process.env.SOCIAL_SECRETS_KEY || process.env.SESSION_SECRET || "clipforge-dev-social-key";
  return crypto.createHash("sha256").update(String(raw)).digest();
}
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
function decrypt(s) {
  try {
    const [iv, tag, data] = String(s).split(".").map((x) => Buffer.from(x, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8")) || {};
  } catch {
    return {};
  }
}
function writeStore(s) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  const tmp = STORE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE);
}
function getCreds(userId, platform) {
  const e = readStore()[String(userId)]?.[platform];
  return e ? decrypt(e.enc) : null;
}
function mask(v) {
  const s = String(v || "");
  if (!s) return "";
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}
function isComplete(platform, creds) {
  const p = PLATFORMS[platform];
  return !!(p && creds && p.fields.filter((f) => f.required).every((f) => String(creds[f.key] || "").trim()));
}

function listAccounts(userId) {
  const u = readStore()[String(userId)] || {};
  return Object.entries(PLATFORMS).map(([id, p]) => {
    const entry = u[id];
    const creds = entry ? decrypt(entry.enc) : null;
    const fields = {};
    for (const f of p.fields) {
      const v = creds?.[f.key];
      fields[f.key] = v ? (f.secret ? mask(v) : String(v)) : "";
    }
    return {
      platform: id,
      label: p.label,
      help: p.help,
      thumb: p.thumb,
      fieldDefs: p.fields.map(({ key, label, required, secret }) => ({ key, label, required: !!required, secret: !!secret })),
      fields,
      saved: !!entry,
      unreadable: !!entry && !creds,
      connected: isComplete(id, creds),
      tested: entry?.tested || null,
      updatedAt: entry?.updatedAt || null,
    };
  });
}

function upsertAccount(userId, platform, fields) {
  const p = PLATFORMS[platform];
  if (!p) throw new Error("Nieznana platforma");
  const prev = getCreds(userId, platform) || {};
  const next = { ...prev };
  for (const f of p.fields) {
    if (!(f.key in (fields || {}))) continue;
    const v = String(fields[f.key] ?? "").trim();
    // masked value sent back unchanged → keep previous secret
    if (v.startsWith("••••")) continue;
    if (v) next[f.key] = v;
    else delete next[f.key];
  }
  const s = readStore();
  const uid = String(userId);
  s[uid] = s[uid] || {};
  s[uid][platform] = { enc: encrypt(next), updatedAt: new Date().toISOString(), tested: null };
  writeStore(s);
  return listAccounts(userId).find((a) => a.platform === platform);
}

function deleteAccount(userId, platform) {
  const s = readStore();
  const uid = String(userId);
  if (s[uid] && s[uid][platform]) {
    delete s[uid][platform];
    writeStore(s);
    return true;
  }
  return false;
}

function markTested(userId, platform, ok, info) {
  const s = readStore();
  const e = s[String(userId)]?.[platform];
  if (!e) return;
  e.tested = { ok: !!ok, at: new Date().toISOString(), info: String(info || "").slice(0, 200) };
  writeStore(s);
}

/* ---------- http helpers ---------- */
async function jfetch(url, opts = {}, label = "") {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!r.ok) {
    const msg =
      data?.error?.message ||
      data?.error?.error_user_msg ||
      (typeof data?.error === "string" ? data.error : "") ||
      data?.error_description ||
      data?.detail ||
      data?.title ||
      data?.errors?.[0]?.message ||
      data?.raw ||
      r.statusText;
    const err = new Error(`${label ? label + ": " : ""}HTTP ${r.status} ${msg}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return { data, res: r };
}
function fileStream(p, start, end) {
  return Readable.toWeb(fs.createReadStream(p, start != null ? { start, end } : undefined));
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function imageMime(p) {
  return /\.png$/i.test(p) ? "image/png" : "image/jpeg";
}
function fileBlob(p, type) {
  return new Blob([fs.readFileSync(p)], { type });
}

/* ---------- YouTube ---------- */
async function ytAccessToken(c) {
  const { data } = await jfetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: c.refreshToken,
        grant_type: "refresh_token",
      }),
    },
    "Google OAuth"
  );
  return data.access_token;
}
async function youtubeTest(c) {
  const at = await ytAccessToken(c);
  const { data } = await jfetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${at}` } },
    "YouTube"
  );
  return data.items?.[0]?.snippet?.title || "OK";
}
async function youtubePublish(c, { videoPath, title, description, thumbPath }) {
  const at = await ytAccessToken(c);
  const size = fs.statSync(videoPath).size;
  const privacy = /^(public|unlisted|private)$/.test(c.privacy || "") ? c.privacy : "public";
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${at}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: { title: String(title || "ClipForge").slice(0, 100), description: String(description || "").slice(0, 5000) },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      }),
    }
  );
  if (!init.ok) throw new Error(`YouTube init: HTTP ${init.status} ${(await init.text()).slice(0, 300)}`);
  const loc = init.headers.get("location");
  if (!loc) throw new Error("YouTube: brak URL uploadu");
  const { data } = await jfetch(
    loc,
    {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
      body: fileStream(videoPath),
      duplex: "half",
    },
    "YouTube upload"
  );
  const id = data.id;
  let warning;
  if (thumbPath && id) {
    try {
      await jfetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(id)}`,
        { method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": imageMime(thumbPath) }, body: fs.readFileSync(thumbPath) },
        "YouTube thumbnail"
      );
    } catch (e) {
      warning = e.message + " (miniatury wymagają zweryfikowanego kanału)";
    }
  }
  return { url: `https://youtu.be/${id}`, id, warning };
}

/* ---------- Facebook Page ---------- */
async function facebookTest(c) {
  const { data } = await jfetch(
    `${GRAPH}/${encodeURIComponent(c.pageId)}?fields=name&access_token=${encodeURIComponent(c.pageToken)}`,
    {},
    "Facebook"
  );
  return data.name || "OK";
}
async function facebookPublish(c, { videoPath, title, description, thumbPath }) {
  const fd = new FormData();
  fd.append("access_token", c.pageToken);
  fd.append("title", String(title || ""));
  fd.append("description", String(description || title || ""));
  fd.append("source", fileBlob(videoPath, "video/mp4"), path.basename(videoPath));
  if (thumbPath) fd.append("thumb", fileBlob(thumbPath, imageMime(thumbPath)), path.basename(thumbPath));
  const { data } = await jfetch(`${GRAPH_VIDEO}/${encodeURIComponent(c.pageId)}/videos`, { method: "POST", body: fd }, "Facebook");
  return { id: data.id, url: `https://www.facebook.com/${encodeURIComponent(c.pageId)}/videos/${data.id}` };
}

/* ---------- Instagram Reels (resumable upload, no public URL needed) ---------- */
async function instagramTest(c) {
  const { data } = await jfetch(
    `${GRAPH}/${encodeURIComponent(c.igUserId)}?fields=username&access_token=${encodeURIComponent(c.accessToken)}`,
    {},
    "Instagram"
  );
  return data.username ? "@" + data.username : "OK";
}
async function instagramPublish(c, { videoPath, title, description, thumbUrl }) {
  const caption = [title, description].filter(Boolean).join("\n\n").slice(0, 2200);
  const params = new URLSearchParams({ media_type: "REELS", upload_type: "resumable", caption, access_token: c.accessToken });
  if (thumbUrl) params.set("cover_url", thumbUrl);
  const { data: cont } = await jfetch(`${GRAPH}/${encodeURIComponent(c.igUserId)}/media`, { method: "POST", body: params }, "Instagram container");
  const size = fs.statSync(videoPath).size;
  const uploadUri = cont.uri || `https://rupload.facebook.com/ig-api-upload/v21.0/${cont.id}`;
  await jfetch(
    uploadUri,
    {
      method: "POST",
      headers: { Authorization: `OAuth ${c.accessToken}`, offset: "0", file_size: String(size), "Content-Length": String(size) },
      body: fileStream(videoPath),
      duplex: "half",
    },
    "Instagram upload"
  );
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const { data: st } = await jfetch(
      `${GRAPH}/${cont.id}?fields=status_code,status&access_token=${encodeURIComponent(c.accessToken)}`,
      {},
      "Instagram status"
    );
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error("Instagram: " + (st.status || st.status_code));
    if (i === 59) throw new Error("Instagram: przetwarzanie trwa zbyt długo");
  }
  const { data: pub } = await jfetch(
    `${GRAPH}/${encodeURIComponent(c.igUserId)}/media_publish`,
    { method: "POST", body: new URLSearchParams({ creation_id: cont.id, access_token: c.accessToken }) },
    "Instagram publish"
  );
  let url = "";
  try {
    const { data } = await jfetch(`${GRAPH}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(c.accessToken)}`, {}, "");
    url = data.permalink || "";
  } catch {
    /* optional */
  }
  return { id: pub.id, url };
}

/* ---------- TikTok Content Posting API ---------- */
const TT = "https://open.tiktokapis.com/v2";
async function tiktokTest(c) {
  const { data } = await jfetch(
    `${TT}/post/publish/creator_info/query/`,
    { method: "POST", headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json; charset=UTF-8" } },
    "TikTok"
  );
  if (data.error && data.error.code && data.error.code !== "ok") throw new Error("TikTok: " + data.error.message);
  return data.data?.creator_username ? "@" + data.data.creator_username : "OK";
}
async function tiktokPublish(c, { videoPath, title, description }) {
  const size = fs.statSync(videoPath).size;
  const MIN = 5 * 1024 * 1024, CH = 10 * 1024 * 1024;
  const chunk = size <= 64 * 1024 * 1024 ? size : CH;
  const count = size <= 64 * 1024 * 1024 ? 1 : Math.floor(size / CH);
  const direct = String(c.mode || "").toLowerCase() === "direct";
  const body = { source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count } };
  if (direct) {
    body.post_info = {
      title: [title, description].filter(Boolean).join("\n").slice(0, 2200),
      privacy_level: c.privacy || "SELF_ONLY",
    };
  }
  const { data } = await jfetch(
    `${TT}/post/publish/${direct ? "" : "inbox/"}video/init/`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
    },
    "TikTok init"
  );
  if (data.error && data.error.code !== "ok") throw new Error("TikTok: " + data.error.message);
  const { publish_id, upload_url } = data.data || {};
  for (let i = 0; i < count; i++) {
    const start = i * chunk;
    const end = i === count - 1 ? size - 1 : start + chunk - 1;
    void MIN;
    const r = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
      body: fileStream(videoPath, start, end),
      duplex: "half",
    });
    if (!r.ok && r.status !== 206) throw new Error(`TikTok upload: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  return {
    id: publish_id,
    url: "",
    warning: direct
      ? "TikTok: publikacja w toku (publish_id " + publish_id + ")"
      : "TikTok: wideo trafiło do skrzynki (inbox) w aplikacji TikTok — dokończ publikację tam, tytuł/opis dodaj w aplikacji.",
  };
}

/* ---------- X (OAuth 1.0a) ---------- */
function pct(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
}
function oauthHeader(c, method, url, extra = {}) {
  const u = new URL(url);
  const o = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: c.accessToken,
    oauth_version: "1.0",
  };
  const all = [...Object.entries(o), ...u.searchParams.entries(), ...Object.entries(extra)]
    .map(([k, v]) => [pct(k), pct(String(v))])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = [method.toUpperCase(), pct(u.origin + u.pathname), pct(all.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  o.oauth_signature = crypto.createHmac("sha1", `${pct(c.apiSecret)}&${pct(c.accessSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries(o).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}
const XAPI = "https://api.x.com/2";
async function xTest(c) {
  const url = `${XAPI}/users/me`;
  const { data } = await jfetch(url, { headers: { Authorization: oauthHeader(c, "GET", url) } }, "X");
  return data.data?.username ? "@" + data.data.username : "OK";
}
async function xPublish(c, { videoPath, title, description }) {
  const size = fs.statSync(videoPath).size;
  let url = `${XAPI}/media/upload/initialize`;
  const { data: init } = await jfetch(
    url,
    {
      method: "POST",
      headers: { Authorization: oauthHeader(c, "POST", url), "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "video/mp4", total_bytes: size, media_category: "amplify_video" }),
    },
    "X init"
  );
  const mediaId = init.data?.id || init.id || init.media_id_string;
  if (!mediaId) throw new Error("X: brak media_id");
  const SEG = 4 * 1024 * 1024;
  const fd0 = fs.openSync(videoPath, "r");
  try {
    for (let i = 0, off = 0; off < size; i++, off += SEG) {
      const len = Math.min(SEG, size - off);
      const buf = Buffer.alloc(len);
      fs.readSync(fd0, buf, 0, len, off);
      const fd = new FormData();
      fd.append("segment_index", String(i));
      fd.append("media", new Blob([buf], { type: "application/octet-stream" }), "chunk");
      url = `${XAPI}/media/upload/${mediaId}/append`;
      await jfetch(url, { method: "POST", headers: { Authorization: oauthHeader(c, "POST", url) }, body: fd }, "X append");
    }
  } finally {
    fs.closeSync(fd0);
  }
  url = `${XAPI}/media/upload/${mediaId}/finalize`;
  const { data: fin } = await jfetch(url, { method: "POST", headers: { Authorization: oauthHeader(c, "POST", url) } }, "X finalize");
  let info = fin.data?.processing_info || fin.processing_info;
  for (let i = 0; info && info.state !== "succeeded" && i < 60; i++) {
    if (info.state === "failed") throw new Error("X: przetwarzanie wideo nie powiodło się " + (info.error?.message || ""));
    await sleep(Math.max(1, info.check_after_secs || 3) * 1000);
    url = `${XAPI}/media/upload?command=STATUS&media_id=${mediaId}`;
    const { data: st } = await jfetch(url, { headers: { Authorization: oauthHeader(c, "GET", url) } }, "X status");
    info = st.data?.processing_info || st.processing_info;
  }
  const text = [title, description].filter(Boolean).join("\n\n").slice(0, 280);
  url = `${XAPI}/tweets`;
  const { data: tw } = await jfetch(
    url,
    {
      method: "POST",
      headers: { Authorization: oauthHeader(c, "POST", url), "Content-Type": "application/json" },
      body: JSON.stringify({ text, media: { media_ids: [String(mediaId)] } }),
    },
    "X tweet"
  );
  const id = tw.data?.id;
  return { id, url: id ? `https://x.com/i/web/status/${id}` : "" };
}

const IMPL = {
  youtube: { test: youtubeTest, publish: youtubePublish },
  facebook: { test: facebookTest, publish: facebookPublish },
  instagram: { test: instagramTest, publish: instagramPublish },
  tiktok: { test: tiktokTest, publish: tiktokPublish },
  x: { test: xTest, publish: xPublish },
};

async function testAccount(userId, platform) {
  const c = getCreds(userId, platform);
  if (!isComplete(platform, c)) return { ok: false, error: "Uzupełnij wymagane pola" };
  try {
    const info = await IMPL[platform].test(c);
    markTested(userId, platform, true, info);
    return { ok: true, info };
  } catch (e) {
    markTested(userId, platform, false, e.message);
    return { ok: false, error: String(e.message || e) };
  }
}

async function publish({ userId, platforms, videoPath, title, description, thumbPath, thumbUrl }) {
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error("Brak pliku wideo");
  const list = [...new Set((platforms || []).filter((p) => PLATFORMS[p]))];
  const settled = await Promise.allSettled(
    list.map(async (platform) => {
      const c = getCreds(userId, platform);
      if (!isComplete(platform, c)) throw new Error("Konto niepołączone — uzupełnij klucze");
      return IMPL[platform].publish(c, { videoPath, title, description, thumbPath, thumbUrl });
    })
  );
  return {
    results: settled.map((s, i) =>
      s.status === "fulfilled"
        ? { platform: list[i], ok: true, url: s.value?.url || "", id: s.value?.id || "", warning: s.value?.warning || "" }
        : { platform: list[i], ok: false, error: String(s.reason?.message || s.reason) }
    ),
  };
}

module.exports = { PLATFORMS, listAccounts, upsertAccount, deleteAccount, testAccount, publish, _oauthHeader: oauthHeader };
