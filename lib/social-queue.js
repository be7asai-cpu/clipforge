/**
 * ClipForge — scheduled / queued social publishing.
 * Persisted in data/auth/social-queue.json. runAt stored as UTC ISO.
 * Video source: jobId | diskId (upload sources are saved to disk first, so the file survives until run time).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "..", "data", "auth", "social-queue.json");
let busy = false;

function readAll() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
function writeAll(items) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(items, null, 2));
  fs.renameSync(FILE + ".tmp", FILE);
}
function list(userId) {
  return readAll()
    .filter((i) => i.userId === String(userId))
    .map(({ userId: _u, ...pub }) => pub)
    .sort((a, b) => String(a.runAt).localeCompare(String(b.runAt)));
}
function create(userId, { videoSource, platforms, title, description, thumbUrl, runAt }) {
  const when = runAt ? new Date(runAt) : new Date();
  if (isNaN(when.getTime())) throw new Error("Nieprawidłowa data");
  if (!videoSource || !(videoSource.jobId || videoSource.diskId)) throw new Error("Brak źródła wideo");
  if (!Array.isArray(platforms) || !platforms.length) throw new Error("Wybierz konta");
  const item = {
    id: crypto.randomBytes(8).toString("hex"),
    userId: String(userId),
    videoSource,
    platforms,
    title: String(title || "").slice(0, 300),
    description: String(description || "").slice(0, 5000),
    thumbUrl: thumbUrl || null,
    runAt: when.toISOString(),
    createdAt: new Date().toISOString(),
    status: "pending",
    results: null,
  };
  const all = readAll();
  all.push(item);
  writeAll(all);
  const { userId: _u, ...pub } = item;
  return pub;
}
function update(userId, id, patch) {
  const all = readAll();
  const it = all.find((i) => i.id === id && i.userId === String(userId));
  if (!it) return null;
  if (it.status !== "pending") throw new Error("Można edytować tylko oczekujące");
  if (patch.runAt) {
    const d = new Date(patch.runAt);
    if (isNaN(d.getTime())) throw new Error("Nieprawidłowa data");
    it.runAt = d.toISOString();
  }
  for (const k of ["title", "description"]) if (typeof patch[k] === "string") it[k] = patch[k].slice(0, k === "title" ? 300 : 5000);
  if (Array.isArray(patch.platforms) && patch.platforms.length) it.platforms = patch.platforms;
  writeAll(all);
  return it;
}
/** pending → cancel(remove); done/failed → clear(remove) */
function remove(userId, id) {
  const all = readAll();
  const it = all.find((i) => i.id === id && i.userId === String(userId));
  if (!it || it.status === "running") return false;
  writeAll(all.filter((i) => i !== it));
  return true;
}
function setItem(id, patch) {
  const all = readAll();
  const it = all.find((i) => i.id === id);
  if (it) Object.assign(it, patch);
  writeAll(all);
}

/**
 * Process due items. resolveVideo(userId, videoSource) → { videoPath, thumbPath } (throws if missing).
 */
async function tick({ publish, resolveVideo }) {
  if (busy) return;
  busy = true;
  try {
    const now = Date.now();
    // recover items stuck "running" after a restart
    for (const i of readAll())
      if (i.status === "running" && now - Date.parse(i.startedAt || 0) > 3 * 3600e3)
        setItem(i.id, { status: "failed", results: [{ platform: "*", ok: false, error: "Przerwane (restart serwera)" }] });
    const due = readAll().filter((i) => i.status === "pending" && Date.parse(i.runAt) <= now);
    for (const it of due) {
      setItem(it.id, { status: "running", startedAt: new Date().toISOString() });
      try {
        const v = resolveVideo(it.userId, it.videoSource);
        const out = await publish({
          userId: it.userId,
          platforms: it.platforms,
          videoPath: v.videoPath,
          thumbPath: v.thumbPath || null,
          thumbUrl: it.thumbUrl,
          title: it.title,
          description: it.description,
        });
        const okAll = out.results.every((r) => r.ok);
        setItem(it.id, { status: okAll ? "done" : "failed", results: out.results, finishedAt: new Date().toISOString() });
      } catch (e) {
        setItem(it.id, {
          status: "failed",
          results: [{ platform: "*", ok: false, error: String(e.message || e) }],
          finishedAt: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.error("social-queue tick:", e.message);
  } finally {
    busy = false;
  }
}

module.exports = { list, create, update, remove, tick };
