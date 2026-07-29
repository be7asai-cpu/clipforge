/**
 * express-session store backed by Postgres (clipforge_sessions).
 */
const session = require("express-session");
const db = require("./db");

class PgSessionStore extends session.Store {
  constructor(opts = {}) {
    super();
    this.ttlMs = opts.ttlMs || 30 * 24 * 60 * 60 * 1000;
  }

  get(sid, cb) {
    db.query(
      `SELECT sess, expire FROM clipforge_sessions
       WHERE sid = $1 AND expire > NOW() LIMIT 1`,
      [String(sid)]
    )
      .then((r) => {
        if (!r.rows[0]) return cb(null, null);
        return cb(null, r.rows[0].sess);
      })
      .catch(cb);
  }

  set(sid, sess, cb) {
    const maxAge =
      sess && sess.cookie && typeof sess.cookie.maxAge === "number"
        ? sess.cookie.maxAge
        : this.ttlMs;
    const expire = new Date(Date.now() + (maxAge > 0 ? maxAge : this.ttlMs));
    db.query(
      `INSERT INTO clipforge_sessions (sid, sess, expire)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [String(sid), JSON.stringify(sess), expire.toISOString()]
    )
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  destroy(sid, cb) {
    db.query(`DELETE FROM clipforge_sessions WHERE sid = $1`, [String(sid)])
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }

  /** Optional cleanup of expired rows */
  clearExpired() {
    return db
      .query(`DELETE FROM clipforge_sessions WHERE expire <= NOW()`)
      .catch((err) => console.error("[pg-session] cleanup:", err.message));
  }
}

module.exports = { PgSessionStore };
