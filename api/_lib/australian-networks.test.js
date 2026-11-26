import test from "node:test";
import assert from "node:assert/strict";
import { csvRows, modeForRoute } from "./australian-networks.js";
import { normalizeFeed } from "../transit/network.js";

test("imports Perth's spaced headers, quoted commas and multiline stop names", () => {
  const rows = [...csvRows('\uFEFFstop_id, stop_name, stop_lat, stop_lon\r\n1,"Pier, North\nUpper deck",-31.9,115.8')];
  assert.deepEqual(rows, [{ stop_id: "1", stop_name: "Pier, North\nUpper deck", stop_lat: "-31.9", stop_lon: "115.8" }]);
});

test("recognizes ordinary and extended Australian route modes", () => {
  for (const [type, mode] of [[0, "tram"], [900, "tram"], [1, "metro"], [401, "metro"], [2, "train"], [106, "train"], [3, "bus"], [200, "bus"], [700, "bus"], [4, "ferry"], [1000, "ferry"], [1200, "ferry"]]) assert.equal(modeForRoute(type), mode);
});

test("old and undated vehicle positions cannot appear as live", () => {
  const now = 1_800_000_000_000;
  const vehicle = timestamp => ({ vehicle: { timestamp, position: { latitude: -33.86, longitude: 151.2 } } });
  const items = normalizeFeed({ entity: [vehicle(now / 1000 - 5), vehicle(now / 1000 - 500), vehicle(undefined), { vehicle: { position: { latitude: 0, longitude: 0 } } }] }, { id: "test" }, "vehicles", now);
  assert.deepEqual(items.map(i => i.status), ["live", "stale", "unavailable"]);
});

test("expired notices disappear, future replacement works remain upcoming, unsafe URLs are omitted", () => {
  const now = 1_800_000_000_000, time = now / 1000;
  const feed = { header: { timestamp: time }, entity: [
    { id: "expired", alert: { activePeriod: [{ end: time - 1 }] } },
    { id: "works", alert: { activePeriod: [{ start: time + 100 }], headerText: { translation: [{ text: "Buses replace trains" }] }, url: { translation: [{ text: "javascript:alert(1)" }] } } },
  ] };
  const notices = normalizeFeed(feed, { id: "sydneytrains" }, "alerts", now);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].replacementBus, true);
  assert.equal(notices[0].upcoming, true);
  assert.equal(notices[0].url, undefined);
});

test("departure boards preserve cancellations and skipped stops, and never invent times from delays", () => {
  const now = 1_800_000_000_000, time = now / 1000;
  const feed = { header: { timestamp: time }, entity: [{ tripUpdate: { trip: { tripId: "trip", routeId: "F1", scheduleRelationship: 3 }, stopTimeUpdate: [
    { stopId: "wharf", departure: { time: time + 300 }, scheduleRelationship: 1 },
    { stopId: "no-absolute-time", departure: { delay: 300 } },
    { stopId: "past", departure: { time: time - 300 } },
  ] } }] };
  const departures = normalizeFeed(feed, { id: "ferries" }, "updates", now);
  assert.equal(departures.length, 1);
  assert.equal(departures[0].stopId, "wharf");
  assert.equal(departures[0].cancelled, true);
  assert.equal(departures[0].skipped, true);
  assert.equal(departures[0].status, "predicted");
});
