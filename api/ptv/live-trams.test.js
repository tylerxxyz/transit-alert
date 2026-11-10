import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPtvLiveTrams, buildPtvV3LiveTrams } from "./live-trams.js";
import { surfaceRunIdentity } from "../_lib/ptv-timetable.js";

const position = { latitude: -37.81, longitude: 144.96 };

test("GTFS-R trams carry trip number, direction and start time, not just the route", () => {
  const index = new Map([["03-86--T5-142606618", { headsign: "Docklands", directionId: "1" }]]);
  const feed = {
    entity: [
      {
        id: "v1",
        vehicle: {
          position,
          trip: { tripId: "03-86--7-T5-142606618", routeId: "aus:vic:vic-03-86:", startTime: "07:42:00", startDate: "20261110" },
          vehicle: { id: "3001" },
        },
      },
      {
        id: "v2",
        vehicle: { position, trip: { tripId: "03-86--7-T5-142606619", routeId: "aus:vic:vic-03-86:" }, vehicle: { id: "3017" } },
      },
    ],
  };
  const [first, second] = buildPtvLiveTrams(feed, index);
  assert.equal(first.route, "86");
  assert.equal(second.route, "86");
  assert.equal(first.tripNumber, "142606618");
  assert.equal(second.tripNumber, "142606619");
  assert.equal(first.destination, "Docklands");
  assert.equal(first.directionId, "1");
  assert.equal(first.startTime, "07:42:00");
  assert.equal(first.startDate, "20261110");
  assert.equal(first.fleetNumber, "3001");
  assert.equal(second.directionId, undefined);
});

test("legacy string headsign index entries still resolve", () => {
  const index = new Map([["03-86--T5-1", "Bundoora RMIT"]]);
  const [tram] = buildPtvLiveTrams({ entity: [{ id: "a", vehicle: { position, trip: { tripId: "03-86--7-T5-1" } } }] }, index);
  assert.equal(tram.destination, "Bundoora RMIT");
});

test("v3 fallback trams keep run_ref and v3 direction", () => {
  const [tram] = buildPtvV3LiveTrams({
    runs: [{ run_ref: "954321", run_id: 954321, route_id: 1083, direction_id: 4, destination_name: "Docklands", vehicle_position: position, vehicle_descriptor: { id: "3001" } }],
  });
  assert.equal(tram.runRef, "954321");
  assert.equal(tram.tripId, "954321");
  assert.equal(tram.ptvDirectionId, "4");
  assert.equal(tram.fleetNumber, "3001");
});

test("departures expose run_ref, assigned tram and direction from expand=run", () => {
  const runs = { "954321": { run_ref: "954321", direction_id: 4, vehicle_descriptor: { id: "3017", description: "E class" } } };
  assert.deepEqual(surfaceRunIdentity({ run_ref: "954321", run_id: 954321, direction_id: 4 }, runs), {
    runRef: "954321",
    ptvDirectionId: "4",
    fleetNumber: "3017",
  });
  assert.deepEqual(surfaceRunIdentity({ run_id: -1 }, undefined), { runRef: undefined, ptvDirectionId: undefined, fleetNumber: undefined });
});
