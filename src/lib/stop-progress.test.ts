import assert from "node:assert/strict";
import { test } from "node:test";
import { getStopProgress } from "./stop-progress.ts";

const stops = ["Ripponlea", "Elsternwick", "Gardenvale", "North Brighton"];

test("between stops: last stop, next stop, then the one after", () => {
  assert.deepEqual(getStopProgress(stops, { beforeIndex: 2, progress: 0.5 }), { last: "Elsternwick", next: "Gardenvale", then: "North Brighton" });
});

test("at a platform: last stop, now at, next stop", () => {
  assert.deepEqual(getStopProgress(stops, { beforeIndex: 2, progress: 0.99 }), { last: "Elsternwick", now: "Gardenvale", then: "North Brighton" });
  assert.deepEqual(getStopProgress(stops, { beforeIndex: 2, progress: 0.01 }), { last: "Ripponlea", now: "Elsternwick", then: "Gardenvale" });
  // A published "stopped at" stop wins over the GPS projection.
  assert.deepEqual(getStopProgress(stops, { beforeIndex: 3, progress: 0.5 }, 2), { last: "Elsternwick", now: "Gardenvale", then: "North Brighton" });
});

test("ends of the line and missing positions", () => {
  assert.deepEqual(getStopProgress(stops, { beforeIndex: 1, progress: 0 }), { last: undefined, now: "Ripponlea", then: "Elsternwick" });
  assert.deepEqual(getStopProgress(stops, { beforeIndex: 3, progress: 1 }), { last: "Gardenvale", now: "North Brighton", then: undefined });
  assert.equal(getStopProgress(stops, null), null);
  assert.equal(getStopProgress([], { beforeIndex: 1, progress: 0.5 }), null);
});
