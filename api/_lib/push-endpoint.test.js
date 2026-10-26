import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedPushEndpoint } from "./push.js";

test("only https endpoints on real push services are accepted", () => {
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc"), true);
  assert.equal(isAllowedPushEndpoint("https://web.push.apple.com/abc"), true);
  assert.equal(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=abc"), true);
  assert.equal(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc"), false);
  assert.equal(isAllowedPushEndpoint("https://127.0.0.1:3200/api/ghost-db/tables"), false);
  assert.equal(isAllowedPushEndpoint("https://192.168.1.1/admin"), false);
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example/x"), false);
  assert.equal(isAllowedPushEndpoint("https://evilpush.apple.com.attacker.net/x"), false);
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x"), false);
  assert.equal(isAllowedPushEndpoint("not a url"), false);
});
