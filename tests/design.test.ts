import { describe, expect, it } from "vitest";
import { DesignAgent, DesignClarification, DesignGenerationError, applyOperations, extractJsonObject, wantsNewDesign } from "@/server/design/agent";
import { validateDesign } from "@/server/design/schema";
import * as svc from "@/server/design/service";
import { THEMES } from "@/server/design/themes";
import { touchUser } from "@/server/db";
import { COMPONENTS } from "@/server/design/components";
import { renderPreview, exportReact } from "@/server/design/renderer";
import { unzipSync } from "fflate";
import { Scripted } from "./helpers/scripted";

const t = THEMES["modern-saas"];
const base = () => ({
  name: "Acme", theme: { ...t.colors }, typography: { ...t.typography }, style: { ...t.style },
  sections: [COMPONENTS.hero.example, COMPONENTS.pricing.example, COMPONENTS.navbar.example, COMPONENTS.footer.example],
});
const reply = (o: unknown) => ({ content: JSON.stringify(o) });

describe("validation", () => {
  it("orders navbar/footer, assigns ids, resolves links, and is idempotent", () => {
    const notes: string[] = [];
    const d = validateDesign(base(), notes);
    expect(d.sections.map((s) => s.type)).toEqual(["navbar", "hero", "pricing", "footer"]);
    expect(d.sections.map((s) => s.id)).toEqual(["navbar", "hero", "pricing", "footer"]);
    expect((d.sections[0].links as any[]).find((l) => l.label === "Pricing").target).toBe("pricing");
    expect(d.sections[1].cta_target).toBe("pricing");
    expect(validateDesign(d)).toEqual(d);
    expect(notes.join()).toMatch(/moved the navbar/);
  });

  it("reports every problem at once and never lets unsafe values through", () => {
    const bad = base() as any;
    bad.theme.primary = "red; background:url(x)";
    bad.typography.heading = "Comic Sans";
    bad.sections[0].title = "x".repeat(500);
    bad.sections.push({ type: "script", src: "evil" });
    try { validateDesign(bad); throw new Error("should fail"); } catch (e: any) {
      expect(e.errors.length).toBeGreaterThanOrEqual(4);
      expect(e.errors.join("|")).toMatch(/theme\.primary/);
      expect(e.errors.join("|")).toMatch(/typography\.heading/);
      expect(e.errors.join("|")).toMatch(/too long/);
      expect(e.errors.join("|")).toMatch(/must be one of navbar/);
    }
  });

  it("escapes model text in HTML and JSX and repairs unreadable text colours", () => {
    const d = base() as any;
    d.sections[0].title = '</h1><script>alert(1)</script> "quotes" & <b>';
    d.theme.text = "#fafafa"; d.theme.background = "#ffffff"; d.theme.surface = "#f4f4f5";
    const notes: string[] = [];
    const v = validateDesign(d, notes);
    expect(notes.join()).toMatch(/theme\.text/);
    const html = renderPreview(v);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;/h1&gt;&lt;script&gt;");
    expect(html).toContain("default-src &#x27;none&#x27;");
    const react = exportReact(v);
    // design.js holds the text as a JSON string literal (data); no other export file may contain raw markup.
    expect(react.filter((f) => f.path !== "src/design.js").map((f) => f.content).join("\n")).not.toContain("<script>alert");
    expect(react.find((f) => f.path === "src/design.js")!.content).toContain('"title": "</h1><script>alert(1)</script>');
  });
});

describe("extractJsonObject", () => {
  it("finds JSON in fences and chatty text with stray braces", () => {
    expect(extractJsonObject('Sure {curly} ```json\n{"a": {"b": [1,2]}}\n``` bye }')).toEqual({ a: { b: [1, 2] } });
    expect(() => extractJsonObject("no json here")).toThrow(/did not contain/);
    expect(() => extractJsonObject("[".repeat(200) + "{".repeat(100))).toThrow();
    expect(() => extractJsonObject('{"a":' .repeat(30) + "1" + "}".repeat(30))).toThrow(/too deeply/);
  });
});

describe("operations", () => {
  it("applies edits without mutating the input and cleans dangling links on removal", () => {
    const d = validateDesign(base());
    const snapshot = JSON.stringify(d);
    const [w, errors] = applyOperations(d, [
      { op: "set_theme", values: { background: "#000000" } },
      { op: "remove_section", target: "pricing" },
      { op: "update_section", target: "hero", values: { size: "xl" } },
    ]);
    expect(errors).toEqual([]);
    expect(JSON.stringify(d)).toBe(snapshot);
    const v = validateDesign(w);
    expect(v.sections.map((s) => s.type)).toEqual(["navbar", "hero", "footer"]);
    expect(v.sections[1].size).toBe("xl");
    expect(v.sections[0].cta_target).toBeUndefined();
  });

  it("returns clear errors for bad operations", () => {
    const d = validateDesign(base());
    const [, errors] = applyOperations(d, [{ op: "explode" }, { op: "update_section", target: "hero", values: { type: "cta" } }, { op: "update_section", target: "nope", values: { size: "xl" } }, { op: "set_style", values: { color: "red" } }]);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/unknown operation/);
    expect(errors[3]).toMatch(/unknown style field/);
  });
});

describe("DesignAgent", () => {
  it("creates, then repairs a bad first reply using the full error list", async () => {
    const bad = base() as any; bad.theme.primary = "nope";
    const p = new Scripted([reply({ summary: "x", design: bad }), reply({ summary: "A SaaS site.", design: base() })]);
    const out = await new DesignAgent().respond("A landing page for a SaaS", null, p);
    expect(out.kind).toBe("create");
    expect(out.summary).toBe("A SaaS site.");
    expect(p.requests[1].messages.at(-1)!.content).toMatch(/theme\.primary/);
  });

  it("gives up after the repair budget with a friendly error and leaves current design alone", async () => {
    const cur = validateDesign(base());
    const p = new Scripted([{ content: "nope" }, { content: "still nope" }, { content: "no" }]);
    await expect(new DesignAgent().respond("make it pop", cur, p)).rejects.toThrow(/current design is unchanged/);
  });

  it("edits via operations, applies plain theme requests without calling the model, and asks when it must", async () => {
    const cur = validateDesign(base());
    const p = new Scripted([reply({ summary: "Darker.", operations: [{ op: "set_theme", values: { background: "#05070a", surface: "#0b0f14" } }] })]);
    const edited = await new DesignAgent().respond("make it darker", cur, p);
    expect(edited.design.theme.background).toBe("#05070a");
    expect(edited.design.sections).toHaveLength(4);

    const noModel = new Scripted([]);
    const themed = await new DesignAgent().respond("Use the Premium theme.", cur, noModel);
    expect(themed.kind).toBe("theme");
    expect(themed.design.theme.primary).toBe(THEMES.premium.colors.primary);
    expect(noModel.requests).toHaveLength(0);

    await expect(new DesignAgent().respond("Use the Premium theme", null, noModel)).rejects.toBeInstanceOf(DesignClarification);
    await expect(new DesignAgent().respond("start over", cur, noModel)).rejects.toBeInstanceOf(DesignClarification);
    expect(wantsNewDesign("rewrite the hero from scratch")).toBe(false);
    expect(wantsNewDesign("brand new site for a bakery")).toBe(true);
  });

  it("rejects a whole design returned for an edit", async () => {
    const cur = validateDesign(base());
    const p = new Scripted([reply({ design: base() }), reply({ operations: [] })]);
    const out = await new DesignAgent().respond("tweak", cur, p);
    expect(p.requests[1].messages.at(-1)!.content).toMatch(/whole design/);
    expect(out.kind).toBe("edit");
  });
});

describe("DesignService", () => {
  const user = "user_design_abcdefghijklm";
  touchUser(user);

  it("creates a project, edits, undoes, redoes, restores, exports and deletes", async () => {
    const p1 = new Scripted([reply({ summary: "Created.", design: base() })]);
    const a = await svc.handleMessage(user, null, "a saas landing page", p1);
    expect(a.changed).toBe(true);
    const id = a.state.id;
    expect(a.state.history).toMatchObject({ version: 1, total: 1, canUndo: false });

    const p2 = new Scripted([reply({ summary: "Bigger hero.", operations: [{ op: "update_section", target: "hero", values: { size: "xl" } }] })]);
    const b = await svc.handleMessage(user, id, "bigger hero", p2);
    expect(b.state.history).toMatchObject({ version: 2, total: 2, canUndo: true, canRedo: false });

    const noop = await svc.handleMessage(user, id, "bigger hero", new Scripted([reply({ operations: [{ op: "update_section", target: "hero", values: { size: "xl" } }] })]));
    expect(noop.changed).toBe(false);
    expect(noop.summary).toMatch(/didn't change anything/);

    expect((await svc.undo(user, id)).design.sections.find((s) => s.type === "hero")!.size).toBe("lg");
    await expect(svc.undo(user, id)).rejects.toThrow(/Nothing to undo/);
    expect((await svc.redo(user, id)).history.version).toBe(2);
    await svc.undo(user, id);
    // a new edit after undo ends the redo branch, and labels keep increasing
    const c = await svc.handleMessage(user, id, "premium", new Scripted([]));  // theme shortcut: no model call
    expect(c.kind).toBe("theme");
    expect(c.state.history).toMatchObject({ version: 3, total: 2, canRedo: false });
    expect((await svc.restoreVersion(user, id, 1)).history.version).toBe(1);

    const zip = svc.exportZip(user, id, "react");
    const files = Object.keys(unzipSync(zip.bytes));
    expect(files).toContain("acme-react/src/components/Hero.jsx");
    expect(svc.exportDesign(user, id, "html").files.map((f) => f.path)).toEqual(["index.html", "styles.css"]);
    expect(() => svc.exportDesign(user, id, "pdf")).toThrow(/Unknown export/);

    expect(svc.listDesigns(user)).toHaveLength(1);
    svc.deleteDesign(user, id);
    expect(svc.listDesigns(user)).toHaveLength(0);
    expect(() => svc.getDesign(user, id)).toThrow(/no longer exists/);
  });

  it("caps history at 20 versions", async () => {
    const a = await svc.handleMessage(user, null, "a saas landing page", new Scripted([reply({ design: base() })]));
    for (let i = 0; i < 24; i++) {
      await svc.handleMessage(user, a.state.id, `rename ${i}`, new Scripted([reply({ operations: [{ op: "set_name", value: `Acme ${i}` }] })]));
    }
    const s = svc.getDesign(user, a.state.id);
    expect(s.history.total).toBe(20);
    expect(s.history.version).toBe(25);
    expect(s.versions.at(-1)!.version).toBe(6);
  });

  it("isolates users", async () => {
    const other = "user_other_abcdefghijklmn";
    touchUser(other);
    const a = await svc.handleMessage(user, null, "a page", new Scripted([reply({ design: base() })]));
    expect(() => svc.getDesign(other, a.state.id)).toThrow(/no longer exists/);
    expect(svc.listDesigns(other)).toEqual([]);
  });

  it("surfaces a generation failure without touching state", async () => {
    await expect(svc.handleMessage(user, null, "a page", new Scripted([{ content: "x" }, { content: "x" }, { content: "x" }]))).rejects.toBeInstanceOf(DesignGenerationError);
  });
});
