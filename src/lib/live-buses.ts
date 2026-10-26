import { readJsonErrorMessage, readJsonResponse, responseIsJson } from "@/lib/http-json";
import { getApiUrl } from "@/lib/api-config";
import { lookupBusFleetInfo } from "@/lib/bus-fleet";

export type LiveBus = {
  id: string;
  label: string;
  vehicleId?: string;
  fleetNumber?: string;
  registration?: string;
  tripId?: string;
  lat: number;
  lng: number;
  route: string;
  destination?: string;
  stopId?: string;
  stopStatus?: "incoming" | "stopped" | "in_transit";
  stopSequence?: number;
  status?: "live";
  timestamp?: string;
  heading?: number;
  operator?: string;
};

type LiveBusResponse =
  | LiveBus[]
  | {
      buses?: LiveBus[];
    };

// Melbourne route/operator directory, based on the public "List of bus routes in
// Melbourne" operator table. Kept in the client as well as the API so mocked and
// cached vehicles retain the same operator name.
const BUS_ROUTE_OPERATOR_GROUPS: Array<[string, string[]]> = [
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

const BUS_ROUTE_OPERATORS = BUS_ROUTE_OPERATOR_GROUPS.reduce<Record<string, string>>((directory, [operator, routes]) => {
  routes.forEach((route) => {
    directory[route] = directory[route] ? `${directory[route]} / ${operator}` : operator;
  });
  return directory;
}, {});


// Never returns a "CDC Melbourne / Ventura Bus Lines"-style joined guess —
// that only ever meant "this route is shared by two operators," not "this
// specific bus belongs to both." A real per-vehicle match (registration
// against the bus fleet database, or the small hardcoded identities table)
// always wins since it names one real operator; a route shared by multiple
// operators with no vehicle match falls all the way to the generic fallback
// instead of guessing which one.
function resolveBusOperator(route: string, registration: unknown, provided: unknown) {
  // The bus fleet database is the source of truth. A small hardcoded table
  // used to be checked first and contradicted it (BS07RE is CDC #186, not
  // Kinetic #0186).
  const fleetInfo = lookupBusFleetInfo({ registration: typeof registration === "string" ? registration : undefined });
  if (fleetInfo) return fleetInfo.operator;
  const routeOperator = BUS_ROUTE_OPERATORS[route];
  if (routeOperator && !routeOperator.includes(" / ")) return routeOperator;
  if (typeof provided === "string" && provided.trim() && !/^(ptv bus|transport victoria)$/i.test(provided.trim()) && !provided.includes(" / ")) {
    return provided.trim();
  }
  return "PTV contracted bus service";
}

function isRawFeedIdentifier(value: string) {
  return /^aus:vic:vic-02-[A-Z0-9-]+:?$/i.test(value) || /^vic-02-[A-Z0-9-]+:?$/i.test(value);
}

function stripFeedPrefix(value: string) {
  return value
    .replace(/^aus:vic:/i, "")
    .replace(/^vic:/i, "")
    .replace(/:$/g, "");
}

function normaliseRouteLabel(value: unknown) {
  if (typeof value !== "string") {
    return "Bus";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "Bus";
  }

  const ptvRouteMatch = trimmed.match(/vic-02-([A-Z]?\d{1,4}[A-Z]?)(?::|-|$)/i);
  if (ptvRouteMatch) {
    return ptvRouteMatch[1].toUpperCase();
  }

  const plainRouteMatch = trimmed.match(/\b([A-Z]?\d{1,4}[A-Z]?)\b/i);
  if (plainRouteMatch) {
    return plainRouteMatch[1].toUpperCase();
  }

  if (isRawFeedIdentifier(trimmed)) {
    return "Bus";
  }

  const compact = stripFeedPrefix(trimmed);
  if (compact.length <= 12) {
    return compact.toUpperCase();
  }

  return "Bus";
}

function normaliseDestination(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || isRawFeedIdentifier(trimmed)) {
    return undefined;
  }

  const cleaned = stripFeedPrefix(trimmed).trim();
  if (!cleaned || isRawFeedIdentifier(cleaned)) {
    return undefined;
  }

  return cleaned;
}

function normaliseLabel(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || isRawFeedIdentifier(trimmed)) {
    return undefined;
  }

  const cleaned = stripFeedPrefix(trimmed).trim();
  return cleaned || undefined;
}

function normaliseLiveBus(raw: Partial<LiveBus> & Record<string, unknown>, index: number): LiveBus | null {
  if (typeof raw.lat !== "number" || typeof raw.lng !== "number") {
    return null;
  }

  const route = normaliseRouteLabel(raw.route);
  const cleanLabel = normaliseLabel(raw.label);
  const label =
    cleanLabel
      ? cleanLabel
      : route === "Bus"
        ? `bus-${index + 1}`
        : `Route ${route}`;
  const registration = normaliseLabel(raw.registration);
  const registrationFleet = registration ? lookupBusFleetInfo({ registration }) : null;

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `bus-${index}`,
    label,
    vehicleId: normaliseLabel(raw.vehicleId),
    fleetNumber: normaliseLabel(raw.fleetNumber) ?? registrationFleet?.fleetNumber,
    registration,
    tripId: normaliseLabel(raw.tripId),
    lat: raw.lat,
    lng: raw.lng,
    route,
    destination: normaliseDestination(raw.destination),
    stopId: normaliseLabel(raw.stopId),
    stopStatus:
      raw.stopStatus === "incoming" || raw.stopStatus === "stopped" || raw.stopStatus === "in_transit"
        ? raw.stopStatus
        : undefined,
    stopSequence: typeof raw.stopSequence === "number" ? raw.stopSequence : undefined,
    status: "live",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
    heading: typeof raw.heading === "number" ? raw.heading : undefined,
    operator: resolveBusOperator(route, registration, raw.operator),
  };
}

export type LiveViewportBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export async function fetchLiveBuses(bounds?: LiveViewportBounds): Promise<LiveBus[]> {
  let response: Response;
  try {
    const search = bounds
      ? `?${new URLSearchParams({
          minLat: String(bounds.minLat),
          maxLat: String(bounds.maxLat),
          minLng: String(bounds.minLng),
          maxLng: String(bounds.maxLng),
        }).toString()}`
      : "";
    response = await fetch(getApiUrl(`/api/ptv/live-buses${search}`));
  } catch (error) {
    if (error instanceof TypeError) {
      return [];
    }
    throw error;
  }

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    const message = await readJsonErrorMessage(response, `Failed to load live buses (${response.status})`);
    throw new Error(message);
  }

  if (!responseIsJson(response)) {
    return [];
  }

  const payload = await readJsonResponse<LiveBusResponse>(response, "Live buses API");
  const buses = Array.isArray(payload) ? payload : payload.buses ?? [];

  const normalised = buses
    .map((bus, index) => normaliseLiveBus(bus, index))
    .filter((bus): bus is LiveBus => bus !== null);

  // GTFS-RT snapshots can briefly contain the same physical bus more than
  // once while its trip assignment changes. Prefer the newest report for one
  // stable vehicle identity so the existing marker is updated in place.
  const byIdentity = new Map<string, LiveBus>();
  for (const bus of normalised) {
    if (!Number.isFinite(bus.lat) || !Number.isFinite(bus.lng)) continue;
    if (bus.lat < -39.5 || bus.lat > -33.5 || bus.lng < 140.5 || bus.lng > 150.5) continue;

    const identity = bus.vehicleId || bus.registration || bus.fleetNumber || bus.tripId || bus.id;
    const existing = byIdentity.get(identity);
    const existingTime = existing?.timestamp ? Date.parse(existing.timestamp) : 0;
    const candidateTime = bus.timestamp ? Date.parse(bus.timestamp) : 0;
    if (!existing || candidateTime >= existingTime) byIdentity.set(identity, bus);
  }

  return [...byIdentity.values()];
}
