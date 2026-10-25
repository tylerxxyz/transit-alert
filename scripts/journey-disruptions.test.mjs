import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/journey-disruptions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { alertMatchesJourney, journeyDisruptionGuidance } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const rail = [{ mode: "train", title: "Sunbury", from: "Footscray", to: "Town Hall" }];
const tunnel = { title: "Metro Tunnel closed", summary: "Buses replace trains", lines: ["Metro Tunnel"], status: "suspended" };

test("a tunnel-only closure matches through corridor and tunnel station journeys", () => {
  assert.equal(alertMatchesJourney(tunnel, rail), true);
  assert.equal(alertMatchesJourney(tunnel, [{ mode: "train", title: "Metro", from: "Parkville", to: "Anzac" }]), true);
});
test("unrelated bus or walk at a tunnel station does not become a tunnel journey", () => {
  assert.equal(alertMatchesJourney(tunnel, [{ mode: "bus", title: "401", from: "Parkville", to: "Footscray" }]), false);
  assert.equal(alertMatchesJourney(tunnel, [{ mode: "walk", title: "Walk", from: "State Library", to: "Town Hall" }]), false);
  assert.equal(alertMatchesJourney({ title: "Sunbury bus 481", summary: "Detour", lines: [], mode: "bus" }, rail), false);
  assert.equal(alertMatchesJourney({ title: "Metro Tunnel works change bus stops", summary: "Bus 401 detour", lines: [], mode: "bus" }, rail), false);
});
test("route matching uses complete route numbers and escapes punctuation", () => {
  const bus = [{ mode: "bus", title: "96", from: "A", to: "B" }];
  assert.equal(alertMatchesJourney({ title: "Route 896 detour", lines: [], summary: "" }, bus), false);
  assert.equal(alertMatchesJourney({ title: "Route 96 detour", lines: [], summary: "" }, bus), true);
});
test("closure guidance warns about unverified diversion, bus pickups and times", () => {
  const guidance = journeyDisruptionGuidance([tunnel], true);
  assert.match(guidance, /do not assume trains divert via the City Loop/);
  assert.match(guidance, /pickup location/);
  assert.match(guidance, /not confirmed rail replacements/);
  assert.match(guidance, /not automatically included/);
});
test("stale/error feed cannot imply a verified clear route", () => {
  assert.match(journeyDisruptionGuidance([], false), /unavailable or out of date/);
  assert.doesNotMatch(journeyDisruptionGuidance([], true), /unavailable or out of date/);
});
test("healthboard shaped notice with tunnel only in structured lines gets closure guidance", () => {
  const healthboard = { id: "metro-live-123", title: "Suspended", summary: "Trains are not operating. Buses replace trains between affected stations.", lines: ["Metro Tunnel Line"], status: "power fault", url: "https://transport.vic.gov.au/disruptions/disruptions-information" };
  assert.equal(alertMatchesJourney(healthboard, rail), true);
  assert.match(journeyDisruptionGuidance([healthboard], true), /Metro Tunnel closure/);
});
