import test from "node:test";
import assert from "node:assert/strict";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { feedBearing } from "./vehicle-bearing.js";

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const decodePosition = (position) => FeedMessage.decode(FeedMessage.encode(FeedMessage.create({
  header: { gtfsRealtimeVersion: "2.0" },
  entity: [{ id: "a", vehicle: { position } }],
})).finish()).entity[0].vehicle.position;

test("a GTFS-R position without a bearing is not read as due north", () => {
  const position = decodePosition({ latitude: -37.8, longitude: 145 });
  assert.equal(position.bearing, 0); // the decoder's default
  assert.equal(feedBearing(position), undefined);
});

test("a real bearing, including an explicit 0, is kept", () => {
  assert.equal(feedBearing(decodePosition({ latitude: -37.8, longitude: 145, bearing: 0 })), 0);
  assert.equal(feedBearing(decodePosition({ latitude: -37.8, longitude: 145, bearing: 225 })), 225);
  assert.equal(feedBearing({ bearing: "90" }), 90);
});

test("null, missing and out-of-range JSON bearings are ignored", () => {
  for (const position of [undefined, {}, { bearing: null }, { bearing: "" }, { bearing: -5 }, { bearing: 400 }, { bearing: "abc" }]) {
    assert.equal(feedBearing(position), undefined);
  }
});
