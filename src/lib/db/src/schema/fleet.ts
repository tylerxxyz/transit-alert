import { pgTable, text, serial, doublePrecision, timestamp, unique } from "drizzle-orm/pg-core";

// One row per (consist, trip_id) pairing. Upserted while that trip is
// actively running (last_seen_at/lat/lng refreshed each poll); a new row
// only gets inserted when the same physical consist picks up a new trip_id.
// This lets us answer "where was it last seen" and "what did it run today"
// for a set that has since gone out of service, without logging every
// single position ping as its own row.
export const fleetSightingsTable = pgTable(
  "fleet_sightings",
  {
    id: serial("id").primaryKey(),
    consist: text("consist").notNull(),
    tdn: text("tdn"),
    tripId: text("trip_id").notNull(),
    line: text("line"),
    destination: text("destination"),
    trainType: text("train_type"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    status: text("status"),
    serviceDate: text("service_date"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (table) => [unique("fleet_sightings_consist_trip_unique").on(table.consist, table.tripId)],
);

export type FleetSighting = typeof fleetSightingsTable.$inferSelect;
