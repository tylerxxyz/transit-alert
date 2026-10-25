import { getApiUrl } from "@/lib/api-config";
import { buildSessionHeaders } from "@/lib/session-token";

export type UserPreferences = {
  favouriteStops: string[];
  favouriteRoutes: string[];
  selectedMapFilters: Record<string, boolean>;
  transportModes: string[];
  appPreferences: Record<string, unknown>;
};

const LOCAL_STORAGE_KEY = "transitalert-local-preferences";
export const DEFAULT_TRANSPORT_MODES = ["train", "tram", "bus", "vline"] as const;
export const DEFAULT_PREMIUM_PRICE_AUD = 5;
export type MobilePerformanceMode = "auto" | "on" | "off";

// Optional account filters stored at appPreferences.favouriteSetNotifications.
// Null/omitted lists mean unrestricted; an empty list matches nothing.
export type FavouriteSetNotificationFilters = {
  enabled?: boolean;
  lines?: string[] | null;
  vehicleTypes?: string[] | null;
  timeZone?: string;
  timePeriods?: { start: string; end: string }[] | null;
  quietHours?: { enabled?: boolean; start: string; end: string } | null;
};

export const defaultPreferences: UserPreferences = {
  favouriteStops: [],
  favouriteRoutes: [],
  selectedMapFilters: {},
  transportModes: [...DEFAULT_TRANSPORT_MODES],
  appPreferences: {
    premiumAccess: false,
    premiumPriceAud: DEFAULT_PREMIUM_PRICE_AUD,
    premiumPaypalLink: "",
    favouriteConsists: [],
    mobilePerformanceMode: "auto" as MobilePerformanceMode,
  },
};

export function hasPremiumAccess(preferences: UserPreferences | null | undefined) {
  return preferences?.appPreferences?.premiumAccess === true;
}

export function getPremiumPriceAud(preferences: UserPreferences | null | undefined) {
  const raw = preferences?.appPreferences?.premiumPriceAud;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PREMIUM_PRICE_AUD;
}

export function getPremiumPaypalLink(preferences: UserPreferences | null | undefined) {
  const raw = preferences?.appPreferences?.premiumPaypalLink;
  return typeof raw === "string" ? raw.trim() : "";
}

export function getFavouriteConsists(preferences: UserPreferences | null | undefined) {
  const raw = preferences?.appPreferences?.favouriteConsists;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getMobilePerformanceMode(preferences: UserPreferences | null | undefined): MobilePerformanceMode {
  const raw = preferences?.appPreferences?.mobilePerformanceMode;
  return raw === "on" || raw === "off" || raw === "auto" ? raw : "auto";
}

function isNetworkError(error: unknown) {
  return error instanceof TypeError;
}

export function readLocalPreferences(): UserPreferences {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return defaultPreferences;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      favouriteStops: Array.isArray(parsed.favouriteStops) ? parsed.favouriteStops : [],
      favouriteRoutes: Array.isArray(parsed.favouriteRoutes) ? parsed.favouriteRoutes : [],
      selectedMapFilters: parsed.selectedMapFilters && typeof parsed.selectedMapFilters === "object" ? parsed.selectedMapFilters : {},
      transportModes:
        Array.isArray(parsed.transportModes) && parsed.transportModes.length > 0
          ? parsed.transportModes
          : [...DEFAULT_TRANSPORT_MODES],
      appPreferences:
        parsed.appPreferences && typeof parsed.appPreferences === "object"
          ? {
              favouriteConsists: [],
              ...parsed.appPreferences,
            }
          : { ...defaultPreferences.appPreferences },
    };
  } catch {
    return defaultPreferences;
  }
}

export function writeLocalPreferences(preferences: UserPreferences) {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore local storage failures.
  }
}

export function clearLocalPreferences() {
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Ignore local storage failures.
  }
}

export async function fetchAccountPreferences() {
  try {
    const response = await fetch(getApiUrl("/api/preferences"), {
      headers: buildSessionHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to load preferences (${response.status})`);
    }
    const payload = (await response.json()) as { preferences?: Partial<UserPreferences> };
    return {
      ...defaultPreferences,
      ...payload.preferences,
      appPreferences: {
        ...defaultPreferences.appPreferences,
        ...(payload.preferences?.appPreferences && typeof payload.preferences.appPreferences === "object"
          ? payload.preferences.appPreferences
          : {}),
      },
    };
  } catch (error) {
    if (isNetworkError(error)) {
      return readLocalPreferences();
    }
    throw error;
  }
}

export async function saveAccountPreferences(preferences: Partial<UserPreferences>) {
  try {
    const response = await fetch(getApiUrl("/api/preferences"), {
      method: "PUT",
      headers: buildSessionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(preferences),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ error: "Failed to save preferences" }))) as { error?: string };
      throw new Error(payload.error || "Failed to save preferences");
    }
    const payload = (await response.json()) as { preferences?: UserPreferences };
    return payload.preferences ?? defaultPreferences;
  } catch (error) {
    if (isNetworkError(error)) {
      return {
        ...defaultPreferences,
        ...preferences,
      };
    }
    throw error;
  }
}

export async function mergeLocalPreferences(preferences: UserPreferences) {
  try {
    const response = await fetch(getApiUrl("/api/preferences/merge"), {
      method: "POST",
      headers: buildSessionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(preferences),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ error: "Failed to merge preferences" }))) as { error?: string };
      throw new Error(payload.error || "Failed to merge preferences");
    }
    const payload = (await response.json()) as { preferences?: UserPreferences };
    return payload.preferences ?? defaultPreferences;
  } catch (error) {
    if (isNetworkError(error)) {
      return preferences;
    }
    throw error;
  }
}
