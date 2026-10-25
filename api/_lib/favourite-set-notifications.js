import { getTrainFleetTypes } from "./fleet-tracking.js";

// All fleets share the same event, eligibility and wording path.
export const FAVOURITE_SET_CATEGORY = "train-tracking";
const clean = (value) => typeof value === "string" ? value.trim() : "";
const canonical = (value) => clean(value).toUpperCase();
const lineKey = (value) => clean(value).replace(/\s+line$/i, "").toLowerCase();

export function trainSetIds(train, now = Date.now()) {
  const ids = new Set(clean(train.consist).split(/\s*[-+ ,]\s*/).map(canonical).filter((id) => /\d/.test(id)));
  if (/\d/.test(clean(train.consist))) ids.add(canonical(train.consist));
  // Only verified, current allocations may identify a V/Line set.
  if (train.allocation?.serviceDate === train.serviceDate && Date.parse(train.allocation.validUntil) > now) {
    for (const id of train.allocation.setIds ?? []) ids.add(canonical(id));
  }
  for (const id of [...ids]) {
    const number = Number(id.replace(/M$/, ""));
    if (number >= 9000 && number <= 9999) ids.add(String(number));
    if (number >= 8101 && number <= 8650 && number % 100 >= 1 && number % 100 <= 50) {
      ids.add(String(8000 + number % 100));
    }
  }
  return ids;
}

export function serviceKey(train) {
  if (!clean(train.tripId) || !clean(String(train.tdn ?? "")) || !/^\d{8}$/.test(train.serviceDate ?? "")) return null;
  // TDNs recur on later operating days; trip-id aliases on the same day do not create new services.
  return `${train.serviceDate}:${canonical(String(train.tdn))}`;
}

function matches(values, actual, normalize = canonical) {
  return values == null || (Array.isArray(values) && values.some((value) => actual.map(normalize).includes(normalize(value))));
}

function inPeriod(period, minute) {
  const parse = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? "") ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  const start = parse(period?.start), end = parse(period?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Invalid notification time period");
  return start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
}

export function eligibleForFavouriteSet(subscription, preferences, set, train, now = new Date()) {
  if (!subscription?.userId || subscription.userId !== preferences?.userId) return false;
  const app = preferences.appPreferences ?? {};
  if (!Array.isArray(app.favouriteConsists) || !app.favouriteConsists.some((id) => canonical(id) === canonical(set))) return false;
  if (!trainSetIds(train, now.getTime()).has(canonical(set))) return false;
  // Explicit opt-in, account-wide; null legacy categories must never opt someone in.
  if (!Array.isArray(app.pushNotificationCategories) || !app.pushNotificationCategories.includes(FAVOURITE_SET_CATEGORY)) return false;
  if (!matches(subscription.notificationCategories, [FAVOURITE_SET_CATEGORY], clean)) return false;
  const options = app.favouriteSetNotifications ?? {};
  if (options.enabled === false || app.notificationsEnabled === false) return false;
  for (const lines of [subscription.notificationLines, app.pushNotificationLines, options.lines]) {
    if (!matches(lines, [train.line], lineKey)) return false;
  }
  const typeKey = (value) => canonical(value).replace(/[^A-Z0-9]/g, "");
  if (!matches(options.vehicleTypes, [train.trainType, train.fleetType, ...getTrainFleetTypes(train), ...(train.tripId?.startsWith("01-") ? ["V/Line"] : [])], typeKey)) return false;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: options.timeZone ?? "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const minute = Number(parts.find((part) => part.type === "hour").value) * 60 + Number(parts.find((part) => part.type === "minute").value);
    if (options.timePeriods != null && (!Array.isArray(options.timePeriods) || !options.timePeriods.some((period) => inPeriod(period, minute)))) return false;
    if (options.quietHours && options.quietHours.enabled !== false && inPeriod(options.quietHours, minute)) return false;
  } catch { return false; } // Invalid restrictions fail closed.
  return true;
}

export function favouriteSetPayload(set, train) {
  const origin = clean(train.origin), destination = clean(train.destination);
  // An unresolved feed route label is not a real trip destination.
  if (!destination || train.destinationIsFallback || !serviceKey(train)) return null;
  return {
    title: `Favourite set ${set} is now running`,
    body: `${set} is now running ${origin ? `from ${origin} to` : "to"} ${destination} · TDN ${train.tdn}`,
    url: "./",
    tag: `favourite-set:${canonical(set)}:${serviceKey(train)}`,
  };
}

function hasServiceDetails(train) {
  return Boolean(clean(train.destination) && !train.destinationIsFallback && serviceKey(train));
}

// Dependencies are injected so delivery can be tested without sending real pushes.
export async function dispatchFavouriteSetEvents(trains, { listUsers, readUser, claim, deliver, now = () => new Date() }) {
  const users = await listUsers();
  for (const train of trains) {
    const key = serviceKey(train);
    if (!key || !hasServiceDetails(train)) continue;
    if (train.timestamp && (!Number.isFinite(Date.parse(train.timestamp)) || now().getTime() - Date.parse(train.timestamp) > 5 * 60_000)) continue;
    for (const set of trainSetIds(train, now().getTime())) {
      // Observe every set/service, including when everyone has opted out, so
      // enabling alerts later doesn't announce a service already in progress.
      if (!await claim(`favourite-observed:${set}:${key}`)) continue;
      for (const userId of users) {
        let current = await readUser(userId);
        if (!current || !current.subscriptions.some((sub) => eligibleForFavouriteSet(sub, current.preferences, set, train, now()))) continue;
        if (!await claim(`favourite-sent:${JSON.stringify([userId, set, key])}`)) continue;
        // Re-read after the claim and immediately before each push. No cached
        // preference snapshot can keep delivering after an opt-out is saved.
        for (const endpoint of current.subscriptions.map((sub) => sub.endpoint)) {
          current = await readUser(userId);
          const sub = current?.subscriptions.find((item) => item.endpoint === endpoint);
          if (!eligibleForFavouriteSet(sub, current?.preferences, set, train, now())) continue;
          await deliver(sub, favouriteSetPayload(set, train));
        }
      }
    }
  }
}
