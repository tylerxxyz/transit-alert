export const ALERT_NOTIFICATIONS_KEY = "transitalert-alert-browser-notifications";

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function isIosDevice() {
  return typeof navigator !== "undefined" && /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

export function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as NavigatorWithStandalone).standalone)
  );
}

export function notificationsEnabled() {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem(ALERT_NOTIFICATIONS_KEY) === "true" &&
    "Notification" in window &&
    Notification.permission === "granted"
  );
}

export function setNotificationsEnabled(enabled: boolean) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ALERT_NOTIFICATIONS_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent("transitalert-notifications-changed", { detail: enabled }));
  }
}

export async function updateAppBadge(count: number) {
  if (typeof navigator === "undefined") return;
  const badgeNavigator = navigator as NavigatorWithStandalone;
  const operation = count > 0
    ? badgeNavigator.setAppBadge?.(count)
    : badgeNavigator.clearAppBadge?.();
  await operation?.catch(() => undefined);
}

export async function showAppNotification(title: string, options: NotificationOptions = {}) {
  if (!notificationsEnabled()) return false;

  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  if (registration) {
    await registration.showNotification(title, {
      icon: `${import.meta.env.BASE_URL}icons/app-icon-192.png`,
      ...options,
    });
    return true;
  }

  new Notification(title, {
    icon: `${import.meta.env.BASE_URL}icons/app-icon-192.png`,
    ...options,
  });
  return true;
}
