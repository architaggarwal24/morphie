import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";

/** An actor for calling data-access functions directly in tests. Creates the users row if needed. */
export function testActor(userId: string, opts: { isGuest?: boolean } = {}): Actor {
  const isGuest = opts.isGuest ?? true;
  db().prepare("INSERT OR IGNORE INTO users (id, created_at, is_guest, last_seen_at) VALUES (?, ?, ?, ?)").run(userId, Date.now(), isGuest ? 1 : 0, Date.now());
  return { userId, isGuest, sessionId: `test-session-${userId}` };
}
