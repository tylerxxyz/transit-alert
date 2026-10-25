import type { MetroNotifyAlert } from "./todays-alerts";

type Leg = { mode: string; title?: string; routeLabel?: string; from: string; to: string };
const TUNNEL = /metro tunnel|sunbury|cranbourne|pakenham/i;
const TUNNEL_STATIONS = /^(arden|parkville|state library|town hall|anzac)( station)?$/i;
const REPLACEMENT = /buses? replace|coaches? replace|replacement bus|replacement coach|bus replacement|coach replacement/i;
const CLOSURE = /suspend|closed|closure|not operating|not running|out of (?:action|service)|no trains|buses? replace/i;

// Use the services actually selected, rather than every rail corridor that
// happens to share two city stations with the path. Walks and ordinary buses
// through a tunnel station are not Metro Tunnel train journeys.
export function alertMatchesJourney(alert: MetroNotifyAlert, legs: Leg[]) {
  const text = `${alert.title} ${alert.summary} ${alert.lines.join(" ")}`;
  const railLegs = legs.filter((leg) => leg.mode === "train");
  if (!alert.mode && /metro tunnel/i.test(text) && railLegs.some((leg) =>
    TUNNEL.test(leg.title ?? leg.routeLabel ?? "") || TUNNEL_STATIONS.test(leg.from) || TUNNEL_STATIONS.test(leg.to))) return true;
  return legs.some((leg) => {
    if (leg.mode === "walk") return false;
    if (alert.mode === "bus" && leg.mode !== "bus") return false;
    if (alert.mode === "tram" && leg.mode !== "tram") return false;
    const label = (leg.title ?? leg.routeLabel ?? "").replace(/\s+line$/i, "").trim();
    if (!label || /^(train|bus|tram|metro)$/i.test(label)) return false;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

export function journeyDisruptionGuidance(alerts: MetroNotifyAlert[], fresh: boolean) {
  const text = alerts.map((alert) => `${alert.title} ${alert.summary} ${alert.status} ${alert.lines.join(" ")}`).join(" ");
  const messages = ["This is a scheduled route; live closures and replacement buses are not automatically included in its path or travel time."];
  if (!fresh) messages.push("Live disruption information is unavailable or out of date. Check official updates before boarding.");
  if (/metro tunnel/i.test(text) && CLOSURE.test(text)) messages.push("A Metro Tunnel closure may interrupt the through journey. Confirm the affected section and interchange advice with station staff or the official notice; do not assume trains divert via the City Loop.");
  if (REPLACEMENT.test(text)) messages.push("Replacement buses may use stops outside the station. Check the official notice for pickup location, express or all-stops pattern, accessibility and operating times; allow extra time. Ordinary bus routes shown here are not confirmed rail replacements.");
  else if (CLOSURE.test(text)) messages.push("Check the affected section and official alternative travel advice before following this route.");
  return messages.join(" ");
}
