import { desc, eq, sql } from "drizzle-orm";

let cachedFleetDbContext;

async function loadFleetDbContext() {
  if (cachedFleetDbContext !== undefined) {
    return cachedFleetDbContext;
  }

  try {
    const [{ db, ensureDatabaseReady, isDatabaseConfigured }, schema] = await Promise.all([
      import("../../src/lib/db/src/index.js"),
      import("../../src/lib/db/src/schema/fleet.js"),
    ]);

    if (isDatabaseConfigured) {
      await ensureDatabaseReady();
    }

    cachedFleetDbContext = db ? { db, fleetSightingsTable: schema.fleetSightingsTable } : null;
  } catch (error) {
    console.warn("[fleet-tracking] db context unavailable:", error?.message ?? error);
    cachedFleetDbContext = null;
  }

  return cachedFleetDbContext;
}

// A sighting counts as "still in service" if it's been updated within this
// many minutes of now. The live feed is polled well inside this window, so
// anything older than it has genuinely dropped off the network, not just
// missed one poll cycle.
const IN_SERVICE_WINDOW_MINUTES = 5;

// Real consist labels are compound for a 6-car formation of two coupled
// 3-car sets, e.g. "429M-430M". Matching an individual set number means
// checking each hyphen-separated part, not the whole string. Some fleets
// (X'Trapolis 2.0, HCMT, VLocity, Sprinter) identify cars/sets by a bare
// number with no M/T suffix at all, so the comparison strips any single
// trailing letter from both sides — "9057" and "9057M" match either way.
function stripTrailingLetter(value) {
  return value.replace(/[A-Z]$/i, "");
}

// Split on the same separators as favourite-set notifications (trainSetIds),
// so "VL15+VL20" or "429M 430M" finds each set rather than one whole string.
export function consistIncludesSetNumber(consist, setNumber) {
  if (typeof consist !== "string") return false;
  const target = stripTrailingLetter(setNumber.toUpperCase());
  return consist
    .split(/\s*[-+ ,]\s*/)
    .map((part) => stripTrailingLetter(part.trim().toUpperCase()))
    .includes(target);
}

// Real Melbourne suburban carriage number ranges (source: vicsig.net/suburban/fleet),
// mirrored from the same classification used for live trains in Home.tsx
// (inferFleetTypeKeyFromConsist) so a set's fleet type reads the same whether
// it's currently running or being looked up from sighting history.
const FLEET_MOTOR_RANGES = {
  hcmt: [[9000, 9999]],
  xtrapolis2: [[8100, 8699]],
  xtrapolis: [
    [1, 288],
    [851, 985],
  ],
  siemens: [[701, 843]],
  comeng: [[324, 680]],
  // The fleet filter splits Comeng by builder (see classifyComengMotorNumbers
  // in Home.tsx), so the roster has to accept those keys too.
  "alstom-comeng": [[324, 680]],
  "edi-comeng": [[324, 680]],
};

// Mirrors EDI_COMENG_MOTOR_NUMBERS in src/pages/Home.tsx (VICSIG fleet list).
const EDI_COMENG_MOTOR_NUMBERS = new Set([
  324, 342, 327, 349, 328, 464, 329, 366, 335, 387, 343, 384, 351, 352, 353,
  354, 355, 356, 357, 358, 369, 370, 371, 372, 377, 378, 379, 380, 381, 382,
  389, 426, 391, 392, 397, 398, 401, 402, 405, 406, 417, 418, 421, 422, 423,
  424, 429, 430, 431, 432, 433, 434, 443, 444, 455, 456, 457, 458, 471, 472,
  477, 478, 481, 482, 485, 486, 495, 496, 499, 534, 501, 502, 505, 506, 507,
  508, 511, 512, 513, 514, 518, 551, 521, 522, 525, 526, 530, 552, 531, 532,
  535, 536, 541, 542, 543, 544, 545, 546, 547, 548, 549, 550,
]);

// Motor (M) and trailer (T) cars both carry real car numbers in the consist
// string (e.g. "1415T-1677T-229M-230M-953M-954M"). Some fleets (X'Trapolis
// 2.0, HCMT, VLocity, Sprinter) instead use a bare number with no letter
// suffix at all, so the suffix has to be optional here rather than required —
// requiring it would silently extract zero car numbers for those fleets.
// The leading \b keeps letter-prefixed codes ("VL15", "N452") from being read
// as suburban car numbers 15 and 452.
function extractCarNumbers(consist) {
  if (typeof consist !== "string") return [];
  return Array.from(consist.matchAll(/\b(\d+)[MT]?\b/gi)).map((match) => Number(match[1]));
}

// X'Trapolis 2.0's real fleet roster (as verified against the current 50-set
// build sheet): each physical 6-car set N (8001-8050) is made of one car
// from each of six numbered series 100 apart — e.g. set 8005 is cars 8105,
// 8205, 8305, 8405, 8505, 8605. A single set's sightings would otherwise get
// split into up to six different fake "sets", one per car number, unless
// each car is mapped back to its real physical set number first.
function getXtrapolis2SetNumber(carNumber) {
  const hundreds = Math.floor(carNumber / 100);
  const unit = carNumber % 100;
  if (hundreds < 81 || hundreds > 86) return null;
  if (unit < 1 || unit > 50) return null;
  return String(8000 + unit);
}

// Fleets whose real set/car identifiers are bare numbers with no M/T letter
// at all (per direct confirmation) — everything else in FLEET_MOTOR_RANGES
// (Comeng, Siemens, X'Trapolis 100) genuinely does carry an M/T suffix.
// VLocity and Sprinter are also letterless, but they identify by an
// alphanumeric set code (e.g. "VL15") rather than a car-number range, so
// they don't fit this range-based classifier at all and aren't listed here —
// extractCarNumbers()/consistIncludesSetNumber() being suffix-optional
// already lets a bare VLocity/Sprinter code match correctly wherever it's
// searched directly, without needing a range entry.
const LETTERLESS_FLEET_TYPES = new Set(["xtrapolis2", "hcmt"]);

// N Class locomotives (and other loco-hauled V/Line consists) identify by a
// real alphanumeric reporting mark — e.g. "N452" — not a numbered car range
// within a bigger fleet, so they never fit FLEET_MOTOR_RANGES' model at all.
// This was the actual reason N Class never showed up on the live fleet
// board: isKnownFleetType()/getMatchingSetNumbers() below had no way to
// recognise "n-class" as a fleet type in the first place, regardless of how
// many real N Class sightings were already logged in fleetSightingsTable.
// Mirrors N_CLASS_CONSIST_PATTERN in src/pages/Home.tsx.
const PATTERN_FLEET_TYPES = {
  "n-class": /\bN\d{3}\b/gi,
};

function getPatternMatchingSetNumbers(consist, fleetType) {
  const pattern = PATTERN_FLEET_TYPES[fleetType];
  if (!pattern || typeof consist !== "string") return [];
  return [...new Set([...consist.matchAll(pattern)].map((match) => match[0].toUpperCase()))];
}

export function getMatchingSetNumbers(consist, fleetType) {
  if (PATTERN_FLEET_TYPES[fleetType]) return getPatternMatchingSetNumbers(consist, fleetType);
  const ranges = FLEET_MOTOR_RANGES[fleetType];
  if (!ranges) return [];
  const carNumbers = extractCarNumbers(consist).filter((n) => ranges.some(([lo, hi]) => n >= lo && n <= hi));

  if (fleetType === "alstom-comeng" || fleetType === "edi-comeng") {
    const isEdi = carNumbers.some((n) => EDI_COMENG_MOTOR_NUMBERS.has(n));
    if (isEdi !== (fleetType === "edi-comeng")) return [];
  }

  if (fleetType === "xtrapolis2") {
    return [...new Set(carNumbers.map(getXtrapolis2SetNumber).filter(Boolean))];
  }

  if (LETTERLESS_FLEET_TYPES.has(fleetType)) {
    return carNumbers.map((n) => String(n));
  }

  return carNumbers.map((n) => `${n}M`);
}

export function getTrainFleetTypes(train) {
  if (train.tripId?.startsWith("01-") || /V\/LINE/i.test(train.trainType ?? "")) {
    return ["vline", ...(train.allocation?.stockType ? [train.allocation.stockType] : []),
      ...(getPatternMatchingSetNumbers(train.consist, "n-class").length ? ["n-class"] : [])];
  }
  return [...Object.keys(FLEET_MOTOR_RANGES), ...Object.keys(PATTERN_FLEET_TYPES)]
    .filter((type) => type !== "alstom-comeng" && type !== "edi-comeng")
    .filter((type) => getMatchingSetNumbers(train.consist, type).length > 0);
}

export function isKnownFleetType(fleetType) {
  return (
    Object.prototype.hasOwnProperty.call(FLEET_MOTOR_RANGES, fleetType) ||
    Object.prototype.hasOwnProperty.call(PATTERN_FLEET_TYPES, fleetType)
  );
}

export async function recordFleetSightings(trains) {
  const context = await loadFleetDbContext();
  if (!context || !Array.isArray(trains) || trains.length === 0) return;

  const { db, fleetSightingsTable } = context;
  const now = new Date();

  for (const train of trains) {
    if (!train?.consist || train.consist === "Unknown" || !train?.tripId) continue;

    await db
      .insert(fleetSightingsTable)
      .values({
        consist: train.consist,
        tdn: train.tdn ?? null,
        tripId: train.tripId,
        line: train.line ?? null,
        destination: train.destination ?? null,
        trainType: train.trainType ?? null,
        lat: typeof train.lat === "number" ? train.lat : null,
        lng: typeof train.lng === "number" ? train.lng : null,
        status: train.status ?? null,
        serviceDate: train.serviceDate ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [fleetSightingsTable.consist, fleetSightingsTable.tripId],
        set: {
          line: train.line ?? null,
          destination: train.destination ?? null,
          trainType: train.trainType ?? null,
          lat: typeof train.lat === "number" ? train.lat : null,
          lng: typeof train.lng === "number" ? train.lng : null,
          status: train.status ?? null,
          lastSeenAt: now,
        },
      })
      .catch((error) => {
        console.warn("[fleet-tracking] failed to record sighting:", error?.message ?? error);
      });
  }
}

// A rider knows X'Trapolis 2.0 sets by their short human set number (e.g.
// "Set 7", from the "XT2 Set 07" label shown elsewhere in the app), not by
// any one of its six real car numbers (8107/8207/8307/8407/8507/8607) — that
// mapping is internal. Searching "7" has to be expanded to every real car
// number for that set, mirroring getXtrapolis2SetNumber's own math in
// reverse (hundreds 81-86, unit = the set number). The full set number
// ("8005") is what the fleet roster shows, so it is accepted too.
export function xtrapolis2CarNumberCandidates(setNumber) {
  const number = Number(setNumber);
  const unit = number >= 8001 && number <= 8050 ? number - 8000 : number;
  if (!Number.isInteger(unit) || unit < 1 || unit > 50) return [];
  return [81, 82, 83, 84, 85, 86].map((hundreds) => String(hundreds * 100 + unit));
}

// Looks up every logged sighting for a given set number (e.g. "430M"),
// across whichever compound consist strings it has appeared in, and derives
// current status / last known position / last service / today's services
// from that history. Returns null if nothing has ever been logged for it.
export async function lookupFleetSetNumber(setNumberRaw) {
  const setNumber = String(setNumberRaw || "").trim().toUpperCase();
  if (!setNumber) return null;

  const context = await loadFleetDbContext();
  if (!context) return null;

  const { db, fleetSightingsTable } = context;

  // A short bare number could be a real letterless set/car number on its own
  // (rare) or an X'Trapolis 2.0 short set number — search for both the
  // literal term and, when it's in range, every possible XT2 car number for
  // that set, then let the exact per-part match below sort out which (if
  // any) actually appear in real sighting history.
  const searchTerms = [setNumber, ...xtrapolis2CarNumberCandidates(setNumber)];
  // Coarse SQL filter (cheap index-friendly LIKE), then an exact per-part
  // match in JS so "30M" doesn't spuriously match "430M".
  const candidates = await db
    .select()
    .from(fleetSightingsTable)
    .where(sql.join(searchTerms.map((term) => sql`upper(${fleetSightingsTable.consist}) LIKE ${"%" + term + "%"}`), sql` OR `))
    .orderBy(desc(fleetSightingsTable.lastSeenAt));

  const matches = candidates.filter((row) => searchTerms.some((term) => consistIncludesSetNumber(row.consist, term)));
  if (matches.length === 0) return null;

  const mostRecent = matches[0];
  const ageMinutes = (Date.now() - new Date(mostRecent.lastSeenAt).getTime()) / 60_000;
  const inService = ageMinutes <= IN_SERVICE_WINDOW_MINUTES;

  const todayServiceDate = mostRecent.serviceDate;
  const todaysServices = matches
    .filter((row) => row.serviceDate === todayServiceDate)
    .sort((a, b) => new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime());

  // Echo back a label that actually means something: a bare short number
  // that only matched via the XT2 expansion (not literally in the consist)
  // reads as "XT2 Set 07", not a bare "7" the rider never typed as a car number.
  const matchedLiteralTerm = searchTerms.find((term) => consistIncludesSetNumber(mostRecent.consist, term));
  const displaySetNumber = matchedLiteralTerm === setNumber || /^80\d\d$/.test(setNumber)
    ? setNumber
    : `XT2 Set ${setNumber.padStart(2, "0")}`;

  return {
    setNumber: displaySetNumber,
    inService,
    lastSeenAt: mostRecent.lastSeenAt,
    lastKnownPosition:
      typeof mostRecent.lat === "number" && typeof mostRecent.lng === "number"
        ? { lat: mostRecent.lat, lng: mostRecent.lng }
        : null,
    lastService: {
      consist: mostRecent.consist,
      tdn: mostRecent.tdn,
      tripId: mostRecent.tripId,
      line: mostRecent.line,
      destination: mostRecent.destination,
      trainType: mostRecent.trainType,
      status: mostRecent.status,
      firstSeenAt: mostRecent.firstSeenAt,
      lastSeenAt: mostRecent.lastSeenAt,
    },
    todaysServices: todaysServices.map((row) => ({
      consist: row.consist,
      tdn: row.tdn,
      tripId: row.tripId,
      line: row.line,
      destination: row.destination,
      trainType: row.trainType,
      status: row.status,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    })),
  };
}

function summariseSetGroup(setNumber, rows) {
  const sorted = [...rows].sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
  const mostRecent = sorted[0];
  const ageMinutes = (Date.now() - new Date(mostRecent.lastSeenAt).getTime()) / 60_000;
  const inService = ageMinutes <= IN_SERVICE_WINDOW_MINUTES;
  const todayServiceDate = mostRecent.serviceDate;
  const todaysServiceCount = sorted.filter((row) => row.serviceDate === todayServiceDate).length;

  return {
    setNumber,
    inService,
    lastSeenAt: mostRecent.lastSeenAt,
    lastKnownPosition:
      typeof mostRecent.lat === "number" && typeof mostRecent.lng === "number"
        ? { lat: mostRecent.lat, lng: mostRecent.lng }
        : null,
    lastService: {
      consist: mostRecent.consist,
      tdn: mostRecent.tdn,
      tripId: mostRecent.tripId,
      line: mostRecent.line,
      destination: mostRecent.destination,
      trainType: mostRecent.trainType,
      status: mostRecent.status,
      firstSeenAt: mostRecent.firstSeenAt,
      lastSeenAt: mostRecent.lastSeenAt,
    },
    todaysServiceCount,
  };
}

// Looks up every physical set belonging to a known fleet type (e.g.
// "xtrapolis2") from sighting history, grouped by the individual set number
// rather than the (possibly multi-set) compound consist string — so a fleet
// that's currently a single unit today still reads sensibly if more sets of
// the same type are ever added later. Returns [] if nothing has ever been
// logged for that fleet type, or if it isn't a recognised type at all.
export async function lookupFleetType(fleetTypeRaw) {
  const fleetType = String(fleetTypeRaw || "").trim().toLowerCase();
  if (!isKnownFleetType(fleetType)) return [];

  const context = await loadFleetDbContext();
  if (!context) return [];

  const { db, fleetSightingsTable } = context;
  const allRows = await db.select().from(fleetSightingsTable).orderBy(desc(fleetSightingsTable.lastSeenAt));

  const groups = new Map();
  for (const row of allRows) {
    for (const setNumber of getMatchingSetNumbers(row.consist, fleetType)) {
      if (!groups.has(setNumber)) groups.set(setNumber, []);
      groups.get(setNumber).push(row);
    }
  }

  return Array.from(groups.entries())
    .map(([setNumber, rows]) => summariseSetGroup(setNumber, rows))
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}
