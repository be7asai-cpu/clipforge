/**
 * ClipForge — per-user cloud clip library ("Mój dysk"), quota 500 MB/user.
 * data/user-disk/{userId}/index.json + files. On Render free the disk is ephemeral
 * (files vanish on redeploy) unless a persistent disk is mounted at data/.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "data", "user-disk");
const QUOTA = Number(process.env.USER_DISK_QUOTA_MB || 500) * 1024 * 1024;

function safeUid(uid) {
  return String(uid).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "anon";
}
function dirOf(uid) {
  const d = path.join(ROOT, safeUid(uid));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function readIndex(uid) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dirOf(uid), "index.json"), "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
function writeIndex(uid, items) {
  const f = path.join(dirOf(uid), "index.json");
  fs.writeFileSync(f + ".tmp", JSON.stringify(items, null, 2));
  fs.renameSync(f + ".tmp", f);
}
function usage(uid) {
  const items = readIndex(uid);
  const used = items.reduce((s, i) => s + (i.size || 0) + (i.thumbSize || 0), 0);
  return { used, quota: QUOTA, free: Math.max(0, QUOTA - used) };
}
function list(uid) {
  return { items: readIndex(uid).map(({ file, thumbFile, ...pub }) => ({ ...pub, hasThumb: !!thumbFile })), ...usage(uid) };
}
function get(uid, id) {
  const it = readIndex(uid).find((i) => i.id === String(id));
  if (!it) return null;
  const d = dirOf(uid);
  return { ...it, path: path.join(d, it.file), thumbPath: it.thumbFile ? path.join(d, it.thumbFile) : null };
}
/** Move/copy srcPath into disk. mode "move" | "copy". Throws on quota. */
function add(uid, { srcPath, mode = "move", name, mime, title, description, thumbSrc, thumbMime }) {
  const size = fs.statSync(srcPath).size;
  const tsize = thumbSrc ? fs.statSync(thumbSrc).size : 0;
  const u = usage(uid);
  if (size + tsize > u.free) {
    const e = new Error(`Brak miejsca na dysku (wolne ${(u.free / 1048576).toFixed(1)} MB, plik ${(size / 1048576).toFixed(1)} MB)`);
    e.status = 413;
    throw e;
  }
  const id = crypto.randomBytes(8).toString("hex");
  const d = dirOf(uid);
  const ext = (path.extname(name || "") || ".mp4").toLowerCase().replace(/[^.a-z0-9]/g, "") || ".mp4";
  const file = id + ext;
  (mode === "copy" ? fs.copyFileSync : moveFile)(srcPath, path.join(d, file));
  let thumbFile = null;
  if (thumbSrc) {
    thumbFile = id + "_thumb" + (/png/i.test(thumbMime || "") ? ".png" : ".jpg");
    moveFile(thumbSrc, path.join(d, thumbFile));
  }
  const item = {
    id,
    name: String(name || file).slice(0, 160),
    size,
    thumbSize: tsize,
    mime: mime || "video/mp4",
    createdAt: new Date().toISOString(),
    title: String(title || "").slice(0, 300),
    description: String(description || "").slice(0, 5000),
    file,
    thumbFile,
  };
  const items = readIndex(uid);
  items.unshift(item);
  writeIndex(uid, items);
  const { file: _f, thumbFile: _t, ...pub } = item;
  return { ...pub, hasThumb: !!thumbFile };
}
function moveFile(a, b) {
  try {
    fs.renameSync(a, b);
  } catch {
    fs.copyFileSync(a, b);
    fs.unlinkSync(a);
  }
}
function remove(uid, id) {
  const items = readIndex(uid);
  const it = items.find((i) => i.id === String(id));
  if (!it) return false;
  const d = dirOf(uid);
  for (const f of [it.file, it.thumbFile]) if (f) fs.promises.unlink(path.join(d, f)).catch(() => {});
  writeIndex(uid, items.filter((i) => i !== it));
  return true;
}

module.exports = { QUOTA, list, get, add, remove, usage };
