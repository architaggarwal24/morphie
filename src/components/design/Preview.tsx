"use client";
import { useEffect, useRef, useState } from "react";
import { DEVICE_WIDTHS, type Device } from "@/lib/designStore";

/**
 * Renders a design inside a fully sandboxed iframe (no scripts, no same-origin, no forms, no top navigation),
 * scaled to fit its container so a 1280px desktop layout is readable on a laptop panel.
 */
export function Preview({ html, device, busy }: { html: string; device: Device; busy?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = DEVICE_WIDTHS[device];
  const pad = 24;
  const scale = box.w ? Math.min(1, (box.w - pad) / width) : 1;
  const height = box.h ? (box.h - pad) / scale : 600;
  return (
    <div ref={wrap} className="surface-grain relative flex-1 overflow-hidden bg-sunken">
      <div className="absolute inset-0 grid place-items-start justify-center p-3">
        <div className="overflow-hidden rounded-xl border border-line bg-white shadow-pop transition-all duration-300" style={{ width: width * scale, height: height * scale }}>
          <iframe
            title="Design preview" srcDoc={html} sandbox="" referrerPolicy="no-referrer"
            style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left", border: 0, display: "block", background: "#fff" }}
          />
        </div>
      </div>
      {busy && <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden"><div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-accent to-transparent bg-[length:200%_100%]" /></div>}
    </div>
  );
}
