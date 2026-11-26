import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { readFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { NETWORKS, nswKey } from "../_lib/australian-networks.js";

const cache = new Map();
const geometryCache = new Map();
const unzip = promisify(gunzip);
let nswQueue = Promise.resolve();
let nswNextRequestAt = 0;
async function nswFetch(url, options) {
  const next = nswQueue.then(async () => {
    const wait = Math.max(0, nswNextRequestAt - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    nswNextRequestAt = Date.now() + 600;
    return fetch(url, options);
  });
  nswQueue = next.then(() => undefined, () => undefined);
  return next;
}
const seconds = value => value == null ? undefined : Number(value.toString());
const translated = value => value?.translation?.find(t => t.language === "en" || t.language?.startsWith("en-"))?.text || value?.translation?.[0]?.text || "";
const safeUrl = value => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } };

export function normalizeFeed(feed, source, kind, now = Date.now()) {
  const feedTimestamp = seconds(feed.header?.timestamp);
  const result = [];
  for (const entity of feed.entity || []) {
    if (kind === "vehicles") {
      const v = entity.vehicle, p = v?.position;
      if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || p.latitude < -44 || p.latitude > -9 || p.longitude < 112 || p.longitude > 154) continue;
      const timestamp = seconds(v.timestamp) || feedTimestamp;
      const age = timestamp ? now / 1000 - timestamp : undefined;
      result.push({ id: `${source.id}:${entity.id || v.vehicle?.id || result.length}`, feed: source.id, routeId: v.trip?.routeId || "", tripId: v.trip?.tripId || "", label: v.vehicle?.label || v.vehicle?.id || "Vehicle", lat: p.latitude, lng: p.longitude,
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
        status: age == null ? "unavailable" : age > 120 || age < -60 ? "stale" : "live" });
    } else if (kind === "updates" && entity.tripUpdate) {
      const update = entity.tripUpdate;
      const timestamp = seconds(update.timestamp) || feedTimestamp;
      const stale = !timestamp || now / 1000 - timestamp > 120 || timestamp - now / 1000 > 60;
      for (const stop of update.stopTimeUpdate || []) {
        const time = seconds(stop.departure?.time) || seconds(stop.arrival?.time);
        if (!time || time < now / 1000 - 60) continue;
        result.push({ stopId: stop.stopId, routeId: update.trip?.routeId || "", tripId: update.trip?.tripId || "", time: new Date(time * 1000).toISOString(),
          cancelled: update.trip?.scheduleRelationship === 3, skipped: stop.scheduleRelationship === 1, status: stale ? "stale" : "predicted" });
      }
    } else if (entity.alert) {
      const alert = entity.alert;
      const periods = (alert.activePeriod || []).map(p => ({ start: seconds(p.start), end: seconds(p.end) }));
      const time = now / 1000;
      if (periods.length && periods.every(p => p.end && p.end < time)) continue;
      const active = !periods.length || periods.some(p => (!p.start || p.start <= time) && (!p.end || p.end >= time));
      const title = translated(alert.headerText), description = translated(alert.descriptionText);
      result.push({ id: `${source.id}:${entity.id}`, feed: source.id, title, description,
        url: safeUrl(translated(alert.url)), effect: alert.effect, periods, upcoming: !active,
        replacementBus: /(?:buses?|coaches?)\s+(?:will\s+)?replac|replacement\s+(?:buses?|coaches?)|rail\s+replacement/i.test(`${title} ${description}`),
        affected: (alert.informedEntity || []).map(e => ({ routeId: e.routeId, stopId: e.stopId, tripId: e.trip?.tripId })),
        timestamp: feedTimestamp ? new Date(feedTimestamp * 1000).toISOString() : null,
        stale: !feedTimestamp || now / 1000 - feedTimestamp > 600 || feedTimestamp - now / 1000 > 60 });
    }
  }
  return result;
}

async function loadFeed(source, kind) {
  const key = `${source[kind]}`;
  const previous = cache.get(key);
  if (previous && Date.now() - previous.loadedAt < previous.ttl) return previous.promise;
  const promise = (async () => {
    if (source.auth === "nsw" && !nswKey()) throw new Error("NSW Transport API key required");
    const response = await (source.auth === "nsw" ? nswFetch : fetch)(source[kind], {
      headers: source.auth === "nsw" ? { Authorization: `apikey ${nswKey()}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (response.status === 429) cache.get(key).ttl = 60_000;
      throw new Error(`Feed unavailable (HTTP ${response.status})`);
    }
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
    return { items: normalizeFeed(feed, source, kind), timestamp: seconds(feed.header?.timestamp) ? new Date(seconds(feed.header.timestamp) * 1000).toISOString() : null };
  })();
  cache.set(key, { loadedAt: Date.now(), ttl: 20_000, promise });
  return promise;
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") return res.status(405).json({ error: "Use GET" });
  if (!req.query?.network) {
    return res.status(200).json({ networks: NETWORKS.map(({ schedules, realtime, ...network }) => ({ ...network, realtimeAvailable: realtime.length > 0 })) });
  }
  const network = NETWORKS.find(n => n.id === req.query.network);
  if (!network) return res.status(400).json({ error: "Unknown network" });
  if (req.query.stop) {
    const source = network.realtime.find(s => s.vehicles && String(req.query.stop).startsWith(`${s.id}:`));
    if (!source) return res.status(200).json({ departures: [], available: false });
    try {
      const result = await loadFeed({ ...source, updates: source.vehicles.replace("/vehiclepos/", "/realtime/").replace("/VehiclePositions", "/TripUpdates").replace("/vehicle_positions", "/trip_updates") }, "updates");
      const stopId = String(req.query.stop).slice(source.id.length + 1);
      return res.status(200).json({ available: true, timestamp: result.timestamp, departures: result.items.filter(item => item.stopId === stopId).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 20) });
    } catch {
      return res.status(200).json({ departures: [], available: false });
    }
  }
  if (req.query.route) {
    try {
      let entry = geometryCache.get(network.id);
      if (!entry || Date.now() - entry.loadedAt > 300_000) {
        entry = { loadedAt: Date.now(), promise: readFile(new URL(`../../data/networks/${network.id}.json.gz`, import.meta.url)).then(unzip).then(buffer => JSON.parse(buffer.toString("utf8"))) };
        geometryCache.set(network.id, entry);
        if (geometryCache.size > 2) geometryCache.delete(geometryCache.keys().next().value);
      }
      const shapes = await entry.promise;
      const shape = Object.hasOwn(shapes, req.query.route) ? shapes[req.query.route] : undefined;
      if (!shape) return res.status(404).json({ error: "Route geometry unavailable" });
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).json({ shape });
    } catch {
      geometryCache.delete(network.id);
      return res.status(503).json({ error: "Route geometry unavailable" });
    }
  }
  const jobs = network.realtime.flatMap(source => ["vehicles", "alerts"].filter(kind => source[kind]).map(kind => ({ source, kind })));
  const results = await Promise.allSettled(jobs.map(({ source, kind }) => loadFeed(source, kind)));
  const payload = { network: network.id, fetchedAt: new Date().toISOString(), vehicles: [], alerts: [], feeds: [] };
  results.forEach((result, i) => {
    const { source, kind } = jobs[i];
    payload.feeds.push({ id: source.id, kind, status: result.status === "fulfilled" ? "available" : "unavailable", timestamp: result.status === "fulfilled" ? result.value.timestamp : null,
      error: result.status === "rejected" ? (result.reason?.message || "Feed unavailable") : undefined });
    if (result.status === "fulfilled") payload[kind].push(...result.value.items);
  });
  res.setHeader("Cache-Control", "public, max-age=15");
  return res.status(200).json(payload);
}
