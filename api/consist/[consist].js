import { lookupFleetSetNumber } from "../_lib/fleet-tracking.js";

function toTripShape(service) {
  if (!service) return null;
  return {
    id: service.tripId,
    origin: null,
    destination: service.destination ?? null,
    departs: service.firstSeenAt,
    arrives: service.lastSeenAt,
    date: null,
    consist_label: service.consist,
    url: null,
  };
}

export default async function handler(req, res) {
  const consist = Array.isArray(req.query?.consist) ? req.query.consist[0] : req.query?.consist;
  const setNumber = String(consist || "430M").trim();

  const result = await lookupFleetSetNumber(setNumber).catch((error) => {
    console.warn("[consist] lookup failed:", error?.message ?? error);
    return null;
  });

  if (!result) {
    res.status(200).json({
      consist: setNumber,
      as_of: new Date().toISOString(),
      status: "idle",
      current_trip: null,
      position: null,
      next_trip: null,
      network_alerts: [],
      last_known_position: null,
      last_service: null,
      todays_services: [],
      _meta: {
        source: "fleet-tracking",
        note: "No sightings logged yet for this set number. Tracking starts from when this endpoint first sees it running.",
      },
    });
    return;
  }

  res.status(200).json({
    consist: result.setNumber,
    as_of: new Date().toISOString(),
    status: result.inService ? "active" : "idle",
    current_trip: result.inService ? toTripShape(result.lastService) : null,
    position:
      result.inService && result.lastKnownPosition
        ? {
            vehicle_stop_status: "IN_TRANSIT_TO",
            current_stop: null,
            current_stop_time: null,
            next_stop: null,
            next_stop_time: null,
            lat: result.lastKnownPosition.lat,
            lng: result.lastKnownPosition.lng,
            progress_pct: null,
          }
        : null,
    next_trip: null,
    network_alerts: [],
    last_known_position: result.lastKnownPosition,
    last_seen_at: result.lastSeenAt,
    last_service: result.lastService,
    todays_services: result.todaysServices,
    _meta: {
      source: "fleet-tracking",
      note: null,
    },
  });
}
