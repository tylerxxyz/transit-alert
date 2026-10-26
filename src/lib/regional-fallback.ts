// Real V/Line route_id -> real route_short_name (source: VIC GTFS regional
// feed routes.txt). Authoritative and unambiguous — unlike the live feed's
// own line/destination/serviceDescription fields, which for several real
// services (e.g. every Echuca and Shepparton run observed, and the Seymour-
// line Sprinter confirmed live as TDN 8326) are just the generic literal
// "V/Line". The 3-letter code is always present in tripId (e.g.
// "01-SNH--6-T0-8381", "01-SER--6-T0-8326"), so this needs no geographic or
// text-matching guess — it's a direct lookup.
//
// outbound is the service's real terminus (shown as "Southern Cross → X"),
// not the corridor: an Echuca train is not going to Bendigo. serviceLabel
// stays the corridor, which the line filters key on.
export const VLINE_ROUTE_CODE_TO_LINE: Record<string, { outbound: string; inbound: string; serviceLabel: string }> = {
  ABY: { outbound: "Albury", inbound: "Southern Cross", serviceLabel: "Seymour line" },
  ART: { outbound: "Ararat", inbound: "Southern Cross", serviceLabel: "Ballarat line" },
  BAT: { outbound: "Ballarat", inbound: "Southern Cross", serviceLabel: "Ballarat line" },
  BDE: { outbound: "Bairnsdale", inbound: "Southern Cross", serviceLabel: "Gippsland line" },
  BGO: { outbound: "Bendigo", inbound: "Southern Cross", serviceLabel: "Bendigo line" },
  ECH: { outbound: "Echuca", inbound: "Southern Cross", serviceLabel: "Bendigo line" },
  GEL: { outbound: "Waurn Ponds", inbound: "Southern Cross", serviceLabel: "Geelong line" },
  MBY: { outbound: "Maryborough", inbound: "Southern Cross", serviceLabel: "Ballarat line" },
  SER: { outbound: "Seymour", inbound: "Southern Cross", serviceLabel: "Seymour line" },
  SNH: { outbound: "Shepparton", inbound: "Southern Cross", serviceLabel: "Seymour line" },
  SWL: { outbound: "Swan Hill", inbound: "Southern Cross", serviceLabel: "Bendigo line" },
  TRN: { outbound: "Traralgon", inbound: "Southern Cross", serviceLabel: "Gippsland line" },
  WBL: { outbound: "Warrnambool", inbound: "Southern Cross", serviceLabel: "Geelong line" },
};

export function isGenericRegionalPlaceholder(value?: string | null) {
  const normalised = value?.trim().toLowerCase() ?? "";
  return !normalised || normalised === "v/line" || normalised === "vline" || normalised === "unknown";
}

// The cheap, always-available first check (no geographic nearest-line
// fallback needed here — that requires the large line-shape polylines that
// only Map.tsx has loaded, and the tripId code alone already resolves the
// large majority of real V/Line services correctly).
export function getVlineRouteMetaFromTripId(tripId: string | undefined, cityBound: boolean) {
  const routeCode = tripId?.match(/^0?1-([A-Za-z]+)--/)?.[1]?.toUpperCase();
  const codeMeta = routeCode ? VLINE_ROUTE_CODE_TO_LINE[routeCode] : undefined;
  if (!codeMeta) return null;
  return {
    ...codeMeta,
    origin: cityBound ? codeMeta.outbound : codeMeta.inbound,
    destination: cityBound ? codeMeta.inbound : codeMeta.outbound,
  };
}
