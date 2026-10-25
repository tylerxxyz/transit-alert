import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const PTV_BASE_URL =
  "https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/bus";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_GTFS_PATH = path.join(REPO_ROOT, ".local-host", "gtfs.zip");

// GTFS-Realtime VehiclePosition's TripDescriptor never carries a headsign (it's
// a static-schedule-only field) — every "trip.tripHeadsign" read below is
// always undefined in the raw feed. The only way to know a bus's real
// destination is to look up its trip_id against the static trips.txt.
let busHeadsignIndexPromise;

// The realtime feed's trip_id carries a different service-pattern segment
// than the matching static-schedule trip — the same real class of mismatch
// already found and fixed for trams, but a different segment for buses.
// Confirmed live: real vehicle trip_id "32-923--1-MF42-923023" (route 923,
// Kinetic Melbourne) has no exact match in trips.txt, but the static
// schedule DOES have "32-923--1-MF21-923023" — same route, same direction,
// same real trailing sequence number (923023), only the "MF.." service-code
// segment (index 4) differs (real trip_headsign for that static row: "St
// Kilda Station", matching the vehicle's own real stopping pattern). Drop
// that one segment from both sides before comparing so they agree.
function normaliseScheduleTripKey(tripId) {
  const parts = String(tripId ?? "").split("-");
  if (parts.length < 6) return tripId;
  return [...parts.slice(0, 4), ...parts.slice(5)].join("-");
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function loadBusHeadsignIndex() {
  if (!busHeadsignIndexPromise) {
    busHeadsignIndexPromise = Promise.resolve().then(() => {
      const gtfsPath = process.env.GTFS_SCHEDULE_PATH || DEFAULT_GTFS_PATH;
      const index = new Map();
      if (!fs.existsSync(gtfsPath)) return index;

      const outerZip = new AdmZip(gtfsPath);
      const nestedEntry = outerZip.getEntry("4/google_transit.zip");
      if (!nestedEntry) return index;
      const nestedZip = new AdmZip(nestedEntry.getData());
      const tripsEntry = nestedZip.getEntry("trips.txt");
      if (!tripsEntry) return index;

      const text = tripsEntry.getData().toString("utf8");
      const lines = text.split("\n");
      const headers = parseCsvLine(lines[0].replace(/^﻿/, "").replace(/\r$/, ""));
      const tripIdIndex = headers.indexOf("trip_id");
      const headsignIndex = headers.indexOf("trip_headsign");
      if (tripIdIndex === -1 || headsignIndex === -1) return index;

      for (let i = 1; i < lines.length; i += 1) {
        const rawLine = lines[i].replace(/\r$/, "");
        if (!rawLine) continue;
        const values = parseCsvLine(rawLine);
        const headsign = values[headsignIndex]?.trim();
        if (headsign) index.set(normaliseScheduleTripKey(values[tripIdIndex]), headsign);
      }
      return index;
    }).catch((error) => {
      busHeadsignIndexPromise = undefined;
      throw error;
    });
  }
  return busHeadsignIndexPromise;
}

const BUS_REGISTRATION_IDENTITIES = {
  BS07RE: { fleetNumber: "0186", operator: "Kinetic Melbourne" },
  BS07IZ: { fleetNumber: "0179", operator: "CDC Melbourne" },
};

// Melbourne route/operator directory, based on the public "List of bus routes in
// Melbourne" operator table. This keeps API responses specific even when the
// vehicle-position feed does not include an operator name.
const BUS_ROUTE_OPERATOR_GROUPS = [
  ["CDC Melbourne", "150 151 153 160 161 166 167 170 180 181 182 190 191 192 400 406 407 408 409 410 411 412 414 415 417 418 419 421 423 424 425 439 441 443 461 465 467 468 477 478 479 482 484 490 494 495 496 497 498 501 511 524 528 529 530 531 532 533 534 536 537 538 540 541 542 543 544 601 605 606 612 623 624 625 626 630 900".split(" ")],
  ["Kinetic Melbourne", "200 207 215 216 219 220 223 232 234 235 236 237 246 250 251 270 271 273 279 280 281 282 284 285 293 295 302 303 304 305 309 318 350 364 370 426 503 504 505 506 508 509 510 512 546 552 553 558 567 600 603 604 609 668 669 901 902 903 905 906 907 908 922 923".split(" ")],
  ["Dysons", "301 343 356 357 358 381 382 383 384 385 386 387 388 389 513 517 518 525 554 555 556 557 559 561 564 566 569 570 577 578 579 580 582".split(" ")],
  ["Transit Systems Victoria", "241 400 402 404 420 422 427 428 431 432 453 455 456 457 458 459 471 472".split(" ")],
  ["Cranbourne Transit", "789 790 791 792 795 796 798 799 881 890 891 892 893 894 895 897 898".split(" ")],
  ["Sunbury Bus Service", "475 481 483 485 486 487 488 489".split(" ")],
  ["McKenzie's Tourist Services", "684 685".split(" ")],
  ["Martyrs Bus Service", ["683"]],
  ["Ventura Bus Lines", "201 526 527 548 549 550 551 631 663 664 670 671 672 673 675 676 677 679 680 681 682 688 689 690 691 693 694 695 696 697 699 701 703 704 705 706 708 709 732 733 734 735 736 737 738 740 742 745 753 754 755 757 758 765 766 767 770 771 772 773 774 775 776 777 778 779 780 781 782 783 784 785 786 787 788 800 802 804 811 812 813 814 816 821 822 823 824 825 828 831 832 833 834 835 836 837 838 839 841 842 843 844 845 846 847 848 849 850 857 858 861 862 863 885 886 887 888 889 899 900 925 926 927 928 929 966 968".split(" ")],
];

const BUS_ROUTE_OPERATORS = BUS_ROUTE_OPERATOR_GROUPS.reduce((directory, [operator, routes]) => {
  routes.forEach((route) => {
    directory[route] = directory[route] ? `${directory[route]} / ${operator}` : operator;
  });
  return directory;
}, {});

function normaliseRegistrationKey(value) {
  return typeof value === "string" ? value.replace(/[^a-z0-9]/gi, "").toUpperCase() : "";
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return undefined;
}

function getSafePtvError(status) {
  if (status === 429) {
    return "PTV bus feed is rate limited. Try again shortly.";
  }

  return `PTV bus feed is unavailable (${status}).`;
}

function normaliseBusRoute(routeId, fallback = "Bus") {
  if (typeof routeId !== "string") {
    return fallback;
  }

  const trimmed = routeId.trim();
  if (!trimmed) {
    return fallback;
  }

  const ptvRouteMatch = trimmed.match(/vic-02-([A-Z]?\d{1,4}[A-Z]?)(?::|-|$)/i);
  if (ptvRouteMatch) {
    return ptvRouteMatch[1].toUpperCase();
  }

  const routeMatch = trimmed.match(/\b([A-Z]?\d{1,4}[A-Z]?)\b/i);
  if (routeMatch) {
    return routeMatch[1].toUpperCase();
  }

  return fallback;
}

function normaliseLabel(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return trimmed;
  }

  return "Bus";
}

function normaliseDestination(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^aus:vic:vic-02-[A-Z0-9-]+:?$/i.test(trimmed) || /^vic-02-[A-Z0-9-]+:?$/i.test(trimmed)) {
      continue;
    }
    return trimmed;
  }

  return undefined;
}

function normaliseStopStatus(value) {
  const status = toNumber(value);
  if (status === 0) return "incoming";
  if (status === 1) return "stopped";
  if (status === 2) return "in_transit";
  return undefined;
}

function buildPtvLiveBuses(feed, headsignIndex) {
  return (feed.entity ?? [])
    .map((entity) => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;
      if (!vehicle || !position) return null;

      const latitude = position.latitude;
      const longitude = position.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return null;

      const route = normaliseBusRoute(vehicle.trip?.routeId);
      const timestamp = toNumber(vehicle.timestamp);
      // This feed's VehicleDescriptor carries only `id` — confirmed against
      // the raw decoded protobuf (e.g. {"id":"BS05HK"}), which is a real
      // Victorian bus registration, not an opaque vehicle ID. There is no
      // separate `label`/`licensePlate` field at all, so the previous
      // `registration: vehicle.vehicle?.licensePlate` read was always empty —
      // silently breaking every registration-keyed lookup (the small
      // BUS_REGISTRATION_IDENTITIES table, and now the bus fleet database).
      const registration = vehicle.vehicle?.id;
      const label = normaliseLabel(registration, route);
      const destination = normaliseDestination(
        headsignIndex?.get(normaliseScheduleTripKey(vehicle.trip?.tripId)),
        vehicle.trip?.tripHeadsign,
        vehicle.trip?.headsign,
        vehicle.trip?.tripShortName,
      );
      const identity = BUS_REGISTRATION_IDENTITIES[normaliseRegistrationKey(registration)];

      return {
        id: entity.id || registration || `${route}-${latitude}-${longitude}`,
        label,
        vehicleId: registration,
        fleetNumber: identity?.fleetNumber,
        registration,
        tripId: vehicle.trip?.tripId,
        lat: latitude,
        lng: longitude,
        route,
        destination,
        stopId: vehicle.stopId,
        stopStatus: normaliseStopStatus(vehicle.currentStatus),
        stopSequence: toNumber(vehicle.currentStopSequence),
        status: "live",
        timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
        heading: typeof position.bearing === "number" ? position.bearing : undefined,
        operator: identity?.operator || BUS_ROUTE_OPERATORS[route] || "PTV contracted bus service",
      };
    })
    .filter(Boolean);
}

function readBoundsFilter(query = {}) {
  const minLat = Number(query.minLat);
  const maxLat = Number(query.maxLat);
  const minLng = Number(query.minLng);
  const maxLng = Number(query.maxLng);

  if ([minLat, maxLat, minLng, maxLng].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { minLat, maxLat, minLng, maxLng };
}

function withinBounds(item, bounds) {
  if (!bounds) return true;
  return (
    item.lat >= bounds.minLat &&
    item.lat <= bounds.maxLat &&
    item.lng >= bounds.minLng &&
    item.lng <= bounds.maxLng
  );
}

export default async function handler(req, res) {
  const ptvSubscriptionKey =
    process.env.PTV_SUBSCRIPTION_KEY ||
    process.env.PTV_subscription_key ||
    process.env.OCP_APIM_SUBSCRIPTION_KEY ||
    process.env.PTV_API_KEY;

  if (!ptvSubscriptionKey) {
    res.status(503).json({
      error: "Live bus positions need a Transport Victoria KeyID. Static bus schedules remain available from GTFS.",
      code: "PTV_KEY_REQUIRED",
      buses: [],
    });
    return;
  }

  try {
    const bounds = readBoundsFilter(req.query);
    const response = await fetch(`${PTV_BASE_URL}/vehicle-positions`, {
      headers: {
        KeyID: ptvSubscriptionKey,
        "Ocp-Apim-Subscription-Key": ptvSubscriptionKey,
      },
    });

    if (!response.ok) {
      res.status(response.status).json({
        error: getSafePtvError(response.status),
      });
      return;
    }

    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    const headsignIndex = await loadBusHeadsignIndex().catch(() => undefined);
    res.status(200).json({ buses: buildPtvLiveBuses(feed, headsignIndex).filter((bus) => withinBounds(bus, bounds)) });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load live buses",
    });
  }
}
