import type { DB } from "./db";

/**
 * Idempotent, ordered schema migrations. Each runs once inside a transaction and is recorded in schema_migrations.
 * Every step also checks what already exists, so re-running it (or running it on a half-migrated copy) is harmless.
 * The base tables are still created by SCHEMA in db.ts (CREATE TABLE IF NOT EXISTS); migrations only evolve them.
 */
interface Migration { id: string; up(conn: DB): void }

function hasColumn(conn: DB, table: string, column: string): boolean {
  return (conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);
}

function addColumn(conn: DB, table: string, column: string, ddl: string): boolean {
  if (hasColumn(conn, table, column)) return false;
  conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "001_users_and_sessions",
    up(conn) {
      const firstRun = !hasColumn(conn, "users", "is_guest");
      addColumn(conn, "users", "email", "TEXT");
      addColumn(conn, "users", "email_verified_at", "INTEGER");
      addColumn(conn, "users", "display_name", "TEXT");
      addColumn(conn, "users", "is_guest", "INTEGER NOT NULL DEFAULT 1");
      addColumn(conn, "users", "last_seen_at", "INTEGER");
      addColumn(conn, "users", "legacy_anonymous", "INTEGER NOT NULL DEFAULT 0");
      if (firstRun) {
        // Every identity that existed before sessions did was an anonymous browser with long-lived data.
        // They stay guests, but are flagged so a future guest sweeper never deletes their data behind their back.
        conn.exec("UPDATE users SET legacy_anonymous = 1, last_seen_at = created_at");
      }
      conn.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,                 -- SHA-256 (hex) of the cookie token; the token itself is never stored
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          idle_expires_at INTEGER NOT NULL,
          absolute_expires_at INTEGER NOT NULL,
          ip TEXT,
          user_agent TEXT,
          revoked_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(absolute_expires_at);
      `);
    },
  },
  {
    id: "002_login_methods",
    up(conn) {
      addColumn(conn, "sessions", "linked_guest_user_id", "TEXT");
      conn.exec(`
        CREATE TABLE IF NOT EXISTS user_identities (
          provider TEXT NOT NULL,              -- google | github
          provider_user_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          email TEXT NOT NULL,                 -- the verified email at link time
          created_at INTEGER NOT NULL,
          PRIMARY KEY (provider, provider_user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);

        CREATE TABLE IF NOT EXISTS email_codes (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,             -- HMAC of the code; the code is never stored
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at INTEGER,
          ip TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_codes_email ON email_codes(email, created_at DESC);

        CREATE TABLE IF NOT EXISTS oauth_states (
          state_hash TEXT PRIMARY KEY,         -- SHA-256 of the state value held in the browser cookie
          provider TEXT NOT NULL,
          verifier_enc TEXT NOT NULL,          -- PKCE code verifier, encrypted
          return_to TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at INTEGER
        );
      `);
    },
  },
];

export function migrate(conn: DB): void {
  conn.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  for (const m of MIGRATIONS) {
    if (conn.prepare("SELECT 1 AS x FROM schema_migrations WHERE id = ?").get(m.id)) continue;
    conn.transaction(() => {
      m.up(conn);
      conn.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(m.id, Date.now());
    })();
  }
}
