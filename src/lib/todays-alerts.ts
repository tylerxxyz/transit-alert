import type { Report } from "@/lib/api-client-react/src/generated/api.schemas";
import { getApiUrl } from "@/lib/api-config";

export type MetroNotifyAlert = {
  id: string;
  title: string;
  summary: string;
  lines: string[];
  status: string;
  updatedAt?: string;
  // When we first detected and pushed a notification for this alert (real,
  // from our own sent-notification record) — PTV's own updatedAt can be far
  // older than a specific train's cancellation actually appearing under a
  // longer-running disruption record, so this is the more accurate "how
  // long ago" fact whenever we have it.
  firstNotifiedAt?: string;
  url?: string;
  addToCalendarUrl?: string;
  tdn?: string;
  mode?: "bus" | "tram" | "vline" | "xpt";
  corridors?: string[];
  source: "metro";
};

type MetroNotifyResponse =
  | MetroNotifyAlert[]
  | {
      alerts?: MetroNotifyAlert[];
    };

const ALERT_CODE_LINE_MAP: Record<string, string> = {
  CGB: "Craigieburn Line",
  FKN: "Frankston Line",
  STY: "Stony Point Line",
  SDM: "Sandringham Line",
  HBE: "Hurstbridge Line",
  MER: "Mernda Line",
  GWY: "Glen Waverley Line",
  BEL: "Belgrave Line",
  LIL: "Lilydale Line",
  ALM: "Alamein Line",
  UFD: "Upfield Line",
  PKM: "Pakenham Line",
  CBN: "Cranbourne Line",
  SBY: "Sunbury Line",
  WBE: "Werribee Line",
  WIL: "Williamstown Line",
};

function stripFeedPrefix(value: string) {
  return value
    .replace(/^\s*(?:aus:vic:)?vic-02-[a-z0-9-]+:{1,2}\s*/i, "")
    .trim();
}

function normaliseAlertLine(value: string) {
  const cleaned = stripFeedPrefix(value)
    .replace(/^\s*(?:aus:vic:)?vic:[a-z0-9-]+:{0,2}\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  if (/^(?:aus:vic:)?vic-02-[a-z0-9-]+:?$/i.test(cleaned)) return null;

  const fromCode = ALERT_CODE_LINE_MAP[cleaned.toUpperCase()];
  return fromCode ?? cleaned;
}

function extractAlertCode(value: string) {
  const match = value.match(/(?:aus:vic:)?vic-02-([A-Z0-9-]+)(?::|::)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function inferExtraAlertLines(title: string, summary: string) {
  const searchable = `${title} ${summary}`.toLowerCase();
  const inferred = new Set<string>();
  const alertCode = extractAlertCode(title);
  if (alertCode && ALERT_CODE_LINE_MAP[alertCode]) {
    inferred.add(ALERT_CODE_LINE_MAP[alertCode]);
  }

  if (searchable.includes("coolaroo") || searchable.includes("craigieburn")) {
    inferred.add("Craigieburn Line");
  }
  if (searchable.includes("cheltenham") || searchable.includes("mordialloc") || searchable.includes("frankston")) {
    inferred.add("Frankston Line");
  }
  if (searchable.includes("stony point")) {
    inferred.add("Stony Point Line");
  }
  if (searchable.includes("sandringham") || searchable.includes("brighton beach") || searchable.includes("hampton")) {
    inferred.add("Sandringham Line");
  }
  if (searchable.includes("holmesglen") || searchable.includes("glen waverley")) {
    inferred.add("Glen Waverley Line");
  }
  if (
    searchable.includes("canterbury") ||
    searchable.includes("camberwell") ||
    searchable.includes("ringwood") ||
    searchable.includes("blackburn") ||
    searchable.includes("box hill")
  ) {
    inferred.add("Belgrave Line");
    inferred.add("Lilydale Line");
  }
  if (searchable.includes("alamein")) {
    inferred.add("Alamein Line");
  }
  if (searchable.includes("watsonia") || searchable.includes("hurstbridge")) {
    inferred.add("Hurstbridge Line");
  }

  return [...inferred];
}

function normaliseMetroAlert(raw: Partial<MetroNotifyAlert> & Record<string, unknown>, index: number): MetroNotifyAlert {
  const rawTitle = typeof raw.title === "string" && raw.title.trim() ? raw.title : "Metro service alert";
  const rawSummary = typeof raw.summary === "string" ? raw.summary : "";
  const title = stripFeedPrefix(rawTitle);
  const summary = stripFeedPrefix(rawSummary);
  const explicitLines = Array.isArray(raw.lines)
    ? raw.lines
        .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
        .map((line) => normaliseAlertLine(line))
        .filter((line): line is string => Boolean(line))
    : [];
  const inferredLines = inferExtraAlertLines(rawTitle, rawSummary);
  const lines = [...new Set([...explicitLines, ...inferredLines])];

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : `metro-${index}`,
    title,
    summary,
    lines,
    status: typeof raw.status === "string" && raw.status.trim() ? raw.status : "active",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    url: typeof raw.url === "string" ? raw.url : undefined,
    addToCalendarUrl: typeof raw.addToCalendarUrl === "string" ? raw.addToCalendarUrl : undefined,
    tdn: typeof raw.tdn === "string" && raw.tdn.trim() ? raw.tdn.trim() : undefined,
    mode: raw.mode === "bus" || raw.mode === "tram" || raw.mode === "vline" || raw.mode === "xpt" ? raw.mode : undefined,
    corridors: Array.isArray(raw.corridors)
      ? raw.corridors.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined,
    source: "metro",
  };
}

function cleanAlertText(value: string) {
  return stripFeedPrefix(value).replace(/\s+/g, " ").trim();
}

function isMergeableWorksAlert(alert: MetroNotifyAlert) {
  const searchable = `${alert.title} ${alert.summary}`.toLowerCase();
  return (
    /works|closures|changes|parkiteer|temporary timetable|service changes|underpass|pedestrian access|car space|replacement buses|single line running/i.test(
      searchable,
    ) && /station|level crossing|project/i.test(searchable)
  );
}

function extractWorksPlaceName(alert: MetroNotifyAlert) {
  const combined = cleanAlertText(`${alert.title} ${alert.summary}`);
  const stationMatch = combined.match(/([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2})\s+Station\b/);
  if (stationMatch?.[1]) {
    return stationMatch[1];
  }

  const projectMatch = combined.match(
    /([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2})\s+Level Crossing(?:\s+Removal)?\s+Project\b/i,
  );
  if (projectMatch?.[1]) {
    return projectMatch[1];
  }

  const crossingMatch = combined.match(/([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2})\s+Level Crossing\b/i);
  if (crossingMatch?.[1]) {
    return crossingMatch[1];
  }

  return null;
}
function joinSummaryParts(parts: string[]) {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function mergeRelatedWorksAlerts(alerts: MetroNotifyAlert[]) {
  const grouped = new Map<string, MetroNotifyAlert[]>();
  const passthrough: MetroNotifyAlert[] = [];

  for (const alert of alerts) {
    const placeName = extractWorksPlaceName(alert);
    const locationKey = placeName?.toLowerCase();
    if (!locationKey || !isMergeableWorksAlert(alert)) {
      passthrough.push(alert);
      continue;
    }

    const lineKey = [...alert.lines].sort().join("|").toLowerCase();
    const key = `${locationKey}|${lineKey}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(alert);
    grouped.set(key, bucket);
  }

  const merged = [...grouped.values()].map((bucket) => {
    if (bucket.length === 1) {
      return bucket[0];
    }

    const base = [...bucket].sort((left, right) => {
      const leftUpdated = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
      const rightUpdated = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
      return rightUpdated - leftUpdated;
    })[0];

    const placeName = extractWorksPlaceName(base) ?? "Station";
    const combinedText = bucket.map((alert) => `${alert.title} ${alert.summary}`.toLowerCase()).join(" ");
    const summaryParts = [
      /parkiteer/i.test(combinedText) ? "Parkiteer closure" : null,
      /underpass|pedestrian access|station changes|access/i.test(combinedText) ? "station access changes" : null,
      /temporary timetable|service changes|single line running|replacement buses/i.test(combinedText) ? "service changes" : null,
      /car space|car park/i.test(combinedText) ? "car park impacts" : null,
    ].filter((part): part is string => Boolean(part));

    const mergedTitle = `${placeName} works update`;
    const mergedSummary = summaryParts.length
      ? `Ongoing works at ${placeName} include ${joinSummaryParts([...new Set(summaryParts)])}.`
      : `Ongoing works and access changes remain in place at ${placeName}.`;

    return {
      ...base,
      id: bucket.map((alert) => alert.id).join("|"),
      title: mergedTitle,
      summary: mergedSummary,
      lines: [...new Set(bucket.flatMap((alert) => alert.lines))],
      url: base.url ?? bucket.find((alert) => alert.url)?.url,
      addToCalendarUrl: base.addToCalendarUrl ?? bucket.find((alert) => alert.addToCalendarUrl)?.addToCalendarUrl,
    };
  });

  return [...passthrough, ...merged];
}

function getNormalisedAlertText(value: string) {
  return cleanAlertText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function isGenericPlannedWorksAlert(alert: MetroNotifyAlert) {
  return /planned works?$/i.test(cleanAlertText(alert.title));
}

// "the City" and "City" are the same place — PTV's own feeds are
// inconsistent about the leading article between otherwise-identical
// station/place names, so leaving it in makes the same real disruption
// produce two different signatures and defeats duplicate detection.
function normaliseRoutePlaceName(value: string) {
  return value.trim().replace(/^the\s+/i, "");
}

function extractRouteSignature(value: string) {
  const cleaned = getNormalisedAlertText(value);
  const betweenMatch = cleaned.match(/\bbetween\s+(.+?)\s+and\s+(.+?)(?:\s+from|\s+while|\s+during|\s+until|$)/i);
  if (betweenMatch) {
    return `${normaliseRoutePlaceName(betweenMatch[1])}|${normaliseRoutePlaceName(betweenMatch[2])}`;
  }

  const fromMatch = cleaned.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+from|\s+while|\s+during|\s+until|$)/i);
  if (fromMatch) {
    return `${normaliseRoutePlaceName(fromMatch[1])}|${normaliseRoutePlaceName(fromMatch[2])}`;
  }

  return null;
}

function collapseGenericPlannedWorksWrappers(alerts: MetroNotifyAlert[]) {
  return alerts.filter((alert, index) => {
    if (!isGenericPlannedWorksAlert(alert)) {
      return true;
    }

    const genericSummary = getNormalisedAlertText(alert.summary);
    const genericLines = new Set(alert.lines.map((line) => line.trim().toLowerCase()));
    const genericRoute = extractRouteSignature(alert.summary) ?? extractRouteSignature(alert.title);

    return !alerts.some((candidate, candidateIndex) => {
      if (candidateIndex === index || isGenericPlannedWorksAlert(candidate)) {
        return false;
      }

      const candidateLines = candidate.lines.map((line) => line.trim().toLowerCase());
      const hasOverlappingLine = candidateLines.some((line) => genericLines.has(line));
      if (!hasOverlappingLine) {
        return false;
      }

      const candidateTitle = getNormalisedAlertText(candidate.title);
      const candidateSummary = getNormalisedAlertText(candidate.summary);
      const candidateRoute = extractRouteSignature(candidate.title) ?? extractRouteSignature(candidate.summary);

      if (genericRoute && candidateRoute && genericRoute === candidateRoute) {
        return true;
      }

      return genericSummary.includes(candidateTitle) || genericSummary.includes(candidateSummary);
    });
  });
}

function extractAlertPlaceSignature(alert: MetroNotifyAlert) {
  const stationPlace = extractWorksPlaceName(alert);
  if (stationPlace) {
    return stationPlace.toLowerCase();
  }

  const title = cleanAlertText(alert.title);
  const stationMatch = title.match(/^(.+?)\s+Station\s+/i);
  if (stationMatch?.[1]) {
    return `${stationMatch[1].trim().toLowerCase()} station`;
  }

  return null;
}

function collapseSupersededRouteAlerts(alerts: MetroNotifyAlert[]) {
  return alerts.filter((alert, index) => {
    const alertLines = new Set(alert.lines.map((line) => line.trim().toLowerCase()));
    const alertRoute = extractRouteSignature(alert.title) ?? extractRouteSignature(alert.summary);
    const alertPlace = extractAlertPlaceSignature(alert);
    const alertType = `${alert.title} ${alert.summary}`.toLowerCase();
    const alertUpdated = alert.updatedAt ? new Date(alert.updatedAt).getTime() : 0;

    return !alerts.some((candidate, candidateIndex) => {
      if (candidateIndex === index) {
        return false;
      }

      const candidateUpdated = candidate.updatedAt ? new Date(candidate.updatedAt).getTime() : 0;
      if (candidateUpdated <= alertUpdated) {
        return false;
      }

      const candidateLines = candidate.lines.map((line) => line.trim().toLowerCase());
      const hasOverlappingLine = candidateLines.some((line) => alertLines.has(line));
      if (!hasOverlappingLine) {
        return false;
      }

      const candidateRoute = extractRouteSignature(candidate.title) ?? extractRouteSignature(candidate.summary);
      if (alertRoute && candidateRoute && alertRoute === candidateRoute) {
        return true;
      }

      const candidatePlace = extractAlertPlaceSignature(candidate);
      const samePlace = Boolean(alertPlace && candidatePlace && alertPlace === candidatePlace);
      const sameTheme =
        (/car space|car park|closure|closures|access|parkiteer/.test(alertType) &&
          /car space|car park|closure|closures|access|parkiteer/.test(`${candidate.title} ${candidate.summary}`.toLowerCase())) ||
        (/buses replace trains|replacement buses/.test(alertType) &&
          /buses replace trains|replacement buses/.test(`${candidate.title} ${candidate.summary}`.toLowerCase()));

      return samePlace && sameTheme;
    });
  });
}

function dedupeMetroAlerts(alerts: MetroNotifyAlert[]) {
  const groups = new Map<string, MetroNotifyAlert[]>();

  for (const alert of alerts) {
    const summary = alert.summary.trim();
    const title = alert.title.trim();
    const lines = [...alert.lines].sort().join("|");
    const keyBase = `${summary || title}|${lines}|${alert.updatedAt ?? ""}`.toLowerCase();
    const key =
      summary && /buses replace trains|car space closures|station car space closures|planned works/i.test(summary)
        ? keyBase
        : `${title}|${lines}|${alert.updatedAt ?? ""}`.toLowerCase();

    const bucket = groups.get(key) ?? [];
    bucket.push(alert);
    groups.set(key, bucket);
  }

  const deduped = [...groups.values()].map((bucket) => {
    if (bucket.length === 1) {
      return bucket[0];
    }

    return [...bucket].sort((left, right) => {
      const leftGeneric = /planned works?$/i.test(left.title.trim()) ? 1 : 0;
      const rightGeneric = /planned works?$/i.test(right.title.trim()) ? 1 : 0;
      if (leftGeneric !== rightGeneric) {
        return leftGeneric - rightGeneric;
      }

      const leftTitleLength = left.title.trim().length;
      const rightTitleLength = right.title.trim().length;
      return rightTitleLength - leftTitleLength;
    })[0];
  });

  return mergeRelatedWorksAlerts(collapseSupersededRouteAlerts(collapseGenericPlannedWorksWrappers(deduped)));
}

const MONTH_NAME_INDEX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
const ALERT_DATE_PATTERN = new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(MONTH_NAME_INDEX).join("|")})\\b`, "gi");

// Multi-night works notices ("buses replace trains ... Sunday 6 September to
// Wednesday 9 September") are typically published once and never touched
// again in the feed, so their updatedAt timestamp goes "stale" by the usual
// freshness check well before the closure itself is over — a closure
// announced 4 days ago that runs for a week is still happening tonight.
// Pull the real start/end dates out of the alert text and use them as an
// ADDITIONAL, purely widening signal: this only ever makes an alert MORE
// likely to still count as current, never less, so it can't hide something
// the existing updatedAt-based check would already show.
function parseAlertActiveWindow(text: string): { start: number; end: number } | null {
  const matches = [...text.matchAll(ALERT_DATE_PATTERN)];
  if (matches.length < 2) return null;

  const toTimestamp = (day: string, monthName: string, year: number) => {
    const month = MONTH_NAME_INDEX[monthName.toLowerCase()];
    if (month === undefined) return Number.NaN;
    return new Date(year, month, Number(day), 23, 59, 59).getTime();
  };

  const first = matches[0];
  const last = matches[matches.length - 1];
  const year = new Date().getFullYear();
  const start = toTimestamp(first[1], first[2], year);
  let end = toTimestamp(last[1], last[2], year);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  // A range that reads as ending before it starts within the same calendar
  // year almost always means it crosses into next year (e.g. published in
  // December for early-January works) rather than being malformed.
  if (end < start) {
    end = toTimestamp(last[1], last[2], year + 1);
  }
  return { start, end };
}

function isWithinParsedAlertWindow(alert: MetroNotifyAlert, graceMs = 1000 * 60 * 60 * 24) {
  const window = parseAlertActiveWindow(`${alert.title} ${alert.summary}`);
  if (!window) return false;
  const now = Date.now();
  return now >= window.start - graceMs && now <= window.end + graceMs;
}

// A multi-night works notice ("buses replace trains ... Monday 7 September
// to Wednesday 9 September") is published once, days or weeks in advance,
// and the feed never touches it again — so a plain "X days ago" reading of
// updatedAt/firstNotifiedAt is honest about when it was PUBLISHED but
// actively misleading about the thing riders actually care about: whether
// it's affecting their trip right now. A closure announced 10 days ago that
// runs tonight is not "10 days ago" news, it's active now.
export function isAlertWindowActiveNow(alert: MetroNotifyAlert) {
  const window = parseAlertActiveWindow(`${alert.title} ${alert.summary}`);
  if (!window) return false;
  const now = Date.now();
  return now >= window.start && now <= window.end;
}

export function isAlertCurrent(alert: MetroNotifyAlert) {
  if (!alert.updatedAt) {
    return true;
  }

  const updatedAt = new Date(alert.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) {
    return true;
  }

  const diff = Date.now() - updatedAt;
  const searchable = `${alert.title} ${alert.summary}`.toLowerCase();

  if (/trespass|police request|police operation|person hit by train/.test(searchable)) {
    return diff <= 1000 * 60 * 15;
  }

  if (/delays?|fault|disruption|minor delay|major delay|service alert/.test(searchable)) {
    return diff <= 1000 * 60 * 60 * 24 * 3;
  }

  return diff <= 1000 * 60 * 60 * 24 * 14;
}

export function isProminentAlert(alert: MetroNotifyAlert) {
  const searchable = `${alert.title} ${alert.summary} ${alert.status}`.toLowerCase();
  const updatedAt = alert.updatedAt ? new Date(alert.updatedAt).getTime() : Number.NaN;
  const hasValidUpdatedAt = Number.isFinite(updatedAt);
  const ageMs = hasValidUpdatedAt ? Date.now() - updatedAt : 0;

  if (/trespass|police request|police operation|person hit by train|fault|disabled train|mechanical|signal|overhead|power fault/.test(searchable)) {
    return true;
  }

  if (/delay|major delay|minor delay|service disruption/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 12;
  }

  if (/buses replace trains|replacement buses|bus replacement|station closed|night works|weekend works|suspended/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 24 * 5 || isWithinParsedAlertWindow(alert);
  }

  if (/car space|car park|parkiteer|escalator|lift outage|pedestrian access|underpass|commuter car park/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 18;
  }

  if (/planned works|station access|access notice/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 36;
  }

  return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 24 * 2;
}

export function isHeadlineAlert(alert: MetroNotifyAlert) {
  const searchable = `${alert.title} ${alert.summary} ${alert.status}`.toLowerCase();
  const updatedAt = alert.updatedAt ? new Date(alert.updatedAt).getTime() : Number.NaN;
  const hasValidUpdatedAt = Number.isFinite(updatedAt);
  const ageMs = hasValidUpdatedAt ? Date.now() - updatedAt : 0;

  if (/trespass|police request|police operation|person hit by train|disabled train|mechanical|signal|overhead|power fault|fault|major delay|minor delay|service disruption|delay/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 12;
  }

  if (/has been cancelled|have been cancelled|service cancelled|run cancelled|cancellation/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 12;
  }

  if (/buses replace trains|replacement buses|bus replacement|station closed|suspended/.test(searchable)) {
    return !hasValidUpdatedAt || ageMs <= 1000 * 60 * 60 * 24 * 3 || isWithinParsedAlertWindow(alert);
  }

  if (/night works|planned works|maintenance|station access|access notice|car space|car park|parkiteer|escalator|lift outage|pedestrian access|underpass|commuter car park/.test(searchable)) {
    return false;
  }

  return false;
}

export async function fetchMetroNotifyAlerts(): Promise<MetroNotifyAlert[]> {
  const response = await fetch(getApiUrl("/api/metro-notify/alerts"));

  if (!response.ok) {
    let message = `Failed to load Metro alerts (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Keep the generic message if the endpoint body is not JSON.
    }
    throw new Error(message);
  }

  const payload = (await response.json()) as MetroNotifyResponse;
  const alerts = Array.isArray(payload) ? payload : payload.alerts ?? [];
  return dedupeMetroAlerts(alerts.map((alert, index) => normaliseMetroAlert(alert, index)));
}

export function isToday(timestamp?: string): boolean {
  if (!timestamp) return false;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function toSearchableText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

type ReportMatchFields = Pick<Report, "lineNumber" | "locationName" | "notes" | "transportType">;

export function metroAlertMatchesReportFields(alert: MetroNotifyAlert, report: ReportMatchFields): boolean {
  const reportText = [
    report.lineNumber,
    report.locationName,
    report.notes,
    report.transportType,
  ]
    .map(toSearchableText)
    .join(" ");

  const alertText = [alert.title, alert.summary, ...alert.lines].map(toSearchableText).join(" ");

  const lineMatches = Boolean(
    report.lineNumber &&
      alert.lines.some((line) => toSearchableText(line).includes(toSearchableText(report.lineNumber))),
  );

  const locationMatches = Boolean(
    report.locationName &&
      (alertText.includes(toSearchableText(report.locationName)) ||
        reportText.includes(alertText.slice(0, 48))),
  );

  return lineMatches || locationMatches;
}

function metroAlertMatchesReport(alert: MetroNotifyAlert, report: Report): boolean {
  return metroAlertMatchesReportFields(alert, report);
}

export function getTodaysCommunityAlerts(reports: Report[], metroAlerts: MetroNotifyAlert[]): Report[] {
  return reports.filter((report) => {
    if (!isToday(report.createdAt)) return false;
    return !metroAlerts.some((alert) => metroAlertMatchesReport(alert, report));
  });
}


