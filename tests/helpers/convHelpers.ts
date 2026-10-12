import { addMessage, createConversation } from "@/server/conversations";
import type { Actor } from "@/server/auth/actor";

export { createConversation };
export function addMessageForTest(a: Actor, conversationId: string): void {
  addMessage(a, conversationId, "user", "my private question");
  addMessage(a, conversationId, "assistant", "my private answer");
}
