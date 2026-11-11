import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { gunzipSync } from "node:zlib";

let stopCount = 0, routeCount = 0;
for (const file of await fs.readdir("public/networks")) {
  if (!file.endsWith(".json")) continue;
  const data = JSON.parse(await fs.readFile(`public/networks/${file}`, "utf8"));
  const geometry = JSON.parse(gunzipSync(await fs.readFile(`data/networks/${file}.gz`)).toString("utf8"));
  const stops = new Set(data.stops.map(s => s.id)), routes = new Set(data.routes.map(r => r.id));
  assert.ok(data.stops.length > 0, `${file} must contain usable stops`);
  assert.equal(stops.size, data.stops.length, `${file} duplicate stop IDs`);
  assert.equal(routes.size, data.routes.length, `${file} duplicate route IDs`);
  assert.deepEqual(data.failures, [], `${file} has failed schedule imports`);
  for (const stop of data.stops) {
    assert.ok(Number.isFinite(stop.lat) && Number.isFinite(stop.lng), `${file} invalid coordinates`);
    for (const route of stop.routes) assert.ok(routes.has(route), `${file} unknown route ${route}`);
  }
  for (const route of data.routes) {
    for (const stop of route.stops) assert.ok(stops.has(stop), `${file} unknown stop ${stop}`);
    assert.ok(Object.hasOwn(geometry, route.id), `${file} missing geometry entry ${route.id}`);
    for (const point of geometry[route.id]) assert.ok(point.length === 2 && point.every(Number.isFinite), `${file} invalid shape point`);
  }
  stopCount += stops.size; routeCount += routes.size;
  console.log(`${data.network}: ${stops.size} stops, ${routes.size} routes; references and geometry valid`);
}
console.log(`Verified ${stopCount} stop records and ${routeCount} route records.`);
