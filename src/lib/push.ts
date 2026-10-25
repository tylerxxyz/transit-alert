import { buildSessionHeaders } from "@/lib/session-token";
import { getApiUrl } from "@/lib/api-config";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getExistingPushSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported()) return false;

  const keyResponse = await fetch(getApiUrl("/api/push/vapid-key"));
  if (!keyResponse.ok) return false;
  const { publicKey, configured } = (await keyResponse.json()) as {
    publicKey: string | null;
    configured: boolean;
  };
  if (!configured || !publicKey) return false;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const response = await fetch(getApiUrl("/api/push/subscribe"), {
    method: "POST",
    headers: buildSessionHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

  return response.ok;
}

// Mirrors ALERT_FILTERS in src/pages/TodaysAlerts.tsx (minus "all"/"other",
// which aren't real opt-out-able categories) plus "tram-tracking" for the
// tram data feed up/down pushes, which aren't a transit alert at all. Keep
// in sync with ALERT_CATEGORY_DEFINITIONS in api/_lib/push.js.
export const PUSH_NOTIFICATION_CATEGORIES: { id: string; label: string }[] = [
  { id: "trespasser", label: "Trespassers" },
  { id: "police-request", label: "Police request" },
  { id: "cancellation", label: "Cancellations" },
  { id: "faulty-train", label: "Faulty train" },
  { id: "track-fault", label: "Track fault" },
  { id: "bus-replacement", label: "Bus replacement" },
  { id: "works-upgrade", label: "Works / upgrades" },
  { id: "station-access", label: "Station / access" },
  { id: "delay", label: "Delays" },
  { id: "train-tracking", label: "Favourite Set / Train Tracking" },
  { id: "tram-tracking", label: "Tram tracking status" },
];

// The server is the source of truth for delivery, but rendering checkboxes
// needs a synchronous read with no round trip — mirrors the existing
// ALERT_NOTIFICATIONS_KEY pattern in src/lib/pwa.ts. null (the default,
// stored the same as "never customised") means every category.
const PUSH_CATEGORIES_STORAGE_KEY = "transitalert-push-categories";

export function readPushCategories(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PUSH_CATEGORIES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export async function updatePushCategories(categories: string[] | null): Promise<boolean> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return false;

  const response = await fetch(getApiUrl("/api/push/preferences"), {
    method: "POST",
    headers: buildSessionHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ endpoint: subscription.endpoint, categories }),
  });

  if (response.ok && typeof window !== "undefined") {
    try {
      if (categories !== null) {
        window.localStorage.setItem(PUSH_CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
      } else {
        window.localStorage.removeItem(PUSH_CATEGORIES_STORAGE_KEY);
      }
    } catch {
      // Private browsing/storage pressure must never fail the actual save.
    }
  }

  return response.ok;
}

// Mirrors KNOWN_ALERT_LINES in src/components/TopBar.tsx — the same real
// line names an alert's own `lines` field uses (see formatLineName in
// api/metro-notify/alerts.js), so a preference saved here always matches
// what an actual alert is tagged with server-side. Flat, in case anything
// needs the plain list of real line names (e.g. validating a stored
// preference) — PUSH_LINE_GROUPS below is what the UI actually renders.
export const PUSH_LINE_OPTIONS: string[] = [
  "Metro Tunnel",
  "Werribee Line",
  "Williamstown Line",
  "Sandringham Line",
  "Frankston Line",
  "Mernda Line",
  "Hurstbridge Line",
  "Sunbury Line",
  "Cranbourne Line",
  "Pakenham Line",
  "Craigieburn Line",
  "Upfield Line",
  "Belgrave Line",
  "Lilydale Line",
  "Glen Waverley Line",
  "Alamein Line",
  "Stony Point Line",
  "City Loop",
  "Altona Loop",
];

// Sunbury, Cranbourne and Pakenham run as one continuous through-service via
// the Metro Tunnel (see METRO_TUNNEL_LINES in src/lib/interchanges.ts) — a
// real disruption on this corridor is routinely reported against all three
// line names at once, so they're offered as a single combined toggle rather
// than three separate ones a rider would have to keep in sync by hand.
// Werribee, Williamstown, Sandringham and the Altona Loop are the same real
// cross-city group (see the Gardenvale interchange note in
// src/lib/interchanges.ts, and the Altona Loop is a branch of the Werribee
// line) so they're combined the same way. Mernda/Hurstbridge (Clifton Hill
// group) and Craigieburn/Upfield (Northern group) are likewise each one
// real shared corridor, not two independent lines.
// "City Loop" was its own toggle here but isn't a real distinct line a rider
// would ride — every alert that would ever carry that tag also carries the
// specific line actually affected, which is already covered by that line's
// own toggle above, so it's dropped rather than folded anywhere.
// Colors match getLiveLineColor in src/components/Map.tsx (duplicated here
// for the same reason as ALERT_CATEGORY_DEFINITIONS in api/_lib/push.js —
// no shared import path between this and the map's runtime).
export type PushLineGroup = { label: string; lines: string[]; color: string };

export const PUSH_LINE_GROUPS: PushLineGroup[] = [
  {
    label: "Werribee / Williamstown / Sandringham / Altona Loop",
    lines: ["Werribee Line", "Williamstown Line", "Sandringham Line", "Altona Loop"],
    color: "#F178AF",
  },
  { label: "Frankston Line", lines: ["Frankston Line"], color: "#22c55e" },
  { label: "Mernda / Hurstbridge", lines: ["Mernda Line", "Hurstbridge Line"], color: "#BE1014" },
  {
    label: "Sunbury / Cranbourne / Pakenham",
    lines: ["Sunbury Line", "Cranbourne Line", "Pakenham Line", "Metro Tunnel"],
    color: "#279FD5",
  },
  { label: "Craigieburn / Upfield", lines: ["Craigieburn Line", "Upfield Line"], color: "#FFD200" },
  {
    label: "Belgrave / Lilydale / Glen Waverley / Alamein",
    lines: ["Belgrave Line", "Lilydale Line", "Glen Waverley Line", "Alamein Line"],
    color: "#003A8F",
  },
  { label: "Stony Point Line", lines: ["Stony Point Line"], color: "#028430" },
  // V/Line's own real GTFS route_short_name already groups every regional
  // line into one of these five corridors (see VLINE_CORRIDOR_BY_ROUTE_CODE
  // in api/_lib/ptv-disruptions.js) — split out the same way here rather
  // than one catch-all "V/Line" button, so a rider who only ever takes the
  // Bairnsdale line isn't also pushed every Ballarat/Bendigo/Geelong/Seymour
  // disruption. The server resolves each alert's real corridor and matches
  // against these same labels (see getAlertModeTags in api/_lib/push.js).
  { label: "V/Line to Bairnsdale", lines: ["Bairnsdale"], color: "#7c3aed" },
  { label: "V/Line to Geelong", lines: ["Geelong"], color: "#7c3aed" },
  { label: "V/Line to Ballarat", lines: ["Ballarat"], color: "#7c3aed" },
  { label: "V/Line to Bendigo", lines: ["Bendigo"], color: "#7c3aed" },
  { label: "V/Line to Seymour", lines: ["Seymour"], color: "#7c3aed" },
  // Bus disruptions almost always carry the specific route name in their
  // real `lines` tag, not the literal word "Bus" — the server also folds in
  // a mode-based tag so this still catches every bus/tram-replacement-bus
  // alert regardless of which specific route it names.
  { label: "Buses", lines: ["Bus"], color: "#f97316" },
];

const PUSH_LINES_STORAGE_KEY = "transitalert-push-lines";

export function readPushLines(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PUSH_LINES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export async function updatePushLines(lines: string[] | null): Promise<boolean> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return false;

  const response = await fetch(getApiUrl("/api/push/preferences"), {
    method: "POST",
    headers: buildSessionHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ endpoint: subscription.endpoint, lines }),
  });

  if (response.ok && typeof window !== "undefined") {
    try {
      if (lines !== null) {
        window.localStorage.setItem(PUSH_LINES_STORAGE_KEY, JSON.stringify(lines));
      } else {
        window.localStorage.removeItem(PUSH_LINES_STORAGE_KEY);
      }
    } catch {
      // Private browsing/storage pressure must never fail the actual save.
    }
  }

  return response.ok;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!pushSupported()) return true;
  const subscription = await getExistingPushSubscription();
  if (!subscription) return true;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);

  const response = await fetch(getApiUrl("/api/push/unsubscribe"), {
    method: "POST",
    headers: buildSessionHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ endpoint }),
  });

  return response.ok;
}

export async function fetchPushPreferences(): Promise<{ categories: string[] | null; lines: string[] | null } | null> {
  const response = await fetch(getApiUrl("/api/push/preferences"), { headers: buildSessionHeaders(), credentials: "include" });
  return response.ok ? response.json() : null;
}
