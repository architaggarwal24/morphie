/**
 * Security headers shared by next.config.mjs and the tests (plain JS so both can import it).
 * `production` is true for `next build` / `next start`; HSTS is never sent in development.
 */
export function pageHeaders({ production }) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), accelerometer=(), gyroscope=(), magnetometer=()",
    },
  ];
  if (production) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}

/** API responses are JSON, streams or downloads and never render as pages: lock them down completely. */
export function apiHeaders() {
  return [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }];
}

export function allHeaders({ production }) {
  return [
    { source: "/:path*", headers: pageHeaders({ production }) },
    { source: "/api/:path*", headers: apiHeaders() },
  ];
}
