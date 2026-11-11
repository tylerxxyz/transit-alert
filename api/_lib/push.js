import crypto from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import webpush from "web-push";
import { dispatchFavouriteSetEvents } from "./favourite-set-notifications.js";

let cachedPushDbContext;

async function loadPushDbContext() {
  if (cachedPushDbContext !== undefined) {
    return cachedPushDbContext;
  }

  try {
    const [{ db, ensureDatabaseReady, isDatabaseConfigured }, schema] = await Promise.all([
      import("../../src/lib/db/src/index.js"),
      import("../../src/lib/db/src/schema/push.js"),
    ]);

    if (isDatabaseConfigured) {
      await ensureDatabaseReady();
    }

    cachedPushDbContext = db
      ? {
          db,
          pushSubscriptionsTable: schema.pushSubscriptionsTable,
          sentPushAlertsTable: schema.sentPushAlertsTable,
        }
      : null;
  } catch {
    cachedPushDbContext = null;
  }

  return cachedPushDbContext;
}

let vapidConfigured = false;

function ensureVapidConfigured() {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@transit-alert.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// Only real browser push services. The stored endpoint is POSTed to on
// every alert, so accepting any URL let anyone make this server send
// requests to internal addresses (SSRF).
const PUSH_SERVICE_HOST_PATTERNS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^push\.api\.chrome\.google\.com$/,
];

export function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.port && PUSH_SERVICE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

function isValidKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_=-]+$/.test(value);
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// previous is the { endpoint, auth } of a subscription the browser rotated
// away from (pushsubscriptionchange): its owner and notification filters
// carry over to the new endpoint instead of being lost, provided the caller
// proves it held that subscription by sending its auth secret.
export async function saveSubscription(subscription, userId, previous = null) {
  const context = await loadPushDbContext();
  if (
    !context ||
    !isAllowedPushEndpoint(subscription?.endpoint) ||
    !isValidKey(subscription?.keys?.p256dh) ||
    !isValidKey(subscription?.keys?.auth)
  ) {
    return false;
  }

  const { db, pushSubscriptionsTable } = context;
  const existing = await db.query.pushSubscriptionsTable.findFirst({
    where: eq(pushSubscriptionsTable.endpoint, subscription.endpoint),
  });
  // Re-registering an endpoint someone else already holds needs its secret;
  // otherwise anyone who learned an endpoint could take it over.
  if (existing && !sameSecret(existing.authKey, subscription.keys.auth)) {
    return false;
  }

  let inherited = null;
  if (previous?.endpoint && previous.endpoint !== subscription.endpoint) {
    const old = await db.query.pushSubscriptionsTable.findFirst({
      where: eq(pushSubscriptionsTable.endpoint, String(previous.endpoint)),
    });
    if (old && sameSecret(old.authKey, previous.auth)) {
      inherited = old;
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, old.endpoint));
    }
  }

  const owner = userId ?? existing?.userId ?? inherited?.userId ?? null;
  const filters = inherited
    ? { notificationCategories: inherited.notificationCategories ?? null, notificationLines: inherited.notificationLines ?? null }
    : {};
  await db
    .insert(pushSubscriptionsTable)
    .values({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      authKey: subscription.keys.auth,
      userId: owner,
      lastSeenAt: new Date(),
      ...filters,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: {
        p256dh: subscription.keys.p256dh,
        authKey: subscription.keys.auth,
        userId: owner,
        lastSeenAt: new Date(),
        ...filters,
      },
    });
  return true;
}

export async function removeSubscriptionByEndpoint(endpoint) {
  const context = await loadPushDbContext();
  if (!context || !endpoint) return false;
  const { db, pushSubscriptionsTable } = context;
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  return true;
}

// Public unsubscribe path: the caller must prove it holds the subscription.
export async function removeSubscriptionWithSecret(endpoint, auth) {
  const context = await loadPushDbContext();
  if (!context || !endpoint) return false;
  const { db, pushSubscriptionsTable } = context;
  const existing = await db.query.pushSubscriptionsTable.findFirst({
    where: eq(pushSubscriptionsTable.endpoint, String(endpoint)),
  });
  if (!existing) return true;
  if (!sameSecret(existing.authKey, auth)) return false;
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, existing.endpoint));
  return true;
}

// null clears back to "every category" (the same as a subscription that's
// never set a preference at all) — categories is otherwise the exact list of
// category ids (see ALERT_CATEGORY_DEFINITIONS below) this endpoint wants.
export async function updateSubscriptionCategories(endpoint, categories) {
  const context = await loadPushDbContext();
  if (!context || !endpoint) return false;
  const { db, pushSubscriptionsTable } = context;
  const value = Array.isArray(categories) ? categories : null;
  const updated = await db
    .update(pushSubscriptionsTable)
    .set({ notificationCategories: value })
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .returning({ endpoint: pushSubscriptionsTable.endpoint });
  return updated.length > 0;
}

// null clears back to "every line" — same contract as
// updateSubscriptionCategories above, applied as a second, independent
// filter (see filterSubscriptionsByLines below).
export async function updateSubscriptionLines(endpoint, lines) {
  const context = await loadPushDbContext();
  if (!context || !endpoint) return false;
  const { db, pushSubscriptionsTable } = context;
  const value = Array.isArray(lines) ? lines : null;
  const updated = await db
    .update(pushSubscriptionsTable)
    .set({ notificationLines: value })
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .returning({ endpoint: pushSubscriptionsTable.endpoint });
  return updated.length > 0;
}

async function getSubscriptionsForCategory(categoryId) {
  const context = await loadPushDbContext();
  if (!context) return [];
  const { db, pushSubscriptionsTable } = context;
  if (!categoryId) return db.query.pushSubscriptionsTable.findMany();
  // A null notification_categories means "every category" (the default for
  // every subscription created before this preference existed, and anyone
  // who's never touched their settings) — only a subscription that has
  // explicitly set a list, and left this category off it, gets excluded.
  return db
    .select()
    .from(pushSubscriptionsTable)
    .where(sql`${pushSubscriptionsTable.notificationCategories} IS NULL OR ${pushSubscriptionsTable.notificationCategories} @> ${JSON.stringify([categoryId])}::jsonb`);
}

// alertLines is the specific alert's own real line list (e.g. ["Sandringham
// Line"], see normaliseLiveAlert in metro-notify/alerts.js) — a subscriber
// with a line preference set only gets pushes for alerts that name one of
// their chosen lines. An alert with no specific line (or a subscriber who's
// never set this preference, notificationLines === null) is never filtered
// out by this — same "can never silently mute anyone by default" contract
// as the category filter.
// "All lines" (network-wide/station notices) and the bare "Metro" fallback
// name no specific line, so they must reach line-filtered subscribers too.
const NETWORK_WIDE_LINE_TAGS = /^(all lines|metro)$/i;

export function filterSubscriptionsByLines(subscriptions, alertLines) {
  const wantedLines = Array.isArray(alertLines) ? alertLines.filter((line) => typeof line === "string" && line.trim()) : [];
  if (wantedLines.length === 0) return subscriptions;
  if (wantedLines.some((line) => NETWORK_WIDE_LINE_TAGS.test(line.trim()))) return subscriptions;
  return subscriptions.filter((subscription) => {
    const preferredLines = subscription.notificationLines;
    if (!Array.isArray(preferredLines)) return true;
    return preferredLines.some((line) => wantedLines.includes(line));
  });
}

// V/Line's real GTFS corridor id (set as alert.corridors in
// api/_lib/ptv-disruptions.js's normalisePtvDisruption, e.g. "gippsland")
// needs mapping to the same rider-facing label used for its PUSH_LINE_GROUPS
// toggle in src/lib/push.ts — "Bairnsdale" rather than the internal
// "gippsland" id, matching the terminus name PTV/Metro actually call it.
const VLINE_CORRIDOR_LABELS = {
  gippsland: "Bairnsdale",
  geelong: "Geelong",
  ballarat: "Ballarat",
  bendigo: "Bendigo",
  seymour: "Seymour",
};

// A V/Line or bus disruption's own `lines` tag is almost always the specific
// corridor or route name (e.g. "Gippsland", "703"), never the literal word
// "V/Line" or "Bus" — so a rider's per-corridor/"Buses" preference (see
// PUSH_LINE_GROUPS in src/lib/push.ts) would never match on `lines` alone.
// `alert.mode` (set in api/_lib/ptv-disruptions.js's normalisePtvDisruption)
// reliably says which of these an alert actually is regardless of what its
// `lines` array contains, so fold in a matching synthetic tag from it — for
// V/Line, the resolved corridor label when known, falling back to the
// generic "V/Line" tag on the rare disruption whose corridor never resolved
// (no toggle matches that literal tag any more, so it only still reaches
// subscribers who haven't narrowed their line preference at all).
function getAlertModeTags(alert) {
  if (alert?.mode === "vline") {
    const labels = (Array.isArray(alert.corridors) ? alert.corridors : [])
      .map((corridor) => VLINE_CORRIDOR_LABELS[corridor])
      .filter(Boolean);
    return labels.length > 0 ? labels : ["V/Line"];
  }
  if (alert?.mode === "bus") return ["Bus"];
  return [];
}

function getAlertMatchLines(alert) {
  return [...(alert?.lines ?? []), ...getAlertModeTags(alert)];
}

// PTV's own "last modified" timestamp on a disruption record can be far
// older than a specific train service actually being cancelled under it
// (the disruption record itself may not have been touched in hours even
// though this particular service just appeared as newly affected) — so a
// freshly-pushed cancellation notification could show a misleading "about
// 10 hours ago" instead of reflecting when we actually noticed and notified
// about it. This is real data we already keep (sentPushAlertsTable is
// written the moment we push an alert), just not previously exposed to the
// frontend. Not a one-off — every alert display of "time ago" should prefer
// this over the PTV feed's own updatedAt when we have it.
export async function getSentAlertTimestamps(alertIds) {
  const context = await loadPushDbContext();
  if (!context || !alertIds.length) return new Map();
  const rows = await context.db.query.sentPushAlertsTable.findMany({
    where: inArray(context.sentPushAlertsTable.alertId, alertIds),
  });
  return new Map(rows.map((row) => [row.alertId, row.sentAt]));
}

async function markAlertSent(alertId) {
  const context = await loadPushDbContext();
  if (!context) return;
  const { db, sentPushAlertsTable } = context;
  await db.insert(sentPushAlertsTable).values({ alertId }).onConflictDoNothing();
}

// checkAndPushNewAlerts polls continuously; if one run is still sending
// pushes to every subscriber (real network time) when the next scheduled
// run starts, the old hasAlertBeenSent-then-later-markAlertSent pattern let
// both runs see "not sent yet" and both actually send — the same real
// disruption landing as two identical notifications a minute apart. Insert
// the claim row FIRST, atomically, and only send if this call is the one
// that actually inserted it (onConflictDoNothing + returning() tells us
// that) — whichever concurrent run loses the race skips sending entirely
// rather than both proceeding.
async function claimAlertForSending(alertId) {
  const context = await loadPushDbContext();
  if (!context) return false;
  const { db, sentPushAlertsTable } = context;
  const inserted = await db
    .insert(sentPushAlertsTable)
    .values({ alertId })
    .onConflictDoNothing()
    .returning({ alertId: sentPushAlertsTable.alertId });
  return inserted.length > 0;
}

async function releaseAlertClaim(alertId) {
  const context = await loadPushDbContext();
  if (!context) return;
  const { db, sentPushAlertsTable } = context;
  await db.delete(sentPushAlertsTable).where(eq(sentPushAlertsTable.alertId, alertId));
}

const MONTH_NAME_INDEX = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
const ALERT_DATE_PATTERN = new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(MONTH_NAME_INDEX).join("|")})\\b`, "gi");

// Multi-night works notices ("buses replace trains ... Sunday 6 September to
// Wednesday 9 September") are published once and never touched again in the
// feed, so updatedAt goes "stale" by the usual freshness check well before
// the closure itself ends — a closure announced 4 days ago that runs a week
// is still genuinely happening tonight. Mirrors the same widening check in
// src/lib/todays-alerts.ts: this only ever makes an alert MORE likely to
// still count as current, never less.
function parseAlertActiveWindow(text) {
  const matches = [...text.matchAll(ALERT_DATE_PATTERN)];
  if (matches.length < 2) return null;

  const toTimestamp = (day, monthName, year) => {
    const month = MONTH_NAME_INDEX[monthName.toLowerCase()];
    if (month === undefined) return Number.NaN;
    return new Date(year, month, Number(day), 23, 59, 59).getTime();
  };

  const first = matches[0];
  const last = matches[matches.length - 1];
  const year = new Date().getFullYear();
  const start = toTimestamp(first[1], first[2], year);
  let end = toTimestamp(last[1], last[2], year);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  if (end < start) {
    end = toTimestamp(last[1], last[2], year + 1);
  }
  return { start, end };
}

function isWithinParsedAlertWindow(alert, graceMs = 1000 * 60 * 60 * 24) {
  const window = parseAlertActiveWindow(`${alert.title ?? ""} ${alert.summary ?? ""}`);
  if (!window) return false;
  const now = Date.now();
  return now >= window.start - graceMs && now <= window.end + graceMs;
}

// Mirrors src/lib/todays-alerts.ts's isHeadlineAlert so push notifications
// only fire for the same disruptions the app itself surfaces as headlines —
// never for routine planned works or access notices.
export function isHeadlineAlert(alert) {
  const searchable = `${alert.title ?? ""} ${alert.summary ?? ""} ${alert.status ?? ""}`.toLowerCase();
  const updatedAt = alert.updatedAt ? new Date(alert.updatedAt).getTime() : Number.NaN;
  const hasValidUpdatedAt = Number.isFinite(updatedAt);
  const ageMs = hasValidUpdatedAt ? Date.now() - updatedAt : 0;

  if (/trespass|police request|police operation|person hit by train|disabled train|mechanical|signal|overhead|power fault|fault|major delay|minor delay|service disruption|delay/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 12;
  }

  if (/has been cancelled|have been cancelled|service cancelled|run cancelled|cancellation/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 12;
  }

  if (/buses replace trains|replacement buses|bus replacement|station closed|suspended/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 24 * 3 || isWithinParsedAlertWindow(alert);
  }

  return false;
}

// PTV's own disruption text is usually one real, specific sentence (what
// happened, where, how long) followed by several sentences of the SAME
// generic operational boilerplate — "Trains may remain stationary at
// platforms...", "Check information displays and listen for announcements"
// — that PTV appends near-verbatim to almost every trespasser/fault alert
// regardless of what actually happened. That's useful detail on a station
// departure board, but crammed into a push notification it buries the one
// fact that actually matters under generic filler. This keeps only the real,
// specific opening sentence(s) rather than inventing or rewording anything.
const ALERT_BOILERPLATE_SENTENCE = /check (the )?information displays|listen for announcements|trains may remain stationary|may terminate\/?originate|allow extra travel time|consider alternative travel|plan ahead|visit (ptv|our website)|for more information/i;

export function formatAlertPushBody(summary) {
  const trimmed = String(summary ?? "").trim();
  if (!trimmed) return trimmed;

  const sentences = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [trimmed];
  const kept = [];
  let length = 0;
  for (const sentence of sentences) {
    if (ALERT_BOILERPLATE_SENTENCE.test(sentence)) break;
    kept.push(sentence.trim());
    length += sentence.length;
    if (length >= 140) break;
  }

  const result = kept.join(" ").trim();
  if (result) return result;
  // Every sentence looked like boilerplate (or there was only one long run-on
  // sentence) — fall back to a plain length cap rather than dropping the
  // notification body entirely.
  return trimmed.length > 160 ? `${trimmed.slice(0, 157).trimEnd()}...` : trimmed;
}

// PTV's own alert.title is frequently just a severity classification —
// "Minor Delay", "Major Delay", "Service Alert" — with no hint of what
// actually happened, even though the real cause is one clause away in the
// summary ("Delays up to 10 minutes due to a disruptive passenger at
// Caulfield."). A bare "Minor Delay" push notification title tells a rider
// nothing they couldn't already guess; pulling the real "due to ..." clause
// out of the (already-cleaned) body into the title applies to every alert
// this generic, not just one kind — trespassers, faults, cancellations, etc.
// all use the same "due to X" phrasing in the real feed.
// "Service Change" is one of PTV's own real generic category titles (see
// ALERT_TYPE_LABELS.service in metro-notify/alerts.js) — confirmed missing
// live: a real "disruptive passenger" delay came through titled plain
// "Service Change" even though the body already had the real cause,
// because this pattern only recognised "delay/disruption/alert" as the
// generic second word, not "change".
const GENERIC_ALERT_TITLE = /^(minor|major|service)?\s*(delay|delays|disruption|alert|service alert|change)s?$/i;

export function formatAlertPushTitle(rawTitle, cleanedBody) {
  const title = String(rawTitle ?? "").trim();
  if (!title || !GENERIC_ALERT_TITLE.test(title)) return title || "TransitAlert";
  const causeMatch = String(cleanedBody ?? "").match(/\bdue to ([^.,;]+)/i);
  return causeMatch ? `${title} due to ${causeMatch[1].trim()}` : title;
}

// alert.lines already carries the real, specific corridor this disruption
// was fetched for (Metro's healthboard is queried one line at a time — see
// normaliseLiveAlert in metro-notify/alerts.js) but a generic alert body like
// "Delays up to 10 minutes due to extreme weather." never repeats it, so a
// push notification built from the body alone reads as systemwide even when
// it's really one line. "All lines"/"Trams"/a bare station name aren't a
// useful corridor label here, so those are filtered out rather than shown.
function getAlertLineLabel(alert) {
  const lines = Array.isArray(alert?.lines) ? alert.lines.filter((line) => typeof line === "string" && line.trim()) : [];
  const meaningful = lines
    .map((line) => line.trim())
    .filter((line) => !/^all lines$/i.test(line) && !/\bstation\b/i.test(line) && line.toLowerCase() !== "trams" && line.toLowerCase() !== "metro");
  return meaningful.length ? meaningful.join(", ") : null;
}

export function withAlertLineLabel(alert, body) {
  const lineLabel = getAlertLineLabel(alert);
  if (!lineLabel || !body) return body;
  if (body.toLowerCase().includes(lineLabel.toLowerCase())) return body;
  return `${lineLabel}: ${body}`;
}

const PUSH_DELIVERY_TIMEOUT_MS = 10_000;
const PUSH_DELIVERY_CONCURRENCY = 20;

async function deliverPushToSubscriptions(subscriptions, payload) {
  const body = JSON.stringify(payload);
  let succeeded = 0;

  const deliverOne = async (subscription) => {
    // Old rows may predate endpoint validation; never POST to anything that
    // isn't a real push service.
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      await removeSubscriptionByEndpoint(subscription.endpoint).catch(() => undefined);
      return;
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.authKey },
        },
        body,
        // Without a timeout, one endpoint that accepts the connection and
        // never answers stalled the whole alert loop indefinitely.
        { timeout: PUSH_DELIVERY_TIMEOUT_MS },
      );
      succeeded += 1;
    } catch (error) {
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removeSubscriptionByEndpoint(subscription.endpoint).catch(() => undefined);
      } else {
        console.error("[transitalert-push] Failed to deliver push", subscription.endpoint, error?.message ?? error);
      }
    }
  };

  for (let index = 0; index < subscriptions.length; index += PUSH_DELIVERY_CONCURRENCY) {
    await Promise.all(subscriptions.slice(index, index + PUSH_DELIVERY_CONCURRENCY).map(deliverOne));
  }

  return { attempted: subscriptions.length, succeeded, vapidConfigured: true };
}

// categoryId is optional — admin/test/announcement sends omit it and reach
// every subscriber regardless of preference (those are one-off deliberate
// actions, not routine alert traffic a rider would want to mute), while the
// real alert-sending paths below always pass one so a subscriber's
// notification preferences are actually respected. alertLines is likewise
// optional and only ever passed by the real alert-sending paths.
export async function sendPushToAllSubscriptions(payload, categoryId, alertLines) {
  if (!ensureVapidConfigured()) return { attempted: 0, succeeded: 0, vapidConfigured: false };
  const subscriptions = filterSubscriptionsByLines(await getSubscriptionsForCategory(categoryId), alertLines);
  return deliverPushToSubscriptions(subscriptions, payload);
}

// Mirrors ALERT_FILTERS/getAlertFilter in src/pages/TodaysAlerts.tsx — keep
// the two in sync by hand. Duplicated rather than shared because the
// frontend (Vite/React) and this API layer (plain Node ESM) are different
// runtime/bundler contexts with no easy common import path — the same
// tradeoff already made for fleet-type classification between
// api/_lib/fleet-tracking.js and src/pages/Home.tsx.
const ALERT_CATEGORY_DEFINITIONS = [
  { id: "trespasser", keywords: ["trespasser", "trespass", "person near the tracks", "person on the tracks"] },
  { id: "police-request", keywords: ["police request", "police operation", "police presence", "police investigation", "police incident"] },
  { id: "cancellation", keywords: ["has been cancelled", "have been cancelled", "service has been cancelled", "cancellation", "run cancelled"] },
  { id: "faulty-train", trainSpecific: true, keywords: ["faulty train", "disabled train", "train fault", "mechanical fault", "mechanical issue", "equipment fault", "broken down train"] },
  { id: "track-fault", trainSpecific: true, keywords: ["track fault", "signalling", "signal fault", "points fault", "overhead fault", "power fault", "infrastructure fault"] },
  { id: "bus-replacement", keywords: ["bus replacement", "replacement bus", "buses replace trains", "replacement buses", "buses will replace trains", "coach replacement", "coach service"] },
  { id: "works-upgrade", keywords: ["planned work", "works", "maintenance", "upgrade", "big build", "occupation", "level crossing removal"] },
  { id: "station-access", keywords: ["station detour", "access", "exit", "lift outage", "escalator", "entrance closed", "platform closure"] },
  { id: "delay", keywords: ["delay", "major delays", "delayed", "service change", "service disruption"] },
];

export function getAlertCategoryId(alert) {
  const searchable = `${alert?.title ?? ""} ${alert?.summary ?? ""} ${(alert?.lines ?? []).join(" ")}`.toLowerCase();
  const isTrainOnlyExempt = alert?.mode === "tram" || alert?.mode === "bus";
  const match = ALERT_CATEGORY_DEFINITIONS.find(
    (category) =>
      !(category.trainSpecific && isTrainOnlyExempt) &&
      category.keywords.some((keyword) => searchable.includes(keyword)),
  );
  return match?.id ?? "other";
}

// Real per-account targeting rather than a blind broadcast — this app has a
// real, multi-account auth system (appUsersTable), so "notify a specific
// person" has to actually mean their account's own subscriptions, not
// everyone who happens to have push enabled.
async function findUserIdByEmail(email) {
  const context = await loadPushDbContext();
  if (!context) return null;
  const { appUsersTable } = await import("../../src/lib/db/src/schema/auth.js");
  const user = await context.db.query.appUsersTable.findFirst({
    where: eq(appUsersTable.email, email.toLowerCase()),
  });
  return user?.id ?? null;
}

export async function sendPushToUserEmail(email, payload) {
  if (!ensureVapidConfigured()) return { attempted: 0, succeeded: 0, vapidConfigured: false };
  const context = await loadPushDbContext();
  if (!context) return { attempted: 0, succeeded: 0, vapidConfigured: true };
  const userId = await findUserIdByEmail(email);
  if (!userId) return { attempted: 0, succeeded: 0, vapidConfigured: true, userFound: false };
  const subscriptions = await context.db.query.pushSubscriptionsTable.findMany({
    where: eq(context.pushSubscriptionsTable.userId, userId),
  });
  return deliverPushToSubscriptions(subscriptions, payload);
}

export async function sendTestPush() {
  return sendPushToAllSubscriptions({
    title: "Welcome to Metro",
    body: "Welcome to World",
    url: "./alerts/today",
    tag: "transitalert-test",
  });
}

// No real trespasser incident or track fault is currently active, so these
// are clearly labelled as drills rather than invented as if they were real
// live disruptions — never send a mock alert without making it obvious
// it's a mock.
export async function sendMockSafetyTestPushes() {
  const mocks = [
    {
      title: "TEST — Trespasser incident (not real)",
      body: "This is a drill notification only. Trains may be delayed while Metro Trains respond to a person on the tracks.",
      tag: "transitalert-mock-trespasser",
    },
    {
      title: "TEST — Track fault (not real)",
      body: "This is a drill notification only. A track fault is affecting services in this area.",
      tag: "transitalert-mock-track-fault",
    },
  ];

  const results = [];
  for (const mock of mocks) {
    const result = await sendPushToAllSubscriptions({ ...mock, url: "./alerts/today" });
    results.push({ title: mock.title, ...result });
  }
  return { pushes: results };
}

// Sends real, current disruption alerts (not fabricated test copy) so the
// user can confirm what an actual alert push looks and reads like, without
// waiting for isHeadlineAlert's stricter severity/age filter to naturally
// qualify one. Marks each as sent so the normal 60s watch loop doesn't
// immediately re-deliver the same ones a second time.
export async function sendRecentAlertsTestBatch(count = 5) {
  if (!ensureVapidConfigured()) return { attempted: 0, succeeded: 0, alerts: [] };

  const { fetchMergedMetroAlerts } = await import("../metro-notify/alerts.js");
  const alerts = await fetchMergedMetroAlerts();
  const recentAlerts = [...alerts]
    .filter((alert) => alert.title && alert.summary)
    .sort((left, right) => new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime())
    .slice(0, count);

  const results = [];
  for (const alert of recentAlerts) {
    const body = formatAlertPushBody(alert.summary);
    const title = formatAlertPushTitle(alert.title, body);
    const result = await sendPushToAllSubscriptions({
      title,
      body,
      url: "./alerts/today",
      tag: alert.id,
    });
    if (result?.succeeded > 0) await markAlertSent(alert.id);
    results.push({ id: alert.id, title, ...result });
  }
  return { alerts: results };
}

// The "down" alert (id "transitalert-tram-feed-down") is claimed once and
// stays claimed for as long as the outage lasts, so it never repeats. That
// same claim doubles as "we already told everyone it's down" state here:
// once it's gone (feed genuinely back up + claim released), announce the
// recovery and release the claim so a future, separate outage can alert
// again from scratch.
async function checkTramFeedRecovery() {
  const context = await loadPushDbContext();
  if (!context) return;
  const wasDown = await context.db.query.sentPushAlertsTable.findFirst({
    where: eq(context.sentPushAlertsTable.alertId, "transitalert-tram-feed-down"),
  });
  if (!wasDown) return;

  const { checkTramFeedStatus } = await import("../ptv/live-trams.js");
  const status = await checkTramFeedStatus().catch(() => ({ down: true }));
  if (status.down) return;

  await releaseAlertClaim("transitalert-tram-feed-down");
  const result = await sendPushToAllSubscriptions({
    title: "Tram Tracking Back Online",
    body: "Live tram tracking has resumed — PTV's tram data feed is back up.",
    url: "./alerts/today",
    tag: "transitalert-tram-feed-recovered",
  }, "tram-tracking");
  // If nobody was actually reachable, don't act like this was announced —
  // let the next run try again with a fresh check.
  if (!(result?.succeeded > 0)) {
    await markAlertSent("transitalert-tram-feed-down");
  }
}

export async function checkFavouriteSetServices() {
  const context = await loadPushDbContext();
  if (!context || !ensureVapidConfigured()) return;
  const { ensureLiveTrainsFresh, getFreshCachedLiveTrains } = await import("../ptv/live-trains.js");
  await ensureLiveTrainsFresh();
  const { userPreferencesTable } = await import("../../src/lib/db/src/schema/auth.js");
  const { db, pushSubscriptionsTable } = context;
  await dispatchFavouriteSetEvents(getFreshCachedLiveTrains(), {
    listUsers: async () => [...new Set((await db.select({ userId: pushSubscriptionsTable.userId }).from(pushSubscriptionsTable)).map(row => row.userId).filter(Boolean))],
    readUser: async (userId) => {
      const [preferences, subscriptions] = await Promise.all([
        db.query.userPreferencesTable.findFirst({ where: eq(userPreferencesTable.userId, userId) }),
        db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId)),
      ]);
      return { preferences, subscriptions };
    },
    claim: claimAlertForSending,
    deliver: (subscription, payload) => deliverPushToSubscriptions([subscription], payload),
  });
}

// Save account-wide push filters atomically, independently of favourite sets.
// Endpoint ownership is checked before touching either account or device settings.
export async function saveUserPushPreferences(userId, endpoint, patch) {
  const context = await loadPushDbContext();
  if (!context || !userId) return false;
  const { userPreferencesTable } = await import("../../src/lib/db/src/schema/auth.js");
  const { db, pushSubscriptionsTable } = context;
  return db.transaction(async (tx) => {
    const owner = await tx.query.pushSubscriptionsTable.findFirst({ where: eq(pushSubscriptionsTable.endpoint, endpoint) });
    if (owner?.userId !== userId) return false;
    await tx.insert(userPreferencesTable).values({ userId }).onConflictDoNothing();
    let app = sql`${userPreferencesTable.appPreferences}`;
    const device = {};
    if (patch.categories !== undefined) {
      app = sql`jsonb_set(${app}, '{pushNotificationCategories}', ${JSON.stringify(patch.categories)}::jsonb)`;
      device.notificationCategories = patch.categories;
    }
    if (patch.lines !== undefined) {
      app = sql`jsonb_set(${app}, '{pushNotificationLines}', ${JSON.stringify(patch.lines)}::jsonb)`;
      device.notificationLines = patch.lines;
    }
    await tx.update(userPreferencesTable).set({ appPreferences: app, updatedAt: new Date() }).where(eq(userPreferencesTable.userId, userId));
    await tx.update(pushSubscriptionsTable).set(device).where(eq(pushSubscriptionsTable.userId, userId));
    return true;
  });
}

export async function readUserPushPreferences(userId) {
  const context = await loadPushDbContext();
  if (!context) return null;
  const { userPreferencesTable } = await import("../../src/lib/db/src/schema/auth.js");
  const row = await context.db.query.userPreferencesTable.findFirst({ where: eq(userPreferencesTable.userId, userId) });
  return { categories: row?.appPreferences?.pushNotificationCategories ?? null, lines: row?.appPreferences?.pushNotificationLines ?? null };
}

// The 60s interval can fire again while a slow run is still delivering; two
// overlapping runs would race on claims and double-send.
let alertCheckInFlight = null;

export function checkAndPushNewAlerts() {
  if (!alertCheckInFlight) {
    alertCheckInFlight = runAlertCheck().finally(() => {
      alertCheckInFlight = null;
    });
  }
  return alertCheckInFlight;
}

async function runAlertCheck() {
  if (!ensureVapidConfigured()) return;

  await checkTramFeedRecovery().catch((error) => {
    console.warn("[push] tram feed recovery check failed:", error instanceof Error ? error.message : error);
  });
  await checkFavouriteSetServices().catch((error) => {
    console.warn("[push] favourite set service check failed:", error instanceof Error ? error.message : error);
  });

  const { fetchMergedMetroAlerts } = await import("../metro-notify/alerts.js");
  const alerts = await fetchMergedMetroAlerts();
  const headlineAlerts = alerts.filter(isHeadlineAlert);

  const claimedAlerts = [];
  for (const alert of headlineAlerts) {
    if (await claimAlertForSending(alert.id)) claimedAlerts.push(alert);
  }
  if (claimedAlerts.length === 0) return;

  // Only keep an alert marked "sent" once it actually reached a device.
  // This loop runs continuously from server start, long before anyone may
  // have subscribed yet — keeping the claim regardless meant every alert
  // that existed before the first real subscriber signed up was
  // permanently skipped and could never be delivered to them. Release the
  // claim so a later run (once someone has subscribed) can still send it.
  //
  // Only release when nobody is subscribed at all. Releasing whenever 0
  // deliveries succeeded also caught alerts every subscriber had filtered
  // out, which were then re-claimed and released every 60s forever.
  const hasAnySubscribers = (await getSubscriptionsForCategory(undefined)).length > 0;
  const releaseIfUndelivered = async (_result, ids) => {
    if (hasAnySubscribers) return;
    for (const id of ids) await releaseAlertClaim(id);
  };

  // Real PTV pattern: a single physical train taken out of service has ALL
  // of its remaining rostered workings for the day cancelled together, each
  // generating its own separate alert record even though a rider sees them
  // as "the same disruption" — a burst of 2-3 "X to Y service has been
  // cancelled" alerts landing in the same check cycle is that, not several
  // unrelated cancellations. One combined push instead of one per alert.
  const cancellations = claimedAlerts.filter((alert) => /has been cancelled|have been cancelled|service cancelled|run cancelled|cancellation/i.test(`${alert.title} ${alert.summary}`));
  const otherAlerts = claimedAlerts.filter((alert) => !cancellations.includes(alert));

  for (const alert of otherAlerts) {
    const body = withAlertLineLabel(alert, formatAlertPushBody(alert.summary));
    const result = await sendPushToAllSubscriptions({
      title: formatAlertPushTitle(alert.title, body) || "TransitAlert",
      body,
      url: "./alerts/today",
      tag: alert.id,
    }, getAlertCategoryId(alert), getAlertMatchLines(alert));
    await releaseIfUndelivered(result, [alert.id]);
  }

  if (cancellations.length === 1) {
    const [alert] = cancellations;
    const body = withAlertLineLabel(alert, formatAlertPushBody(alert.summary));
    const result = await sendPushToAllSubscriptions({
      title: formatAlertPushTitle(alert.title, body) || "TransitAlert",
      body,
      url: "./alerts/today",
      tag: alert.id,
    }, "cancellation", getAlertMatchLines(alert));
    await releaseIfUndelivered(result, [alert.id]);
  } else if (cancellations.length > 1) {
    const body = cancellations.map((alert) => withAlertLineLabel(alert, formatAlertPushBody(alert.summary))).filter(Boolean).join(" ");
    // Any subscriber interested in ANY of the involved lines should still
    // get this combined push, not just one interested in every line at once.
    const combinedLines = [...new Set(cancellations.flatMap((alert) => getAlertMatchLines(alert)))];
    const result = await sendPushToAllSubscriptions({
      title: `${cancellations.length} services cancelled`,
      body,
      url: "./alerts/today",
      tag: `combined-cancellations-${cancellations.map((alert) => alert.id).sort().join("-")}`,
    }, "cancellation", combinedLines);
    await releaseIfUndelivered(result, cancellations.map((alert) => alert.id));
  }
}
