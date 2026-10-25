import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import crypto from "node:crypto";
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const require = createRequire(import.meta.url);
const GtfsRealtimeBindings = require("./vendor/ptv/gtfs-realtime.cjs");

const PTV_FEEDS = [
  {
    key: "metro",
    baseUrl: "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro",
    defaultLine: "Metro",
    trainType: "Metro Train",
  },
  {
    key: "vline",
    baseUrl: "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline",
    defaultLine: "V/Line",
    trainType: "V/Line Train",
  },
] as const;
const PTV_TRAM_BASE_URL =
  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/tram";
const PTV_BUS_BASE_URL =
  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/bus";
const NSW_TRAINS_VEHICLE_POSITIONS_URL = "https://api.transport.nsw.gov.au/v2/gtfs/vehiclepos/nswtrains";
const NSW_SOUTHEASTERN_BOUNDS = {
  minLat: -39.8,
  maxLat: -32.0,
  minLng: 140.0,
  maxLng: 152.5,
} as const;
const TRANSPORTVIC_BASE_URL = "https://transportvic.me";
const METRO_HEALTHBOARD_URL = "https://www.metrotrains.com.au/api?op=get_healthboard_alerts";
const METRO_SERVICE_URL = "https://www.metrotrains.com.au/service/";

const ROLE_OPTIONS = [
  "Admin",
  "Traveller",
  "Train Driver",
  "Station Staff",
  "Special",
  "Friend",
  "Bug Tester",
] as const;

type RuntimeConfig = {
  ptvSubscriptionKey?: string;
  telegramBotToken?: string;
  adminUsername: string;
  adminPassword: string;
  trackedConsists: string[];
};

type AppRole = (typeof ROLE_OPTIONS)[number];

type ScheduledTrip = {
  tripId: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  date: string;
  consist: string;
  url: string;
};

type StopTiming = {
  stopName: string;
  slug: string;
  time: string;
};

type PositionPrediction = {
  status: "waiting" | "between" | "arrived";
  currentStop: StopTiming;
  nextStop: StopTiming | null;
};

const transportVicStations = [
  { name: "Flinders Street", slug: "flinders-street", lat: -37.8183, lng: 144.9671 },
  { name: "Southern Cross", slug: "southern-cross", lat: -37.8186, lng: 144.9525 },
  { name: "Melbourne Central", slug: "melbourne-central", lat: -37.81, lng: 144.9631 },
  { name: "Flagstaff", slug: "flagstaff", lat: -37.8116, lng: 144.9547 },
  { name: "Parliament", slug: "parliament", lat: -37.8117, lng: 144.9726 },
  { name: "North Melbourne", slug: "north-melbourne", lat: -37.8064, lng: 144.9429 },
  { name: "Macaulay", slug: "macaulay", lat: -37.7974, lng: 144.9459 },
  { name: "Kensington", slug: "kensington", lat: -37.7918, lng: 144.9362 },
  { name: "Newmarket", slug: "newmarket", lat: -37.7851, lng: 144.939 },
  { name: "Flemington Bridge", slug: "flemington-bridge", lat: -37.7879, lng: 144.9487 },
  { name: "Royal Park", slug: "royal-park", lat: -37.7859, lng: 144.958 },
  { name: "Jewell", slug: "jewell", lat: -37.7811, lng: 144.9667 },
  { name: "Brunswick", slug: "brunswick", lat: -37.7718, lng: 144.9598 },
  { name: "Anstey", slug: "anstey", lat: -37.763, lng: 144.9536 },
  { name: "Moreland", slug: "moreland", lat: -37.753, lng: 144.9494 },
  { name: "Coburg", slug: "coburg", lat: -37.7449, lng: 144.9663 },
  { name: "Batman", slug: "batman", lat: -37.7389, lng: 144.9653 },
  { name: "Merlynston", slug: "merlynston", lat: -37.733, lng: 144.9636 },
  { name: "Fawkner", slug: "fawkner", lat: -37.7249, lng: 144.9607 },
  { name: "Gowrie", slug: "gowrie", lat: -37.7158, lng: 144.9542 },
  { name: "Upfield", slug: "upfield", lat: -37.7091, lng: 144.9411 },
  { name: "Ascot Vale", slug: "ascot-vale", lat: -37.7782, lng: 144.9256 },
  { name: "Moonee Ponds", slug: "moonee-ponds", lat: -37.7666, lng: 144.923 },
  { name: "Essendon", slug: "essendon", lat: -37.7489, lng: 144.9175 },
  { name: "Glenbervie", slug: "glenbervie", lat: -37.7432, lng: 144.9178 },
  { name: "Strathmore", slug: "strathmore", lat: -37.7358, lng: 144.9253 },
  { name: "Pascoe Vale", slug: "pascoe-vale", lat: -37.7256, lng: 144.9268 },
  { name: "Oak Park", slug: "oak-park", lat: -37.7144, lng: 144.9233 },
  { name: "Glenroy", slug: "glenroy", lat: -37.7036, lng: 144.9232 },
  { name: "Jacana", slug: "jacana", lat: -37.693, lng: 144.9245 },
  { name: "Broadmeadows", slug: "broadmeadows", lat: -37.6776, lng: 144.921 },
  { name: "Coolaroo", slug: "coolaroo", lat: -37.6648, lng: 144.9266 },
  { name: "Roxburgh Park", slug: "roxburgh-park", lat: -37.6324, lng: 144.9395 },
  { name: "Craigieburn", slug: "craigieburn", lat: -37.6044, lng: 144.9443 },
];

type AccountRecord = {
  id: string;
  username: string;
  email: string;
  password: string;
  role: AppRole;
  isAdmin: boolean;
};

type SessionRecord = {
  id: string;
  username: string;
  email: string;
  role: AppRole | "Guest";
  isAdmin: boolean;
};

type UserPreferences = {
  favouriteStops: string[];
  favouriteRoutes: string[];
  selectedMapFilters: Record<string, boolean>;
  transportModes: string[];
  appPreferences: Record<string, unknown>;
};

type ReportRecord = {
  id: number;
  reportType: "inspector" | "delay" | "incident";
  transportType: "tram" | "train" | "bus" | "stop";
  lineNumber: string | null;
  direction: "city_bound" | "outbound" | "unknown";
  locationName: string;
  notes: string | null;
  username: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
};

const defaultPreferences: UserPreferences = {
  favouriteStops: [],
  favouriteRoutes: [],
  selectedMapFilters: {},
  transportModes: ["train"],
  appPreferences: {},
};

const reportStore: ReportRecord[] = [];
let nextReportId = 1;

function buildReportStats(reports: ReportRecord[]) {
  const routeCounts = new Map<string, { lineNumber: string; transportType: string; reportCount: number }>();

  for (const report of reports) {
    const lineNumber = report.lineNumber?.trim();
    if (!lineNumber) continue;

    const key = `${report.transportType}:${lineNumber}`;
    const existing = routeCounts.get(key);
    if (existing) {
      existing.reportCount += 1;
      continue;
    }

    routeCounts.set(key, {
      lineNumber,
      transportType: report.transportType,
      reportCount: 1,
    });
  }

  const riskyRoutes = [...routeCounts.values()]
    .map((route) => ({
      ...route,
      riskLevel:
        route.reportCount >= 5 ? "high" : route.reportCount >= 3 ? "medium" : "low",
    }))
    .sort((left, right) => right.reportCount - left.reportCount)
    .slice(0, 8);

  return {
    alertsToday: reports.length,
    riskyRoutes,
  };
}

const preferencesStore = new Map<string, UserPreferences>();

const sessionStore = new Map<string, SessionRecord>();
function sendJson(res: any, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseCookies(req: any) {
  const header = req.headers?.cookie;
  const cookies = new Map<string, string>();
  if (typeof header !== "string") return cookies;

  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    cookies.set(rawKey, decodeURIComponent(rawValue.join("=")));
  }

  return cookies;
}

function setCookie(res: any, key: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  res.setHeader(
    "Set-Cookie",
    `${key}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`,
  );
}

function clearCookie(res: any, key: string) {
  res.setHeader("Set-Cookie", `${key}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getSessionUser(req: any) {
  const sessionId = parseCookies(req).get("transitalert_session");
  return sessionId ? sessionStore.get(sessionId) ?? null : null;
}

function sanitizeUser(record: SessionRecord | AccountRecord) {
  return {
    id: record.id,
    username: record.username,
    email: record.email,
    role: record.role,
    isAdmin: record.isAdmin,
  };
}

function getUserPreferences(userId: string): UserPreferences {
  const existing = preferencesStore.get(userId);
  if (existing) {
    return existing;
  }
  preferencesStore.set(userId, { ...defaultPreferences });
  return { ...defaultPreferences };
}

function upsertUserPreferences(userId: string, patch: Partial<UserPreferences>) {
  const existing = getUserPreferences(userId);
  const next: UserPreferences = {
    favouriteStops: Array.isArray(patch.favouriteStops) ? patch.favouriteStops : existing.favouriteStops,
    favouriteRoutes: Array.isArray(patch.favouriteRoutes) ? patch.favouriteRoutes : existing.favouriteRoutes,
    selectedMapFilters:
      patch.selectedMapFilters && typeof patch.selectedMapFilters === "object"
        ? { ...existing.selectedMapFilters, ...patch.selectedMapFilters }
        : existing.selectedMapFilters,
    transportModes:
      Array.isArray(patch.transportModes) && patch.transportModes.length > 0
        ? patch.transportModes
        : existing.transportModes,
    appPreferences:
      patch.appPreferences && typeof patch.appPreferences === "object"
        ? { ...existing.appPreferences, ...patch.appPreferences }
        : existing.appPreferences,
  };
  preferencesStore.set(userId, next);
  return next;
}

async function readJsonBody(req: any) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return undefined;
}

function getTranslationText(value: unknown): string {
  if (!value || typeof value !== "object" || !("translation" in value)) return "";
  const translation = Array.isArray((value as { translation?: unknown[] }).translation)
    ? (value as { translation?: Array<{ text?: string }> }).translation
    : [];
  return translation.map((entry) => entry?.text?.trim()).find(Boolean) ?? "";
}

function melbourneNowHHMM() {
  return new Date().toLocaleTimeString("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function todayDate() {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" })
    .replace(/-/g, "");
}

function toMinutes(hhmm: string) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function parseTripsFromHtml(html: string, date: string): ScheduledTrip[] {
  const trips: ScheduledTrip[] = [];
  const tripBlockRe = /<div class="trip[^"]*">\s*<a href="([^"]+)">([^<]+)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = tripBlockRe.exec(html)) !== null) {
    const [_, url, text] = match;
    const urlMatch = url.match(
      /\/metro\/run\/([^/]+)\/(\d{2}:\d{2})\/([^/]+)\/(\d{2}:\d{2})\/(\d{8})/,
    );
    const textMatch = text
      .trim()
      .match(/^#(\w+):\s*\d{2}:\d{2}\s+(.+?)\s+-\s+(.+?):\s*(.+)$/);
    if (!urlMatch || !textMatch) continue;

    trips.push({
      tripId: textMatch[1],
      origin: textMatch[2],
      destination: textMatch[3],
      departureTime: urlMatch[2],
      arrivalTime: urlMatch[4],
      date: urlMatch[5] || date,
      consist: textMatch[4],
      url,
    });
  }
  return trips;
}

function parsePastDeploymentsFromHtml(html: string) {
  const deployments: Array<{ date: string }> = [];
  const regex = /<a class="pastDeployment"[^>]*href="[^"]*date=(\d{8})"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    deployments.push({ date: match[1] });
  }
  return deployments;
}

function determineActiveTrips(trips: ScheduledTrip[]) {
  const now = melbourneNowHHMM();
  let currentTrip: ScheduledTrip | null = null;
  let nextTrip: ScheduledTrip | null = null;

  for (const trip of trips) {
    const crossesMidnight = trip.arrivalTime < trip.departureTime;
    const isActive = crossesMidnight
      ? now >= trip.departureTime || now <= trip.arrivalTime
      : now >= trip.departureTime && now <= trip.arrivalTime;

    if (isActive) {
      currentTrip = trip;
    } else if (trip.departureTime > now && !nextTrip) {
      nextTrip = trip;
    }
  }

  return { currentTrip, nextTrip };
}

function parseStopTimings(html: string): StopTiming[] {
  const stops: StopTiming[] = [];
  const regex =
    /<div class="timingRow"[^>]*>[\s\S]*?href="\/metro\/timings\/([^"]+)"[\s\S]*?<span class="stopName">([^<]+)<\/span>[\s\S]*?<div class="timing[^"]*">[\s\S]*?<span>[^<]*<\/span>[\s\S]*?<span>(\d{2}:\d{2})<\/span>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    stops.push({
      slug: match[1],
      stopName: match[2].trim(),
      time: match[3],
    });
  }
  return stops;
}

async function fetchTransportVicHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 TransitAlert/1.0",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`TransportVic request failed (${response.status})`);
  }

  return response.text();
}

async function fetchConsistPage(consist: string, date = todayDate()) {
  const html = await fetchTransportVicHtml(
    `${TRANSPORTVIC_BASE_URL}/metro/tracker/consist?consist=${encodeURIComponent(consist)}&date=${date}`,
  );
  const trips = parseTripsFromHtml(html, date);
  const pastDeployments = parsePastDeploymentsFromHtml(html);
  const { currentTrip, nextTrip } = determineActiveTrips(trips);
  return { consist, date, trips, currentTrip, nextTrip, pastDeployments };
}

async function fetchRunStops(trip: ScheduledTrip) {
  if (!trip.url) return [];
  const html = await fetchTransportVicHtml(`${TRANSPORTVIC_BASE_URL}${trip.url}`);
  return parseStopTimings(html);
}

function predictCurrentPosition(stops: StopTiming[]): PositionPrediction | null {
  if (stops.length === 0) return null;

  const now = melbourneNowHHMM();
  let lastIndex = -1;
  for (let index = 0; index < stops.length; index += 1) {
    if (stops[index].time <= now) {
      lastIndex = index;
    }
  }

  if (lastIndex === -1) {
    return { status: "waiting", currentStop: stops[0], nextStop: stops[1] ?? null };
  }

  if (lastIndex >= stops.length - 1) {
    return { status: "arrived", currentStop: stops[lastIndex], nextStop: null };
  }

  return {
    status: "between",
    currentStop: stops[lastIndex],
    nextStop: stops[lastIndex + 1],
  };
}

function interpolateGps(prediction: PositionPrediction, now: string) {
  const current = transportVicStations.find((station) => station.slug === prediction.currentStop.slug);
  if (!current) return null;

  if (prediction.status !== "between" || !prediction.nextStop) {
    return {
      lat: current.lat,
      lng: current.lng,
      progress: prediction.status === "arrived" ? 1 : 0,
    };
  }

  const next = transportVicStations.find((station) => station.slug === prediction.nextStop?.slug);
  if (!next) {
    return { lat: current.lat, lng: current.lng, progress: 0 };
  }

  const denominator = toMinutes(prediction.nextStop.time) - toMinutes(prediction.currentStop.time);
  const progress = denominator <= 0
    ? 0
    : Math.max(0, Math.min(1, (toMinutes(now) - toMinutes(prediction.currentStop.time)) / denominator));

  return {
    lat: current.lat + progress * (next.lat - current.lat),
    lng: current.lng + progress * (next.lng - current.lng),
    progress,
  };
}

async function fetchTransportVicAlerts() {
  const html = await fetchTransportVicHtml(`${TRANSPORTVIC_BASE_URL}/metro/timings/flinders-street`);
  const openTag = '<div class="alerts">';
  const start = html.indexOf(openTag);
  if (start === -1) return [];

  const afterOpen = start + openTag.length;
  const end = html.indexOf('<div class="departure">', afterOpen);
  const alertsHtml = end === -1 ? html.slice(afterOpen, afterOpen + 2000) : html.slice(afterOpen, end);
  const text = alertsHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text ? text.split(/\s{2,}/).filter(Boolean) : [];
}

async function fetchTelegramBotProfile(telegramBotToken?: string) {
  if (!telegramBotToken) {
    return { connected: false, username: null, firstName: null };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: { username?: string; first_name?: string };
    };

    if (!response.ok || !payload.ok || !payload.result) {
      return { connected: false, username: null, firstName: null };
    }

    return {
      connected: true,
      username: payload.result.username ?? null,
      firstName: payload.result.first_name ?? null,
    };
  } catch {
    return { connected: false, username: null, firstName: null };
  }
}

async function fetchLastRunForConsist(consist: string) {
  const todayPage = await fetchConsistPage(consist);
  const now = melbourneNowHHMM();
  const todayPastTrips = todayPage.trips.filter((trip) => trip.departureTime <= now);
  if (todayPastTrips.length > 0) {
    return { trip: todayPastTrips[todayPastTrips.length - 1], date: todayPage.date };
  }

  const mostRecentPastDeployment = todayPage.pastDeployments[0];
  if (!mostRecentPastDeployment) return null;

  const pastPage = await fetchConsistPage(consist, mostRecentPastDeployment.date);
  if (pastPage.trips.length === 0) return null;

  return {
    trip: pastPage.trips[pastPage.trips.length - 1],
    date: pastPage.date,
  };
}

async function loadConsistSnapshot(consist: string) {
  const data = await fetchConsistPage(consist);
  const alerts = await fetchTransportVicAlerts();
  const stops = data.currentTrip ? await fetchRunStops(data.currentTrip) : [];
  const position = stops.length > 0 ? predictCurrentPosition(stops) : null;
  const gps = position ? interpolateGps(position, melbourneNowHHMM()) : null;
  const lastRun = await fetchLastRunForConsist(consist);

  return { data, alerts, stops, position, gps, lastRun };
}

async function fetchFeed(
  baseUrl: string,
  feedPath: "/vehicle-positions" | "/service-alerts",
  ptvSubscriptionKey?: string,
) {
  if (!ptvSubscriptionKey) {
    throw new Error("Missing PTV_SUBSCRIPTION_KEY");
  }

  const response = await fetch(`${baseUrl}${feedPath}`, {
    headers: {
      "KeyID": ptvSubscriptionKey,
      "Ocp-Apim-Subscription-Key": ptvSubscriptionKey,
    },
  });

  if (!response.ok) {
    throw new Error(`PTV request failed (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
}

async function buildTransportVicLiveTrains(consists: string[]) {
  const snapshots = await Promise.all(
    consists.map(async (consist) => {
      try {
        return await loadConsistSnapshot(consist);
      } catch {
        return null;
      }
    }),
  );

  return snapshots
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot))
    .flatMap((snapshot) => {
      const currentTrip = snapshot.data.currentTrip;
      if (!currentTrip || !snapshot.gps) return [];

        return [
          {
            tdn: currentTrip.tripId || snapshot.data.nextTrip?.tripId || snapshot.data.consist,
            lat: snapshot.gps.lat,
            lng: snapshot.gps.lng,
            line: "Metro",
            destination: currentTrip.destination,
            status: "on_time",
            timestamp: new Date().toISOString(),
            direction: currentTrip.destination.toLowerCase().includes("flinders") ? "up" : "down",
            heading: undefined,
            trainType: "TransportVic tracked consist",
            consist: snapshot.data.consist,
            serviceDescription: `${currentTrip.origin} to ${currentTrip.destination}`,
          },
        ];
      });
}

function mergeLiveTrainLists(...lists: Array<Array<Record<string, unknown>>>) {
  const merged = new Map<string, Record<string, unknown>>();
  for (const list of lists) {
    for (const train of list) {
      const consistKey =
        typeof train.consist === "string" && train.consist.trim()
          ? train.consist.trim().toUpperCase()
          : "";
      const tdnKey =
        typeof train.tdn === "string" && train.tdn.trim()
          ? train.tdn.trim().toUpperCase()
          : "";
      merged.set(consistKey || tdnKey || crypto.randomUUID(), train);
    }
  }
  return Array.from(merged.values());
}

function buildTransportVicMetroAlerts() {
  return fetchTransportVicAlerts().then((alerts) =>
    alerts.map((alert, index) => ({
      id: `transportvic-alert-${index}`,
      title: "Metro service alert",
      summary: alert,
      lines: [],
      status: "active",
      updatedAt: new Date().toISOString(),
      url: "https://transport.vic.gov.au/disruptions/disruptions-information",
      source: "metro",
    })),
  );
}

const metroAlertTypeLabels: Record<string, string> = {
  service: "Service Change",
  minor: "Minor Delay",
  major: "Major Delay",
  suspended: "Suspended",
  works: "Works Alert",
  travel: "Travel Alert",
  cancellation: "Cancellation",
  "good-service": "Good Service",
};

const metroWorkStatusMap: Record<string, string> = {
  "bus-replacement": "planned works",
  "night-works": "planned works",
  "service-changes": "service change",
  "station-car-park-works": "station access",
  "station-closure": "station access",
};

function decodeMetroHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripMetroHtml(value: unknown) {
  return decodeMetroHtmlEntities(String(value ?? ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metroUnixToIso(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return new Date(seconds * 1000).toISOString();
}

function formatMetroLineName(lineName: unknown) {
  const cleaned = String(lineName ?? "").trim();
  if (!cleaned) return "Metro";
  if (/all lines|station|loop|corridor|line$/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned} Line`;
}

function sentenceCase(value: unknown) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatMetroClock(date: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\s/g, "")
    .toLowerCase();
}

function formatMetroDay(date: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function buildMetroRouteLabel(stations: unknown) {
  const cleanedStations = Array.isArray(stations)
    ? stations.filter((station): station is string => typeof station === "string" && station.trim().length > 0)
    : [];

  if (cleanedStations.length >= 2) {
    return `${cleanedStations[0]} -> ${cleanedStations[cleanedStations.length - 1]}`;
  }

  if (cleanedStations.length === 1) {
    return `${cleanedStations[0]} area`;
  }

  return null;
}

function formatMetroPlannedWorksSummary(work: Record<string, unknown>) {
  const start = Number(work.start_date);
  const end = Number(work.end_date);
  const startDate = Number.isFinite(start) && start > 0 ? new Date(start * 1000) : null;
  const endDate = Number.isFinite(end) && end > 0 ? new Date(end * 1000) : null;
  const routeLabel = buildMetroRouteLabel(work.affected_stations);

  if (!startDate || !endDate) {
    return routeLabel ? `Affecting ${routeLabel}.` : "Check Metro planned works details for timing information.";
  }

  const sameDay =
    startDate.toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne" }) ===
    endDate.toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne" });

  const startClock = formatMetroClock(startDate);
  const endClock = formatMetroClock(endDate);
  const startDay = formatMetroDay(startDate);
  const endDay = formatMetroDay(endDate);

  let dateText = "";
  if (sameDay) {
    dateText = `${startClock} to ${endClock} ${startDay}`;
  } else if (endClock === "11:59pm") {
    dateText = `${startClock} ${startDay} to last service ${endDay}`;
  } else {
    dateText = `${startClock} ${startDay} to ${endClock} ${endDay}`;
  }

  return routeLabel ? `${dateText}. Affecting ${routeLabel}.` : `${dateText}.`;
}

function mergeMetroAlert(map: Map<string, Record<string, unknown>>, alert: Record<string, unknown>) {
  const key = String(alert.id);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, alert);
    return;
  }

  const existingLines = Array.isArray(existing.lines) ? existing.lines : [];
  const nextLines = Array.isArray(alert.lines) ? alert.lines : [];

  const existingUpdatedAt =
    typeof existing.updatedAt === "string" && existing.updatedAt
      ? new Date(existing.updatedAt).getTime()
      : 0;
  const nextUpdatedAt =
    typeof alert.updatedAt === "string" && alert.updatedAt
      ? new Date(alert.updatedAt).getTime()
      : 0;

  map.set(key, {
    ...existing,
    ...alert,
    lines: [...new Set([...existingLines, ...nextLines])],
    updatedAt: existingUpdatedAt >= nextUpdatedAt ? existing.updatedAt : alert.updatedAt,
    summary:
      String(existing.summary ?? "").length >= String(alert.summary ?? "").length
        ? existing.summary
        : alert.summary,
    url: alert.url ?? existing.url,
  });
}

function normaliseMetroHealthboardAlert(lineId: string, lineName: unknown, rawAlert: Record<string, unknown>) {
  const summary = stripMetroHtml(rawAlert.alert_text);
  if (!summary || /good service - trains are running on time/i.test(summary)) {
    return null;
  }

  const type = String(rawAlert.alert_type ?? "").trim().toLowerCase();
  const typeLabel = metroAlertTypeLabels[type] ?? "Service Alert";
  const cause = sentenceCase(rawAlert.disruption_due_to);

  return {
    id: `metro-live-${String(rawAlert.alert_id ?? `${lineId}-${type}-${summary}`)}`,
    title: type === "works" ? summary.split(/[.!?]/)[0]?.trim() || typeLabel : typeLabel,
    summary,
    lines: [formatMetroLineName(lineName)],
    status: cause || typeLabel.toLowerCase(),
    updatedAt: metroUnixToIso(rawAlert.modified ?? rawAlert.from_date),
    url: METRO_SERVICE_URL,
    source: "metro",
  };
}

function normaliseMetroPlannedWork(lineName: unknown, work: Record<string, unknown>) {
  const title = stripMetroHtml(work.title);
  if (!title) {
    return null;
  }

  return {
    id: `metro-work-${String(work.id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`,
    title,
    summary: formatMetroPlannedWorksSummary(work),
    lines: [formatMetroLineName(lineName)],
    status: metroWorkStatusMap[String(work.type ?? "").trim().toLowerCase()] ?? "planned works",
    updatedAt: metroUnixToIso(work.modified ?? work.start_date),
    url: typeof work.link === "string" && work.link.trim().length > 0 ? work.link.trim() : METRO_SERVICE_URL,
    source: "metro",
  };
}

function normaliseMetroOutage(stationOutage: Record<string, unknown>, outage: Record<string, unknown>, index: number) {
  const stationName = stripMetroHtml(stationOutage.station);
  const title = stripMetroHtml(outage.name || outage.title || `${stationName} access notice`);
  const summary = stripMetroHtml(outage.description);
  if (!title && !summary) {
    return null;
  }

  return {
    id: `metro-outage-${stationName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`,
    title: title || `${stationName} access notice`,
    summary: summary || `${stationName} access changes are currently in place.`,
    lines: ["All lines", stationName ? `${stationName} Station` : "Station access"],
    status: "station access",
    updatedAt: undefined,
    url: METRO_SERVICE_URL,
    source: "metro",
  };
}

async function fetchMetroHealthboardAlerts() {
  const response = await fetch(METRO_HEALTHBOARD_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TransitAlert Melbourne",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Metro healthboard request failed (${response.status})`);
  }

  const payload = (await response.json()) as Record<string, any>;
  const alertsMap = new Map<string, Record<string, unknown>>();

  for (const [key, value] of Object.entries(payload)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    if (["metadata", "disruptions", "lift_escalator_outages"].includes(key)) {
      continue;
    }

    const lineName = value.line_name ?? key;

    if (Array.isArray(value.alerts)) {
      for (const rawAlert of value.alerts) {
        const alert = normaliseMetroHealthboardAlert(key, lineName, rawAlert);
        if (alert) {
          mergeMetroAlert(alertsMap, alert);
        }
      }
    }

    if (Array.isArray(value.planned_works_list)) {
      for (const work of value.planned_works_list) {
        const alert = normaliseMetroPlannedWork(lineName, work);
        if (alert) {
          mergeMetroAlert(alertsMap, alert);
        }
      }
    }
  }

  if (Array.isArray(payload.lift_escalator_outages)) {
    payload.lift_escalator_outages.forEach((stationOutage: Record<string, unknown>) => {
      const outages = Array.isArray(stationOutage.outages) ? stationOutage.outages : [];
      outages.forEach((outage: Record<string, unknown>, index: number) => {
        const alert = normaliseMetroOutage(stationOutage, outage, index);
        if (alert) {
          mergeMetroAlert(alertsMap, alert);
        }
      });
    });
  }

  return [...alertsMap.values()].sort((left, right) => {
    const leftTime =
      typeof left.updatedAt === "string" && left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightTime =
      typeof right.updatedAt === "string" && right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

function normalisePtvRouteId(routeId: string) {
  const code = routeId.match(/vic-0[12]-([A-Z0-9]+):/i)?.[1]?.toUpperCase() ?? routeId.toUpperCase();
  const routeMap: Record<string, string> = {
    ALM: "Alamein",
    ARA: "Ararat",
    BEG: "Belgrave",
    BAT: "Ballarat",
    BEN: "Bendigo",
    BNS: "Bairnsdale",
    CBE: "Cranbourne",
    CGB: "Craigieburn",
    ECH: "Echuca",
    FKN: "Frankston",
    GEO: "Geelong",
    GWY: "Glen Waverley",
    HBE: "Hurstbridge",
    LIL: "Lilydale",
    MBR: "Maryborough",
    MDD: "Mernda",
    PKM: "Pakenham",
    SHM: "Sandringham",
    SHL: "Swan Hill",
    SHP: "Shepparton",
    SEY: "Seymour",
    STY: "Stony Point",
    SUY: "Sunbury",
    TRN: "Traralgon",
    UFD: "Upfield",
    WAR: "Warrnambool",
    WER: "Werribee",
    WIL: "Williamstown",
  };

  return routeMap[code] ?? routeId;
}

function buildPtvLiveTrains(feed: Awaited<ReturnType<typeof fetchFeed>>, source: (typeof PTV_FEEDS)[number]) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;

      const latitude = position.latitude;
      const longitude = position.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;

      const directionId = toNumber(vehicle.trip?.directionId);
      const timestamp = toNumber(vehicle.timestamp);
      const routeId = vehicle.trip?.routeId || "Metro";
      const lineName = normalisePtvRouteId(routeId);
      const destination = lineName && lineName !== routeId ? lineName : source.defaultLine;
      const label = vehicle.vehicle?.label || vehicle.vehicle?.id || entity.id || routeId;

      return {
        tdn: label,
        lat: latitude,
        lng: longitude,
        line: destination,
        destination,
        status: "on_time",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        direction: directionId === 0 ? "up" : "down",
        heading: typeof position.bearing === "number" ? position.bearing : undefined,
        trainType: source.trainType,
        consist: vehicle.vehicle?.id || label,
        serviceDescription: destination,
      };
    })
      .filter(Boolean);
}

function isWithinNswSoutheasternBounds(latitude: number, longitude: number) {
  return (
    latitude >= NSW_SOUTHEASTERN_BOUNDS.minLat &&
    latitude <= NSW_SOUTHEASTERN_BOUNDS.maxLat &&
    longitude >= NSW_SOUTHEASTERN_BOUNDS.minLng &&
    longitude <= NSW_SOUTHEASTERN_BOUNDS.maxLng
  );
}

function getFirstMeaningfulText(...values: Array<string | undefined>) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return trimmed;
  }

  return "";
}

function inferNswTrainLinkServiceLabel(...values: Array<string | undefined>) {
  const joined = values.filter((value): value is string => Boolean(value?.trim())).join(" ").toLowerCase();
  if (joined.includes("xpt")) return "NSW TrainLink XPT";
  if (joined.includes("xplorer")) return "NSW TrainLink Xplorer";
  return "NSW TrainLink";
}

function inferNswTrainLinkDestination(...values: Array<string | undefined>) {
  const joined = values.filter((value): value is string => Boolean(value?.trim())).join(" ").toLowerCase();
  const destinationMap = [
    ["southern cross", "Southern Cross"],
    ["sydney central", "Sydney Central"],
    ["albury", "Albury"],
    ["melbourne", "Melbourne"],
    ["brisbane", "Brisbane"],
    ["casino", "Casino"],
    ["dubbo", "Dubbo"],
    ["armidale", "Armidale"],
    ["moree", "Moree"],
    ["griffith", "Griffith"],
    ["canberra", "Canberra"],
    ["goulburn", "Goulburn"],
  ] as const;

  for (const [needle, label] of destinationMap) {
    if (joined.includes(needle)) return label;
  }

  return inferNswTrainLinkServiceLabel(...values);
}

function buildNswLiveTrains(feed: Awaited<ReturnType<typeof fetchFeed>>) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;

      const latitude = position.latitude;
      const longitude = position.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;
      if (!isWithinNswSoutheasternBounds(latitude, longitude)) return null;

      const routeId = vehicle.trip?.routeId;
      const tripId = vehicle.trip?.tripId;
      const vehicleLabel = vehicle.vehicle?.label;
      const vehicleId = vehicle.vehicle?.id;
      const entityId = entity.id;
      const serviceLabel = inferNswTrainLinkServiceLabel(routeId, tripId, vehicleLabel, vehicleId, entityId);
      const destination = inferNswTrainLinkDestination(routeId, tripId, vehicleLabel, vehicleId, entityId);
      const directionId = toNumber(vehicle.trip?.directionId);
      const timestamp = toNumber(vehicle.timestamp);
      const tdn = getFirstMeaningfulText(vehicleLabel, tripId, vehicleId, entityId, routeId, "XPT");

      return {
        tdn,
        lat: latitude,
        lng: longitude,
        line: serviceLabel,
        destination,
        status: "on_time",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        direction: directionId === 0 ? "up" : directionId === 1 ? "down" : destination === "Southern Cross" ? "city-bound" : "outbound",
        heading: typeof position.bearing === "number" ? position.bearing : undefined,
        trainType: serviceLabel.includes("Xplorer") ? "NSW TrainLink Xplorer" : "NSW TrainLink XPT",
        consist: vehicle.vehicle?.id || vehicle.vehicle?.label || tdn,
        serviceDescription: [serviceLabel, destination].filter(Boolean).join(" · "),
      };
    })
    .filter(Boolean);
}

function normaliseSurfaceRoute(routeId: string | undefined, fallback: string) {
  if (typeof routeId !== "string") {
    return fallback;
  }

  const trimmed = routeId.trim();
  if (!trimmed) {
    return fallback;
  }

  const prefixedPtvRouteIdMatch = trimmed.match(/vic-02-([A-Z]?\d{1,4}[A-Z]?)(?::|-|$)/i);
  if (prefixedPtvRouteIdMatch?.[1]) {
    return prefixedPtvRouteIdMatch[1].toUpperCase();
  }

  const ptvRouteIdMatch = trimmed.match(/^\d{2}-([A-Z]?\d{1,4}[A-Z]?)(?:-|$)/i);
  if (ptvRouteIdMatch?.[1]) {
    return ptvRouteIdMatch[1].toUpperCase();
  }

  const routeMatch = trimmed.match(/\b([A-Z]?\d{1,4}[A-Z]?)\b/i);
  if (routeMatch) {
    return routeMatch[1].toUpperCase();
  }

  return fallback;
}

function normaliseSurfaceLabel(values: Array<string | undefined>, fallback: string) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return trimmed;
  }

  return fallback;
}

function normaliseSurfaceDestination(...values: Array<string | undefined>) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^aus:vic:vic-02-[A-Z0-9-]+:?$/i.test(trimmed) || /^vic-02-[A-Z0-9-]+:?$/i.test(trimmed)) {
      continue;
    }
    return trimmed;
  }

  return undefined;
}

function normaliseSurfaceStopStatus(value: unknown) {
  const status = toNumber(value);
  if (status === 0) return "incoming";
  if (status === 1) return "stopped";
  if (status === 2) return "in_transit";
  return undefined;
}

function buildPtvLiveSurfaceVehicles(
  feed: Awaited<ReturnType<typeof fetchFeed>>,
  options: { fallbackRoute: string; operator: string },
) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;

      const latitude = position.latitude;
      const longitude = position.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;

      const routeSource =
        options.operator === "Yarra Trams"
          ? vehicle.trip?.tripId || entity.id || vehicle.trip?.routeId
          : vehicle.trip?.routeId || vehicle.trip?.tripId || entity.id;
      const route = normaliseSurfaceRoute(routeSource, options.fallbackRoute);
      const timestamp = toNumber(vehicle.timestamp);
      const label = normaliseSurfaceLabel(
        [vehicle.vehicle?.label, vehicle.vehicle?.licensePlate, route],
        options.fallbackRoute,
      );
      const destination = normaliseSurfaceDestination(
        vehicle.trip?.tripHeadsign,
        vehicle.trip?.headsign,
        vehicle.trip?.tripShortName,
      );

      return {
        id: entity.id || vehicle.vehicle?.id || `${route}-${latitude}-${longitude}`,
        label,
        vehicleId: vehicle.vehicle?.id,
        fleetNumber: vehicle.vehicle?.label,
        registration: vehicle.vehicle?.licensePlate,
        tripId: vehicle.trip?.tripId,
        lat: latitude,
        lng: longitude,
        route,
        destination,
        stopId: vehicle.stopId,
        stopStatus: normaliseSurfaceStopStatus(vehicle.currentStatus),
        stopSequence: toNumber(vehicle.currentStopSequence),
        status: "live",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        heading: typeof position.bearing === "number" ? position.bearing : undefined,
        operator: options.operator,
      };
    })
    .filter(Boolean);
}

function buildMetroAlerts(feed: Awaited<ReturnType<typeof fetchFeed>>) {
  return (feed.entity ?? [])
    .map((entity, index) => {
      const alert = entity.alert;
      if (!alert) return null;

      const activePeriod = Array.isArray(alert.activePeriod) ? alert.activePeriod[0] : undefined;
      const updatedAt = toNumber(activePeriod?.start) || toNumber(feed.header?.timestamp);
      const lines = Array.isArray(alert.informedEntity)
        ? alert.informedEntity
            .map((item) => item.routeId || item.stopId || item.trip?.routeId)
            .filter((value): value is string => Boolean(value))
        : [];

      return {
        id: entity.id || `metro-alert-${index}`,
        title: getTranslationText(alert.headerText) || "Metro service alert",
        summary: getTranslationText(alert.descriptionText),
        lines,
        status: typeof alert.effect === "string" ? alert.effect.toLowerCase() : "active",
        updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : undefined,
        url: getTranslationText(alert.url) || "https://transport.vic.gov.au/disruptions/disruptions-information",
        source: "metro",
      };
    })
    .filter(Boolean);
}

function devAdminPassword() {
  const password = globalThis.crypto.randomUUID();
  console.warn(`[dev] ADMIN_PASSWORD not set; using a temporary admin password for this run: ${password}`);
  return password;
}

function ptvRealtimePlugin(runtimeConfig: RuntimeConfig): Plugin {
  const { adminPassword, adminUsername, ptvSubscriptionKey, telegramBotToken, trackedConsists } = runtimeConfig;
  const accountStore = new Map<string, AccountRecord>([
    [
      adminUsername.toLowerCase(),
      {
        id: adminUsername.toLowerCase(),
        username: adminUsername,
        email: `${adminUsername}@transitalert.local`,
        password: adminPassword,
        role: "Admin",
        isAdmin: true,
      },
    ],
  ]);

  const registerMiddleware = (middlewares: any) => {
    middlewares.use(async (req, res, next) => {
      try {
        if (req.url === "/api/auth/session") {
          const user = getSessionUser(req);
          sendJson(res, 200, {
            authenticated: Boolean(user),
            user: user ? sanitizeUser(user) : null,
            roles: ROLE_OPTIONS,
          });
          return;
        }

        if (req.url === "/api/auth/roles") {
          sendJson(res, 200, { roles: ROLE_OPTIONS });
          return;
        }

        if (req.url === "/api/auth/login" && req.method === "POST") {
          const body = (await readJsonBody(req)) as { username?: string; password?: string };
          const username = body.username?.trim().toLowerCase();
          const password = body.password ?? "";

          if (!username) {
            sendJson(res, 400, { error: "Username is required" });
            return;
          }

          const account = accountStore.get(username);
          if (!account || account.password !== password) {
            sendJson(res, 401, { error: "Invalid username or password" });
            return;
          }

          const sessionId = crypto.randomUUID();
          sessionStore.set(sessionId, {
            id: account.id,
            username: account.username,
            email: account.email,
            role: account.role,
            isAdmin: account.isAdmin,
          });
          setCookie(res, "transitalert_session", sessionId);
          sendJson(res, 200, {
            authenticated: true,
            user: sanitizeUser(account),
            roles: ROLE_OPTIONS,
          });
          return;
        }

        if (req.url === "/api/auth/register" && req.method === "POST") {
          const body = (await readJsonBody(req)) as {
            username?: string;
            email?: string;
            password?: string;
            role?: string;
          };
          const username = body.username?.trim();
          const normalizedUsername = username?.toLowerCase();
          const email = body.email?.trim().toLowerCase();
          const password = body.password ?? "";
          const requestedRole = body.role?.trim() as AppRole | undefined;

          if (!username || username.length < 3) {
            sendJson(res, 400, { error: "Username must be at least 3 characters" });
            return;
          }

          if (!password || password.length < 6) {
            sendJson(res, 400, { error: "Password must be at least 6 characters" });
            return;
          }

          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            sendJson(res, 400, { error: "A valid email address is required" });
            return;
          }

          if (!requestedRole || !ROLE_OPTIONS.includes(requestedRole)) {
            sendJson(res, 400, { error: "Please choose a valid role" });
            return;
          }

          if (!normalizedUsername) {
            sendJson(res, 400, { error: "Username is required" });
            return;
          }

          if (accountStore.has(normalizedUsername)) {
            sendJson(res, 409, { error: "That username is already taken" });
            return;
          }

          const account: AccountRecord = {
            id: normalizedUsername,
            username,
            email,
            password,
            role: requestedRole,
            isAdmin: false,
          };
          accountStore.set(normalizedUsername, account);

          const sessionId = crypto.randomUUID();
          sessionStore.set(sessionId, {
            id: account.id,
            username: account.username,
            email: account.email,
            role: account.role,
            isAdmin: account.isAdmin,
          });
          setCookie(res, "transitalert_session", sessionId);
          sendJson(res, 201, {
            authenticated: true,
            user: sanitizeUser(account),
            roles: ROLE_OPTIONS,
          });
          return;
        }

        if (req.url === "/api/auth/guest" && req.method === "POST") {
          const sessionId = crypto.randomUUID();
          sessionStore.set(sessionId, {
            id: "guest",
            username: "Guest",
            email: "guest@transitalert.local",
            role: "Guest",
            isAdmin: false,
          });
          setCookie(res, "transitalert_session", sessionId, 60 * 60 * 24 * 2);
          sendJson(res, 200, {
            authenticated: true,
            user: sanitizeUser({
              id: "guest",
              username: "Guest",
              email: "guest@transitalert.local",
              role: "Guest",
              isAdmin: false,
            }),
            roles: ROLE_OPTIONS,
          });
          return;
        }

        if (req.url === "/api/auth/logout" && req.method === "POST") {
          const sessionId = parseCookies(req).get("transitalert_session");
          if (sessionId) {
            sessionStore.delete(sessionId);
          }
          clearCookie(res, "transitalert_session");
          sendJson(res, 200, { success: true });
          return;
        }

        if (req.url === "/api/preferences") {
          const user = getSessionUser(req);
          if (!user || user.role === "Guest") {
            sendJson(res, 401, { error: "Sign in to access account preferences" });
            return;
          }

          if (req.method === "GET") {
            sendJson(res, 200, { preferences: getUserPreferences(user.id) });
            return;
          }

          if (req.method === "PUT" || req.method === "POST") {
            const body = (await readJsonBody(req)) as Partial<UserPreferences>;
            sendJson(res, 200, { preferences: upsertUserPreferences(user.id, body) });
            return;
          }

          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        if (req.url === "/api/preferences/merge" && req.method === "POST") {
          const user = getSessionUser(req);
          if (!user || user.role === "Guest") {
            sendJson(res, 401, { error: "Sign in to merge account preferences" });
            return;
          }

          const body = (await readJsonBody(req)) as Partial<UserPreferences>;
          const existing = getUserPreferences(user.id);
          const uniq = (values: string[]) => [...new Set(values.filter(Boolean))];
          const merged = upsertUserPreferences(user.id, {
            favouriteStops: uniq([...(existing.favouriteStops ?? []), ...(body.favouriteStops ?? [])]),
            favouriteRoutes: uniq([...(existing.favouriteRoutes ?? []), ...(body.favouriteRoutes ?? [])]),
            transportModes: uniq([...(existing.transportModes ?? []), ...(body.transportModes ?? [])]),
            selectedMapFilters: {
              ...(existing.selectedMapFilters ?? {}),
              ...(body.selectedMapFilters ?? {}),
            },
            appPreferences: {
              ...(existing.appPreferences ?? {}),
              ...(body.appPreferences ?? {}),
            },
          });
          sendJson(res, 200, { preferences: merged });
          return;
        }

        if (req.url === "/api/reports" && req.method === "GET") {
          sendJson(res, 200, [...reportStore].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)));
          return;
        }

        if (req.url === "/api/reports" && req.method === "POST") {
          const body = (await readJsonBody(req)) as Partial<ReportRecord>;
          const report: ReportRecord = {
            id: nextReportId,
            reportType:
              body.reportType === "delay" || body.reportType === "incident" ? body.reportType : "inspector",
            transportType:
              body.transportType === "tram" ||
              body.transportType === "bus" ||
              body.transportType === "stop"
                ? body.transportType
                : "train",
            lineNumber: typeof body.lineNumber === "string" && body.lineNumber.trim() ? body.lineNumber.trim() : null,
            direction:
              body.direction === "city_bound" || body.direction === "outbound" ? body.direction : "unknown",
            locationName:
              typeof body.locationName === "string" && body.locationName.trim()
                ? body.locationName.trim()
                : "Unknown location",
            notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
            username: typeof body.username === "string" && body.username.trim() ? body.username.trim() : "Guest",
            lat: typeof body.lat === "number" ? body.lat : null,
            lng: typeof body.lng === "number" ? body.lng : null,
            createdAt: new Date().toISOString(),
          };

          reportStore.unshift(report);
          nextReportId += 1;
          sendJson(res, 201, report);
          return;
        }

        if (req.url === "/api/reports/stats" && req.method === "GET") {
          sendJson(res, 200, buildReportStats(reportStore));
          return;
        }

        if (req.url === "/api/telegram/status") {
          const profile = await fetchTelegramBotProfile(telegramBotToken);
          sendJson(res, 200, profile);
          return;
        }

        if (req.url === "/api/ptv/live-trains") {
          const trackedTrains = await buildTransportVicLiveTrains(trackedConsists);
          let ptvTrains: Array<Record<string, unknown>> = [];
          let nswTrains: Array<Record<string, unknown>> = [];
          const nswTransportApiKey =
            process.env.NSW_TRANSPORT_API_KEY ||
            process.env.TRANSPORT_NSW_API_KEY ||
            process.env.TFNSW_API_KEY ||
            process.env.NSW_OPENDATA_API_KEY;
          if (ptvSubscriptionKey) {
            const responses = await Promise.allSettled(
              PTV_FEEDS.map(async (source) => {
                const feed = await fetchFeed(source.baseUrl, "/vehicle-positions", ptvSubscriptionKey);
                return buildPtvLiveTrains(feed, source);
              }),
            );
            ptvTrains = responses
                .filter((result): result is PromiseFulfilledResult<Array<Record<string, unknown>>> => result.status === "fulfilled")
                .flatMap((result) => result.value);
          }
          if (nswTransportApiKey) {
            const response = await fetch(NSW_TRAINS_VEHICLE_POSITIONS_URL, {
              headers: {
                Authorization: `apikey ${nswTransportApiKey}`,
                Accept: "application/x-google-protobuf",
              },
            });
            if (response.ok) {
              const buffer = await response.arrayBuffer();
              const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
              nswTrains = buildNswLiveTrains(feed);
            }
          }
          const trains = mergeLiveTrainLists([...ptvTrains, ...nswTrains], trackedTrains);
          sendJson(res, 200, { trains });
          return;
        }

        if (req.url === "/api/ptv/live-buses") {
          if (!ptvSubscriptionKey) {
            sendJson(res, 200, { buses: [] });
            return;
          }

          const feed = await fetchFeed(PTV_BUS_BASE_URL, "/vehicle-positions", ptvSubscriptionKey);
          const buses = buildPtvLiveSurfaceVehicles(feed, {
            fallbackRoute: "Bus",
            operator: "PTV Bus",
          });
          sendJson(res, 200, { buses });
          return;
        }

        if (req.url === "/api/ptv/live-trams") {
          if (!ptvSubscriptionKey) {
            sendJson(res, 200, { trams: [] });
            return;
          }

          const feed = await fetchFeed(PTV_TRAM_BASE_URL, "/vehicle-positions", ptvSubscriptionKey);
          const trams = buildPtvLiveSurfaceVehicles(feed, {
            fallbackRoute: "Tram",
            operator: "Yarra Trams",
          });
          sendJson(res, 200, { trams });
          return;
        }

        if (req.url?.startsWith("/api/consist/")) {
          const consist = req.url.replace("/api/consist/", "").split("/")[0]?.trim().toUpperCase();
          if (!consist) {
            sendJson(res, 400, { error: "Missing consist" });
            return;
          }

          const snapshot = await loadConsistSnapshot(consist);
          const currentTrip = snapshot.data.currentTrip;
          const nextTrip = snapshot.data.nextTrip;

          sendJson(res, 200, {
            consist,
            as_of: new Date().toISOString(),
            status: currentTrip ? "active" : nextTrip ? "idle" : "finished",
            current_trip: currentTrip
              ? {
                  id: currentTrip.tripId,
                  origin: currentTrip.origin,
                  destination: currentTrip.destination,
                  departs: currentTrip.departureTime,
                  arrives: currentTrip.arrivalTime,
                  date: currentTrip.date,
                  consist_label: currentTrip.consist,
                  url: `${TRANSPORTVIC_BASE_URL}${currentTrip.url}`,
                }
              : null,
            position: snapshot.position
              ? {
                  vehicle_stop_status: snapshot.position.status === "between" ? "IN_TRANSIT_TO" : "STOPPED_AT",
                  current_stop: snapshot.position.currentStop.stopName,
                  current_stop_time: snapshot.position.currentStop.time,
                  next_stop: snapshot.position.nextStop?.stopName ?? null,
                  next_stop_time: snapshot.position.nextStop?.time ?? null,
                  lat: snapshot.gps?.lat ?? null,
                  lng: snapshot.gps?.lng ?? null,
                  progress_pct: snapshot.gps ? Math.round(snapshot.gps.progress * 100) : null,
                }
              : null,
            next_trip: nextTrip
              ? {
                  id: nextTrip.tripId,
                  origin: nextTrip.origin,
                  destination: nextTrip.destination,
                  departs: nextTrip.departureTime,
                  arrives: nextTrip.arrivalTime,
                  url: `${TRANSPORTVIC_BASE_URL}${nextTrip.url}`,
                }
              : null,
            network_alerts: snapshot.alerts,
            _meta: {
              source: "transportvic.me",
              note: "Position is interpolated between published stop timings, not GPS telemetry.",
            },
          });
          return;
        }

        if (req.url === "/api/metro-notify/alerts") {
          const alerts = await fetchMetroHealthboardAlerts();
          sendJson(res, 200, { alerts });
          return;
        }

        next();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected PTV proxy error";
        sendJson(res, 502, { error: message });
      }
    });
  };

  return {
    name: "ptv-realtime-proxy",
    configureServer(server) {
      registerMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      registerMiddleware(server.middlewares);
    },
  };
}

function githubPagesSpaFallback(): Plugin {
  return {
    name: "github-pages-spa-fallback",
    closeBundle() {
      const outputDirectory = path.resolve(import.meta.dirname, "dist");
      copyFileSync(
        path.join(outputDirectory, "index.html"),
        path.join(outputDirectory, "404.html"),
      );
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = Number(env.PORT || process.env.PORT || 5173);
  // The primary deployment is served from the root of transit-alert.com.
  // GitHub Pages builds explicitly set BASE_PATH=/transit-alert/ in package.json.
  // Defaulting every production build to the Pages subdirectory makes the
  // custom domain request HTML instead of its JS/CSS bundles.
  const basePath = env.BASE_PATH || process.env.BASE_PATH || "/";
  const runtimeConfig: RuntimeConfig = {
    ptvSubscriptionKey:
      env.PTV_SUBSCRIPTION_KEY ||
      env.PTV_subscription_key ||
      env.OCP_APIM_SUBSCRIPTION_KEY ||
      env.PTV_API_KEY ||
      process.env.PTV_SUBSCRIPTION_KEY ||
      process.env.PTV_subscription_key ||
      process.env.OCP_APIM_SUBSCRIPTION_KEY ||
      process.env.PTV_API_KEY,
    telegramBotToken:
      env.TELEGRAM_BOT_TOKEN ||
      env.BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.BOT_TOKEN,
    adminUsername: env.ADMIN_USERNAME || process.env.ADMIN_USERNAME || "tyler",
    // Dev-only: a random per-run password (printed below) instead of a published default.
    adminPassword: env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || devAdminPassword(),
    trackedConsists: (env.TRACKED_CONSISTS || process.env.TRACKED_CONSISTS || "430M")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  };

  return {
    base: basePath,
    plugins: [
      ptvRealtimePlugin(runtimeConfig),
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      githubPagesSpaFallback(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          // Vendor libraries change far less often than app code and the
          // growing data/bus-fleet/*.json imports (currently ~530KB raw,
          // and set to grow with each new operator import) — splitting both
          // out of the main app chunk means a deploy that only touches app
          // code doesn't force browsers to re-download either, and the two
          // can load in parallel with the app chunk on first visit instead
          // of one ~2.5MB blocking bundle.
          manualChunks: (id) => {
            if (id.includes("/data/bus-fleet/")) return "bus-fleet-data";
            if (id.includes("/generated-vline-gtfs") || id.includes("/generated-nsw-trainlink-gtfs")) {
              return "generated-gtfs-data";
            }
            // A single vendor bucket avoids circular chunk references between
            // finer-grained groups (react-dom/leaflet/etc. cross-import each
            // other internally), while still separating all of node_modules
            // from app code so it's cached independently across app deploys.
            if (id.includes("node_modules")) return "vendor";
          },
        },
      },
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
