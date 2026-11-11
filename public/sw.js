self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "A new TransitAlert update is available." };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "TransitAlert", {
      body: payload.body || "A new transport update is available.",
      icon: "./icons/app-icon-192.png",
      tag: payload.tag || "transitalert-update",
      data: { url: payload.url || "./" },
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const oldSubscription = event.oldSubscription?.toJSON?.() ?? null;
      const newSubscription =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe(event.oldSubscription?.options ?? { userVisibleOnly: true }));

      // One call that hands the old subscription's owner and notification
      // filters to the new one. A separate unsubscribe + subscribe (with no
      // session available here) lost both, so opted-out users got everything.
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subscription: newSubscription.toJSON(),
          previous: oldSubscription?.endpoint
            ? { endpoint: oldSubscription.endpoint, auth: oldSubscription.keys?.auth }
            : null,
        }),
      }).catch(() => undefined);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url.startsWith(self.registration.scope)) || clients[0];
      if (existingClient) {
        return existingClient.focus().then(() => existingClient.navigate?.(targetUrl));
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
