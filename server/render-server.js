import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import adminHandler from "../api/admin/[resource].js";
import authHandler from "../api/auth/[action].js";
import consistHandler from "../api/consist/[consist].js";
import fleetTypeHandler from "../api/fleet-type/[fleetType].js";
import metroNotifyAlertsHandler from "../api/metro-notify/alerts.js";
import preferencesHandler from "../api/preferences/[[...slug]].js";
import pushHandler from "../api/push/[action].js";
import { checkAndPushNewAlerts, isPushConfigured } from "../api/_lib/push.js";
import { recordFleetSightings } from "../api/_lib/fleet-tracking.js";
import { ensureLiveTrainsFresh } from "../api/ptv/live-trains.js";
import liveBusesHandler from "../api/ptv/live-buses.js";
import sydneyTransitHandler from "../api/ptv/sydney-transit.js";
import liveTrainsHandler from "../api/ptv/live-trains.js";
import liveTramsHandler from "../api/ptv/live-trams.js";
import timetableHandler from "../api/ptv/timetable.js";
import journeyPlanHandler from "../api/journey/plan.js";
import { warmJourneyGraph } from "../api/_lib/journey-graph.js";
import ptvV3StatusHandler from "../api/ptv/v3-status.js";
import { isPtvV3Configured } from "../api/_lib/ptv-v3.js";
import reportsHandler from "../api/reports/[[...slug]].js";
import telegramStatusHandler from "../api/telegram/status.js";
import { ensureDatabaseReady, isDatabaseConfigured, pglite, pool } from "../src/lib/db/src/index.js";
import { applyCorsHeaders, isCrossSiteWriteBlocked } from "../api/_lib/cors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "../dist");
const INDEX_FILE = path.join(DIST_DIR, "index.html");
const PORT = Number(process.env.PORT || 3000);
const GTFS_PATH = process.env.GTFS_SCHEDULE_PATH || path.resolve(__dirname, "../.local-host/gtfs.zip");
const GHOST_TABLES = new Set(["app_users", "user_preferences", "app_config", "marker_overrides", "reports", "chat_messages", "telegram_subscribers", "tracked_consists"]);
const GHOST_HIDDEN_COLUMNS = new Set(["password_hash"]);
async function ghostDbQuery(text, params = []) { return pglite ? pglite.query(text, params) : pool ? pool.query(text, params) : { rows: [] }; }
async function readLimitedJson(req, limit = 64 * 1024) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > limit) throw new Error("Request body too large."); }
  return JSON.parse(raw || "{}");
}
async function ghostDatabaseHandler(req, res, urlObject) {
  if (!urlObject.pathname.startsWith("/api/ghost-db/")) return false;
  // A loopback socket address proves nothing here: the Cloudflare tunnel
  // connects from 127.0.0.1, so every public request looked "local". The
  // ghost DB API is off unless GHOST_DB_TOKEN is set, needs that token, and
  // refuses anything that came through a proxy.
  const remote = req.socket.remoteAddress || "";
  const proxied = ["cf-connecting-ip", "cf-ray", "x-forwarded-for", "x-real-ip", "forwarded"].some((name) => req.headers[name]);
  const expected = process.env.GHOST_DB_TOKEN || "";
  const supplied = Buffer.from(String(req.headers["x-ghost-db-token"] || ""));
  const expectedBytes = Buffer.from(expected);
  const tokenOk = expected.length >= 16 && supplied.length === expectedBytes.length && crypto.timingSafeEqual(supplied, expectedBytes);
  if (proxied || !tokenOk || !/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(remote)) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Forbidden" })); return true; }
  if (req.method === "GET" && urlObject.pathname === "/api/ghost-db/tables") {
    const result = await ghostDbQuery("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const tables = result.rows.filter(row => GHOST_TABLES.has(row.table_name));
    for (const table of tables) { const count = await ghostDbQuery(`SELECT count(*)::int AS count FROM "${table.table_name}"`); table.count = Number(count.rows[0]?.count || 0); }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ name: "TransitAlert", tables })); return true;
  }
  if (req.method === "POST" && urlObject.pathname === "/api/ghost-db/reset-password") {
    const data = await readLimitedJson(req);
    const password = String(data.password || ""); if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    const salt = crypto.randomBytes(16).toString("hex"), derived = crypto.scryptSync(password, salt, 64).toString("hex");
    await ghostDbQuery("UPDATE app_users SET password_hash=$1, must_change_password=$2, updated_at=now() WHERE id=$3", [`${salt}:${derived}`, Boolean(data.mustChange), String(data.id || "")]);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); return true;
  }
  const match = urlObject.pathname.match(/^\/api\/ghost-db\/table\/([a-z_]+)$/);
  if (!match || !GHOST_TABLES.has(match[1])) return false;
  const table = match[1], columnsResult = await ghostDbQuery("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table]);
  const columns = columnsResult.rows.filter(column => !GHOST_HIDDEN_COLUMNS.has(column.column_name));
  if (req.method === "GET") {
    const keysResult = await ghostDbQuery("SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary", [table]);
    const primaryKeys = new Set(keysResult.rows.map(row => row.name)); columns.forEach(column => column.primaryKey = primaryKeys.has(column.column_name));
    const selected = columns.map(column => `"${column.column_name}"`).join(",");
    const rows = await ghostDbQuery(`SELECT ${selected} FROM "${table}" LIMIT 200`);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ table, columns, rows: rows.rows })); return true;
  }
  if (req.method === "PATCH") {
    const data = await readLimitedJson(req);
    const column = columns.find(item => item.column_name === data.column); if (!column) throw new Error("Column cannot be edited.");
    const keysResult = await ghostDbQuery("SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary", [table]);
    const key = keysResult.rows[0]?.name; if (!key || data.key === undefined) throw new Error("This table has no editable primary key.");
    const keyColumn = columns.find(item => item.column_name === key); if (!keyColumn) throw new Error("Primary key is unavailable.");
    let value = data.value; if (/json/.test(column.data_type) && typeof value === "string") value = JSON.parse(value); else if (/boolean/.test(column.data_type)) value = value === true || value === "true"; else if (/integer|numeric|double|real/.test(column.data_type)) value = Number(value);
    await ghostDbQuery(`UPDATE "${table}" SET "${column.column_name}"=$1${columns.some(x=>x.column_name==='updated_at') && column.column_name!=='updated_at' ? ', updated_at=now()' : ''} WHERE "${key}"=$2`, [value, data.key]);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); return true;
  }
  return false;
}

function healthHandler(_req, res) {
  res.status(200).json({ ok: true, service: "TransitAlert API", time: new Date().toISOString() });
}

function feedStatusHandler(_req, res) {
  const gtfsInstalled = existsSync(GTFS_PATH);
  const gtfsStats = gtfsInstalled ? statSync(GTFS_PATH) : null;
  const hasPtvRealtimeKey = Boolean(
    process.env.PTV_SUBSCRIPTION_KEY ||
    process.env.PTV_subscription_key ||
    process.env.OCP_APIM_SUBSCRIPTION_KEY ||
    process.env.PTV_API_KEY,
  );

  res.status(200).json({
    api: { online: true },
    ptvTimetableV3: {
      configured: isPtvV3Configured(),
      status: isPtvV3Configured() ? "configured" : "key-required",
    },
    gtfsSchedule: {
      installed: gtfsInstalled,
      bytes: gtfsStats?.size ?? 0,
      updatedAt: gtfsStats?.mtime?.toISOString() ?? null,
      source: "Transport Victoria GTFS Schedule",
    },
    gtfsRealtime: {
      configured: hasPtvRealtimeKey,
      status: hasPtvRealtimeKey ? "configured" : "key-required",
      message: hasPtvRealtimeKey
        ? "Transport Victoria GTFS-Realtime is configured."
        : "Add a Transport Victoria KeyID to enable live vehicle positions.",
    },
  });
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function createResponseShim(res) {
  return {
    statusCode: 200,
    headers: { ...res.getHeaders() },
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      res.setHeader(name, value);
      return this;
    },
    json(payload) {
      if (!this.headers["Content-Type"] && !this.headers["content-type"]) {
        this.headers["Content-Type"] = "application/json; charset=utf-8";
      }
      this.send(JSON.stringify(payload));
      return this;
    },
    send(payload) {
      const body =
        typeof payload === "string" || Buffer.isBuffer(payload)
          ? payload
          : JSON.stringify(payload);
      res.writeHead(this.statusCode, { ...res.getHeaders(), ...this.headers });
      res.end(body);
      return this;
    },
  };
}

function getApiResolution(urlObject) {
  const segments = urlObject.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (segments[0] !== "api") {
    return null;
  }

  const group = segments[1] || "";
  const remainder = segments.slice(2);
  const query = Object.fromEntries(urlObject.searchParams.entries());

  switch (group) {
    case "healthz":
      return { handler: healthHandler, query };
    case "feed-status":
      return { handler: feedStatusHandler, query };
    case "auth":
      return { handler: authHandler, query: { ...query, action: remainder[0] || "" } };
    case "preferences":
      return { handler: preferencesHandler, query: { ...query, slug: remainder } };
    case "push":
      return { handler: pushHandler, query: { ...query, action: remainder[0] || "" } };
    case "reports":
      return { handler: reportsHandler, query: { ...query, slug: remainder } };
    case "admin":
      return { handler: adminHandler, query: { ...query, resource: remainder[0] || "" } };
    case "consist":
      return { handler: consistHandler, query: { ...query, consist: remainder[0] || "" } };
    case "fleet-type":
      return { handler: fleetTypeHandler, query: { ...query, fleetType: remainder[0] || "" } };
    case "metro-notify":
      return remainder[0] === "alerts" ? { handler: metroNotifyAlertsHandler, query } : null;
    case "ptv":
      if (remainder[0] === "live-buses") return { handler: liveBusesHandler, query };
      if (remainder[0] === "live-trains") return { handler: liveTrainsHandler, query };
      if (remainder[0] === "v3-status") return { handler: ptvV3StatusHandler, query };
      if (remainder[0] === "live-trams") return { handler: liveTramsHandler, query };
      if (remainder[0] === "timetable") return { handler: timetableHandler, query };
      if (remainder[0] === "sydney-transit") return { handler: sydneyTransitHandler, query };
      return null;
    case "telegram":
      return remainder[0] === "status" ? { handler: telegramStatusHandler, query } : null;
    case "journey":
      return remainder[0] === "plan" ? { handler: journeyPlanHandler, query } : null;
    default:
      return null;
  }
}

function getStaticPath(urlObject) {
  const requestedPath = decodeURIComponent(urlObject.pathname === "/" ? "/index.html" : urlObject.pathname);
  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(DIST_DIR, normalizedPath);
}

async function serveStaticFile(filePath, res) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
  const isServiceWorker = path.basename(filePath).toLowerCase() === "sw.js";
  const cacheControl = extension === ".html" || isServiceWorker
    ? "no-cache, no-store, must-revalidate"
    : "public, max-age=31536000, immutable";

  if (isServiceWorker) {
    // Served with an explicit Content-Length (no chunked transfer) since some
    // browsers/proxies are strict about the service-worker script fetch and
    // reject a chunked response with an opaque "unknown error" installing it.
    const contents = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "Content-Length": contents.length,
    });
    res.end(contents);
    return true;
  }

  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": cacheControl });
  createReadStream(filePath).pipe(res);
  return true;
}

async function serveSpa(urlObject, res) {
  const staticPath = getStaticPath(urlObject);
  const relativeTarget = path.relative(DIST_DIR, staticPath);

  if (!relativeTarget.startsWith("..") && existsSync(staticPath)) {
    try {
      const served = await serveStaticFile(staticPath, res);
      if (served) {
        return;
      }
    } catch {
      // Fall through to SPA index.
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
  createReadStream(INDEX_FILE).pipe(res);
}

const server = createServer(async (req, res) => {
  // A fixed base: a malformed Host header made new URL() throw outside any
  // try, and the unhandled rejection killed the process.
  let urlObject;
  try {
    urlObject = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  const isApiRequest = urlObject.pathname.replace(/^\/+/, "").split("/")[0] === "api";

  // CORS is only meaningful for cross-origin API calls (e.g. the GitHub Pages
  // frontend talking to this backend). Static assets and the SPA shell are
  // same-origin document/script loads — setting Access-Control-* on them is
  // unnecessary and can confuse strict same-origin fetches like service
  // worker script installation.
  if (isApiRequest) {
    applyCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (isCrossSiteWriteBlocked(req)) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Cross-site request blocked" }));
      return;
    }
  }

  try { if (await ghostDatabaseHandler(req, res, urlObject)) return; } catch (error) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message })); return; }
  const resolvedApi = getApiResolution(urlObject);

  if (resolvedApi) {
    req.query = resolvedApi.query;
    req.url = `${urlObject.pathname}${urlObject.search}`;

    try {
      await resolvedApi.handler(req, createResponseShim(res));
    } catch (error) {
      console.error("[transitalert-api] Request failed", urlObject.pathname, error);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Unexpected server error" }));
    }
    return;
  }

  try {
    await serveSpa(urlObject, res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Failed to serve application");
  }
});

async function start() {
  if (isDatabaseConfigured) {
    try {
      await ensureDatabaseReady();
      console.log("[transitalert-db] Database ready");
    } catch (error) {
      console.error("[transitalert-db] Database bootstrap failed", error);
    }
  } else {
    console.warn("[transitalert-db] DATABASE_URL is not configured");
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`TransitAlert Render server listening on ${PORT}`);
  });

  // Build the journey-planner graph now instead of on whichever real
  // request happens to arrive first — that first build takes roughly a
  // minute, and a user staring at "Plan a journey" for a minute with no
  // feedback reads as broken, not slow.
  console.log("[journey-graph] Warming journey planner graph...");
  warmJourneyGraph().then(() => {
    console.log("[journey-graph] Journey planner graph ready.");
  });

  if (isPushConfigured()) {
    console.log("[transitalert-push] Web push configured, starting alert watch loop");
    const runPushCheck = () => {
      checkAndPushNewAlerts().catch((error) => {
        console.error("[transitalert-push] Alert check failed", error?.message ?? error);
      });
    };
    runPushCheck();
    setInterval(runPushCheck, 60_000);
  } else {
    console.warn("[transitalert-push] VAPID keys not configured — push notifications disabled");
  }

  if (isDatabaseConfigured) {
    console.log("[fleet-tracking] Database configured, starting fleet sighting log");
    const runFleetRecording = () => {
      ensureLiveTrainsFresh()
        .then((trains) => recordFleetSightings(trains))
        .catch((error) => {
          console.error("[fleet-tracking] Recording failed", error?.message ?? error);
        });
    };
    runFleetRecording();
    setInterval(runFleetRecording, 60_000);
  }
}

// pglite (the embedded WASM Postgres this dev server runs against) has no
// separate server process to survive a hard kill — a forcibly terminated
// Node process gives it zero chance to flush its WAL/checkpoint, and enough
// of those in a row genuinely corrupts the data directory beyond repair
// (confirmed the hard way: even Postgres's own pg_resetwal couldn't recover
// it once that happened). Closing it here on a normal stop signal lets it
// shut down clean instead. Stopping this process for a redeploy should use
// a signal Node can actually catch (e.g. `taskkill /PID <pid>` without
// `/F`, not Stop-Process -Force) or this handler never runs at all.
let shuttingDown = false;
async function shutdownGracefully(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] Received ${signal}, closing cleanly...`);
  // pglite.close() hanging indefinitely (observed live: process stayed
  // alive for 14+ hours after logging this line, never exiting) left a
  // zombie process holding no port open — the watchdog saw the PID still
  // alive and never started a replacement, so the site stayed down until
  // someone noticed and force-killed it by hand. A shutdown signal must
  // always result in the process actually exiting within a bounded time,
  // whatever pglite is doing.
  const forceExitTimer = setTimeout(() => {
    console.error("[shutdown] Graceful close timed out after 5s, forcing exit");
    process.exit(1);
  }, 5000);
  server.close();
  try {
    await pglite?.close();
  } catch (error) {
    console.error("[shutdown] Error closing database", error?.message ?? error);
  }
  clearTimeout(forceExitTimer);
  process.exit(0);
}
process.on("unhandledRejection", (error) => {
  console.error("[transitalert] Unhandled rejection", error);
});
process.on("SIGINT", () => void shutdownGracefully("SIGINT"));
process.on("SIGTERM", () => void shutdownGracefully("SIGTERM"));
process.on("SIGHUP", () => void shutdownGracefully("SIGHUP"));

void start();
