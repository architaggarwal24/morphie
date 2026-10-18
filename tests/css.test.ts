import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The stylesheet is part of the app's behaviour: Tailwind 4 changed several defaults that the UI silently relied on,
 * and the fixes live in src/app/globals.css. These tests compile that file exactly as Next does and check the fixes
 * are still there, so a tidy-up or an upgrade can't quietly shift layouts.
 */
let css = "";
beforeAll(async () => {
  const file = path.resolve("src/app/globals.css");
  css = (await postcss([tailwind()]).process(fs.readFileSync(file, "utf8"), { from: file })).css;
}, 60_000);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else if (/\.tsx$/.test(e.name)) out.push(f);
  }
  return out;
};
const components = walk("src/components");

describe("space-y-* keeps its Tailwind 3 behaviour", () => {
  it("is margin-top on every later sibling, with enough specificity to beat a child's own margin", () => {
    expect(css).toMatch(/\.space-y-3 > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{\s*margin-top: calc\(var\(--spacing\) \* 3\);\s*margin-bottom: 0;/);
  });

  it("every size the components use exists", () => {
    const used = new Set(components.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/\bspace-y-([\d.]+)/g)].map((m) => m[1])));
    expect(used.size).toBeGreaterThan(5);
    for (const n of used) expect(css, `space-y-${n}`).toContain(`.space-y-${n.replace(".", "\\.")} > :not([hidden]) ~ :not([hidden])`);
  });

  it("cancels Tailwind 4's own rule for the first child, and comes after it so it wins", () => {
    const builtIn = css.indexOf(":where(.space-y-3 > :not(:last-child))");
    const cancel = css.indexOf(':where([class*="space-y-"] > :first-child:not(:last-child))');
    expect(builtIn, "Tailwind's built-in space-y rule moved or was removed: re-check the compat block in globals.css").toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(builtIn);
  });
});

describe("base defaults keep the look the app had on Tailwind 3", () => {
  it("text sizes carry absolute line-heights, so nested smaller text keeps its line height", () => {
    // Tailwind only emits the sizes the components use, so check exactly those against Tailwind 3's values.
    const v3 = { xs: "1rem", sm: "1.25rem", base: "1.5rem", lg: "1.75rem", xl: "1.75rem", "2xl": "2rem", "3xl": "2.25rem", "4xl": "2.5rem" } as Record<string, string>;
    const used = new Set(components.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl)\b/g)].map((m) => m[1])));
    expect(used.size).toBeGreaterThan(4);
    for (const name of used) expect(css, `--text-${name}--line-height`).toContain(`--text-${name}--line-height: ${v3[name]};`);
  });

  it("buttons show the pointer cursor, borders default to grey, placeholders to grey-400", () => {
    expect(css).toMatch(/button:not\(:disabled\), \[role="button"\]:not\(:disabled\) \{\s*cursor: pointer;/);
    expect(css).toMatch(/border-color: var\(--color-gray-200, currentcolor\);/);
    expect(css).toMatch(/input::placeholder, textarea::placeholder \{\s*color: var\(--color-gray-400\);/);
  });

  it("the design tokens that used to live in tailwind.config.ts are all present", () => {
    for (const c of ["bg", "panel", "raised", "sunken", "line", "fg", "muted", "faint", "accent", "accent-fg", "ok", "warn", "err", "info"]) {
      expect(css, `colour ${c}`).toMatch(new RegExp(`\\.(?:bg|text|border)-${c}\\b`));
    }
    expect(css).toContain("--radius-xl: 14px");
    expect(css).toContain("--radius-2xl: 20px");
    expect(css).toMatch(/\.shadow-pop \{\s*--tw-shadow: 0 12px 40px -12px var\(--tw-shadow-color, rgb\(0 0 0 \/ 0\.35\)\), 0 0 0 1px var\(--tw-shadow-color, rgb\(var\(--line\)\)\);/);
    expect(css).toContain("@keyframes rise");
    expect(css).toMatch(/\.animate-rise \{\s*animation: var\(--animate-rise\)/);
    expect(fs.existsSync("tailwind.config.ts")).toBe(false);
  });
});

describe("renamed utilities mean what the old names meant", () => {
  const rule = (sel: string) => new RegExp(`${sel.replace(/[.\\/]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  it("shadow-xs is Tailwind 3's shadow-sm, shadow-sm is Tailwind 3's shadow", () => {
    expect(rule(".shadow-xs")).toContain("0 1px 2px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.05))");
    expect(rule(".shadow-sm")).toContain("0 1px 3px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 1px 2px -1px var(--tw-shadow-color, rgb(0 0 0 / 0.1))");
  });
  it("backdrop-blur-sm is 8px, as backdrop-blur was", () => {
    expect(css).toContain("--blur-sm: 8px;");
    expect(rule(".backdrop-blur-sm")).toContain("--tw-backdrop-blur: blur(var(--blur-sm))");
  });
  it("gradients still interpolate in sRGB, as they did in Tailwind 3", () => {
    expect(rule(".bg-linear-to-r\\/srgb")).toContain("to right in srgb");
  });
  it("components use none of the old names", () => {
    const src = components.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/outline-none|bg-gradient-to-/);
  });
});

describe("a caller's override can never lose to a component's default", () => {
  // Input/Select/Textarea apply their defaults (h-10, text-sm) and then the caller's className, with no class merging. Which of
  // two conflicting utilities wins is then decided by stylesheet order, which differs between Tailwind versions. So callers
  // that change the height must say so with an important modifier, and must not pass a size the default already beats.
  const calls = components.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, i: i + 1, line })))
    .filter(({ line }) => /<(Input|Select|Textarea)\b/.test(line) && /className="/.test(line));
  it("finds the call sites", () => expect(calls.length).toBeGreaterThan(10));
  it("a height override is important (h-9!)", () => {
    for (const { f, i, line } of calls) for (const m of line.matchAll(/className="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (/^h-\d/.test(t)) expect(t, `${f}:${i}`).toMatch(/!$/);
  });
  it("nobody passes a text size that the default would silently beat", () => {
    for (const { f, i, line } of calls) expect(line, `${f}:${i}`).not.toMatch(/className="[^"]*\btext-\[\d+px\]/);
  });
});
