/**
 * Validated design → preview HTML, HTML/CSS export, React export.
 * Component markup comes from one render tree (nodes.ts) serialised as escaped HTML or JSX.
 */
import { COMPONENTS } from "./components";
import { iconComponentJsx } from "./icons";
import * as layouts from "./layouts";
import { ConcreteCtx, SymbolicCtx, escapeHtml, toHtml, toJsx } from "./nodes";
import data from "./rendererData.json";
import { slugify, type Design, type Section } from "./schema";
import * as themes from "./themes";

export interface ExportFile { path: string; content: string }

const CSS_FORBIDDEN = ["url(", "expression(", "javascript", "@import", "</"];
const CSS_VALUE_RE = /^[A-Za-z0-9#.,()%\s"'\-/+*]+$/;
const COLUMN_COUNTS = [1, 2, 3, 4];

/** Defence in depth: refuse any token value that could end a declaration or pull in another resource. */
function cssValue(name: string, value: string): string {
  const lowered = value.toLowerCase();
  if (!CSS_VALUE_RE.test(value) || CSS_FORBIDDEN.some((b) => lowered.includes(b))) throw new Error(`Unsafe CSS value for ${name}`);
  return value;
}

export function buildTokens(design: Design): Record<string, string> {
  const { theme, typography: typo, layout, style } = design;
  for (const [key, value] of Object.entries(theme)) if (themes.normalizeHex(value) !== value) throw new Error(`Unsafe CSS value for theme.${key}`);
  const { background: bg, surface, primary, text } = theme;
  const hf = themes.FONTS[typo.heading], bf = themes.FONTS[typo.body];
  const space = layouts.SPACING[layout.spacing], radius = layouts.RADIUS[style.radius], scale = layouts.TYPE_SCALE[typo.scale];
  const muted = themes.ensureReadable(themes.mutedColor(text, bg), [bg, surface]);
  const tokens: Record<string, string> = {
    "--mf-bg": bg, "--mf-bg-glass": themes.rgba(bg, 0.82), "--mf-surface": surface, "--mf-primary": primary,
    "--mf-secondary": theme.secondary, "--mf-accent": theme.accent, "--mf-text": text, "--mf-muted": muted,
    "--mf-border": themes.mix(bg, text, 0.14), "--mf-border-strong": themes.mix(bg, text, 0.28), "--mf-tint": themes.mix(bg, primary, 0.14),
    "--mf-glow": themes.rgba(themes.glowSource(theme), themes.relativeLuminance(bg) > 0.5 ? 0.13 : 0.2),
    "--mf-on-primary": themes.onColor(primary),
    "--mf-font-heading": themes.fontStack(typo.heading), "--mf-font-body": themes.fontStack(typo.body),
    "--mf-heading-weight": String(hf.headingWeight),
    "--mf-radius": `${radius.card}px`, "--mf-radius-ctl": `${radius.control}px`,
    "--mf-shadow": layouts.shadowCss(style.shadow, primary),
    "--mf-max": layout.max_width, "--mf-section-y": `${space.section_y}rem`, "--mf-gap": `${space.gap}rem`,
    "--mf-base": `${scale.base}px`, "--mf-line": String(scale.line),
  };
  void bf;
  return Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, cssValue(k, v)]));
}

function gridCss(design: Design): [string, string, string] {
  const r = design.responsive;
  const rules = (limit?: number) => COLUMN_COUNTS.map((n) => `.mf-cols-${n}{grid-template-columns:repeat(${limit ? Math.min(n, limit) : n},minmax(0,1fr))}`).join("\n");
  return [rules(), rules(r.tablet_columns), rules(r.mobile_columns)];
}

export function renderCss(design: Design, allComponents = false): string {
  const used = new Set(design.sections.map((s) => s.type));
  const comps = Object.entries(COMPONENTS).filter(([k]) => allComponents || used.has(k)).map(([, c]) => c);
  const [grid, gridTablet, gridMobile] = gridCss(design);
  const root = ":root{" + Object.entries(buildTokens(design)).map(([k, v]) => `${k}:${v}`).join(";") + "}";
  const base = [root, data.BASE_CSS, grid, ...comps.map((c) => c.css.trim())];
  const tablet = [data.BASE_TABLET, gridTablet, ...comps.filter((c) => c.cssTablet).map((c) => c.cssTablet.trim())];
  const mobile = [data.BASE_MOBILE, gridMobile, ...comps.filter((c) => c.cssMobile).map((c) => c.cssMobile.trim())];
  return [...base, `@media (max-width:${layouts.TABLET_MAX}px){\n${tablet.join("\n")}\n}`, `@media (max-width:${layouts.MOBILE_MAX}px){\n${mobile.join("\n")}\n}`, data.REDUCED_MOTION].join("\n") + "\n";
}

export function renderBody(design: Design): string {
  const markup = (s: Section, indent: number) => toHtml(COMPONENTS[s.type].build(new ConcreteCtx(s)), indent);
  const head = design.sections.filter((s) => s.type === "navbar").map((s) => markup(s, 1));
  const main = design.sections.filter((s) => s.type !== "navbar" && s.type !== "footer").map((s) => markup(s, 2));
  const foot = design.sections.filter((s) => s.type === "footer").map((s) => markup(s, 1));
  return [`<div class="mf-page mf-nav-${design.responsive.mobile_nav}">`, ...head, "  <main>", ...main, "  </main>", ...foot, "</div>"].join("\n");
}

export function fontUrl(design: Design): string | null {
  return themes.googleFontsUrl([design.typography.heading, design.typography.body]);
}

function fontLinks(design: Design): string {
  const url = fontUrl(design);
  if (!url) return "";
  return `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${escapeHtml(url)}">\n`;
}

/** Deny everything by default; allow inline styles + data: images, and Google Fonts only if used. */
function previewCsp(design: Design): string {
  let styles = "'unsafe-inline'";
  let fonts = "";
  if (fontUrl(design)) { styles += " https://fonts.googleapis.com"; fonts = " font-src https://fonts.gstatic.com;"; }
  return `default-src 'none'; style-src ${styles};${fonts} img-src data:; base-uri 'none'; form-action 'none'`;
}

export function renderDocument(design: Design, o: { inlineCss?: boolean; preview?: boolean; cssHref?: string } = {}): string {
  const { inlineCss = true, preview = false, cssHref = "styles.css" } = o;
  const head = ['<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">'];
  if (preview) head.push(`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(previewCsp(design))}">`);
  head.push(`<title>${escapeHtml(design.name, false)}</title>`);
  const fonts = fontLinks(design).replace(/\n$/, "");
  if (fonts) head.push(fonts);
  head.push(inlineCss ? "<style>\n" + renderCss(design) + "</style>" : `<link rel="stylesheet" href="${escapeHtml(cssHref)}">`);
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n${head.join("\n")}\n</head>\n<body>\n${renderBody(design)}\n</body>\n</html>\n`;
}

/** Self-contained document for the sandboxed preview iframe. */
export const renderPreview = (design: Design) => renderDocument(design, { inlineCss: true, preview: true });

export function exportHtml(design: Design): ExportFile[] {
  return [
    { path: "index.html", content: renderDocument(design, { inlineCss: false }) },
    { path: "styles.css", content: renderCss(design) },
  ];
}

// ------------------------------------------------------------------ React

const componentName = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

function componentJsx(kind: string): string {
  const body = toJsx(COMPONENTS[kind].build(new SymbolicCtx("content")), 2);
  const imports = body.includes("<Icon") ? 'import Icon from "./Icon.jsx";\n\n' : "";
  return `${imports}export default function ${componentName(kind)}({ content }) {\n  return (\n${body}\n  );\n}\n`;
}

const jsJson = (v: unknown) => JSON.stringify(v, null, 2).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** Python-style str.format: {name} placeholders, {{ and }} escapes. */
function pyFormat(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (m, key?: string) => (m === "{{" ? "{" : m === "}}" ? "}" : vars[key!] ?? m));
}

export function exportReact(design: Design): ExportFile[] {
  const kinds = Object.keys(COMPONENTS);
  const imports = kinds.map((k) => `import ${componentName(k)} from "./components/${componentName(k)}.jsx";`).join("\n");
  const registry = kinds.map((k) => `  ${k}: ${componentName(k)},`).join("\n");
  const pkg = {
    name: `${slugify(design.name, "design")}-design`, private: true, version: "0.1.0", type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
    dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
    devDependencies: { "@vitejs/plugin-react": "^4.3.1", vite: "^5.4.0" },
  };
  const fonts = fontLinks(design).replace(/\n$/, "");
  const indexHtml =
    '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n' +
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    `    <title>${escapeHtml(design.name, false)}</title>\n` +
    (fonts ? fonts.split("\n").map((l) => `    ${l}\n`).join("") : "") +
    '  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n';
  const files: ExportFile[] = [
    { path: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" },
    { path: "vite.config.js", content: data._VITE_CONFIG },
    { path: "index.html", content: indexHtml },
    { path: "README.md", content: pyFormat(data._REACT_README, { name: design.name.replace(/\n/g, " ") }) },
    { path: "src/main.jsx", content: data._MAIN_JSX },
    { path: "src/App.jsx", content: pyFormat(data._APP_JSX, { imports, registry }) },
    { path: "src/design.js", content: `export const design = ${jsJson(design)};\n` },
    { path: "src/styles.css", content: renderCss(design, true) },
    { path: "src/components/Icon.jsx", content: iconComponentJsx() },
  ];
  for (const k of kinds) files.push({ path: `src/components/${componentName(k)}.jsx`, content: componentJsx(k) });
  return files;
}
