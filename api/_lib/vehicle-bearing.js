// GTFS-Realtime decoders return 0 for an unset optional bearing (it's a
// prototype default, not an own property), and PTV's JSON uses null — both
// used to reach the map as a confident "due north" arrow, most visibly for
// trains stopped at a platform. Only a bearing the feed actually sent counts.
export function feedBearing(position) {
  if (!position || !Object.prototype.hasOwnProperty.call(position, "bearing")) return undefined;
  const raw = position.bearing;
  if (raw === null || raw === "" || typeof raw === "boolean") return undefined;
  const bearing = Number(raw);
  return Number.isFinite(bearing) && bearing >= 0 && bearing <= 360 ? bearing % 360 : undefined;
}
