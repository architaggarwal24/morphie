"use client";
import { Check, Copy } from "lucide-react";
import { Children, isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = Children.toArray(children).find(isValidElement) as React.ReactElement<{ className?: string; children?: ReactNode }> | undefined;
  const lang = /language-([\w-]+)/.exec(code?.props.className ?? "")?.[1] ?? "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(textOf(code?.props.children).replace(/\n$/, "")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="group my-4 overflow-hidden rounded-xl border border-line bg-sunken">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-faint">{lang || "text"}</span>
        <button onClick={copy} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-raised hover:text-fg" aria-label="Copy code">
          {copied ? <><Check className="size-3 text-ok" /> Copied</> : <><Copy className="size-3" /> Copy</>}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed">{children}</pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>,
          // Remote images are blocked by the CSP (they're a tracking/exfiltration channel), so show them as links.
          img: ({ src, alt }) => (typeof src === "string" ? <a href={src} target="_blank" rel="noopener noreferrer nofollow">{alt || "image"}</a> : null),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
