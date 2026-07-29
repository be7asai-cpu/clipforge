/**
 * Postgres pool (Neon / Supabase / any Postgres).
 * Enabled when DATABASE_URL or POSTGRES_URL is set.
 */
const { Pool } = require("pg");

let pool = null;

function databaseUrl() {
  return (
    String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim() ||
    null
  );
}

function usingPostgres() {
  return Boolean(databaseUrl());
}

function getPool() {
  if (!usingPostgres()) return null;
  if (pool) return pool;
  const connectionString = databaseUrl();
  // Neon / Supabase require SSL in production
  const ssl =
    process.env.DATABASE_SSL === "0" || process.env.DATABASE_SSL === "false"
      ? false
      : { rejectUnauthorized: false };
  pool = new Pool({
    connectionString,
    ssl,
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on("error", (err) => {
    console.error("[db] pool error:", err.message);
  });
  return pool;
}

async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL not configured");
  return p.query(text, params);
}

async function initDb() {
  if (!usingPostgres()) {
    console.log("[db] no DATABASE_URL — using file store for auth");
    return { ok: true, mode: "file" };
  }
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS clipforge_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      avatar TEXT,
      password_hash TEXT,
      providers JSONB NOT NULL DEFAULT '[]'::jsonb,
      provider_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
      email_verified BOOLEAN,
      activation_token TEXT,
      activation_expires TIMESTAMPTZ,
      reset_token TEXT,
      reset_expires TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_clipforge_users_email
      ON clipforge_users (lower(email));
    CREATE INDEX IF NOT EXISTS idx_clipforge_users_activation
      ON clipforge_users (activation_token)
      WHERE activation_token IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_clipforge_users_reset
      ON clipforge_users (reset_token)
      WHERE reset_token IS NOT NULL;

    CREATE TABLE IF NOT EXISTS clipforge_sessions (
      sid TEXT PRIMARY KEY,
      sess JSONB NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clipforge_sessions_expire
      ON clipforge_sessions (expire);
  `);
  console.log("[db] Postgres ready (Neon/Supabase) — users + sessions tables OK");
  return { ok: true, mode: "postgres" };
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  databaseUrl,
  usingPostgres,
  getPool,
  query,
  initDb,
  closeDb,
};
