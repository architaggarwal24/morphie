import { randomId } from "@/server/crypto";
import { db } from "@/server/db";
import { startSession, type StartedSession } from "@/server/auth/session";
import type { Client } from "./client";

/** Create a signed-up (non-guest) user directly in the database. */
export function makeUser(email = `u-${randomId(4)}@example.com`): { userId: string; email: string } {
  const userId = randomId(18);
  const t = Date.now();
  db().prepare("INSERT INTO users (id, created_at, email, email_verified_at, display_name, is_guest, last_seen_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
    .run(userId, t, email.toLowerCase(), t, "Test User", t);
  return { userId, email: email.toLowerCase() };
}

/** Give a client a live session for a user (as a login would). */
export function signIn(client: Client, userId: string, isGuest = false): StartedSession {
  const s = startSession(userId, isGuest, { ip: "test" });
  client.jar.set(client.origin.startsWith("https") ? "__Host-morphie_session" : "morphie_session", s.token);
  return s;
}
