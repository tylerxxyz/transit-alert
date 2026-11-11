import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BellRing, ExternalLink, MessageSquareWarning, TrainFront, X } from "lucide-react";
import { useGetReports } from "@/lib/api-client-react/src/generated/api";
import { fetchMetroNotifyAlerts, getTodaysCommunityAlerts, isAlertCurrent, isAlertWindowActiveNow, isHeadlineAlert, isProminentAlert, type MetroNotifyAlert } from "@/lib/todays-alerts";
import { formatRelativeTime } from "@/lib/relative-time";

type FeaturedAlert =
  | Awaited<ReturnType<typeof fetchMetroNotifyAlerts>>[number]
  | ReturnType<typeof getTodaysCommunityAlerts>[number]
  | undefined;

type AlertFilterId =
  | "all"
  | "trespasser"
  | "police-request"
  | "cancellation"
  | "faulty-train"
  | "track-fault"
  | "bus-replacement"
  | "works-upgrade"
  | "station-access"
  | "delay"
  | "other";

type AlertGroupId =
  | "all"
  | "metro-tunnel"
  | "cross-city"
  | "burnley"
  | "clifton-hill"
  | "northern"
  | "frankston"
  | "stony-point"
  | "buses"
  | "trams"
  | "vline-ballarat"
  | "vline-bendigo"
  | "vline-geelong"
  | "vline-gippsland"
  | "vline-seymour"
  | "xpt"
  | "other";

type AlertFilter = {
  id: AlertFilterId;
  label: string;
  keywords?: string[];
};

type AlertGroup = {
  id: AlertGroupId;
  label: string;
  aliases?: string[];
  activeClassName?: string;
  inactiveBadgeClassName?: string;
  activeBadgeClassName?: string;
};

type AlertBundle = {
  id: string;
  primaryAlert: MetroNotifyAlert;
  alerts: MetroNotifyAlert[];
  displayLines: string[];
  routeLabels: string[];
  timeWindows: string[];
};

const ALERT_FILTERS: AlertFilter[] = [
  { id: "all", label: "All alerts" },
  { id: "trespasser", label: "Trespassers", keywords: ["trespasser", "trespass", "person near the tracks", "person on the tracks"] },
  { id: "police-request", label: "Police request", keywords: ["police request", "police operation", "police presence", "police investigation", "police incident"] },
  { id: "cancellation", label: "Cancellations", keywords: ["has been cancelled", "have been cancelled", "service has been cancelled", "cancellation", "run cancelled"] },
  { id: "faulty-train", label: "Faulty train", keywords: ["faulty train", "disabled train", "train fault", "mechanical fault", "mechanical issue", "equipment fault", "broken down train"] },
  { id: "track-fault", label: "Track fault", keywords: ["track fault", "signalling", "signal fault", "points fault", "overhead fault", "power fault", "infrastructure fault"] },
  { id: "bus-replacement", label: "Bus replacement", keywords: ["bus replacement", "replacement bus", "buses replace trains", "replacement buses", "buses will replace trains", "coach replacement", "coach service"] },
  { id: "works-upgrade", label: "Works / upgrades", keywords: ["planned work", "works", "maintenance", "upgrade", "big build", "occupation", "level crossing removal"] },
  { id: "station-access", label: "Station / access", keywords: ["station detour", "access", "exit", "lift outage", "escalator", "entrance closed", "platform closure"] },
  { id: "delay", label: "Delays", keywords: ["delay", "major delays", "delayed", "service change", "service disruption"] },
  { id: "other", label: "Other" },
];

import { ALERT_NOTIFICATIONS_KEY, setNotificationsEnabled, showAppNotification } from "@/lib/pwa";
import {
  PUSH_LINE_GROUPS,
  PUSH_NOTIFICATION_CATEGORIES,
  fetchPushPreferences,
  readPushCategories,
  readPushLines,
  subscribeToPush,
  unsubscribeFromPush,
  updatePushCategories,
  type PushLineGroup,
  updatePushLines,
} from "@/lib/push";

const ALERT_GROUPS: AlertGroup[] = [
  { id: "all", label: "All groups", activeClassName: "border-white/25 bg-white/12 text-white", inactiveBadgeClassName: "border-white/10 bg-white/5 text-white/70", activeBadgeClassName: "border-white/25 bg-white/12 text-white" },
  { id: "metro-tunnel", label: "Cranbourne, Pakenham and Sunbury", aliases: ["metro tunnel", "pakenham line", "cranbourne line", "sunbury line", "town hall", "state library", "anzac", "arden", "parkville", "watergardens", "st albans", "sunshine", "west footscray", "middle footscray", "footscray", "carnegie", "murrumbeena", "hughesdale", "oakleigh", "huntingdale", "clayton", "westall", "springvale", "sandown park", "noble park", "yarraman", "dandenong", "lynbrook", "merinda park", "cranbourne", "hallam", "narre warren", "berwick", "beaconsfield", "officer", "cardinia road", "pakenham", "east pakenham"], activeClassName: "border-cyan-400/35 bg-cyan-500/15 text-cyan-100", inactiveBadgeClassName: "border-cyan-400/15 bg-cyan-500/10 text-cyan-100/85", activeBadgeClassName: "border-cyan-400/35 bg-cyan-500/15 text-cyan-100" },
  { id: "frankston", label: "Frankston", aliases: ["frankston line", "glen huntly", "ormond", "mckinnon", "bentleigh", "patterson", "moorabbin", "highett", "southland", "cheltenham", "mentone", "parkdale", "mordialloc", "aspendale", "edithvale", "chelsea", "bonbeach", "carrum", "seaford", "kananook", "frankston"], activeClassName: "border-emerald-400/35 bg-emerald-500/15 text-emerald-100", inactiveBadgeClassName: "border-emerald-400/15 bg-emerald-500/10 text-emerald-100/85", activeBadgeClassName: "border-emerald-400/35 bg-emerald-500/15 text-emerald-100" },
  { id: "stony-point", label: "Stony Point", aliases: ["stony point line", "leawarra", "baxter", "somerville", "tyabb", "hastings", "bittern", "crib point", "morradoo", "stony point"], activeClassName: "border-[#028430]/45 bg-[#028430]/18 text-[#B9F5CE]", inactiveBadgeClassName: "border-[#028430]/25 bg-[#028430]/12 text-[#B9F5CE]", activeBadgeClassName: "border-[#028430]/45 bg-[#028430]/18 text-[#B9F5CE]" },
  { id: "cross-city", label: "Werribee, Williamstown and Sandringham", aliases: ["laverton", "werribee line", "williamstown line", "altona loop", "north williamstown", "williamstown beach", "williamstown", "newport", "spotswood", "yarraville", "seddon", "south kensington", "aircraft", "williams landing", "hoppers crossing", "seaholme", "altona", "westona", "werribee", "point cook", "galvin", "paisley", "sandringham line", "prahran", "windsor", "balaclava", "ripponlea", "elsternwick", "gardenvale", "north brighton", "middle brighton", "brighton beach", "hampton", "sandringham"], activeClassName: "border-[#F178AF]/45 bg-[#F178AF]/18 text-[#FFD8EA]", inactiveBadgeClassName: "border-[#F178AF]/25 bg-[#F178AF]/12 text-[#FFD8EA]", activeBadgeClassName: "border-[#F178AF]/45 bg-[#F178AF]/18 text-[#FFD8EA]" },
  { id: "burnley", label: "Belgrave / Lilydale / Alamein / Glen Waverley", aliases: ["belgrave line", "lilydale line", "glen waverley line", "alamein line", "burnley", "east richmond", "hawthorn", "glenferrie", "auburn", "camberwell", "east camberwell", "canterbury", "chatham", "surrey hills", "mont albert", "box hill", "laburnum", "blackburn", "nunawading", "mitcham", "heatherdale", "ringwood", "ringwood east", "croydon", "mooroolbark", "lilydale", "upper ferntree gully", "ferntree gully", "boronia", "bayswater", "heathmont", "tecoma", "belgrave", "riversdale", "willison", "hartwell", "burwood", "ashburton", "alamein", "heyington", "kooyong", "tooronga", "gardiner", "glen iris", "darling", "east malvern", "holmesglen", "jordanville", "mount waverley", "syndal", "glen waverley"], activeClassName: "border-[#4DA3FF]/55 bg-[linear-gradient(135deg,rgba(21,44,107,0.72),rgba(2,6,23,0.92))] text-[#DBEAFF] shadow-[0_0_28px_rgba(77,163,255,0.18)]", inactiveBadgeClassName: "border-[#4DA3FF]/30 bg-[#152C6B]/28 text-[#C8DDFF]", activeBadgeClassName: "border-[#4DA3FF]/50 bg-[#4DA3FF]/16 text-[#EAF4FF]" },
  { id: "clifton-hill", label: "Mernda / Hurstbridge / Clifton Hill", aliases: ["mernda line", "hurstbridge line", "jolimont", "west richmond", "north richmond", "collingwood", "victoria park", "clifton hill", "rushall", "merri", "northcote", "croxton", "thornbury", "bell", "preston", "regent", "reservoir", "ruthven", "keon park", "thomastown", "lalor", "epping", "south morang", "middle gorge", "hawkstowe", "mernda", "westgarth", "dennis", "fairfield", "alphington", "darebin", "ivanhoe", "eaglemont", "heidelberg", "rosanna", "macleod", "watsonia", "greensborough", "montmorency", "eltham", "diamond creek", "wattle glen", "hurstbridge"], activeClassName: "border-rose-400/35 bg-rose-500/15 text-rose-100", inactiveBadgeClassName: "border-rose-400/15 bg-rose-500/10 text-rose-100/85", activeBadgeClassName: "border-rose-400/35 bg-rose-500/15 text-rose-100" },
  { id: "northern", label: "Upfield and Craigieburn", aliases: ["upfield line", "craigieburn line", "north melbourne", "kensington", "newmarket", "ascot vale", "moonee ponds", "essendon", "glenbervie", "strathmore", "pascoe vale", "oak park", "glenroy", "jacana", "broadmeadows", "coolaroo", "roxburgh park", "craigieburn", "macaulay", "flemington bridge", "royal park", "jewell", "brunswick", "anstey", "moreland", "coburg", "batman", "merlynston", "fawkner", "gowrie", "upfield"], activeClassName: "border-amber-400/35 bg-amber-500/15 text-amber-100", inactiveBadgeClassName: "border-amber-400/15 bg-amber-500/10 text-amber-100/85", activeBadgeClassName: "border-amber-400/35 bg-amber-500/15 text-amber-100" },
  { id: "vline-ballarat", label: "Ballarat", activeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]", inactiveBadgeClassName: "border-[#B48CE8]/25 bg-[#B48CE8]/12 text-[#EBE0FB]", activeBadgeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]" },
  { id: "vline-bendigo", label: "Bendigo", activeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]", inactiveBadgeClassName: "border-[#B48CE8]/25 bg-[#B48CE8]/12 text-[#EBE0FB]", activeBadgeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]" },
  { id: "vline-geelong", label: "Geelong", activeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]", inactiveBadgeClassName: "border-[#B48CE8]/25 bg-[#B48CE8]/12 text-[#EBE0FB]", activeBadgeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]" },
  { id: "vline-gippsland", label: "Gippsland", activeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]", inactiveBadgeClassName: "border-[#B48CE8]/25 bg-[#B48CE8]/12 text-[#EBE0FB]", activeBadgeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]" },
  { id: "vline-seymour", label: "Seymour", activeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]", inactiveBadgeClassName: "border-[#B48CE8]/25 bg-[#B48CE8]/12 text-[#EBE0FB]", activeBadgeClassName: "border-[#B48CE8]/45 bg-[#B48CE8]/18 text-[#EBE0FB]" },
  { id: "buses", label: "Buses", activeClassName: "border-[#FF8200]/45 bg-[#FF8200]/18 text-[#FFE1BF]", inactiveBadgeClassName: "border-[#FF8200]/25 bg-[#FF8200]/12 text-[#FFE1BF]", activeBadgeClassName: "border-[#FF8200]/45 bg-[#FF8200]/18 text-[#FFE1BF]" },
  { id: "trams", label: "Trams", activeClassName: "border-lime-400/35 bg-lime-500/15 text-lime-100", inactiveBadgeClassName: "border-lime-400/15 bg-lime-500/10 text-lime-100/85", activeBadgeClassName: "border-lime-400/35 bg-lime-500/15 text-lime-100" },
  { id: "xpt", label: "Sydney XPT", activeClassName: "border-sky-400/35 bg-sky-500/15 text-sky-100", inactiveBadgeClassName: "border-sky-400/15 bg-sky-500/10 text-sky-100/85", activeBadgeClassName: "border-sky-400/35 bg-sky-500/15 text-sky-100" },
  { id: "other", label: "Other", activeClassName: "border-slate-300/35 bg-slate-400/15 text-slate-100", inactiveBadgeClassName: "border-slate-300/15 bg-slate-400/10 text-slate-100/85", activeBadgeClassName: "border-slate-300/35 bg-slate-400/15 text-slate-100" },
];

function getAlertGroupTone(group: AlertGroup, active: boolean) {
  if (active) {
    return group.activeClassName ?? "border-emerald-400/30 bg-emerald-500/15 text-emerald-100";
  }

  return "border-white/10 bg-white/5 text-white/70 hover:bg-white/10";
}

function getAlertGroupBadgeTone(group: AlertGroup, active = false) {
  if (active) {
    return group.activeBadgeClassName ?? "border-emerald-400/35 bg-emerald-500/15 text-emerald-100";
  }

  return group.inactiveBadgeClassName ?? "border-emerald-400/15 bg-emerald-500/10 text-emerald-100/85";
}

function getAlertGroupPillTone(group: AlertGroup) {
  return group.inactiveBadgeClassName ?? "border-emerald-400/15 bg-emerald-500/10 text-emerald-100/85";
}

function getAlertGroupStripTone(group: AlertGroup) {
  switch (group.id) {
    case "metro-tunnel":
      return "bg-cyan-400";
    case "cross-city":
      return "bg-[#F178AF]";
    case "burnley":
      return "bg-[linear-gradient(90deg,#152C6B,#4DA3FF,#152C6B)]";
    case "clifton-hill":
      return "bg-rose-400";
    case "northern":
      return "bg-amber-400";
    case "frankston":
      return "bg-emerald-400";
    case "stony-point":
      return "bg-[#028430]";
    case "vline-ballarat":
    case "vline-bendigo":
    case "vline-geelong":
    case "vline-gippsland":
    case "vline-seymour":
      return "bg-[#B48CE8]";
    case "buses":
      return "bg-[#FF8200]";
    case "trams":
      return "bg-lime-400";
    case "xpt":
      return "bg-sky-400";
    default:
      return "bg-slate-400";
  }
}

function getFeaturedAlertTitle(featuredAlert: FeaturedAlert) {
  if (!featuredAlert) return "No featured alert yet";
  if ("title" in featuredAlert) return featuredAlert.title;
  return featuredAlert.locationName;
}

function getFeaturedAlertSummary(featuredAlert: FeaturedAlert) {
  if (!featuredAlert) return "No active major service alerts right now.";
  if ("summary" in featuredAlert) return featuredAlert.summary || "Metro service alert available.";
  return featuredAlert.notes || "Fresh community context is available for today.";
}

function getAlertCategory(alert: MetroNotifyAlert) {
  const filter = getAlertFilter(alert);
  if (filter.id === "bus-replacement") {
    return "Bus Replacement";
  }
  if (filter.id === "trespasser") {
    return "Trespasser";
  }
  if (filter.id === "police-request") {
    return "Police Request";
  }
  if (filter.id === "cancellation") {
    return "Cancellation";
  }
  if (filter.id === "faulty-train") {
    return "Faulty Train";
  }
  if (filter.id === "track-fault") {
    return "Track Fault";
  }
  if (filter.id === "station-access") {
    return "Station / Access";
  }
  if (filter.id === "works-upgrade") {
    return "Works Alert";
  }
  if (filter.id === "delay") {
    return "Delay";
  }
  return "Service Alert";
}

function getAlertSearchableText(alert: MetroNotifyAlert) {
  return `${alert.title} ${alert.summary} ${alert.lines.join(" ")}`.toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAlertFilter(alert: MetroNotifyAlert): AlertFilter {
  const searchable = getAlertSearchableText(alert);
  // "faulty-train"/"track-fault" are train-specific labels, but some of
  // their trigger keywords ("equipment fault", "mechanical fault") are
  // generic phrasing PTV also uses for tram and bus disruptions — e.g. a
  // real tram alert for an equipment fault on Sydney Road was showing up
  // labelled "Faulty Train". alert.mode is the real, structured signal
  // (not a guess) for which of those this actually is, so skip those two
  // train-specific filters whenever the source feed already says this is a
  // tram or bus alert.
  const isTrainSpecificFilterId = (id: AlertFilter["id"]) => id === "faulty-train" || id === "track-fault";
  const matched = ALERT_FILTERS.find(
    (filter) =>
      filter.id !== "all" &&
      filter.id !== "other" &&
      !(isTrainSpecificFilterId(filter.id) && (alert.mode === "tram" || alert.mode === "bus")) &&
      filter.keywords?.some((keyword) => searchable.includes(keyword)),
  );

  return matched ?? ALERT_FILTERS.find((filter) => filter.id === "other")!;
}

function getAlertGroup(alert: MetroNotifyAlert): AlertGroup {
  // Standalone PTV bus/tram disruptions carry a real `mode` from the source
  // feed. Route descriptions often name a station or suburb that collides
  // with a train line's grouping keywords below (e.g. "Epping Station"), so
  // these are routed to their own group before any of that text matching
  // runs — never Metro's own "buses replace trains" notices, which have no
  // `mode` and should keep grouping with the train line they're replacing.
  if (alert.mode === "bus") {
    return ALERT_GROUPS.find((group) => group.id === "buses")!;
  }
  if (alert.mode === "tram") {
    return ALERT_GROUPS.find((group) => group.id === "trams")!;
  }
  if (alert.mode === "xpt") {
    return ALERT_GROUPS.find((group) => group.id === "xpt")!;
  }
  // V/Line disruptions carry a `corridors` list resolved server-side from
  // structured GTFS route data first, affected stations second, and text
  // matching only as a last resort — never re-run the Metro train-line
  // alias matching below, which is unrelated and could misfile a V/Line
  // alert (e.g. "Pakenham" appears on both a Metro line and a V/Line
  // corridor). A `mode` of "vline" with no resolved corridor genuinely
  // couldn't be identified, so it belongs in "Other" rather than a guess.
  if (alert.mode === "vline") {
    const corridorId = alert.corridors?.[0];
    return ALERT_GROUPS.find((group) => group.id === `vline-${corridorId}`) ?? ALERT_GROUPS.find((group) => group.id === "other")!;
  }

  const titleText = cleanAlertCopy(alert.title).toLowerCase();
  const summaryText = cleanAlertCopy(alert.summary).toLowerCase();
  const searchable = `${titleText} ${summaryText}`;
  const normalisedLines = alert.lines.map((line) => line.trim().toLowerCase());

  if (
    /\bparliament\b/.test(searchable) &&
    /\bcaulfield\b/.test(searchable) &&
    /buses replace trains|replacement buses|bus replacement|coach replacement/.test(searchable)
  ) {
    return ALERT_GROUPS.find((group) => group.id === "frankston")!;
  }

  const scoredGroups = ALERT_GROUPS.map((group) => {
    if (group.id === "all" || group.id === "other") {
      return { group, score: -1 };
    }

    const score = (group.aliases ?? []).reduce((total, alias) => {
      const lower = alias.toLowerCase();
      const pattern = new RegExp(`\\b${escapeRegExp(lower)}\\b`, "i");
      let aliasScore = 0;

      if (normalisedLines.includes(lower)) aliasScore = Math.max(aliasScore, 4);
      if (pattern.test(titleText)) aliasScore = Math.max(aliasScore, 5);
      if (pattern.test(summaryText)) aliasScore = Math.max(aliasScore, 1);

      return total + aliasScore;
    }, 0);

    return { group, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scoredGroups[0]?.group ?? ALERT_GROUPS.find((group) => group.id === "other")!;
}

function getAlertGroups(alert: MetroNotifyAlert) {
  const primaryGroup = getAlertGroup(alert);
  const searchable = `${cleanAlertCopy(alert.title)} ${cleanAlertCopy(alert.summary)}`.toLowerCase();
  const groups = new Map<AlertGroupId, AlertGroup>();
  groups.set(primaryGroup.id, primaryGroup);

  // A single V/Line disruption can span more than one corridor (e.g. "extra
  // services" across the Geelong, Ballarat and Bendigo lines) — show it
  // under every corridor it's actually tagged against, not just the first.
  if (alert.mode === "vline" && (alert.corridors?.length ?? 0) > 1) {
    for (const corridorId of alert.corridors!) {
      const group = ALERT_GROUPS.find((entry) => entry.id === `vline-${corridorId}`);
      if (group) groups.set(group.id, group);
    }
  }

  if (searchable.includes("southern cross") && /platforms?\s*9\s*[–-]\s*14|platforms?\s*11\s*(?:and|&)\s*12|escalator/i.test(searchable)) {
    [
      "burnley",
      "clifton-hill",
      "northern",
      "frankston",
      "cross-city",
    ].forEach((groupId) => {
      const group = ALERT_GROUPS.find((entry) => entry.id === groupId);
      if (group) {
        groups.set(group.id, group);
      }
    });
  }

  return [...groups.values()];
}

function isFreshAlert(updatedAt?: string) {
  if (!updatedAt) return true;
  const diff = Date.now() - new Date(updatedAt).getTime();
  return diff < 1000 * 60 * 60 * 24 * 14;
}

function shouldHideExpiredAlert(alert: MetroNotifyAlert) {
  const filter = getAlertFilter(alert);
  if (filter.id !== "trespasser" && filter.id !== "police-request") {
    return false;
  }

  if (!alert.updatedAt) {
    return false;
  }

  const updatedAt = new Date(alert.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) {
    return false;
  }

  const diff = Date.now() - updatedAt;
  return diff > 1000 * 60 * 15;
}

function getOperationDetail(alert: MetroNotifyAlert) {
  const summary = getAlertFeedDetail(alert);
  if (summary) return summary;
  return "Check run details and plan your journey where possible with service alterations in place.";
}

function cleanAlertCopy(value: string) {
  return value
    .replace(/^\s*(?:aus:vic:)?vic-02-[a-z0-9-]+:{1,2}\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/\bplanned work:\s*/i, "")
    .replace(/\bwhat to expect:\s*/gi, "")
    .trim();
}

function getShortAlertSentence(value: string) {
  const cleaned = cleanAlertCopy(value);
  if (!cleaned) return "";

  const firstSentence = cleaned.match(/[^.!?]+[.!?]?/u)?.[0]?.trim() ?? cleaned;
  const looksBroken =
    firstSentence.length < 12 ||
    /^\d+[.)]?\s*$/u.test(firstSentence) ||
    /^[^a-zA-Z]*\d+[^a-zA-Z]*$/u.test(firstSentence);

  const fallbackSentence = cleaned
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .find((part) => part.length >= 18 && /[a-zA-Z]/u.test(part));

  const candidate = looksBroken ? fallbackSentence ?? cleaned : firstSentence;
  return candidate.length > 220 ? `${candidate.slice(0, 217).trimEnd()}...` : candidate;
}

// These come straight from ALERT_TYPE_LABELS: a generic status word, not a
// description of what actually happened. When that's all we have as the
// "title", the real information (which service, which stations) lives only
// in the summary — show that instead of the bare status word.
const GENERIC_ALERT_STATUS_TITLE = /^(service change|minor delay|major delay|suspended|works alert|travel alert|cancellation|good service|service alert)$/i;

function getAlertFeedHeadline(alert: MetroNotifyAlert) {
  const leadLine = alert.lines.find((line) => line.trim().length > 0)?.trim();
  const title = cleanAlertCopy(alert.title);
  const summary = cleanAlertCopy(alert.summary);
  const descriptiveTitle = title && !GENERIC_ALERT_STATUS_TITLE.test(title) ? title : "";
  const primaryText = descriptiveTitle || getShortAlertSentence(summary) || summary || title || "Service alert in progress.";
  const matchedGroup = getAlertGroup(alert);
  const leadLineMatchesGroup = leadLine
    ? matchedGroup.aliases?.some((alias) => alias.toLowerCase() === leadLine.toLowerCase()) ?? false
    : false;
  const titleStartsWithStationOrLocation = /^(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:Station|stn|car spaces|lift|bus|works|closure|closures)/.test(title);
  const referencesTwoEndpoints = /\b(?:between|from)\s+.+\s+(?:and|to)\s+.+/i.test(title);

  if (!leadLine) {
    return primaryText;
  }

  if (primaryText.toLowerCase().includes(leadLine.toLowerCase())) {
    return primaryText;
  }

  if (!leadLineMatchesGroup || titleStartsWithStationOrLocation) {
    return primaryText;
  }

  if (referencesTwoEndpoints) {
    return primaryText;
  }

  return `${leadLine}: ${primaryText}`;
}

// A closure's main sentence only describes its own two endpoints (e.g. "the
// City and Caulfield") — real, separate bullet guidance for riders going
// FURTHER than that (e.g. "Passengers travelling beyond Caulfield are
// advised to board a Belgrave, Lilydale or Glen Waverley train to Burnley,
// and change for an express replacement bus") is exactly what tells a
// Cranbourne/Pakenham rider how their own trip is actually arranged during
// the closure, and was being silently dropped whenever it happened to match
// (or get swallowed by) the generic fallback line below. Real PTV wording,
// just surfaced instead of discarded.
function extractBeyondClosureGuidance(summary: string) {
  const bulletMatch = summary.match(/[••]\s*([^••]*\bbeyond\b[^••]*)/i);
  if (!bulletMatch) return "";
  return bulletMatch[1].replace(/\s+/g, " ").trim().replace(/\.+$/, "") + ".";
}

function getAlertFeedDetail(alert: MetroNotifyAlert) {
  const title = cleanAlertCopy(alert.title);
  const summary = cleanAlertCopy(alert.summary);
  const shortSummary = getShortAlertSentence(summary);
  const beyondGuidance = extractBeyondClosureGuidance(summary);

  const base =
    shortSummary &&
    shortSummary.toLowerCase() !== title.toLowerCase() &&
    !shortSummary.toLowerCase().includes(title.toLowerCase()) &&
    !title.toLowerCase().includes(shortSummary.toLowerCase())
      ? shortSummary
      : "Check run details and plan ahead if your trip is affected.";

  if (beyondGuidance && !base.toLowerCase().includes(beyondGuidance.toLowerCase().slice(0, 24))) {
    return `${base} ${beyondGuidance}`;
  }

  return base;
}

function getAlertDisplayLines(alert: MetroNotifyAlert) {
  const titleText = cleanAlertCopy(alert.title).toLowerCase();
  const summaryText = cleanAlertCopy(alert.summary).toLowerCase();
  const searchable = `${titleText} ${summaryText}`;
  const group = getAlertGroup(alert);

  if (group.id === "metro-tunnel") {
    if (
      searchable.includes("caulfield") ||
      searchable.includes("westall") ||
      searchable.includes("carnegie") ||
      searchable.includes("murrumbeena") ||
      searchable.includes("hughesdale") ||
      searchable.includes("oakleigh") ||
      searchable.includes("huntingdale") ||
      searchable.includes("clayton")
    ) {
      return ["Cranbourne and Pakenham"];
    }
    if (
      searchable.includes("north melbourne") ||
      searchable.includes("sunshine") ||
      searchable.includes("footscray") ||
      searchable.includes("middle footscray") ||
      searchable.includes("west footscray") ||
      searchable.includes("tottenham") ||
      searchable.includes("albion") ||
      searchable.includes("ginifer") ||
      searchable.includes("st albans") ||
      searchable.includes("keilor plains") ||
      searchable.includes("watergardens")
    ) {
      return ["Sunbury Line"];
    }
    if (searchable.includes("dandenong")) {
      return ["Cranbourne and Pakenham"];
    }
    if (searchable.includes("cranbourne")) {
      return ["Cranbourne Line"];
    }
    if (searchable.includes("pakenham")) {
      return ["Pakenham Line"];
    }
    if (searchable.includes("sunbury")) {
      return ["Sunbury Line"];
    }
    return ["Cranbourne, Pakenham and Sunbury"];
  }

  if (group.id === "northern") {
    if (searchable.includes("pascoe vale")) {
      return ["Craigieburn corridor"];
    }
    if (searchable.includes("upfield")) {
      return ["Upfield corridor"];
    }
    if (searchable.includes("craigieburn")) {
      return ["Craigieburn corridor"];
    }
  }

  if (group.id === "cross-city") {
    if (searchable.includes("williamstown")) {
      return ["Williamstown corridor"];
    }
    if (searchable.includes("werribee")) {
      return ["Werribee corridor"];
    }
    if (searchable.includes("laverton")) {
      return ["Laverton corridor"];
    }
  }

  if (group.id === "frankston") {
    if (searchable.includes("stony point")) {
      return ["Stony Point Line"];
    }
    if (searchable.includes("frankston")) {
      return ["Frankston Line"];
    }
  }

  const matchingLines = alert.lines.filter((line) =>
    group.aliases?.some((alias) => alias.toLowerCase() === line.trim().toLowerCase()),
  );

  if (matchingLines.length > 0) {
    return matchingLines;
  }

  return [group.label];
}

// Belgrave/Lilydale/Alamein/Glen Waverley, Clifton Hill, and Upfield/
// Craigieburn are the three groups still routed via the original City Loop —
// PTV's own alert text just says "the City" generically rather than naming a
// station, so substitute the real, specific loop station these lines
// actually enter through instead of the vague "city".
// Frankston/Cranbourne/Pakenham/Sunbury moved to the Metro Tunnel instead:
// confirmed by their own closure text ("no trains running through Arden,
// Parkville, State Library, Town Hall and Anzac stations"), which also
// confirms the real, specific substitution for THESE lines — Town Hall, not
// Parliament (a real fact worth acting on for these too, not just the loop
// groups above).
const CITY_PLACE_NAME_BY_ALERT_GROUP_ID: Partial<Record<AlertGroupId, string>> = {
  burnley: "Parliament",
  "clifton-hill": "Parliament",
  northern: "Parliament",
  "metro-tunnel": "Town Hall",
  frankston: "Town Hall",
};

function replaceGenericCityPlaceName(value: string, alert: MetroNotifyAlert) {
  const replacement = CITY_PLACE_NAME_BY_ALERT_GROUP_ID[getAlertGroup(alert).id];
  if (!replacement) return value;
  return /^(the\s+)?city$/i.test(value.trim()) ? replacement : value;
}

function getAlertRouteLabel(alert: MetroNotifyAlert) {
  const title = cleanAlertCopy(alert.title);

  const fromMatch = title.match(/\bfrom\s+(.+?)\s+to\s+(.+)$/i);
  if (fromMatch) {
    return `${replaceGenericCityPlaceName(fromMatch[1].trim(), alert)} -> ${replaceGenericCityPlaceName(fromMatch[2].trim(), alert)}`;
  }

  const betweenMatch = title.match(/\bbetween\s+(.+?)\s+and\s+(.+)$/i);
  if (betweenMatch) {
    return `${replaceGenericCityPlaceName(betweenMatch[1].trim(), alert)} <-> ${replaceGenericCityPlaceName(betweenMatch[2].trim(), alert)}`;
  }

  const stationMatch = title.match(/^(.+?)\s+Station\s+/i);
  if (stationMatch?.[1]?.trim()) {
    return `${stationMatch[1].trim()} Station`;
  }

  return null;
}

function buildMetroPlannedWorksSlug(title: string) {
  return cleanAlertCopy(title)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getAlertDetailUrl(alert: MetroNotifyAlert) {
  const cleanedTitle = cleanAlertCopy(alert.title);
  const searchable = `${cleanedTitle} ${cleanAlertCopy(alert.summary)}`.toLowerCase();

  if (alert.url) {
    return alert.url;
  }

  if (
    searchable.includes("williams landing car space closures") ||
    (searchable.includes("williams landing") && searchable.includes("wallace avenue"))
  ) {
    return "https://www.metrotrains.com.au/planned-works/?pwId=714131";
  }

  if (
    searchable.includes("buses replace trains from newport to werribee") ||
    (searchable.includes("newport") && searchable.includes("werribee") && searchable.includes("replacement buses"))
  ) {
    return "https://www.metrotrains.com.au/planned-works/?pwId=726190";
  }

  const isWorksAlert = getAlertFilter(alert).id === "works-upgrade" || searchable.includes("planned work");

  if (isWorksAlert) {
    const slug = buildMetroPlannedWorksSlug(cleanedTitle);
    if (slug) {
      return `https://www.metrotrains.com.au/planned-works/${slug}/`;
    }
    return "https://www.metrotrains.com.au/planned-works/";
  }

  return alert.url || "https://transport.vic.gov.au/disruptions/disruptions-information";
}

function getAlertTimeWindow(alert: MetroNotifyAlert) {
  const detail = getAlertFeedDetail(alert);
  if (detail && detail !== "Check run details and plan ahead if your trip is affected.") {
    return detail;
  }

  return cleanAlertCopy(alert.summary);
}

function getAlertBundleKey(alert: MetroNotifyAlert) {
  const group = getAlertGroup(alert);
  const filter = getAlertFilter(alert);
  const searchable = `${cleanAlertCopy(alert.title)} ${cleanAlertCopy(alert.summary)} ${alert.lines.join(" ")}`.toLowerCase();
  const isReplacementBus =
    /buses replace trains|replacement buses|bus replacement|coach replacement/.test(searchable) ||
    filter.id === "bus-replacement";

  if (isReplacementBus) {
    let corridor = getAlertDisplayLines(alert)[0] ?? group.label;

    if (searchable.includes("williamstown")) {
      corridor = "Williamstown corridor";
    } else if (searchable.includes("werribee")) {
      corridor = "Werribee corridor";
    } else if (searchable.includes("frankston")) {
      corridor = "Frankston Line";
    } else if (searchable.includes("sandringham")) {
      corridor = "Sandringham Line";
    }

    return `${group.id}:${filter.id}:replacement:${corridor.toLowerCase()}`;
  }

  return `${alert.id}`;
}

function uniqueAlertValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// PTV's own updatedAt can sit on a longer-running disruption record that
// genuinely hasn't been touched in hours, even though this specific train's
// cancellation just appeared under it — firstNotifiedAt (real: recorded the
// moment we detected and pushed this exact alert) is the more accurate "how
// long ago" fact whenever we have it. Not a one-off fix: every "time ago"
// display for a metro alert on this page should prefer it the same way.
function getMelbourneNowMinutesSinceMidnight() {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

// A cancellation alert's own title spells out the real scheduled time of the
// specific service ("The 5:02pm Sandringham to Flinders Street service has
// been cancelled") — a same-day, real fact that's far more precise than
// PTV's own batch-level updatedAt on the longer-running disruption record
// this specific cancellation happens to be filed under. Only trusted when it
// lands within the last 18 hours of Melbourne's current clock, so a stray
// time-like substring elsewhere in the text can't be misread as today's
// event and, e.g., produce a bogus "in 3 hours" reading.
function extractCancellationEventAgeMs(alert: MetroNotifyAlert): number | undefined {
  const match = `${alert.title} ${alert.summary}`.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  if (!match) return undefined;
  let hour = Number(match[1]) % 12;
  if (/pm/i.test(match[3])) hour += 12;
  const minute = Number(match[2]);
  const diffMinutes = getMelbourneNowMinutesSinceMidnight() - (hour * 60 + minute);
  if (diffMinutes < 0 || diffMinutes > 18 * 60) return undefined;
  return diffMinutes * 60_000;
}

function getAlertAgeTimestamp(alert: MetroNotifyAlert): string | number | undefined {
  if (alert.firstNotifiedAt) return alert.firstNotifiedAt;
  const eventAgeMs = extractCancellationEventAgeMs(alert);
  if (eventAgeMs !== undefined) return Date.now() - eventAgeMs;
  return alert.updatedAt;
}

// A multi-night closure announced days ago but running right now shouldn't
// read as old news — see isAlertWindowActiveNow.
function getAlertAgeLabel(alert: MetroNotifyAlert): string {
  if (isAlertWindowActiveNow(alert)) return "Active now";
  const timestamp = getAlertAgeTimestamp(alert);
  return timestamp ? formatRelativeTime(timestamp) : "Just updated";
}

function bundleSimilarAlerts(alerts: MetroNotifyAlert[]): AlertBundle[] {
  const bundles = new Map<string, MetroNotifyAlert[]>();

  for (const alert of alerts) {
    const key = getAlertBundleKey(alert);
    const existing = bundles.get(key);
    if (existing) {
      existing.push(alert);
    } else {
      bundles.set(key, [alert]);
    }
  }

  return [...bundles.entries()].map(([id, bundleAlerts]) => {
    const primaryAlert = bundleAlerts[0];
    return {
      id,
      primaryAlert,
      alerts: bundleAlerts,
      displayLines: uniqueAlertValues(bundleAlerts.flatMap((alert) => getAlertDisplayLines(alert))),
      routeLabels: uniqueAlertValues(bundleAlerts.map((alert) => getAlertRouteLabel(alert))),
      timeWindows: uniqueAlertValues(bundleAlerts.map((alert) => getAlertTimeWindow(alert))),
    };
  });
}

export default function TodaysAlerts() {
  const [selectedFilter, setSelectedFilter] = useState<AlertFilterId>("all");
  const [selectedGroup, setSelectedGroup] = useState<AlertGroupId>("all");
  const [expandedGroupId, setExpandedGroupId] = useState<AlertGroupId | null>(null);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<NotificationPermission | "unsupported">(
    typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission,
  );
  // null means "every category" — matches readPushCategories()'s own default
  // so a rider who's never touched this sees every box checked, the same
  // behaviour they already had before this preference existed.
  const [pushCategories, setPushCategories] = useState<string[] | null>(() => readPushCategories());
  // null means "every line" — same default-everything contract as
  // pushCategories above.
  const [pushLines, setPushLines] = useState<string[] | null>(() => readPushLines());
  const seenAlertIdsRef = useRef<string[]>([]);
  const { data: reports, isError: reportsError } = useGetReports({
    query: { queryKey: ["/api/reports"], refetchInterval: 60000 },
  });

  const { data: metroAlerts = [] } = useQuery({
    queryKey: ["/api/metro-notify/alerts"],
    queryFn: fetchMetroNotifyAlerts,
    refetchInterval: 60000,
  });

  const allReports = Array.isArray(reports) ? reports : [];
  const communityAlerts = useMemo(
    () => getTodaysCommunityAlerts(allReports, metroAlerts),
    [allReports, metroAlerts],
  );

  const activeMetroAlerts = useMemo(
    () => metroAlerts.filter((alert) => !shouldHideExpiredAlert(alert) && isAlertCurrent(alert)),
    [metroAlerts],
  );
  const headlineMetroAlerts = useMemo(
    () => activeMetroAlerts.filter((alert) => isHeadlineAlert(alert)),
    [activeMetroAlerts],
  );
  const prominentMetroAlerts = useMemo(
    () => activeMetroAlerts.filter((alert) => isProminentAlert(alert)),
    [activeMetroAlerts],
  );
  const sortedMetroAlerts = useMemo(
    () =>
      [...headlineMetroAlerts].sort((a, b) => {
        const left = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const right = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return right - left;
      }),
    [headlineMetroAlerts],
  );
  const filteredMetroAlerts = useMemo(() => {
    return sortedMetroAlerts.filter((alert) => {
      const typeMatches = selectedFilter === "all" || getAlertFilter(alert).id === selectedFilter;
      const groupMatches = selectedGroup === "all" || getAlertGroups(alert).some((group) => group.id === selectedGroup);
      return typeMatches && groupMatches;
    });
  }, [selectedFilter, selectedGroup, sortedMetroAlerts]);
  const groupedAlertSummaries = useMemo(
    () =>
      ALERT_GROUPS.filter((group) => group.id !== "all").map((group) => {
        const alerts = sortedMetroAlerts.filter((alert) => getAlertGroups(alert).some((entry) => entry.id === group.id));
        return {
          group,
          count: alerts.length,
          previewAlerts: alerts.slice(0, 3),
        };
      }),
    [sortedMetroAlerts],
  );
  const expandedGroup = expandedGroupId
    ? ALERT_GROUPS.find((group) => group.id === expandedGroupId) ?? null
    : null;
  const expandedGroupAlerts = expandedGroup
    ? sortedMetroAlerts.filter((alert) => getAlertGroups(alert).some((group) => group.id === expandedGroup.id))
    : [];
  const filteredMetroAlertBundles = useMemo(
    () => bundleSimilarAlerts(filteredMetroAlerts),
    [filteredMetroAlerts],
  );
  const expandedGroupAlertBundles = useMemo(
    () => bundleSimilarAlerts(expandedGroupAlerts),
    [expandedGroupAlerts],
  );
  const featuredAlert = filteredMetroAlerts[0] ?? sortedMetroAlerts[0] ?? prominentMetroAlerts[0] ?? communityAlerts[0];
  const operationCards = filteredMetroAlerts.slice(0, 3);
  const activeFilterLabel = ALERT_FILTERS.find((filter) => filter.id === selectedFilter)?.label ?? "All alerts";
  const activeGroupLabel = ALERT_GROUPS.find((group) => group.id === selectedGroup)?.label ?? "All groups";
  const browserNotificationsSupported =
    typeof window !== "undefined" && "Notification" in window;
  const browserNotificationsStatusLabel =
    browserNotificationPermission === "granted"
      ? browserNotificationsEnabled
        ? "On"
        : "Ready"
      : browserNotificationPermission === "denied"
        ? "Blocked"
        : browserNotificationPermission === "unsupported"
          ? "Unsupported"
          : "Off";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(ALERT_NOTIFICATIONS_KEY);
    setBrowserNotificationsEnabled(stored === "true");
    if ("Notification" in window) {
      setBrowserNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    const currentIds = metroAlerts.map((alert) => alert.id);
    if (seenAlertIdsRef.current.length === 0) {
      seenAlertIdsRef.current = currentIds;
      return;
    }

    if (
      !browserNotificationsEnabled ||
      !browserNotificationsSupported ||
      browserNotificationPermission !== "granted"
    ) {
      seenAlertIdsRef.current = currentIds;
      return;
    }

    const newAlerts = metroAlerts.filter((alert) => !seenAlertIdsRef.current.includes(alert.id));
    if (newAlerts.length > 0 && typeof document !== "undefined" && document.visibilityState === "hidden") {
      newAlerts.slice(0, 3).forEach((alert) => {
        void showAppNotification(getAlertCategory(alert), {
          body: getAlertFeedHeadline(alert),
          tag: `transitalert-${alert.id}`,
          data: { url: `${import.meta.env.BASE_URL}alerts/today` },
        });
      });
    }

    seenAlertIdsRef.current = currentIds;
  }, [
    browserNotificationPermission,
    browserNotificationsEnabled,
    browserNotificationsSupported,
    metroAlerts,
  ]);

  const handleToggleBrowserNotifications = async () => {
    if (!browserNotificationsSupported || typeof window === "undefined") {
      return;
    }

    if (browserNotificationPermission === "granted") {
      const nextValue = !browserNotificationsEnabled;
      setBrowserNotificationsEnabled(nextValue);
      setNotificationsEnabled(nextValue);
      if (nextValue) {
        void subscribeToPush();
      } else {
        void unsubscribeFromPush();
      }
      return;
    }

    if (browserNotificationPermission === "denied") {
      return;
    }

    const permission = await Notification.requestPermission();
    setBrowserNotificationPermission(permission);
    const enabled = permission === "granted";
    setBrowserNotificationsEnabled(enabled);
    setNotificationsEnabled(enabled);
    if (enabled) {
      void subscribeToPush();
    }
  };

  // Toggling a box only updates local state now — the actual save (and the
  // network round trip that comes with it) happens once, when Apply changes
  // is pressed, rather than firing on every single tap.
  const [hasPendingPushChanges, setHasPendingPushChanges] = useState(false);
  const [isApplyingPushChanges, setIsApplyingPushChanges] = useState(false);
  const [pushSaveError, setPushSaveError] = useState("");

  useEffect(() => {
    if (hasPendingPushChanges) return;
    let active = true;
    void fetchPushPreferences().then((saved) => {
      if (active && saved) { setPushCategories(saved.categories); setPushLines(saved.lines); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [hasPendingPushChanges]);

  const handleTogglePushCategory = (categoryId: string) => {
    // Legacy defaults include disruption categories; favourite tracking is opt-in.
    const current = pushCategories ?? PUSH_NOTIFICATION_CATEGORIES.filter((category) => category.id !== "train-tracking").map((category) => category.id);
    const next = current.includes(categoryId)
      ? current.filter((id) => id !== categoryId)
      : [...current, categoryId];
    // Keep the explicit list, including [] and the tracking opt-in.
    const nextValue = next;
    setPushCategories(nextValue);
    setHasPendingPushChanges(true);
  };

  const allPushLines = PUSH_LINE_GROUPS.flatMap((group) => group.lines);

  const handleTogglePushLineGroup = (group: PushLineGroup) => {
    // null (today's state) reads as "every line" — same expand-to-explicit-
    // list pattern as handleTogglePushCategory above. A group toggles all of
    // its real line names together as a unit.
    const current = pushLines ?? allPushLines;
    const isGroupChecked = group.lines.every((line) => current.includes(line));
    const next = isGroupChecked
      ? current.filter((line) => !group.lines.includes(line))
      : [...current, ...group.lines.filter((line) => !current.includes(line))];
    const nextValue = next.length === allPushLines.length ? null : next;
    setPushLines(nextValue);
    setHasPendingPushChanges(true);
  };

  const handleApplyPushChanges = async () => {
    setIsApplyingPushChanges(true);
    setPushSaveError("");
    try {
      const saved = await Promise.all([updatePushCategories(pushCategories), updatePushLines(pushLines)]);
      if (saved.every(Boolean)) setHasPendingPushChanges(false);
      else setPushSaveError("Preferences could not be saved. Check that you are signed in and try again.");
    } catch {
      setPushSaveError("Preferences could not be saved. Check your connection and try again.");
    } finally {
      setIsApplyingPushChanges(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-background text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300/80">Featured View</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Today&apos;s Alerts</h1>
            <p className="mt-2 text-sm text-white/60">
              Filtered alert cards and community reports in one place.
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to map
          </Link>
        </div>

        <div>
          <section className="rounded-[2rem] border border-white/10 bg-card/80 p-6 shadow-2xl backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-200">
                <BellRing className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300/80">
                  Today&apos;s featured alert
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{getFeaturedAlertTitle(featuredAlert)}</h2>
                <p className="mt-2 text-sm text-white/70">{getFeaturedAlertSummary(featuredAlert)}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Metro Notify</p>
                <p className="mt-2 text-3xl font-bold text-white">{sortedMetroAlerts.length}</p>
                <p className="mt-1 text-xs text-white/55">Service notifications</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Community</p>
                <p className="mt-2 text-3xl font-bold text-white">{reportsError ? "Unavailable" : communityAlerts.length}</p>
                <p className="mt-1 text-xs text-white/55">Unique reports today</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Filtering</p>
                <p className="mt-2 text-3xl font-bold text-white">{reportsError ? "Unavailable" : Math.max(allReports.length - communityAlerts.length, 0)}</p>
                <p className="mt-1 text-xs text-white/55">Reports omitted from today's view</p>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-[2rem] border border-white/10 bg-card/80 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300/80">Live Operations</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{filteredMetroAlerts.length} New Alerts</h2>
              <p className="mt-2 text-sm text-white/60">{activeFilterLabel} · {activeGroupLabel} / newest first</p>
            </div>

            <div className="grid gap-3 md:min-w-[320px]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/45">Push notifications</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-lg font-semibold text-white">{browserNotificationsStatusLabel}</p>
                  <button
                    type="button"
                    onClick={handleToggleBrowserNotifications}
                    disabled={!browserNotificationsSupported}
                    className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      !browserNotificationsSupported
                        ? "cursor-not-allowed border-white/10 bg-white/5 text-white/35"
                        : browserNotificationsEnabled
                          ? "border-emerald-400/25 bg-emerald-500/15 text-emerald-100"
                          : "border-blue-400/25 bg-blue-500/15 text-blue-100 hover:bg-blue-500/20"
                    }`}
                  >
                    {browserNotificationsEnabled ? "Turn off" : "Turn on"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-white/55">
                  {browserNotificationPermission === "denied"
                    ? "Blocked by device settings. On iPhone open Settings → Apps → TransitAlert → Notifications → Allow Notifications, then return here."
                    : browserNotificationsSupported
                      ? "One tap enables push alerts for new Metro disruptions, even when TransitAlert is closed."
                      : "This browser does not support web notifications here."}
                </p>
              </div>
            </div>
          </div>

          {browserNotificationsEnabled && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">Notification preferences</p>
              <p className="mt-1 text-xs text-white/55">
                Choose which alert types you want pushed. Favourite Set / Train Tracking requires sign-in and only alerts for your own favourites.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PUSH_NOTIFICATION_CATEGORIES.map((category) => {
                  const isChecked = pushCategories === null ? category.id !== "train-tracking" : pushCategories.includes(category.id);
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => handleTogglePushCategory(category.id)}
                      aria-pressed={isChecked}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        isChecked
                          ? "border-emerald-400/25 bg-emerald-500/15 text-emerald-100"
                          : "border-white/10 bg-white/5 text-white/45 hover:bg-white/10"
                      }`}
                    >
                      {category.label}
                    </button>
                  );
                })}
              </div>

              <p className="mt-4 text-xs uppercase tracking-[0.18em] text-white/45">Lines &amp; services</p>
              <p className="mt-1 text-xs text-white/55">
                Only get pushed alerts for the lines you actually ride — untick anything you don&apos;t need.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PUSH_LINE_GROUPS.map((group) => {
                  const isChecked = pushLines === null || group.lines.every((line) => pushLines.includes(line));
                  return (
                    <button
                      key={group.label}
                      type="button"
                      onClick={() => handleTogglePushLineGroup(group)}
                      aria-pressed={isChecked}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        isChecked ? "" : "border-white/10 bg-white/5 text-white/45 hover:bg-white/10"
                      }`}
                      style={isChecked ? { borderColor: `${group.color}55`, backgroundColor: `${group.color}22`, color: group.color } : undefined}
                    >
                      {group.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => void handleApplyPushChanges()}
                disabled={!hasPendingPushChanges || isApplyingPushChanges}
                className={`mt-4 w-full rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  hasPendingPushChanges
                    ? "border-blue-400/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30"
                    : "cursor-not-allowed border-white/10 bg-white/5 text-white/35"
                }`}
              >
                {isApplyingPushChanges ? "Applying…" : hasPendingPushChanges ? "Apply changes" : "Changes saved"}
              </button>
              {pushSaveError && <p role="alert" className="mt-2 text-xs text-red-300">{pushSaveError}</p>}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {ALERT_FILTERS.map((filter) => {
              const isActive = selectedFilter === filter.id;
              const count =
                filter.id === "all"
                  ? sortedMetroAlerts.length
                  : sortedMetroAlerts.filter((alert) => getAlertFilter(alert).id === filter.id).length;

              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setSelectedFilter(filter.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? "border-blue-400/30 bg-blue-500/15 text-blue-100"
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {filter.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? "bg-blue-400/20 text-blue-100" : "bg-white/10 text-white/65"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {groupedAlertSummaries.map(({ group, count, previewAlerts }) => {
              const isActive = selectedGroup === group.id;
              const remainingAlertCount = Math.max(0, count - previewAlerts.length);

              return (
                <button
                  key={`group-summary-${group.id}`}
                  type="button"
                  onClick={() => {
                    setSelectedGroup(group.id);
                    setExpandedGroupId(group.id);
                  }}
                  className={`relative overflow-hidden rounded-[1.25rem] border p-4 pt-5 text-left transition ${getAlertGroupTone(group, isActive)}`}
                >
                  <div className={`absolute inset-x-0 top-0 h-1.5 ${getAlertGroupStripTone(group)}`} />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{group.label}</p>
                      <p className="mt-1 text-xs text-white/55">
                        {count === 0
                          ? "No current alerts"
                          : count === 1
                            ? "1 active alert"
                            : `${count} active alerts`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${getAlertGroupBadgeTone(group, isActive)}`}>
                      {count}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-black/10 p-3">
                    {previewAlerts.length > 0 ? (
                      previewAlerts.map((alert, index) => (
                        <div
                          key={`group-summary-${group.id}-${alert.id}`}
                          className={index === 0 ? "" : "border-t border-white/10 pt-2"}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/65">
                              {getAlertCategory(alert)}
                            </span>
                            {getAlertDisplayLines(alert).slice(0, 2).map((line) => (
                              <span key={`${alert.id}-${line}`} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getAlertGroupPillTone(group)}`}>
                                {line}
                              </span>
                            ))}
                          </div>
                          <p className="mt-1.5 text-sm font-semibold leading-snug text-white">
                            {getAlertFeedHeadline(alert)}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-white/60">
                            {getAlertFeedDetail(alert)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-white/45">
                        Nothing major is showing for this group right now.
                      </p>
                    )}
                    {remainingAlertCount > 0 && (
                      <p className="border-t border-white/10 pt-2 text-xs font-semibold text-white/55">
                        +{remainingAlertCount} more active {remainingAlertCount === 1 ? "update" : "updates"} on this group
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 space-y-3">
            {operationCards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-5 text-sm text-white/55">
                No live operations alerts match the current filter right now.
              </div>
            ) : (
              operationCards.map((alert) => {
                const category = getAlertCategory(alert);
                const alertGroup = getAlertGroup(alert);
                const fresh = isFreshAlert(alert.updatedAt);
                const detailUrl = getAlertDetailUrl(alert);
                const displayLines = getAlertDisplayLines(alert);
                const routeLabel = getAlertRouteLabel(alert);
                const pillTone = getAlertGroupPillTone(alertGroup);

                return (
                  <article key={`operations-${alert.id}`} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">{category}</span>
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${getAlertGroupBadgeTone(alertGroup)}`}>
                            {alertGroup.label}
                          </span>
                          {fresh && (
                            <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-200">
                              New
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-white/45">{getAlertAgeLabel(alert)}</p>
                      </div>

                      <h3 className="mt-3 text-lg font-semibold leading-snug text-white">
                        {getAlertFeedHeadline(alert)}
                      </h3>
                      <p className="mt-2 text-sm text-white/60">{getAlertFeedDetail(alert)}</p>

                      {(displayLines.length > 0 || routeLabel || alert.tdn) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {displayLines.map((line) => (
                            <span
                              key={`operations-${alert.id}-${line}`}
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${pillTone}`}
                            >
                              {line}
                            </span>
                          ))}
                          {routeLabel ? (
                            <span className={`rounded-full border px-3 py-1 text-xs font-medium ${pillTone}`}>
                              {routeLabel}
                            </span>
                          ) : null}
                          {alert.tdn ? (
                            <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
                              TDN {alert.tdn}
                            </span>
                          ) : null}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <a
                          href={detailUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                        >
                          Details here
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        {alert.addToCalendarUrl && (
                          <a
                            href={alert.addToCalendarUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                          >
                            Add to calendar
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-white/10 bg-card/80 p-6 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3">
              <TrainFront className="h-5 w-5 text-blue-300" />
              <div>
                <h2 className="text-lg font-semibold">Metro service notifications</h2>
                <p className="text-sm text-white/60">Live Metro network alerts and planned works in one place.</p>
              </div>
            </div>

            <div className="space-y-3">
              {filteredMetroAlertBundles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-5 text-sm text-white/55">
                  No Metro service alerts match the current filter right now.
                </div>
              ) : (
                filteredMetroAlertBundles.map((bundle) => {
                  const alert = bundle.primaryAlert;
                  const alertGroup = getAlertGroup(alert);
                  const displayLines = bundle.displayLines;
                  const pillTone = getAlertGroupPillTone(alertGroup);

                  return (
                  <article key={bundle.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">{getAlertCategory(alert)}</span>
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getAlertGroupBadgeTone(alertGroup)}`}>
                            {alertGroup.label}
                          </span>
                          {bundle.alerts.length > 1 && (
                            <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                              {bundle.alerts.length} windows
                            </span>
                          )}
                        </div>
                        <h3 className="mt-2 text-base font-semibold leading-snug text-white">
                          {getAlertFeedHeadline(alert)}
                        </h3>
                        <p className="mt-2 text-sm text-white/60">{getAlertFeedDetail(alert)}</p>
                      </div>
                      <p className="shrink-0 text-xs text-white/45">{getAlertAgeLabel(alert)}</p>
                    </div>

                    {(displayLines.length > 0 || bundle.routeLabels.length > 0) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {displayLines.map((line) => (
                          <span key={`${bundle.id}-${line}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${pillTone}`}>
                            {line}
                          </span>
                        ))}
                        {bundle.routeLabels.map((routeLabel) => (
                          <span key={`${bundle.id}-${routeLabel}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${pillTone}`}>
                            {routeLabel}
                          </span>
                        ))}
                      </div>
                    )}

                    {bundle.timeWindows.length > 1 && (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Affected times</p>
                        <div className="mt-2 space-y-1.5">
                          {bundle.timeWindows.map((timeWindow) => (
                            <p key={`${bundle.id}-${timeWindow}`} className="text-xs leading-relaxed text-white/70">
                              {timeWindow}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {getAlertDetailUrl(alert) && (
                        <a
                          href={getAlertDetailUrl(alert)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                        >
                          Details here
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {alert.addToCalendarUrl && (
                        <a
                          href={alert.addToCalendarUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                        >
                          Add to calendar
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </article>
                );
                })
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-card/80 p-6 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3">
              <MessageSquareWarning className="h-5 w-5 text-amber-300" />
              <div>
                <h2 className="text-lg font-semibold">Community alerts</h2>
                <p className="text-sm text-white/60">User reports that add fresh detail beyond Metro service notices.</p>
              </div>
            </div>

            <div className="space-y-3">
              {reportsError ? (
                <div role="status" className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm text-amber-100/80">
                  Community reports are unavailable right now. This does not mean there are no reports. Please try again later.
                </div>
              ) : communityAlerts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-5 text-sm text-white/55">
                  No unique community alerts for today yet.
                </div>
              ) : (
                communityAlerts.map((report) => (
                  <article key={report.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-white">
                          {report.locationName}
                          {report.lineNumber ? ` - ${report.lineNumber}` : ""}
                        </h3>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/45">
                          {report.transportType} - {report.reportType}
                        </p>
                      </div>
                      <span className="text-xs text-white/45">
                        {formatRelativeTime(report.createdAt)}
                      </span>
                    </div>

                    {report.notes && <p className="mt-3 text-sm text-white/70">{report.notes}</p>}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {expandedGroup && (
        <div className="fixed inset-0 z-[1200] flex items-start justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-md">
          <div className="max-h-[calc(100dvh-3rem)] w-full max-w-5xl overflow-y-auto rounded-[2rem] border border-white/10 bg-slate-950/96 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300/80">
                  Alert group
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{expandedGroup.label}</h2>
                <p className="mt-2 text-sm text-white/60">
                  {expandedGroupAlerts.length === 0
                    ? "No active alerts in this group right now."
                    : expandedGroupAlerts.length === 1
                      ? "1 active alert in this corridor."
                      : `${expandedGroupAlerts.length} active alerts in this corridor.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpandedGroupId(null)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <X className="h-4 w-4" />
                Close
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {expandedGroupAlertBundles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-5 text-sm text-white/55">
                  Nothing major is showing for this group right now.
                </div>
              ) : (
                expandedGroupAlertBundles.map((bundle) => {
                  const alert = bundle.primaryAlert;
                  const displayLines = bundle.displayLines;
                  const pillTone = getAlertGroupPillTone(expandedGroup);

                  return (
                  <article key={`expanded-${bundle.id}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">{getAlertCategory(alert)}</span>
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getAlertGroupBadgeTone(expandedGroup)}`}>
                            {expandedGroup.label}
                          </span>
                          {bundle.alerts.length > 1 && (
                            <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                              {bundle.alerts.length} windows
                            </span>
                          )}
                        </div>
                        <h3 className="mt-2 text-base font-semibold leading-snug text-white">
                          {getAlertFeedHeadline(alert)}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-white/60">{getAlertFeedDetail(alert)}</p>
                      </div>
                      <p className="shrink-0 text-xs text-white/45">{getAlertAgeLabel(alert)}</p>
                    </div>

                    {(displayLines.length > 0 || bundle.routeLabels.length > 0 || alert.tdn) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {displayLines.map((line) => (
                          <span key={`${bundle.id}-expanded-${line}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${pillTone}`}>
                            {line}
                          </span>
                        ))}
                        {bundle.routeLabels.map((routeLabel) => (
                          <span key={`${bundle.id}-expanded-${routeLabel}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${pillTone}`}>
                            {routeLabel}
                          </span>
                        ))}
                        {alert.tdn ? (
                          <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
                            TDN {alert.tdn}
                          </span>
                        ) : null}
                      </div>
                    )}

                    {bundle.timeWindows.length > 1 && (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Affected times</p>
                        <div className="mt-2 space-y-1.5">
                          {bundle.timeWindows.map((timeWindow) => (
                            <p key={`${bundle.id}-expanded-${timeWindow}`} className="text-xs leading-relaxed text-white/70">
                              {timeWindow}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {getAlertDetailUrl(alert) && (
                        <a
                          href={getAlertDetailUrl(alert)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                        >
                          Details here
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {alert.addToCalendarUrl && (
                        <a
                          href={alert.addToCalendarUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                        >
                          Add to calendar
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </article>
                );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
