import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { BASE_SCHEMA, DB } from "@/server/db";
import { MIGRATIONS, migrate } from "@/server/migrations";

/** A database exactly as the pre-sessions code left it: users(id, created_at) and no sessions table. */
function oldDb(): DB {
  const conn = new DB(new DatabaseSync(":memory:"));
  conn.exec(BASE_SCHEMA);
  return conn;
}
const cols = (conn: DB, t: string) => (conn.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

describe("schema migration", () => {
  it("upgrades an old database in place, keeping rows and flagging pre-existing identities", () => {
    const conn = oldDb();
    conn.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").run("old_user_aaaaaaaaaaaa", 1000);
    conn.prepare("INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES ('c1', 'old_user_aaaaaaaaaaaa', 'kept', 1, 1)").run();
    expect(cols(conn, "users")).toEqual(["id", "created_at"]);
    migrate(conn);
    expect(cols(conn, "users")).toEqual(expect.arrayContaining(["email", "email_verified_at", "display_name", "is_guest", "created_at", "last_seen_at", "legacy_anonymous"]));
    expect(cols(conn, "sessions")).toEqual(expect.arrayContaining(["id", "user_id", "created_at", "last_seen_at", "idle_expires_at", "absolute_expires_at", "ip", "user_agent", "revoked_at", "linked_guest_user_id"]));
    const u = conn.prepare("SELECT * FROM users WHERE id = 'old_user_aaaaaaaaaaaa'").get();
    expect(u).toMatchObject({ created_at: 1000, last_seen_at: 1000, is_guest: 1, legacy_anonymous: 1, email: null });
    expect(conn.prepare("SELECT title FROM conversations").get().title).toBe("kept");
  });

  it("is idempotent: running it again changes nothing, including on a half-migrated copy", () => {
    const conn = oldDb();
    conn.prepare("INSERT INTO users (id, created_at) VALUES ('u1', 5)").run();
    migrate(conn);
    conn.prepare("INSERT INTO users (id, created_at, is_guest, last_seen_at) VALUES ('new1', 9, 1, 9)").run(); // created after migration
    const snapshot = JSON.stringify(conn.prepare("SELECT * FROM users ORDER BY id").all());
    migrate(conn); migrate(conn);
    expect(JSON.stringify(conn.prepare("SELECT * FROM users ORDER BY id").all())).toBe(snapshot);
    expect(conn.prepare("SELECT legacy_anonymous AS l FROM users WHERE id = 'new1'").get().l).toBe(0); // only pre-existing rows are legacy
    expect(conn.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n).toBe(MIGRATIONS.length);
    // forget what was applied: the steps re-run safely against the already-migrated tables
    conn.exec("DELETE FROM schema_migrations");
    expect(() => migrate(conn)).not.toThrow();
    expect(JSON.stringify(conn.prepare("SELECT * FROM users ORDER BY id").all())).toBe(snapshot);
  });

  it("enforces one account per email, case-insensitively as stored, while allowing many guests", () => {
    const conn = oldDb(); migrate(conn);
    const ins = conn.prepare("INSERT INTO users (id, created_at, email, is_guest) VALUES (?, 1, ?, ?)");
    ins.run("g1", null, 1); ins.run("g2", null, 1); ins.run("a1", "ada@example.com", 0);
    expect(() => ins.run("a2", "ada@example.com", 0)).toThrow(/UNIQUE/);
  });
});
