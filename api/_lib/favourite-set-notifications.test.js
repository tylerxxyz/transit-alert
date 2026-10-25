import test from "node:test";
import assert from "node:assert/strict";
import { dispatchFavouriteSetEvents, eligibleForFavouriteSet, favouriteSetPayload, serviceKey, trainSetIds } from "./favourite-set-notifications.js";

const now = new Date("2026-09-17T02:00:00Z");
const train = { consist: "429M-430M", tripId: "02-trip-6384", tdn: "6384", serviceDate: "20260917", line: "Williamstown", origin: "Flinders Street", destination: "Williamstown", timestamp: now.toISOString(), trainType: "Metro Train" };
function user(id = "alice", favourites = ["430M"]) {
  return { preferences: { userId: id, appPreferences: { favouriteConsists: favourites, pushNotificationCategories: ["train-tracking"] } }, subscriptions: [{ userId: id, endpoint: `https://push/${id}`, notificationCategories: ["train-tracking"], notificationLines: ["Williamstown Line"] }] };
}
function harness(users = { alice: user() }) {
  const claims = new Set(), sent = [];
  const deps = { now: () => now, listUsers: async () => Object.keys(users), readUser: async (id) => users[id], claim: async (key) => { if (claims.has(key)) return false; claims.add(key); return true; }, deliver: async (sub, payload) => sent.push({ user: sub.userId, payload }) };
  return { users, claims, sent, deps, run: (trains = [train]) => dispatchFavouriteSetEvents(trains, deps) };
}

test("exact requested wording and missing-origin fallback, across fleets", () => {
  for (const set of ["430M", "229M", "701M", "9001", "VL15", "N452"]) {
    assert.equal(favouriteSetPayload(set, train).title, `Favourite set ${set} is now running`);
    assert.equal(favouriteSetPayload(set, train).body, `${set} is now running from Flinders Street to Williamstown · TDN 6384`);
    assert.equal(favouriteSetPayload(set, { ...train, origin: undefined }).body, `${set} is now running to Williamstown · TDN 6384`);
  }
  assert.equal(favouriteSetPayload("430M", { ...train, destinationIsFallback: true }), null);
  assert.equal(favouriteSetPayload("430M", { ...train, tdn: null }), null);
});

test("only each user's own favourites, explicit opt-in and endpoint ownership qualify", async () => {
  const h = harness({ alice: user(), bob: user("bob", ["701M"]), carol: user("carol"), dave: user("dave") });
  h.users.carol.preferences.appPreferences.pushNotificationCategories = null;
  h.users.dave.subscriptions[0].userId = "alice";
  await h.run();
  assert.deepEqual(h.sent.map(x => x.user), ["alice"]);
});

test("empty categories, category opt-out, line, vehicle, time, quiet-hours filters all suppress before delivery", async () => {
  const cases = [
    u => u.preferences.appPreferences.pushNotificationCategories = [],
    u => u.subscriptions[0].notificationCategories = [],
    u => u.subscriptions[0].notificationCategories = ["delay"],
    u => u.subscriptions[0].notificationLines = [],
    u => u.subscriptions[0].notificationLines = ["Frankston Line"],
    u => u.preferences.appPreferences.pushNotificationLines = ["Frankston"],
    u => u.preferences.appPreferences.favouriteSetNotifications = { enabled: false },
    u => u.preferences.appPreferences.favouriteSetNotifications = { vehicleTypes: ["Siemens"] },
    u => u.preferences.appPreferences.favouriteSetNotifications = { timePeriods: [{ start: "14:00", end: "16:00" }] },
    u => u.preferences.appPreferences.favouriteSetNotifications = { quietHours: { start: "11:00", end: "13:00" } },
    u => u.preferences.appPreferences.favouriteSetNotifications = { timeZone: "Invalid" },
  ];
  for (const change of cases) {
    const h = harness(); change(h.users.alice); await h.run();
    assert.equal(h.sent.length, 0);
    assert.ok(![...h.claims].some(key => key.startsWith("favourite-sent:")));
  }
});

test("matching fleet filters, midnight-crossing quiet hours and allowed time boundaries", () => {
  const u = user();
  u.preferences.appPreferences.favouriteSetNotifications = { vehicleTypes: ["Comeng"], quietHours: { start: "22:00", end: "06:00" }, timePeriods: [{ start: "12:00", end: "14:00" }] };
  assert.equal(eligibleForFavouriteSet(u.subscriptions[0], u.preferences, "430M", train, now), true);
  assert.equal(eligibleForFavouriteSet(u.subscriptions[0], u.preferences, "430M", train, new Date("2026-09-17T04:00:00Z")), false);
  delete u.preferences.appPreferences.favouriteSetNotifications.timePeriods;
  assert.equal(eligibleForFavouriteSet(u.subscriptions[0], u.preferences, "430M", train, new Date("2026-09-17T13:00:00Z")), false);
});

test("V/Line codes cannot be mistaken for suburban car numbers in vehicle filters", () => {
  const u = user("alice", ["VL15"]);
  const vline = { ...train, consist: "VL15", tripId: "01-trip-6384", trainType: "V/Line Train" };
  u.preferences.appPreferences.favouriteSetNotifications = { vehicleTypes: ["X’Trapolis"] };
  assert.equal(eligibleForFavouriteSet(u.subscriptions[0], u.preferences, "VL15", vline, now), false);
  u.preferences.appPreferences.favouriteSetNotifications.vehicleTypes = ["V/Line"];
  assert.equal(eligibleForFavouriteSet(u.subscriptions[0], u.preferences, "VL15", vline, now), true);
});

test("concurrent/repeated polls and trip aliases deduplicate per user/set/date/TDN", async () => {
  const h = harness({ alice: user(), bob: user("bob") });
  await Promise.all([h.run(), h.run()]);
  await h.run([{ ...train, tripId: "a-different-alias" }]);
  assert.deepEqual(h.sent.map(x => x.user).sort(), ["alice", "bob"]);
  await h.run([{ ...train, tdn: "6385", tripId: "new-service" }]);
  assert.equal(h.sent.length, 4);
  await h.run([{ ...train, serviceDate: "20260918" }]);
  assert.equal(h.sent.length, 6);
});

test("opt-out saved after claim is rechecked, favourites remain intact", async () => {
  const h = harness();
  const claim = h.deps.claim;
  h.deps.claim = async key => { const result = await claim(key); if (key.startsWith("favourite-sent:")) h.users.alice.preferences.appPreferences.pushNotificationCategories = []; return result; };
  await h.run();
  assert.equal(h.sent.length, 0);
  assert.deepEqual(h.users.alice.preferences.appPreferences.favouriteConsists, ["430M"]);
});

test("enabling or favouriting mid-service does not send a delayed service-start alert", async () => {
  const h = harness();
  h.users.alice.preferences.appPreferences.pushNotificationCategories = [];
  await h.run();
  h.users.alice = user();
  await h.run();
  assert.equal(h.sent.length, 0);
  await h.run([{ ...train, tdn: "6386" }]);
  assert.equal(h.sent.length, 1);
});

test("stale feeds and unresolved destinations do not announce a service", async () => {
  const h = harness();
  await h.run([{ ...train, timestamp: "2026-09-16T00:00:00Z" }, { ...train, destinationIsFallback: true }]);
  assert.equal(h.sent.length, 0);
  assert.equal(h.claims.size, 0);
});

test("full consist favourites, individual sets and valid V/Line allocations match exactly", async () => {
  const h = harness({ alice: user("alice", ["429M-430M"]), bob: user("bob", ["43M"]) });
  await h.run();
  assert.deepEqual(h.sent.map(x => x.user), ["alice"]);
  const allocated = { ...train, allocation: { serviceDate: train.serviceDate, validUntil: "2026-09-17T03:00:00Z", setIds: ["VL15"] } };
  assert.ok(trainSetIds(allocated, now.getTime()).has("VL15"));
  assert.ok(!trainSetIds(allocated, now.getTime() + 4 * 3600_000).has("VL15"));
  assert.notEqual(serviceKey(train), serviceKey({ ...train, serviceDate: "20260918" }));
});
