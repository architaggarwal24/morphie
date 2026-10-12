/** Who is making a request. Every data-access function takes one and scopes by `userId` internally. */
export interface Actor {
  userId: string;
  isGuest: boolean;
  /** SHA-256 of the session token (never the token itself). */
  sessionId: string;
}

export type AuthLevel = "public" | "guest" | "user";
