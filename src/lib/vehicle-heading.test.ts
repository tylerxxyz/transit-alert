import assert from "node:assert/strict";
import { test } from "node:test";
import { inferVehicleHeading, resolveVehicleHeading, validVehicleHeading } from "./vehicle-heading.ts";

const stops = [
  { name: "City Station", position: [-37.8, 144.9] as const },
  { name: "Middle", position: [-37.8, 145.0] as const },
  { name: "Terminus", position: [-37.8, 145.1] as const },
];

test("a single service points east outbound and west citybound on the same track", () => {
  assert.ok(Math.abs(inferVehicleHeading([-37.8, 145.05], stops, "Terminus")! - 90) < 1);
  assert.ok(Math.abs(inferVehicleHeading([-37.8, 145.05], stops, "City")! - 270) < 1);
});

test("short working reverses toward its intermediate destination", () => {
  assert.ok(Math.abs(inferVehicleHeading([-37.8, 145.05], stops, "Middle")! - 270) < 1);
  assert.ok(Math.abs(inferVehicleHeading([-37.8, 144.95], stops, "Middle")! - 90) < 1);
});

test("track geometry can run south toward the city", () => {
  const northSouth = [
    { name: "City", position: [-37.9, 145] as const },
    { name: "Terminus", position: [-37.7, 145] as const },
  ];
  assert.equal(inferVehicleHeading([-37.8, 145], northSouth, "City"), 180);
  assert.equal(inferVehicleHeading([-37.8, 145], northSouth, "Terminus"), 0);
});

test("a selected service follows its verified local segment rather than a straight line to destination", () => {
  const verifiedStops = [
    { name: "Origin", position: [-37.8, 144.9] as const },
    { name: "Junction", position: [-37.8, 145.1] as const },
    { name: "Destination", position: [-38, 145.1] as const },
  ];
  assert.ok(Math.abs(inferVehicleHeading([-37.8, 145], verifiedStops, "Destination")! - 90) < 1);
  assert.equal(inferVehicleHeading([-37.9, 145.1], verifiedStops, "Destination"), 180);
});

test("unknown or unsupported locations do not invent an arrow", () => {
  assert.equal(inferVehicleHeading([-37.8, 145], stops, "Unknown"), undefined);
  assert.equal(inferVehicleHeading([-37.8, 145], [stops[0]], "City"), undefined);
  assert.equal(inferVehicleHeading([-37, 145], stops, "Terminus"), undefined);
  assert.equal(inferVehicleHeading(stops[2].position, stops, "Terminus"), undefined);
  assert.equal(inferVehicleHeading(stops[0].position, [stops[0], stops[0]], "City"), undefined);
});

test("north is a valid live bearing; invalid readings cannot become north", () => {
  assert.equal(validVehicleHeading(0), 0);
  assert.equal(validVehicleHeading(360), 0);
  assert.equal(validVehicleHeading(270), 270);
  for (const heading of [undefined, NaN, Infinity, -1, 361]) assert.equal(validVehicleHeading(heading), undefined);
});

test("a train stopped after reversing follows the track, not its stale arrival bearing", () => {
  // Arrived heading east (90); now departing west (270) toward the city.
  assert.equal(resolveVehicleHeading(90, 270), 270);
  // A feed bearing that broadly agrees with the track is kept for precision.
  assert.equal(resolveVehicleHeading(250, 270), 250);
  assert.equal(resolveVehicleHeading(355, 10), 355);
  assert.equal(resolveVehicleHeading(undefined, 180), 180);
  assert.equal(resolveVehicleHeading(45, undefined), 45);
  assert.equal(resolveVehicleHeading(NaN, undefined), undefined);
});
