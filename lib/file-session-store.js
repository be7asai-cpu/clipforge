/**
 * Simple file-backed session store for express-session.
 * Survives process restarts on the same disk (better than MemoryStore on Render).
 */
const fs = require("fs");
const path = require("path");
const session = require("express-session");

class FileSessionStore extends session.Store {
  /**
   * @param {{ dir?: string, ttlMs?: number }} [opts]
   */
  constructor(opts = {}) {
    super();
    this.dir = opts.dir || path.join(__dirname, "..", "data", "auth", "sessions");
    this.ttlMs = opts.ttlMs || 14 * 24 * 60 * 60 * 1000;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(sid) {
    const safe = String(sid || "").replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.dir, safe + ".json");
  }

  get(sid, cb) {
    try {
      const f = this._file(sid);
      if (!fs.existsSync(f)) return cb(null, null);
      const raw = JSON.parse(fs.readFileSync(f, "utf8"));
      if (!raw || !raw.session) return cb(null, null);
      if (raw.expires && Date.now() > raw.expires) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* ignore */
        }
        return cb(null, null);
      }
      return cb(null, raw.session);
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge =
        sess && sess.cookie && typeof sess.cookie.maxAge === "number"
          ? sess.cookie.maxAge
          : this.ttlMs;
      const expires = Date.now() + (maxAge > 0 ? maxAge : this.ttlMs);
      const f = this._file(sid);
      const tmp = f + ".tmp";
      fs.writeFileSync(
        tmp,
        JSON.stringify({ expires, session: sess }, null, 0) + "\n",
        "utf8"
      );
      fs.renameSync(tmp, f);
      return cb && cb(null);
    } catch (err) {
      return cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      const f = this._file(sid);
      if (fs.existsSync(f)) fs.unlinkSync(f);
      return cb && cb(null);
    } catch (err) {
      return cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = { FileSessionStore };
