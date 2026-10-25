import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("database saves enforce ownership, preserve opt-outs and favourites, and sync account devices", async () => {
  // An isolated database, never the developer's live account/subscriptions.
  const directory = await mkdtemp(path.join(tmpdir(), "transitalert-push-test-"));
  process.env.DATABASE_URL = `pglite://${directory.replaceAll("\\", "/")}`;
  const { db, pglite, ensureDatabaseReady } = await import("../../src/lib/db/src/index.js");
  const { appUsersTable, userPreferencesTable } = await import("../../src/lib/db/src/schema/auth.js");
  const { pushSubscriptionsTable, sentPushAlertsTable } = await import("../../src/lib/db/src/schema/push.js");
  const { saveUserPushPreferences, readUserPushPreferences } = await import("./push.js");
  const { upsertUserPreferences } = await import("./auth.js");
  const { eq } = await import("drizzle-orm");
  try {
    await ensureDatabaseReady();
    await db.insert(appUsersTable).values(["alice", "bob"].map(id => ({ id, username: id, email: `${id}@example.invalid`, passwordHash: "test-only" })));
    await db.insert(userPreferencesTable).values({ userId: "alice", appPreferences: { favouriteConsists: ["430M"] } });
    await db.insert(pushSubscriptionsTable).values([
      { endpoint: "alice-1", userId: "alice", p256dh: "test", authKey: "test" },
      { endpoint: "alice-2", userId: "alice", p256dh: "test", authKey: "test" },
      { endpoint: "bob-1", userId: "bob", p256dh: "test", authKey: "test" },
    ]);
    assert.equal(await saveUserPushPreferences("bob", "alice-1", { categories: [] }), false);
    await Promise.all([
      saveUserPushPreferences("alice", "alice-1", { categories: ["train-tracking"] }),
      saveUserPushPreferences("alice", "alice-1", { lines: ["Williamstown Line"] }),
    ]);
    assert.deepEqual(await readUserPushPreferences("alice"), { categories: ["train-tracking"], lines: ["Williamstown Line"] });
    assert.equal(await saveUserPushPreferences("alice", "alice-1", { categories: [] }), true);
    await upsertUserPreferences("alice", { appPreferences: { favouriteConsists: ["430M", "701M"], pushNotificationCategories: ["train-tracking"] } });
    assert.deepEqual((await readUserPushPreferences("alice")).categories, []);
    const row = await db.query.userPreferencesTable.findFirst({ where: eq(userPreferencesTable.userId, "alice") });
    assert.deepEqual(row.appPreferences.favouriteConsists, ["430M", "701M"]);
    const devices = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, "alice"));
    assert.ok(devices.every(device => device.notificationCategories.length === 0));
    assert.ok(devices.every(device => device.notificationLines.includes("Williamstown Line")));
    const claims = await Promise.all(Array.from({ length: 6 }, () => db.insert(sentPushAlertsTable).values({ alertId: "favourite-sent:alice:430M:20260917:6384" }).onConflictDoNothing().returning()));
    assert.equal(claims.flat().length, 1);
  } finally { await pglite.close(); }
});
