import { test } from "node:test";
import assert from "node:assert/strict";
import {
  directionAgreement,
  isSameTrip,
  matchDeparturesToLiveVehicles,
  normaliseTripKey,
  tripNumberFromTripId,
  vehicleMatchesTripKey,
} from "./tram-run-matching.ts";

const STOP: [number, number] = [-37.8136, 144.9631];
const NOW = Date.parse("2026-11-10T08:00:00Z");
const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
// ~110 m north of the stop per 0.001 degree of latitude.
const tram = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  tripId: `03-86--7-T5-${id}`,
  route: "86",
  lat: STOP[0] + 0.002,
  lng: STOP[1],
  ...extra,
});

test("realtime and static trip IDs for the same trip compare equal", () => {
  assert.equal(normaliseTripKey("03-86--7-T5-142606618"), normaliseTripKey("03-86--5-T5-142606618"));
  assert.ok(isSameTrip("03-86--7-T5-142606618", "03-86--5-T5-142606618"));
  assert.ok(!isSameTrip("03-86--7-T5-142606618", "03-86--7-T5-142606619"));
  assert.ok(!isSameTrip(undefined, undefined));
  assert.equal(tripNumberFromTripId("03-86--5-T5-142606618"), "142606618");
});

test("focus keys follow a trip even when its service-pattern segment changes", () => {
  assert.ok(vehicleMatchesTripKey({ id: "x", tripId: "03-86--7-T5-1001" }, "03-86--5-T5-1001"));
  assert.ok(!vehicleMatchesTripKey({ id: "x", tripId: "03-86--7-T5-1002" }, "03-86--5-T5-1001"));
  assert.ok(vehicleMatchesTripKey({ id: "x", runRef: "954321" }, "954321"));
});

test("a departure's assigned fleet number picks that exact tram", () => {
  const near = tram("1", { fleetNumber: "3001" });
  const far = tram("2", { fleetNumber: "3017", lat: STOP[0] + 0.01 });
  const [match] = matchDeparturesToLiveVehicles(
    [{ route: "86", destination: "Docklands", expectedAt: inMinutes(4), fleetNumber: "3017" }],
    [near, far],
    STOP,
    { now: NOW },
  );
  assert.equal(match?.vehicle, far);
  assert.equal(match?.confidence, "vehicle");
});

test("a named tram missing from the feed is not swapped for another tram", () => {
  const [match] = matchDeparturesToLiveVehicles(
    [{ route: "86", destination: "Docklands", expectedAt: inMinutes(3), fleetNumber: "3099" }],
    [tram("1", { fleetNumber: "3001", destination: "Docklands" })],
    STOP,
    { now: NOW },
  );
  assert.equal(match, null);
});

test("v3 fallback vehicles match by run reference", () => {
  const vehicle = { id: "954321", tripId: "954321", runRef: "954321", route: "86", lat: STOP[0] + 0.05, lng: STOP[1] };
  const [match] = matchDeparturesToLiveVehicles([{ route: "86", expectedAt: inMinutes(30), runRef: "954321" }], [vehicle], STOP, { now: NOW });
  assert.equal(match?.vehicle, vehicle);
  assert.equal(match?.confidence, "run");
});

test("a tram heading the other way is never offered for a departure", () => {
  const wrongWay = tram("1", { destination: "Bundoora RMIT" });
  const [match] = matchDeparturesToLiveVehicles(
    [{ route: "86", destination: "Docklands", expectedAt: inMinutes(2) }],
    [wrongWay],
    STOP,
    { now: NOW },
  );
  assert.equal(match, null);
  assert.equal(directionAgreement({ route: "86", destination: "Docklands" }, wrongWay), "opposite");
});

test("v3 direction IDs are compared like-for-like", () => {
  assert.equal(directionAgreement({ route: "86", ptvDirectionId: "4" }, tram("1", { ptvDirectionId: "4" })), "same");
  assert.equal(directionAgreement({ route: "86", ptvDirectionId: "4" }, tram("1", { ptvDirectionId: "5" })), "opposite");
  assert.equal(directionAgreement({ route: "86", destination: "Destination unavailable" }, tram("1")), "unknown");
});

test("two upcoming departures on one line get two different trams, nearest to soonest", () => {
  const nearest = tram("1", { destination: "Docklands", lat: STOP[0] + 0.001 });
  const next = tram("2", { destination: "Docklands", lat: STOP[0] + 0.008 });
  const [first, second] = matchDeparturesToLiveVehicles(
    [
      { route: "86", destination: "Docklands", expectedAt: inMinutes(9) },
      { route: "86", destination: "Docklands", expectedAt: inMinutes(1) },
    ],
    [next, nearest],
    STOP,
    { now: NOW },
  );
  assert.equal(second?.vehicle, nearest);
  assert.equal(first?.vehicle, next);
  assert.equal(first?.confidence, "estimated");
});

test("other routes, far-off trams, cancelled and distant-future departures are not guessed", () => {
  const otherRoute = tram("1", { route: "96", destination: "Docklands" });
  const farAway = tram("2", { destination: "Docklands", lat: STOP[0] + 0.05 });
  const near = tram("3", { destination: "Docklands" });
  const results = matchDeparturesToLiveVehicles(
    [
      { route: "86", destination: "Docklands", expectedAt: inMinutes(3), status: "cancelled" },
      { route: "86", destination: "Docklands", expectedAt: inMinutes(45) },
    ],
    [otherRoute, farAway, near],
    STOP,
    { now: NOW },
  );
  assert.deepEqual(results, [null, null]);
});

test("an exactly-matched tram is not also handed to a later departure as a guess", () => {
  const only = tram("1", { destination: "Docklands", fleetNumber: "3001" });
  const [exact, guess] = matchDeparturesToLiveVehicles(
    [
      { route: "86", destination: "Docklands", expectedAt: inMinutes(12), fleetNumber: "3001" },
      { route: "86", destination: "Docklands", expectedAt: inMinutes(2) },
    ],
    [only],
    STOP,
    { now: NOW },
  );
  assert.equal(exact?.vehicle, only);
  assert.equal(guess, null);
});
