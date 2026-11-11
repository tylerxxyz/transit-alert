// Strict CORS allowlist. Reflecting any Origin together with
// Allow-Credentials let every website read a logged-in user's session, so
// only known frontends get CORS headers; everyone else gets none and the
// browser blocks the cross-origin read.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://transit-alert.com",
  "https://www.transit-alert.com",
  "https://tylerbnobleday-cmyk.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3200",
  "http://127.0.0.1:3200",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function normaliseOrigin(value) {
  try {
    return new URL(String(value).trim()).origin;
  } catch {
    return "";
  }
}

const ALLOWED_ORIGINS = new Set(
  [...DEFAULT_ALLOWED_ORIGINS, ...String(process.env.ALLOWED_ORIGINS || "").split(",")]
    .map(normaliseOrigin)
    .filter((origin) => origin && origin !== "null"),
);

export function isAllowedOrigin(origin) {
  return Boolean(origin) && ALLOWED_ORIGINS.has(normaliseOrigin(origin));
}

// The canonical public URL, used for links in emails. Never derived from
// request headers, which an attacker controls.
export function getPublicAppUrl() {
  const configured = normaliseOrigin(process.env.PUBLIC_APP_URL || "");
  return configured || "https://transit-alert.com";
}

export function applyCorsHeaders(req, res, methods = "GET,POST,PUT,PATCH,DELETE,OPTIONS") {
  res.setHeader("Vary", "Origin");
  const origin = req.headers?.origin;
  if (!isAllowedOrigin(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", normaliseOrigin(origin));
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  return true;
}

// Blocks cross-site form posts (CSRF): a state-changing request that carries
// an Origin header must come from an allowed frontend. Requests without an
// Origin (curl, same-origin GETs from old browsers) are let through; browsers
// always send Origin on cross-site POSTs.
export function isCrossSiteWriteBlocked(req) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const origin = req.headers?.origin;
  if (!origin) return false;
  if (isAllowedOrigin(origin)) return false;
  // Same-origin requests to whatever host this server answers on.
  const host = req.headers?.host;
  return !(host && normaliseOrigin(origin).replace(/^https?:\/\//, "") === host);
}
