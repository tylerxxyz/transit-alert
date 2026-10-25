import { loadTimetable, readIndexedBusStopTimes, readIndexedBusShape, normaliseStationName } from "./ptv-timetable.js";

// Real, structural multi-modal journey planning over the official GTFS
// schedule (train + V/Line + tram + bus). Every route, stop, and headsign
// that comes out of this is a real one taken straight from the schedule —
// nothing here is a hand-picked example route. The trade-off: for a given
// route+direction we model ONE representative stopping pattern (the trip
// with the most stops we could find), not every timetabled variant, and
// travel times are the pattern's own scheduled run time rather than a
// live, time-of-day-aware estimate. That's enough to answer "how do I get
// from A to B and which real routes do I take", which is what the planner
// needs; live departure boards elsewhere in the app already supply the
// real next-departure times for the boarding leg.

const TRANSFER_PENALTY_SECONDS = 240;
const WALK_SPEED_METRES_PER_SECOND = 1.25;
// Real train<->bus interchanges are often several hundred metres apart (the
// bus bays outside a station concourse, not right on the platform), so this
// needs to be generous enough to actually connect them — too tight and the
// planner silently loses every realistic rail+bus transfer and falls back to
// bus-only paths that happen to chain together, which look worse to a rider
// even though they're topologically "valid".
const WALK_RADIUS_METRES = 750;
const WALK_GRID_CELL_DEGREES = 0.0035;
const WALK_GRID_CELL_METRES = WALK_GRID_CELL_DEGREES * 111_320;
const WALK_GRID_SEARCH_RADIUS_CELLS = Math.ceil(WALK_RADIUS_METRES / WALK_GRID_CELL_METRES);
const ORIGIN_SEARCH_RADIUS_METRES = 1200;
const MAX_ORIGIN_CANDIDATES = 6;
// A short-working trip (starts/ends partway along the route) is far more
// common in a day's schedule than the one full end-to-end pattern, so
// sampling only the first few trips per route+direction reliably misses it
// and silently truncates that route to a fragment. Reading every trip's
// stop_times is still cheap (one indexed byte-range read each) so there is
// no real reason to under-sample here.
const MAX_BUS_PATTERN_CANDIDATES = Number.POSITIVE_INFINITY;

let graphPromise;

function gtfsClockSeconds(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function metresBetween(lat1, lng1, lat2, lng2) {
  const dLat = (lat1 - lat2) * 111_320;
  const dLng = (lng1 - lng2) * 111_320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(priority, value) {
    const items = this.items;
    items.push([priority, value]);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent][0] <= items[index][0]) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  pop() {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let index = 0;
      const length = items.length;
      for (;;) {
        const left = index * 2 + 1;
        const right = index * 2 + 2;
        let smallest = index;
        if (left < length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index], items[smallest]];
        index = smallest;
      }
    }
    return top;
  }
}

function pushEdge(adjacency, from, edge) {
  if (!adjacency.has(from)) adjacency.set(from, []);
  adjacency.get(from).push(edge);
}

function bestPatternsFromLoadedStopTimes(mode) {
  const byRouteDirection = new Map();
  for (const [tripId, stopTimes] of mode.stopTimesByTrip) {
    const trip = mode.trips.get(tripId);
    if (!trip || stopTimes.length < 2) continue;
    const key = `${trip.routeId}|${trip.directionId}`;
    const existing = byRouteDirection.get(key);
    if (!existing || stopTimes.length > existing.stopTimes.length) {
      byRouteDirection.set(key, {
        trip,
        stopTimes: [...stopTimes].sort((left, right) => left.stopSequence - right.stopSequence),
      });
    }
  }
  return byRouteDirection;
}

function bestBusPatterns(mode) {
  const candidatesByKey = new Map();
  for (const trip of mode.trips.values()) {
    const key = `${trip.routeId}|${trip.directionId}`;
    const candidates = candidatesByKey.get(key);
    if (!candidates) {
      candidatesByKey.set(key, [trip]);
    } else if (candidates.length < MAX_BUS_PATTERN_CANDIDATES) {
      candidates.push(trip);
    }
  }

  const byRouteDirection = new Map();
  for (const [key, candidateTrips] of candidatesByKey) {
    let best = null;
    for (const trip of candidateTrips) {
      const stopTimes = readIndexedBusStopTimes(trip.id);
      if (stopTimes.length < 2) continue;
      if (!best || stopTimes.length > best.stopTimes.length) {
        best = { trip, stopTimes };
      }
    }
    if (best) byRouteDirection.set(key, best);
  }
  return byRouteDirection;
}

function addStopSequenceEdges(nodes, adjacency, modeKey, displayMode, mode, stopTimes, routeKey, routeLabel, fallbackHeadsign, shapeId) {
  for (let index = 0; index < stopTimes.length - 1; index += 1) {
    const current = stopTimes[index];
    const next = stopTimes[index + 1];
    const currentStop = mode.stops.get(current.stopId);
    const nextStop = mode.stops.get(next.stopId);
    if (!currentStop || !nextStop) continue;
    if (!Number.isFinite(currentStop.lat) || !Number.isFinite(nextStop.lat)) continue;

    const fromNodeId = `${modeKey}:${current.stopId}`;
    const toNodeId = `${modeKey}:${next.stopId}`;
    if (!nodes.has(fromNodeId)) {
      nodes.set(fromNodeId, { name: currentStop.name, lat: currentStop.lat, lng: currentStop.lng, modeKey, stopId: current.stopId });
    }
    if (!nodes.has(toNodeId)) {
      nodes.set(toNodeId, { name: nextStop.name, lat: nextStop.lat, lng: nextStop.lng, modeKey, stopId: next.stopId });
    }

    const departSeconds = gtfsClockSeconds(current.departureTime || current.arrivalTime);
    const arriveSeconds = gtfsClockSeconds(next.arrivalTime || next.departureTime);
    const rawSeconds = Number.isFinite(departSeconds) && Number.isFinite(arriveSeconds) ? arriveSeconds - departSeconds : undefined;
    const seconds = Number.isFinite(rawSeconds) && rawSeconds > 0 ? rawSeconds : 90;

    pushEdge(adjacency, fromNodeId, {
      to: toNodeId,
      mode: displayMode,
      routeKey,
      routeLabel,
      headsign: next.stopHeadsign || fallbackHeadsign || nextStop.name,
      seconds,
      shapeId,
    });
  }
}

// A route's real trip_headsign (e.g. tram route 96's "St Kilda Beach") is
// often the name riders actually type as a destination, but it isn't
// necessarily any stop's literal GTFS stop_name — the technical terminus
// stop is frequently named after the street/cross-street instead. Record it
// as a searchable alias for that trip's last stop so typing the public
// destination name still resolves, alongside the real stop names.
function addPatternEdges(nodes, adjacency, modeKey, displayMode, mode, patterns, destinationAliases) {
  for (const { trip, stopTimes } of patterns.values()) {
    const route = mode.routes.get(trip.routeId);
    const routeLabel = String(route?.shortName || route?.longName || trip.routeId || displayMode).trim();
    addStopSequenceEdges(
      nodes, adjacency, modeKey, displayMode, mode, stopTimes,
      `${modeKey}:${trip.routeId}:${trip.directionId}`, routeLabel, trip.destination, trip.shapeId,
    );

    const lastStop = stopTimes.at(-1);
    if (destinationAliases && trip.destination && lastStop) {
      const nodeId = `${modeKey}:${lastStop.stopId}`;
      const key = normaliseStationName(trip.destination);
      if (!destinationAliases.has(key)) destinationAliases.set(key, new Set());
      destinationAliases.get(key).add(nodeId);
    }
  }
}

// Every Metro Tunnel journey is scheduled as TWO separate trip_ids (and two
// separate TDNs) that hand over at Town Hall — the same physical train
// keeps going straight through, it's a Sunbury-line trip becoming a
// Cranbourne/Pakenham-line trip (or vice versa) mid-journey, not a real
// passenger interchange. Left alone, the graph would see two distinct
// routeKeys meeting at Town Hall and charge a transfer penalty plus present
// it as "change trains here", which is wrong — nobody gets off. Detect the
// real handover (same service day, exact same clock time, one trip ending
// at Town Hall as the other starts there) and add the combined stop
// sequence as one seamless routeKey so through-riders never see a fake
// interchange. This mirrors the same handover detection already used for
// live cancellation/formation matching elsewhere in this codebase.
function stitchMetroTunnelContinuations(nodes, adjacency, modeKey, displayMode, mode) {
  const townHallIds = new Set(mode.stopIdsByName.get(normaliseStationName("Town Hall")) || []);
  if (townHallIds.size === 0) return;

  const sortedByTrip = new Map();
  for (const [tripId, stopTimes] of mode.stopTimesByTrip) {
    if (stopTimes.length < 2) continue;
    sortedByTrip.set(tripId, [...stopTimes].sort((left, right) => left.stopSequence - right.stopSequence));
  }

  const endingAtTownHall = [];
  const startingAtTownHall = [];
  for (const [tripId, stops] of sortedByTrip) {
    const first = stops[0];
    const last = stops.at(-1);
    if (townHallIds.has(last.stopId)) endingAtTownHall.push({ tripId, stops, time: last.arrivalTime || last.departureTime });
    if (townHallIds.has(first.stopId)) startingAtTownHall.push({ tripId, stops, time: first.departureTime || first.arrivalTime });
  }

  const seenRoutePairs = new Set();
  for (const into of endingAtTownHall) {
    const intoTrip = mode.trips.get(into.tripId);
    if (!intoTrip || !into.time) continue;
    for (const out of startingAtTownHall) {
      if (out.tripId === into.tripId || !out.time || out.time !== into.time) continue;
      const outTrip = mode.trips.get(out.tripId);
      if (!outTrip || outTrip.serviceId !== intoTrip.serviceId) continue;

      const pairKey = `${intoTrip.routeId}=>${outTrip.routeId}`;
      if (seenRoutePairs.has(pairKey)) continue;
      seenRoutePairs.add(pairKey);

      const combinedStops = [...into.stops, ...out.stops.slice(1)];
      const combinedRouteKey = `${modeKey}:metro-tunnel:${intoTrip.routeId}->${outTrip.routeId}`;
      addStopSequenceEdges(
        nodes, adjacency, modeKey, displayMode, mode, combinedStops,
        combinedRouteKey, "Metro Tunnel", outTrip.destination,
      );
    }
  }
}

function buildWalkTransfers(nodes, adjacency) {
  const grid = new Map();
  const cellKey = (lat, lng) => `${Math.floor(lat / WALK_GRID_CELL_DEGREES)}:${Math.floor(lng / WALK_GRID_CELL_DEGREES)}`;

  for (const [nodeId, node] of nodes) {
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
    const key = cellKey(node.lat, node.lng);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(nodeId);
  }

  for (const [nodeId, node] of nodes) {
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
    const [cellLat, cellLng] = cellKey(node.lat, node.lng).split(":").map(Number);
    const r = WALK_GRID_SEARCH_RADIUS_CELLS;
    for (let dLat = -r; dLat <= r; dLat += 1) {
      for (let dLng = -r; dLng <= r; dLng += 1) {
        const neighbours = grid.get(`${cellLat + dLat}:${cellLng + dLng}`);
        if (!neighbours) continue;
        for (const otherNodeId of neighbours) {
          if (otherNodeId === nodeId) continue;
          const other = nodes.get(otherNodeId);
          const distanceMetres = metresBetween(node.lat, node.lng, other.lat, other.lng);
          if (distanceMetres > WALK_RADIUS_METRES) continue;
          const seconds = Math.max(60, Math.round(distanceMetres / WALK_SPEED_METRES_PER_SECOND) + 30);
          pushEdge(adjacency, nodeId, {
            to: otherNodeId,
            mode: "walk",
            routeKey: `walk:${nodeId}>${otherNodeId}`,
            routeLabel: "Walk",
            headsign: other.name,
            seconds,
            distanceMetres: Math.round(distanceMetres),
          });
        }
      }
    }
  }
}

async function buildGraph() {
  const timetable = await loadTimetable();
  const nodes = new Map();
  const adjacency = new Map();
  const destinationAliases = new Map();

  addPatternEdges(nodes, adjacency, "train", "train", timetable.train, bestPatternsFromLoadedStopTimes(timetable.train), destinationAliases);
  addPatternEdges(nodes, adjacency, "vline", "train", timetable.regionalTrain, bestPatternsFromLoadedStopTimes(timetable.regionalTrain), destinationAliases);
  addPatternEdges(nodes, adjacency, "tram", "tram", timetable.tram, bestPatternsFromLoadedStopTimes(timetable.tram), destinationAliases);
  addPatternEdges(nodes, adjacency, "bus", "bus", timetable.bus, bestBusPatterns(timetable.bus), destinationAliases);
  stitchMetroTunnelContinuations(nodes, adjacency, "train", "train", timetable.train);

  buildWalkTransfers(nodes, adjacency);

  const nameIndex = new Map();
  for (const [nodeId, node] of nodes) {
    const key = normaliseStationName(node.name);
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(nodeId);
  }
  // Merge in destination/headsign aliases without letting them shadow a real
  // stop name that already has exact matches of its own.
  for (const [key, nodeIds] of destinationAliases) {
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    const existing = nameIndex.get(key);
    for (const nodeId of nodeIds) {
      if (!existing.includes(nodeId)) existing.push(nodeId);
    }
  }

  return { nodes, adjacency, nameIndex, nodeIds: [...nodes.keys()] };
}

async function getGraph() {
  if (!graphPromise) {
    graphPromise = buildGraph().catch((error) => {
      graphPromise = undefined;
      throw error;
    });
  }
  return graphPromise;
}

// Building the graph from scratch (parsing the full GTFS schedule and
// scanning every bus trip's stop_times) takes on the order of a minute.
// Left lazy, that cost lands entirely on whichever real user happens to
// submit the first journey plan after a server (re)start — which, with no
// long-running "still working" affordance in the UI, just looks like the
// planner is broken. Call this once at server startup so the graph is
// already built by the time real traffic arrives; it's a no-op if a plan
// request already triggered the build first.
export function warmJourneyGraph() {
  return getGraph().catch((error) => {
    console.error("[journey-graph] Warm-up build failed", error?.message ?? error);
  });
}

function resolveByName(graph, name) {
  if (!name) return [];
  const key = normaliseStationName(name);
  const exact = graph.nameIndex.get(key);
  if (exact?.length) return exact.map((nodeId) => ({ nodeId, walkSeconds: 0 }));

  // Fall back to a substring match (e.g. a bus stop name typed without its
  // cross-street suffix) rather than failing outright.
  const partial = [];
  for (const [candidateKey, nodeIds] of graph.nameIndex) {
    if (candidateKey.includes(key) || key.includes(candidateKey)) {
      for (const nodeId of nodeIds) partial.push({ nodeId, walkSeconds: 0 });
    }
    if (partial.length > 20) break;
  }
  return partial;
}

function resolveByCoordinates(graph, lat, lng) {
  const target = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return [];

  const withDistance = [];
  for (const nodeId of graph.nodeIds) {
    const node = graph.nodes.get(nodeId);
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
    const distanceMetres = metresBetween(target.lat, target.lng, node.lat, node.lng);
    if (distanceMetres > ORIGIN_SEARCH_RADIUS_METRES) continue;
    withDistance.push({ nodeId, distanceMetres });
  }
  withDistance.sort((left, right) => left.distanceMetres - right.distanceMetres);
  return withDistance.slice(0, MAX_ORIGIN_CANDIDATES).map(({ nodeId, distanceMetres }) => ({
    nodeId,
    walkSeconds: Math.max(0, Math.round(distanceMetres / WALK_SPEED_METRES_PER_SECOND)),
  }));
}

function resolvePlace(graph, { name, lat, lng }) {
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    const byCoords = resolveByCoordinates(graph, lat, lng);
    if (byCoords.length) return byCoords;
  }
  return resolveByName(graph, name);
}

// State keys glue a nodeId and a routeKey together as one string (cheaper
// than nested Maps for a search this size). GTFS route_ids are not safe to
// split back out of that with a "::" separator + lastIndexOf — PTV's own
// train route_ids look like "aus:vic:vic-02-FKN:" (a trailing colon), which
// creates a stray "::" inside the combined string and silently corrupts the
// split, making every train edge look like a dead end.  never appears
// in a nodeId or routeKey, so indexOf on it is unambiguous.
const STATE_SEPARATOR = "";

function findPath(graph, sources, targetNodeIds) {
  const targetSet = new Set(targetNodeIds);
  if (sources.length === 0 || targetSet.size === 0) return null;

  const NO_ROUTE = "";
  const heap = new MinHeap();
  const best = new Map();
  const previous = new Map();

  for (const { nodeId, walkSeconds } of sources) {
    const state = `${nodeId}${STATE_SEPARATOR}${NO_ROUTE}`;
    const cost = walkSeconds;
    if ((best.get(state) ?? Infinity) > cost) {
      best.set(state, cost);
      heap.push(cost, state);
    }
  }

  let goalState = null;
  while (heap.size > 0) {
    const [cost, state] = heap.pop();
    if (cost > (best.get(state) ?? Infinity)) continue;
    const separator = state.indexOf(STATE_SEPARATOR);
    const nodeId = state.slice(0, separator);
    const routeKey = state.slice(separator + 1);
    if (targetSet.has(nodeId)) {
      goalState = state;
      break;
    }

    for (const edge of graph.adjacency.get(nodeId) ?? []) {
      const staysOnRoute = routeKey !== NO_ROUTE && edge.routeKey === routeKey;
      const nextCost = cost + edge.seconds + (staysOnRoute ? 0 : TRANSFER_PENALTY_SECONDS);
      const nextState = `${edge.to}${STATE_SEPARATOR}${edge.routeKey}`;
      if (nextCost < (best.get(nextState) ?? Infinity)) {
        best.set(nextState, nextCost);
        previous.set(nextState, { fromState: state, edge });
        heap.push(nextCost, nextState);
      }
    }
  }

  if (!goalState) return null;

  const edges = [];
  let cursor = goalState;
  while (previous.has(cursor)) {
    const { fromState, edge } = previous.get(cursor);
    edges.unshift(edge);
    cursor = fromState;
  }
  const originSeparator = cursor.indexOf(STATE_SEPARATOR);
  const originNodeId = cursor.slice(0, originSeparator);
  return { edges, totalSeconds: best.get(goalState) ?? 0, originNodeId };
}

function toStopSummary(node) {
  if (!node) return null;
  return { name: node.name, lat: node.lat, lng: node.lng, mode: node.modeKey === "vline" ? "train" : node.modeKey };
}

function buildLegsFromEdges(graph, originNodeId, edges) {
  const originStop = toStopSummary(graph.nodes.get(originNodeId));
  if (edges.length === 0) return { stops: originStop ? [originStop] : [], legs: [] };

  const legs = [];
  const stops = originStop ? [originStop] : [];
  let cursor = originNodeId;
  let segmentStartNodeId = originNodeId;
  let segmentSeconds = 0;
  let segmentStops = 0;
  let activeEdge = edges[0];

  const flushSegment = (endNodeId) => {
    const fromNode = graph.nodes.get(segmentStartNodeId);
    const toNode = graph.nodes.get(endNodeId);
    if (!fromNode || !toNode) return;
    legs.push({
      mode: activeEdge.mode,
      routeLabel: activeEdge.mode === "walk" ? "Walk" : activeEdge.routeLabel,
      headsign: activeEdge.headsign,
      from: fromNode.name,
      to: toNode.name,
      stopsCount: segmentStops,
      approxSeconds: segmentSeconds,
      distanceMetres: activeEdge.mode === "walk" ? activeEdge.distanceMetres : undefined,
      fromLat: fromNode.lat,
      fromLng: fromNode.lng,
      toLat: toNode.lat,
      toLng: toNode.lng,
      shapeId: activeEdge.shapeId,
    });
  };

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const sameSegment = edge.mode === activeEdge.mode && edge.routeKey === activeEdge.routeKey;
    if (!sameSegment) {
      flushSegment(cursor);
      segmentStartNodeId = cursor;
      segmentSeconds = 0;
      segmentStops = 0;
      activeEdge = edge;
    }
    segmentSeconds += edge.seconds;
    segmentStops += 1;
    cursor = edge.to;
    const stopSummary = toStopSummary(graph.nodes.get(cursor));
    if (stopSummary) stops.push(stopSummary);
  }
  flushSegment(cursor);

  return { stops, legs };
}

// A route's full real shape covers its whole terminus-to-terminus path;
// most legs only ride part of it. Find the shape points nearest the leg's
// actual boarding and alighting stops and slice between them, so the drawn
// line matches the real road for exactly the portion of the route ridden —
// not the model's stop-to-stop straight lines this replaces, and not the
// bus's whole route either.
function trimShapeToLeg(shapePoints, fromLat, fromLng, toLat, toLng) {
  if (shapePoints.length < 2) return [];
  const distanceSquared = (point, lat, lng) => (point[0] - lat) ** 2 + (point[1] - lng) ** 2;
  let fromIndex = 0;
  let fromBest = Infinity;
  let toIndex = shapePoints.length - 1;
  let toBest = Infinity;
  for (let index = 0; index < shapePoints.length; index += 1) {
    const point = shapePoints[index];
    const fromDistance = distanceSquared(point, fromLat, fromLng);
    if (fromDistance < fromBest) {
      fromBest = fromDistance;
      fromIndex = index;
    }
    const toDistance = distanceSquared(point, toLat, toLng);
    if (toDistance < toBest) {
      toBest = toDistance;
      toIndex = index;
    }
  }
  if (fromIndex === toIndex) return [];
  return fromIndex < toIndex
    ? shapePoints.slice(fromIndex, toIndex + 1)
    : [...shapePoints.slice(toIndex, fromIndex + 1)].reverse();
}

// Real GTFS shapes only exist for bus routes in this app right now (see
// readIndexedBusShape) — train/tram legs still draw as stop-to-stop lines on
// the frontend, unaffected by this. Attaching real geometry here, once, at
// the point a plan is built, means every leg's shape is ready to draw
// exactly as-is rather than needing a second lookup client-side.
function attachRealBusShapes(legs) {
  for (const leg of legs) {
    if (leg.mode !== "bus" || !leg.shapeId) continue;
    if (![leg.fromLat, leg.fromLng, leg.toLat, leg.toLng].every(Number.isFinite)) continue;
    const shapePoints = readIndexedBusShape(leg.shapeId);
    const trimmed = trimShapeToLeg(shapePoints, leg.fromLat, leg.fromLng, leg.toLat, leg.toLng);
    if (trimmed.length >= 2) leg.shapePositions = trimmed;
  }
  return legs;
}

export async function planJourney({ originName, originLat, originLng, destinationName, destinationLat, destinationLng }) {
  const graph = await getGraph();
  const sources = resolvePlace(graph, { name: originName, lat: originLat, lng: originLng });
  const destinationCandidates = resolvePlace(graph, { name: destinationName, lat: destinationLat, lng: destinationLng });

  if (sources.length === 0) return { found: false, reason: "origin-not-found" };
  if (destinationCandidates.length === 0) return { found: false, reason: "destination-not-found" };

  const destinationNodeIds = destinationCandidates.map((candidate) => candidate.nodeId);
  if (sources.some((source) => destinationNodeIds.includes(source.nodeId))) {
    const stop = toStopSummary(graph.nodes.get(sources[0].nodeId));
    return { found: true, alreadyThere: true, legs: [], stops: stop ? [stop] : [] };
  }

  const result = findPath(graph, sources, destinationNodeIds);
  if (!result) return { found: false, reason: "no-route" };

  const usedSource = sources.find((source) => source.nodeId === result.originNodeId) ?? sources[0];
  const { stops, legs: rawLegs } = buildLegsFromEdges(graph, result.originNodeId, result.edges);
  const walkFromOriginSeconds = usedSource.walkSeconds || 0;

  // fromLat/fromLng/toLat/toLng/shapeId only exist to compute shapePositions
  // above — internal plumbing, not part of the public leg shape callers rely on.
  const legs = attachRealBusShapes(rawLegs).map(
    ({ fromLat: _fromLat, fromLng: _fromLng, toLat: _toLat, toLng: _toLng, shapeId: _shapeId, ...leg }) => leg,
  );

  return {
    found: true,
    alreadyThere: false,
    stops,
    legs,
    walkFromOriginSeconds,
    totalApproxSeconds: result.totalSeconds,
  };
}
