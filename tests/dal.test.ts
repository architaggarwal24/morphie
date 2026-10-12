import { describe, expect, it } from "vitest";
import { COMPONENTS } from "@/server/design/components";
import { THEMES } from "@/server/design/themes";
import { addMessage, createConversation, deleteConversation, deleteMessagesFrom, getMessages, setTitle, updateMessageMeta, listConversations } from "@/server/conversations";
import { NotFoundError } from "@/server/data/errors";
import * as designStore from "@/server/data/designs";
import * as svc from "@/server/design/service";
import { db } from "@/server/db";
import { testActor } from "./helpers/actor";
import { Scripted } from "./helpers/scripted";

const A = testActor("dal_user_a_000000001"), B = testActor("dal_user_b_000000001");
const t = THEMES["modern-saas"];
const doc = () => ({ name: "Acme", theme: { ...t.colors }, typography: { ...t.typography }, style: { ...t.style }, sections: [COMPONENTS.hero.example, COMPONENTS.navbar.example, COMPONENTS.footer.example] });

describe("messages are reachable only through their owner's conversation", () => {
  it("another user cannot add, read, edit, truncate, retitle or delete", () => {
    const conv = createConversation(A, "chat", "A's chat");
    const m1 = addMessage(A, conv.id, "user", "hello");
    const m2 = addMessage(A, conv.id, "assistant", "hi", { timeline: [] } as never);
    expect(() => addMessage(B, conv.id, "user", "injected")).toThrow(NotFoundError);
    expect(getMessages(B, conv.id)).toEqual([]);
    expect(() => updateMessageMeta(B, conv.id, m2, { timeline: ["x"] } as never)).toThrow(NotFoundError);
    // a message id alone proves nothing: using B's own conversation id with A's message id still touches nothing
    const mine = createConversation(B, "chat");
    expect(() => updateMessageMeta(B, mine.id, m2, { timeline: ["x"] } as never)).toThrow(NotFoundError);
    deleteMessagesFrom(B, conv.id, m1);
    deleteMessagesFrom(B, mine.id, m1);
    setTitle(B, conv.id, "pwned");
    expect(() => deleteConversation(B, conv.id)).toThrow(NotFoundError);
    expect(getMessages(A, conv.id).map((m) => m.content)).toEqual(["hello", "hi"]);
    expect(getMessages(A, conv.id)[1].meta).toEqual({ timeline: [] });
    expect(listConversations(A).find((c) => c.id === conv.id)?.title).toBe("A's chat");
  });

  it("a failed insert leaves no orphan message behind", () => {
    const before = db().prepare("SELECT COUNT(*) AS n FROM messages").get().n;
    expect(() => addMessage(B, "no-such-conversation", "user", "x")).toThrow(NotFoundError);
    expect(db().prepare("SELECT COUNT(*) AS n FROM messages").get().n).toBe(before);
  });
});

describe("design versions are reachable only through their owner's design", () => {
  it("another user cannot read, push, move the cursor or delete", async () => {
    const out = await svc.handleMessage(A, null, "page", new Scripted([{ content: JSON.stringify(doc()) }]) as never);
    const id = out.state.id;
    const row = designStore.getDesignRow(A, id)!;
    expect(designStore.getDesignRow(B, id)).toBeUndefined();
    expect(designStore.loadVersionRows(B, id)).toEqual([]);
    expect(() => designStore.pushVersion(B, row, { json: "{}", prompt: "", summary: "", name: "pwn", keepUpTo: 0, historyLimit: 20, now: 1 })).toThrow(NotFoundError);
    expect(() => designStore.setCursor(B, id, 99, 1)).toThrow(NotFoundError);
    expect(() => designStore.deleteDesign(B, id)).toThrow(NotFoundError);
    // the failed push inside a transaction rolled back completely: no stray version, A's history unchanged
    expect(designStore.loadVersionRows(A, id)).toHaveLength(1);
    expect(designStore.getDesignRow(A, id)).toMatchObject({ name: "Acme", cursor: row.cursor, revision: row.revision });
    expect(svc.getDesign(A, id).design.name).toBe("Acme");
    expect(() => svc.getDesign(B, id)).toThrow(/no longer exists/);
  });
});
