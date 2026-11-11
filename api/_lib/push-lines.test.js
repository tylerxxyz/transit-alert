import test from "node:test";
import assert from "node:assert/strict";
import { filterSubscriptionsByLines } from "./push.js";

const everyone = { endpoint: "a", notificationLines: null };
const frankston = { endpoint: "b", notificationLines: ["Frankston Line"] };
const sandringham = { endpoint: "c", notificationLines: ["Sandringham Line"] };
const endpoints = (subs) => subs.map((sub) => sub.endpoint);

test("line-specific alerts only reach subscribers who chose that line", () => {
  assert.deepEqual(endpoints(filterSubscriptionsByLines([everyone, frankston, sandringham], ["Frankston Line"])), ["a", "b"]);
});

test("network-wide notices reach line-filtered subscribers too", () => {
  for (const lines of [["All lines", "Flinders Street Station"], ["Metro"], []]) {
    assert.deepEqual(endpoints(filterSubscriptionsByLines([everyone, frankston, sandringham], lines)), ["a", "b", "c"]);
  }
});
