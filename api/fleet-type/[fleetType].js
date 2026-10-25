import { lookupFleetType, isKnownFleetType } from "../_lib/fleet-tracking.js";

export default async function handler(req, res) {
  const fleetType = Array.isArray(req.query?.fleetType) ? req.query.fleetType[0] : req.query?.fleetType;
  const key = String(fleetType || "").trim().toLowerCase();

  if (!isKnownFleetType(key)) {
    res.status(200).json({
      fleetType: key,
      sets: [],
      _meta: {
        source: "fleet-tracking",
        note: `"${key}" isn't a recognised fleet type for set-number classification.`,
      },
    });
    return;
  }

  const sets = await lookupFleetType(key).catch((error) => {
    console.warn("[fleet-type] lookup failed:", error?.message ?? error);
    return [];
  });

  res.status(200).json({
    fleetType: key,
    sets,
    _meta: {
      source: "fleet-tracking",
      note: sets.length === 0 ? "No sightings logged yet for this fleet type." : null,
    },
  });
}
