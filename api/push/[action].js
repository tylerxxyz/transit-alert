import { getSessionUser, readJsonBody, sendJson } from "../_lib/auth.js";
import {
  checkAndPushNewAlerts,
  getVapidPublicKey,
  isPushConfigured,
  removeSubscriptionByEndpoint,
  saveSubscription,
  sendMockSafetyTestPushes,
  sendPushToAllSubscriptions,
  sendRecentAlertsTestBatch,
  sendTestPush,
  saveUserPushPreferences,
  readUserPushPreferences,
} from "../_lib/push.js";

export default async function handler(req, res) {
  const action = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
  const origin = req.headers?.origin || "https://tylerbnobleday-cmyk.github.io";

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (action === "vapid-key") {
    sendJson(res, 200, { publicKey: getVapidPublicKey(), configured: isPushConfigured() });
    return;
  }

  if (action === "subscribe" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body?.subscription?.endpoint) {
      sendJson(res, 400, { error: "A valid push subscription is required" });
      return;
    }

    if (!isPushConfigured()) {
      sendJson(res, 503, { error: "Push notifications are not configured on this server" });
      return;
    }

    const user = await getSessionUser(req).catch(() => null);
    const userId = user && user.id !== "guest-session" ? user.id : null;
    const saved = await saveSubscription(body.subscription, userId);
    sendJson(res, saved ? 200 : 500, { subscribed: saved });
    return;
  }

  if (action === "unsubscribe" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body?.endpoint) {
      sendJson(res, 400, { error: "An endpoint is required" });
      return;
    }
    const removed = await removeSubscriptionByEndpoint(body.endpoint);
    sendJson(res, 200, { unsubscribed: removed });
    return;
  }

  if (action === "preferences" && ["GET", "POST"].includes(req.method)) {
    const user = await getSessionUser(req).catch(() => null);
    if (!user || user.id === "guest-session" || user.role === "Guest") {
      sendJson(res, 401, { error: "Sign in to manage notification preferences" });
      return;
    }
    if (req.method === "GET") {
      const preferences = await readUserPushPreferences(user.id);
      sendJson(res, preferences ? 200 : 503, preferences ?? { error: "Preferences unavailable" });
      return;
    }
    const body = await readJsonBody(req);
    const patch = {};
    for (const key of ["categories", "lines"]) {
      if (body?.[key] === undefined) continue;
      if (body[key] !== null && (!Array.isArray(body[key]) || !body[key].every(value => typeof value === "string" && value.trim()))) {
        sendJson(res, 400, { error: "Invalid notification preferences" });
        return;
      }
      patch[key] = body[key] === null ? null : [...new Set(body[key].map(value => value.trim()))];
    }
    if (!body?.endpoint || !Object.keys(patch).length) {
      sendJson(res, 400, { error: "An endpoint and categories or lines are required" });
      return;
    }
    const updated = await saveUserPushPreferences(user.id, body.endpoint, patch);
    sendJson(res, updated ? 200 : 403, { updated });
    return;
  }

  if (action === "test" && req.method === "POST") {
    const user = await getSessionUser(req).catch(() => null);
    if (!user?.isAdmin) {
      sendJson(res, 403, { error: "Admin access required" });
      return;
    }
    if (!isPushConfigured()) {
      sendJson(res, 503, { error: "Push notifications are not configured on this server" });
      return;
    }

    const result = await sendTestPush();
    sendJson(res, 200, { sent: true, ...result });
    return;
  }

  if (action === "test-mock-safety" && req.method === "POST") {
    const user = await getSessionUser(req).catch(() => null);
    if (!user?.isAdmin) {
      sendJson(res, 403, { error: "Admin access required" });
      return;
    }
    if (!isPushConfigured()) {
      sendJson(res, 503, { error: "Push notifications are not configured on this server" });
      return;
    }
    const result = await sendMockSafetyTestPushes();
    sendJson(res, 200, result);
    return;
  }

  if (action === "test-recent-alerts" && req.method === "POST") {
    const user = await getSessionUser(req).catch(() => null);
    if (!user?.isAdmin) {
      sendJson(res, 403, { error: "Admin access required" });
      return;
    }
    if (!isPushConfigured()) {
      sendJson(res, 503, { error: "Push notifications are not configured on this server" });
      return;
    }
    const count = Math.min(Math.max(Number(req.query?.count) || 5, 1), 10);
    const result = await sendRecentAlertsTestBatch(count);
    sendJson(res, 200, result);
    return;
  }

  // Reusable for every future release: fire this once after a version ships
  // so subscribed devices get a real push about what changed, using the
  // same delivery path as everything else here rather than a separate
  // announcement system.
  if (action === "announce" && req.method === "POST") {
    const user = await getSessionUser(req).catch(() => null);
    if (!user?.isAdmin) {
      sendJson(res, 403, { error: "Admin access required" });
      return;
    }
    if (!isPushConfigured()) {
      sendJson(res, 503, { error: "Push notifications are not configured on this server" });
      return;
    }
    const body = await readJsonBody(req);
    const title = String(body?.title || "").trim();
    const text = String(body?.body || "").trim();
    if (!title || !text) {
      sendJson(res, 400, { error: "A title and body are required" });
      return;
    }
    const result = await sendPushToAllSubscriptions({
      title,
      body: text,
      // There's no dedicated /version route — the "what's new" modal opens
      // automatically on the home page whenever the stored last-seen
      // version doesn't match the current one, so landing there shows it.
      url: "./",
      tag: "transitalert-version-announcement",
    });
    sendJson(res, 200, { sent: true, ...result });
    return;
  }

  if (action === "check" && req.method === "POST") {
    const user = await getSessionUser(req).catch(() => null);
    if (!user?.isAdmin) {
      sendJson(res, 403, { error: "Admin access required" });
      return;
    }
    await checkAndPushNewAlerts();
    sendJson(res, 200, { checked: true });
    return;
  }

  sendJson(res, 404, { error: "Unknown push action" });
}
