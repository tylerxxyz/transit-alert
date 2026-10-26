import { Fragment, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Polyline,
  CircleMarker,
  Tooltip,
  useMap,
  Pane,
} from "react-leaflet";
import L from "leaflet";
import { useGetReports } from "@/lib/api-client-react/src/generated/api";
import type { Report } from "@/lib/api-client-react/src/generated/api.schemas";
import smartbusIcon from "@/assets/icons/smartbus.svg";
import trainIcon from "@/assets/icons/train.svg";
import tramIcon from "@/assets/icons/tram.png";
import hcmtIcon from "@/assets/icons/hcmt.svg";
import xtrapolisIcon from "@/assets/icons/xtrapolis.svg";
import siemensIcon from "@/assets/icons/siemens.svg";
import comengIcon from "@/assets/icons/ss-comeng.svg";
import { fetchLiveTrains, isCrossCityLiveTrain, isNswTrainLinkLiveTrain, isSydneyTrainsLiveTrain, isVlineLiveTrain, type LiveTrain } from "@/lib/live-trains";
import { getVlineRouteMetaFromTripId } from "@/lib/regional-fallback";
import { inferVehicleHeading, resolveVehicleHeading, validVehicleHeading } from "@/lib/vehicle-heading";
import { getStopProgress, type StopProgress } from "@/lib/stop-progress";
import { fetchSydneyTransit } from "@/lib/sydney-transit";
import { getBusPowertrainBadge, lookupBusFleetInfo } from "@/lib/bus-fleet";
import { getCurrentVlineAllocation } from "@/lib/vline-allocation";
import { getFleetNickname } from "@/lib/fleet-nicknames";
import { FREIGHT_TIMING_DATA, interpolatePositionAtTime, type NonPassengerServiceType } from "@/lib/freight-timing-data";
import { fetchLiveBuses, type LiveBus } from "@/lib/live-buses";
import { fetchBusTrip, fetchStationDepartures, fetchTrainTrip, fetchTramTrip, fetchSurfaceStopDepartures, type VerifiedDeparture, type TrainFormationSegment, type NonPassengerPassThrough } from "@/lib/timetable";
import { fetchLiveTrams, type LiveTram } from "@/lib/live-trams";
import { GENERATED_TRAM_ROUTE_BUNDLES } from "@/lib/generated-tram-routes";
import type { GeneratedBusStop } from "@/lib/generated-bus-stops";
import { GENERATED_VLINE_GTFS } from "@/lib/generated-vline-gtfs";
import { GENERATED_NSW_TRAINLINK_GTFS } from "@/lib/generated-nsw-trainlink-gtfs";
import { GENERATED_METRO_GTFS } from "@/lib/generated-metro-gtfs";
import { findStationCoordinate } from "@/lib/station-coordinates";
import { fetchConsistSnapshot, type ConsistSnapshot } from "@/lib/transportvic-bot";
import { fetchMarkerOverrides, saveMarkerOverrides, type MarkerOverride } from "@/lib/marker-overrides";
import { getStationConnectionTags, getStationInterchangeSummary, getTramRouteStyle } from "@/lib/interchanges";
import type { MobilePerformanceMode } from "@/lib/preferences";
import { DEFAULT_TRANSPORT_MODES } from "@/lib/preferences";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Accessibility,
  Train,
  Bus,
  TramFront,
  MapPin,
  Layers,
  AlertTriangle,
  Clock,
  Info,
  ZoomIn,
  ZoomOut,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Navigation,
  Eye,
  EyeOff,
  Search,
  Star,
  Map as MapIcon,
  Crosshair,
  X,
  Ban,
  Package,
  Landmark,
} from "lucide-react";

const MELBOURNE_CENTER: [number, number] = [-37.8136, 144.9631];
const SOUTHERN_CROSS_POSITION: [number, number] = [-37.818313906129944, 144.95218];
const ZONE_1_2_BOUNDARY: [number, number][] = [
  [-37.86374615697885, 144.7720741120282], // Laverton
  [-37.7814, 144.7728], // Deer Park / western boundary
  [-37.7011, 144.7742], // Watergardens corridor
  [-37.6830, 144.9196], // Broadmeadows corridor
  [-37.7045, 145.1030], // Greensborough corridor
  [-37.8157, 145.2295], // Ringwood corridor
  [-37.875253140075536, 145.1277433710727], // Mount Waverley
  [-37.9247726501578, 145.12035310256484], // Clayton
  [-37.934353509080286, 145.03640347599866], // Southland / Cheltenham corridor
  [-37.95036297669773, 145.00454952822133], // Sandringham
];
const FEATURED_CONSIST = "430M";
const FLAGSTAFF_POSITION: [number, number] = [-37.81145, 144.9562];
const MELBOURNE_CENTRAL_POSITION: [number, number] = [-37.80955, 144.96278];
const MELBOURNE_CENTRAL_STATE_LIBRARY_INTERCHANGE: [number, number] = [-37.80995575690716, 144.96286];
const STATE_LIBRARY_POSITION: [number, number] = [-37.80941962893699, 144.96324300865265];
const TOWN_HALL_POSITION: [number, number] = [-37.816897881552016, 144.96717135795797];
const FREIGHT_BROWN = "#7b4b2a";
const FREIGHT_BROWN_DARK = "#5a3417";
const CITY_LOOP_PILL_STATIONS = new Set([
  "Flinders Street",
  "Southern Cross",
  "Flagstaff",
  "Melbourne Central",
  "Parliament",
  "State Library",
  "Town Hall",
]);
const SPECIAL_PILL_STATIONS = new Set([
  "Caulfield",
  "South Yarra",
  "Flinders Street",
  "Southern Cross",
  "Flagstaff",
  "Melbourne Central",
  "Parliament",
  "State Library",
  "Town Hall",
  "Richmond",
  "North Melbourne",
  "Footscray",
  "Newport",
  "Clayton",
  "Dandenong",
  "Pakenham",
  "Frankston",
  "Malvern",
  "Sunshine",
  "Watergardens",
  "Sunbury",
]);
const SINGLE_RENDER_STATIONS = new Set([
  "Flinders Street",
  "Southern Cross",
  "Flagstaff",
  "Melbourne Central",
  "Parliament",
  "State Library",
  "Town Hall",
]);
// Before the Metro Tunnel opened, "State Library" was just an alternate exit
// name for the City Loop's Melbourne Central platform, so the two were merged
// into one marker. The Metro Tunnel's State Library is a real, physically
// separate station today (its own platform ~70m away, on the Metro Tunnel
// corridor), so it must no longer be folded into Melbourne Central's marker.
const COMBINED_LOOP_INTERCHANGES = new Set(["Melbourne Central"]);
const CROSS_INTERCHANGE_PILL_STATIONS = new Set([
  "Caulfield",
  "South Yarra",
  "Malvern",
  "Flinders Street",
  "Southern Cross",
  "Flagstaff",
  "Melbourne Central",
  "Melbourne Central / State Library",
  "Parliament",
  "State Library",
  "Town Hall",
  "Richmond",
  "North Melbourne",
  "Footscray",
  "Newport",
  "Sunshine",
  "Watergardens",
  "Sunbury",
  "Clayton",
  "Dandenong",
  "Pakenham",
  "Frankston",
]);
const CAULFIELD_METRO_SHARED_STATIONS = new Set([
  "Hawksburn",
  "Toorak",
  "Armadale",
  "Malvern",
  "Caulfield",
]);
const FRANKSTON_GREEN_SHARED_STATIONS = new Set([
  "Hawksburn",
  "Toorak",
  "Armadale",
]);
const NORTHERN_SHARED_STATIONS = new Set(["North Melbourne"]);
const ROTATED_FRANKSTON_PILL_STATIONS = new Set([
  "Frankston",
  "Kananook",
  "Seaford",
  "Carrum",
  "Bonbeach",
  "Chelsea",
  "Edithvale",
  "Aspendale",
  "Mordialloc",
  "Parkdale",
  "Mentone",
  "Cheltenham",
  "Southland",
  "Highett",
  "Glen Huntly",
  "Ormond",
  "Moorabbin",
  "Bentleigh",
  "McKinnon",
  "Patterson",
  "Armadale",
  "Toorak",
  "Hawksburn",
  "Craigieburn",
  "Roxburgh Park",
  "Coolaroo",
  "Broadmeadows",
  "Jacana",
  "Glenroy",
  "Oak Park",
  "Pascoe Vale",
  "Strathmore",
  "Essendon",
  "Moonee Ponds",
  "Ascot Vale",
  "Newmarket",
  "Kensington",
  "Upfield",
  "Gowrie",
  "Fawkner",
  "Merlynston",
  "Batman",
  "Coburg",
  "Moreland",
  "Anstey",
  "Brunswick",
  "Jewell",
  "Royal Park",
  "Flemington Bridge",
  "Macaulay",
  "Sunbury",
  "Diggers Rest",
  "Watergardens",
  "Keilor Plains",
  "St. Albans",
  "Ginifer",
  "Albion",
  "Sunshine",
  "Tottenham",
  "West Footscray",
  "Middle Footscray",
  "Footscray",
  "South Kensington",
  "Arden",
  "Parkville",
  "Anzac",
  "Carnegie",
  "Murrumbeena",
  "Hughesdale",
  "Oakleigh",
  "Huntingdale",
  "Clayton",
  "Westall",
  "Springvale",
  "Sandown Park",
  "Noble Park",
  "Yarraman",
  "Dandenong",
  "Hallam",
  "Narre Warren",
  "Berwick",
  "Beaconsfield",
  "Officer",
  "Cardinia Road",
  "Pakenham",
  "East Pakenham",
  "Lynbrook",
  "Merinda Park",
  "Cranbourne",
  "Prahran",
  "Windsor",
  "Balaclava",
  "Ripponlea",
  "Elsternwick",
  "Gardenvale",
  "North Brighton",
  "Middle Brighton",
  "Brighton Beach",
  "Hampton",
  "Sandringham",
  "Burnley",
  "Heyington",
  "Kooyong",
  "Tooronga",
  "Gardiner",
  "Glen Iris",
  "Darling",
  "East Malvern",
  "Holmesglen",
  "Jordanville",
  "Mount Waverley",
  "Syndal",
  "Glen Waverley",
  "Richmond",
  "East Richmond",
  "Hawthorn",
  "Glenferrie",
  "Auburn",
  "Camberwell",
  "East Camberwell",
  "Canterbury",
  "Chatham",
  "Union",
  "Box Hill",
  "Laburnum",
  "Blackburn",
  "Nunawading",
  "Mitcham",
  "Heatherdale",
  "Ringwood",
  "Croydon",
  "Mooroolbark",
  "Lilydale",
  "Heathmont",
  "Bayswater",
  "Boronia",
  "Ferntree Gully",
  "Upper Ferntree Gully",
  "Upwey",
  "Tecoma",
  "Belgrave",
  "Riversdale",
  "Willison",
  "Hartwell",
  "Burwood",
  "Ashburton",
  "Alamein",
  "Jolimont",
  "West Richmond",
  "North Richmond",
  "Collingwood",
  "Victoria Park",
  "Clifton Hill",
  "Rushall",
  "Merri",
  "Northcote",
  "Croxton",
  "Thornbury",
  "Bell",
  "Preston",
  "Regent",
  "Reservoir",
  "Ruthven",
  "Keon Park",
  "Thomastown",
  "Lalor",
  "Epping",
  "South Morang",
  "Middle Gorge",
  "Hawkstowe",
  "Mernda",
  "Westgarth",
  "Dennis",
  "Fairfield",
  "Alphington",
  "Darebin",
  "Ivanhoe",
  "Eaglemont",
  "Heidelberg",
  "Rosanna",
  "Macleod",
  "Watsonia",
  "Greensborough",
  "Montmorency",
  "Eltham",
  "Diamond Creek",
  "Wattle Glen",
  "Hurstbridge",
  "North Melbourne",
  "Seddon",
  "Yarraville",
  "Spotswood",
  "Newport",
  "Laverton",
  "Aircraft",
  "Williams Landing",
  "Hoppers Crossing",
  "Werribee",
  "North Williamstown",
  "Williamstown Beach",
  "Williamstown",
  "Seaholme",
  "Altona",
  "Westona",
]);

const STATION_SURFACE_ROUTE_CARDS: Record<string, Array<{ route: string; destination: string; via: string }>> = {
  Ormond: [
    { route: "625", destination: "Elsternwick &harr; Chadstone Shopping Centre", via: "via Ormond and Oakleigh" },
    { route: "630", destination: "Elwood &harr; Monash University Clayton", via: "via Ormond and Huntingdale" },
  ],
};

function createStaffedBadgeHtml(size = 13) {
  return `<span style="
    display:inline-flex;
    align-items:center;
    justify-content:center;
    width:${size}px;
    height:${size}px;
    border-radius:9999px;
    background:#f8fafc;
    color:#0f172a;
    border:1px solid rgba(15,23,42,0.88);
    font-size:${Math.max(8, size - 4)}px;
    font-weight:950;
    line-height:1;
    box-shadow:0 2px 6px rgba(0,0,0,0.35);
  ">i</span>`;
}

function createCityLoopPillIcon(strokeColor: string, stationName: string, options?: { staffed?: boolean }) {
  const staffed = options?.staffed ?? false;
  const staffedBadgeMarkup = staffed ? createStaffedBadgeHtml(13) : "";
  const interchangeLineBadges =
    stationName === "Caulfield" || stationName === "South Yarra" || stationName === "Malvern"
      ? stationName === "South Yarra"
        ? [
            { label: "Frankston", background: "#16a34a", color: "#ffffff" },
            { label: "Sandringham", background: "#d86aa4", color: "#ffffff" },
          ]
        : [
            { label: "Frankston", background: "#16a34a", color: "#ffffff" },
            ...(stationName === "Caulfield" ? [{ label: "Traralgon", background: "#7c3aed", color: "#ffffff" }] : []),
            { label: "Pakenham / Cranbourne / Sunbury", background: "#279FD5", color: "#ffffff" },
          ]
      : [];
  const rawInterchangeRouteTags =
    CROSS_INTERCHANGE_PILL_STATIONS.has(stationName)
      ? getStationConnectionTags(stationName, { includeMajorInterchangeDetails: true, maxTags: 8 })
      : [];
  const interchangeRouteTags = rawInterchangeRouteTags.filter((tag) => !/^tram\b/i.test(tag));
  const interchangeLineBadgesMarkup = interchangeLineBadges.length > 0
    ? `<div style="
          position:absolute;
          left:50%;
          top:39px;
          display:flex;
          flex-wrap:wrap;
          justify-content:center;
          gap:2px;
          width:${stationName === "Caulfield" ? "172px" : "156px"};
          transform:translateX(-50%);
        ">
          ${interchangeLineBadges.map((badge) => {
            const isLongLineBadge = badge.label.includes("/");

            return `<span style="
            border-radius:9999px;
            background:${badge.background};
            border:1px solid rgba(255,255,255,0.26);
            color:${badge.color};
            flex:${isLongLineBadge ? "0 0 100%" : "0 0 auto"};
            max-width:${isLongLineBadge ? "100%" : "none"};
            text-align:center;
            font-size:${isLongLineBadge ? "7px" : "8px"};
            font-weight:950;
            line-height:1;
            padding:${isLongLineBadge ? "3px 5px" : "3px 6px"};
            box-shadow:0 3px 8px rgba(0,0,0,0.3);
            white-space:nowrap;
          ">${escapeInlineMarkerHtml(badge.label)}</span>`;
          }).join("")}
        </div>`
    : "";
  const interchangeRouteTagsMarkup = interchangeRouteTags.length > 0
    ? `<div style="
          position:absolute;
          left:50%;
          top:${interchangeLineBadges.length > 0 ? "72px" : "40px"};
          display:flex;
          flex-wrap:wrap;
          justify-content:center;
          gap:2px;
          width:120px;
          transform:translateX(-50%);
        ">
          ${interchangeRouteTags.map((tag) => {
            const tramRouteMatch = tag.match(/^tram\s+(.+)$/i);
            const isBusTag = /^bus\b/i.test(tag);
            const tramStyle = tramRouteMatch ? getTramRouteStyle(tramRouteMatch[1]) : null;
            const tagBackground = tramStyle?.background ?? (isBusTag ? "#f59e0b" : "rgba(15,23,42,0.92)");
            const tagBorder = tramStyle?.border ?? (isBusTag ? "rgba(251,191,36,0.82)" : "rgba(255,255,255,0.18)");
            const tagColor = tramStyle?.color ?? (isBusTag ? "#111827" : "#f8fafc");

            return `<span style="
            border-radius:9999px;
            background:${tagBackground};
            border:1px solid ${tagBorder};
            color:${tagColor};
            font-size:8px;
            font-weight:900;
            line-height:1;
            padding:3px 5px;
            box-shadow:0 3px 8px rgba(0,0,0,0.3);
            white-space:nowrap;
          ">${escapeInlineMarkerHtml(tag)}</span>`;
          }).join("")}
        </div>`
    : "";
  const hasInterchangeRouteTags = interchangeRouteTags.length > 0;
  const hasInterchangeLineBadges = interchangeLineBadges.length > 0;
  const isHorizontalPill =
    stationName === "Parliament" ||
    stationName === "Southern Cross" ||
    stationName === "State Library" ||
    stationName === "Town Hall" ||
    SPECIAL_PILL_STATIONS.has(stationName);
  const isCompactHorizontalPill = stationName === "State Library";
  const isCombinedCentralLibrary = stationName === "Melbourne Central / State Library";
  const pillRotation =
    SPECIAL_PILL_STATIONS.has(stationName)
      ? "0deg"
      : "0deg";

  if (CROSS_INTERCHANGE_PILL_STATIONS.has(stationName)) {
    const displayName = stationName === "Melbourne Central / State Library" ? "Melb Central" : stationName;
    const labelWidth = Math.max(62, displayName.length * 6 + 24);
    const minimumIconWidth = stationName === "Caulfield" ? 184 : 124;
    const iconWidth = Math.max(minimumIconWidth, labelWidth + 16);
    const labelLeft = Math.round((iconWidth - labelWidth) / 2);
    const crossLeft = Math.round((iconWidth - 38) / 2);
    const stemLeft = Math.round((iconWidth - 14) / 2);
    const iconHeight = hasInterchangeLineBadges && hasInterchangeRouteTags ? 118 : hasInterchangeLineBadges || hasInterchangeRouteTags ? 90 : 62;
    const iconAnchorY = hasInterchangeLineBadges && hasInterchangeRouteTags ? 45 : hasInterchangeLineBadges || hasInterchangeRouteTags ? 38 : 31;
    return L.divIcon({
      html: `
        <div style="position:relative;width:${iconWidth}px;height:${iconHeight}px;display:flex;align-items:center;justify-content:center;">
          <div style="position:absolute;left:${crossLeft}px;top:23px;width:38px;height:13px;border-radius:9999px;background:#f8fafc;border:2px solid rgba(15,23,42,0.96);box-shadow:0 4px 10px rgba(0,0,0,0.36);overflow:hidden;">
            <div style="position:absolute;left:4px;right:4px;top:4px;height:3px;border-radius:9999px;background:${strokeColor};opacity:0.92;"></div>
          </div>
          <div style="position:absolute;left:${stemLeft}px;top:10px;width:14px;height:40px;border-radius:9999px;background:#f8fafc;border:2px solid rgba(15,23,42,0.96);box-shadow:0 4px 10px rgba(0,0,0,0.36);overflow:hidden;">
            <div style="position:absolute;top:5px;bottom:5px;left:4px;width:3px;border-radius:9999px;background:${strokeColor};opacity:0.92;"></div>
          </div>
          <div style="position:absolute;left:${labelLeft}px;top:16px;width:${labelWidth}px;text-align:center;border-radius:9999px;background:#f8fafc;border:2px solid rgba(15,23,42,0.96);padding:3px 8px;font-size:10px;font-weight:850;color:#0f172a;box-shadow:0 4px 10px rgba(0,0,0,0.32);white-space:nowrap;">${escapeInlineMarkerHtml(displayName)}</div>
          ${interchangeLineBadgesMarkup}
          ${interchangeRouteTagsMarkup}
          ${staffed ? `<div style="position:absolute;right:1px;top:2px;">${staffedBadgeMarkup}</div>` : ""}
        </div>
      `,
      className: "bg-transparent border-none",
      iconSize: [iconWidth, iconHeight],
      iconAnchor: [Math.round(iconWidth / 2), iconAnchorY],
      popupAnchor: [0, -14],
    });
  }

  if (isCombinedCentralLibrary) {
    return L.divIcon({
html: `
  <div style="position:relative;width:54px;height:78px;display:flex;align-items:center;justify-content:center;">
  <div style="position:relative;width:30px;height:58px; transform: rotate(-12deg); transform-origin: center;">
    
    <div style="position:absolute;left:11px;top:14px;width:8px;height:38px;border-radius:9999px;background:#f8fafc;border:2px solid rgba(15,23,42,0.96);box-shadow:0 3px 8px rgba(0,0,0,0.36);overflow:hidden;">
      <div style="position:absolute;top:3px;bottom:3px;left:2px;width:2px;border-radius:9999px;background:${strokeColor};opacity:0.95;"></div>
    </div>

    <div style="position:absolute;left:12px;top:9px;width:9px;height:9px;border-radius:9999px;background:#f8fafc;border:2px solid rgba(15,23,42,0.96);transform:rotate(45deg);box-shadow:0 3px 8px rgba(0,0,0,0.36);"></div>

    <div style="position:absolute;left:16px;top:0;width:14px;height:8px;border-radius:9999px;background:#f8fafc;border:2px solid rgba(15,23,42,0.96);box-shadow:0 3px 8px rgba(0,0,0,0.36);"></div>

  </div>
</div>
`,
      className: "bg-transparent border-none",
      iconSize: [54, 78],
      iconAnchor: [27, 39],
      popupAnchor: [0, -18],
    });
  }

  const hitWidth = isHorizontalPill ? (isCompactHorizontalPill ? 52 : 62) : 38;
  const hitHeight = isHorizontalPill ? 38 : 58;

  return L.divIcon({
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;width:${hitWidth}px;height:${hitHeight}px;">
        ${staffed ? `<div style="position:absolute;right:0;top:0;">${staffedBadgeMarkup}</div>` : ""}
        <div style="display:flex;align-items:center;justify-content:center;width:${isHorizontalPill ? (isCompactHorizontalPill ? "28px" : "34px") : "14px"};height:${isHorizontalPill ? (isCompactHorizontalPill ? "14px" : "16px") : "34px"};transform:rotate(${pillRotation});transform-origin:center;">
        <div style="width:${isHorizontalPill ? (isCompactHorizontalPill ? "22px" : "28px") : "8px"};height:${isHorizontalPill ? (isCompactHorizontalPill ? "7px" : "8px") : "28px"};border-radius:9999px;background:#f8fafc;border:2px solid rgba(15,23,42,0.96);box-shadow:0 3px 8px rgba(0,0,0,0.36);position:relative;overflow:hidden;">
          <div style="position:absolute;${isHorizontalPill ? `left:${isCompactHorizontalPill ? "2px" : "3px"};right:${isCompactHorizontalPill ? "2px" : "3px"};top:1px;height:2px;` : "top:3px;bottom:3px;left:1px;width:2px;"}border-radius:9999px;background:${strokeColor};opacity:0.95;"></div>
        </div>
        </div>
      </div>
    `,
    className: "bg-transparent border-none",
    iconSize: [hitWidth, hitHeight],
    iconAnchor: [Math.round(hitWidth / 2), Math.round(hitHeight / 2)],
    popupAnchor: isHorizontalPill ? [0, -10] : [0, -18],
  });
}

// =========================
// Types
// =========================
export type Station = {
  name: string;
  position: [number, number];
  staffed?: boolean;
  barriers?: boolean;
  vline?: boolean;
  metro?: boolean;
  zone?: string;
  // Real published GTFS schedule for this stop (currently only populated for
  // NSW TrainLink XPT — see getNswTrainLinkGtfsPatternStations — since that
  // fleet has no live per-stop match to fall back on otherwise: fetchTrainTrip
  // only queries PTV's Victorian timetable API, which has never heard of a
  // NSW trip ID).
  scheduledArrival?: string | null;
  scheduledDeparture?: string | null;
  platform?: string | null;
  pickupType?: string;
  dropOffType?: string;
};

type BoardingZoneKey = "front" | "middle" | "rear";

type StationBoardingGuide = {
  summary: string;
  interchange: string;
  boardingZones: Array<{
    fleet: string;
    formation: string;
    bestBoarding: BoardingZoneKey;
    note: string;
  }>;
};

// Platform-pair groupings for stations with more than a simple 2-platform
// up/down layout (e.g. "Platforms 1-2", "3-4"), used only to group the
// freight/heritage/empty-car pass-through board block below. Left empty
// until a station's real platform layout is verified — guessing groupings
// risks showing a passing service against the wrong physical platform,
// which is worse than the current flat list.
const STATION_PLATFORM_PAIRS: Record<string, string[][]> = {};

const STATION_BOARDING_GUIDES: Record<string, StationBoardingGuide> = {
  Richmond: {
    summary: "Main east-side transfer hub for Burnley, Clifton Hill, Frankston, Sandringham, and Caulfield group swaps.",
    interchange: "Middle cars minimise the walk when switching between almost every east and south-east corridor.",
    boardingZones: [
      { fleet: "Metro 6-car", formation: "6 cars", bestBoarding: "middle", note: "Best for cross-platform style changes and concourse access." },
      { fleet: "Metro 7-car HCMT", formation: "7 cars", bestBoarding: "middle", note: "The middle remains the least risky spot for busy Richmond interchanges." },
    ],
  },
  Clayton: {
    summary: "Important Monash corridor station where front-to-middle boarding tends to reduce the platform walk.",
    interchange: "Best for Monash bus interchange and Dandenong corridor changes.",
    boardingZones: [
      { fleet: "Metro 6-car", formation: "6 cars", bestBoarding: "middle", note: "Keeps you closest to the main station entrance and bus interchange." },
      { fleet: "Metro 7-car HCMT", formation: "7 cars", bestBoarding: "middle", note: "Middle section is still the safest all-round choice here." },
      { fleet: "Regional Gippsland", formation: "Regional", bestBoarding: "front", note: "Front half is generally better for exits and station transfer paths." },
    ],
  },
  "North Melbourne": {
    summary: "Useful for Craigieburn, Upfield, Sunbury, airport-coach style links, and future Arden-side interchange movement.",
    interchange: "Front third is usually best for exits and northern platform changes.",
    boardingZones: [
      { fleet: "Metro 6-car", formation: "6 cars", bestBoarding: "front", note: "Best for concourse links and northern line platform swaps." },
      { fleet: "Metro 7-car HCMT", formation: "7 cars", bestBoarding: "front", note: "Front half gives the cleaner exit for transfers." },
      { fleet: "Regional / interstate", formation: "Regional", bestBoarding: "front", note: "Best for terminal-side movement and quick exits." },
    ],
  },
  Dandenong: {
    summary: "Best transfer point for Cranbourne, Pakenham, Gippsland, buses, and south-east freight corridor viewing.",
    interchange: "Middle-to-front boarding is usually the best tradeoff for exits and platform changes.",
    boardingZones: [
      { fleet: "Metro 6-car", formation: "6 cars", bestBoarding: "middle", note: "Best for rapid interchange between metro platforms." },
      { fleet: "Metro 7-car HCMT", formation: "7 cars", bestBoarding: "middle", note: "Middle cars keep the station walk manageable." },
      { fleet: "Regional Gippsland", formation: "Regional", bestBoarding: "front", note: "Front side usually feels closest to the main station access." },
    ],
  },
};

type SurfaceStop = {
  id: string;
  name: string;
  locality: string;
  position: [number, number];
  subtitle: string;
  modes: TransportMode[];
  routeLabel: string;
  departures: SurfaceStopDeparture[];
};

type SurfaceStopDeparture = {
  route: string;
  destination: string;
  departureLabel: string;
  statusLabel: string;
  note?: string;
};

type FreightLocation = {
  name: string;
  kind: string;
  position: [number, number];
};

type JourneyLegSegment = {
  mode: "train" | "tram" | "bus" | "walk";
  positions: [number, number][];
  routeLabel?: string;
};

// Train legs use the real line colour (via getLiveLineColor, keyed by the
// leg's own route label) instead of one flat colour for every train ride —
// tram and bus stay their established mode colours since a rider cares
// which real Metro/V-Line corridor they're on for a train, but not a
// distinct colour per tram or bus route number here.
const JOURNEY_LEG_MODE_STYLE: Record<JourneyLegSegment["mode"], { color: string; weight: number; dashArray?: string }> = {
  train: { color: "#facc15", weight: 6 },
  tram: { color: "#34d399", weight: 6 },
  bus: { color: "#FF8200", weight: 6 },
  walk: { color: "#94a3b8", weight: 3, dashArray: "2 8" },
};

function getJourneyLegColor(segment: JourneyLegSegment): string {
  if (segment.mode === "train" && segment.routeLabel) {
    return getLiveLineColor(segment.routeLabel);
  }
  return JOURNEY_LEG_MODE_STYLE[segment.mode].color;
}

interface MapProps {
  journeyRoute?: Station[];
  journeyLegSegments?: JourneyLegSegment[];
  journeyBusRoutes?: string[];
  splitCrossCityGroup?: boolean;
  transportModes?: TransportMode[];
  onTransportModesChange?: (modes: TransportMode[]) => void;
  persistedLayerState?: Partial<LayerState>;
  onLayerStateChange?: (layers: LayerState) => void;
  isAdmin?: boolean;
  isGuest?: boolean;
  isPremium?: boolean;
  premiumPaypalLink?: string | null;
  favouriteConsists?: string[];
  onToggleFavouriteConsist?: (consist: string) => void;
  showFilterRail?: boolean;
  focusedVehicleKey?: string | null;
  onFocusedVehicleHandled?: () => void;
  debugLineKey?: AdminDebugLineKey;
  mobilePerformanceMode?: MobilePerformanceMode;
}

export interface LayerState {
  merndaLine: boolean;
  hurstbridgeLine: boolean;
  cliftonHillLoop: boolean;
  frankstonLine: boolean;
  stonyPointLine: boolean;
  cranbourneLine: boolean;
  pakenhamLine: boolean;
  sunburyLine: boolean;
  craigieburnLine: boolean;
  upfieldLine: boolean;
  lilydaleLine: boolean;
  belgraveLine: boolean;
  alameinLine: boolean;
  glenWaverleyLine: boolean;
  northernLoop: boolean;
  burnleyLoop: boolean;
  metroTunnel: boolean;
  werribeeLine: boolean;
  sandringhamLine: boolean;
  // Split from one flag per corridor into one per real named V/Line
  // destination — each is independently toggleable in the Map Layers panel,
  // but the older "*Regional" grouping (geelongRegionalGroup etc., used by
  // the separate quick-filter chips elsewhere) still exists and now toggles
  // the union of the lines that made up that corridor, so that UI's
  // behaviour is unchanged.
  geelongLine: boolean;
  warrnamboolLine: boolean;
  ballaratLine: boolean;
  araratLine: boolean;
  maryboroughLine: boolean;
  bendigoLine: boolean;
  echucaLine: boolean;
  swanHillLine: boolean;
  seymourLine: boolean;
  sheppartonLine: boolean;
  alburyLine: boolean;
  traralgonLine: boolean;
  bairnsdaleLine: boolean;
  inspectors: boolean;
  delays: boolean;
  incidents: boolean;
  heatCircles: boolean;
  // Off by default — Sydney buses/light rail/metro are a separate opt-in feed
  // (thousands of extra vehicles statewide in NSW), not part of the default
  // Melbourne fetch. See sydneyBuses/sydneyTrams/sydneyMetroTrains queries.
  sydneyTransit: boolean;
  // Off by default, same as sydneyTransit/heatCircles — timetable-estimated
  // (never real GPS) freight/heritage/empty-car pass-through markers.
  freight: boolean;
  heritage: boolean;
  nonPassenger: boolean;
}

export type ServiceFilterKey =
  | "geelongRegionalGroup"
  | "ballaratRegionalGroup"
  | "bendigoRegionalGroup"
  | "seymourRegionalGroup"
  | "traralgonRegionalGroup"
  | "metroTunnelServices"
  | "crossCityPink"
  | "werribeeWilliamstownGroup"
  | "sandringhamGroup"
  | "frankstonGroup"
  | "caulfieldGroup"
  | "burnleyGroup"
  | "cliftonHillGroup"
  | "upfieldCraigieburn"
  | "upfieldCraigieburnCityLoop" | "xptInterstate";

export type TransportMode = "train" | "tram" | "bus" | "vline";
export type AdminDebugLineKey =
  | "none"
  | "glenWaverleyLine"
  | "bairnsdaleLine"
  | "cliftonHillLoop"
  | "northernLoop"
  | "caulfieldLoop";

export const ADMIN_DEBUG_LINE_OPTIONS: Array<{ key: AdminDebugLineKey; label: string }> = [
  { key: "none", label: "Off" },
  { key: "glenWaverleyLine", label: "Glen Waverley Line" },
  { key: "bairnsdaleLine", label: "Bairnsdale Line" },
  { key: "cliftonHillLoop", label: "Clifton Hill Loop" },
  { key: "northernLoop", label: "Northern Loop" },
  { key: "caulfieldLoop", label: "Caulfield Loop" },
];

type SurfaceRouteFilter = {
  key: string;
  mode: Extract<TransportMode, "tram" | "bus">;
  route: string;
  label: string;
  description?: string;
  tone: string;
};

function areLayerStatesEqual(
  left?: Partial<LayerState> | null,
  right?: Partial<LayerState> | null,
) {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b));

  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(([key, value], index) => {
    const [otherKey, otherValue] = rightEntries[index] ?? [];
    return key === otherKey && value === otherValue;
  });
}

export function getLiveLineColor(line: string): string {
  const colorMap: Record<string, string> = {
    frankston: "#22c55e",
    "stony point": "#028430",
    mernda: "#BE1014",
    hurstbridge: "#BE1014",
    craigieburn: "#FFD200",
    upfield: "#FFD200",
    lilydale: "#003A8F",
    belgrave: "#003A8F",
    "glen waverley": "#003A8F",
    glenwaverley: "#003A8F",
    alamein: "#003A8F",
    sandringham: "#F178AF",
    werribee: "#F178AF",
    williamstown: "#F178AF",
    altona: "#F178AF",
    sunbury: "#279FD5",
    cranbourne: "#279FD5",
    pakenham: "#279FD5",
    "metro tunnel": "#279FD5",
    // The underground loop portal tracks (and the rare early-morning "City
    // Circle" service that just loops without going out to a suburb) are
    // shown in red on the official network map, distinct from any one line.
    "city circle": "#BE1014",
    "city loop": "#BE1014",
    "v/line": "#7c3aed",
    vline: "#7c3aed",
    traralgon: "#7c3aed",
    bairnsdale: "#7c3aed",
    ballarat: "#7c3aed",
    bendigo: "#7c3aed",
    echuca: "#7c3aed",
    geelong: "#7c3aed",
    "waurn ponds": "#7c3aed",
    wendouree: "#7c3aed",
    seymour: "#7c3aed",
    shepparton: "#7c3aed",
    warrnambool: "#7c3aed",
    maryborough: "#7c3aed",
    ararat: "#7c3aed",
      "swan hill": "#7c3aed",
      albury: "#7c3aed",
      "nsw trainlink": "#d9480f",
      "nsw trainlink xpt": "#d9480f",
      "nsw trainlink xplorer": "#b45309",
      xpt: "#d9480f",
      xplorer: "#b45309",
    };

  return colorMap[line.toLowerCase()] ?? "#3b82f6";
}

function getDirectionArrow(direction: LiveTrain["direction"]) {
  switch (direction) {
    case "up":
    case "city-bound":
      return "⬆";
    case "down":
    case "outbound":
      return "⬇";
    default:
      return "•";
  }
}

function getMarkerServiceCode(line: string) {
  const normalized = line.trim().toLowerCase();

  switch (normalized) {
    case "flinders street":
    case "flinders st":
    case "flinders":
      return "FSS";
    case "town hall":
      return "THL";
    case "state library":
      return "STL";
    case "lilydale":
      return "LIL";
    case "belgrave":
      return "BEL";
    case "glen waverley":
      return "GWY";
    case "alamein":
      return "ALA";
    case "mernda":
      return "MER";
    case "hurstbridge":
      return "HBE";
    case "frankston":
      return "FKN";
    case "sandringham":
      return "SDM";
    case "williamstown":
      return "WIL";
    case "werribee":
      return "WER";
    case "sunbury":
      return "SUN";
    case "cranbourne":
      return "CRA";
    case "pakenham":
      return "PAK";
    case "craigieburn":
      return "CBN";
    case "upfield":
      return "UPF";
    case "metro tunnel":
      return "MTL";
    case "v/line":
      return "VLI";
    case "traralgon":
      return "TRA";
    case "ballarat":
      return "BAL";
    case "bendigo":
      return "BEN";
    case "echuca":
      return "ECH";
    case "geelong":
      return "GEL";
    case "waurn ponds":
      return "WPN";
    case "wendouree":
      return "WND";
    default:
      return line.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "SRV";
  }
}

// Shared by the train/tram/bus "is here" cards — a vehicle within 15% of its
// last stop or 90% toward its next one reads as "still at"/"basically
// arrived" rather than a raw, jittery percentage that never quite hits 0 or 100.
// "Last stop → Now at / Next stop → Then" at a glance, above the full stop
// list, so riders don't have to find the live marker inside a long pattern.
function StopProgressSummary({ progress, accent }: { progress: StopProgress | null; accent: string }) {
  if (!progress || (!progress.now && !progress.next)) return null;
  const rows = [
    progress.last ? { label: "Last stop", name: progress.last, strong: false } : null,
    progress.now ? { label: "Now at", name: progress.now, strong: true } : { label: "Next stop", name: progress.next!, strong: true },
    progress.then ? { label: progress.now ? "Next stop" : "Then", name: progress.then, strong: false } : null,
  ].filter((row): row is { label: string; name: string; strong: boolean } => Boolean(row));
  return (
    <div className="mb-2 grid gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2" style={{ borderLeft: `3px solid ${accent}` }}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline gap-2">
          <span className="w-[4.75rem] shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/40">{row.label}</span>
          <span className={`min-w-0 truncate text-sm ${row.strong ? "font-bold text-white" : "font-semibold text-white/65"}`}>{row.name}</span>
        </div>
      ))}
    </div>
  );
}

function formatLiveSegmentLabel(position: { from: string; to: string; progress: number }) {
  if (position.progress >= 0.9) return `Arriving at ${position.to}`;
  if (position.progress <= 0.15) return `Departing ${position.from}`;
  return `${position.from} → ${position.to} · ${Math.round(position.progress * 100)}%`;
}

// How stale is this vehicle's real GPS fix, in the rider's own words — the
// live feed's own position update, not "now" relative to the schedule.
function formatUpdatedAgo(timestamp?: string) {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  const seconds = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
  if (seconds < 5) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Updated ${minutes} min${minutes === 1 ? "" : "s"} ago`;
}

function getMarkerServiceTime(timestamp?: string) {
  if (!timestamp) {
    return "--:--";
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "--:--";
  }

  return parsed.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getPublicServiceReference(destination: string, etaLabel?: string) {
  return `${etaLabel || "--:--"} ${getMarkerServiceCode(destination)} Service`;
}

function getTrainLabelPriority(vehicle: LiveTrain) {
    if (isVlineLiveTrain(vehicle)) {
      return "high";
    }
  
    const normalizedLine = vehicle.line.trim().toLowerCase();
    if (
      normalizedLine === "metro tunnel" ||
      normalizedLine === "v/line" ||
      normalizedLine === "traralgon" ||
      normalizedLine === "nsw trainlink" ||
      normalizedLine === "nsw trainlink xpt" ||
      normalizedLine === "nsw trainlink xplorer"
    ) {
      return "high";
    }

  return "normal";
}

function createLiveTrainIcon(
  vehicle: LiveTrain,
  options?: {
    expanded?: boolean;
    selected?: boolean;
    dimmed?: boolean;
    hideSecondaryLabel?: boolean;
    routeStops?: Station[];
  },
) {
  const markerLine = /HCMT/i.test(getVehicleDisplayType(vehicle)) ? "Metro Tunnel" : vehicle.line;
  const color = getLiveLineColor(markerLine);
  const heading = resolveVehicleHeading(
    vehicle.heading,
    inferVehicleHeading(
      [vehicle.lat, vehicle.lng],
      options?.routeStops ?? (isVlineLiveTrain(vehicle) ? getRegionalGtfsPatternStations(vehicle) : getMetroStoppingPatternStations(vehicle, true)),
      vehicle.destination,
    ),
  );
  const arrow = heading === undefined ? "•" : "▲";
  const rotation = heading ?? 0;
  const isTrackedConsist = vehicle.consist === "430M";
  const isExpanded = options?.expanded ?? false;
  const isSelected = options?.selected ?? false;
  const isDimmed = options?.dimmed ?? false;
  const hideSecondaryLabel = options?.hideSecondaryLabel ?? false;
  const outerSize = isTrackedConsist ? 70 : isSelected ? 62 : 50;
  const innerSize = isTrackedConsist ? 34 : isSelected ? 30 : 24;
  const markerOpacity = isDimmed ? 0.72 : 1;
  const labelOpacity = isDimmed ? 0.5 : isSelected ? 1 : 0.92;
  const destinationLabel = vehicle.destination
    .replace(/\bStreet\b/gi, "St")
    .replace(/\bStation\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 38);
  const originLabel = (vehicle.origin ?? "")
    .replace(/\bStreet\b/gi, "St")
    .replace(/\bStation\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Kept full ("Flinders Street", not "Flinders St") — used only in "via"
  // text, which should always spell the real station name out in full.
  const originLabelFull = (vehicle.origin ?? "")
    .replace(/\bStation\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const destinationLabelFull = vehicle.destination
    .replace(/\bStation\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const throughDestinationLabel = destinationLabel.split("→")[0]?.trim() || "";
  const throughDestinationLabelFull = destinationLabelFull.split("→")[0]?.trim() || "";
  const finalDestinationLabel = destinationLabel.split("→").at(-1)?.trim() || destinationLabel;
  const markerViaLabel = /HCMT/i.test(getVehicleDisplayType(vehicle))
    ? "Metro Tunnel"
    : /City Loop/i.test(destinationLabel)
      ? "City Loop"
      : destinationLabel.includes("→")
        // Kept full ("Flinders Street") — see originLabelFull above.
        ? throughDestinationLabelFull.replace(/\s+via\s+.+$/i, "").trim()
        : "";
  // The "via" clause must describe the real route taken (City Loop, Metro
  // Tunnel) — never the trip's origin station, which isn't something the
  // train is travelling "via" and reads as wrong (e.g. "Flinders St via
  // Frankston" for a train that started at Frankston and is now city-bound).
  // The one real exception is the Werribee/Williamstown/Altona/Sandringham
  // group: those genuinely run point-to-point between two outer termini via
  // Flinders Street, so which terminus this service actually came from is
  // the real, useful fact — "via Flinders Street" would just restate the
  // interchange every cross-city service already passes through.
  const finalDestinationAlreadyHasVia = /\bvia\b/i.test(finalDestinationLabel);
  const isCrossCity = isCrossCityLiveTrain(vehicle);
  const journeyLabel = originLabel && finalDestinationLabel
    ? finalDestinationAlreadyHasVia
      ? finalDestinationLabel
      : isCrossCity && originLabelFull && originLabelFull.toLowerCase() !== finalDestinationLabel.toLowerCase()
        ? `${finalDestinationLabel} via ${originLabelFull}`
        : markerViaLabel && markerViaLabel.toLowerCase() !== finalDestinationLabel.toLowerCase()
          ? `${finalDestinationLabel} via ${markerViaLabel}`
          : finalDestinationLabel
    : destinationLabel;
  const formation = getVehicleFormation(vehicle);
  const regionalCarLabel = isVlineLiveTrain(vehicle) ? getRegionalCarLengthLabel(vehicle) : "";
  // Sydney Trains' real fleet class name from the schedule lookup already
  // leads with its own car count ("8 car Tangara"), and its live feed has no
  // Melbourne-style motor-car numbering to parse a leading-car figure or
  // "M cars" from — showing both produced "CAR COUNT TBC · 8 CAR TANGARA ·
  // M CARS TBC", stacking two placeholders around the one real fact. Skip
  // the redundant car-count segment and use the real, shortened trip number
  // (e.g. "615L") as the identifying segment instead of "M cars".
  const isSydneyTrains = isSydneyTrainsLiveTrain(vehicle);
  const carLabel = isVlineLiveTrain(vehicle)
    ? regionalCarLabel.replace(/-/g, " ").toUpperCase()
    : isSydneyTrains
      ? ""
      : formation.cars > 0
        ? `${formation.cars} CAR`
        : "CAR COUNT TBC";
  const typeLabel = (isVlineLiveTrain(vehicle)
    ? getRegionalTrainFamilyLabel(vehicle)
    : formation.family ?? getVehicleDisplayType(vehicle).replace(/\s*\(\d+-car\)\s*$/i, "")
  ).trim() || "TYPE TBC";
  const consistLabel = formation.family === "HCMT"
    ? getHcmtSetLabel(vehicle.consist) ?? "SET TBC"
    : isVlineLiveTrain(vehicle)
      ? getRegionalAllocatedSetLabel(vehicle)
      : isSydneyTrains
        ? vehicle.tdn || "SET TBC"
        : getLeadingMotorCarriages(vehicle.consist) ?? "M CARS TBC";
  const vehicleSummaryLabel = escapeInlineMarkerHtml(
    [carLabel, typeLabel.toUpperCase(), consistLabel.toUpperCase()].filter(Boolean).join(" · "),
  );
  const regionalSpecialLabel = isVlineLiveTrain(vehicle) ? getRegionalSpecialTrainLabel(vehicle) : "";
  const badgePrimaryLabel = isVlineLiveTrain(vehicle)
    ? (isExpanded ? getRegionalRealtimeTripLabel(vehicle) : `${getMarkerServiceTime(vehicle.timestamp)} ${getRegionalRouteDisplayLabel(vehicle)}`)
    : /HCMT/i.test(getVehicleDisplayType(vehicle))
      ? `${getMarkerServiceTime(vehicle.timestamp)} ${journeyLabel || "Metro service"}`
    : isExpanded
      ? `${getMarkerServiceTime(vehicle.timestamp)} ${(journeyLabel || getMarkerServiceCode(markerLine)).toUpperCase()}`
      : `${getMarkerServiceTime(vehicle.timestamp)} ${(journeyLabel || getMarkerServiceCode(markerLine)).toUpperCase()}`;
  // The trailing element used to repeat the generic "V/Line" line name (or,
  // once the real destination resolved, the destination a second time —
  // already shown in badgePrimaryLabel above). The real train type (Sprinter,
  // VLocity, N Class) isn't shown anywhere else on this second line, so it's
  // the more useful fact to close with here.
  const badgeSecondaryLabel = isVlineLiveTrain(vehicle)
    ? [regionalSpecialLabel || `TDN ${vehicle.tdn}`, typeLabel].filter(Boolean).join(" · ")
    : `TDN ${vehicle.tdn}`;

  return L.divIcon({
    html: `
      <div style="position:relative;width:${outerSize}px;height:${outerSize}px;display:flex;align-items:center;justify-content:center;opacity:${markerOpacity};">
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:${isSelected ? "0.34" : isTrackedConsist ? "0.28" : "0.18"};animation:ping 2s infinite;"></div>
        ${
          isTrackedConsist
            ? `<div style="position:absolute;inset:8px;border-radius:9999px;border:1px solid rgba(255,255,255,0.22);"></div>`
            : ""
        }

        <div style="
          width:${innerSize}px;
          height:${innerSize}px;
          border-radius:9999px;
          background:${color};
          border:${isTrackedConsist || isSelected ? "3px" : "2px"} solid white;
          box-shadow:${isTrackedConsist || isSelected ? "0 10px 26px rgba(0,0,0,0.78)" : "0 4px 14px rgba(0,0,0,0.58)"};
          display:flex;
          align-items:center;
          justify-content:center;
          color:white;
          font-size:${isTrackedConsist ? "16px" : isSelected ? "14px" : "12px"};
          font-weight:700;
          transform: rotate(${rotation}deg);
        ">
          ${arrow}
        </div>

        <div style="
          position:absolute;
          top:${isTrackedConsist ? "-18px" : isExpanded ? "-16px" : "-14px"};
          left:50%;
          transform:translateX(-50%);
          background:linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.95));
          color:white;
          font-size:${isTrackedConsist ? "10px" : isExpanded ? "9px" : "8px"};
          font-weight:700;
          padding:${isTrackedConsist ? "5px 8px" : isExpanded ? "4px 7px" : "3px 6px"};
          border-radius:10px;
          border:1px solid ${isSelected ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.14)"};
          box-shadow:${isSelected ? "0 12px 30px rgba(0,0,0,0.52)" : "0 8px 20px rgba(0,0,0,0.38)"};
          white-space:nowrap;
          min-width:${isTrackedConsist ? "150px" : isExpanded ? "142px" : "110px"};
          max-width:${isTrackedConsist ? "190px" : isExpanded ? "180px" : "164px"};
          overflow:hidden;
          text-overflow:ellipsis;
          text-align:center;
          line-height:1.12;
          backdrop-filter: blur(10px);
          opacity:${labelOpacity};
        ">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${isTrackedConsist ? "9px" : isExpanded ? "8px" : "7px"};font-weight:800;letter-spacing:${isExpanded ? "0.03em" : "0.08em"};text-transform:uppercase;">
            ${escapeInlineMarkerHtml(badgePrimaryLabel)}
          </div>
          ${isExpanded && !hideSecondaryLabel
            ? `<div style="margin-top:3px;font-size:${isTrackedConsist ? "8px" : "7px"};font-weight:700;opacity:0.78;letter-spacing:0.08em;text-transform:uppercase;">${escapeInlineMarkerHtml(badgeSecondaryLabel)}</div>`
            : ""}
        </div>
        ${hideSecondaryLabel
          ? ""
          : `<div style="
              position:absolute;
              left:50%;
              bottom:${isTrackedConsist ? "-23px" : "-21px"};
              transform:translateX(-50%);
              background:rgba(15,23,42,0.95);
              color:white;
              font-size:${isTrackedConsist ? "9px" : "8px"};
              font-weight:700;
              padding:${isTrackedConsist ? "4px 9px" : isExpanded ? "3px 8px" : "2px 7px"};
              border-radius:9999px;
              border:1px solid ${isSelected ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.12)"};
              box-shadow:${isSelected ? "0 10px 24px rgba(0,0,0,0.42)" : "0 6px 14px rgba(0,0,0,0.3)"};
              white-space:nowrap;
              max-width:${isExpanded ? "310px" : "240px"};
              overflow:hidden;
              text-overflow:ellipsis;
              backdrop-filter: blur(8px);
              opacity:${labelOpacity};
            ">
              ${vehicleSummaryLabel}
            </div>`}
      </div>
    `,
    className: "live-train-marker bg-transparent border-none",
    iconSize: [outerSize, outerSize],
    iconAnchor: [outerSize / 2, outerSize / 2],
    popupAnchor: [0, -22],
  });
}

function getCompassDirection(heading?: number) {
  if (typeof heading !== "number" || !Number.isFinite(heading)) return "Direction TBC";
  return ["North", "North-east", "East", "South-east", "South", "South-west", "West", "North-west"][
    Math.round((((heading % 360) + 360) % 360) / 45) % 8
  ];
}

const LIVE_TRAIN_MAP_CACHE_KEY = "transitalert-live-trains-v3";
const LIVE_TRAIN_MAP_CACHE_MAX_AGE_MS = 90_000;

function readInitialLiveTrainMapCache(): LiveTrain[] {
  if (typeof window === "undefined") return [];
  try {
    const cached = JSON.parse(window.localStorage.getItem(LIVE_TRAIN_MAP_CACHE_KEY) ?? "null") as
      | { savedAt?: number; trains?: LiveTrain[] }
      | null;
    if (!cached?.savedAt || !Array.isArray(cached.trains)) return [];
    if (Date.now() - cached.savedAt > LIVE_TRAIN_MAP_CACHE_MAX_AGE_MS) return [];
    return cached.trains.filter((train) =>
      Number.isFinite(train.lat) && Number.isFinite(train.lng) &&
      train.lat >= -40 && train.lat <= -32 && train.lng >= 140 && train.lng <= 153,
    );
  } catch {
    return [];
  }
}

function saveLiveTrainMapCache(trains: LiveTrain[]) {
  if (typeof window === "undefined" || trains.length === 0) return;
  try {
    window.localStorage.setItem(LIVE_TRAIN_MAP_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), trains }));
  } catch {
    // Private browsing/storage pressure must never prevent the live map loading.
  }
}

function createLiveBusIcon(bus: LiveBus, options: { showLabel?: boolean; selected?: boolean } = {}) {
  const showLabel = options.showLabel ?? false;
  const selected = options.selected ?? false;
  const areaLabel = getLiveBusAreaLabel(bus);
  const routeLabel = escapeInlineMarkerHtml([areaLabel, bus.route.slice(0, 6)].filter(Boolean).join(" · "));
  const operatorLabel = (bus.operator ?? "Bus operator TBC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 36);
  const escapedOperatorLabel = escapeInlineMarkerHtml(operatorLabel);
  const vehicleLabel = bus.fleetNumber ?? bus.registration ?? bus.vehicleId;
  const escapedVehicleLabel = vehicleLabel
    ? escapeInlineMarkerHtml(vehicleLabel.replace(/\s+/g, " ").trim().slice(0, 18))
    : "";
  // An unknown bearing shows a dot, never a false north arrow (as for trains).
  const busHeading = validVehicleHeading(bus.heading);
  const rotation = busHeading ?? 0;
  const markerLabel = [
    escapedOperatorLabel,
    escapedVehicleLabel ? `Bus ${escapedVehicleLabel}` : "",
  ].filter(Boolean).join(" · ");

  return L.divIcon({
    html: `
      <div style="position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center;">
        ${selected ? '<div style="position:absolute;inset:2px;border-radius:50%;background:#f97316;opacity:0.18;animation:ping 2.2s infinite;"></div>' : ""}
        <div style="
          width:${selected ? "27px" : "23px"};
          height:${selected ? "27px" : "23px"};
          border-radius:9999px;
          background:#f97316;
          border:2px solid white;
          box-shadow:0 4px 14px rgba(0,0,0,0.55);
          display:flex;
          align-items:center;
          justify-content:center;
          transform:rotate(${rotation}deg);
        ">
          <span aria-hidden="true" style="display:block;color:white;font-size:15px;font-weight:900;line-height:1;transform:translateY(-1px);text-shadow:0 1px 3px rgba(0,0,0,.35);">${busHeading === undefined ? "•" : "▲"}</span>
        </div>
        <div style="
          position:absolute;
          top:-8px;
          left:50%;
          transform:translateX(-50%);
          background:#0f172a;
          color:white;
          font-size:8px;
          font-weight:700;
          padding:2px 6px;
          border-radius:6px;
          border:1px solid rgba(255,255,255,0.15);
          box-shadow:0 4px 10px rgba(0,0,0,0.4);
          white-space:nowrap;
        ">
          ${routeLabel}
        </div>
        ${showLabel ? `<div style="
          position:absolute;
          left:50%;
          bottom:-18px;
          transform:translateX(-50%);
          background:rgba(15,23,42,0.92);
          color:white;
          font-size:9px;
          font-weight:700;
          padding:2px 6px;
          border-radius:9999px;
          border:1px solid rgba(255,255,255,0.14);
          box-shadow:0 4px 10px rgba(0,0,0,0.35);
          white-space:nowrap;
          max-width:190px;
          overflow:hidden;
          text-overflow:ellipsis;
        ">
          ${markerLabel || "Bus operator TBC"}
        </div>` : ""}
      </div>
    `,
    className: `live-bus-marker ${showLabel ? "live-bus-marker--labelled" : "live-bus-marker--compact"} bg-transparent border-none`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -22],
  });
}

// =========================
// Constants
// =========================
const TRANSPORT_EMOJI: Record<string, string> = {
  tram: "🚃",
  train: "🚆",
  bus: "🚌",
  stop: "🚏",
};

const APP_VERSION = "0.95"; const GUEST_PREVIEW_VERSION = APP_VERSION; const MAX_VISIBLE_BUS_STOPS = 28; const REPORT_COLOR: Record<string, string> = {
  inspector: "#e11d48",
  delay: "#f59e0b",
  incident: "#3b82f6",
};

const REPORT_LABEL: Record<string, string> = {
  inspector: "Inspector",
  delay: "Delay",
  incident: "Incident",
};

const DIRECTION_LABEL: Record<string, string> = {
  city_bound: "City Bound 🏙️",
  outbound: "Outbound 🏠",
  unknown: "",
};

export const SERVICE_FILTERS: Array<{
  key: ServiceFilterKey;
  category: "regional" | "metro" | "special";
  label: string;
  description?: string;
  tone: string;
}> = [
  {
    key: "metroTunnelServices",
    category: "special",
    label: "Pakenham, Cranbourne and Sunbury",
    description: "Metro Tunnel services",
    tone: "bg-[#279FD5]/15 border-[#279FD5]/40 text-[#b8e7fb]",
  },
  {
    key: "geelongRegionalGroup",
    category: "regional",
    label: "Geelong Line - Warrnambool",
    description: "Geelong, Waurn Ponds, Warrnambool corridor",
    tone: "bg-purple-500/15 border-purple-400/30 text-purple-200",
  },
  {
    key: "ballaratRegionalGroup",
    category: "regional",
    label: "Ballarat Line - Ararat, Maryborough",
    description: "Ballarat regional corridor",
    tone: "bg-purple-500/15 border-purple-400/30 text-purple-200",
  },
  {
    key: "bendigoRegionalGroup",
    category: "regional",
    label: "Bendigo Line - Swan Hill, Echuca",
    description: "Bendigo regional corridor",
    tone: "bg-purple-500/15 border-purple-400/30 text-purple-200",
  },
  {
    key: "seymourRegionalGroup",
    category: "regional",
    label: "Seymour Line - Shepparton, Albury",
    description: "Seymour regional corridor",
    tone: "bg-purple-500/15 border-purple-400/30 text-purple-200",
  },
  {
    key: "traralgonRegionalGroup",
    category: "regional",
    label: "Traralgon Line - Bairnsdale",
    description: "Gippsland regional corridor",
    tone: "bg-purple-500/15 border-purple-400/30 text-purple-200",
  },
  {
    key: "crossCityPink",
    category: "metro",
    label: "Cross-City: Werribee / Williamstown ↔ Sandringham",
    description: "Through services via Southern Cross and Flinders Street",
    tone: "bg-pink-500/15 border-pink-400/30 text-pink-200",
  },
  {
    key: "werribeeWilliamstownGroup",
    category: "metro",
    label: "Werribee / Williamstown",
    description: "Werribee, Laverton, Williamstown",
    tone: "bg-pink-500/15 border-pink-400/30 text-pink-200",
  },
  {
    key: "sandringhamGroup",
    category: "metro",
    label: "Sandringham",
    description: "Cross-City services to Werribee, Laverton and Williamstown",
    tone: "bg-pink-500/15 border-pink-400/30 text-pink-200",
  },
  {
    key: "burnleyGroup",
    category: "metro",
    label: "Belgrave, Lilydale, Glen Waverley, Alamein",
    description: "Burnley group",
    tone: "bg-[linear-gradient(135deg,rgba(21,44,107,0.62),rgba(2,6,23,0.88))] border-[#4DA3FF]/45 text-[#DBEAFF] shadow-[0_0_18px_rgba(77,163,255,0.14)]",
  },
  {
    key: "cliftonHillGroup",
    category: "metro",
    label: "Mernda and Hurstbridge Lines",
    description: "Clifton Hill group",
    tone: "bg-[#BE1014]/15 border-[#BE1014]/40 text-[#f6b1b3]",
  },
  {
    key: "caulfieldGroup",
    category: "metro",
    label: "Frankston",
    description: "Frankston line",
    tone: "bg-emerald-500/15 border-emerald-400/30 text-emerald-200",
  },
  {
    key: "upfieldCraigieburn",
    category: "metro",
    label: "Upfield / Craigieburn",
    description: "Upfield, Craigieburn",
    tone: "bg-yellow-500/15 border-yellow-400/30 text-yellow-200",
  },
  {
    key: "upfieldCraigieburnCityLoop",
    category: "metro",
    label: "Via City Loop",
    tone: "bg-slate-400/15 border-slate-300/30 text-slate-100",
  },
];

const SURFACE_ROUTE_FILTERS: SurfaceRouteFilter[] = [
  {
    key: "tram:1",
    mode: "tram",
    route: "1",
    label: "Tram 1",
    description: "East Coburg - South Melbourne Beach",
    tone: "bg-[#84cc16]/15 border-[#84cc16]/40 text-[#d9f99d]",
  },
  {
    key: "tram:3",
    mode: "tram",
    route: "3",
    label: "Tram 3",
    description: "Melbourne University - East Malvern",
    tone: "bg-[#7dd3fc]/15 border-[#7dd3fc]/40 text-[#d7f3ff]",
  },
  {
    key: "tram:5",
    mode: "tram",
    route: "5",
    label: "Tram 5",
    description: "Melbourne University - Malvern",
    tone: "bg-red-500/15 border-red-400/40 text-red-200",
  },
  {
    key: "tram:6",
    mode: "tram",
    route: "6",
    label: "Tram 6",
    description: "Moreland - Glen Iris",
    tone: "bg-[#166534]/15 border-[#166534]/40 text-[#bbf7d0]",
  },
  {
    key: "tram:11",
    mode: "tram",
    route: "11",
    label: "Tram 11",
    description: "West Preston - Docklands",
    tone: "bg-[#0f766e]/15 border-[#0f766e]/40 text-[#99f6e4]",
  },
  {
    key: "tram:16",
    mode: "tram",
    route: "16",
    label: "Tram 16",
    description: "Melbourne University - Kew",
    tone: "bg-[#d4a017]/15 border-[#d4a017]/40 text-[#fde68a]",
  },
  {
    key: "tram:64",
    mode: "tram",
    route: "64",
    label: "Tram 64",
    description: "Melbourne University - East Brighton",
    tone: "bg-[#38bdf8]/15 border-[#38bdf8]/40 text-[#dbeafe]",
  },
  {
    key: "tram:67",
    mode: "tram",
    route: "67",
    label: "Tram 67",
    description: "Melbourne University - Carnegie",
    tone: "bg-[#8b5e3c]/15 border-[#8b5e3c]/40 text-[#e7d3c6]",
  },
  {
    key: "tram:96",
    mode: "tram",
    route: "96",
    label: "Tram 96",
    description: "East Brunswick - St Kilda Beach",
    tone: "bg-[#d946ef]/15 border-[#d946ef]/40 text-[#f5d0fe]",
  },
  {
    key: "bus:630",
    mode: "bus",
    route: "630",
    label: "Bus 630",
    description: "Monash University - Elwood",
    tone: "bg-orange-500/15 border-orange-400/40 text-orange-200",
  },
];

// =========================
// Station Data
// =========================
const MERNDA_STATIONS: Station[] = [
  { name: "Flinders Street", position: [-37.8184161, 144.9664779] },
  { name: "Jolimont", position: [-37.816492790989656, 144.983959764190870] },
  { name: "West Richmond", position: [-37.814925027573054, 144.991454748502189] },
  { name: "North Richmond", position: [-37.8103479913108, 144.99248203456145] },
  { name: "Collingwood", position: [-37.80446558539445, 144.99373364780257] },
  { name: "Victoria Park", position: [-37.79910783339788, 144.9944465452046] },
  { name: "Clifton Hill", position: [-37.78831003762462, 144.9955664605472] },
  { name: "Rushall", position: [-37.78282063669237, 144.99170449547316] },
  { name: "Merri", position: [-37.777750539846984, 144.9930158084578] },
  { name: "Northcote", position: [-37.76992048990079, 144.99530821413396] },
  { name: "Croxton", position: [-37.76411084888179, 144.99711065861806] },
  { name: "Thornbury", position: [-37.75506489378074, 144.99849818692718] },
  { name: "Bell", position: [-37.745589224974715, 145.00035427556313] },
  { name: "Preston", position: [-37.73875587823244, 145.00073179107602] },
  { name: "Regent", position: [-37.72833894198504, 145.00280413393259] },
  { name: "Reservoir", position: [-37.71684669179448, 145.0068228311183] },
  { name: "Ruthven", position: [-37.70788599148591, 145.00942830349587] },
  { name: "Keon Park", position: [-37.69472251099498, 145.01181442718885] },
  { name: "Thomastown", position: [-37.68021126137258, 145.01421277845355] },
  { name: "Lalor", position: [-37.66589866750707, 145.01723865896338] },
  { name: "Epping", position: [-37.652168089301284, 145.03102996205098] },
  { name: "South Morang", position: [-37.64891049184418, 145.06792353651812] },
  { name: "Middle Gorge", position: [-37.64387601247085, 145.09247381096623] },
  { name: "Hawkstowe", position: [-37.62273956095706, 145.0973495770265] },
  { name: "Mernda", position: [-37.60268052005695, 145.10077971801257] },
];

const HURSTBRIDGE_STATIONS: Station[] = [
  { name: "Westgarth", position: [-37.780435356377716, 144.99914123026358] },
  { name: "Dennis", position: [-37.779172853272264, 145.00829366121818] },
  { name: "Fairfield", position: [-37.779149281616895, 145.0169411256442] },
  { name: "Alphington", position: [-37.77831232032454, 145.03110400902273] },
  { name: "Darebin", position: [-37.77471056691468, 145.03864348039912] },
  { name: "Ivanhoe", position: [-37.76889144629401, 145.04539541149356] },
  { name: "Eaglemont", position: [-37.763774817116406, 145.05361850109273] },
  { name: "Heidelberg", position: [-37.75712552748012, 145.06075329719897] },
  { name: "Rosanna", position: [-37.742727897658824, 145.06624322896707] },
  { name: "Macleod", position: [-37.725937461490375, 145.06921622194628] },
  { name: "Watsonia", position: [-37.710982647475866, 145.0837557852137] },
  { name: "Greensborough", position: [-37.70381979075029, 145.10791799219962] },
  { name: "Montmorency", position: [-37.71524351441112, 145.1209352506941] },
  { name: "Eltham", position: [-37.71344678805767, 145.1478333806195] },
  { name: "Diamond Creek", position: [-37.67339874337512, 145.15845112766686] },
  { name: "Wattle Glen", position: [-37.66398633478114, 145.18168038197572] },
  { name: "Hurstbridge", position: [-37.63940767064736, 145.19213890280744] },
];

const CLIFTONHILLGROUPLOOP_STATIONS: Station[] = [
  { name: "Jolimont", position: [-37.816492790989656, 144.983959764190870] },
  { name: "Flinders Street", position: [-37.8184161, 144.9664779] },
  { name: "Southern Cross", position: [-37.8176, 144.9522] },
  { name: "Flagstaff", position: [-37.81196029877101, 144.9566610145156] },
  { name: "Melbourne Central", position: [-37.8101, 144.9626] },
  { name: "Parliament", position: [-37.81123787494798, 144.97303582934072] },
  { name: "Jolimont", position: [-37.816492790989656, 144.983959764190870] },
];
const FRANKSTON_STATIONS: Station[] = [
  { name: "Frankston", position: [-38.1426676, 145.1262003] },
  { name: "Kananook", position: [-38.121688, 145.1354187] },
  { name: "Seaford", position: [-38.1040134, 145.1282259] },
  { name: "Carrum", position: [-38.0774817, 145.1230629] },
  { name: "Bonbeach", position: [-38.065449, 145.120108] },
  { name: "Chelsea", position: [-38.0532764, 145.1166366] },
  { name: "Edithvale", position: [-38.0365046, 145.1075721] },
  { name: "Aspendale", position: [-38.0272365, 145.1021263] },
  { name: "Mordialloc", position: [-38.0067174, 145.0875658] },
  { name: "Parkdale", position: [-37.9924751, 145.0755901] },
  { name: "Mentone", position: [-37.9835507, 145.066334] },
  { name: "Cheltenham", position: [-37.9670081, 145.0546951] },
  { name: "Southland", position: [-37.9584027, 145.0488064] },
  { name: "Highett", position: [-37.9484438, 145.04188] },
  { name: "Moorabbin", position: [-37.9343919, 145.0368952] },
  { name: "Patterson", position: [-37.9251159, 145.0354959] },
  { name: "Bentleigh", position: [-37.9175354, 145.0369346] },
  { name: "McKinnon", position: [-37.9114018, 145.0381036] },
  { name: "Ormond", position: [-37.9035567870837, 145.03952610631947] },
  { name: "Glen Huntly", position: [-37.889427520343936, 145.04216178464085] },
  { name: "Caulfield", position: [-37.8773212, 145.0423811] },
  { name: "Malvern", position: [-37.8663425, 145.029464] },
  { name: "Armadale", position: [-37.8562948, 145.0192436] },
  { name: "Toorak", position: [-37.8506631, 145.0136792] },
  { name: "Hawksburn", position: [-37.8446738, 145.0019694] },
  { name: "South Yarra", position: [-37.8381009, 144.99237] },
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
];
// Real coordinates (source: Transport Victoria GTFS stops.txt) for the
// Stony Point branch, which had no dedicated station list or track polyline
// at all before this — its trains only ever inherited the Frankston layer
// toggle with nothing drawn under them south of Frankston.
const STONY_POINT_STATIONS: Station[] = [
  { name: "Frankston", position: [-38.1426676, 145.1262003] },
  { name: "Leawarra", position: [-38.152034, 145.1395396] },
  { name: "Baxter", position: [-38.1940431, 145.1605261] },
  { name: "Somerville", position: [-38.225342, 145.1762449] },
  { name: "Tyabb", position: [-38.259815, 145.1864007] },
  { name: "Hastings", position: [-38.3056585, 145.1859799] },
  { name: "Bittern", position: [-38.3373903, 145.1780265] },
  { name: "Crib Point", position: [-38.3661234, 145.2040433] },
  { name: "Morradoo", position: [-38.3540333, 145.1896025] },
  { name: "Stony Point", position: [-38.3742345, 145.2218375] },
];
// Real GTFS shape points (route "Stony Point", shape 2-STY-vpt-65.1.R),
// Stony Point to Frankston end to end — this line previously had no track
// polyline at all, just floating station/train markers with nothing drawn
// underneath them south of Frankston.
const STONY_POINT_TRACK: [number, number][] = [
  [-38.37402291, 145.22133577],
  [-38.37401674, 145.22111969],
  [-38.37400963, 145.22102497],
  [-38.37399546, 145.22089264],
  [-38.37398136, 145.22078917],
  [-38.3739528, 145.22061759],
  [-38.3739176, 145.22042969],
  [-38.37386868, 145.22023457],
  [-38.37380721, 145.22003805],
  [-38.37375903, 145.21989751],
  [-38.37370012, 145.21975061],
  [-38.37361154, 145.21956139],
  [-38.37351318, 145.21937435],
  [-38.37304981, 145.21856154],
  [-38.3728463, 145.218215],
  [-38.37273887, 145.21804845],
  [-38.37051174, 145.21485745],
  [-38.37027036, 145.2144813],
  [-38.36997666, 145.21399496],
  [-38.36980342, 145.2136841],
  [-38.36963548, 145.21334347],
  [-38.36945528, 145.21294339],
  [-38.36928943, 145.21252705],
  [-38.36913716, 145.21209103],
  [-38.36808321, 145.20889297],
  [-38.36770983, 145.20768753],
  [-38.36754724, 145.2072321],
  [-38.36736731, 145.20681567],
  [-38.36699206, 145.2060314],
  [-38.36595039, 145.20398625],
  [-38.36514956, 145.20240504],
  [-38.36484252, 145.20181038],
  [-38.36465976, 145.20147462],
  [-38.364503, 145.20120095],
  [-38.364284, 145.20087068],
  [-38.36397651, 145.20045825],
  [-38.36376619, 145.20020605],
  [-38.36285029, 145.19918563],
  [-38.35984796, 145.19594324],
  [-38.35383242, 145.18940036],
  [-38.35362561, 145.1891787],
  [-38.35351622, 145.18905096],
  [-38.35137121, 145.18672224],
  [-38.35050076, 145.18578741],
  [-38.34464614, 145.17943611],
  [-38.34398026, 145.17869703],
  [-38.3428581, 145.17750359],
  [-38.3427088, 145.17735412],
  [-38.34254797, 145.17720506],
  [-38.34235273, 145.17704462],
  [-38.34216089, 145.17690641],
  [-38.34195119, 145.17677837],
  [-38.34172873, 145.17666472],
  [-38.34156138, 145.17659455],
  [-38.3412972, 145.17650346],
  [-38.34108327, 145.17645138],
  [-38.34087698, 145.17641537],
  [-38.34067196, 145.1763974],
  [-38.34036704, 145.17639303],
  [-38.34020734, 145.17640298],
  [-38.34004773, 145.17641946],
  [-38.33985981, 145.17645758],
  [-38.33961352, 145.17652657],
  [-38.33936176, 145.17661995],
  [-38.33911166, 145.17673949],
  [-38.33878511, 145.17692639],
  [-38.33783747, 145.17760985],
  [-38.3371276, 145.17811686],
  [-38.33645908, 145.17859983],
  [-38.33584078, 145.17903885],
  [-38.33312467, 145.18098297],
  [-38.3311113, 145.18241998],
  [-38.33087294, 145.18257626],
  [-38.33057024, 145.18275622],
  [-38.33031869, 145.18288137],
  [-38.33009007, 145.18297997],
  [-38.32983623, 145.18307383],
  [-38.32957722, 145.18315329],
  [-38.3293075, 145.18322271],
  [-38.32898696, 145.18327407],
  [-38.32814017, 145.18330952],
  [-38.32298786, 145.18329323],
  [-38.32160859, 145.18329335],
  [-38.32115731, 145.1832997],
  [-38.32078557, 145.18332751],
  [-38.32047969, 145.18336626],
  [-38.32019897, 145.18342336],
  [-38.31989254, 145.18349564],
  [-38.31960526, 145.18358322],
  [-38.31930522, 145.18369023],
  [-38.31897353, 145.18383153],
  [-38.31868467, 145.18397405],
  [-38.31829127, 145.18417386],
  [-38.31721574, 145.1847313],
  [-38.31616336, 145.18528163],
  [-38.31573158, 145.18550045],
  [-38.31546766, 145.18561786],
  [-38.31521397, 145.18571557],
  [-38.31501724, 145.18577892],
  [-38.31480368, 145.18583811],
  [-38.31460466, 145.18588139],
  [-38.31438787, 145.1859179],
  [-38.31416327, 145.18594443],
  [-38.31392461, 145.1859593],
  [-38.31362014, 145.18596677],
  [-38.30772342, 145.18595234],
  [-38.307032, 145.18594212],
  [-38.30560368, 145.18594694],
  [-38.30494381, 145.18594325],
  [-38.3030398, 145.18594334],
  [-38.295921, 145.18592695],
  [-38.2957258, 145.18593182],
  [-38.2953615, 145.18595713],
  [-38.29499832, 145.18600253],
  [-38.2945408, 145.18608905],
  [-38.29400953, 145.18620245],
  [-38.29342219, 145.18633199],
  [-38.29114419, 145.18682079],
  [-38.28685726, 145.18775798],
  [-38.28629458, 145.18785624],
  [-38.28595407, 145.18791101],
  [-38.28561767, 145.18795162],
  [-38.28513224, 145.18800508],
  [-38.28190418, 145.18834944],
  [-38.28126701, 145.18841524],
  [-38.28111788, 145.18843335],
  [-38.2774769, 145.18882359],
  [-38.27401919, 145.18918969],
  [-38.27328564, 145.18926975],
  [-38.27294318, 145.18930352],
  [-38.27271228, 145.18932469],
  [-38.27248896, 145.18934155],
  [-38.27225561, 145.18935615],
  [-38.27208298, 145.18936352],
  [-38.27109982, 145.1893748],
  [-38.26565334, 145.18937026],
  [-38.26537843, 145.18936074],
  [-38.26522084, 145.18935003],
  [-38.26504691, 145.18933229],
  [-38.26486689, 145.18930498],
  [-38.26464753, 145.1892622],
  [-38.26445357, 145.18921363],
  [-38.26424671, 145.18915191],
  [-38.26405637, 145.18908646],
  [-38.26381386, 145.18898676],
  [-38.26355284, 145.18886123],
  [-38.26338297, 145.18876749],
  [-38.26316084, 145.188633],
  [-38.26273151, 145.18833987],
  [-38.26129182, 145.18730552],
  [-38.2597597, 145.18620974],
  [-38.25803753, 145.18497541],
  [-38.25772227, 145.18474531],
  [-38.25509273, 145.18285927],
  [-38.2546375, 145.1825297],
  [-38.25390068, 145.18200306],
  [-38.25356896, 145.18177591],
  [-38.25341228, 145.18167296],
  [-38.25324932, 145.18157235],
  [-38.25306623, 145.18146915],
  [-38.25288426, 145.18137437],
  [-38.25269812, 145.18128336],
  [-38.25252198, 145.18120445],
  [-38.25235231, 145.18113542],
  [-38.25217984, 145.18107219],
  [-38.25198722, 145.18100545],
  [-38.25178732, 145.18094575],
  [-38.25156852, 145.18088722],
  [-38.25140437, 145.18084868],
  [-38.25116828, 145.18080326],
  [-38.250973, 145.18077385],
  [-38.25074298, 145.18074781],
  [-38.25056661, 145.18073496],
  [-38.25039291, 145.18072626],
  [-38.25019286, 145.18072028],
  [-38.24380909, 145.18071068],
  [-38.23707336, 145.18070308],
  [-38.23381776, 145.18070173],
  [-38.2335736, 145.18069891],
  [-38.233334, 145.18068843],
  [-38.23314906, 145.1806751],
  [-38.23294526, 145.18065436],
  [-38.23273612, 145.18062598],
  [-38.23252936, 145.18058909],
  [-38.23234754, 145.18055044],
  [-38.23212481, 145.18049418],
  [-38.23192603, 145.18043744],
  [-38.23175524, 145.18038309],
  [-38.23159152, 145.18032674],
  [-38.23141738, 145.18026002],
  [-38.2311527, 145.18014323],
  [-38.23099368, 145.18006368],
  [-38.23080367, 145.17996171],
  [-38.23064548, 145.17987255],
  [-38.23047788, 145.17977425],
  [-38.23024058, 145.17962183],
  [-38.22992411, 145.1794074],
  [-38.22960337, 145.17918554],
  [-38.22876823, 145.17860135],
  [-38.22798337, 145.17805876],
  [-38.2254352, 145.17628383],
  [-38.20665972, 145.16320974],
  [-38.2061626, 145.16286717],
  [-38.20603103, 145.16278049],
  [-38.2058602, 145.1626732],
  [-38.20565501, 145.16255239],
  [-38.20545626, 145.1624457],
  [-38.20142907, 145.16042928],
  [-38.2009009, 145.16017581],
  [-38.20065427, 145.16007307],
  [-38.20053939, 145.16002834],
  [-38.20035913, 145.15996311],
  [-38.20014803, 145.15989694],
  [-38.1999697, 145.15984536],
  [-38.19978, 145.15979909],
  [-38.19961662, 145.15976415],
  [-38.19927752, 145.15970725],
  [-38.19911888, 145.15968703],
  [-38.19895436, 145.15967176],
  [-38.19871949, 145.15965884],
  [-38.19853837, 145.15965335],
  [-38.19837338, 145.1596543],
  [-38.19820488, 145.15966072],
  [-38.19801997, 145.15967245],
  [-38.197858, 145.15968795],
  [-38.19768783, 145.15970891],
  [-38.1975159, 145.15973779],
  [-38.19731708, 145.15977671],
  [-38.1970551, 145.1598332],
  [-38.19656207, 145.15995318],
  [-38.19570502, 145.16016785],
  [-38.1950906, 145.16031634],
  [-38.19481862, 145.16039044],
  [-38.19400037, 145.16058562],
  [-38.19305112, 145.16082829],
  [-38.19276924, 145.16089156],
  [-38.18595169, 145.16257846],
  [-38.18466159, 145.1629003],
  [-38.17316922, 145.16574254],
  [-38.16794692, 145.16703957],
  [-38.16688943, 145.16729983],
  [-38.16658768, 145.16736046],
  [-38.16639499, 145.16738812],
  [-38.16623675, 145.16740007],
  [-38.16607373, 145.16740541],
  [-38.16589718, 145.16740469],
  [-38.16572719, 145.16739115],
  [-38.16553554, 145.16736935],
  [-38.16539824, 145.16734266],
  [-38.16524343, 145.16730864],
  [-38.1650704, 145.16726218],
  [-38.16492284, 145.1672136],
  [-38.1647751, 145.16715886],
  [-38.16463037, 145.16709502],
  [-38.16450728, 145.1670375],
  [-38.16431917, 145.16693743],
  [-38.1641542, 145.1668353],
  [-38.16398938, 145.16672586],
  [-38.16385733, 145.16662587],
  [-38.16370792, 145.16650474],
  [-38.16354416, 145.16635921],
  [-38.16340062, 145.16621546],
  [-38.16327132, 145.16607808],
  [-38.163087, 145.1658567],
  [-38.16296831, 145.16570046],
  [-38.16286294, 145.16554924],
  [-38.16276756, 145.16540222],
  [-38.16269022, 145.16527427],
  [-38.16260836, 145.16512806],
  [-38.16247049, 145.16485702],
  [-38.16241207, 145.16472882],
  [-38.16234568, 145.16457492],
  [-38.16228643, 145.16442791],
  [-38.16222957, 145.16427229],
  [-38.16216946, 145.1640938],
  [-38.16211714, 145.16391695],
  [-38.16206923, 145.16374044],
  [-38.16201076, 145.16349971],
  [-38.16195614, 145.16325112],
  [-38.16188226, 145.16290109],
  [-38.16105482, 145.15888515],
  [-38.16035238, 145.15546431],
  [-38.16029284, 145.15520194],
  [-38.16023526, 145.15497284],
  [-38.16016413, 145.15471875],
  [-38.16010256, 145.1545168],
  [-38.16002367, 145.15429098],
  [-38.15994326, 145.15407695],
  [-38.15986621, 145.15388795],
  [-38.15978117, 145.15369493],
  [-38.15969398, 145.15350813],
  [-38.15961118, 145.15334883],
  [-38.15949907, 145.15314189],
  [-38.1593897, 145.15295473],
  [-38.15928098, 145.15278068],
  [-38.1590725, 145.15246854],
  [-38.15444553, 145.14592902],
  [-38.15416228, 145.14552239],
  [-38.15403681, 145.14533258],
  [-38.15393052, 145.14516397],
  [-38.15374649, 145.14484989],
  [-38.15359821, 145.14457313],
  [-38.15346332, 145.14430585],
  [-38.15339863, 145.14416986],
  [-38.15330521, 145.1439611],
  [-38.15324818, 145.14383062],
  [-38.15312537, 145.14351865],
  [-38.15305718, 145.14333219],
  [-38.15297957, 145.14310865],
  [-38.15291583, 145.14291284],
  [-38.15286069, 145.14273119],
  [-38.15276918, 145.14240381],
  [-38.15201976, 145.13957929],
  [-38.15058532, 145.13415097],
  [-38.15010697, 145.13235326],
  [-38.14922521, 145.12899815],
  [-38.14894477, 145.1279801],
  [-38.14877072, 145.12752022],
  [-38.14859344, 145.12717385],
  [-38.1483887, 145.12682373],
  [-38.1480556, 145.12639212],
  [-38.14764957, 145.12599912],
  [-38.14734593, 145.12576451],
  [-38.14705998, 145.12558891],
  [-38.14696729, 145.12553502],
  [-38.14685674, 145.12547954],
  [-38.14667441, 145.12540456],
  [-38.14648826, 145.12534987],
  [-38.14631118, 145.12530465],
  [-38.14601804, 145.12524837],
  [-38.14583399, 145.12521805],
  [-38.14572574, 145.12521078],
  [-38.14563524, 145.12520945],
  [-38.14552371, 145.12521127],
  [-38.14542521, 145.12521676],
  [-38.14510221, 145.1252717],
  [-38.14478131, 145.12536185],
  [-38.14443108, 145.12550615],
  [-38.14422783, 145.12559385],
  [-38.1439593, 145.12567375],
  [-38.14378216, 145.12574344],
  [-38.14355716, 145.12584596],
  [-38.14264358, 145.12624714],
];
const CRAIGIEBURN_STATIONS: Station[] = [
  { name: "Craigieburn", position: [-37.6020, 144.9437] },
  { name: "Roxburgh Park", position: [-37.6258, 144.9308] },
  { name: "Coolaroo", position: [-37.6493, 144.9270] },
  { name: "Broadmeadows", position: [-37.6800, 144.9198] },
  { name: "Jacana", position: [-37.6884, 144.9078] },
  { name: "Glenroy", position: [-37.7089, 144.9190] },
  { name: "Oak Park", position: [-37.7184, 144.9198] },
  { name: "Pascoe Vale", position: [-37.7305, 144.9280] },
  { name: "Strathmore", position: [-37.7428, 144.9200] },
  { name: "Essendon", position: [-37.7560, 144.9162] },
  { name: "Moonee Ponds", position: [-37.7668, 144.9240] },
  { name: "Ascot Vale", position: [-37.7753, 144.9220] },
  { name: "Newmarket", position: [-37.7872, 144.9288] },
  { name: "Kensington", position: [-37.7947, 144.9306] },
  { name: "North Melbourne", position: [-37.8073, 144.9426] },
];
const CRAIGIEBURN_LINE_STATION_NAMES = new Set(CRAIGIEBURN_STATIONS.map((station) => station.name));

const UPFIELD_STATIONS: Station[] = [
  { name: "Upfield", position: [-37.66596335944676, 144.9467666568411] },
  { name: "Gowrie", position: [-37.700488788558154, 144.9587638475899] },
  { name: "Fawkner", position: [-37.714619680600784, 144.96043443278583] },
  { name: "Merlynston", position: [-37.720838587789075, 144.96132813911086] },
  { name: "Batman", position: [-37.733495074613145, 144.9628250960023] },
  { name: "Coburg", position: [-37.7424037808555, 144.96335891081486] },
  { name: "Moreland", position: [-37.75444459188999, 144.9620055682174] },
  { name: "Anstey", position: [-37.76069196371862, 144.96087713383022] },
  { name: "Brunswick", position: [-37.76758492900192, 144.9596657557033] },
  { name: "Jewell", position: [-37.77484767387166, 144.95885347284442] },
  { name: "Royal Park", position: [-37.781197766101826, 144.95165987191965] },
  { name: "Flemington Bridge", position: [-37.788102966652666, 144.93926769062355] },
  { name: "Macaulay", position: [-37.79496835285672, 144.9361473868707] },
  { name: "North Melbourne", position: [-37.80632077425195, 144.94148671559594] },
];
const LILYDALE_STATIONS: Station[] = [
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
  { name: "East Richmond", position: [-37.82632740224405, 144.9972673053531] },
  { name: "Burnley", position: [-37.8270, 145.0074] },
  { name: "Hawthorn", position: [-37.8226, 145.0226] },
  { name: "Glenferrie", position: [-37.8210, 145.0368] },
  { name: "Auburn", position: [-37.8201, 145.0457] },
  { name: "Camberwell", position: [-37.8260, 145.0587] },
  { name: "East Camberwell", position: [-37.8268, 145.0697] },
  { name: "Canterbury", position: [-37.8249, 145.0812] },
  { name: "Chatham", position: [-37.8243, 145.1030] },
  { name: "Union", position: [-37.8184, 145.1106] },
  { name: "Box Hill", position: [-37.8189, 145.1254] },
  { name: "Laburnum", position: [-37.8209, 145.1400] },
  { name: "Blackburn", position: [-37.8200, 145.1509] },
  { name: "Nunawading", position: [-37.8204, 145.1738] },
  { name: "Mitcham", position: [-37.8230, 145.1888] },
  { name: "Heatherdale", position: [-37.8184, 145.2130] },
  { name: "Ringwood", position: [-37.8158, 145.2289] },
  { name: "Croydon", position: [-37.7951, 145.2817] },
  { name: "Mooroolbark", position: [-37.7848, 145.3126] },
  { name: "Lilydale", position: [-37.7578, 145.3451] },
];

const BELGRAVE_STATIONS: Station[] = [
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
  { name: "East Richmond", position: [-37.82632740224405, 144.9972673053531] },
  { name: "Burnley", position: [-37.8270, 145.0074] },
  { name: "Hawthorn", position: [-37.8226, 145.0226] },
  { name: "Glenferrie", position: [-37.8210, 145.0368] },
  { name: "Auburn", position: [-37.8201, 145.0457] },
  { name: "Camberwell", position: [-37.8260, 145.0587] },
  { name: "East Camberwell", position: [-37.8268, 145.0697] },
  { name: "Canterbury", position: [-37.8249, 145.0812] },
  { name: "Chatham", position: [-37.8243, 145.1030] },
  { name: "Union", position: [-37.8184, 145.1106] },
  { name: "Box Hill", position: [-37.8189, 145.1254] },
  { name: "Laburnum", position: [-37.8209, 145.1400] },
  { name: "Blackburn", position: [-37.8200, 145.1509] },
  { name: "Nunawading", position: [-37.8204, 145.1738] },
  { name: "Mitcham", position: [-37.8230, 145.1888] },
  { name: "Heatherdale", position: [-37.8184, 145.2130] },
  { name: "Ringwood", position: [-37.8158, 145.2289] },
  { name: "Heathmont", position: [-37.8290, 145.2446] },
  { name: "Bayswater", position: [-37.8415, 145.2682] },
  { name: "Boronia", position: [-37.8600, 145.2847] },
  { name: "Ferntree Gully", position: [-37.8858, 145.2953] },
  { name: "Upper Ferntree Gully", position: [-37.8927, 145.3095] },
  { name: "Upwey", position: [-37.9035, 145.3303] },
  { name: "Tecoma", position: [-37.9082, 145.3446] },
  { name: "Belgrave", position: [-37.9109, 145.3536] },
];

const ALAMEIN_STATIONS: Station[] = [
  { name: "Camberwell", position: [-37.8260, 145.0587] },
  { name: "Riversdale", position: [-37.8316, 145.0706] },
  { name: "Willison", position: [-37.8355, 145.0817] },
  { name: "Hartwell", position: [-37.8433, 145.0849] },
  { name: "Burwood", position: [-37.8501, 145.0888] },
  { name: "Ashburton", position: [-37.8620, 145.0818] },
  { name: "Alamein", position: [-37.8672, 145.0797] },
];

const GLEN_WAVERLEY_STATIONS: Station[] = [
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
  { name: "East Richmond", position: [-37.82632740224405, 144.9972673053531] },
  { name: "Burnley", position: [-37.82767802049741, 145.00771393724537] },
  { name: "Heyington", position: [-37.83472931277994, 145.02262594154345] },
  { name: "Kooyong", position: [-37.83975647035526, 145.032989610259] },
  { name: "Tooronga", position: [-37.84933641308045, 145.04169596793076] },
  { name: "Gardiner", position: [-37.85319254950284, 145.0519567538175] },
  { name: "Glen Iris", position: [-37.85924791323599, 145.05815226608306] },
  { name: "Darling", position: [-37.868960963389696, 145.0628898525902] },
  { name: "East Malvern", position: [-37.876943166140485, 145.06928548142633] },
  { name: "Holmesglen", position: [-37.874467434174626, 145.0901950084133] },
  { name: "Jordanville", position: [-37.8736209099283, 145.11208946608417] },
  { name: "Mount Waverley", position: [-37.875253140075536, 145.1277433710727] },
  { name: "Syndal", position: [-37.876238755103856, 145.14971636451426] },
  { name: "Glen Waverley", position: [-37.87945446561707, 145.16198233013415] },
];
// Real GTFS shape points (route "Glen Waverley", shape 2-GWY-vpt-1.10.H) from
// Richmond to Glen Waverley, rather than straight station-to-station hops
// with one hand-guessed midpoint per segment.
const GLEN_WAVERLEY_TRACK_POINTS: [number, number][] = [
  [-37.823719, 144.989686],
  [-37.823905, 144.990365],
  [-37.823941, 144.990487],
  [-37.823987, 144.990627],
  [-37.824086, 144.990901],
  [-37.824227, 144.991220],
  [-37.824359, 144.991463],
  [-37.824492, 144.991685],
  [-37.824656, 144.991920],
  [-37.824947, 144.992286],
  [-37.825363, 144.992818],
  [-37.825525, 144.993032],
  [-37.825617, 144.993167],
  [-37.825695, 144.993294],
  [-37.825741, 144.993374],
  [-37.825820, 144.993524],
  [-37.825846, 144.993577],
  [-37.825918, 144.993745],
  [-37.825967, 144.993876],
  [-37.826017, 144.994026],
  [-37.826062, 144.994189],
  [-37.826122, 144.994463],
  [-37.826157, 144.994672],
  [-37.826184, 144.994889],
  [-37.826201, 144.995044],
  [-37.826207, 144.995118],
  [-37.826215, 144.995272],
  [-37.826223, 144.995509],
  [-37.826233, 144.995659],
  [-37.826258, 144.995913],
  [-37.826357, 144.996778],
  [-37.826395, 144.997137],
  [-37.826563, 144.998648],
  [-37.826629, 144.999272],
  [-37.826833, 145.001080],
  [-37.827192, 145.004328],
  [-37.827241, 145.004806],
  [-37.827300, 145.005557],
  [-37.827327, 145.005936],
  [-37.827387, 145.006793],
  [-37.827410, 145.007153],
  [-37.827454, 145.007693],
  [-37.827494, 145.008140],
  [-37.827593, 145.009136],
  [-37.827643, 145.009437],
  [-37.827667, 145.009560],
  [-37.827722, 145.009869],
  [-37.827755, 145.010089],
  [-37.827781, 145.010341],
  [-37.827792, 145.010474],
  [-37.827803, 145.010711],
  [-37.827807, 145.010877],
  [-37.827804, 145.011181],
  [-37.827793, 145.011475],
  [-37.827774, 145.011764],
  [-37.827761, 145.011919],
  [-37.827737, 145.012151],
  [-37.827687, 145.012583],
  [-37.827656, 145.012871],
  [-37.827633, 145.013144],
  [-37.827622, 145.013369],
  [-37.827619, 145.013585],
  [-37.827624, 145.013933],
  [-37.827662, 145.015578],
  [-37.827674, 145.016231],
  [-37.827685, 145.016568],
  [-37.827693, 145.016698],
  [-37.827714, 145.016904],
  [-37.827753, 145.017193],
  [-37.827775, 145.017327],
  [-37.827813, 145.017544],
  [-37.827837, 145.017660],
  [-37.827865, 145.017778],
  [-37.827933, 145.018015],
  [-37.827971, 145.018126],
  [-37.828018, 145.018256],
  [-37.828076, 145.018399],
  [-37.828126, 145.018507],
  [-37.828202, 145.018658],
  [-37.828280, 145.018800],
  [-37.828360, 145.018926],
  [-37.828421, 145.019018],
  [-37.828554, 145.019206],
  [-37.828681, 145.019372],
  [-37.828892, 145.019617],
  [-37.828979, 145.019707],
  [-37.829079, 145.019803],
  [-37.829162, 145.019877],
  [-37.829286, 145.019978],
  [-37.829429, 145.020085],
  [-37.829508, 145.020138],
  [-37.829624, 145.020210],
  [-37.829791, 145.020302],
  [-37.829892, 145.020352],
  [-37.830113, 145.020449],
  [-37.832849, 145.021518],
  [-37.833040, 145.021605],
  [-37.833212, 145.021691],
  [-37.833405, 145.021805],
  [-37.833561, 145.021902],
  [-37.833997, 145.022198],
  [-37.834189, 145.022342],
  [-37.834319, 145.022444],
  [-37.834460, 145.022563],
  [-37.834659, 145.022740],
  [-37.834859, 145.022942],
  [-37.835021, 145.023117],
  [-37.835271, 145.023417],
  [-37.835520, 145.023731],
  [-37.835708, 145.023959],
  [-37.835873, 145.024153],
  [-37.836026, 145.024312],
  [-37.836144, 145.024423],
  [-37.836261, 145.024525],
  [-37.836392, 145.024628],
  [-37.836564, 145.024753],
  [-37.836864, 145.024923],
  [-37.837073, 145.025035],
  [-37.837255, 145.025140],
  [-37.837427, 145.025253],
  [-37.837593, 145.025368],
  [-37.837758, 145.025508],
  [-37.837906, 145.025641],
  [-37.838011, 145.025750],
  [-37.838138, 145.025893],
  [-37.838282, 145.026073],
  [-37.838509, 145.026392],
  [-37.838692, 145.026704],
  [-37.838835, 145.027000],
  [-37.838917, 145.027195],
  [-37.838988, 145.027381],
  [-37.839067, 145.027622],
  [-37.839108, 145.027762],
  [-37.839148, 145.027918],
  [-37.839227, 145.028299],
  [-37.839270, 145.028613],
  [-37.839313, 145.029012],
  [-37.839349, 145.029384],
  [-37.839425, 145.030115],
  [-37.839658, 145.032393],
  [-37.839682, 145.032596],
  [-37.839710, 145.032776],
  [-37.839739, 145.032947],
  [-37.839776, 145.033141],
  [-37.839824, 145.033355],
  [-37.839889, 145.033599],
  [-37.839958, 145.033837],
  [-37.840035, 145.034072],
  [-37.840134, 145.034334],
  [-37.840225, 145.034557],
  [-37.840324, 145.034782],
  [-37.840408, 145.034957],
  [-37.840504, 145.035147],
  [-37.840593, 145.035313],
  [-37.840756, 145.035601],
  [-37.840856, 145.035757],
  [-37.840995, 145.035958],
  [-37.841276, 145.036326],
  [-37.841495, 145.036575],
  [-37.841838, 145.036919],
  [-37.842189, 145.037211],
  [-37.842603, 145.037528],
  [-37.843016, 145.037818],
  [-37.843372, 145.038042],
  [-37.843791, 145.038282],
  [-37.844018, 145.038401],
  [-37.844788, 145.038798],
  [-37.845960, 145.039398],
  [-37.846192, 145.039500],
  [-37.846696, 145.039718],
  [-37.847185, 145.039938],
  [-37.847446, 145.040075],
  [-37.847719, 145.040226],
  [-37.848090, 145.040501],
  [-37.848319, 145.040692],
  [-37.848533, 145.040882],
  [-37.848729, 145.041062],
  [-37.848986, 145.041333],
  [-37.849151, 145.041518],
  [-37.849327, 145.041730],
  [-37.849505, 145.041959],
  [-37.849710, 145.042239],
  [-37.849925, 145.042576],
  [-37.850058, 145.042797],
  [-37.850255, 145.043150],
  [-37.850445, 145.043528],
  [-37.850641, 145.043952],
  [-37.850795, 145.044346],
  [-37.850913, 145.044686],
  [-37.851112, 145.045274],
  [-37.851661, 145.046950],
  [-37.851838, 145.047672],
  [-37.851930, 145.048066],
  [-37.851969, 145.048247],
  [-37.852063, 145.048621],
  [-37.852159, 145.048951],
  [-37.852364, 145.049571],
  [-37.852958, 145.051331],
  [-37.853141, 145.051869],
  [-37.853254, 145.052187],
  [-37.853336, 145.052403],
  [-37.853418, 145.052589],
  [-37.853550, 145.052881],
  [-37.853696, 145.053156],
  [-37.853819, 145.053370],
  [-37.854000, 145.053661],
  [-37.854134, 145.053858],
  [-37.854309, 145.054094],
  [-37.854414, 145.054226],
  [-37.854697, 145.054553],
  [-37.854866, 145.054729],
  [-37.855147, 145.055002],
  [-37.855428, 145.055235],
  [-37.856490, 145.056030],
  [-37.856864, 145.056313],
  [-37.857181, 145.056557],
  [-37.857458, 145.056781],
  [-37.857905, 145.057156],
  [-37.858456, 145.057649],
  [-37.858815, 145.057953],
  [-37.859232, 145.058265],
  [-37.859380, 145.058375],
  [-37.859540, 145.058489],
  [-37.859701, 145.058596],
  [-37.859842, 145.058685],
  [-37.859908, 145.058719],
  [-37.860005, 145.058773],
  [-37.860264, 145.058901],
  [-37.860491, 145.059005],
  [-37.860926, 145.059196],
  [-37.861446, 145.059374],
  [-37.865496, 145.060616],
  [-37.865770, 145.060703],
  [-37.866153, 145.060844],
  [-37.866459, 145.060977],
  [-37.866968, 145.061288],
  [-37.867218, 145.061460],
  [-37.867494, 145.061687],
  [-37.867877, 145.062018],
  [-37.868120, 145.062231],
  [-37.868329, 145.062422],
  [-37.868478, 145.062554],
  [-37.868655, 145.062709],
  [-37.868933, 145.062949],
  [-37.869398, 145.063360],
  [-37.869514, 145.063458],
  [-37.869668, 145.063582],
  [-37.870008, 145.063842],
  [-37.870388, 145.064100],
  [-37.870761, 145.064325],
  [-37.870898, 145.064402],
  [-37.871100, 145.064508],
  [-37.871290, 145.064603],
  [-37.871601, 145.064746],
  [-37.873556, 145.065567],
  [-37.873741, 145.065651],
  [-37.873969, 145.065763],
  [-37.874155, 145.065864],
  [-37.874278, 145.065936],
  [-37.874478, 145.066063],
  [-37.874688, 145.066211],
  [-37.874850, 145.066336],
  [-37.875007, 145.066467],
  [-37.875217, 145.066660],
  [-37.875376, 145.066824],
  [-37.875533, 145.067003],
  [-37.875606, 145.067093],
  [-37.875694, 145.067208],
  [-37.875861, 145.067438],
  [-37.876165, 145.067882],
  [-37.876338, 145.068144],
  [-37.876447, 145.068330],
  [-37.876527, 145.068483],
  [-37.876606, 145.068644],
  [-37.876686, 145.068818],
  [-37.876833, 145.069181],
  [-37.877114, 145.069906],
  [-37.877186, 145.070103],
  [-37.877248, 145.070298],
  [-37.877302, 145.070493],
  [-37.877336, 145.070629],
  [-37.877380, 145.070831],
  [-37.877416, 145.071030],
  [-37.877439, 145.071180],
  [-37.877463, 145.071388],
  [-37.877476, 145.071570],
  [-37.877484, 145.071813],
  [-37.877484, 145.071973],
  [-37.877475, 145.072184],
  [-37.877456, 145.072468],
  [-37.877436, 145.072697],
  [-37.877298, 145.074170],
  [-37.877266, 145.074565],
  [-37.877241, 145.075025],
  [-37.877209, 145.075928],
  [-37.877195, 145.076247],
  [-37.877165, 145.076696],
  [-37.877023, 145.078510],
  [-37.876928, 145.079764],
  [-37.876849, 145.080446],
  [-37.876825, 145.080623],
  [-37.876797, 145.080809],
  [-37.876743, 145.081121],
  [-37.876695, 145.081373],
  [-37.876637, 145.081655],
  [-37.876586, 145.081883],
  [-37.876284, 145.083125],
  [-37.875020, 145.088245],
  [-37.874938, 145.088563],
  [-37.874828, 145.088944],
  [-37.874716, 145.089317],
  [-37.874564, 145.089804],
  [-37.874442, 145.090247],
  [-37.874419, 145.090340],
  [-37.874395, 145.090441],
  [-37.874358, 145.090619],
  [-37.874337, 145.090726],
  [-37.874303, 145.090938],
  [-37.874270, 145.091159],
  [-37.874256, 145.091261],
  [-37.874222, 145.091588],
  [-37.874205, 145.091795],
  [-37.874127, 145.092837],
  [-37.874113, 145.092978],
  [-37.874088, 145.093371],
  [-37.874032, 145.094132],
  [-37.873904, 145.095832],
  [-37.873857, 145.096491],
  [-37.873524, 145.100952],
  [-37.873334, 145.103531],
  [-37.873040, 145.107442],
  [-37.872991, 145.108161],
  [-37.872982, 145.108385],
  [-37.872977, 145.108565],
  [-37.872977, 145.108778],
  [-37.872981, 145.109007],
  [-37.872995, 145.109312],
  [-37.873013, 145.109540],
  [-37.873030, 145.109711],
  [-37.873059, 145.109969],
  [-37.873098, 145.110258],
  [-37.873137, 145.110514],
  [-37.873158, 145.110628],
  [-37.873207, 145.110881],
  [-37.873261, 145.111132],
  [-37.873328, 145.111403],
  [-37.873367, 145.111537],
  [-37.873382, 145.111599],
  [-37.873508, 145.112014],
  [-37.873583, 145.112242],
  [-37.873765, 145.112735],
  [-37.873985, 145.113320],
  [-37.874056, 145.113495],
  [-37.874231, 145.113956],
  [-37.874426, 145.114550],
  [-37.874569, 145.115064],
  [-37.874700, 145.115638],
  [-37.874802, 145.116253],
  [-37.874868, 145.116764],
  [-37.874916, 145.117226],
  [-37.875117, 145.119657],
  [-37.875234, 145.121115],
  [-37.875299, 145.122063],
  [-37.875300, 145.122625],
  [-37.875298, 145.122802],
  [-37.875283, 145.123259],
  [-37.875280, 145.124267],
  [-37.875266, 145.126170],
  [-37.875256, 145.127091],
  [-37.875252, 145.127715],
  [-37.875239, 145.129451],
  [-37.875248, 145.130837],
  [-37.875208, 145.138646],
  [-37.875208, 145.139033],
  [-37.875211, 145.139353],
  [-37.875225, 145.139859],
  [-37.875239, 145.140132],
  [-37.875259, 145.140428],
  [-37.875295, 145.140848],
  [-37.875347, 145.141360],
  [-37.875379, 145.141662],
  [-37.875490, 145.142541],
  [-37.875546, 145.143013],
  [-37.875932, 145.146419],
  [-37.875989, 145.146930],
  [-37.876020, 145.147237],
  [-37.876068, 145.147800],
  [-37.876159, 145.149033],
  [-37.876187, 145.149370],
  [-37.876215, 145.149642],
  [-37.876253, 145.149959],
  [-37.876294, 145.150227],
  [-37.876321, 145.150383],
  [-37.876377, 145.150676],
  [-37.876451, 145.151010],
  [-37.876483, 145.151145],
  [-37.876672, 145.151855],
  [-37.878223, 145.157579],
  [-37.878769, 145.159585],
  [-37.879039, 145.160565],
  [-37.879117, 145.160794],
  [-37.879228, 145.161081],
  [-37.879299, 145.161276],
  [-37.879356, 145.161441],
  [-37.879444, 145.161712],
  [-37.879529, 145.162000],
  [-37.879773, 145.162882],
];
const BURNLEYGROUPLOOP_STATIONS: Station[] = [
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
  { name: "Flinders Street", position: [-37.8184161, 144.9664779] },
  { name: "Southern Cross", position: [-37.8176, 144.9522] },
  { name: "Flagstaff", position: [-37.81196029877101, 144.9566610145156] },
  { name: "Melbourne Central", position: [-37.8101, 144.9626] },
  { name: "Parliament", position: [-37.81123787494798, 144.97303582934072] },
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
];
const JOLIMONT_TO_FLINDERS_PORTAL: [number, number][] = [
  [-37.815808751063095, 144.9778546912331],
    [-37.815624405906064, 144.9750759227291],// exiting Parliament
  [-37.815743064919, 144.97438123057663], 
  [-37.81632152482936, 144.97277458741638], // Parliament -> Jolimont curve
  [-37.81778485426324, 144.96826388056115], // Jolimont / MCG side
  [-37.8184161, 144.9664779], // Flinders Street eastern portal
];

const PAKENHAM_STATIONS: Station[] = [
  { name: "Anzac", position: [-37.83323797420302, 144.97276854232885] },
  { name: "Hawksburn", position: [-37.8446738, 145.0019694] },
  { name: "Toorak", position: [-37.8506631, 145.0136792] },
  { name: "Armadale", position: [-37.8562948, 145.0192436] },
  { name: "Malvern", position: [-37.8663425, 145.029464] },
  { name: "Caulfield", position: [-37.8770, 145.0424] },
  { name: "Carnegie", position: [-37.88584755576908, 145.0576145973216] },
  { name: "Murrumbeena", position: [-37.889800131059374, 145.06676121081267] },
  { name: "Hughesdale", position: [-37.89413917232323, 145.076200726158132] },
  { name: "Oakleigh", position: [-37.900458908475315, 145.08839984150381] },
  { name: "Huntingdale", position: [-37.91097055312629, 145.10241977630986] },
  { name: "Clayton", position: [-37.924541507360765, 145.12053998830723] },
  { name: "Westall", position: [-37.937755318504934, 145.13805369881837] },
  { name: "Springvale", position: [-37.94893771437316, 145.15307099140574] },
  { name: "Sandown Park", position: [-37.95653055647639, 145.1628965591817] },
  { name: "Noble Park", position: [-37.966678, 145.176944] },
  { name: "Yarraman", position: [-37.978254, 145.191501] },
  { name: "Dandenong", position: [-37.98991938287247, 145.20988128532633] },
  { name: "Hallam", position: [-38.01774038, 145.2697768] },
  { name: "Narre Warren", position: [-38.02777361, 145.303993] },
  { name: "Berwick", position: [-38.03998037, 145.34541666] },
  { name: "Beaconsfield", position: [-38.05083135, 145.36607374] },
  { name: "Officer", position: [-38.06614572, 145.41098723] },
  { name: "Cardinia Road", position: [-38.07129047, 145.43779101] },
  { name: "Pakenham", position: [-38.08061397, 145.48637907] },
  { name: "East Pakenham", position: [-38.08430672, 145.50663267] },
];

const CRANBOURNE_STATIONS: Station[] = [
  { name: "Dandenong", position: [-37.98991938287247, 145.20988128532633] },
  { name: "Lynbrook", position: [-38.056307584760475, 145.25319338898683] },
  { name: "Merinda Park", position: [-38.079655791047855, 145.26428718532986] },
  { name: "Cranbourne", position: [-38.099, 145.2613] },
];

const SUNBURY_STATIONS: Station[] = [
  { name: "Sunbury", position: [-37.579209, 144.727962] },
  { name: "Diggers Rest", position: [-37.62621416753362, 144.71929552429663] },
  { name: "Watergardens", position: [-37.70018094198704, 144.77262172318856] },
  { name: "Keilor Plains", position: [-37.72930031255676, 144.7928135623099] },
  { name: "St. Albans", position: [-37.74478482442231, 144.79992678066148 ] },
  { name: "Ginifer", position: [-37.76011342095589, 144.81221129777228] },
  { name: "Albion", position: [-37.776690746428365, 144.82408952556068] },
  { name: "Sunshine", position: [-37.78812106172095, 144.83237218696007] },
  { name: "Tottenham", position: [-37.79906652439008, 144.86302968739224] },
  { name: "West Footscray", position: [-37.80159439768236, 144.88351876420322] },
  { name: "Middle Footscray", position: [-37.80244211892746, 144.89150101820428] },
  { name: "Footscray", position: [-37.801696124765726, 144.90150029345793] },
  { name: "South Kensington", position: [-37.79971717185788, 144.92584789732544] },
  { name: "Arden", position: [-37.80093646751718, 144.94074635061708] },
  { name: "Parkville", position: [-37.79978943619289, 144.9595131752267] },
  { name: "State Library", position: STATE_LIBRARY_POSITION },
  { name: "Town Hall", position: TOWN_HALL_POSITION },
  { name: "Anzac", position: [-37.83323797420302, 144.97276854232885] },
];

const METRO_TUNNEL_STATIONS: Station[] = [
  { name: "Arden", position: [-37.80093646751718, 144.94074635061708] },
  { name: "Parkville", position: [-37.79978943619289, 144.9595131752267] },
  { name: "State Library", position: STATE_LIBRARY_POSITION },
  { name: "Town Hall", position: TOWN_HALL_POSITION },
  { name: "Anzac", position: [-37.83323797420302, 144.97276854232885] },
];

const CAUFIELDLOOP_STATIONS: Station[] = [
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
  { name: "Flinders Street", position: [-37.8184161, 144.9664779] },
  { name: "Southern Cross", position: [-37.8176, 144.9522] },
  { name: "Flagstaff", position: [-37.81196029877101, 144.9566610145156] },
  { name: "Melbourne Central", position: [-37.8101, 144.9626] },
  { name: "Parliament", position: [-37.81123787494798, 144.97303582934072] },
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
];

const NORTHERNGROUPLOOP_STATIONS: Station[] = [
  { name: "North Melbourne", position: [-37.8073, 144.9426] },
  { name: "Southern Cross", position: [-37.8176, 144.9522] },
  { name: "Flinders Street", position: [-37.81840600875998, 144.96599046643283] },
  { name: "Parliament", position: [-37.81123787494798, 144.97303582934072] },
  { name: "Melbourne Central", position: [-37.8101, 144.9626] },
  { name: "Flagstaff", position: [-37.81196029877101, 144.9566610145156] },
  { name: "North Melbourne", position: [-37.8073, 144.9426] },
];

const WERRIBEE_STATIONS: Station[] = [
  { name: "Flinders Street", position: [-37.8184161, 144.9664779] },
  { name: "Southern Cross", position: [-37.81934099941143, 144.9524609650515] },
  { name: "North Melbourne", position: [-37.8073, 144.9426] },
  { name: "South Kensington", position: [-37.79971717185788, 144.92584789732544] },
  { name: "Footscray", position: [-37.801696124765726, 144.90150029345793] },
  { name: "Seddon", position: [-37.80864624508298, 144.89540631027074] },
  { name: "Yarraville", position: [-37.8159245612344, 144.88935190525294] },
  { name: "Spotswood", position: [-37.830475560641304, 144.88574396020414] },
  { name: "Newport", position: [-37.84264314186776, 144.88355527766285] },
  { name: "Laverton", position: [-37.86374615697885, 144.7720741120282] },
  { name: "Aircraft", position: [-37.86652430453361, 144.76084104096728] },
  { name: "Williams Landing", position: [-37.87009845943303, 144.74700083780496] },
  { name: "Hoppers Crossing", position: [-37.882748919778834, 144.70113749736035] },
  { name: "Werribee", position: [-37.89950763796044, 144.66087578807574] },
];

const WILLIAMSTOWN_STATIONS: Station[] = [
  { name: "Newport", position: [-37.84269100630597, 144.88362501538808] },
  { name: "North Williamstown", position: [-37.85731316329924, 144.88884995850088] },
  { name: "Williamstown Beach", position: [-37.86405552358406, 144.89446402447876] },
  { name: "Williamstown", position: [-37.86768910119632, 144.90528941998267] },
];

const ALTONA_LOOP_STATIONS: Station[] = [
  { name: "Newport", position: [-37.84269100630597, 144.88362501538808] },
  { name: "Seaholme", position: [-37.867764659987316, 144.84120771014238] },
  { name: "Altona", position: [-37.86698148967684, 144.82999249088098] },
  { name: "Westona", position: [-37.86511016206653, 144.8135289261629] },
  { name: "Laverton", position: [-37.86374615697885, 144.7720741120282] },
];

const SANDRINGHAM_STATIONS: Station[] = [
  { name: "Flinders Street", position: [-37.8184161, 144.9664779] },
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667] },
  {
    name: "South Yarra",
    position: [-37.8381009, 144.99237],
    staffed: true,
    barriers: true,
    metro: true,
    zone: "1",
  },
  {
    name: "Prahran",
    position: [-37.8495243704257, 144.98999628587248],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
  {
    name: "Windsor",
    position: [-37.85625063817182, 144.9918631033007],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
  {
    name: "Balaclava",
    position: [-37.869403785294736, 144.9935489947572],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
  {
    // Position verified against the real OSM railway=station node (was off
    // by ~17m, visibly separating our marker from the map's own station icon
    // at high zoom).
    name: "Ripponlea",
    position: [-37.8758915, 144.9952063],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
  {
    // Position verified against the real OSM railway=station node (was off
    // by ~17m north).
    name: "Elsternwick",
    position: [-37.8849937, 145.0010231],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
  {
    // Position verified against the real OSM railway=station node (was off
    // by ~17m).
    name: "Gardenvale",
    position: [-37.8966425, 145.0041759],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
    {
    // Position verified against the real OSM railway=station node (was off
    // by ~38m).
    name: "North Brighton",
    position: [-37.9048498, 145.0026141],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
  {
    // Position verified against the real OSM railway=station node (was off
    // by ~46m).
    name: "Middle Brighton",
    position: [-37.9149063, 144.9965413],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },  {
    name: "Brighton Beach",
    position: [-37.92648432, 144.98915355],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
  {
    name: "Hampton",
    position: [-37.93786773858502, 145.0011463536134],
    staffed: false,
    barriers: false,
    metro: true,
    zone: "1",
  },
  {
    name: "Sandringham",
    position: [-37.95036297669773, 145.00454952822133],
    staffed: true,
    barriers: false,
    metro: true,
    zone: "1",
  },
];

const GIPPSLAND_STATIONS: Station[] = [
  { name: "Southern Cross", position: [-37.8176, 144.9522], vline: true, zone: "1" },
  { name: "Flinders Street", position: [-37.8184161, 144.9664779], vline: true, zone: "1" },
  { name: "Richmond", position: [-37.82359625345165, 144.9891977969667], vline: true, zone: "1" },
  { name: "Caulfield", position: [-37.8770, 145.0424], vline: true, zone: "1" },
  { name: "Clayton", position: [-37.9247726501578, 145.12035310256484], vline: true, zone: "1" },
  { name: "Dandenong", position: [-37.98797563248677, 145.21479109451644], vline: true, zone: "2" },
  { name: "Berwick", position: [-38.03998037, 145.34541666], vline: true, zone: "2" },
  { name: "Pakenham", position: [-38.08061397, 145.48637907], vline: true, zone: "2" },
  { name: "Warragul", position: [-38.15965088085526, 145.92871651094258], vline: true },
  { name: "Moe", position: [-38.17588027961461, 146.26083329049215], vline: true },
  { name: "Morwell", position: [-38.23555857042696, 146.39640612076153], vline: true },
  { name: "Traralgon", position: [-38.19489747401578, 146.5415475189243], vline: true },
];

const BALLARAT_REGIONAL_STATIONS: Station[] = [
  { name: "Southern Cross", position: [-37.8176, 144.9522], vline: true, zone: "1" },
  { name: "Sunshine", position: [-37.791897110759385, 144.83351243198313], vline: true, zone: "1" },
  { name: "Melton", position: [-37.68490447367019, 144.58866263023615], vline: true, zone: "2" },
  { name: "Ballarat", position: [-37.55861757585211, 143.85946145441608], vline: true },
  { name: "Wendouree", position: [-37.5309, 143.8487], vline: true },
  { name: "Ararat", position: [-37.2823, 142.9367], vline: true },
  { name: "Maryborough", position: [-37.0510, 143.7426], vline: true },
];

const SEYMOUR_REGIONAL_STATIONS: Station[] = [
  { name: "Southern Cross", position: [-37.81767225337158, 144.950639128634], vline: true, zone: "1" },
  { name: "Broadmeadows", position: [-37.6805, 144.9191], vline: true, zone: "2" },
  { name: "Seymour", position: [-37.0264, 145.1337], vline: true },
];

// =========================
// Polyline Data
// =========================
const MELBOURNE_CENTRAL_TO_STATE_LIBRARY: [number, number][] = [
  [-37.8101, 144.9626],
  [-37.8117, 144.9629],
];
const CLIFTON_HILL_POSITION: [number, number] = [-37.78831003762462, 144.9955664605472];

const CAUFIELD_LOOP: [number, number][] = [
  [-37.8188437593049, 144.97790945754892],
  [-37.8181727321212, 144.9775078452675], // last point
  [-37.81768238193436, 144.9769297210735], //  richmond portal cfd 
  [-37.81746731800017, 144.97667222901444],
  [-37.81686605500994, 144.97604932173275],
  [-37.81623674589375, 144.97549946888685],
  [-37.81560107467396, 144.9750569043993],
  [-37.8146221302977, 144.9746103166069],
  [-37.8136177452875, 144.97416238769392],
  [-37.81266738107811, 144.97371982320394],
  [-37.81139915013397, 144.97313845175165], // parliment station 
  [-37.809766246687126, 144.97238334592595],
  [-37.808744134445945, 144.97188076367107],
  [-37.80814758671704, 144.97105262471715],
  [-37.808443204354354, 144.97155687999603],
  [-37.807998203978606, 144.9706362187189],
  [-37.80783501193112, 144.96928433538403], // cureve 12
  [-37.808498781192675, 144.96706891082312],
  [-37.80986347281194, 144.9624031365788], //  Melbourne Centreral Stzatiopn
  [-37.8117198114853, 144.95609063535503], // FLAGstaff station 
  [-37.813109401599526, 144.95152276827767],
  [-37.813305239346434, 144.9508467242103], // latrobe street 
  [-37.81346098414173, 144.95054430515134],
  [-37.813636329085746, 144.95028882474315],
  [-37.81405826174884, 144.94994552250395],
  [-37.81447516545205, 144.94977184946842],
  [-37.81499801340689, 144.9496933948548],
  [-37.815696727434805, 144.9497725200221],
[-37.816076011426915, 144.94990126605308], // 
[-37.81622364865211, 144.94994932059933], // Southern Cross (City Loop Western Portal)
[-37.81871545154895, 144.95187242335422], // Southern Cross 
[-37.819310838649166, 144.95234717436176], // Southern Cross Via Duct Curve 1
[-37.82012445594275, 144.95304723092087], // Southern Cross Via Duct Curve 2
[-37.82103128962857, 144.95433469121622], // Southern Cross Via Duct Curve 3
[-37.82114993994472, 144.95459218328656], // Southern Cross Via Duct Curve 4
[-37.821383002502714, 144.95569188895558], // Southern Cross Via Duct Curve 5
[-37.82139147749586, 144.95593060558758], // Southern Cross Via Duct Curve 6
[-37.821194433760674, 144.95703835790874], // Southern Cross Via Duct Curve 7
[-37.82096560812568, 144.95760430399687], // Southern Cross Via Duct Curve 8
[-37.820945852394416, 144.95783796247386], // Southern Cross Via Duct Curve 9
[-37.82063439405348, 144.95870029266104], // Southern Cross Via Duct Curve 10
[-37.8202689728552, 144.95961065802055], // Southern Cross Via Duct Curve 11
  [-37.81978957119074, 144.9609187795137], // Southern Cross Via Duct Curve 12
  [-37.81968257183936, 144.9619151979514], // Southern Cross Via Duct Curve 13
[-37.81938608424239, 144.96263273086195], // Southern Cross Via Duct Curve 14
[-37.819158312401186, 144.96355675186595], // Southern Cross Via Duct Curve 15
[-37.81896761915805, 144.96448747839776],
  [-37.81871971720591, 144.96543429817373],
  [-37.81857139939793, 144.9660082909082], // Flinders Street 
];
const BURNLEY_LOOP: [number, number][] = [...CAUFIELD_LOOP];
const JOLIMONT_TO_WEST_RICHMOND: [number, number][] = [
  [-37.816492790989656, 144.98395976419087],   // Jolimont
  [-37.816851137082246, 144.98751730791793],
  [-37.81656720697537, 144.98920441740864],
  [-37.816154014429515, 144.9900600244845],
  [-37.81533821827685, 144.99107387481638],
  [-37.814925027573054, 144.99145474850218],   // West Richmond
  [-37.81416008894346, 144.99181148230872], // end of platform W RICHMOND 
  [-37.81305398638554, 144.99203947007265], // york st 
  [-37.81178046463648, 144.9922460001681], // garfield street
  [-37.810964636334965, 144.9923747462035], // elithibith street
  [-37.8103479913108, 144.99248203456145], // north richmond statioon 
  [-37.80974617469039, 144.99256518304463],
  [-37.80833061486316, 144.9929514211424], // greensowrd st
  [-37.807406671946765, 144.99321695984267],
  [-37.80682178467832, 144.9933269304114],
  [-37.805111948572794, 144.993620995022],
  [-37.80446558539445, 144.99373364780257], // colling wood station
  [-37.803230062368854, 144.99393481347792],
  [-37.801913985082294, 144.99414670799277], // yarra st 
  [-37.801301503109485, 144.9941440257755], // studly st 
  [-37.800642390533845, 144.9941359791526],
  [-37.79929235705923, 144.99436933133384],
  [-37.79912916452965, 144.99442029330388], // victoria park station
  [-37.79766253492816, 144.9946455988675],
  [-37.795935180955574, 144.99493795964617],
  [-37.794518762887, 144.9951669011697],
  [-37.79325093503257, 144.99532107701643],
  [-37.792025822370704, 144.9950850426258],
  [-37.7911244592212, 144.99499399411127],

  [-37.79035503477694, 144.99506641375723],
  [-37.78980332038522, 144.99515805457796],
  [-37.7894196621083, 144.9952412030535], // clfinton hill arpocahc 
  [-37.788251717787986, 144.99544505093596], // clifton hill 
];
const NORTHERN_LOOP: [number, number][] = [
  [-37.8073, 144.9426], // Southern Cross (Western portal / loop entry)

  // heading north-east under La Trobe St toward Flagstaff
  [-37.81247065691958, 144.94693600775102], // approaching Flagstaff
  [-37.81332250616509, 144.95006210136958],

  [-37.81335215689385, 144.9507340157454], // Flagstaff area
[-37.813197486324185, 144.95145685001907],
  // curve east toward Melbourne Central
  [-37.81196029877101, 144.9566610145156], // Flagstaff → Melbourne Central curve
  [-37.8101, 144.9626], // Melbourne Central

  // continue east/north-east toward Parliament
  // edit JOLIMONT_TO_FLINDERS_PORTAL above if you want to shape the Parliament/Jolimont/Flinders section
  [-37.80807339740153, 144.96921480284715], // leaving Melbourne Central
  [-37.80801993633507, 144.96972437757896], // tunnel alignment
  [-37.80804748502936, 144.970295688085],
  [-37.8082191343581, 144.9709984268594],
  [-37.80873407995166, 144.97174944539097],
  [-37.81059179110248, 144.97265533855764], // approaching Parliament
  [-37.811378449431345, 144.97302812703637], // Parliament station

  // turn south toward Jolimont / Richmond portal
  [-37.8147653441898, 144.97416778728817], // exiting Parliament
  [-37.815923183065, 144.97346658889202], // Parliament → Jolimont curve
  [-37.81763600460815, 144.9681709646954], // Jolimont / MCG side
  [-37.81832010684088, 144.96587601682907], //flidners 

  // swing back west toward Flinders Street
  [-37.819578159795725, 144.9610791331353], // viaduct toward Flinders

  // continue west back toward Southern Cross
  [-37.82100744345243, 144.95730565300772],
  [-37.82104875922244, 144.9572225045253],
  [-37.82109536715535, 144.95707701757522], // Flinders → Southern Cross curve
  [-37.82105330977752, 144.95720748873785],
   [-37.8212923531196, 144.95643129110326],
 [-37.821328429885675, 144.95581637936937],
  [-37.8211906937223, 144.95500906362312], // viaduct mid-section
   [-37.82098307302916, 144.95440017298998],
   [-37.820287292816374, 144.95337319911047],
   [-37.819882604979846, 144.95296282113222],
  [-37.81973721503802, 144.95279892337976], // approaching Southern Cross
  [-37.81934099941143, 144.9524609650515], // Southern Cross approach
  [-37.816853698443914, 144.95049612250577],
  [-37.81621957350685, 144.94995894904764], // last plit off of cfd and nrthn 
[-37.81219780049446, 144.9464798395072],
];
const SANDRINGHAM_LINE: [number, number][] = [
  [-37.81932100824693, 144.96515822429285], // Flinders Street
  [-37.81885676092435, 144.96680614367563],
  [-37.81868831342351, 144.96738684195435],
  [-37.81810105905219, 144.9693011010421],
  [-37.81775144701517, 144.97037800795056],
  [-37.817514691457086, 144.9714540393451],
  [-37.81739547670335, 144.97178214437636],
  [-37.81730860273319, 144.97319298632365],
  [-37.81759253191024, 144.97503700501213],
  [-37.81805762249785, 144.9762976432565],
  [-37.81838498518352, 144.9769521022641],
  [-37.818903041615916, 144.9778171146715],
  [-37.81964992638664, 144.97898924001413],
  [-37.82058643504468, 144.9804389739665],
  [-37.8212956127862, 144.98150645039166],
  [-37.821843728631805, 144.9823642792451],
  [-37.822836355553684, 144.9841989101896],
  [-37.82289792870241, 144.9843463614976],
  [-37.82335451103584, 144.98566198503144],
  [-37.823768685272795, 144.9869941790775],
  [-37.82431954341726, 144.9891573806168], // Richmond

  // South Yarra → Richmond curves
  [-37.82606575858881, 144.99270326773168], // Richmond to South Yarra curve
  [-37.82598101345592, 144.99258525053799], // Richmond to South Yarra curve 2
  [-37.82768438956031, 144.99390491980614], // Richmond to South Yarra curve 3
  [-37.83259166656431, 144.9935008513864], // Richmond to South Yarra curve 4
  [-37.834942448947026, 144.9930213092438], // Richmond to South Yarra curve 5
  [-37.836163536721816, 144.9928552912536], // Richmond to South Yarra curve 6
  [-37.839242018981536, 144.99204952288912], // South Yarra
  [-37.83950870844592, 144.99201319177607], // South Yarra bridge
  [-37.83972265048852, 144.9919246788808], // South Yarra entrance curve
  [-37.84031681301816, 144.99176776965538], // South Yarra entrance curve 2
  [-37.84948088240228, 144.98989704452956], // pharsanhn station
  [-37.85156784714275, 144.9895675847279],
  [-37.85397372002226, 144.99008256884602],
  [-37.8547700127662, 144.9905653664568],
  [-37.85586278356211, 144.99177772498697], // winsdor station
  [-37.85659711485019, 144.9927396136255], // winsdor station bridnge 
  [-37.85788256936412, 144.9937561708309], 
  [-37.860062857088174, 144.9948972776503],
  [-37.86164683209365, 144.99498579055694],
  [-37.864329579924544, 144.994492948562],
  [-37.86588170121176, 144.99418985894465],
  [-37.86944319832077, 144.9935407643723],
  [-37.872229574061805, 144.99349788204847],
  [-37.87594743585128, 144.99515012282768],
  [-37.88124019548833, 144.99826148525],
  [-37.8873075976758, 145.00279758553393],
  [-37.88908573308372, 145.00388119801502],
  [-37.89206072149637, 145.00471275875503],
  [-37.894516141671495, 145.00454107880682],
  [-37.89659889201308, 145.0041977560489],
  [-37.9505, 145.0058],
];

// =========================
// Derived Data
// =========================
const MERNDA_LINE = MERNDA_STATIONS.map((s) => s.position);
// Real GTFS shape points (route "Hurstbridge", shape 2-HBE-vpt-1.28.H) from
// Westgarth to Hurstbridge, rather than straight station-to-station hops.
const HURSTBRIDGE_LINE: [number, number][] = [
  [-37.780531, 144.999310],
  [-37.780375, 144.999455],
  [-37.780251, 144.999582],
  [-37.780131, 144.999708],
  [-37.780020, 144.999839],
  [-37.779925, 144.999960],
  [-37.779795, 145.000151],
  [-37.779685, 145.000331],
  [-37.779546, 145.000607],
  [-37.779467, 145.000797],
  [-37.779414, 145.000935],
  [-37.779353, 145.001128],
  [-37.779307, 145.001301],
  [-37.779268, 145.001474],
  [-37.779217, 145.001768],
  [-37.779196, 145.001973],
  [-37.779176, 145.002505],
  [-37.779182, 145.004885],
  [-37.779176, 145.008259],
  [-37.779174, 145.010215],
  [-37.779171, 145.010354],
  [-37.779173, 145.010676],
  [-37.779172, 145.012373],
  [-37.779159, 145.015579],
  [-37.779156, 145.016954],
  [-37.779154, 145.018217],
  [-37.779155, 145.019725],
  [-37.779151, 145.020083],
  [-37.779149, 145.021776],
  [-37.779137, 145.024194],
  [-37.779145, 145.027508],
  [-37.779142, 145.027806],
  [-37.779136, 145.028014],
  [-37.779126, 145.028215],
  [-37.779111, 145.028407],
  [-37.779087, 145.028632],
  [-37.779059, 145.028832],
  [-37.778998, 145.029185],
  [-37.778930, 145.029487],
  [-37.778893, 145.029630],
  [-37.778800, 145.029942],
  [-37.778386, 145.031231],
  [-37.777992, 145.032445],
  [-37.777943, 145.032592],
  [-37.777889, 145.032741],
  [-37.777670, 145.033451],
  [-37.777570, 145.033747],
  [-37.777294, 145.034535],
  [-37.776909, 145.035713],
  [-37.776765, 145.036173],
  [-37.776707, 145.036338],
  [-37.776561, 145.036662],
  [-37.776393, 145.036971],
  [-37.776240, 145.037201],
  [-37.776063, 145.037433],
  [-37.775849, 145.037681],
  [-37.775636, 145.037889],
  [-37.775033, 145.038406],
  [-37.773628, 145.039611],
  [-37.772800, 145.040305],
  [-37.772317, 145.040714],
  [-37.771978, 145.041016],
  [-37.771218, 145.041668],
  [-37.770681, 145.042124],
  [-37.770434, 145.042326],
  [-37.770255, 145.042499],
  [-37.770092, 145.042676],
  [-37.769948, 145.042851],
  [-37.769766, 145.043127],
  [-37.769636, 145.043376],
  [-37.769498, 145.043688],
  [-37.769396, 145.043957],
  [-37.768866, 145.045431],
  [-37.768330, 145.046921],
  [-37.768215, 145.047223],
  [-37.768180, 145.047322],
  [-37.768072, 145.047579],
  [-37.767931, 145.047873],
  [-37.767698, 145.048246],
  [-37.766533, 145.049861],
  [-37.765990, 145.050618],
  [-37.765638, 145.051105],
  [-37.765512, 145.051274],
  [-37.764392, 145.052846],
  [-37.763833, 145.053619],
  [-37.763410, 145.054208],
  [-37.763163, 145.054518],
  [-37.762910, 145.054815],
  [-37.762683, 145.055055],
  [-37.762403, 145.055339],
  [-37.762070, 145.055622],
  [-37.761583, 145.056018],
  [-37.760641, 145.056791],
  [-37.760282, 145.057070],
  [-37.760010, 145.057317],
  [-37.759745, 145.057572],
  [-37.759443, 145.057894],
  [-37.759165, 145.058225],
  [-37.758391, 145.059221],
  [-37.758191, 145.059469],
  [-37.758128, 145.059540],
  [-37.757942, 145.059738],
  [-37.757809, 145.059861],
  [-37.757660, 145.060006],
  [-37.757487, 145.060187],
  [-37.757042, 145.060749],
  [-37.756702, 145.061198],
  [-37.756530, 145.061472],
  [-37.756314, 145.061854],
  [-37.756235, 145.061984],
  [-37.756156, 145.062107],
  [-37.756055, 145.062250],
  [-37.755976, 145.062355],
  [-37.755920, 145.062426],
  [-37.755456, 145.063026],
  [-37.755366, 145.063148],
  [-37.754973, 145.063653],
  [-37.754812, 145.063865],
  [-37.754152, 145.064716],
  [-37.754003, 145.064930],
  [-37.753859, 145.065096],
  [-37.753723, 145.065263],
  [-37.753571, 145.065428],
  [-37.753459, 145.065542],
  [-37.753338, 145.065652],
  [-37.753253, 145.065726],
  [-37.753064, 145.065874],
  [-37.752892, 145.065991],
  [-37.752726, 145.066090],
  [-37.752627, 145.066144],
  [-37.752494, 145.066209],
  [-37.752273, 145.066303],
  [-37.752186, 145.066333],
  [-37.751989, 145.066392],
  [-37.751805, 145.066435],
  [-37.751657, 145.066461],
  [-37.751558, 145.066475],
  [-37.751338, 145.066500],
  [-37.749869, 145.066624],
  [-37.749472, 145.066655],
  [-37.747630, 145.066811],
  [-37.747325, 145.066832],
  [-37.747054, 145.066843],
  [-37.746914, 145.066847],
  [-37.746639, 145.066846],
  [-37.746521, 145.066843],
  [-37.746255, 145.066829],
  [-37.746016, 145.066812],
  [-37.745857, 145.066798],
  [-37.745561, 145.066762],
  [-37.745180, 145.066703],
  [-37.744887, 145.066645],
  [-37.744732, 145.066611],
  [-37.744468, 145.066549],
  [-37.743192, 145.066232],
  [-37.741478, 145.065809],
  [-37.741341, 145.065776],
  [-37.741038, 145.065711],
  [-37.740770, 145.065667],
  [-37.740611, 145.065644],
  [-37.739027, 145.065423],
  [-37.738586, 145.065359],
  [-37.738306, 145.065326],
  [-37.738082, 145.065304],
  [-37.737819, 145.065290],
  [-37.737692, 145.065287],
  [-37.737552, 145.065289],
  [-37.737390, 145.065296],
  [-37.737149, 145.065310],
  [-37.736999, 145.065326],
  [-37.736722, 145.065364],
  [-37.736615, 145.065384],
  [-37.736344, 145.065441],
  [-37.736091, 145.065507],
  [-37.735906, 145.065562],
  [-37.735806, 145.065593],
  [-37.735675, 145.065639],
  [-37.735398, 145.065749],
  [-37.735246, 145.065813],
  [-37.734699, 145.066055],
  [-37.734313, 145.066233],
  [-37.734148, 145.066304],
  [-37.733511, 145.066588],
  [-37.733421, 145.066632],
  [-37.732793, 145.066913],
  [-37.732449, 145.067069],
  [-37.732320, 145.067125],
  [-37.732026, 145.067260],
  [-37.731389, 145.067543],
  [-37.729547, 145.068376],
  [-37.729269, 145.068498],
  [-37.729019, 145.068596],
  [-37.728912, 145.068633],
  [-37.728743, 145.068672],
  [-37.728451, 145.068720],
  [-37.727924, 145.068813],
  [-37.727707, 145.068890],
  [-37.727597, 145.068919],
  [-37.727549, 145.068929],
  [-37.727093, 145.068990],
  [-37.726486, 145.069063],
  [-37.726112, 145.069112],
  [-37.725781, 145.069151],
  [-37.725646, 145.069169],
  [-37.724552, 145.069305],
  [-37.724172, 145.069356],
  [-37.723930, 145.069399],
  [-37.723793, 145.069429],
  [-37.723665, 145.069459],
  [-37.723447, 145.069522],
  [-37.723314, 145.069569],
  [-37.723110, 145.069647],
  [-37.722907, 145.069735],
  [-37.722673, 145.069851],
  [-37.722585, 145.069900],
  [-37.722390, 145.070016],
  [-37.722256, 145.070103],
  [-37.722032, 145.070253],
  [-37.721891, 145.070352],
  [-37.721604, 145.070559],
  [-37.721453, 145.070677],
  [-37.721316, 145.070793],
  [-37.721203, 145.070901],
  [-37.721075, 145.071030],
  [-37.720982, 145.071134],
  [-37.720859, 145.071280],
  [-37.720664, 145.071551],
  [-37.720566, 145.071704],
  [-37.720440, 145.071923],
  [-37.720354, 145.072083],
  [-37.720233, 145.072329],
  [-37.719665, 145.073518],
  [-37.719394, 145.074080],
  [-37.719062, 145.074779],
  [-37.718809, 145.075300],
  [-37.718702, 145.075510],
  [-37.718604, 145.075694],
  [-37.718487, 145.075889],
  [-37.718376, 145.076061],
  [-37.718274, 145.076209],
  [-37.718160, 145.076364],
  [-37.718053, 145.076497],
  [-37.717958, 145.076608],
  [-37.717875, 145.076700],
  [-37.717770, 145.076809],
  [-37.717574, 145.077002],
  [-37.717470, 145.077094],
  [-37.717367, 145.077180],
  [-37.717248, 145.077273],
  [-37.717136, 145.077356],
  [-37.716998, 145.077452],
  [-37.716765, 145.077602],
  [-37.716329, 145.077876],
  [-37.716191, 145.077970],
  [-37.716055, 145.078067],
  [-37.715923, 145.078168],
  [-37.715790, 145.078280],
  [-37.715588, 145.078465],
  [-37.715497, 145.078555],
  [-37.715385, 145.078677],
  [-37.715272, 145.078807],
  [-37.715067, 145.079065],
  [-37.714875, 145.079338],
  [-37.714666, 145.079664],
  [-37.714393, 145.080103],
  [-37.714236, 145.080351],
  [-37.714100, 145.080552],
  [-37.713855, 145.080894],
  [-37.713742, 145.081042],
  [-37.713653, 145.081153],
  [-37.713433, 145.081411],
  [-37.713300, 145.081560],
  [-37.713043, 145.081827],
  [-37.712783, 145.082076],
  [-37.712637, 145.082204],
  [-37.712430, 145.082399],
  [-37.712224, 145.082582],
  [-37.712107, 145.082692],
  [-37.711884, 145.082896],
  [-37.711778, 145.082988],
  [-37.711056, 145.083585],
  [-37.710980, 145.083650],
  [-37.710728, 145.083875],
  [-37.710497, 145.084102],
  [-37.710369, 145.084235],
  [-37.710261, 145.084352],
  [-37.710134, 145.084493],
  [-37.710055, 145.084586],
  [-37.709848, 145.084839],
  [-37.709493, 145.085299],
  [-37.708655, 145.086394],
  [-37.708536, 145.086551],
  [-37.708477, 145.086638],
  [-37.707588, 145.087732],
  [-37.707513, 145.087816],
  [-37.707406, 145.087929],
  [-37.707253, 145.088082],
  [-37.707101, 145.088228],
  [-37.706977, 145.088340],
  [-37.706814, 145.088481],
  [-37.706571, 145.088679],
  [-37.706333, 145.088856],
  [-37.706108, 145.089011],
  [-37.705517, 145.089390],
  [-37.704866, 145.089797],
  [-37.703453, 145.090691],
  [-37.703179, 145.090870],
  [-37.702981, 145.091007],
  [-37.702859, 145.091096],
  [-37.702607, 145.091294],
  [-37.702433, 145.091441],
  [-37.702326, 145.091535],
  [-37.702125, 145.091721],
  [-37.701916, 145.091932],
  [-37.701748, 145.092108],
  [-37.700732, 145.093212],
  [-37.700080, 145.093925],
  [-37.699913, 145.094120],
  [-37.699817, 145.094237],
  [-37.699731, 145.094355],
  [-37.699651, 145.094475],
  [-37.699585, 145.094583],
  [-37.699518, 145.094706],
  [-37.699464, 145.094812],
  [-37.699365, 145.095037],
  [-37.699331, 145.095126],
  [-37.699292, 145.095229],
  [-37.699235, 145.095412],
  [-37.699203, 145.095526],
  [-37.699173, 145.095650],
  [-37.699105, 145.095979],
  [-37.699023, 145.096402],
  [-37.698990, 145.096595],
  [-37.698962, 145.096784],
  [-37.698943, 145.096962],
  [-37.698929, 145.097165],
  [-37.698925, 145.097327],
  [-37.698931, 145.097507],
  [-37.698942, 145.097655],
  [-37.698956, 145.097795],
  [-37.698980, 145.097987],
  [-37.699005, 145.098140],
  [-37.699028, 145.098255],
  [-37.699064, 145.098398],
  [-37.699107, 145.098550],
  [-37.699176, 145.098753],
  [-37.699317, 145.099111],
  [-37.699435, 145.099399],
  [-37.699547, 145.099693],
  [-37.699659, 145.100040],
  [-37.699774, 145.100457],
  [-37.699955, 145.101183],
  [-37.700023, 145.101437],
  [-37.700087, 145.101652],
  [-37.700159, 145.101857],
  [-37.700233, 145.102044],
  [-37.700307, 145.102210],
  [-37.700385, 145.102366],
  [-37.700481, 145.102537],
  [-37.700528, 145.102614],
  [-37.700639, 145.102785],
  [-37.700727, 145.102910],
  [-37.700890, 145.103129],
  [-37.701309, 145.103685],
  [-37.701419, 145.103840],
  [-37.701511, 145.103981],
  [-37.701595, 145.104120],
  [-37.701650, 145.104216],
  [-37.701707, 145.104324],
  [-37.701771, 145.104450],
  [-37.701826, 145.104569],
  [-37.701929, 145.104805],
  [-37.702315, 145.105834],
  [-37.702455, 145.106179],
  [-37.702526, 145.106341],
  [-37.702590, 145.106470],
  [-37.702759, 145.106789],
  [-37.702873, 145.106973],
  [-37.703009, 145.107172],
  [-37.703122, 145.107331],
  [-37.703195, 145.107428],
  [-37.703280, 145.107540],
  [-37.703360, 145.107640],
  [-37.703437, 145.107730],
  [-37.703574, 145.107874],
  [-37.703659, 145.107957],
  [-37.703765, 145.108055],
  [-37.703909, 145.108176],
  [-37.705013, 145.109110],
  [-37.705157, 145.109236],
  [-37.705215, 145.109284],
  [-37.705354, 145.109408],
  [-37.705504, 145.109506],
  [-37.705685, 145.109605],
  [-37.705936, 145.109738],
  [-37.706049, 145.109794],
  [-37.706161, 145.109858],
  [-37.706260, 145.109919],
  [-37.706391, 145.109993],
  [-37.706463, 145.110051],
  [-37.706584, 145.110154],
  [-37.706683, 145.110244],
  [-37.706858, 145.110426],
  [-37.707126, 145.110720],
  [-37.707432, 145.111065],
  [-37.707998, 145.111695],
  [-37.708229, 145.111924],
  [-37.708356, 145.112045],
  [-37.708505, 145.112179],
  [-37.708628, 145.112318],
  [-37.708841, 145.112549],
  [-37.709075, 145.112793],
  [-37.709227, 145.112947],
  [-37.709349, 145.113066],
  [-37.709478, 145.113188],
  [-37.709659, 145.113352],
  [-37.709839, 145.113498],
  [-37.710119, 145.113705],
  [-37.710487, 145.113993],
  [-37.710786, 145.114247],
  [-37.710911, 145.114359],
  [-37.711246, 145.114605],
  [-37.711786, 145.115011],
  [-37.712214, 145.115341],
  [-37.712919, 145.115870],
  [-37.713221, 145.116108],
  [-37.713449, 145.116280],
  [-37.713669, 145.116472],
  [-37.713828, 145.116645],
  [-37.713995, 145.116847],
  [-37.714231, 145.117190],
  [-37.714312, 145.117317],
  [-37.714365, 145.117405],
  [-37.714482, 145.117631],
  [-37.714557, 145.117787],
  [-37.714613, 145.117917],
  [-37.714671, 145.118067],
  [-37.714713, 145.118182],
  [-37.714800, 145.118450],
  [-37.714867, 145.118695],
  [-37.714905, 145.118888],
  [-37.714931, 145.119041],
  [-37.714952, 145.119196],
  [-37.715054, 145.120016],
  [-37.715210, 145.121112],
  [-37.715266, 145.121514],
  [-37.715277, 145.121577],
  [-37.715305, 145.121703],
  [-37.715364, 145.121921],
  [-37.715429, 145.122149],
  [-37.715650, 145.122776],
  [-37.715778, 145.123121],
  [-37.715854, 145.123338],
  [-37.716056, 145.123881],
  [-37.716232, 145.124390],
  [-37.716343, 145.124740],
  [-37.716393, 145.124920],
  [-37.716445, 145.125121],
  [-37.716478, 145.125263],
  [-37.716545, 145.125582],
  [-37.716575, 145.125764],
  [-37.716601, 145.125935],
  [-37.716621, 145.126092],
  [-37.716637, 145.126247],
  [-37.716667, 145.126657],
  [-37.716681, 145.127072],
  [-37.716677, 145.127344],
  [-37.716669, 145.127567],
  [-37.716636, 145.128220],
  [-37.716613, 145.128610],
  [-37.716591, 145.128941],
  [-37.716576, 145.129128],
  [-37.716555, 145.129315],
  [-37.716530, 145.129516],
  [-37.716506, 145.129673],
  [-37.716462, 145.129919],
  [-37.716422, 145.130125],
  [-37.716354, 145.130404],
  [-37.716306, 145.130585],
  [-37.716252, 145.130765],
  [-37.716189, 145.130964],
  [-37.716121, 145.131159],
  [-37.716061, 145.131318],
  [-37.716002, 145.131463],
  [-37.715936, 145.131615],
  [-37.715826, 145.131856],
  [-37.715621, 145.132260],
  [-37.715123, 145.133196],
  [-37.714904, 145.133626],
  [-37.714822, 145.133806],
  [-37.714775, 145.133923],
  [-37.714686, 145.134176],
  [-37.714649, 145.134300],
  [-37.714613, 145.134438],
  [-37.714584, 145.134565],
  [-37.714545, 145.134770],
  [-37.714534, 145.134834],
  [-37.714522, 145.134935],
  [-37.714504, 145.135121],
  [-37.714494, 145.135269],
  [-37.714491, 145.135411],
  [-37.714492, 145.135562],
  [-37.714498, 145.135693],
  [-37.714507, 145.135822],
  [-37.714526, 145.135983],
  [-37.714548, 145.136137],
  [-37.714574, 145.136285],
  [-37.714609, 145.136438],
  [-37.714663, 145.136645],
  [-37.714718, 145.136821],
  [-37.714776, 145.136977],
  [-37.714838, 145.137124],
  [-37.714953, 145.137356],
  [-37.715013, 145.137459],
  [-37.715152, 145.137682],
  [-37.715355, 145.137976],
  [-37.715998, 145.138889],
  [-37.716181, 145.139157],
  [-37.716330, 145.139415],
  [-37.716412, 145.139574],
  [-37.716523, 145.139829],
  [-37.716601, 145.140052],
  [-37.716646, 145.140208],
  [-37.716680, 145.140337],
  [-37.716709, 145.140462],
  [-37.716751, 145.140692],
  [-37.716768, 145.140815],
  [-37.716779, 145.140931],
  [-37.716787, 145.141023],
  [-37.716794, 145.141162],
  [-37.716798, 145.141291],
  [-37.716797, 145.141443],
  [-37.716789, 145.141612],
  [-37.716765, 145.141868],
  [-37.716731, 145.142105],
  [-37.716704, 145.142234],
  [-37.716668, 145.142413],
  [-37.716408, 145.143577],
  [-37.716275, 145.144159],
  [-37.716125, 145.144839],
  [-37.716074, 145.145031],
  [-37.716032, 145.145170],
  [-37.715988, 145.145302],
  [-37.715936, 145.145442],
  [-37.715886, 145.145562],
  [-37.715851, 145.145640],
  [-37.715744, 145.145852],
  [-37.715630, 145.146043],
  [-37.715568, 145.146137],
  [-37.715411, 145.146342],
  [-37.715343, 145.146424],
  [-37.715089, 145.146702],
  [-37.715005, 145.146788],
  [-37.714885, 145.146904],
  [-37.714686, 145.147085],
  [-37.714624, 145.147141],
  [-37.714446, 145.147290],
  [-37.714286, 145.147414],
  [-37.714138, 145.147519],
  [-37.713987, 145.147619],
  [-37.713813, 145.147727],
  [-37.713486, 145.147923],
  [-37.713410, 145.147964],
  [-37.713312, 145.148014],
  [-37.713247, 145.148043],
  [-37.713210, 145.148057],
  [-37.713127, 145.148087],
  [-37.712879, 145.148164],
  [-37.712780, 145.148200],
  [-37.712689, 145.148237],
  [-37.712388, 145.148367],
  [-37.712217, 145.148453],
  [-37.711986, 145.148558],
  [-37.711735, 145.148653],
  [-37.711599, 145.148697],
  [-37.711419, 145.148749],
  [-37.711287, 145.148781],
  [-37.711155, 145.148809],
  [-37.710967, 145.148841],
  [-37.710816, 145.148863],
  [-37.710666, 145.148880],
  [-37.710557, 145.148888],
  [-37.710367, 145.148894],
  [-37.710243, 145.148894],
  [-37.710120, 145.148891],
  [-37.709974, 145.148882],
  [-37.709813, 145.148869],
  [-37.709597, 145.148847],
  [-37.708890, 145.148762],
  [-37.708719, 145.148743],
  [-37.708467, 145.148719],
  [-37.708291, 145.148711],
  [-37.708195, 145.148711],
  [-37.708098, 145.148715],
  [-37.707895, 145.148736],
  [-37.707776, 145.148759],
  [-37.707672, 145.148785],
  [-37.707571, 145.148814],
  [-37.707470, 145.148848],
  [-37.707384, 145.148881],
  [-37.707198, 145.148968],
  [-37.707091, 145.149029],
  [-37.706991, 145.149090],
  [-37.706898, 145.149151],
  [-37.706769, 145.149251],
  [-37.706675, 145.149331],
  [-37.706553, 145.149449],
  [-37.706454, 145.149553],
  [-37.706367, 145.149654],
  [-37.706266, 145.149780],
  [-37.706023, 145.150113],
  [-37.705729, 145.150534],
  [-37.705413, 145.150991],
  [-37.704829, 145.151825],
  [-37.704191, 145.152747],
  [-37.703740, 145.153405],
  [-37.703628, 145.153563],
  [-37.703433, 145.153830],
  [-37.703239, 145.154066],
  [-37.703043, 145.154278],
  [-37.702866, 145.154440],
  [-37.702679, 145.154596],
  [-37.702485, 145.154738],
  [-37.702273, 145.154864],
  [-37.702066, 145.154971],
  [-37.701875, 145.155056],
  [-37.701594, 145.155151],
  [-37.701342, 145.155211],
  [-37.701072, 145.155250],
  [-37.700885, 145.155259],
  [-37.700653, 145.155256],
  [-37.700431, 145.155232],
  [-37.700219, 145.155197],
  [-37.700026, 145.155149],
  [-37.699834, 145.155090],
  [-37.699620, 145.155007],
  [-37.699379, 145.154890],
  [-37.699221, 145.154799],
  [-37.699046, 145.154684],
  [-37.698870, 145.154557],
  [-37.698657, 145.154378],
  [-37.698528, 145.154258],
  [-37.698352, 145.154072],
  [-37.697761, 145.153383],
  [-37.697346, 145.152917],
  [-37.697074, 145.152672],
  [-37.696817, 145.152503],
  [-37.696460, 145.152353],
  [-37.696114, 145.152284],
  [-37.695804, 145.152280],
  [-37.695509, 145.152326],
  [-37.695165, 145.152454],
  [-37.693207, 145.153580],
  [-37.690913, 145.154944],
  [-37.689597, 145.155708],
  [-37.689356, 145.155840],
  [-37.689132, 145.155952],
  [-37.688848, 145.156078],
  [-37.688608, 145.156168],
  [-37.688485, 145.156210],
  [-37.688208, 145.156276],
  [-37.687876, 145.156330],
  [-37.687572, 145.156366],
  [-37.687293, 145.156384],
  [-37.687065, 145.156378],
  [-37.686799, 145.156366],
  [-37.686553, 145.156336],
  [-37.686240, 145.156276],
  [-37.685998, 145.156216],
  [-37.685751, 145.156138],
  [-37.685533, 145.156037],
  [-37.685061, 145.155706],
  [-37.684803, 145.155515],
  [-37.684641, 145.155391],
  [-37.684365, 145.155106],
  [-37.683812, 145.154492],
  [-37.683680, 145.154348],
  [-37.683212, 145.153824],
  [-37.682367, 145.152889],
  [-37.681899, 145.152411],
  [-37.681695, 145.152231],
  [-37.681527, 145.152102],
  [-37.681339, 145.151972],
  [-37.681253, 145.151918],
  [-37.680918, 145.151748],
  [-37.680725, 145.151678],
  [-37.680518, 145.151615],
  [-37.680347, 145.151573],
  [-37.680190, 145.151541],
  [-37.679901, 145.151513],
  [-37.679774, 145.151510],
  [-37.679511, 145.151523],
  [-37.679383, 145.151536],
  [-37.679216, 145.151561],
  [-37.678982, 145.151615],
  [-37.678766, 145.151685],
  [-37.678606, 145.151742],
  [-37.678404, 145.151834],
  [-37.678168, 145.151968],
  [-37.677981, 145.152093],
  [-37.677808, 145.152227],
  [-37.677668, 145.152341],
  [-37.677456, 145.152538],
  [-37.677270, 145.152734],
  [-37.676912, 145.153119],
  [-37.676595, 145.153477],
  [-37.675564, 145.154599],
  [-37.675277, 145.154926],
  [-37.675067, 145.155176],
  [-37.674866, 145.155447],
  [-37.674699, 145.155683],
  [-37.674543, 145.155919],
  [-37.674292, 145.156332],
  [-37.674080, 145.156732],
  [-37.673967, 145.156966],
  [-37.673789, 145.157367],
  [-37.673651, 145.157709],
  [-37.673520, 145.158075],
  [-37.673451, 145.158287],
  [-37.673387, 145.158513],
  [-37.673300, 145.158828],
  [-37.673242, 145.159074],
  [-37.673183, 145.159345],
  [-37.673132, 145.159616],
  [-37.673085, 145.159917],
  [-37.673051, 145.160174],
  [-37.672955, 145.161124],
  [-37.672813, 145.163034],
  [-37.672782, 145.163324],
  [-37.672729, 145.163663],
  [-37.672674, 145.163915],
  [-37.672612, 145.164160],
  [-37.672528, 145.164417],
  [-37.672399, 145.164759],
  [-37.672280, 145.165020],
  [-37.672177, 145.165214],
  [-37.672036, 145.165458],
  [-37.671119, 145.166908],
  [-37.671007, 145.167092],
  [-37.670840, 145.167414],
  [-37.670762, 145.167580],
  [-37.670683, 145.167768],
  [-37.670570, 145.168079],
  [-37.670484, 145.168348],
  [-37.667806, 145.177468],
  [-37.667758, 145.177625],
  [-37.667697, 145.177806],
  [-37.667624, 145.178000],
  [-37.667551, 145.178173],
  [-37.667391, 145.178509],
  [-37.667256, 145.178762],
  [-37.666477, 145.180127],
  [-37.666386, 145.180276],
  [-37.666284, 145.180432],
  [-37.666162, 145.180593],
  [-37.665983, 145.180796],
  [-37.665872, 145.180898],
  [-37.665706, 145.181024],
  [-37.665523, 145.181136],
  [-37.665305, 145.181230],
  [-37.665129, 145.181300],
  [-37.664818, 145.181407],
  [-37.664002, 145.181682],
  [-37.661075, 145.182673],
  [-37.660893, 145.182744],
  [-37.660752, 145.182806],
  [-37.660631, 145.182870],
  [-37.660504, 145.182948],
  [-37.660422, 145.183006],
  [-37.660348, 145.183063],
  [-37.660285, 145.183115],
  [-37.660223, 145.183172],
  [-37.660161, 145.183233],
  [-37.660091, 145.183307],
  [-37.660031, 145.183375],
  [-37.659965, 145.183457],
  [-37.659895, 145.183553],
  [-37.659794, 145.183704],
  [-37.659712, 145.183841],
  [-37.659456, 145.184294],
  [-37.659370, 145.184439],
  [-37.659278, 145.184587],
  [-37.659184, 145.184731],
  [-37.659020, 145.184964],
  [-37.658865, 145.185164],
  [-37.658773, 145.185276],
  [-37.658670, 145.185394],
  [-37.658559, 145.185516],
  [-37.658459, 145.185622],
  [-37.658388, 145.185693],
  [-37.658215, 145.185856],
  [-37.658015, 145.186029],
  [-37.657851, 145.186160],
  [-37.657695, 145.186274],
  [-37.657524, 145.186388],
  [-37.657367, 145.186488],
  [-37.657181, 145.186593],
  [-37.656958, 145.186716],
  [-37.656538, 145.186940],
  [-37.654973, 145.187780],
  [-37.654740, 145.187897],
  [-37.654521, 145.187998],
  [-37.654261, 145.188105],
  [-37.654100, 145.188165],
  [-37.653666, 145.188317],
  [-37.652224, 145.188806],
  [-37.651187, 145.189161],
  [-37.650925, 145.189243],
  [-37.650845, 145.189265],
  [-37.650760, 145.189284],
  [-37.650634, 145.189305],
  [-37.650546, 145.189315],
  [-37.650424, 145.189317],
  [-37.650299, 145.189309],
  [-37.650148, 145.189287],
  [-37.649779, 145.189214],
  [-37.649692, 145.189199],
  [-37.649596, 145.189186],
  [-37.649503, 145.189177],
  [-37.649416, 145.189174],
  [-37.649270, 145.189179],
  [-37.649135, 145.189194],
  [-37.649064, 145.189206],
  [-37.648909, 145.189243],
  [-37.648741, 145.189294],
  [-37.648346, 145.189435],
  [-37.648239, 145.189471],
  [-37.648125, 145.189506],
  [-37.648034, 145.189528],
  [-37.647899, 145.189552],
  [-37.647829, 145.189560],
  [-37.647748, 145.189566],
  [-37.647673, 145.189569],
  [-37.647521, 145.189563],
  [-37.647309, 145.189536],
  [-37.647186, 145.189514],
  [-37.646809, 145.189435],
  [-37.646667, 145.189408],
  [-37.646573, 145.189393],
  [-37.646473, 145.189380],
  [-37.646370, 145.189372],
  [-37.646270, 145.189370],
  [-37.646180, 145.189372],
  [-37.646084, 145.189380],
  [-37.646006, 145.189390],
  [-37.645925, 145.189404],
  [-37.645773, 145.189444],
  [-37.645685, 145.189473],
  [-37.645615, 145.189500],
  [-37.645533, 145.189536],
  [-37.645439, 145.189583],
  [-37.645331, 145.189645],
  [-37.645223, 145.189713],
  [-37.645029, 145.189846],
  [-37.644854, 145.189969],
  [-37.644591, 145.190145],
  [-37.644481, 145.190210],
  [-37.644378, 145.190267],
  [-37.644282, 145.190314],
  [-37.644184, 145.190356],
  [-37.644086, 145.190393],
  [-37.643989, 145.190426],
  [-37.643814, 145.190472],
  [-37.643664, 145.190499],
  [-37.643578, 145.190509],
  [-37.643493, 145.190516],
  [-37.643305, 145.190518],
  [-37.643217, 145.190515],
  [-37.643102, 145.190508],
  [-37.642865, 145.190484],
  [-37.642261, 145.190407],
  [-37.642047, 145.190388],
  [-37.641958, 145.190382],
  [-37.641878, 145.190381],
  [-37.641795, 145.190383],
  [-37.641717, 145.190388],
  [-37.641635, 145.190397],
  [-37.641462, 145.190428],
  [-37.641356, 145.190455],
  [-37.641295, 145.190475],
  [-37.641156, 145.190531],
  [-37.641012, 145.190602],
  [-37.640954, 145.190635],
  [-37.640829, 145.190716],
  [-37.640717, 145.190799],
  [-37.640594, 145.190903],
  [-37.640486, 145.191004],
  [-37.640328, 145.191165],
  [-37.639567, 145.191959],
];
// Real GTFS shape points (route "Mernda", shape 2-MDD-vpt-1.10.H) from
// Clifton Hill to Mernda, rather than straight station-to-station hops.
const MERNDA_BRANCH_LINE: [number, number][] = [
  [-37.788417, 144.995416],
  [-37.787557, 144.995563],
  [-37.787155, 144.995636],
  [-37.786891, 144.995681],
  [-37.786755, 144.995694],
  [-37.786608, 144.995695],
  [-37.786480, 144.995691],
  [-37.786352, 144.995677],
  [-37.786207, 144.995653],
  [-37.786053, 144.995612],
  [-37.785919, 144.995567],
  [-37.785743, 144.995490],
  [-37.785654, 144.995445],
  [-37.785527, 144.995370],
  [-37.785434, 144.995308],
  [-37.785317, 144.995221],
  [-37.785251, 144.995164],
  [-37.785152, 144.995072],
  [-37.784951, 144.994857],
  [-37.784682, 144.994493],
  [-37.784083, 144.993641],
  [-37.783568, 144.992891],
  [-37.782941, 144.991984],
  [-37.782733, 144.991685],
  [-37.782681, 144.991614],
  [-37.782564, 144.991469],
  [-37.782206, 144.991077],
  [-37.782123, 144.990992],
  [-37.782068, 144.990942],
  [-37.782000, 144.990887],
  [-37.781935, 144.990840],
  [-37.781884, 144.990809],
  [-37.781832, 144.990782],
  [-37.781777, 144.990756],
  [-37.781669, 144.990717],
  [-37.781618, 144.990704],
  [-37.781511, 144.990687],
  [-37.781458, 144.990684],
  [-37.781353, 144.990685],
  [-37.781297, 144.990691],
  [-37.781226, 144.990705],
  [-37.781149, 144.990726],
  [-37.781092, 144.990744],
  [-37.781044, 144.990764],
  [-37.780923, 144.990831],
  [-37.780868, 144.990867],
  [-37.780814, 144.990910],
  [-37.780762, 144.990957],
  [-37.780684, 144.991037],
  [-37.780649, 144.991079],
  [-37.780116, 144.991773],
  [-37.779921, 144.992034],
  [-37.779828, 144.992142],
  [-37.779733, 144.992241],
  [-37.779592, 144.992365],
  [-37.779456, 144.992468],
  [-37.779272, 144.992585],
  [-37.779095, 144.992663],
  [-37.778898, 144.992739],
  [-37.778699, 144.992791],
  [-37.777720, 144.992989],
  [-37.776629, 144.993214],
  [-37.776516, 144.993240],
  [-37.776221, 144.993293],
  [-37.775648, 144.993408],
  [-37.774339, 144.993684],
  [-37.773681, 144.993816],
  [-37.773121, 144.993932],
  [-37.772498, 144.994064],
  [-37.772150, 144.994151],
  [-37.771830, 144.994253],
  [-37.771527, 144.994378],
  [-37.771204, 144.994533],
  [-37.770859, 144.994717],
  [-37.769833, 144.995253],
  [-37.769100, 144.995638],
  [-37.768947, 144.995697],
  [-37.768611, 144.995850],
  [-37.768285, 144.995984],
  [-37.767854, 144.996156],
  [-37.767395, 144.996320],
  [-37.767264, 144.996353],
  [-37.766955, 144.996424],
  [-37.766570, 144.996521],
  [-37.766488, 144.996536],
  [-37.766406, 144.996557],
  [-37.765538, 144.996742],
  [-37.765116, 144.996843],
  [-37.764942, 144.996880],
  [-37.764762, 144.996914],
  [-37.763984, 144.997043],
  [-37.763602, 144.997106],
  [-37.763366, 144.997150],
  [-37.762547, 144.997285],
  [-37.761405, 144.997478],
  [-37.760526, 144.997632],
  [-37.759681, 144.997775],
  [-37.759232, 144.997846],
  [-37.757513, 144.998138],
  [-37.757180, 144.998190],
  [-37.756226, 144.998354],
  [-37.755764, 144.998436],
  [-37.754956, 144.998571],
  [-37.753730, 144.998774],
  [-37.752878, 144.998917],
  [-37.751723, 144.999118],
  [-37.751238, 144.999195],
  [-37.750867, 144.999264],
  [-37.750685, 144.999304],
  [-37.750452, 144.999357],
  [-37.749727, 144.999536],
  [-37.749294, 144.999630],
  [-37.749126, 144.999662],
  [-37.747680, 144.999914],
  [-37.745930, 145.000210],
  [-37.745245, 145.000320],
  [-37.744769, 145.000382],
  [-37.744154, 145.000345],
  [-37.743632, 145.000233],
  [-37.742520, 144.999921],
  [-37.741995, 144.999850],
  [-37.741367, 144.999905],
  [-37.740885, 144.999989],
  [-37.738852, 145.000431],
  [-37.737272, 145.000774],
  [-37.736489, 145.000955],
  [-37.735849, 145.001126],
  [-37.735249, 145.001267],
  [-37.735046, 145.001309],
  [-37.734323, 145.001466],
  [-37.734026, 145.001524],
  [-37.733435, 145.001659],
  [-37.731808, 145.002007],
  [-37.731068, 145.002168],
  [-37.730408, 145.002316],
  [-37.730126, 145.002373],
  [-37.729249, 145.002559],
  [-37.728877, 145.002645],
  [-37.728429, 145.002744],
  [-37.727761, 145.002891],
  [-37.726927, 145.003070],
  [-37.726623, 145.003132],
  [-37.725338, 145.003406],
  [-37.723468, 145.003808],
  [-37.722634, 145.004000],
  [-37.722408, 145.004059],
  [-37.722209, 145.004116],
  [-37.721782, 145.004255],
  [-37.721467, 145.004374],
  [-37.721242, 145.004466],
  [-37.721010, 145.004568],
  [-37.720790, 145.004671],
  [-37.720579, 145.004778],
  [-37.720160, 145.005001],
  [-37.719953, 145.005116],
  [-37.718852, 145.005712],
  [-37.718273, 145.006038],
  [-37.717709, 145.006371],
  [-37.717135, 145.006702],
  [-37.716655, 145.006983],
  [-37.716001, 145.007367],
  [-37.715899, 145.007430],
  [-37.715561, 145.007625],
  [-37.715297, 145.007777],
  [-37.715092, 145.007884],
  [-37.714914, 145.007968],
  [-37.714727, 145.008042],
  [-37.714543, 145.008108],
  [-37.714385, 145.008155],
  [-37.714184, 145.008205],
  [-37.714031, 145.008236],
  [-37.713310, 145.008362],
  [-37.712785, 145.008469],
  [-37.712250, 145.008593],
  [-37.711762, 145.008702],
  [-37.709913, 145.009037],
  [-37.707903, 145.009394],
  [-37.702157, 145.010420],
  [-37.700805, 145.010645],
  [-37.700639, 145.010669],
  [-37.700032, 145.010771],
  [-37.699759, 145.010820],
  [-37.699492, 145.010860],
  [-37.699040, 145.010958],
  [-37.698853, 145.011005],
  [-37.698090, 145.011207],
  [-37.697810, 145.011276],
  [-37.696614, 145.011491],
  [-37.695611, 145.011653],
  [-37.693564, 145.011983],
  [-37.693070, 145.012046],
  [-37.692473, 145.012103],
  [-37.691914, 145.012144],
  [-37.691576, 145.012173],
  [-37.688493, 145.012683],
  [-37.687933, 145.012779],
  [-37.687840, 145.012793],
  [-37.687740, 145.012811],
  [-37.684476, 145.013351],
  [-37.684208, 145.013402],
  [-37.684026, 145.013442],
  [-37.683682, 145.013533],
  [-37.683321, 145.013651],
  [-37.682917, 145.013792],
  [-37.682737, 145.013844],
  [-37.682564, 145.013891],
  [-37.682398, 145.013929],
  [-37.682013, 145.014003],
  [-37.681521, 145.014079],
  [-37.681045, 145.014164],
  [-37.680314, 145.014284],
  [-37.674847, 145.015191],
  [-37.674161, 145.015301],
  [-37.673890, 145.015348],
  [-37.672837, 145.015517],
  [-37.672535, 145.015571],
  [-37.671904, 145.015671],
  [-37.670848, 145.015852],
  [-37.670742, 145.015865],
  [-37.670157, 145.015970],
  [-37.669891, 145.016022],
  [-37.669302, 145.016163],
  [-37.669077, 145.016228],
  [-37.668537, 145.016385],
  [-37.668359, 145.016441],
  [-37.667137, 145.016809],
  [-37.665852, 145.017191],
  [-37.664609, 145.017560],
  [-37.664056, 145.017728],
  [-37.663833, 145.017801],
  [-37.663593, 145.017888],
  [-37.663343, 145.017985],
  [-37.662756, 145.018230],
  [-37.662328, 145.018454],
  [-37.661904, 145.018698],
  [-37.661499, 145.018959],
  [-37.661110, 145.019230],
  [-37.660708, 145.019546],
  [-37.660410, 145.019796],
  [-37.660062, 145.020112],
  [-37.659872, 145.020290],
  [-37.658897, 145.021234],
  [-37.658614, 145.021511],
  [-37.658223, 145.021886],
  [-37.657863, 145.022279],
  [-37.657448, 145.022822],
  [-37.657148, 145.023225],
  [-37.656642, 145.023898],
  [-37.656387, 145.024229],
  [-37.656127, 145.024517],
  [-37.655961, 145.024688],
  [-37.655801, 145.024837],
  [-37.655547, 145.025046],
  [-37.655415, 145.025149],
  [-37.655115, 145.025391],
  [-37.655003, 145.025486],
  [-37.654793, 145.025683],
  [-37.654699, 145.025779],
  [-37.654590, 145.025895],
  [-37.654407, 145.026115],
  [-37.654293, 145.026258],
  [-37.654208, 145.026375],
  [-37.654046, 145.026616],
  [-37.653888, 145.026879],
  [-37.653793, 145.027051],
  [-37.653640, 145.027349],
  [-37.652559, 145.029496],
  [-37.652506, 145.029609],
  [-37.652397, 145.029869],
  [-37.652354, 145.029989],
  [-37.652332, 145.030059],
  [-37.652288, 145.030220],
  [-37.652250, 145.030375],
  [-37.652200, 145.030605],
  [-37.652180, 145.030728],
  [-37.652163, 145.030910],
  [-37.652136, 145.031457],
  [-37.652055, 145.033122],
  [-37.652037, 145.033652],
  [-37.652035, 145.034070],
  [-37.652044, 145.034312],
  [-37.652051, 145.034677],
  [-37.652070, 145.035327],
  [-37.652075, 145.036065],
  [-37.652070, 145.036418],
  [-37.652062, 145.036779],
  [-37.652050, 145.037105],
  [-37.651994, 145.038394],
  [-37.651653, 145.045919],
  [-37.651601, 145.046796],
  [-37.651569, 145.047220],
  [-37.651541, 145.047546],
  [-37.651486, 145.048071],
  [-37.651425, 145.048613],
  [-37.650125, 145.059173],
  [-37.649890, 145.061065],
  [-37.649847, 145.061430],
  [-37.649739, 145.062290],
  [-37.649659, 145.062854],
  [-37.649551, 145.063549],
  [-37.649427, 145.064323],
  [-37.649318, 145.065062],
  [-37.649212, 145.065873],
  [-37.648993, 145.067658],
  [-37.648964, 145.067874],
  [-37.648903, 145.068404],
  [-37.648878, 145.068647],
  [-37.648856, 145.068875],
  [-37.648746, 145.070315],
  [-37.648696, 145.070816],
  [-37.648640, 145.071287],
  [-37.647443, 145.080749],
  [-37.646616, 145.087575],
  [-37.646565, 145.087905],
  [-37.646501, 145.088224],
  [-37.646426, 145.088526],
  [-37.646340, 145.088821],
  [-37.646233, 145.089125],
  [-37.646112, 145.089430],
  [-37.645991, 145.089690],
  [-37.645912, 145.089842],
  [-37.645746, 145.090134],
  [-37.645661, 145.090271],
  [-37.645478, 145.090536],
  [-37.645304, 145.090758],
  [-37.645202, 145.090883],
  [-37.645108, 145.090989],
  [-37.643811, 145.092376],
  [-37.643282, 145.092941],
  [-37.643080, 145.093152],
  [-37.642859, 145.093363],
  [-37.642582, 145.093604],
  [-37.642309, 145.093806],
  [-37.642186, 145.093882],
  [-37.641966, 145.094012],
  [-37.641801, 145.094094],
  [-37.641595, 145.094189],
  [-37.641338, 145.094283],
  [-37.641016, 145.094376],
  [-37.639854, 145.094661],
  [-37.638657, 145.094993],
  [-37.637871, 145.095273],
  [-37.637825, 145.095291],
  [-37.637505, 145.095432],
  [-37.637300, 145.095519],
  [-37.636783, 145.095701],
  [-37.636620, 145.095754],
  [-37.636006, 145.095914],
  [-37.635634, 145.095989],
  [-37.635199, 145.096065],
  [-37.633837, 145.096287],
  [-37.631930, 145.096592],
  [-37.630417, 145.096813],
  [-37.630119, 145.096846],
  [-37.628061, 145.096992],
  [-37.626264, 145.097114],
  [-37.625197, 145.097168],
  [-37.624532, 145.097199],
  [-37.622913, 145.097310],
  [-37.621031, 145.097443],
  [-37.619950, 145.097542],
  [-37.617767, 145.097702],
  [-37.617461, 145.097721],
  [-37.617049, 145.097756],
  [-37.616649, 145.097800],
  [-37.616387, 145.097842],
  [-37.616065, 145.097903],
  [-37.615469, 145.098021],
  [-37.614101, 145.098334],
  [-37.613106, 145.098565],
  [-37.612360, 145.098743],
  [-37.608455, 145.099616],
  [-37.605989, 145.100160],
  [-37.605701, 145.100219],
  [-37.605410, 145.100267],
  [-37.605089, 145.100311],
  [-37.604446, 145.100409],
  [-37.604178, 145.100454],
  [-37.603819, 145.100526],
  [-37.603518, 145.100590],
  [-37.602297, 145.100862],
];
const HURSTBRIDGE_BRANCH_LINE: [number, number][] = [CLIFTON_HILL_POSITION, ...HURSTBRIDGE_LINE];
const CLIFTONHILL_LOOP: [number, number][] = [
  [-37.816492790989656, 144.983959764190870], // Jolimont
    [-37.815823035935786, 144.97785563825553],
    [-37.81527440590607, 144.9750759227291],// exiting Parliament
  [-37.815393064919005, 144.97438123057663], 
  [-37.816131603788584, 144.9733437265942], // Parliament -> Jolimont curve
  [-37.817634854263244, 144.96826388056115], // Jolimont / MCG side
  [-37.81830019553066, 144.9661902038941], // Flinders Street
  [-37.81962871794242, 144.96119376026797],
  [-37.82032716362383, 144.9590835338242],
  [-37.82129915764358, 144.95648876990828],
  [-37.8212396948123, 144.95500037577344],
  [-37.820114282704075, 144.95311576000708],
  [-37.819330859301594, 144.95242620896954], // Southern Cross
  [-37.81764785079244, 144.95110717843116],
    [-37.816004158290546, 144.94992174254918],
  [-37.81527949037888, 144.94975812780976],
  [-37.814138418282056, 144.95003974441732],
  [-37.81371465922187, 144.9502663584635],
  [-37.81336091942794, 144.950829264709],
  [-37.811699102585074, 144.95654834454922], // Flagstaff
  [-37.809961702457514, 144.9625342832056], // Melbourne Central
  [-37.811704369421705, 144.95654762414082],
  [-37.808050963795516, 144.96916411750817],
  [-37.807981227663504, 144.96993958540307],
    [-37.80809697107995, 144.97061752072608],

  [-37.808358272498175, 144.9713049058432],
  [-37.80874077936197, 144.97177965092897],
  [-37.809237048952674, 144.97205260610428],
  [-37.81138709188395, 144.97306243861945], // Parliament
  [-37.8134221337534, 144.97401646795137],
  [-37.81391479396574, 144.97425250234232], // RIGHT TREACK 
  [-37.81418443133632, 144.97439197721198],
  [-37.81436242324288, 144.97449658336052],
  [-37.81431640835925, 144.97447008934023],
  [-37.814837194661806, 144.97484007119382],
  [-37.81520853710754, 144.9752652013244],
  [-37.81555775700814, 144.97629458077256], // loop portal
  [-37.815723447250065, 144.9770791387547],
  [-37.815823035935786, 144.97785563825553],
   // back to Jolimont
];
// Official Transport Victoria GTFS shape (simplified to ~5 m tolerance).
// Using station-to-station straight lines made the inner section cut across
// the Yarra, parks and suburbs instead of following the railway corridor.
const SANDRINGHAM_TRACK: [number, number][] = [
  [-37.81856579, 144.96671057],
  [-37.81738071, 144.97110770],
  [-37.81706793, 144.97253693],
  [-37.81703798, 144.97369203],
  [-37.81732088, 144.97510247],
  [-37.81770568, 144.97599849],
  [-37.81947767, 144.97914165],
  [-37.82018052, 144.98057695],
  [-37.82120797, 144.98201241],
  [-37.82205801, 144.98350955],
  [-37.82306408, 144.98586227],
  [-37.82430919, 144.99030535],
  [-37.82457606, 144.99095706],
  [-37.82555532, 144.99253380],
  [-37.82612063, 144.99322095],
  [-37.82681243, 144.99374245],
  [-37.82745639, 144.99401609],
  [-37.82797439, 144.99411670],
  [-37.82864493, 144.99410445],
  [-37.83069991, 144.99375168],
  [-37.83419274, 144.99301961],
  [-37.83579918, 144.99276575],
  [-37.84028357, 144.99174316],
  [-37.84888077, 144.98999442],
  [-37.85145280, 144.98958781],
  [-37.85257026, 144.98964065],
  [-37.85358234, 144.98992878],
  [-37.85457918, 144.99048124],
  [-37.85532208, 144.99111789],
  [-37.85630569, 144.99241112],
  [-37.85715194, 144.99324346],
  [-37.85884270, 144.99440517],
  [-37.85953359, 144.99473585],
  [-37.86026594, 144.99494549],
  [-37.86093056, 144.99502546],
  [-37.86165787, 144.99498654],
  [-37.87066752, 144.99335197],
  [-37.87162802, 144.99336445],
  [-37.87256268, 144.99360056],
  [-37.87875098, 144.99667066],
  [-37.87965129, 144.99718166],
  [-37.88736190, 145.00282880],
  [-37.88874032, 145.00375240],
  [-37.88940501, 145.00405978],
  [-37.89105903, 145.00457048],
  [-37.89201436, 145.00472993],
  [-37.89318671, 145.00476787],
  [-37.89454141, 145.00460688],
  [-37.90836513, 145.00196514],
  [-37.90983293, 145.00150709],
  [-37.91099356, 145.00083461],
  [-37.91189138, 145.00006505],
  [-37.91543699, 144.99598546],
  [-37.91655444, 144.99497003],
  [-37.92485612, 144.98987754],
  [-37.92608781, 144.98936447],
  [-37.92712333, 144.98926902],
  [-37.92775628, 144.98945747],
  [-37.92848767, 144.98997955],
  [-37.93023683, 144.99187380],
  [-37.93231606, 144.99381071],
  [-37.93288057, 144.99457827],
  [-37.93390999, 144.99668388],
  [-37.93430222, 144.99728469],
  [-37.94034860, 145.00400288],
  [-37.94141503, 145.00491075],
  [-37.94205352, 145.00526240],
  [-37.94270523, 145.00550559],
  [-37.94338329, 145.00564543],
  [-37.94411292, 145.00567464],
  [-37.95028507, 145.00450534],
];
// The Sandringham line is genuinely double-track its whole length — rendered
// as two thin parallel rails (a small, fixed-degree offset either side of
// the real corridor) rather than one thick line, matching how it actually
// looks on the ground and on the base map underneath.
const SANDRINGHAM_TRACK_UP: [number, number][] = offsetPolylineCoordinates(SANDRINGHAM_TRACK, "left", 0.06);
const SANDRINGHAM_TRACK_DOWN: [number, number][] = offsetPolylineCoordinates(SANDRINGHAM_TRACK, "right", 0.06);
// Real GTFS shape points (route "Craigieburn", shape 2-CGB-vpt-1.18.H) from
// Craigieburn to North Melbourne, rather than straight station-to-station hops.
const CRAIGIEBURN_LINE: [number, number][] = [
  [-37.602246, 144.943178],
  [-37.603371, 144.942691],
  [-37.603612, 144.942590],
  [-37.603815, 144.942513],
  [-37.604142, 144.942398],
  [-37.604415, 144.942310],
  [-37.604659, 144.942240],
  [-37.604780, 144.942208],
  [-37.604994, 144.942155],
  [-37.605099, 144.942131],
  [-37.605665, 144.942015],
  [-37.607336, 144.941683],
  [-37.609090, 144.941331],
  [-37.634007, 144.936299],
  [-37.634389, 144.936218],
  [-37.634552, 144.936181],
  [-37.635031, 144.936066],
  [-37.635963, 144.935826],
  [-37.636346, 144.935733],
  [-37.636644, 144.935664],
  [-37.637294, 144.935527],
  [-37.638278, 144.935329],
  [-37.639255, 144.935131],
  [-37.639563, 144.935076],
  [-37.640146, 144.934982],
  [-37.641604, 144.934757],
  [-37.642071, 144.934666],
  [-37.642444, 144.934597],
  [-37.642790, 144.934524],
  [-37.645643, 144.933947],
  [-37.646053, 144.933858],
  [-37.646344, 144.933784],
  [-37.646563, 144.933722],
  [-37.646810, 144.933645],
  [-37.647100, 144.933547],
  [-37.647453, 144.933412],
  [-37.647674, 144.933318],
  [-37.648026, 144.933155],
  [-37.648288, 144.933021],
  [-37.648512, 144.932898],
  [-37.648676, 144.932803],
  [-37.649226, 144.932469],
  [-37.651252, 144.931188],
  [-37.651531, 144.931014],
  [-37.652259, 144.930552],
  [-37.657014, 144.927546],
  [-37.657328, 144.927353],
  [-37.657524, 144.927238],
  [-37.657730, 144.927122],
  [-37.657877, 144.927043],
  [-37.658149, 144.926905],
  [-37.658382, 144.926798],
  [-37.658569, 144.926716],
  [-37.658818, 144.926613],
  [-37.659028, 144.926533],
  [-37.659216, 144.926467],
  [-37.659492, 144.926380],
  [-37.659965, 144.926250],
  [-37.660342, 144.926168],
  [-37.660941, 144.926049],
  [-37.662322, 144.925774],
  [-37.662857, 144.925671],
  [-37.663371, 144.925567],
  [-37.663590, 144.925527],
  [-37.665462, 144.925157],
  [-37.666046, 144.925040],
  [-37.667495, 144.924756],
  [-37.668704, 144.924516],
  [-37.671665, 144.923934],
  [-37.671882, 144.923889],
  [-37.674036, 144.923467],
  [-37.677056, 144.922870],
  [-37.677522, 144.922771],
  [-37.677933, 144.922671],
  [-37.678072, 144.922631],
  [-37.678188, 144.922598],
  [-37.678358, 144.922542],
  [-37.678695, 144.922424],
  [-37.678975, 144.922315],
  [-37.679162, 144.922236],
  [-37.679465, 144.922099],
  [-37.679559, 144.922054],
  [-37.679763, 144.921952],
  [-37.679945, 144.921856],
  [-37.680103, 144.921768],
  [-37.680374, 144.921611],
  [-37.680588, 144.921477],
  [-37.680808, 144.921327],
  [-37.680902, 144.921259],
  [-37.682108, 144.920330],
  [-37.682750, 144.919821],
  [-37.683184, 144.919480],
  [-37.683362, 144.919345],
  [-37.684227, 144.918663],
  [-37.684773, 144.918241],
  [-37.684896, 144.918149],
  [-37.685008, 144.918068],
  [-37.685218, 144.917922],
  [-37.685314, 144.917858],
  [-37.685599, 144.917677],
  [-37.685755, 144.917581],
  [-37.685869, 144.917516],
  [-37.686152, 144.917364],
  [-37.686359, 144.917259],
  [-37.686660, 144.917117],
  [-37.686915, 144.917007],
  [-37.687177, 144.916903],
  [-37.687450, 144.916804],
  [-37.687616, 144.916747],
  [-37.687985, 144.916636],
  [-37.688250, 144.916568],
  [-37.688469, 144.916517],
  [-37.688591, 144.916490],
  [-37.688865, 144.916439],
  [-37.688999, 144.916416],
  [-37.689224, 144.916384],
  [-37.689414, 144.916361],
  [-37.690233, 144.916284],
  [-37.692280, 144.916102],
  [-37.692689, 144.916068],
  [-37.693113, 144.916030],
  [-37.693415, 144.915999],
  [-37.693665, 144.915971],
  [-37.693892, 144.915940],
  [-37.694078, 144.915908],
  [-37.694646, 144.915821],
  [-37.694993, 144.915778],
  [-37.695170, 144.915760],
  [-37.695324, 144.915748],
  [-37.695541, 144.915736],
  [-37.696383, 144.915700],
  [-37.697294, 144.915666],
  [-37.697614, 144.915657],
  [-37.697960, 144.915655],
  [-37.698165, 144.915657],
  [-37.698493, 144.915668],
  [-37.698862, 144.915691],
  [-37.699021, 144.915706],
  [-37.699540, 144.915767],
  [-37.699815, 144.915810],
  [-37.700284, 144.915910],
  [-37.700579, 144.915978],
  [-37.700836, 144.916045],
  [-37.701027, 144.916100],
  [-37.701275, 144.916179],
  [-37.701681, 144.916318],
  [-37.701977, 144.916425],
  [-37.702248, 144.916533],
  [-37.702629, 144.916699],
  [-37.703102, 144.916900],
  [-37.703392, 144.917013],
  [-37.703566, 144.917075],
  [-37.703726, 144.917128],
  [-37.704070, 144.917234],
  [-37.704888, 144.917478],
  [-37.705387, 144.917624],
  [-37.706037, 144.917821],
  [-37.706280, 144.917890],
  [-37.706403, 144.917923],
  [-37.706619, 144.917973],
  [-37.706819, 144.918015],
  [-37.707172, 144.918084],
  [-37.707503, 144.918153],
  [-37.707676, 144.918196],
  [-37.707996, 144.918287],
  [-37.708204, 144.918357],
  [-37.711357, 144.919361],
  [-37.712174, 144.919625],
  [-37.717936, 144.921463],
  [-37.718207, 144.921552],
  [-37.718800, 144.921741],
  [-37.719289, 144.921903],
  [-37.719568, 144.922003],
  [-37.719868, 144.922121],
  [-37.720194, 144.922257],
  [-37.720483, 144.922389],
  [-37.720643, 144.922466],
  [-37.720949, 144.922618],
  [-37.721124, 144.922709],
  [-37.721383, 144.922850],
  [-37.721658, 144.923012],
  [-37.721916, 144.923171],
  [-37.722266, 144.923400],
  [-37.722472, 144.923542],
  [-37.722862, 144.923815],
  [-37.725660, 144.925805],
  [-37.725974, 144.926026],
  [-37.726300, 144.926250],
  [-37.726584, 144.926438],
  [-37.726823, 144.926587],
  [-37.726961, 144.926670],
  [-37.727281, 144.926853],
  [-37.727587, 144.927018],
  [-37.727717, 144.927086],
  [-37.728016, 144.927232],
  [-37.728432, 144.927420],
  [-37.728872, 144.927600],
  [-37.728979, 144.927641],
  [-37.729273, 144.927748],
  [-37.729538, 144.927836],
  [-37.729784, 144.927913],
  [-37.729909, 144.927950],
  [-37.730320, 144.928060],
  [-37.730452, 144.928092],
  [-37.730736, 144.928155],
  [-37.730817, 144.928172],
  [-37.731299, 144.928259],
  [-37.734024, 144.928711],
  [-37.734258, 144.928755],
  [-37.734855, 144.928851],
  [-37.735680, 144.928989],
  [-37.736311, 144.929097],
  [-37.736717, 144.929171],
  [-37.736983, 144.929209],
  [-37.737624, 144.929322],
  [-37.738052, 144.929382],
  [-37.738175, 144.929398],
  [-37.738294, 144.929411],
  [-37.738516, 144.929429],
  [-37.738817, 144.929442],
  [-37.738940, 144.929442],
  [-37.739149, 144.929439],
  [-37.739421, 144.929424],
  [-37.739668, 144.929397],
  [-37.739881, 144.929366],
  [-37.740110, 144.929325],
  [-37.740257, 144.929293],
  [-37.740365, 144.929266],
  [-37.740605, 144.929201],
  [-37.740686, 144.929175],
  [-37.741169, 144.929001],
  [-37.741244, 144.928970],
  [-37.741411, 144.928894],
  [-37.741663, 144.928773],
  [-37.741869, 144.928660],
  [-37.741966, 144.928603],
  [-37.742088, 144.928529],
  [-37.742292, 144.928400],
  [-37.742426, 144.928308],
  [-37.742564, 144.928211],
  [-37.742736, 144.928081],
  [-37.742934, 144.927919],
  [-37.743210, 144.927681],
  [-37.743359, 144.927540],
  [-37.743576, 144.927327],
  [-37.743715, 144.927169],
  [-37.744011, 144.926834],
  [-37.744286, 144.926473],
  [-37.744466, 144.926205],
  [-37.744638, 144.925933],
  [-37.744859, 144.925556],
  [-37.744992, 144.925305],
  [-37.745142, 144.925002],
  [-37.745484, 144.924267],
  [-37.746289, 144.922499],
  [-37.746376, 144.922317],
  [-37.746473, 144.922120],
  [-37.746653, 144.921777],
  [-37.746797, 144.921523],
  [-37.746941, 144.921282],
  [-37.747115, 144.921016],
  [-37.747216, 144.920866],
  [-37.747389, 144.920618],
  [-37.747502, 144.920469],
  [-37.747705, 144.920218],
  [-37.747925, 144.919962],
  [-37.748287, 144.919574],
  [-37.748487, 144.919369],
  [-37.748698, 144.919166],
  [-37.748884, 144.918995],
  [-37.749100, 144.918807],
  [-37.749334, 144.918614],
  [-37.749553, 144.918445],
  [-37.749618, 144.918393],
  [-37.749985, 144.918134],
  [-37.750223, 144.917979],
  [-37.750307, 144.917926],
  [-37.750430, 144.917853],
  [-37.750591, 144.917760],
  [-37.750696, 144.917703],
  [-37.750906, 144.917594],
  [-37.751151, 144.917478],
  [-37.751283, 144.917419],
  [-37.751484, 144.917335],
  [-37.751653, 144.917269],
  [-37.752144, 144.917089],
  [-37.752875, 144.916830],
  [-37.753550, 144.916586],
  [-37.753904, 144.916468],
  [-37.754521, 144.916274],
  [-37.754967, 144.916151],
  [-37.755228, 144.916086],
  [-37.755366, 144.916057],
  [-37.755603, 144.916027],
  [-37.755800, 144.916019],
  [-37.756172, 144.916024],
  [-37.756451, 144.916039],
  [-37.756804, 144.916077],
  [-37.757318, 144.916139],
  [-37.757741, 144.916176],
  [-37.758435, 144.916243],
  [-37.758661, 144.916273],
  [-37.758891, 144.916307],
  [-37.759605, 144.916428],
  [-37.760150, 144.916542],
  [-37.760492, 144.916625],
  [-37.760715, 144.916684],
  [-37.760888, 144.916732],
  [-37.761137, 144.916807],
  [-37.761280, 144.916855],
  [-37.761454, 144.916918],
  [-37.761700, 144.917014],
  [-37.761863, 144.917087],
  [-37.762084, 144.917193],
  [-37.762315, 144.917309],
  [-37.762541, 144.917434],
  [-37.762887, 144.917639],
  [-37.763025, 144.917723],
  [-37.763790, 144.918205],
  [-37.764051, 144.918364],
  [-37.764297, 144.918507],
  [-37.764515, 144.918627],
  [-37.764705, 144.918726],
  [-37.764924, 144.918833],
  [-37.765132, 144.918927],
  [-37.765349, 144.919020],
  [-37.765475, 144.919073],
  [-37.765734, 144.919171],
  [-37.765881, 144.919223],
  [-37.766018, 144.919269],
  [-37.766327, 144.919363],
  [-37.766555, 144.919428],
  [-37.766785, 144.919481],
  [-37.767502, 144.919634],
  [-37.768140, 144.919765],
  [-37.770543, 144.920266],
  [-37.770712, 144.920298],
  [-37.771095, 144.920379],
  [-37.771815, 144.920527],
  [-37.772603, 144.920695],
  [-37.772899, 144.920770],
  [-37.773160, 144.920844],
  [-37.773312, 144.920891],
  [-37.773609, 144.920990],
  [-37.773960, 144.921121],
  [-37.774202, 144.921222],
  [-37.774554, 144.921383],
  [-37.774779, 144.921494],
  [-37.775006, 144.921614],
  [-37.775262, 144.921758],
  [-37.775630, 144.921983],
  [-37.775738, 144.922053],
  [-37.776059, 144.922276],
  [-37.776214, 144.922386],
  [-37.776514, 144.922615],
  [-37.776605, 144.922686],
  [-37.776851, 144.922890],
  [-37.777277, 144.923273],
  [-37.778228, 144.924175],
  [-37.778381, 144.924326],
  [-37.778497, 144.924431],
  [-37.778675, 144.924600],
  [-37.779613, 144.925491],
  [-37.779956, 144.925814],
  [-37.780187, 144.926024],
  [-37.780475, 144.926268],
  [-37.780547, 144.926326],
  [-37.780845, 144.926556],
  [-37.781013, 144.926679],
  [-37.781148, 144.926774],
  [-37.781496, 144.927007],
  [-37.781612, 144.927080],
  [-37.781875, 144.927239],
  [-37.782107, 144.927370],
  [-37.782373, 144.927510],
  [-37.782552, 144.927600],
  [-37.782887, 144.927757],
  [-37.783130, 144.927861],
  [-37.783408, 144.927969],
  [-37.783561, 144.928026],
  [-37.783874, 144.928129],
  [-37.783996, 144.928167],
  [-37.784136, 144.928207],
  [-37.784378, 144.928272],
  [-37.785310, 144.928496],
  [-37.787295, 144.928968],
  [-37.787973, 144.929127],
  [-37.788934, 144.929357],
  [-37.790670, 144.929766],
  [-37.791102, 144.929871],
  [-37.791687, 144.930000],
  [-37.792514, 144.930203],
  [-37.793617, 144.930466],
  [-37.793793, 144.930513],
  [-37.793904, 144.930542],
  [-37.794087, 144.930595],
  [-37.794513, 144.930733],
  [-37.794678, 144.930790],
  [-37.794980, 144.930931],
  [-37.796303, 144.931374],
  [-37.796655, 144.931493],
  [-37.796933, 144.931584],
  [-37.798414, 144.932079],
  [-37.798672, 144.932167],
  [-37.798807, 144.932217],
  [-37.798990, 144.932295],
  [-37.799090, 144.932343],
  [-37.799247, 144.932430],
  [-37.799365, 144.932503],
  [-37.799767, 144.932761],
  [-37.800001, 144.932916],
  [-37.800202, 144.933058],
  [-37.800364, 144.933184],
  [-37.800463, 144.933268],
  [-37.800555, 144.933354],
  [-37.800703, 144.933503],
  [-37.800820, 144.933634],
  [-37.800950, 144.933790],
  [-37.801092, 144.933979],
  [-37.801196, 144.934134],
  [-37.801248, 144.934213],
  [-37.801373, 144.934419],
  [-37.801495, 144.934644],
  [-37.801582, 144.934812],
  [-37.802550, 144.936756],
  [-37.803022, 144.937712],
  [-37.803224, 144.938107],
  [-37.803274, 144.938199],
  [-37.803345, 144.938319],
  [-37.803446, 144.938476],
  [-37.803522, 144.938581],
  [-37.803599, 144.938681],
  [-37.803725, 144.938830],
  [-37.803804, 144.938919],
  [-37.803991, 144.939080],
  [-37.804032, 144.939121],
  [-37.804259, 144.939362],
  [-37.804589, 144.939678],
  [-37.804942, 144.940024],
  [-37.805301, 144.940431],
  [-37.805655, 144.940756],
  [-37.805967, 144.941026],
  [-37.806114, 144.941146],
  [-37.806310, 144.941298],
  [-37.806630, 144.941566],
  [-37.807356, 144.942138],
];
// Real GTFS shape points (route "Upfield", shape 2-UFD-vpt-64.20.H) from
// Upfield to North Melbourne, rather than straight station-to-station hops.
const UPFIELD_LINE: [number, number][] = [
  [-37.665947, 144.946742],
  [-37.668444, 144.947722],
  [-37.669014, 144.947951],
  [-37.670960, 144.948713],
  [-37.671060, 144.948755],
  [-37.672961, 144.949502],
  [-37.673409, 144.949675],
  [-37.674246, 144.950017],
  [-37.675121, 144.950355],
  [-37.675426, 144.950489],
  [-37.677274, 144.951207],
  [-37.677923, 144.951455],
  [-37.678148, 144.951543],
  [-37.678706, 144.951802],
  [-37.679400, 144.952171],
  [-37.679841, 144.952447],
  [-37.680331, 144.952790],
  [-37.680798, 144.953156],
  [-37.681308, 144.953602],
  [-37.681738, 144.953985],
  [-37.682119, 144.954283],
  [-37.682569, 144.954589],
  [-37.682991, 144.954827],
  [-37.683378, 144.954996],
  [-37.683829, 144.955184],
  [-37.684149, 144.955285],
  [-37.684494, 144.955371],
  [-37.686026, 144.955659],
  [-37.687966, 144.956020],
  [-37.688842, 144.956178],
  [-37.689713, 144.956327],
  [-37.690039, 144.956389],
  [-37.690313, 144.956450],
  [-37.690453, 144.956485],
  [-37.690721, 144.956559],
  [-37.691070, 144.956666],
  [-37.691511, 144.956813],
  [-37.692389, 144.957157],
  [-37.693114, 144.957448],
  [-37.694042, 144.957807],
  [-37.694425, 144.957963],
  [-37.694896, 144.958110],
  [-37.695117, 144.958164],
  [-37.695659, 144.958258],
  [-37.697603, 144.958489],
  [-37.698470, 144.958598],
  [-37.698867, 144.958646],
  [-37.699584, 144.958684],
  [-37.700279, 144.958718],
  [-37.700594, 144.958743],
  [-37.700628, 144.958746],
  [-37.701885, 144.958950],
  [-37.702960, 144.959084],
  [-37.703802, 144.959181],
  [-37.704514, 144.959289],
  [-37.704765, 144.959330],
  [-37.705020, 144.959367],
  [-37.708831, 144.959823],
  [-37.710339, 144.960007],
  [-37.710642, 144.960038],
  [-37.711267, 144.960115],
  [-37.713462, 144.960376],
  [-37.713516, 144.960380],
  [-37.714656, 144.960519],
  [-37.716591, 144.960750],
  [-37.717493, 144.960862],
  [-37.718933, 144.961023],
  [-37.720424, 144.961204],
  [-37.720744, 144.961237],
  [-37.721033, 144.961272],
  [-37.723770, 144.961599],
  [-37.724186, 144.961651],
  [-37.725084, 144.961755],
  [-37.726407, 144.961915],
  [-37.727266, 144.962012],
  [-37.727337, 144.962024],
  [-37.729239, 144.962245],
  [-37.730153, 144.962362],
  [-37.731201, 144.962481],
  [-37.732464, 144.962635],
  [-37.733368, 144.962741],
  [-37.734051, 144.962822],
  [-37.735101, 144.962917],
  [-37.736752, 144.963094],
  [-37.737472, 144.963181],
  [-37.737765, 144.963210],
  [-37.738340, 144.963277],
  [-37.738473, 144.963296],
  [-37.738736, 144.963326],
  [-37.738974, 144.963356],
  [-37.739404, 144.963405],
  [-37.739859, 144.963462],
  [-37.740098, 144.963485],
  [-37.740209, 144.963492],
  [-37.740317, 144.963498],
  [-37.740526, 144.963497],
  [-37.740635, 144.963494],
  [-37.740785, 144.963485],
  [-37.740970, 144.963463],
  [-37.741133, 144.963440],
  [-37.742018, 144.963302],
  [-37.743361, 144.963091],
  [-37.743622, 144.963052],
  [-37.743756, 144.963035],
  [-37.744001, 144.963008],
  [-37.744116, 144.963001],
  [-37.744273, 144.962987],
  [-37.744519, 144.962969],
  [-37.745023, 144.962935],
  [-37.745270, 144.962913],
  [-37.745938, 144.962833],
  [-37.747327, 144.962660],
  [-37.747881, 144.962593],
  [-37.751490, 144.962150],
  [-37.753169, 144.961929],
  [-37.754005, 144.961813],
  [-37.754817, 144.961707],
  [-37.754936, 144.961694],
  [-37.755387, 144.961628],
  [-37.755598, 144.961604],
  [-37.756219, 144.961521],
  [-37.756912, 144.961442],
  [-37.757078, 144.961413],
  [-37.757182, 144.961392],
  [-37.757357, 144.961361],
  [-37.757568, 144.961327],
  [-37.758603, 144.961140],
  [-37.758780, 144.961109],
  [-37.759014, 144.961072],
  [-37.759408, 144.960999],
  [-37.760603, 144.960787],
  [-37.760723, 144.960762],
  [-37.761016, 144.960707],
  [-37.762213, 144.960497],
  [-37.763321, 144.960297],
  [-37.763571, 144.960249],
  [-37.764126, 144.960151],
  [-37.765452, 144.959910],
  [-37.766297, 144.959762],
  [-37.766747, 144.959692],
  [-37.767235, 144.959631],
  [-37.767788, 144.959573],
  [-37.767932, 144.959560],
  [-37.768357, 144.959513],
  [-37.768560, 144.959494],
  [-37.769312, 144.959413],
  [-37.770342, 144.959306],
  [-37.770577, 144.959279],
  [-37.771698, 144.959164],
  [-37.772326, 144.959096],
  [-37.773205, 144.959005],
  [-37.773493, 144.958972],
  [-37.773830, 144.958928],
  [-37.774144, 144.958876],
  [-37.774529, 144.958806],
  [-37.774956, 144.958715],
  [-37.775930, 144.958498],
  [-37.776116, 144.958460],
  [-37.776746, 144.958316],
  [-37.777642, 144.958118],
  [-37.777777, 144.958087],
  [-37.778024, 144.958034],
  [-37.778325, 144.957961],
  [-37.778507, 144.957906],
  [-37.778671, 144.957849],
  [-37.778870, 144.957765],
  [-37.779083, 144.957657],
  [-37.779152, 144.957618],
  [-37.779273, 144.957545],
  [-37.779473, 144.957407],
  [-37.779613, 144.957297],
  [-37.779741, 144.957186],
  [-37.779854, 144.957076],
  [-37.779975, 144.956943],
  [-37.780093, 144.956793],
  [-37.780187, 144.956662],
  [-37.780228, 144.956600],
  [-37.780364, 144.956371],
  [-37.780444, 144.956226],
  [-37.780552, 144.956014],
  [-37.780642, 144.955822],
  [-37.780721, 144.955638],
  [-37.780788, 144.955472],
  [-37.780903, 144.955131],
  [-37.780959, 144.954938],
  [-37.780997, 144.954777],
  [-37.781039, 144.954567],
  [-37.781084, 144.954261],
  [-37.781102, 144.954097],
  [-37.781126, 144.953824],
  [-37.781149, 144.953491],
  [-37.781159, 144.953268],
  [-37.781167, 144.951892],
  [-37.781170, 144.951369],
  [-37.781187, 144.951100],
  [-37.781201, 144.950944],
  [-37.781219, 144.950797],
  [-37.781240, 144.950648],
  [-37.781279, 144.950422],
  [-37.781317, 144.950235],
  [-37.781382, 144.949960],
  [-37.781424, 144.949804],
  [-37.781526, 144.949469],
  [-37.781631, 144.949165],
  [-37.781697, 144.948993],
  [-37.781769, 144.948818],
  [-37.781852, 144.948628],
  [-37.781983, 144.948358],
  [-37.782051, 144.948225],
  [-37.782136, 144.948071],
  [-37.782201, 144.947958],
  [-37.782287, 144.947817],
  [-37.782461, 144.947550],
  [-37.782531, 144.947449],
  [-37.782626, 144.947320],
  [-37.782705, 144.947218],
  [-37.782859, 144.947027],
  [-37.783071, 144.946781],
  [-37.783250, 144.946581],
  [-37.783454, 144.946359],
  [-37.783753, 144.946048],
  [-37.784549, 144.945235],
  [-37.784823, 144.944943],
  [-37.784902, 144.944855],
  [-37.785167, 144.944543],
  [-37.785376, 144.944282],
  [-37.785533, 144.944078],
  [-37.785664, 144.943902],
  [-37.785887, 144.943581],
  [-37.786128, 144.943223],
  [-37.786411, 144.942786],
  [-37.786500, 144.942640],
  [-37.786566, 144.942527],
  [-37.786656, 144.942365],
  [-37.786752, 144.942184],
  [-37.786901, 144.941885],
  [-37.786995, 144.941690],
  [-37.787084, 144.941497],
  [-37.787190, 144.941261],
  [-37.787351, 144.940893],
  [-37.787796, 144.939903],
  [-37.787950, 144.939579],
  [-37.788057, 144.939386],
  [-37.788153, 144.939225],
  [-37.788270, 144.939039],
  [-37.788346, 144.938926],
  [-37.788491, 144.938725],
  [-37.788643, 144.938538],
  [-37.788743, 144.938421],
  [-37.789105, 144.938038],
  [-37.789421, 144.937747],
  [-37.789790, 144.937415],
  [-37.789929, 144.937302],
  [-37.790009, 144.937245],
  [-37.790121, 144.937183],
  [-37.790537, 144.936989],
  [-37.790769, 144.936891],
  [-37.791228, 144.936744],
  [-37.791638, 144.936636],
  [-37.791992, 144.936557],
  [-37.792595, 144.936441],
  [-37.793215, 144.936333],
  [-37.793501, 144.936288],
  [-37.794108, 144.936176],
  [-37.794786, 144.936055],
  [-37.795105, 144.936005],
  [-37.795545, 144.935968],
  [-37.795970, 144.935970],
  [-37.796309, 144.935998],
  [-37.796672, 144.936048],
  [-37.796813, 144.936074],
  [-37.797121, 144.936140],
  [-37.798280, 144.936451],
  [-37.798638, 144.936543],
  [-37.799287, 144.936730],
  [-37.799528, 144.936814],
  [-37.800398, 144.937054],
  [-37.801151, 144.937275],
  [-37.801850, 144.937468],
  [-37.802150, 144.937565],
  [-37.802233, 144.937599],
  [-37.802342, 144.937650],
  [-37.802511, 144.937743],
  [-37.802611, 144.937804],
  [-37.802772, 144.937916],
  [-37.802855, 144.937984],
  [-37.802910, 144.938037],
  [-37.803183, 144.938331],
  [-37.803577, 144.938774],
  [-37.803651, 144.938853],
  [-37.803721, 144.938922],
  [-37.803899, 144.939081],
  [-37.804246, 144.939459],
  [-37.804379, 144.939599],
  [-37.804608, 144.939813],
  [-37.804757, 144.939947],
  [-37.804895, 144.940084],
  [-37.804957, 144.940164],
  [-37.805280, 144.940526],
  [-37.805595, 144.940873],
  [-37.805868, 144.941134],
  [-37.806243, 144.941439],
  [-37.806569, 144.941708],
  [-37.807275, 144.942264],
];
// Real GTFS shape points (route "Werribee", shape 2-WER-vpt-1.4.R, reversed to
// run Flinders Street -> Werribee) rather than straight station-to-station hops.
const WERRIBEE_LINE: [number, number][] = [
  [-37.818566, 144.966711],
  [-37.818760, 144.965828],
  [-37.818891, 144.965252],
  [-37.818965, 144.964875],
  [-37.819028, 144.964528],
  [-37.819077, 144.964274],
  [-37.819148, 144.963967],
  [-37.819186, 144.963666],
  [-37.819469, 144.962419],
  [-37.819492, 144.962312],
  [-37.819528, 144.962071],
  [-37.819542, 144.961917],
  [-37.819553, 144.961784],
  [-37.819559, 144.961652],
  [-37.819575, 144.961411],
  [-37.819588, 144.961258],
  [-37.819606, 144.961101],
  [-37.819629, 144.960943],
  [-37.819663, 144.960755],
  [-37.819704, 144.960567],
  [-37.819739, 144.960423],
  [-37.819801, 144.960201],
  [-37.820068, 144.959288],
  [-37.820152, 144.959039],
  [-37.820238, 144.958819],
  [-37.820319, 144.958636],
  [-37.820399, 144.958471],
  [-37.820513, 144.958261],
  [-37.820599, 144.958117],
  [-37.820905, 144.957634],
  [-37.820945, 144.957567],
  [-37.821022, 144.957426],
  [-37.821085, 144.957299],
  [-37.821123, 144.957214],
  [-37.821155, 144.957137],
  [-37.821203, 144.957009],
  [-37.821255, 144.956845],
  [-37.821285, 144.956735],
  [-37.821316, 144.956600],
  [-37.821348, 144.956424],
  [-37.821367, 144.956285],
  [-37.821382, 144.956112],
  [-37.821389, 144.955980],
  [-37.821389, 144.955866],
  [-37.821385, 144.955696],
  [-37.821378, 144.955606],
  [-37.821356, 144.955398],
  [-37.821329, 144.955235],
  [-37.821299, 144.955086],
  [-37.821253, 144.954914],
  [-37.821206, 144.954770],
  [-37.821161, 144.954644],
  [-37.821122, 144.954551],
  [-37.821059, 144.954411],
  [-37.820996, 144.954291],
  [-37.820959, 144.954228],
  [-37.820915, 144.954154],
  [-37.820777, 144.953945],
  [-37.820549, 144.953632],
  [-37.820411, 144.953374],
  [-37.820127, 144.952982],
  [-37.820046, 144.952882],
  [-37.819949, 144.952784],
  [-37.819873, 144.952712],
  [-37.819794, 144.952646],
  [-37.819642, 144.952536],
  [-37.819478, 144.952442],
  [-37.819352, 144.952365],
  [-37.819278, 144.952316],
  [-37.819193, 144.952256],
  [-37.818490, 144.951700],
  [-37.818059, 144.951360],
  [-37.817992, 144.951311],
  [-37.817637, 144.951019],
  [-37.817376, 144.950799],
  [-37.816705, 144.950269],
  [-37.816386, 144.950021],
  [-37.816045, 144.949765],
  [-37.815726, 144.949505],
  [-37.815234, 144.949131],
  [-37.815028, 144.948964],
  [-37.814235, 144.948346],
  [-37.814128, 144.948271],
  [-37.813823, 144.948023],
  [-37.813637, 144.947868],
  [-37.813514, 144.947762],
  [-37.813350, 144.947612],
  [-37.813174, 144.947447],
  [-37.812925, 144.947210],
  [-37.812765, 144.947052],
  [-37.812654, 144.946937],
  [-37.812341, 144.946600],
  [-37.812145, 144.946383],
  [-37.812058, 144.946282],
  [-37.811940, 144.946136],
  [-37.811443, 144.945485],
  [-37.811298, 144.945315],
  [-37.811170, 144.945180],
  [-37.810751, 144.944749],
  [-37.810602, 144.944603],
  [-37.810530, 144.944536],
  [-37.810347, 144.944380],
  [-37.808950, 144.943283],
  [-37.808729, 144.943097],
  [-37.808518, 144.942898],
  [-37.808436, 144.942824],
  [-37.808345, 144.942748],
  [-37.808150, 144.942600],
  [-37.807949, 144.942459],
  [-37.807846, 144.942383],
  [-37.807410, 144.942040],
  [-37.806018, 144.940944],
  [-37.805704, 144.940641],
  [-37.805543, 144.940515],
  [-37.805383, 144.940375],
  [-37.805303, 144.940301],
  [-37.805225, 144.940224],
  [-37.805149, 144.940145],
  [-37.804914, 144.939884],
  [-37.804037, 144.938895],
  [-37.803850, 144.938676],
  [-37.803770, 144.938577],
  [-37.803631, 144.938392],
  [-37.803551, 144.938278],
  [-37.803501, 144.938199],
  [-37.803375, 144.937995],
  [-37.803273, 144.937812],
  [-37.803218, 144.937708],
  [-37.802671, 144.936608],
  [-37.802494, 144.936244],
  [-37.802214, 144.935687],
  [-37.802113, 144.935469],
  [-37.801740, 144.934733],
  [-37.801631, 144.934506],
  [-37.801512, 144.934238],
  [-37.801419, 144.934016],
  [-37.801378, 144.933910],
  [-37.801308, 144.933726],
  [-37.801088, 144.933116],
  [-37.801030, 144.932945],
  [-37.800978, 144.932794],
  [-37.800741, 144.932028],
  [-37.800688, 144.931850],
  [-37.800598, 144.931535],
  [-37.800517, 144.931220],
  [-37.800445, 144.930889],
  [-37.800392, 144.930620],
  [-37.800327, 144.930260],
  [-37.800115, 144.928800],
  [-37.800055, 144.928555],
  [-37.800005, 144.928297],
  [-37.799862, 144.927326],
  [-37.799759, 144.926702],
  [-37.799565, 144.925382],
  [-37.798971, 144.921361],
  [-37.798758, 144.919859],
  [-37.798009, 144.914828],
  [-37.797960, 144.914432],
  [-37.797942, 144.914191],
  [-37.797931, 144.913994],
  [-37.797927, 144.913774],
  [-37.797927, 144.913609],
  [-37.797937, 144.913343],
  [-37.797944, 144.913219],
  [-37.797975, 144.912891],
  [-37.798018, 144.912558],
  [-37.798260, 144.911016],
  [-37.798604, 144.908984],
  [-37.798688, 144.908513],
  [-37.798740, 144.908261],
  [-37.798780, 144.908082],
  [-37.798839, 144.907848],
  [-37.798979, 144.907345],
  [-37.799050, 144.907117],
  [-37.799129, 144.906890],
  [-37.799253, 144.906576],
  [-37.799765, 144.905396],
  [-37.799913, 144.905099],
  [-37.800043, 144.904860],
  [-37.800187, 144.904625],
  [-37.800606, 144.903961],
  [-37.801115, 144.903223],
  [-37.801203, 144.903099],
  [-37.801423, 144.902811],
  [-37.801742, 144.902463],
  [-37.801920, 144.902262],
  [-37.802177, 144.902003],
  [-37.802386, 144.901808],
  [-37.802600, 144.901620],
  [-37.804074, 144.900250],
  [-37.804457, 144.899913],
  [-37.805758, 144.898670],
  [-37.806152, 144.898304],
  [-37.806492, 144.897983],
  [-37.807811, 144.896753],
  [-37.808966, 144.895681],
  [-37.809719, 144.894981],
  [-37.809837, 144.894865],
  [-37.810099, 144.894620],
  [-37.810353, 144.894377],
  [-37.810904, 144.893870],
  [-37.811168, 144.893617],
  [-37.811378, 144.893427],
  [-37.811638, 144.893181],
  [-37.811955, 144.892897],
  [-37.812169, 144.892690],
  [-37.812567, 144.892316],
  [-37.813029, 144.891889],
  [-37.813525, 144.891442],
  [-37.813753, 144.891264],
  [-37.813847, 144.891172],
  [-37.814073, 144.890997],
  [-37.814257, 144.890859],
  [-37.814430, 144.890736],
  [-37.814709, 144.890544],
  [-37.814830, 144.890464],
  [-37.815075, 144.890314],
  [-37.815329, 144.890168],
  [-37.815532, 144.890056],
  [-37.815754, 144.889941],
  [-37.815937, 144.889852],
  [-37.816137, 144.889759],
  [-37.816531, 144.889591],
  [-37.816880, 144.889465],
  [-37.817113, 144.889389],
  [-37.817271, 144.889340],
  [-37.817533, 144.889268],
  [-37.819873, 144.888668],
  [-37.820341, 144.888551],
  [-37.821039, 144.888368],
  [-37.823023, 144.887855],
  [-37.824794, 144.887411],
  [-37.826593, 144.886940],
  [-37.827967, 144.886584],
  [-37.828903, 144.886343],
  [-37.829770, 144.886128],
  [-37.830578, 144.885919],
  [-37.831814, 144.885599],
  [-37.831989, 144.885560],
  [-37.832761, 144.885356],
  [-37.833775, 144.885096],
  [-37.834803, 144.884836],
  [-37.835577, 144.884633],
  [-37.837421, 144.884160],
  [-37.838136, 144.883982],
  [-37.838575, 144.883885],
  [-37.838768, 144.883852],
  [-37.839130, 144.883778],
  [-37.839477, 144.883726],
  [-37.839897, 144.883667],
  [-37.840752, 144.883577],
  [-37.841207, 144.883554],
  [-37.841415, 144.883554],
  [-37.841737, 144.883545],
  [-37.842162, 144.883545],
  [-37.842385, 144.883549],
  [-37.842570, 144.883553],
  [-37.842843, 144.883566],
  [-37.843367, 144.883591],
  [-37.843396, 144.883594],
  [-37.843535, 144.883589],
  [-37.843607, 144.883583],
  [-37.843714, 144.883568],
  [-37.844048, 144.883543],
  [-37.844337, 144.883510],
  [-37.844591, 144.883470],
  [-37.844837, 144.883389],
  [-37.844962, 144.883333],
  [-37.845110, 144.883255],
  [-37.845383, 144.883093],
  [-37.845668, 144.882873],
  [-37.845898, 144.882656],
  [-37.846203, 144.882307],
  [-37.846410, 144.882027],
  [-37.846620, 144.881684],
  [-37.846776, 144.881363],
  [-37.846928, 144.881001],
  [-37.847155, 144.880343],
  [-37.847993, 144.877867],
  [-37.848398, 144.876659],
  [-37.848466, 144.876446],
  [-37.848510, 144.876336],
  [-37.848626, 144.876064],
  [-37.848683, 144.875920],
  [-37.848745, 144.875732],
  [-37.848797, 144.875588],
  [-37.849022, 144.875003],
  [-37.849110, 144.874738],
  [-37.849162, 144.874574],
  [-37.849249, 144.874263],
  [-37.849345, 144.873875],
  [-37.849409, 144.873552],
  [-37.849440, 144.873373],
  [-37.849465, 144.873201],
  [-37.849482, 144.873061],
  [-37.849499, 144.872917],
  [-37.849526, 144.872590],
  [-37.849540, 144.872326],
  [-37.849545, 144.872141],
  [-37.849552, 144.871831],
  [-37.849551, 144.871656],
  [-37.849545, 144.871464],
  [-37.849517, 144.870931],
  [-37.849443, 144.869904],
  [-37.849359, 144.868791],
  [-37.849343, 144.868608],
  [-37.849324, 144.868423],
  [-37.849052, 144.866113],
  [-37.849004, 144.865745],
  [-37.848787, 144.864212],
  [-37.848669, 144.863466],
  [-37.848477, 144.862363],
  [-37.848408, 144.861932],
  [-37.848326, 144.861368],
  [-37.848058, 144.859057],
  [-37.848039, 144.858813],
  [-37.848017, 144.858412],
  [-37.847996, 144.858102],
  [-37.847930, 144.857303],
  [-37.847918, 144.857097],
  [-37.847915, 144.856957],
  [-37.847917, 144.856777],
  [-37.847921, 144.856648],
  [-37.847930, 144.856505],
  [-37.847942, 144.856381],
  [-37.847966, 144.856212],
  [-37.847984, 144.856097],
  [-37.848005, 144.855988],
  [-37.848062, 144.855748],
  [-37.848090, 144.855644],
  [-37.848135, 144.855504],
  [-37.848176, 144.855389],
  [-37.848212, 144.855303],
  [-37.848255, 144.855208],
  [-37.848324, 144.855074],
  [-37.848408, 144.854927],
  [-37.848476, 144.854815],
  [-37.848549, 144.854703],
  [-37.848653, 144.854564],
  [-37.848765, 144.854426],
  [-37.848846, 144.854338],
  [-37.848929, 144.854252],
  [-37.849128, 144.854076],
  [-37.849290, 144.853954],
  [-37.849382, 144.853894],
  [-37.849489, 144.853831],
  [-37.849574, 144.853785],
  [-37.849640, 144.853752],
  [-37.849799, 144.853683],
  [-37.850036, 144.853607],
  [-37.850298, 144.853555],
  [-37.850890, 144.853447],
  [-37.851065, 144.853409],
  [-37.851313, 144.853345],
  [-37.852256, 144.853050],
  [-37.853561, 144.852631],
  [-37.853941, 144.852490],
  [-37.854073, 144.852431],
  [-37.854185, 144.852389],
  [-37.854260, 144.852364],
  [-37.854529, 144.852254],
  [-37.854928, 144.852124],
  [-37.855259, 144.852013],
  [-37.855708, 144.851789],
  [-37.855890, 144.851676],
  [-37.856069, 144.851547],
  [-37.857266, 144.850496],
  [-37.857510, 144.850298],
  [-37.857816, 144.850098],
  [-37.858027, 144.850005],
  [-37.858208, 144.849938],
  [-37.858471, 144.849874],
  [-37.858796, 144.849827],
  [-37.860192, 144.849674],
  [-37.860853, 144.849598],
  [-37.861187, 144.849536],
  [-37.861508, 144.849445],
  [-37.861836, 144.849325],
  [-37.862121, 144.849184],
  [-37.862416, 144.848998],
  [-37.862678, 144.848792],
  [-37.862871, 144.848608],
  [-37.863223, 144.848211],
  [-37.863780, 144.847458],
  [-37.863989, 144.847182],
  [-37.864187, 144.846895],
  [-37.865125, 144.845608],
  [-37.865625, 144.844928],
  [-37.866039, 144.844396],
  [-37.866320, 144.844020],
  [-37.866829, 144.843273],
  [-37.866913, 144.843145],
  [-37.867007, 144.842992],
  [-37.867159, 144.842720],
  [-37.867244, 144.842558],
  [-37.867325, 144.842391],
  [-37.867392, 144.842249],
  [-37.867457, 144.842096],
  [-37.867530, 144.841909],
  [-37.867596, 144.841726],
  [-37.867668, 144.841509],
  [-37.867719, 144.841339],
  [-37.867775, 144.841137],
  [-37.867819, 144.840963],
  [-37.867837, 144.840890],
  [-37.867896, 144.840609],
  [-37.867935, 144.840391],
  [-37.867984, 144.840042],
  [-37.868008, 144.839809],
  [-37.868033, 144.839455],
  [-37.868046, 144.839108],
  [-37.868048, 144.838821],
  [-37.868035, 144.838483],
  [-37.868006, 144.838119],
  [-37.867876, 144.836831],
  [-37.867452, 144.832686],
  [-37.867300, 144.831235],
  [-37.867185, 144.830107],
  [-37.867122, 144.829479],
  [-37.867025, 144.828562],
  [-37.866503, 144.823529],
  [-37.866077, 144.819381],
  [-37.866026, 144.818973],
  [-37.866010, 144.818859],
  [-37.865976, 144.818681],
  [-37.865907, 144.818405],
  [-37.865863, 144.818257],
  [-37.865783, 144.818018],
  [-37.865629, 144.817575],
  [-37.865578, 144.817398],
  [-37.865539, 144.817238],
  [-37.865506, 144.817076],
  [-37.865470, 144.816860],
  [-37.865443, 144.816667],
  [-37.865370, 144.815972],
  [-37.865334, 144.815588],
  [-37.865318, 144.815352],
  [-37.865260, 144.814233],
  [-37.865233, 144.813880],
  [-37.865209, 144.813660],
  [-37.865188, 144.813432],
  [-37.864914, 144.810773],
  [-37.864871, 144.810389],
  [-37.864810, 144.809905],
  [-37.864615, 144.808418],
  [-37.864462, 144.807302],
  [-37.864213, 144.805435],
  [-37.863277, 144.798464],
  [-37.862784, 144.794768],
  [-37.862199, 144.790420],
  [-37.861978, 144.788762],
  [-37.861745, 144.787045],
  [-37.861688, 144.786595],
  [-37.861669, 144.786456],
  [-37.861601, 144.786040],
  [-37.861574, 144.785901],
  [-37.861524, 144.785620],
  [-37.861468, 144.785249],
  [-37.861393, 144.784668],
  [-37.861367, 144.784454],
  [-37.861347, 144.784272],
  [-37.861325, 144.784006],
  [-37.861312, 144.783764],
  [-37.861306, 144.783609],
  [-37.861304, 144.783486],
  [-37.861305, 144.783219],
  [-37.861315, 144.782944],
  [-37.861322, 144.782807],
  [-37.861343, 144.782559],
  [-37.861374, 144.782261],
  [-37.861425, 144.781918],
  [-37.861474, 144.781642],
  [-37.861577, 144.781119],
  [-37.861805, 144.779984],
  [-37.861967, 144.779325],
  [-37.862266, 144.778158],
  [-37.862313, 144.777949],
  [-37.862393, 144.777523],
  [-37.862439, 144.777321],
  [-37.862740, 144.776105],
  [-37.863038, 144.774951],
  [-37.863506, 144.773097],
  [-37.863727, 144.772251],
  [-37.863777, 144.772049],
  [-37.864159, 144.770516],
  [-37.865084, 144.766841],
  [-37.865368, 144.765738],
  [-37.865800, 144.764018],
  [-37.865908, 144.763551],
  [-37.865994, 144.763154],
  [-37.866176, 144.762272],
  [-37.866304, 144.761690],
  [-37.866402, 144.761277],
  [-37.866495, 144.760899],
  [-37.866611, 144.760453],
  [-37.866723, 144.760048],
  [-37.866845, 144.759624],
  [-37.867036, 144.758987],
  [-37.867171, 144.758528],
  [-37.867314, 144.758010],
  [-37.867365, 144.757817],
  [-37.867583, 144.756971],
  [-37.868090, 144.754938],
  [-37.868610, 144.752881],
  [-37.869036, 144.751215],
  [-37.869537, 144.749225],
  [-37.870216, 144.746547],
  [-37.870971, 144.743539],
  [-37.871405, 144.741824],
  [-37.871755, 144.740460],
  [-37.873460, 144.733717],
  [-37.873521, 144.733484],
  [-37.874488, 144.729640],
  [-37.874601, 144.729196],
  [-37.874663, 144.728961],
  [-37.875130, 144.727102],
  [-37.875412, 144.725999],
  [-37.875493, 144.725663],
  [-37.876460, 144.721851],
  [-37.876773, 144.720597],
  [-37.877260, 144.718669],
  [-37.878117, 144.715236],
  [-37.878800, 144.712551],
  [-37.878942, 144.712034],
  [-37.879149, 144.711387],
  [-37.879380, 144.710733],
  [-37.879638, 144.710064],
  [-37.879953, 144.709295],
  [-37.880689, 144.707475],
  [-37.881126, 144.706424],
  [-37.882047, 144.704157],
  [-37.882168, 144.703849],
  [-37.882302, 144.703493],
  [-37.882513, 144.702919],
  [-37.882629, 144.702585],
  [-37.882856, 144.701960],
  [-37.883044, 144.701462],
  [-37.883211, 144.701041],
  [-37.883383, 144.700616],
  [-37.883540, 144.700216],
  [-37.883721, 144.699782],
  [-37.884038, 144.699057],
  [-37.884231, 144.698626],
  [-37.884458, 144.698136],
  [-37.884703, 144.697577],
  [-37.885008, 144.696849],
  [-37.887194, 144.691456],
  [-37.888698, 144.687736],
  [-37.889883, 144.684819],
  [-37.890074, 144.684342],
  [-37.890371, 144.683572],
  [-37.890551, 144.683084],
  [-37.890831, 144.682308],
  [-37.890944, 144.682003],
  [-37.891091, 144.681618],
  [-37.891344, 144.680977],
  [-37.891501, 144.680592],
  [-37.891766, 144.679986],
  [-37.892093, 144.679257],
  [-37.892346, 144.678704],
  [-37.892602, 144.678107],
  [-37.894886, 144.672486],
  [-37.895615, 144.670674],
  [-37.896161, 144.669311],
  [-37.896959, 144.667348],
  [-37.897383, 144.666287],
  [-37.897494, 144.666021],
  [-37.898693, 144.663080],
  [-37.898732, 144.662974],
  [-37.898762, 144.662880],
  [-37.899002, 144.662071],
  [-37.899091, 144.661801],
  [-37.899145, 144.661638],
  [-37.899253, 144.661339],
  [-37.899313, 144.661178],
  [-37.899359, 144.661063],
];
// Real GTFS shape points (route "Williamstown", shape 2-WIL-vpt-1.5.R) from
// Newport to Williamstown, rather than straight station-to-station hops.
const WILLIAMSTOWN_LINE: [number, number][] = [
  [-37.842570, 144.883553],
  [-37.842843, 144.883566],
  [-37.843367, 144.883591],
  [-37.843396, 144.883594],
  [-37.843786, 144.883608],
  [-37.844042, 144.883643],
  [-37.844356, 144.883673],
  [-37.844599, 144.883711],
  [-37.845245, 144.883841],
  [-37.845577, 144.883905],
  [-37.846048, 144.884011],
  [-37.846490, 144.884127],
  [-37.846853, 144.884225],
  [-37.847208, 144.884329],
  [-37.847897, 144.884566],
  [-37.848300, 144.884717],
  [-37.848847, 144.884927],
  [-37.849283, 144.885106],
  [-37.849728, 144.885297],
  [-37.850277, 144.885554],
  [-37.851510, 144.886169],
  [-37.852142, 144.886476],
  [-37.853987, 144.887383],
  [-37.854655, 144.887717],
  [-37.854828, 144.887814],
  [-37.855382, 144.888086],
  [-37.856492, 144.888649],
  [-37.857113, 144.888943],
  [-37.858136, 144.889442],
  [-37.859208, 144.889957],
  [-37.859614, 144.890156],
  [-37.860222, 144.890471],
  [-37.860445, 144.890606],
  [-37.860791, 144.890821],
  [-37.861073, 144.891016],
  [-37.861336, 144.891222],
  [-37.861602, 144.891436],
  [-37.861910, 144.891707],
  [-37.862245, 144.892035],
  [-37.862546, 144.892361],
  [-37.862932, 144.892806],
  [-37.863285, 144.893295],
  [-37.863706, 144.893940],
  [-37.863929, 144.894322],
  [-37.863952, 144.894367],
  [-37.864115, 144.894674],
  [-37.864294, 144.895028],
  [-37.864444, 144.895348],
  [-37.864664, 144.895883],
  [-37.864845, 144.896394],
  [-37.865001, 144.896868],
  [-37.865264, 144.897656],
  [-37.865699, 144.898968],
  [-37.865906, 144.899581],
  [-37.866338, 144.900891],
  [-37.867109, 144.903190],
  [-37.867133, 144.903268],
  [-37.867182, 144.903450],
  [-37.867271, 144.903840],
  [-37.867318, 144.904017],
  [-37.867705, 144.905173],
];
const ALTONA_LOOP_LINE = ALTONA_LOOP_STATIONS.map((station) => station.position);
const RENDERED_WERRIBEE_STATIONS = alignStationsToRenderedPolyline(WERRIBEE_STATIONS, WERRIBEE_LINE, "left", 0.5);
const RENDERED_WILLIAMSTOWN_STATIONS = alignStationsToRenderedPolyline(
  WILLIAMSTOWN_STATIONS,
  WILLIAMSTOWN_LINE,
  "left",
  0.35,
);
const RENDERED_ALTONA_LOOP_STATIONS = alignStationsToRenderedPolyline(
  ALTONA_LOOP_STATIONS,
  ALTONA_LOOP_LINE,
  "left",
  0.35,
);
const RENDERED_SANDRINGHAM_STATIONS = alignStationsToRenderedPolyline(
  SANDRINGHAM_STATIONS,
  SANDRINGHAM_LINE,
  "right",
  0.5,
);
// Real GTFS shape points (route "Frankston", shape 2-FKN-vpt-65.44.R),
// Frankston to Flinders Street end to end, rather than straight
// station-to-station hops with one hand-guessed midpoint per segment.
const FRANKSTON_TRACK: [number, number][] = [
  [-38.142712, 145.126217],
  [-38.142097, 145.126484],
  [-38.141758, 145.126619],
  [-38.141278, 145.126824],
  [-38.140884, 145.126998],
  [-38.140652, 145.127098],
  [-38.139995, 145.127395],
  [-38.139848, 145.127459],
  [-38.138899, 145.127869],
  [-38.137143, 145.128632],
  [-38.136124, 145.129069],
  [-38.133473, 145.130221],
  [-38.133129, 145.130363],
  [-38.132331, 145.130668],
  [-38.131988, 145.130807],
  [-38.130881, 145.131293],
  [-38.128157, 145.132478],
  [-38.127926, 145.132587],
  [-38.127243, 145.132917],
  [-38.126991, 145.133036],
  [-38.126697, 145.133168],
  [-38.123520, 145.134553],
  [-38.122878, 145.134822],
  [-38.122462, 145.134977],
  [-38.122090, 145.135121],
  [-38.121895, 145.135201],
  [-38.121756, 145.135263],
  [-38.121484, 145.135389],
  [-38.121294, 145.135480],
  [-38.120961, 145.135649],
  [-38.120823, 145.135716],
  [-38.120609, 145.135811],
  [-38.120438, 145.135880],
  [-38.120218, 145.135954],
  [-38.119997, 145.136017],
  [-38.119773, 145.136068],
  [-38.119537, 145.136110],
  [-38.119339, 145.136134],
  [-38.119156, 145.136145],
  [-38.118963, 145.136155],
  [-38.118839, 145.136154],
  [-38.118571, 145.136143],
  [-38.118134, 145.136086],
  [-38.117837, 145.136019],
  [-38.117665, 145.135970],
  [-38.117294, 145.135844],
  [-38.116806, 145.135605],
  [-38.116371, 145.135347],
  [-38.115744, 145.134861],
  [-38.113811, 145.133207],
  [-38.112135, 145.131749],
  [-38.111599, 145.131299],
  [-38.110876, 145.130675],
  [-38.110004, 145.129943],
  [-38.109716, 145.129695],
  [-38.109266, 145.129347],
  [-38.108627, 145.128955],
  [-38.108433, 145.128857],
  [-38.108240, 145.128762],
  [-38.107867, 145.128603],
  [-38.107594, 145.128507],
  [-38.107333, 145.128427],
  [-38.107130, 145.128372],
  [-38.106897, 145.128320],
  [-38.106464, 145.128250],
  [-38.106265, 145.128230],
  [-38.105941, 145.128211],
  [-38.105567, 145.128204],
  [-38.103946, 145.128201],
  [-38.091916, 145.128179],
  [-38.091616, 145.128167],
  [-38.091102, 145.128126],
  [-38.090859, 145.128094],
  [-38.090369, 145.128016],
  [-38.090284, 145.127999],
  [-38.089774, 145.127872],
  [-38.089465, 145.127782],
  [-38.089014, 145.127625],
  [-38.088595, 145.127457],
  [-38.088308, 145.127328],
  [-38.087523, 145.126942],
  [-38.086993, 145.126670],
  [-38.084022, 145.125221],
  [-38.082372, 145.124398],
  [-38.081896, 145.124173],
  [-38.081652, 145.124068],
  [-38.081364, 145.123953],
  [-38.080971, 145.123816],
  [-38.080516, 145.123680],
  [-38.080387, 145.123647],
  [-38.078697, 145.123251],
  [-38.077434, 145.122960],
  [-38.074941, 145.122383],
  [-38.074173, 145.122197],
  [-38.073050, 145.121900],
  [-38.071933, 145.121596],
  [-38.069576, 145.120909],
  [-38.068602, 145.120643],
  [-38.068178, 145.120533],
  [-38.067984, 145.120488],
  [-38.067761, 145.120439],
  [-38.067590, 145.120405],
  [-38.067344, 145.120363],
  [-38.067059, 145.120319],
  [-38.065555, 145.120101],
  [-38.064919, 145.120008],
  [-38.063785, 145.119848],
  [-38.061898, 145.119575],
  [-38.061704, 145.119547],
  [-38.061405, 145.119498],
  [-38.061069, 145.119436],
  [-38.060781, 145.119375],
  [-38.060585, 145.119329],
  [-38.060188, 145.119222],
  [-38.059979, 145.119163],
  [-38.059732, 145.119087],
  [-38.057620, 145.118366],
  [-38.055834, 145.117751],
  [-38.055449, 145.117606],
  [-38.055005, 145.117420],
  [-38.054612, 145.117241],
  [-38.053201, 145.116578],
  [-38.051733, 145.115892],
  [-38.051060, 145.115573],
  [-38.050489, 145.115308],
  [-38.050312, 145.115222],
  [-38.049694, 145.114930],
  [-38.047387, 145.113850],
  [-38.047053, 145.113692],
  [-38.046746, 145.113541],
  [-38.046368, 145.113341],
  [-38.046119, 145.113203],
  [-38.045566, 145.112882],
  [-38.042720, 145.111204],
  [-38.038550, 145.108755],
  [-38.036264, 145.107408],
  [-38.034371, 145.106295],
  [-38.034123, 145.106146],
  [-38.031678, 145.104715],
  [-38.027218, 145.102085],
  [-38.026138, 145.101451],
  [-38.025445, 145.101048],
  [-38.024556, 145.100520],
  [-38.023943, 145.100140],
  [-38.023162, 145.099594],
  [-38.020606, 145.097695],
  [-38.020053, 145.097276],
  [-38.019605, 145.096942],
  [-38.018226, 145.095920],
  [-38.017901, 145.095667],
  [-38.017404, 145.095261],
  [-38.016707, 145.094616],
  [-38.016379, 145.094324],
  [-38.016120, 145.094116],
  [-38.015925, 145.093965],
  [-38.015820, 145.093889],
  [-38.015495, 145.093668],
  [-38.015047, 145.093351],
  [-38.013867, 145.092554],
  [-38.012595, 145.091663],
  [-38.012019, 145.091252],
  [-38.011074, 145.090561],
  [-38.009886, 145.089745],
  [-38.009498, 145.089497],
  [-38.009198, 145.089310],
  [-38.008873, 145.089111],
  [-38.008108, 145.088617],
  [-38.007755, 145.088422],
  [-38.007637, 145.088353],
  [-38.007288, 145.088141],
  [-38.006486, 145.087571],
  [-38.005899, 145.087172],
  [-38.005398, 145.086832],
  [-38.005068, 145.086612],
  [-38.004544, 145.086209],
  [-38.004437, 145.086131],
  [-38.004088, 145.085890],
  [-38.001433, 145.084077],
  [-38.001393, 145.084046],
  [-38.000978, 145.083768],
  [-38.000042, 145.083157],
  [-37.999274, 145.082639],
  [-37.998541, 145.082114],
  [-37.998155, 145.081808],
  [-37.997966, 145.081650],
  [-37.997738, 145.081446],
  [-37.997485, 145.081210],
  [-37.997144, 145.080881],
  [-37.996634, 145.080342],
  [-37.996207, 145.079858],
  [-37.995789, 145.079372],
  [-37.995619, 145.079181],
  [-37.994684, 145.078072],
  [-37.994448, 145.077803],
  [-37.993615, 145.076843],
  [-37.992848, 145.075965],
  [-37.991904, 145.074885],
  [-37.989623, 145.072247],
  [-37.988985, 145.071505],
  [-37.987435, 145.069722],
  [-37.986853, 145.069088],
  [-37.986428, 145.068660],
  [-37.986160, 145.068401],
  [-37.985607, 145.067894],
  [-37.985443, 145.067740],
  [-37.984991, 145.067347],
  [-37.984624, 145.067079],
  [-37.984154, 145.066755],
  [-37.983615, 145.066378],
  [-37.983223, 145.066109],
  [-37.983083, 145.066013],
  [-37.982463, 145.065575],
  [-37.982076, 145.065309],
  [-37.981311, 145.064750],
  [-37.981138, 145.064630],
  [-37.980562, 145.064243],
  [-37.980313, 145.064066],
  [-37.979816, 145.063724],
  [-37.978891, 145.063080],
  [-37.977761, 145.062289],
  [-37.977587, 145.062172],
  [-37.976195, 145.061192],
  [-37.973476, 145.059307],
  [-37.969654, 145.056643],
  [-37.969292, 145.056386],
  [-37.969042, 145.056198],
  [-37.968112, 145.055436],
  [-37.967806, 145.055202],
  [-37.967541, 145.055004],
  [-37.966617, 145.054363],
  [-37.966448, 145.054248],
  [-37.966442, 145.054244],
  [-37.965819, 145.053816],
  [-37.965078, 145.053317],
  [-37.964922, 145.053217],
  [-37.964486, 145.052949],
  [-37.963795, 145.052513],
  [-37.963173, 145.052127],
  [-37.962953, 145.051976],
  [-37.961757, 145.051141],
  [-37.960995, 145.050593],
  [-37.959553, 145.049609],
  [-37.959112, 145.049299],
  [-37.956807, 145.047693],
  [-37.955168, 145.046556],
  [-37.954951, 145.046402],
  [-37.954084, 145.045797],
  [-37.953162, 145.045158],
  [-37.952409, 145.044629],
  [-37.951287, 145.043848],
  [-37.950641, 145.043402],
  [-37.950088, 145.043015],
  [-37.949619, 145.042692],
  [-37.949182, 145.042383],
  [-37.948896, 145.042186],
  [-37.948764, 145.042092],
  [-37.948353, 145.041811],
  [-37.948001, 145.041566],
  [-37.948452, 145.041879],
  [-37.946116, 145.040249],
  [-37.944908, 145.039413],
  [-37.944641, 145.039224],
  [-37.943691, 145.038560],
  [-37.943434, 145.038383],
  [-37.943119, 145.038173],
  [-37.942892, 145.038029],
  [-37.942436, 145.037762],
  [-37.942202, 145.037634],
  [-37.941755, 145.037416],
  [-37.941147, 145.037173],
  [-37.940632, 145.036982],
  [-37.940230, 145.036850],
  [-37.939792, 145.036714],
  [-37.939531, 145.036642],
  [-37.939231, 145.036575],
  [-37.938954, 145.036522],
  [-37.938514, 145.036461],
  [-37.938132, 145.036423],
  [-37.937915, 145.036413],
  [-37.937661, 145.036415],
  [-37.937159, 145.036434],
  [-37.936617, 145.036423],
  [-37.936372, 145.036429],
  [-37.936146, 145.036439],
  [-37.935944, 145.036451],
  [-37.935552, 145.036469],
  [-37.935152, 145.036506],
  [-37.934649, 145.036594],
  [-37.934374, 145.036644],
  [-37.934287, 145.036662],
  [-37.933931, 145.036757],
  [-37.933631, 145.036842],
  [-37.933534, 145.036864],
  [-37.933130, 145.036950],
  [-37.932718, 145.037024],
  [-37.932475, 145.037064],
  [-37.932309, 145.037083],
  [-37.932130, 145.037099],
  [-37.931984, 145.037103],
  [-37.931829, 145.037102],
  [-37.931691, 145.037092],
  [-37.931529, 145.037074],
  [-37.931344, 145.037044],
  [-37.931144, 145.036998],
  [-37.930978, 145.036954],
  [-37.930606, 145.036831],
  [-37.930422, 145.036762],
  [-37.930240, 145.036689],
  [-37.929977, 145.036576],
  [-37.927925, 145.035635],
  [-37.927726, 145.035552],
  [-37.927539, 145.035484],
  [-37.927354, 145.035425],
  [-37.927199, 145.035386],
  [-37.926996, 145.035342],
  [-37.926848, 145.035317],
  [-37.926654, 145.035295],
  [-37.926500, 145.035284],
  [-37.926326, 145.035280],
  [-37.926145, 145.035283],
  [-37.926035, 145.035290],
  [-37.925886, 145.035302],
  [-37.925712, 145.035325],
  [-37.925435, 145.035372],
  [-37.925195, 145.035418],
  [-37.924927, 145.035470],
  [-37.924648, 145.035520],
  [-37.924410, 145.035570],
  [-37.923357, 145.035799],
  [-37.923192, 145.035831],
  [-37.923012, 145.035870],
  [-37.922048, 145.036050],
  [-37.918819, 145.036640],
  [-37.917946, 145.036787],
  [-37.917047, 145.036950],
  [-37.916310, 145.037086],
  [-37.915898, 145.037165],
  [-37.915630, 145.037224],
  [-37.914990, 145.037376],
  [-37.914590, 145.037457],
  [-37.914298, 145.037512],
  [-37.913903, 145.037585],
  [-37.913636, 145.037623],
  [-37.913390, 145.037653],
  [-37.912948, 145.037701],
  [-37.912737, 145.037729],
  [-37.912427, 145.037779],
  [-37.911508, 145.037955],
  [-37.911182, 145.038021],
  [-37.910859, 145.038091],
  [-37.910223, 145.038226],
  [-37.909641, 145.038353],
  [-37.908891, 145.038502],
  [-37.906481, 145.038944],
  [-37.906046, 145.039011],
  [-37.905736, 145.039055],
  [-37.905563, 145.039076],
  [-37.905366, 145.039105],
  [-37.905200, 145.039135],
  [-37.905011, 145.039169],
  [-37.903883, 145.039395],
  [-37.901654, 145.039829],
  [-37.901301, 145.039899],
  [-37.900455, 145.040075],
  [-37.898845, 145.040386],
  [-37.898061, 145.040540],
  [-37.897504, 145.040661],
  [-37.896182, 145.040922],
  [-37.895369, 145.041079],
  [-37.894376, 145.041275],
  [-37.893140, 145.041508],
  [-37.892198, 145.041683],
  [-37.891903, 145.041725],
  [-37.891730, 145.041755],
  [-37.891529, 145.041778],
  [-37.891270, 145.041797],
  [-37.891078, 145.041815],
  [-37.890674, 145.041869],
  [-37.890406, 145.041901],
  [-37.890153, 145.041943],
  [-37.889944, 145.041980],
  [-37.889122, 145.042134],
  [-37.888569, 145.042243],
  [-37.887986, 145.042370],
  [-37.887761, 145.042432],
  [-37.887548, 145.042507],
  [-37.887320, 145.042605],
  [-37.887091, 145.042724],
  [-37.886979, 145.042791],
  [-37.886729, 145.042974],
  [-37.886616, 145.043046],
  [-37.886252, 145.043372],
  [-37.885930, 145.043691],
  [-37.885756, 145.043876],
  [-37.885411, 145.044172],
  [-37.884760, 145.044801],
  [-37.884510, 145.045060],
  [-37.884253, 145.045321],
  [-37.884143, 145.045425],
  [-37.884015, 145.045535],
  [-37.883905, 145.045622],
  [-37.883782, 145.045709],
  [-37.883649, 145.045799],
  [-37.883541, 145.045864],
  [-37.883422, 145.045930],
  [-37.883316, 145.045985],
  [-37.883184, 145.046046],
  [-37.883081, 145.046086],
  [-37.882870, 145.046159],
  [-37.882654, 145.046218],
  [-37.882515, 145.046248],
  [-37.882433, 145.046262],
  [-37.882234, 145.046286],
  [-37.882045, 145.046297],
  [-37.881929, 145.046299],
  [-37.881807, 145.046294],
  [-37.881695, 145.046288],
  [-37.881621, 145.046280],
  [-37.881478, 145.046261],
  [-37.881367, 145.046241],
  [-37.881252, 145.046216],
  [-37.881016, 145.046151],
  [-37.880916, 145.046121],
  [-37.880645, 145.046023],
  [-37.880535, 145.045977],
  [-37.880315, 145.045881],
  [-37.880240, 145.045843],
  [-37.880160, 145.045797],
  [-37.880085, 145.045748],
  [-37.879976, 145.045675],
  [-37.879892, 145.045610],
  [-37.879810, 145.045542],
  [-37.879571, 145.045331],
  [-37.879335, 145.045100],
  [-37.879271, 145.045030],
  [-37.879136, 145.044861],
  [-37.878957, 145.044596],
  [-37.878834, 145.044400],
  [-37.878590, 145.044044],
  [-37.878523, 145.043940],
  [-37.878377, 145.043707],
  [-37.878264, 145.043518],
  [-37.878136, 145.043295],
  [-37.877869, 145.042881],
  [-37.877372, 145.042131],
  [-37.877018, 145.041601],
  [-37.876700, 145.041117],
  [-37.876585, 145.040954],
  [-37.875678, 145.039860],
  [-37.875439, 145.039581],
  [-37.875294, 145.039407],
  [-37.874808, 145.038868],
  [-37.867880, 145.031153],
  [-37.867439, 145.030644],
  [-37.867202, 145.030357],
  [-37.867061, 145.030174],
  [-37.866919, 145.029983],
  [-37.866387, 145.029260],
  [-37.866247, 145.029108],
  [-37.865892, 145.028721],
  [-37.865262, 145.028157],
  [-37.865119, 145.028023],
  [-37.864891, 145.027793],
  [-37.862333, 145.024994],
  [-37.861997, 145.024639],
  [-37.861753, 145.024390],
  [-37.861494, 145.024137],
  [-37.860607, 145.023285],
  [-37.857661, 145.020459],
  [-37.857272, 145.020077],
  [-37.856831, 145.019611],
  [-37.856564, 145.019349],
  [-37.856103, 145.018905],
  [-37.855849, 145.018671],
  [-37.855437, 145.018310],
  [-37.855027, 145.017927],
  [-37.854345, 145.017264],
  [-37.852767, 145.015740],
  [-37.852547, 145.015521],
  [-37.852347, 145.015314],
  [-37.852144, 145.015093],
  [-37.851947, 145.014870],
  [-37.851379, 145.014219],
  [-37.851196, 145.014020],
  [-37.851023, 145.013836],
  [-37.850828, 145.013654],
  [-37.850686, 145.013526],
  [-37.850488, 145.013354],
  [-37.849961, 145.012916],
  [-37.849690, 145.012676],
  [-37.849464, 145.012461],
  [-37.849133, 145.012110],
  [-37.848977, 145.011926],
  [-37.848825, 145.011738],
  [-37.848677, 145.011545],
  [-37.848533, 145.011348],
  [-37.848246, 145.010904],
  [-37.848155, 145.010752],
  [-37.848064, 145.010593],
  [-37.847891, 145.010273],
  [-37.847807, 145.010107],
  [-37.847727, 145.009939],
  [-37.847573, 145.009596],
  [-37.847487, 145.009388],
  [-37.847381, 145.009115],
  [-37.846811, 145.007603],
  [-37.846694, 145.007277],
  [-37.846611, 145.007059],
  [-37.845469, 145.003869],
  [-37.845377, 145.003607],
  [-37.845253, 145.003258],
  [-37.845075, 145.002776],
  [-37.845001, 145.002583],
  [-37.844869, 145.002253],
  [-37.844639, 145.001709],
  [-37.844563, 145.001529],
  [-37.844444, 145.001258],
  [-37.844211, 145.000710],
  [-37.843906, 145.000005],
  [-37.843558, 144.999216],
  [-37.842905, 144.997767],
  [-37.842536, 144.996942],
  [-37.842383, 144.996579],
  [-37.842158, 144.995982],
  [-37.841697, 144.994668],
  [-37.841638, 144.994483],
  [-37.841578, 144.994269],
  [-37.841504, 144.993977],
  [-37.841469, 144.993845],
  [-37.841431, 144.993718],
  [-37.841378, 144.993574],
  [-37.841319, 144.993438],
  [-37.841252, 144.993304],
  [-37.841167, 144.993155],
  [-37.841073, 144.993017],
  [-37.841012, 144.992936],
  [-37.840947, 144.992855],
  [-37.840843, 144.992746],
  [-37.840736, 144.992643],
  [-37.840626, 144.992558],
  [-37.840511, 144.992477],
  [-37.840391, 144.992408],
  [-37.840267, 144.992347],
  [-37.840139, 144.992299],
  [-37.840013, 144.992261],
  [-37.839913, 144.992240],
  [-37.839813, 144.992225],
  [-37.839616, 144.992210],
  [-37.839165, 144.992191],
  [-37.839014, 144.992193],
  [-37.838861, 144.992206],
  [-37.838717, 144.992227],
  [-37.838539, 144.992264],
  [-37.837349, 144.992511],
  [-37.836259, 144.992741],
  [-37.835676, 144.992858],
  [-37.835538, 144.992882],
  [-37.835217, 144.992927],
  [-37.834783, 144.992981],
  [-37.834485, 144.993022],
  [-37.834205, 144.993071],
  [-37.832803, 144.993360],
  [-37.831333, 144.993677],
  [-37.830592, 144.993823],
  [-37.830097, 144.993907],
  [-37.829465, 144.994021],
  [-37.828542, 144.994163],
  [-37.828203, 144.994178],
  [-37.827909, 144.994162],
  [-37.827579, 144.994102],
  [-37.827286, 144.994018],
  [-37.827184, 144.993979],
  [-37.827094, 144.993939],
  [-37.826889, 144.993840],
  [-37.826634, 144.993695],
  [-37.826460, 144.993568],
  [-37.826188, 144.993341],
  [-37.826056, 144.993209],
  [-37.825917, 144.993060],
  [-37.825752, 144.992864],
  [-37.825585, 144.992652],
  [-37.825340, 144.992329],
  [-37.825194, 144.992102],
  [-37.824867, 144.991577],
  [-37.824667, 144.991241],
  [-37.824570, 144.991066],
  [-37.824463, 144.990835],
  [-37.824376, 144.990613],
  [-37.824331, 144.990483],
  [-37.824229, 144.990151],
  [-37.824070, 144.989565],
  [-37.823237, 144.986523],
  [-37.823155, 144.986250],
  [-37.823084, 144.986035],
  [-37.822908, 144.985532],
  [-37.822811, 144.985338],
  [-37.822738, 144.985162],
  [-37.822614, 144.984805],
  [-37.822528, 144.984592],
  [-37.822465, 144.984439],
  [-37.822194, 144.983816],
  [-37.822058, 144.983510],
  [-37.821975, 144.983336],
  [-37.821810, 144.983027],
  [-37.821654, 144.982748],
  [-37.821386, 144.982297],
  [-37.821208, 144.982012],
  [-37.821017, 144.981759],
  [-37.820806, 144.981502],
  [-37.820626, 144.981277],
  [-37.820579, 144.981215],
  [-37.820492, 144.981089],
  [-37.820324, 144.980822],
  [-37.819965, 144.980208],
  [-37.819352, 144.979167],
  [-37.819291, 144.979076],
  [-37.819232, 144.978999],
  [-37.819129, 144.978853],
  [-37.818883, 144.978432],
  [-37.818803, 144.978302],
  [-37.818696, 144.978119],
  [-37.818637, 144.978031],
  [-37.818576, 144.977947],
  [-37.818474, 144.977814],
  [-37.818292, 144.977567],
  [-37.818219, 144.977455],
  [-37.817907, 144.976933],
  [-37.817661, 144.976527],
  [-37.817356, 144.976007],
  [-37.817169, 144.975662],
  [-37.817081, 144.975472],
  [-37.816939, 144.975111],
  [-37.816836, 144.974787],
  [-37.816762, 144.974515],
  [-37.816701, 144.974209],
  [-37.816673, 144.974047],
  [-37.816656, 144.973917],
  [-37.816637, 144.973743],
  [-37.816626, 144.973608],
  [-37.816618, 144.973484],
  [-37.816611, 144.973253],
  [-37.816611, 144.973133],
  [-37.816619, 144.972865],
  [-37.816630, 144.972701],
  [-37.816653, 144.972489],
  [-37.816674, 144.972336],
  [-37.816697, 144.972183],
  [-37.816737, 144.971972],
  [-37.816775, 144.971801],
  [-37.816825, 144.971608],
  [-37.816925, 144.971274],
  [-37.817076, 144.970756],
  [-37.817183, 144.970321],
  [-37.817225, 144.970137],
  [-37.817345, 144.969693],
  [-37.817398, 144.969520],
  [-37.817600, 144.968708],
  [-37.817766, 144.968141],
  [-37.817416, 144.969039],
  [-37.817359, 144.969227],
  [-37.817143, 144.969968],
  [-37.817038, 144.970257],
  [-37.816893, 144.970615],
  [-37.816867, 144.970693],
  [-37.816843, 144.970773],
  [-37.816729, 144.971183],
  [-37.816269, 144.972873],
  [-37.816159, 144.973246],
  [-37.816079, 144.973481],
  [-37.815953, 144.973742],
  [-37.815846, 144.973907],
  [-37.815719, 144.974072],
  [-37.815550, 144.974242],
  [-37.815419, 144.974346],
  [-37.815242, 144.974454],
  [-37.815033, 144.974545],
  [-37.814877, 144.974588],
  [-37.814749, 144.974607],
  [-37.814569, 144.974610],
  [-37.814414, 144.974597],
  [-37.814249, 144.974561],
  [-37.814168, 144.974533],
  [-37.814110, 144.974509],
  [-37.813954, 144.974431],
  [-37.813743, 144.974329],
  [-37.813478, 144.974184],
  [-37.812405, 144.973522],
  [-37.812087, 144.973344],
  [-37.811066, 144.972873],
  [-37.812087, 144.973344],
  [-37.812405, 144.973522],
  [-37.813478, 144.974184],
  [-37.813743, 144.974329],
  [-37.813954, 144.974431],
  [-37.814110, 144.974509],
  [-37.814168, 144.974533],
  [-37.814249, 144.974561],
  [-37.814414, 144.974597],
  [-37.814569, 144.974610],
  [-37.814749, 144.974607],
  [-37.814877, 144.974588],
  [-37.815033, 144.974545],
  [-37.815242, 144.974454],
  [-37.815419, 144.974346],
  [-37.815550, 144.974242],
  [-37.815719, 144.974072],
  [-37.815846, 144.973907],
  [-37.815953, 144.973742],
  [-37.816079, 144.973481],
  [-37.816159, 144.973246],
  [-37.816269, 144.972873],
  [-37.816729, 144.971183],
  [-37.816843, 144.970773],
  [-37.816867, 144.970693],
  [-37.816893, 144.970615],
  [-37.817038, 144.970257],
  [-37.817143, 144.969968],
  [-37.817359, 144.969227],
  [-37.817416, 144.969039],
  [-37.817766, 144.968141],
  [-37.817954, 144.967486],
  [-37.818116, 144.966900],
  [-37.818713, 144.964847],
  [-37.818782, 144.964603],
  [-37.819013, 144.963815],
  [-37.819071, 144.963608],
  [-37.819200, 144.963177],
  [-37.819254, 144.962971],
  [-37.819292, 144.962811],
  [-37.819322, 144.962673],
  [-37.819294, 144.962838],
  [-37.819260, 144.963085],
  [-37.819234, 144.963307],
  [-37.819295, 144.963044],
  [-37.819343, 144.962861],
  [-37.819416, 144.962626],
  [-37.819469, 144.962419],
  [-37.819492, 144.962312],
  [-37.819528, 144.962071],
  [-37.819542, 144.961917],
  [-37.819553, 144.961784],
  [-37.819568, 144.961496],
  [-37.819582, 144.961327],
  [-37.819597, 144.961173],
  [-37.819629, 144.960943],
  [-37.819663, 144.960755],
  [-37.819704, 144.960567],
  [-37.819739, 144.960423],
  [-37.819801, 144.960201],
  [-37.820068, 144.959288],
  [-37.820152, 144.959039],
  [-37.820238, 144.958819],
  [-37.820319, 144.958636],
  [-37.820399, 144.958471],
  [-37.820475, 144.958329],
  [-37.820559, 144.958181],
  [-37.820835, 144.957746],
  [-37.820945, 144.957567],
  [-37.821022, 144.957426],
  [-37.821085, 144.957299],
  [-37.821155, 144.957137],
  [-37.821203, 144.957009],
  [-37.821255, 144.956845],
  [-37.821304, 144.956653],
  [-37.821334, 144.956508],
  [-37.821348, 144.956424],
  [-37.821367, 144.956285],
  [-37.821376, 144.956193],
  [-37.821389, 144.955980],
  [-37.821389, 144.955866],
  [-37.821385, 144.955696],
  [-37.821378, 144.955606],
  [-37.821367, 144.955493],
  [-37.821356, 144.955398],
  [-37.821343, 144.955308],
  [-37.821315, 144.955161],
  [-37.821299, 144.955086],
  [-37.821279, 144.955008],
  [-37.821231, 144.954845],
  [-37.821183, 144.954704],
  [-37.821161, 144.954644],
  [-37.821092, 144.954482],
  [-37.821033, 144.954360],
  [-37.820996, 144.954291],
  [-37.820915, 144.954154],
  [-37.820777, 144.953945],
  [-37.820436, 144.953475],
  [-37.820158, 144.953102],
  [-37.820017, 144.952937],
  [-37.819928, 144.952851],
  [-37.819771, 144.952719],
  [-37.819633, 144.952620],
  [-37.819457, 144.952505],
  [-37.819252, 144.952350],
  [-37.818425, 144.951701],
  [-37.817530, 144.950995],
  [-37.817003, 144.950574],
  [-37.816679, 144.950320],
  [-37.816503, 144.950184],
  [-37.816327, 144.950056],
  [-37.816104, 144.949906],
  [-37.815917, 144.949817],
  [-37.815706, 144.949747],
  [-37.815492, 144.949701],
  [-37.815232, 144.949673],
  [-37.815073, 144.949679],
  [-37.814906, 144.949697],
  [-37.814735, 144.949730],
  [-37.814541, 144.949789],
  [-37.814411, 144.949839],
  [-37.814279, 144.949901],
  [-37.814153, 144.949974],
  [-37.813946, 144.950118],
  [-37.813771, 144.950274],
  [-37.813596, 144.950452],
  [-37.813448, 144.950643],
  [-37.813342, 144.950798],
  [-37.813240, 144.950974],
  [-37.813094, 144.951280],
  [-37.812974, 144.951618],
  [-37.812847, 144.952078],
  [-37.812149, 144.954531],
  [-37.810554, 144.960160],
  [-37.810159, 144.961533],
  [-37.809882, 144.962509],
  [-37.810159, 144.961533],
  [-37.810554, 144.960160],
  [-37.811861, 144.955548],
  [-37.812847, 144.952078],
  [-37.812974, 144.951618],
  [-37.813094, 144.951280],
  [-37.813240, 144.950974],
  [-37.813342, 144.950798],
  [-37.813448, 144.950643],
  [-37.813596, 144.950452],
  [-37.813771, 144.950274],
  [-37.813946, 144.950118],
  [-37.814153, 144.949974],
  [-37.814279, 144.949901],
  [-37.814411, 144.949839],
  [-37.814541, 144.949789],
  [-37.814735, 144.949730],
  [-37.814906, 144.949697],
  [-37.815073, 144.949679],
  [-37.815232, 144.949673],
  [-37.815492, 144.949701],
  [-37.815706, 144.949747],
  [-37.815917, 144.949817],
  [-37.816104, 144.949906],
  [-37.816327, 144.950056],
  [-37.816503, 144.950184],
  [-37.817003, 144.950574],
  [-37.817530, 144.950995],
  [-37.817992, 144.951311],
  [-37.818059, 144.951360],
  [-37.818490, 144.951700],
  [-37.819193, 144.952256],
  [-37.819278, 144.952316],
  [-37.819352, 144.952365],
  [-37.819478, 144.952442],
  [-37.819642, 144.952536],
  [-37.819794, 144.952646],
  [-37.819873, 144.952712],
  [-37.819949, 144.952784],
  [-37.820046, 144.952882],
  [-37.820127, 144.952982],
  [-37.820411, 144.953374],
  [-37.820549, 144.953632],
  [-37.820777, 144.953945],
  [-37.820915, 144.954154],
  [-37.820959, 144.954228],
  [-37.820996, 144.954291],
  [-37.821059, 144.954411],
  [-37.821122, 144.954551],
  [-37.821183, 144.954704],
  [-37.821253, 144.954914],
  [-37.821279, 144.955008],
  [-37.821315, 144.955161],
  [-37.821343, 144.955308],
  [-37.821356, 144.955398],
  [-37.821367, 144.955493],
  [-37.821378, 144.955606],
  [-37.821385, 144.955696],
  [-37.821389, 144.955866],
  [-37.821389, 144.955980],
  [-37.821382, 144.956112],
  [-37.821367, 144.956285],
  [-37.821348, 144.956424],
  [-37.821334, 144.956508],
  [-37.821304, 144.956653],
  [-37.821255, 144.956845],
  [-37.821203, 144.957009],
  [-37.821177, 144.957078],
  [-37.821123, 144.957214],
  [-37.821085, 144.957299],
  [-37.820987, 144.957490],
  [-37.820905, 144.957634],
  [-37.820599, 144.958117],
  [-37.820513, 144.958261],
  [-37.820399, 144.958471],
  [-37.820285, 144.958711],
  [-37.820238, 144.958819],
  [-37.820178, 144.958969],
  [-37.820092, 144.959215],
  [-37.820040, 144.959383],
  [-37.819801, 144.960201],
  [-37.819739, 144.960423],
  [-37.819704, 144.960567],
  [-37.819663, 144.960755],
  [-37.819642, 144.960866],
  [-37.819617, 144.961021],
  [-37.819597, 144.961173],
  [-37.819582, 144.961327],
  [-37.819568, 144.961496],
  [-37.819553, 144.961784],
  [-37.819528, 144.962071],
  [-37.819492, 144.962312],
  [-37.819469, 144.962419],
  [-37.819416, 144.962626],
  [-37.819343, 144.962861],
  [-37.819295, 144.963044],
  [-37.819234, 144.963307],
  [-37.819041, 144.964107],
  [-37.818967, 144.964350],
  [-37.818917, 144.964526],
  [-37.818675, 144.965411],
  [-37.818456, 144.966233],
  [-37.818352, 144.966611],
];
const RICHMOND_TO_CITY_PORTAL_TRACK: [number, number][] = FRANKSTON_TRACK.slice(
  FRANKSTON_TRACK.findIndex(([lat, lng]) => lat === -37.82423492722702 && lng === 144.9894),
  FRANKSTON_TRACK.findIndex(([lat, lng]) => lat === -37.818365904421206 && lng === 144.97726539063947) + 1,
);
const RENDERED_FRANKSTON_STATIONS = alignStationsToPolyline(FRANKSTON_STATIONS, FRANKSTON_TRACK);
const GLEN_WAVERLEY_LINE = GLEN_WAVERLEY_TRACK_POINTS;
const RENDERED_GLEN_WAVERLEY_STATIONS = alignStationsToPolyline(GLEN_WAVERLEY_STATIONS, GLEN_WAVERLEY_LINE);
const UPFIELD_DEBUG_TRACK_POINTS = offsetPolylineCoordinates(UPFIELD_LINE, "right", 0.45)
  .map((position, index) => ({ position, index }));
const GLEN_WAVERLEY_DEBUG_TRACK_POINTS = GLEN_WAVERLEY_LINE.map((position, index) => ({ position, index }));
const CAULFIELD_DEBUG_TRACK_POINTS = CAUFIELD_LOOP.map((position, index) => ({ position, index }));
const CLIFTON_HILL_DEBUG_TRACK_POINTS = CLIFTONHILL_LOOP.map((position, index) => ({ position, index }));
const NORTHERN_DEBUG_TRACK_POINTS = NORTHERN_LOOP.map((position, index) => ({ position, index }));
// Real GTFS shape points (route "Cranbourne", shape 2-CBE-vpt-1.11.H) from
// Dandenong to Cranbourne, rather than straight station-to-station hops.
const CRANBOURNE_LINE: [number, number][] = [
  [-37.990008, 145.209795],
  [-37.990114, 145.210020],
  [-37.990586, 145.211053],
  [-37.990639, 145.211161],
  [-37.990911, 145.211752],
  [-37.991209, 145.212405],
  [-37.991417, 145.212839],
  [-37.991468, 145.212935],
  [-37.991588, 145.213144],
  [-37.991658, 145.213251],
  [-37.991772, 145.213407],
  [-37.991840, 145.213492],
  [-37.991889, 145.213551],
  [-37.991962, 145.213630],
  [-37.992041, 145.213707],
  [-37.992202, 145.213855],
  [-37.992293, 145.213926],
  [-37.992466, 145.214052],
  [-37.993081, 145.214456],
  [-37.993178, 145.214516],
  [-37.993662, 145.214834],
  [-37.995142, 145.215797],
  [-37.996051, 145.216396],
  [-37.996286, 145.216558],
  [-37.996541, 145.216746],
  [-37.996747, 145.216910],
  [-37.996926, 145.217063],
  [-37.997166, 145.217285],
  [-37.997446, 145.217570],
  [-37.997580, 145.217715],
  [-37.997795, 145.217965],
  [-37.997963, 145.218178],
  [-37.998143, 145.218420],
  [-37.998336, 145.218702],
  [-37.998438, 145.218862],
  [-37.998575, 145.219088],
  [-37.998691, 145.219292],
  [-37.998809, 145.219506],
  [-37.998981, 145.219853],
  [-37.999322, 145.220591],
  [-37.999707, 145.221357],
  [-37.999928, 145.221841],
  [-38.000079, 145.222138],
  [-38.000218, 145.222393],
  [-38.000296, 145.222529],
  [-38.000403, 145.222700],
  [-38.000491, 145.222827],
  [-38.000588, 145.222956],
  [-38.000675, 145.223060],
  [-38.000782, 145.223177],
  [-38.000908, 145.223296],
  [-38.001032, 145.223406],
  [-38.001131, 145.223482],
  [-38.001223, 145.223546],
  [-38.001337, 145.223617],
  [-38.001491, 145.223703],
  [-38.001624, 145.223769],
  [-38.001773, 145.223831],
  [-38.002982, 145.224294],
  [-38.003325, 145.224436],
  [-38.005522, 145.225406],
  [-38.006007, 145.225617],
  [-38.007091, 145.226117],
  [-38.008121, 145.226584],
  [-38.008721, 145.226848],
  [-38.009350, 145.227119],
  [-38.010058, 145.227414],
  [-38.010703, 145.227670],
  [-38.011583, 145.228009],
  [-38.012321, 145.228298],
  [-38.012873, 145.228525],
  [-38.013472, 145.228781],
  [-38.015191, 145.229550],
  [-38.015706, 145.229792],
  [-38.016538, 145.230153],
  [-38.018702, 145.231106],
  [-38.019069, 145.231266],
  [-38.020731, 145.232052],
  [-38.021240, 145.232278],
  [-38.022596, 145.232890],
  [-38.023169, 145.233131],
  [-38.024414, 145.233683],
  [-38.025263, 145.234052],
  [-38.025884, 145.234329],
  [-38.026604, 145.234639],
  [-38.027630, 145.235102],
  [-38.028127, 145.235317],
  [-38.029881, 145.236140],
  [-38.030397, 145.236385],
  [-38.031095, 145.236701],
  [-38.031818, 145.237018],
  [-38.034089, 145.238026],
  [-38.034758, 145.238333],
  [-38.035090, 145.238481],
  [-38.035970, 145.238865],
  [-38.037104, 145.239353],
  [-38.037659, 145.239598],
  [-38.038641, 145.240035],
  [-38.040065, 145.240676],
  [-38.040779, 145.241001],
  [-38.041433, 145.241313],
  [-38.042816, 145.242009],
  [-38.043633, 145.242414],
  [-38.044634, 145.242924],
  [-38.045941, 145.243573],
  [-38.047486, 145.244392],
  [-38.049608, 145.245459],
  [-38.050280, 145.245800],
  [-38.050775, 145.246040],
  [-38.051388, 145.246342],
  [-38.052266, 145.246784],
  [-38.053652, 145.247476],
  [-38.054379, 145.247845],
  [-38.054684, 145.248013],
  [-38.055441, 145.248449],
  [-38.055721, 145.248607],
  [-38.056041, 145.248780],
  [-38.056176, 145.248852],
  [-38.057151, 145.249338],
  [-38.057595, 145.249563],
  [-38.057821, 145.249678],
  [-38.059348, 145.250433],
  [-38.059759, 145.250625],
  [-38.061074, 145.251195],
  [-38.063021, 145.252157],
  [-38.064754, 145.253033],
  [-38.065492, 145.253417],
  [-38.065755, 145.253569],
  [-38.066131, 145.253803],
  [-38.066473, 145.254025],
  [-38.066883, 145.254314],
  [-38.068313, 145.255399],
  [-38.070547, 145.257038],
  [-38.071148, 145.257504],
  [-38.071853, 145.258028],
  [-38.072142, 145.258255],
  [-38.072678, 145.258659],
  [-38.073986, 145.259662],
  [-38.075005, 145.260432],
  [-38.076048, 145.261236],
  [-38.077438, 145.262279],
  [-38.077693, 145.262479],
  [-38.078263, 145.262910],
  [-38.078645, 145.263207],
  [-38.078976, 145.263457],
  [-38.080015, 145.264244],
  [-38.080197, 145.264386],
  [-38.096196, 145.276557],
  [-38.097197, 145.277321],
  [-38.097464, 145.277542],
  [-38.097605, 145.277686],
  [-38.097780, 145.277877],
  [-38.097877, 145.277994],
  [-38.098190, 145.278442],
  [-38.098267, 145.278544],
  [-38.098425, 145.278741],
  [-38.098504, 145.278846],
  [-38.098764, 145.279242],
  [-38.098916, 145.279455],
  [-38.098958, 145.279513],
  [-38.099187, 145.279807],
  [-38.099401, 145.280100],
  [-38.099578, 145.280375],
  [-38.099794, 145.280720],
];
// Real, single, verified GTFS shape (600 points) extracted directly from
// Transport Victoria's own published Metro GTFS feed for route
// "aus:vic:vic-02-PKM:" — replaces the old station-to-station straight-line
// approximation below (still exported as a fallback) and the separate
// PRE_HAWKSBURN/HAWKSBURN_TO_CARNEGIE/POST_CARNEGIE patchwork rendered
// further down, which was visibly diverging from the real curve next to the
// (also real) parallel V/Line Gippsland polyline.
const PAKENHAM_GTFS_LINE: [number, number][] =
  GENERATED_METRO_GTFS.find((route) => route.id === "aus:vic:vic-02-PKM:")?.shape ?? [];
const PAKENHAM_LINE = PAKENHAM_STATIONS.map((station) => station.position);
// Real GTFS shape points (route "Pakenham", shape 2-PKM-vpt-1.1.H) from the
// Anzac curve through to Hawksburn — same straight-station-chord kink as the
// Hawksburn-to-Carnegie section above, fixed the same way.
const PAKENHAM_PRE_HAWKSBURN_LINE: [number, number][] = [
  [-37.833041, 144.972857],
  [-37.834038, 144.973904],
  [-37.834458, 144.974331],
  [-37.835372, 144.975232],
  [-37.835979, 144.975593],
  [-37.836294, 144.975926],
  [-37.836616, 144.976356],
  [-37.837074, 144.977105],
  [-37.837224, 144.977438],
  [-37.837337, 144.977755],
  [-37.837432, 144.978075],
  [-37.837502, 144.9784],
  [-37.837578, 144.978792],
  [-37.837667, 144.979331],
  [-37.837739, 144.979807],
  [-37.837837, 144.980643],
  [-37.838065, 144.982505],
  [-37.838109, 144.982912],
  [-37.838133, 144.983208],
  [-37.838154, 144.983553],
  [-37.83819, 144.984317],
  [-37.838219, 144.985059],
  [-37.838252, 144.986256],
  [-37.838267, 144.986473],
  [-37.838292, 144.986713],
  [-37.838396, 144.987323],
  [-37.83845, 144.987611],
  [-37.838713, 144.988747],
  [-37.839031, 144.989752],
  [-37.839447, 144.990821],
  [-37.839669, 144.991406],
  [-37.839976, 144.992081],
  [-37.840092, 144.992261],
  [-37.840401, 144.992602],
  [-37.840709, 144.992892],
  [-37.840806, 144.993013],
  [-37.840957, 144.993226],
  [-37.841007, 144.993307],
  [-37.841125, 144.993516],
  [-37.841266, 144.99382],
  [-37.841361, 144.994057],
  [-37.841456, 144.994321],
  [-37.84162, 144.994802],
  [-37.842053, 144.99604],
  [-37.842279, 144.996642],
  [-37.842434, 144.997005],
  [-37.843261, 144.998853],
];
// Real GTFS shape points (route "Pakenham", shape 2-PKM-vpt-1.1.H) for the
// Hawksburn-to-Carnegie section — the straight station-to-station chords this
// replaced cut a visibly kinked diagonal through the Toorak/Orrong Road
// blocks instead of following the real curving rail corridor.
const PAKENHAM_HAWKSBURN_TO_CARNEGIE_LINE: [number, number][] = [
  [-37.843261, 144.998853],
  [-37.843793, 145.000027],
  [-37.84389, 145.000259],
  [-37.843998, 145.000518],
  [-37.844094, 145.000771],
  [-37.8442, 145.001087],
  [-37.84428, 145.001349],
  [-37.844371, 145.00162],
  [-37.844469, 145.001889],
  [-37.844533, 145.002052],
  [-37.844617, 145.00225],
  [-37.844707, 145.002446],
  [-37.844845, 145.002726],
  [-37.845061, 145.003148],
  [-37.845139, 145.003317],
  [-37.845263, 145.003631],
  [-37.845936, 145.005517],
  [-37.846498, 145.007083],
  [-37.846574, 145.007301],
  [-37.847278, 145.009173],
  [-37.847386, 145.009453],
  [-37.847473, 145.009665],
  [-37.847627, 145.01001],
  [-37.847708, 145.010179],
  [-37.847793, 145.010346],
  [-37.847969, 145.010673],
  [-37.848061, 145.010835],
  [-37.848157, 145.010992],
  [-37.848448, 145.011439],
  [-37.848592, 145.011636],
  [-37.848738, 145.01183],
  [-37.848893, 145.012019],
  [-37.849052, 145.012206],
  [-37.849446, 145.012626],
  [-37.84954, 145.012724],
  [-37.850684, 145.013867],
  [-37.851236, 145.014421],
  [-37.851855, 145.015035],
  [-37.854281, 145.01739],
  [-37.855298, 145.018368],
  [-37.855418, 145.018493],
  [-37.855548, 145.018637],
  [-37.855896, 145.019048],
  [-37.855981, 145.019141],
  [-37.856156, 145.019325],
  [-37.856353, 145.019512],
  [-37.856534, 145.01967],
  [-37.856863, 145.01993],
  [-37.857034, 145.02007],
  [-37.857147, 145.020166],
  [-37.857497, 145.02049],
  [-37.861427, 145.024255],
  [-37.861781, 145.024603],
  [-37.862024, 145.024847],
  [-37.862267, 145.025108],
  [-37.862892, 145.025791],
  [-37.86474, 145.027818],
  [-37.865335, 145.028462],
  [-37.86565, 145.02881],
  [-37.866104, 145.029306],
  [-37.866264, 145.029491],
  [-37.866828, 145.030138],
  [-37.867362, 145.030755],
  [-37.8678, 145.031254],
  [-37.871425, 145.035294],
  [-37.871507, 145.035382],
  [-37.874732, 145.038971],
  [-37.875217, 145.03952],
  [-37.87536, 145.039686],
  [-37.875604, 145.039975],
  [-37.875908, 145.040344],
  [-37.876026, 145.040489],
  [-37.876184, 145.040703],
  [-37.876341, 145.040931],
  [-37.876528, 145.041229],
  [-37.876609, 145.041374],
  [-37.876759, 145.041667],
  [-37.876946, 145.042022],
  [-37.877143, 145.042352],
  [-37.877195, 145.042435],
  [-37.877614, 145.043073],
  [-37.877894, 145.043491],
  [-37.878022, 145.043662],
  [-37.878877, 145.044688],
  [-37.87896, 145.044805],
  [-37.879798, 145.046062],
  [-37.880083, 145.046464],
  [-37.880632, 145.047203],
  [-37.880874, 145.047554],
  [-37.881085, 145.047878],
  [-37.881304, 145.048247],
  [-37.881811, 145.049144],
  [-37.882136, 145.049709],
  [-37.882346, 145.050082],
  [-37.882449, 145.050269],
  [-37.882641, 145.050647],
  [-37.882826, 145.051043],
  [-37.882911, 145.051238],
  [-37.88341, 145.052446],
  [-37.883584, 145.052845],
  [-37.885184, 145.056404],
  [-37.88616, 145.058569],
  [-37.886647, 145.059659],
];
const PAKENHAM_GTFS_OUTER_TRACK: [number, number][] = [
  [-37.98991938, 145.20988129],
  [-37.99366214, 145.2148343],
  [-37.99857538, 145.21908828],
  [-38.00335143, 145.2295034],
  [-38.00919203, 145.24245965],
  [-38.01596158, 145.2575713],
  [-38.01774038, 145.2697768], // Hallam
  [-38.01850324, 145.27679548],
  [-38.02025243, 145.28945017],
  [-38.02470727, 145.29820991],
  // Real GTFS shape points (shape 2-PKM-vpt-1.1.H), Narre Warren through
  // Beaconsfield — replaces a ~10-point chord across this whole span (only
  // one real point actually at each named station, dead straight in
  // between) with the shape's real density, since the chord visibly cut
  // across the real curve right at Berwick.
  [-38.02498481, 145.29878097],
  [-38.02581811, 145.30057313],
  [-38.02602887, 145.30097042],
  [-38.02637666, 145.30163889],
  [-38.02753317, 145.3038183],
  [-38.02758542, 145.3039169],
  [-38.02777361, 145.303993], // Narre Warren
  [-38.02815102, 145.30502333],
  [-38.02864537, 145.3059521],
  [-38.02895982, 145.30657923],
  [-38.02973559, 145.30805753],
  [-38.03000561, 145.30859808],
  [-38.0302358, 145.30910115],
  [-38.03049433, 145.30975728],
  [-38.03069555, 145.31036448],
  [-38.03091679, 145.31118531],
  [-38.03119681, 145.31242316],
  [-38.03153661, 145.31388354],
  [-38.03192132, 145.31556097],
  [-38.03272088, 145.31900635],
  [-38.03304086, 145.32033997],
  [-38.03405283, 145.32478704],
  [-38.03422293, 145.3256441],
  [-38.03434982, 145.32637874],
  [-38.03442387, 145.32687646],
  [-38.0345504, 145.3279347],
  [-38.03465072, 145.32894991],
  [-38.03541554, 145.33709441],
  [-38.03549572, 145.33784415],
  [-38.03562985, 145.33862459],
  [-38.03582737, 145.33944541],
  [-38.03608093, 145.34023387],
  [-38.03629322, 145.34076768],
  [-38.03660026, 145.341432],
  [-38.03683903, 145.34185709],
  [-38.03701928, 145.34215817],
  [-38.03719531, 145.34242858],
  [-38.0372715, 145.3425399],
  [-38.03742042, 145.34274745],
  [-38.03760152, 145.34298129],
  [-38.037888, 145.34333843],
  [-38.03825272, 145.34375443],
  [-38.03835066, 145.34386162],
  [-38.03871521, 145.34424082],
  [-38.0388333, 145.34435827],
  [-38.03909049, 145.34460042],
  [-38.03942171, 145.34489743],
  [-38.03977582, 145.34519382],
  [-38.03998037, 145.34541666], // Berwick
  [-38.04023264, 145.34554601],
  [-38.04066346, 145.34585093],
  [-38.04118706, 145.3462096],
  [-38.04139851, 145.34636575],
  [-38.04165534, 145.34655095],
  [-38.04184821, 145.34669897],
  [-38.04206662, 145.34687604],
  [-38.04226723, 145.34704883],
  [-38.04250682, 145.34726463],
  [-38.04283082, 145.34757334],
  [-38.04329917, 145.34802843],
  [-38.04371171, 145.34845025],
  [-38.04389491, 145.34865467],
  [-38.04412022, 145.34892492],
  [-38.04429368, 145.34914142],
  [-38.04447297, 145.34938855],
  [-38.04461888, 145.34960088],
  [-38.04478003, 145.34985184],
  [-38.0449155, 145.35007831],
  [-38.04513022, 145.35046721],
  [-38.04521514, 145.3506302],
  [-38.04544527, 145.35112235],
  [-38.04570407, 145.35175003],
  [-38.04601994, 145.35253462],
  [-38.04632511, 145.35330167],
  [-38.04641608, 145.35354225],
  [-38.0465741, 145.35393108],
  [-38.04680738, 145.35453987],
  [-38.04721063, 145.35565141],
  [-38.04786441, 145.35752455],
  [-38.04800838, 145.35792784],
  [-38.04986237, 145.36321631],
  [-38.0500311, 145.36370328],
  [-38.05039538, 145.3647342],
  [-38.05083135, 145.36607374], // Beaconsfield
  [-38.05164161, 145.36829792],
  [-38.05190243, 145.36902619],
  [-38.05200478, 145.36957465],
  [-38.05211641, 145.36978659],
  [-38.05416412, 145.37286641],
  [-38.06054732, 145.38190247],
  [-38.06614572, 145.41098723], // Officer
  [-38.07129047, 145.43779101], // Cardinia Road
  [-38.07570761, 145.46122386],
  [-38.08061397, 145.48637907], // Pakenham
  [-38.08252702, 145.49774578],
  [-38.08430672, 145.50663267], // East Pakenham
];
// Real GTFS shape points (route "Pakenham", shape 2-PKM-vpt-1.1.H) for
// Carnegie through to Dandenong — replaces the same straight-station-chord
// kink pattern as the two segments above (Murrumbeena/Hughesdale/Oakleigh/
// Huntingdale/Clayton/Westall/Springvale/Sandown Park/Noble Park/Yarraman
// were previously just chorded dot-to-dot).
const PAKENHAM_CARNEGIE_TO_DANDENONG_LINE: [number, number][] = [
  [-37.886647, 145.059659],
  [-37.888994, 145.064807],
  [-37.889333, 145.065608],
  [-37.890135, 145.067388],
  [-37.890694, 145.068625],
  [-37.890992, 145.069288],
  [-37.891334, 145.070065],
  [-37.892491, 145.072635],
  [-37.893032, 145.073816],
  [-37.893932, 145.075813],
  [-37.894936, 145.078037],
  [-37.895067, 145.078311],
  [-37.895544, 145.079276],
  [-37.895796, 145.079821],
  [-37.897955, 145.084608],
  [-37.898369, 145.085517],
  [-37.89852, 145.085825],
  [-37.898636, 145.086037],
  [-37.898764, 145.08625],
  [-37.898956, 145.08654],
  [-37.899302, 145.087011],
  [-37.8996, 145.087399],
  [-37.900318, 145.088348],
  [-37.900689, 145.088842],
  [-37.901268, 145.089605],
  [-37.901471, 145.089866],
  [-37.902098, 145.090649],
  [-37.902349, 145.090975],
  [-37.904308, 145.093561],
  [-37.904882, 145.094324],
  [-37.905998, 145.095795],
  [-37.909603, 145.10056],
  [-37.909849, 145.100899],
  [-37.910211, 145.101418],
  [-37.91036, 145.101625],
  [-37.911006, 145.102483],
  [-37.911794, 145.103537],
  [-37.912784, 145.104839],
  [-37.914944, 145.107694],
  [-37.916679, 145.109997],
  [-37.917686, 145.111325],
  [-37.919281, 145.113439],
  [-37.920322, 145.114814],
  [-37.920498, 145.115052],
  [-37.920703, 145.115344],
  [-37.920845, 145.115556],
  [-37.921368, 145.116369],
  [-37.921516, 145.116595],
  [-37.921658, 145.116805],
  [-37.921819, 145.117032],
  [-37.921927, 145.11718],
  [-37.922521, 145.117948],
  [-37.922803, 145.118319],
  [-37.923007, 145.118597],
  [-37.923617, 145.119449],
  [-37.923826, 145.119737],
  [-37.924742, 145.120953],
  [-37.926937, 145.123858],
  [-37.927295, 145.124318],
  [-37.927593, 145.124687],
  [-37.929173, 145.126619],
  [-37.929468, 145.126993],
  [-37.929901, 145.127569],
  [-37.930939, 145.128971],
  [-37.931402, 145.129606],
  [-37.931607, 145.129877],
  [-37.931808, 145.130139],
  [-37.933433, 145.132185],
  [-37.933709, 145.132541],
  [-37.936693, 145.136495],
  [-37.937923, 145.138117],
  [-37.938516, 145.138901],
  [-37.938709, 145.139161],
  [-37.941623, 145.143023],
  [-37.943845, 145.145956],
  [-37.944784, 145.147218],
  [-37.946224, 145.149138],
  [-37.947179, 145.150514],
  [-37.947364, 145.150773],
  [-37.947786, 145.15139],
  [-37.948533, 145.152442],
  [-37.948986, 145.15304],
  [-37.949181, 145.153303],
  [-37.949665, 145.153943],
  [-37.95027, 145.15475],
  [-37.950778, 145.155408],
  [-37.950929, 145.155582],
  [-37.951176, 145.155876],
  [-37.951762, 145.156565],
  [-37.952893, 145.157965],
  [-37.953407, 145.158606],
  [-37.95405, 145.159488],
  [-37.954939, 145.160666],
  [-37.955386, 145.161304],
  [-37.955644, 145.161692],
  [-37.955998, 145.162239],
  [-37.956364, 145.162763],
  [-37.956837, 145.163367],
  [-37.957158, 145.163778],
  [-37.958534, 145.165442],
  [-37.958972, 145.166023],
  [-37.95932, 145.166498],
  [-37.959575, 145.166874],
  [-37.959874, 145.167329],
  [-37.960401, 145.168125],
  [-37.960618, 145.168433],
  [-37.960838, 145.168738],
  [-37.962314, 145.170704],
  [-37.963349, 145.172076],
  [-37.963952, 145.17288],
  [-37.964831, 145.174063],
  [-37.965017, 145.174328],
  [-37.965838, 145.175442],
  [-37.966239, 145.175967],
  [-37.966805, 145.176709],
  [-37.96691, 145.176858],
  [-37.967943, 145.178161],
  [-37.969026, 145.179566],
  [-37.9722, 145.183402],
  [-37.972723, 145.184074],
  [-37.973509, 145.185143],
  [-37.974515, 145.186484],
  [-37.975211, 145.187422],
  [-37.975811, 145.188333],
  [-37.976091, 145.188754],
  [-37.976847, 145.189905],
  [-37.977961, 145.191496],
  [-37.979131, 145.193168],
  [-37.982574, 145.198119],
  [-37.983883, 145.200029],
  [-37.984285, 145.200591],
  [-37.984842, 145.201381],
  [-37.986064, 145.203144],
  [-37.986718, 145.204077],
  [-37.986914, 145.204368],
  [-37.987437, 145.205116],
  [-37.988085, 145.206057],
  [-37.988294, 145.206352],
  [-37.9885, 145.206653],
  [-37.988566, 145.206757],
  [-37.988675, 145.206941],
  [-37.988726, 145.207036],
  [-37.988891, 145.207374],
  [-37.990008, 145.209795],
];
const PAKENHAM_POST_CARNEGIE_LINE = [
  ...PAKENHAM_CARNEGIE_TO_DANDENONG_LINE,
  ...PAKENHAM_GTFS_OUTER_TRACK.slice(1),
];
const PAKENHAM_POST_HAWKSBURN_LINE = PAKENHAM_STATIONS.slice(
  PAKENHAM_STATIONS.findIndex((station) => station.name === "Hawksburn"),
).map((station) => station.position);
// Real GTFS shape points (route "Sunbury", shape 2-SUY-vpt-1.5.H) from
// Sunbury to Sunshine, rather than straight station-to-station hops. The
// Sunshine-to-city portion keeps the existing station-to-station path since
// that section now runs through the Metro Tunnel, unrelated to this fix.
const SUNBURY_OUTER_TRACK: [number, number][] = [
  [-37.579209, 144.727962],
  [-37.579961, 144.727423],
  [-37.580072, 144.727336],
  [-37.580246, 144.727210],
  [-37.581376, 144.726400],
  [-37.581466, 144.726331],
  [-37.582224, 144.725780],
  [-37.582917, 144.725270],
  [-37.583252, 144.725028],
  [-37.583399, 144.724913],
  [-37.583618, 144.724730],
  [-37.583838, 144.724556],
  [-37.586390, 144.722701],
  [-37.587523, 144.721882],
  [-37.588407, 144.721236],
  [-37.589275, 144.720620],
  [-37.589571, 144.720420],
  [-37.589848, 144.720239],
  [-37.590076, 144.720095],
  [-37.590508, 144.719829],
  [-37.590667, 144.719741],
  [-37.591074, 144.719531],
  [-37.591561, 144.719297],
  [-37.592322, 144.718984],
  [-37.592610, 144.718878],
  [-37.592956, 144.718762],
  [-37.593200, 144.718691],
  [-37.593506, 144.718610],
  [-37.593986, 144.718488],
  [-37.594513, 144.718388],
  [-37.595115, 144.718311],
  [-37.595640, 144.718260],
  [-37.595959, 144.718240],
  [-37.596706, 144.718221],
  [-37.598408, 144.718181],
  [-37.599861, 144.718159],
  [-37.601678, 144.718112],
  [-37.603443, 144.718078],
  [-37.605007, 144.718052],
  [-37.606627, 144.718005],
  [-37.608675, 144.717967],
  [-37.611762, 144.717901],
  [-37.615534, 144.717825],
  [-37.615882, 144.717820],
  [-37.616362, 144.717829],
  [-37.616785, 144.717842],
  [-37.617246, 144.717865],
  [-37.617735, 144.717914],
  [-37.618233, 144.717976],
  [-37.618702, 144.718055],
  [-37.620102, 144.718354],
  [-37.623435, 144.719082],
  [-37.627042, 144.719866],
  [-37.628505, 144.720184],
  [-37.631690, 144.720953],
  [-37.632214, 144.721091],
  [-37.632704, 144.721262],
  [-37.633214, 144.721456],
  [-37.633702, 144.721683],
  [-37.634172, 144.721921],
  [-37.634590, 144.722154],
  [-37.635060, 144.722444],
  [-37.635484, 144.722721],
  [-37.635895, 144.723014],
  [-37.641065, 144.727062],
  [-37.645066, 144.730200],
  [-37.645911, 144.730871],
  [-37.646973, 144.731700],
  [-37.647852, 144.732376],
  [-37.648880, 144.733191],
  [-37.650968, 144.734819],
  [-37.652002, 144.735629],
  [-37.653987, 144.737193],
  [-37.654593, 144.737657],
  [-37.655499, 144.738368],
  [-37.656195, 144.738926],
  [-37.657343, 144.739819],
  [-37.657620, 144.740042],
  [-37.658224, 144.740515],
  [-37.658591, 144.740798],
  [-37.659526, 144.741535],
  [-37.659683, 144.741648],
  [-37.659956, 144.741871],
  [-37.660474, 144.742277],
  [-37.660717, 144.742463],
  [-37.661202, 144.742847],
  [-37.661572, 144.743131],
  [-37.661956, 144.743437],
  [-37.662388, 144.743772],
  [-37.663064, 144.744305],
  [-37.664025, 144.745052],
  [-37.664927, 144.745762],
  [-37.665976, 144.746578],
  [-37.667938, 144.748120],
  [-37.669203, 144.749110],
  [-37.670265, 144.749936],
  [-37.671331, 144.750786],
  [-37.672333, 144.751567],
  [-37.673152, 144.752200],
  [-37.674107, 144.752961],
  [-37.675218, 144.753825],
  [-37.675763, 144.754268],
  [-37.676765, 144.755048],
  [-37.677570, 144.755668],
  [-37.678532, 144.756427],
  [-37.679434, 144.757135],
  [-37.679916, 144.757505],
  [-37.681361, 144.758640],
  [-37.681741, 144.758929],
  [-37.691079, 144.766264],
  [-37.691265, 144.766398],
  [-37.691485, 144.766535],
  [-37.691825, 144.766757],
  [-37.692046, 144.766908],
  [-37.692429, 144.767183],
  [-37.693030, 144.767630],
  [-37.693159, 144.767734],
  [-37.693365, 144.767892],
  [-37.694369, 144.768677],
  [-37.694710, 144.768962],
  [-37.695295, 144.769436],
  [-37.695763, 144.769783],
  [-37.696077, 144.770022],
  [-37.700113, 144.773187],
  [-37.701030, 144.773903],
  [-37.701262, 144.774085],
  [-37.701706, 144.774455],
  [-37.702571, 144.775186],
  [-37.702900, 144.775452],
  [-37.703332, 144.775818],
  [-37.703501, 144.775952],
  [-37.703769, 144.776179],
  [-37.704515, 144.776794],
  [-37.704990, 144.777180],
  [-37.705625, 144.777683],
  [-37.706126, 144.778071],
  [-37.706658, 144.778476],
  [-37.706863, 144.778648],
  [-37.707898, 144.779466],
  [-37.708596, 144.780006],
  [-37.709138, 144.780435],
  [-37.709599, 144.780790],
  [-37.712025, 144.782694],
  [-37.712873, 144.783363],
  [-37.713274, 144.783673],
  [-37.715703, 144.785577],
  [-37.716996, 144.786596],
  [-37.719153, 144.788284],
  [-37.721047, 144.789774],
  [-37.721748, 144.790290],
  [-37.721964, 144.790443],
  [-37.722401, 144.790744],
  [-37.723038, 144.791148],
  [-37.723889, 144.791640],
  [-37.724468, 144.791935],
  [-37.725066, 144.792225],
  [-37.725578, 144.792456],
  [-37.725682, 144.792495],
  [-37.726029, 144.792633],
  [-37.726423, 144.792784],
  [-37.726676, 144.792876],
  [-37.727085, 144.793015],
  [-37.727416, 144.793122],
  [-37.729603, 144.793805],
  [-37.733850, 144.795130],
  [-37.734929, 144.795470],
  [-37.738692, 144.796645],
  [-37.739217, 144.796812],
  [-37.739391, 144.796868],
  [-37.739777, 144.796998],
  [-37.740462, 144.797233],
  [-37.741093, 144.797459],
  [-37.741329, 144.797548],
  [-37.741626, 144.797674],
  [-37.741784, 144.797745],
  [-37.741956, 144.797827],
  [-37.742375, 144.798046],
  [-37.742554, 144.798146],
  [-37.742695, 144.798231],
  [-37.743033, 144.798444],
  [-37.743230, 144.798577],
  [-37.743874, 144.799039],
  [-37.744190, 144.799289],
  [-37.744443, 144.799496],
  [-37.744843, 144.799809],
  [-37.746240, 144.800917],
  [-37.747162, 144.801629],
  [-37.747626, 144.801984],
  [-37.747859, 144.802168],
  [-37.748066, 144.802336],
  [-37.748326, 144.802551],
  [-37.748944, 144.803076],
  [-37.749214, 144.803299],
  [-37.749613, 144.803616],
  [-37.749892, 144.803828],
  [-37.753198, 144.806318],
  [-37.753606, 144.806623],
  [-37.753764, 144.806738],
  [-37.754041, 144.806931],
  [-37.754207, 144.807041],
  [-37.755250, 144.807715],
  [-37.755535, 144.807908],
  [-37.755769, 144.808074],
  [-37.756199, 144.808394],
  [-37.759739, 144.811062],
  [-37.759933, 144.811208],
  [-37.760339, 144.811521],
  [-37.760537, 144.811664],
  [-37.760773, 144.811842],
  [-37.761107, 144.812096],
  [-37.761284, 144.812235],
  [-37.761526, 144.812434],
  [-37.761715, 144.812595],
  [-37.762226, 144.813043],
  [-37.762684, 144.813440],
  [-37.763022, 144.813715],
  [-37.763363, 144.813977],
  [-37.765006, 144.815216],
  [-37.765938, 144.815923],
  [-37.767782, 144.817308],
  [-37.769865, 144.818881],
  [-37.772291, 144.820698],
  [-37.773730, 144.821791],
  [-37.773898, 144.821921],
  [-37.774550, 144.822408],
  [-37.775373, 144.823032],
  [-37.775878, 144.823410],
  [-37.776145, 144.823605],
  [-37.776276, 144.823697],
  [-37.777048, 144.824186],
  [-37.777116, 144.824232],
  [-37.777393, 144.824424],
  [-37.777491, 144.824499],
  [-37.777592, 144.824579],
  [-37.777977, 144.824917],
  [-37.778227, 144.825143],
  [-37.778578, 144.825441],
  [-37.778763, 144.825580],
  [-37.779679, 144.826288],
  [-37.780320, 144.826773],
  [-37.781104, 144.827362],
  [-37.781731, 144.827799],
  [-37.782078, 144.828087],
  [-37.782309, 144.828258],
  [-37.783278, 144.828995],
  [-37.785038, 144.830320],
  [-37.785866, 144.830952],
  [-37.786329, 144.831300],
  [-37.786562, 144.831468],
  [-37.787371, 144.832082],
  [-37.787813, 144.832414],
  [-37.788158, 144.832668],
];
// Real GTFS shape points (route "Sunbury", shape 2-SUY-vpt-1.1.H — the same
// shape METRO_TUNNEL_REAL_TRACK's own Arden-side half comes from) for the
// Footscray -> North Melbourne -> Arden approach into the tunnel, extracted
// directly from Transport Victoria's published feed. This used to be plain
// straight lines jumping station to station, visibly cutting across blocks
// instead of following the real curve into the tunnel portal.
const SUNBURY_FOOTSCRAY_TO_ARDEN_REAL_TRACK: [number, number][] = [
  [-37.80171506, 144.90159062], [-37.8014531, 144.9020613], [-37.79995336, 144.9047637],
  [-37.79979446, 144.90507108], [-37.79962128, 144.90543747], [-37.79952519, 144.9056537],
  [-37.79917037, 144.90648825], [-37.79902833, 144.90684206], [-37.7989143, 144.90714964],
  [-37.79881989, 144.90741511], [-37.79870331, 144.90776729], [-37.79860977, 144.90807134],
  [-37.79853608, 144.90832645], [-37.79846659, 144.90858485], [-37.79836828, 144.90897115],
  [-37.79828719, 144.9093322], [-37.79824454, 144.90953374], [-37.79819541, 144.90978668],
  [-37.79814933, 144.91002886], [-37.79805197, 144.91061114], [-37.79796996, 144.91125557],
  [-37.79794432, 144.91149695], [-37.79792005, 144.91176509], [-37.79788999, 144.91217387],
  [-37.79787883, 144.9123777], [-37.7978686, 144.91261421], [-37.79785902, 144.91307534],
  [-37.79786061, 144.91333265], [-37.79786487, 144.91355807], [-37.79787109, 144.91375642],
  [-37.79789001, 144.91417813], [-37.7979189, 144.91458344], [-37.79795712, 144.91500144],
  [-37.79801794, 144.91550477], [-37.79808984, 144.91601835], [-37.79828972, 144.9173683],
  [-37.79837306, 144.91788179], [-37.79851767, 144.91869055], [-37.79857877, 144.91905805],
  [-37.79864627, 144.91948636], [-37.79871138, 144.91992757], [-37.79873883, 144.92009908],
  [-37.7987643, 144.92030132], [-37.79879344, 144.92061452], [-37.79880428, 144.92075891],
  [-37.79884848, 144.92147123], [-37.79886036, 144.92161286], [-37.79888579, 144.92182861],
  [-37.79933996, 144.9250212], [-37.79947532, 144.92585546], [-37.80002599, 144.92907947],
  [-37.80005946, 144.92924526], [-37.8001296, 144.92950316], [-37.80024568, 144.92984211],
  [-37.80047857, 144.93047957], [-37.80071292, 144.93110745], [-37.80097784, 144.9319221],
  [-37.80119173, 144.93265323], [-37.80157861, 144.9341991], [-37.80173641, 144.9349343],
  [-37.80183827, 144.93550627], [-37.80186997, 144.93576695], [-37.80189064, 144.93606735],
  [-37.80189266, 144.9363828], [-37.80188014, 144.93673796], [-37.80184467, 144.93716724],
  [-37.8017815, 144.93780025], [-37.80165036, 144.93890058], [-37.80153689, 144.93972897],
  [-37.80131483, 144.94134642],
];
const SUNBURY_LINE: [number, number][] = [
  ...SUNBURY_OUTER_TRACK,
  ...SUNBURY_STATIONS.slice(
    SUNBURY_STATIONS.findIndex((station) => station.name === "Sunshine") + 1,
    SUNBURY_STATIONS.findIndex((station) => station.name === "Footscray"),
  ).map((station) => station.position),
  ...SUNBURY_FOOTSCRAY_TO_ARDEN_REAL_TRACK,
];
// Was .slice(0, 3), then trimmed again to just 2 points at each use below —
// that skipped the entire real Richmond-to-Burnley curve (GTFS shape points
// through East Richmond/Burnley) and drew a straight diagonal line from
// Richmond direct to wherever each branch's own data happens to start
// instead. Index 41 is the real GTFS point closest to each branch's actual
// starting coordinate (~145.0077, verified against
// LILYDALE_REAL_BRANCH/BELGRAVE_REAL_BRANCH/ALAMEIN_REAL_BRANCH[0]).
const RICHMOND_TO_BURNLEY_TRACK = GLEN_WAVERLEY_TRACK_POINTS.slice(0, 42);
// Real GTFS shape points (route ALM/BEG/LIL, fullest shape variant per line)
// spliced onto the shared Richmond->Burnley trunk, replacing the previous
// straight-line-between-stations placeholder that "zapped across" instead of
// following the real curve out through Hawthorn, Camberwell and each branch.
const LILYDALE_REAL_BRANCH: [number, number][] = [[-37.82759324,145.00769617],[-37.82776821,145.00928652],[-37.82782544,145.00976126],[-37.8278986,145.01050689],[-37.82790983,145.01073405],[-37.82791708,145.01104085],[-37.82791509,145.01135516],[-37.82790734,145.01157885],[-37.82789442,145.01179575],[-37.82787644,145.01202779],[-37.82784981,145.01227085],[-37.82781784,145.01250155],[-37.82779056,145.01266862],[-37.82776836,145.01279521],[-37.82771696,145.01304405],[-37.82764527,145.01334035],[-37.82759747,145.01351967],[-37.82750833,145.01381814],[-37.82741157,145.01411875],[-37.82735423,145.01428833],[-37.82723767,145.01461207],[-37.8271757,145.01476905],[-37.82704097,145.01507885],[-37.82695002,145.01526989],[-37.82680633,145.01553505],[-37.82668314,145.01573832],[-37.82643907,145.01613205],[-37.82618208,145.01656135],[-37.8255646,145.01763255],[-37.82498831,145.01864538],[-37.82468319,145.0192033],[-37.82434427,145.01976122],[-37.82399166,145.02029326],[-37.82369767,145.02071],[-37.82331727,145.0212564],[-37.82292734,145.02180396],[-37.82228418,145.02264161],[-37.82216208,145.0228138],[-37.82175942,145.02336055],[-37.82160051,145.0235895],[-37.82150873,145.02372714],[-37.82139871,145.02391048],[-37.82121231,145.02425196],[-37.82106347,145.02458152],[-37.82100554,145.0247278],[-37.82093548,145.02492439],[-37.82086701,145.02514559],[-37.82081549,145.02535168],[-37.82076966,145.02556864],[-37.82072841,145.02580115],[-37.82069866,145.02599439],[-37.8206745,145.02619805],[-37.82065764,145.02637493],[-37.8206413,145.02669062],[-37.82064063,145.02684957],[-37.82064433,145.02701136],[-37.82065127,145.02717227],[-37.82067917,145.02749826],[-37.82070913,145.02778045],[-37.82079427,145.028463],[-37.82084377,145.02879784],[-37.82096499,145.02955237],[-37.82103636,145.03007988],[-37.82121479,145.03151862],[-37.82127119,145.03201347],[-37.82131049,145.03246174],[-37.8213256,145.03276205],[-37.82133896,145.03308139],[-37.8213577,145.03378264],[-37.82137797,145.0342354],[-37.82139457,145.03446887],[-37.82141987,145.03475324],[-37.8214484,145.03502105],[-37.82153317,145.03569965],[-37.82155957,145.03596956],[-37.82162487,145.03645373],[-37.82164511,145.03661395],[-37.8216768,145.03693075],[-37.82169752,145.03726557],[-37.82170924,145.03756848],[-37.82173873,145.03814846],[-37.82175637,145.03841202],[-37.82177694,145.03860824],[-37.82183361,145.03908889],[-37.82196517,145.04004585],[-37.8222034,145.04199895],[-37.82223912,145.04233145],[-37.82225876,145.04257485],[-37.82229212,145.04300988],[-37.82233679,145.04372909],[-37.82236021,145.04404294],[-37.82238739,145.04434488],[-37.82242046,145.0446645],[-37.82247847,145.04517352],[-37.82256622,145.04590467],[-37.82261579,145.04631803],[-37.82269702,145.04693336],[-37.82276497,145.04737385],[-37.82306568,145.04907995],[-37.82336514,145.05085347],[-37.82343306,145.05122183],[-37.82347709,145.05142085],[-37.82350269,145.0515247],[-37.82355631,145.05172063],[-37.82361339,145.05190261],[-37.82369339,145.05212443],[-37.82372958,145.05221483],[-37.82376991,145.05231033],[-37.82382631,145.05243473],[-37.82388471,145.05255465],[-37.82396789,145.05271277],[-37.82401967,145.05280343],[-37.82408382,145.05291127],[-37.82421121,145.05310503],[-37.82427652,145.05319659],[-37.8243587,145.05330486],[-37.82442833,145.05339029],[-37.82453621,145.05351583],[-37.8246164,145.05360234],[-37.82473508,145.05372181],[-37.82482682,145.05380359],[-37.82515088,145.05410286],[-37.82528082,145.05422771],[-37.82540442,145.05435614],[-37.82552386,145.05448877],[-37.82557369,145.05454825],[-37.82567898,145.05468114],[-37.825735,145.0547559],[-37.82582887,145.05489011],[-37.82588269,145.05497323],[-37.82596708,145.05511156],[-37.8260185,145.05520246],[-37.82610398,145.05536905],[-37.82616432,145.05549755],[-37.82626077,145.05572804],[-37.82635066,145.05597587],[-37.82639569,145.05611045],[-37.82643833,145.05626976],[-37.82646017,145.0563644],[-37.8264848,145.05648657],[-37.82651086,145.05664006],[-37.82652728,145.0567562],[-37.8265417,145.05689784],[-37.82656201,145.05717271],[-37.82657271,145.05735705],[-37.82657745,145.05750224],[-37.82657931,145.05773522],[-37.82657659,145.05824781],[-37.82657282,145.05870282],[-37.82656871,145.06020265],[-37.82656066,145.06075344],[-37.82649966,145.06258833],[-37.82648222,145.06320981],[-37.82647176,145.06345584],[-37.82644352,145.06442401],[-37.8264337,145.06467615],[-37.8264236,145.06485115],[-37.82639614,145.0651158],[-37.82636787,145.06532616],[-37.82634459,145.0654614],[-37.82631351,145.0656215],[-37.82611834,145.066457],[-37.82606312,145.06672135],[-37.82595053,145.06730724],[-37.82575095,145.06820966],[-37.82570909,145.06842105],[-37.82565256,145.06873258],[-37.82561876,145.06895785],[-37.82559069,145.06918035],[-37.82556933,145.06937837],[-37.8255151,145.0699783],[-37.82548662,145.07056666],[-37.82549202,145.07106164],[-37.82552689,145.07182047],[-37.82558512,145.07275661],[-37.82572924,145.07520409],[-37.82575459,145.07559165],[-37.82583594,145.07637291],[-37.82584806,145.07653575],[-37.82585506,145.07666645],[-37.82586202,145.07694883],[-37.82586048,145.07706975],[-37.82585596,145.07722882],[-37.82584737,145.0773931],[-37.82583488,145.07754385],[-37.82581268,145.07774655],[-37.82579161,145.07790183],[-37.8257655,145.07805839],[-37.82573441,145.07821814],[-37.82570737,145.0783395],[-37.82567176,145.07848779],[-37.82558332,145.07880081],[-37.82554417,145.0789251],[-37.82548638,145.07908975],[-37.82541757,145.07926888],[-37.82534041,145.07945573],[-37.82524858,145.07965989],[-37.82463349,145.08096261],[-37.82438542,145.08149518],[-37.82428796,145.08172515],[-37.82424092,145.08184703],[-37.82412968,145.08214928],[-37.82404801,145.08238611],[-37.8239887,145.08256204],[-37.82390491,145.08282347],[-37.82384602,145.08303131],[-37.82380316,145.08319977],[-37.8237505,145.08343563],[-37.82372372,145.08357311],[-37.82368714,145.08378435],[-37.82366966,145.08391193],[-37.82364818,145.08409824],[-37.82363657,145.08423738],[-37.82362676,145.08438248],[-37.82361989,145.08455819],[-37.82361748,145.08479252],[-37.82362312,145.08501153],[-37.8236297,145.08514508],[-37.82364977,145.08538156],[-37.82366904,145.08554136],[-37.82369604,145.08573858],[-37.82373366,145.08597926],[-37.82390798,145.08699623],[-37.82404531,145.08781637],[-37.8241761,145.08875621],[-37.82421446,145.0889821],[-37.82427543,145.08928501],[-37.82449288,145.09030668],[-37.82460649,145.09092715],[-37.82484369,145.09235665],[-37.82491053,145.09283279],[-37.82496572,145.09349203],[-37.82498246,145.09372996],[-37.82498987,145.0942825],[-37.82497973,145.0946912],[-37.82496984,145.09488198],[-37.82494449,145.09524802],[-37.82492238,145.09547502],[-37.8248603,145.09592664],[-37.82482377,145.09613106],[-37.82471918,145.09665159],[-37.82463337,145.0970077],[-37.82454331,145.09734051],[-37.82448238,145.09753511],[-37.82436533,145.0978819],[-37.8242827,145.09811114],[-37.82418692,145.09834673],[-37.82410809,145.09853189],[-37.82395364,145.09887329],[-37.82384572,145.09908828],[-37.82373076,145.09930766],[-37.82359843,145.09954021],[-37.82335428,145.09993559],[-37.82310778,145.10030274],[-37.82267896,145.10092666],[-37.82236166,145.10139673],[-37.82229242,145.10149564],[-37.82205978,145.101828],[-37.8216804,145.10238895],[-37.82151662,145.10262173],[-37.82138112,145.10283083],[-37.82123728,145.10305934],[-37.8208992,145.10357764],[-37.82030793,145.10443971],[-37.81992352,145.10500769],[-37.81956859,145.10551447],[-37.81934813,145.10583763],[-37.8192099,145.10605701],[-37.81907493,145.10628301],[-37.81895868,145.10650183],[-37.81887452,145.106682],[-37.81878793,145.10689029],[-37.81870292,145.10710706],[-37.81865147,145.10725902],[-37.81860552,145.10741106],[-37.81855864,145.10756698],[-37.81851489,145.10773237],[-37.81847087,145.10792071],[-37.81843344,145.10810366],[-37.81841609,145.10821294],[-37.81838703,145.10842339],[-37.81834989,145.10875413],[-37.8183262,145.10914212],[-37.81830211,145.10988093],[-37.81828388,145.11056427],[-37.81823387,145.11221654],[-37.81822663,145.11253549],[-37.81821943,145.11302531],[-37.81822262,145.11339876],[-37.81822986,145.11369303],[-37.81827953,145.11489835],[-37.81830626,145.11529574],[-37.81834391,145.11568876],[-37.81838631,145.11606325],[-37.81843788,145.1164023],[-37.81875392,145.11826748],[-37.81881228,145.11863726],[-37.81897331,145.11978728],[-37.81909823,145.12074805],[-37.81926249,145.1218479],[-37.81954074,145.12371091],[-37.81973068,145.12484],[-37.8199131,145.12606982],[-37.82009716,145.12717635],[-37.82016281,145.12766093],[-37.82024932,145.12835209],[-37.82041618,145.12955199],[-37.82051251,145.13015293],[-37.82061446,145.13076168],[-37.8207242,145.13145259],[-37.82081251,145.13203136],[-37.82154577,145.13700041],[-37.8216033,145.13745272],[-37.82161557,145.13763589],[-37.82162139,145.1378157],[-37.82162355,145.13796902],[-37.821618,145.13820535],[-37.82160673,145.13835889],[-37.82158301,145.13856887],[-37.82156011,145.13871634],[-37.82153826,145.13883891],[-37.8215048,145.13900289],[-37.82146323,145.1391723],[-37.82136171,145.13950579],[-37.8212355,145.13982877],[-37.82104523,145.14022595],[-37.82073043,145.14085858],[-37.8204882,145.14134465],[-37.82020851,145.14188425],[-37.82007813,145.14218869],[-37.8199619,145.14253277],[-37.81987218,145.14286095],[-37.81983281,145.14305575],[-37.81980176,145.14325296],[-37.81977577,145.14347378],[-37.8197556,145.14375455],[-37.81975571,145.14392757],[-37.81976208,145.14420586],[-37.81978186,145.14447768],[-37.82007941,145.14722314],[-37.82018219,145.14826246],[-37.82021704,145.14910353],[-37.82022083,145.14977486],[-37.82022481,145.15006843],[-37.82023667,145.15094404],[-37.82024367,145.15167686],[-37.8202527,145.15204552],[-37.82026587,145.15235602],[-37.82030723,145.15283862],[-37.82084447,145.15720027],[-37.82092358,145.15781588],[-37.82129474,145.16081637],[-37.82148751,145.16240393],[-37.82176379,145.1646211],[-37.82180399,145.16500843],[-37.82183124,145.1653579],[-37.8218519,145.16588601],[-37.82184996,145.16636867],[-37.821839,145.16667171],[-37.82181118,145.16706186],[-37.82178337,145.16734759],[-37.82174512,145.16765812],[-37.82170308,145.16795625],[-37.82136476,145.17015193],[-37.8212536,145.17092699],[-37.82117726,145.17141921],[-37.82086866,145.17310119],[-37.82068142,145.1740967],[-37.82055167,145.17480778],[-37.82053716,145.17487722],[-37.82044324,145.17536475],[-37.82034226,145.17608887],[-37.82029316,145.17647373],[-37.82007656,145.17838085],[-37.82005009,145.17864507],[-37.81995258,145.17935035],[-37.81983666,145.1800771],[-37.81958183,145.18171237],[-37.81949772,145.18230643],[-37.81941541,145.18295214],[-37.81927902,145.18396022],[-37.81906414,145.1853558],[-37.81901429,145.18563524],[-37.8186424,145.18809038],[-37.81861796,145.1882649],[-37.81858917,145.18852565],[-37.81856431,145.18881925],[-37.81852207,145.18970606],[-37.81851009,145.18991197],[-37.81848982,145.19019353],[-37.81847441,145.1903575],[-37.81838312,145.19106192],[-37.81828259,145.19166307],[-37.8182484,145.19190145],[-37.81803767,145.19323247],[-37.81788509,145.19418955],[-37.81781739,145.19465868],[-37.81777167,145.19500345],[-37.81774897,145.19519815],[-37.81773257,145.19538645],[-37.81771592,145.19563485],[-37.81770996,145.19586368],[-37.81770933,145.19599309],[-37.81771314,145.19618283],[-37.81772077,145.19639895],[-37.81774597,145.19677346],[-37.81788077,145.19844993],[-37.8181774,145.20201422],[-37.81884438,145.21024843],[-37.81888467,145.21077084],[-37.81890132,145.21104832],[-37.81891662,145.21143853],[-37.81892329,145.21183019],[-37.81892422,145.21219985],[-37.81891568,145.21253405],[-37.81890279,145.21284837],[-37.81885876,145.21360537],[-37.81882823,145.21405825],[-37.81881021,145.21432612],[-37.81874716,145.21537417],[-37.81868277,145.21635887],[-37.81835643,145.22152395],[-37.81832092,145.2219774],[-37.81828484,145.22232772],[-37.81825272,145.22257547],[-37.81822389,145.22276747],[-37.81819911,145.22292291],[-37.81816722,145.22309703],[-37.8180933,145.22345405],[-37.81804467,145.22366538],[-37.81800732,145.22381192],[-37.81794769,145.22402931],[-37.8178891,145.22423134],[-37.81783794,145.22439479],[-37.81772774,145.22471893],[-37.81765442,145.22491268],[-37.81751426,145.22526424],[-37.81743596,145.22545038],[-37.8167143,145.22709172],[-37.81645367,145.22769028],[-37.81637381,145.22789316],[-37.81630312,145.22809422],[-37.81625634,145.22821337],[-37.81596354,145.22888483],[-37.81548316,145.22997926],[-37.81545463,145.23003584],[-37.81532641,145.23027133],[-37.81529694,145.23033122],[-37.81515982,145.23063406],[-37.81495722,145.23110124],[-37.81466511,145.23176551],[-37.81450677,145.23211974],[-37.8143015,145.23258971],[-37.81415012,145.23295797],[-37.81404259,145.23325726],[-37.81394326,145.2335802],[-37.81390354,145.23372655],[-37.81384569,145.23397296],[-37.81381483,145.23413251],[-37.81377777,145.23435979],[-37.81375111,145.23461966],[-37.81373636,145.2348739],[-37.81373524,145.23503956],[-37.81373716,145.23518583],[-37.81374269,145.23531452],[-37.81377578,145.23577823],[-37.81393678,145.23761686],[-37.81401973,145.23842087],[-37.81409644,145.23922901],[-37.8141186,145.23950578],[-37.81414219,145.23986646],[-37.8141564,145.24023827],[-37.81416009,145.24044255],[-37.81416069,145.24064588],[-37.81415341,145.24105728],[-37.81414191,145.24125862],[-37.81411112,145.24166524],[-37.814026,145.24236851],[-37.81395601,145.24278742],[-37.81386803,145.24320903],[-37.81376023,145.24365484],[-37.81361731,145.24415772],[-37.81337716,145.24497541],[-37.81322219,145.24546755],[-37.81303606,145.24596803],[-37.81281184,145.24653054],[-37.8126888,145.24686799],[-37.81252153,145.24738211],[-37.81215467,145.24866238],[-37.81178148,145.24994767],[-37.81159489,145.25057583],[-37.81149178,145.25091462],[-37.81142259,145.25115298],[-37.81134387,145.2514653],[-37.8112328,145.25193025],[-37.81109946,145.2525769],[-37.81089879,145.25338656],[-37.81047579,145.25481725],[-37.80975298,145.25729752],[-37.80952763,145.25805628],[-37.80924406,145.25904642],[-37.80878159,145.26058565],[-37.80805798,145.26309343],[-37.80780793,145.26393974],[-37.80747118,145.26510976],[-37.80719681,145.26600036],[-37.80705914,145.26633957],[-37.80689589,145.26667348],[-37.80674326,145.26695784],[-37.80657799,145.26725283],[-37.80606617,145.26798641],[-37.80516354,145.26926989],[-37.8042423,145.27057524],[-37.80394588,145.27098605],[-37.80366377,145.27134645],[-37.80353917,145.2714961],[-37.80323431,145.27181681],[-37.80299653,145.27203566],[-37.80264788,145.27231422],[-37.80075488,145.27362985],[-37.80022067,145.27398859],[-37.79962864,145.27444214],[-37.79928612,145.27471554],[-37.79907314,145.27489245],[-37.79893527,145.27502263],[-37.79876039,145.27521035],[-37.79853723,145.27546132],[-37.79844759,145.27556801],[-37.79836411,145.27567092],[-37.79813204,145.27597206],[-37.79790103,145.27628465],[-37.79770821,145.27658897],[-37.79692919,145.27792521],[-37.796086,145.27921997],[-37.79580844,145.27968944],[-37.79537171,145.28043642],[-37.79519317,145.28073198],[-37.79511001,145.28086963],[-37.79492533,145.28119543],[-37.79446226,145.28198468],[-37.79421172,145.28244192],[-37.79376073,145.28328096],[-37.79352718,145.28372315],[-37.79327534,145.28421561],[-37.79233603,145.28589484],[-37.79207126,145.28632944],[-37.79185174,145.28662797],[-37.79162196,145.28692094],[-37.791339,145.28725749],[-37.79086101,145.2877296],[-37.79039578,145.28812521],[-37.7900494,145.28839496],[-37.78978427,145.2885821],[-37.78909192,145.28905777],[-37.7887181,145.28933076],[-37.78845202,145.28955754],[-37.78820513,145.2898217],[-37.78794776,145.29015832],[-37.78767824,145.29058265],[-37.7874991,145.29095085],[-37.78736549,145.29128257],[-37.78712083,145.29198046],[-37.78581869,145.29577801],[-37.78468603,145.29909496],[-37.78454224,145.29946686],[-37.78387337,145.30141691],[-37.78339316,145.30283312],[-37.78327563,145.30321405],[-37.78318444,145.30362845],[-37.78312319,145.30401888],[-37.78309109,145.30436186],[-37.78309004,145.30467075],[-37.78309872,145.3050296],[-37.78312449,145.30528587],[-37.78314843,145.30547212],[-37.78318781,145.3057157],[-37.78323261,145.30592974],[-37.78330997,145.30622685],[-37.78334199,145.30634137],[-37.78342927,145.30661361],[-37.78437355,145.30939186],[-37.78459802,145.31006842],[-37.78467348,145.3103147],[-37.78474902,145.31061765],[-37.78480194,145.31090181],[-37.78484488,145.3112382],[-37.78486752,145.31154701],[-37.78487338,145.31184939],[-37.78486978,145.31211985],[-37.78485623,145.31234465],[-37.78481937,145.31277223],[-37.78479012,145.313077],[-37.78457164,145.31536726],[-37.78454919,145.31556865],[-37.78451901,145.31578361],[-37.78447441,145.31603036],[-37.78439227,145.31634245],[-37.78432348,145.31657453],[-37.7842101,145.31688937],[-37.78410379,145.31712514],[-37.78399027,145.3173546],[-37.78386604,145.31757214],[-37.78374366,145.31777477],[-37.78348872,145.31818026],[-37.78327124,145.31855798],[-37.78309639,145.31882846],[-37.78268538,145.31951976],[-37.78181809,145.32093892],[-37.78136974,145.32165432],[-37.78100258,145.32228681],[-37.7806989,145.32278284],[-37.78032464,145.32333474],[-37.78012544,145.32355465],[-37.77988577,145.32383087],[-37.77964837,145.32405084],[-37.77899122,145.3246677],[-37.7781686,145.32541069],[-37.7777892,145.32577283],[-37.777486,145.32611338],[-37.77716801,145.32651035],[-37.7769157,145.32686177],[-37.77661262,145.32734458],[-37.77640271,145.32771196],[-37.77593414,145.32865618],[-37.77540094,145.32975318],[-37.775127,145.3302897],[-37.77480659,145.33094942],[-37.77408119,145.33236828],[-37.77357132,145.33339034],[-37.77340056,145.33371753],[-37.77319068,145.33404344],[-37.77295334,145.3343585],[-37.77261624,145.33471258],[-37.772239,145.33503292],[-37.77186461,145.33526113],[-37.77159577,145.33538171],[-37.77126348,145.33550247],[-37.7708586,145.335595],[-37.77005923,145.33574927],[-37.76672279,145.33638126],[-37.76629351,145.33647523],[-37.76596912,145.33658785],[-37.76566801,145.33673401],[-37.76534358,145.33693915],[-37.76502439,145.33718334],[-37.76472121,145.33747701],[-37.76446572,145.33778413],[-37.76421019,145.33813951],[-37.76383907,145.33868932],[-37.76352317,145.33913595],[-37.76314263,145.33956768],[-37.76233516,145.34043373],[-37.75911278,145.34381986],[-37.75879964,145.34408566],[-37.758545,145.34431348],[-37.75837363,145.34448326],[-37.75822022,145.34464833],[-37.75805591,145.3448142],[-37.75761047,145.34527898],[-37.757208,145.34570363]];
const BELGRAVE_REAL_BRANCH: [number, number][] = [[-37.82759324,145.00769617],[-37.82776821,145.00928652],[-37.82782544,145.00976126],[-37.8278986,145.01050689],[-37.82790983,145.01073405],[-37.82791708,145.01104085],[-37.82791509,145.01135516],[-37.82790734,145.01157885],[-37.82789442,145.01179575],[-37.82787644,145.01202779],[-37.82784981,145.01227085],[-37.82781784,145.01250155],[-37.82779056,145.01266862],[-37.82776836,145.01279521],[-37.82771696,145.01304405],[-37.82764527,145.01334035],[-37.82759747,145.01351967],[-37.82750833,145.01381814],[-37.82741157,145.01411875],[-37.82735423,145.01428833],[-37.82723767,145.01461207],[-37.8271757,145.01476905],[-37.82704097,145.01507885],[-37.82695002,145.01526989],[-37.82680633,145.01553505],[-37.82668314,145.01573832],[-37.82643907,145.01613205],[-37.82618208,145.01656135],[-37.8255646,145.01763255],[-37.82498831,145.01864538],[-37.82468319,145.0192033],[-37.82434427,145.01976122],[-37.82399166,145.02029326],[-37.82369767,145.02071],[-37.82331727,145.0212564],[-37.82292734,145.02180396],[-37.82228418,145.02264161],[-37.82216208,145.0228138],[-37.82175942,145.02336055],[-37.82160051,145.0235895],[-37.82150873,145.02372714],[-37.82139871,145.02391048],[-37.82121231,145.02425196],[-37.82106347,145.02458152],[-37.82100554,145.0247278],[-37.82093548,145.02492439],[-37.82086701,145.02514559],[-37.82081549,145.02535168],[-37.82076966,145.02556864],[-37.82072841,145.02580115],[-37.82069866,145.02599439],[-37.8206745,145.02619805],[-37.82065764,145.02637493],[-37.8206413,145.02669062],[-37.82064063,145.02684957],[-37.82064433,145.02701136],[-37.82065127,145.02717227],[-37.82067917,145.02749826],[-37.82070913,145.02778045],[-37.82079427,145.028463],[-37.82084377,145.02879784],[-37.82096499,145.02955237],[-37.82103636,145.03007988],[-37.82121479,145.03151862],[-37.82127119,145.03201347],[-37.82131049,145.03246174],[-37.8213256,145.03276205],[-37.82133896,145.03308139],[-37.8213577,145.03378264],[-37.82137797,145.0342354],[-37.82139457,145.03446887],[-37.82141987,145.03475324],[-37.8214484,145.03502105],[-37.82153317,145.03569965],[-37.82155957,145.03596956],[-37.82162487,145.03645373],[-37.82164511,145.03661395],[-37.8216768,145.03693075],[-37.82169752,145.03726557],[-37.82170924,145.03756848],[-37.82173873,145.03814846],[-37.82175637,145.03841202],[-37.82177694,145.03860824],[-37.82183361,145.03908889],[-37.82196517,145.04004585],[-37.8222034,145.04199895],[-37.82223912,145.04233145],[-37.82225876,145.04257485],[-37.82229212,145.04300988],[-37.82233679,145.04372909],[-37.82236021,145.04404294],[-37.82238739,145.04434488],[-37.82242046,145.0446645],[-37.82247847,145.04517352],[-37.82256622,145.04590467],[-37.82261579,145.04631803],[-37.82269702,145.04693336],[-37.82276497,145.04737385],[-37.82306568,145.04907995],[-37.82336514,145.05085347],[-37.82343306,145.05122183],[-37.82347709,145.05142085],[-37.82350269,145.0515247],[-37.82355631,145.05172063],[-37.82361339,145.05190261],[-37.82369339,145.05212443],[-37.82372958,145.05221483],[-37.82376991,145.05231033],[-37.82382631,145.05243473],[-37.82388471,145.05255465],[-37.82396789,145.05271277],[-37.82401967,145.05280343],[-37.82408382,145.05291127],[-37.82421121,145.05310503],[-37.82427652,145.05319659],[-37.8243587,145.05330486],[-37.82442833,145.05339029],[-37.82453621,145.05351583],[-37.8246164,145.05360234],[-37.82473508,145.05372181],[-37.82482682,145.05380359],[-37.82515088,145.05410286],[-37.82528082,145.05422771],[-37.82540442,145.05435614],[-37.82552386,145.05448877],[-37.82557369,145.05454825],[-37.82567898,145.05468114],[-37.825735,145.0547559],[-37.82582887,145.05489011],[-37.82588269,145.05497323],[-37.82596708,145.05511156],[-37.8260185,145.05520246],[-37.82610398,145.05536905],[-37.82616432,145.05549755],[-37.82626077,145.05572804],[-37.82635066,145.05597587],[-37.82639569,145.05611045],[-37.82643833,145.05626976],[-37.82646017,145.0563644],[-37.8264848,145.05648657],[-37.82651086,145.05664006],[-37.82652728,145.0567562],[-37.8265417,145.05689784],[-37.82656201,145.05717271],[-37.82657271,145.05735705],[-37.82657745,145.05750224],[-37.82657931,145.05773522],[-37.82657659,145.05824781],[-37.82657282,145.05870282],[-37.82656871,145.06020265],[-37.82656066,145.06075344],[-37.82649966,145.06258833],[-37.82648222,145.06320981],[-37.82647176,145.06345584],[-37.82644352,145.06442401],[-37.8264337,145.06467615],[-37.8264236,145.06485115],[-37.82639614,145.0651158],[-37.82636787,145.06532616],[-37.82634459,145.0654614],[-37.82631351,145.0656215],[-37.82611834,145.066457],[-37.82606312,145.06672135],[-37.82595053,145.06730724],[-37.82575095,145.06820966],[-37.82570909,145.06842105],[-37.82565256,145.06873258],[-37.82561876,145.06895785],[-37.82559069,145.06918035],[-37.82556933,145.06937837],[-37.8255151,145.0699783],[-37.82548662,145.07056666],[-37.82549202,145.07106164],[-37.82552689,145.07182047],[-37.82558512,145.07275661],[-37.82572924,145.07520409],[-37.82575459,145.07559165],[-37.82583594,145.07637291],[-37.82584806,145.07653575],[-37.82585506,145.07666645],[-37.82586202,145.07694883],[-37.82586048,145.07706975],[-37.82585596,145.07722882],[-37.82584737,145.0773931],[-37.82583488,145.07754385],[-37.82581268,145.07774655],[-37.82579161,145.07790183],[-37.8257655,145.07805839],[-37.82573441,145.07821814],[-37.82570737,145.0783395],[-37.82567176,145.07848779],[-37.82558332,145.07880081],[-37.82554417,145.0789251],[-37.82548638,145.07908975],[-37.82541757,145.07926888],[-37.82534041,145.07945573],[-37.82524858,145.07965989],[-37.82463349,145.08096261],[-37.82438542,145.08149518],[-37.82428796,145.08172515],[-37.82424092,145.08184703],[-37.82412968,145.08214928],[-37.82404801,145.08238611],[-37.8239887,145.08256204],[-37.82390491,145.08282347],[-37.82384602,145.08303131],[-37.82380316,145.08319977],[-37.8237505,145.08343563],[-37.82372372,145.08357311],[-37.82368714,145.08378435],[-37.82366966,145.08391193],[-37.82364818,145.08409824],[-37.82363657,145.08423738],[-37.82362676,145.08438248],[-37.82361989,145.08455819],[-37.82361748,145.08479252],[-37.82362312,145.08501153],[-37.8236297,145.08514508],[-37.82364977,145.08538156],[-37.82366904,145.08554136],[-37.82369604,145.08573858],[-37.82373366,145.08597926],[-37.82390798,145.08699623],[-37.82404531,145.08781637],[-37.8241761,145.08875621],[-37.82421446,145.0889821],[-37.82427543,145.08928501],[-37.82449288,145.09030668],[-37.82460649,145.09092715],[-37.82484369,145.09235665],[-37.82491053,145.09283279],[-37.82496572,145.09349203],[-37.82498246,145.09372996],[-37.82498987,145.0942825],[-37.82497973,145.0946912],[-37.82496984,145.09488198],[-37.82494449,145.09524802],[-37.82492238,145.09547502],[-37.8248603,145.09592664],[-37.82482377,145.09613106],[-37.82471918,145.09665159],[-37.82463337,145.0970077],[-37.82454331,145.09734051],[-37.82448238,145.09753511],[-37.82436533,145.0978819],[-37.8242827,145.09811114],[-37.82418692,145.09834673],[-37.82410809,145.09853189],[-37.82395364,145.09887329],[-37.82384572,145.09908828],[-37.82373076,145.09930766],[-37.82359843,145.09954021],[-37.82335428,145.09993559],[-37.82310778,145.10030274],[-37.82267896,145.10092666],[-37.82236166,145.10139673],[-37.82229242,145.10149564],[-37.82205978,145.101828],[-37.8216804,145.10238895],[-37.82151662,145.10262173],[-37.82138112,145.10283083],[-37.82123728,145.10305934],[-37.8208992,145.10357764],[-37.82030793,145.10443971],[-37.81992352,145.10500769],[-37.81956859,145.10551447],[-37.81934813,145.10583763],[-37.8192099,145.10605701],[-37.81907493,145.10628301],[-37.81895868,145.10650183],[-37.81887452,145.106682],[-37.81878793,145.10689029],[-37.81870292,145.10710706],[-37.81865147,145.10725902],[-37.81860552,145.10741106],[-37.81855864,145.10756698],[-37.81851489,145.10773237],[-37.81847087,145.10792071],[-37.81843344,145.10810366],[-37.81841609,145.10821294],[-37.81838703,145.10842339],[-37.81834989,145.10875413],[-37.8183262,145.10914212],[-37.81830211,145.10988093],[-37.81828388,145.11056427],[-37.81823387,145.11221654],[-37.81822663,145.11253549],[-37.81821943,145.11302531],[-37.81822262,145.11339876],[-37.81822986,145.11369303],[-37.81827953,145.11489835],[-37.81830626,145.11529574],[-37.81834391,145.11568876],[-37.81838631,145.11606325],[-37.81843788,145.1164023],[-37.81875392,145.11826748],[-37.81881228,145.11863726],[-37.81897331,145.11978728],[-37.81909823,145.12074805],[-37.81926249,145.1218479],[-37.81954074,145.12371091],[-37.81973068,145.12484],[-37.8199131,145.12606982],[-37.82009716,145.12717635],[-37.82016281,145.12766093],[-37.82024932,145.12835209],[-37.82041618,145.12955199],[-37.82051251,145.13015293],[-37.82061446,145.13076168],[-37.8207242,145.13145259],[-37.82081251,145.13203136],[-37.82154577,145.13700041],[-37.8216033,145.13745272],[-37.82161557,145.13763589],[-37.82162139,145.1378157],[-37.82162355,145.13796902],[-37.821618,145.13820535],[-37.82160673,145.13835889],[-37.82158301,145.13856887],[-37.82156011,145.13871634],[-37.82153826,145.13883891],[-37.8215048,145.13900289],[-37.82146323,145.1391723],[-37.82136171,145.13950579],[-37.8212355,145.13982877],[-37.82104523,145.14022595],[-37.82073043,145.14085858],[-37.8204882,145.14134465],[-37.82020851,145.14188425],[-37.82007813,145.14218869],[-37.8199619,145.14253277],[-37.81987218,145.14286095],[-37.81983281,145.14305575],[-37.81980176,145.14325296],[-37.81977577,145.14347378],[-37.8197556,145.14375455],[-37.81975571,145.14392757],[-37.81976208,145.14420586],[-37.81978186,145.14447768],[-37.82007941,145.14722314],[-37.82018219,145.14826246],[-37.82021704,145.14910353],[-37.82022083,145.14977486],[-37.82022481,145.15006843],[-37.82023667,145.15094404],[-37.82024367,145.15167686],[-37.8202527,145.15204552],[-37.82026587,145.15235602],[-37.82030723,145.15283862],[-37.82084447,145.15720027],[-37.82092358,145.15781588],[-37.82129474,145.16081637],[-37.82148751,145.16240393],[-37.82176379,145.1646211],[-37.82180399,145.16500843],[-37.82183124,145.1653579],[-37.8218519,145.16588601],[-37.82184996,145.16636867],[-37.821839,145.16667171],[-37.82181118,145.16706186],[-37.82178337,145.16734759],[-37.82174512,145.16765812],[-37.82170308,145.16795625],[-37.82136476,145.17015193],[-37.8212536,145.17092699],[-37.82117726,145.17141921],[-37.82086866,145.17310119],[-37.82068142,145.1740967],[-37.82055167,145.17480778],[-37.82053716,145.17487722],[-37.82044324,145.17536475],[-37.82034226,145.17608887],[-37.82029316,145.17647373],[-37.82007656,145.17838085],[-37.82005009,145.17864507],[-37.81995258,145.17935035],[-37.81983666,145.1800771],[-37.81958183,145.18171237],[-37.81949772,145.18230643],[-37.81941541,145.18295214],[-37.81927902,145.18396022],[-37.81906414,145.1853558],[-37.81901429,145.18563524],[-37.8186424,145.18809038],[-37.81861796,145.1882649],[-37.81858917,145.18852565],[-37.81856431,145.18881925],[-37.81852207,145.18970606],[-37.81851009,145.18991197],[-37.81848982,145.19019353],[-37.81847441,145.1903575],[-37.81838312,145.19106192],[-37.81828259,145.19166307],[-37.8182484,145.19190145],[-37.81803767,145.19323247],[-37.81788509,145.19418955],[-37.81781739,145.19465868],[-37.81777167,145.19500345],[-37.81774897,145.19519815],[-37.81773257,145.19538645],[-37.81771592,145.19563485],[-37.81770996,145.19586368],[-37.81770933,145.19599309],[-37.81771314,145.19618283],[-37.81772077,145.19639895],[-37.81774597,145.19677346],[-37.81788077,145.19844993],[-37.8181774,145.20201422],[-37.81884438,145.21024843],[-37.81888467,145.21077084],[-37.81890132,145.21104832],[-37.81891662,145.21143853],[-37.81892329,145.21183019],[-37.81892422,145.21219985],[-37.81891568,145.21253405],[-37.81890279,145.21284837],[-37.81885876,145.21360537],[-37.81882823,145.21405825],[-37.81881021,145.21432612],[-37.81874716,145.21537417],[-37.81868277,145.21635887],[-37.81835643,145.22152395],[-37.81832092,145.2219774],[-37.81828484,145.22232772],[-37.81825272,145.22257547],[-37.81822389,145.22276747],[-37.81819911,145.22292291],[-37.81816722,145.22309703],[-37.8180933,145.22345405],[-37.81804467,145.22366538],[-37.81800732,145.22381192],[-37.81794769,145.22402931],[-37.8178891,145.22423134],[-37.81783794,145.22439479],[-37.81772774,145.22471893],[-37.81765442,145.22491268],[-37.81751426,145.22526424],[-37.81743596,145.22545038],[-37.8167143,145.22709172],[-37.81645367,145.22769028],[-37.81637381,145.22789316],[-37.81630312,145.22809422],[-37.81625634,145.22821337],[-37.81596354,145.22888483],[-37.81548316,145.22997926],[-37.8152192,145.23059129],[-37.81487707,145.2313691],[-37.81477838,145.23160285],[-37.81467087,145.23187942],[-37.81458311,145.23214427],[-37.81455629,145.23223715],[-37.8145196,145.2323681],[-37.81446584,145.23259942],[-37.81444584,145.23269578],[-37.81441117,145.23290767],[-37.81438559,145.23311912],[-37.81437388,145.23325129],[-37.81436126,145.23351537],[-37.81436028,145.23374452],[-37.81436844,145.23400015],[-37.8143777,145.23414329],[-37.81439268,145.23430686],[-37.81442493,145.23456419],[-37.81445449,145.23473854],[-37.81448008,145.23487051],[-37.81451598,145.23503482],[-37.81457037,145.23525493],[-37.81464668,145.23551803],[-37.81469642,145.23566794],[-37.81475873,145.23583833],[-37.81484313,145.23604591],[-37.81490031,145.23616928],[-37.8149763,145.23632674],[-37.81506959,145.23649663],[-37.81515463,145.23663865],[-37.81522032,145.23674046],[-37.81529863,145.23685447],[-37.81536933,145.23694765],[-37.81558066,145.23719436],[-37.81566611,145.23728548],[-37.81586591,145.23747817],[-37.81599907,145.23759042],[-37.81611846,145.23767335],[-37.81647651,145.23790795],[-37.81670583,145.23805007],[-37.81706617,145.2382812],[-37.81732693,145.2384587],[-37.81781358,145.23877181],[-37.8181451,145.23897388],[-37.81838909,145.23911452],[-37.81911749,145.23950937],[-37.81968806,145.23982335],[-37.82072214,145.2403866],[-37.82181007,145.2409888],[-37.82466958,145.24254391],[-37.82577544,145.24313484],[-37.82840535,145.24457261],[-37.82914107,145.2449758],[-37.82971467,145.24529513],[-37.83016591,145.24554316],[-37.83042966,145.24570405],[-37.83071989,145.24590659],[-37.83104398,145.24617355],[-37.83132997,145.2464605],[-37.83162447,145.24681054],[-37.83185217,145.24712296],[-37.83213344,145.24758888],[-37.83229549,145.24791081],[-37.8324978,145.24839485],[-37.83263911,145.24881239],[-37.83271638,145.24911168],[-37.83279703,145.24948724],[-37.83296129,145.25032773],[-37.83320434,145.25164985],[-37.83349162,145.2530932],[-37.83424907,145.25705092],[-37.83440012,145.25791004],[-37.8344681,145.25825297],[-37.83454306,145.25858063],[-37.83473162,145.25942945],[-37.8348573,145.25982966],[-37.8350123,145.26029861],[-37.83517968,145.26073307],[-37.83537141,145.26115684],[-37.83561923,145.26166248],[-37.83588823,145.26211979],[-37.83630788,145.26271516],[-37.83644542,145.26289977],[-37.83678106,145.26332279],[-37.83707661,145.26364324],[-37.83739441,145.26396374],[-37.83811666,145.26465579],[-37.83878067,145.26528535],[-37.83977601,145.26624285],[-37.84030357,145.26672573],[-37.840909,145.2672209],[-37.84106866,145.26736558],[-37.84142839,145.26771297],[-37.84224553,145.26849742],[-37.84263962,145.26888311],[-37.84283722,145.2690826],[-37.84296941,145.2692227],[-37.84321256,145.26949238],[-37.84339884,145.26970701],[-37.84360837,145.26994032],[-37.84399924,145.27036463],[-37.84475293,145.27111322],[-37.84549642,145.27183071],[-37.84614869,145.27245566],[-37.84669409,145.27299482],[-37.84747351,145.27374185],[-37.84910967,145.27531723],[-37.85228551,145.27838701],[-37.85407542,145.28010212],[-37.85511916,145.28111742],[-37.85624471,145.28219973],[-37.8566323,145.28252559],[-37.85708868,145.28284747],[-37.8575419,145.28311965],[-37.85801733,145.28335709],[-37.85854029,145.28362799],[-37.8589586,145.28386666],[-37.85932181,145.28407864],[-37.85970013,145.28427595],[-37.86032194,145.28458322],[-37.860438,145.28464395],[-37.86062753,145.28474311],[-37.86099128,145.28492429],[-37.86142353,145.28516764],[-37.86255157,145.28570543],[-37.86286138,145.2858275],[-37.86338696,145.28600619],[-37.86382133,145.28612321],[-37.86434728,145.28627166],[-37.86496136,145.28646353],[-37.8654717,145.28659233],[-37.86591458,145.28669916],[-37.86631799,145.28681316],[-37.86685581,145.28697816],[-37.86809346,145.28736979],[-37.86884619,145.28763259],[-37.86943699,145.28789676],[-37.86998851,145.28818651],[-37.87052953,145.28853517],[-37.87104929,145.2889281],[-37.87226707,145.28995564],[-37.8723693,145.29004514],[-37.87308717,145.29065679],[-37.8733752,145.29087411],[-37.87358477,145.29101354],[-37.87378274,145.29113562],[-37.87404309,145.29127774],[-37.87491436,145.29171761],[-37.87537488,145.29195358],[-37.87550967,145.29202562],[-37.87571717,145.29212815],[-37.87867639,145.29363886],[-37.87906277,145.29383335],[-37.87997147,145.29430084],[-37.88029811,145.294465],[-37.88065479,145.29465074],[-37.88166519,145.29516423],[-37.88197788,145.29532394],[-37.882133,145.29540667],[-37.88231609,145.29549705],[-37.88249819,145.29559416],[-37.88290353,145.29579847],[-37.88296822,145.29583405],[-37.88513116,145.29693867],[-37.88569401,145.29722238],[-37.88595203,145.29735982],[-37.88629206,145.29752836],[-37.88685799,145.29781905],[-37.88716811,145.29797542],[-37.8875492,145.29817315],[-37.8878344,145.29833295],[-37.8879793,145.29841922],[-37.88812456,145.29851765],[-37.88847831,145.29878162],[-37.8886043,145.29888755],[-37.88877998,145.29904543],[-37.88891551,145.29917604],[-37.88905134,145.29932075],[-37.88932281,145.29962824],[-37.88955083,145.29992855],[-37.8897163,145.30017253],[-37.88984391,145.3003777],[-37.88997586,145.30060381],[-37.89037906,145.30134018],[-37.8906815,145.30190182],[-37.89080491,145.30213506],[-37.8909879,145.30249464],[-37.89108968,145.30270928],[-37.89119283,145.30293798],[-37.89151521,145.30370148],[-37.8916839,145.30411928],[-37.89178879,145.3043873],[-37.89195588,145.30483209],[-37.89203118,145.30501072],[-37.89218966,145.30534586],[-37.89223932,145.30546458],[-37.89228717,145.30559586],[-37.89237034,145.30587075],[-37.89240838,145.30601555],[-37.8924265,145.30609701],[-37.89246537,145.30631174],[-37.89259131,145.30706612],[-37.89279663,145.30829005],[-37.89284366,145.30858397],[-37.89286488,145.30875009],[-37.89287989,145.30889155],[-37.89290277,145.30916623],[-37.89293012,145.30957751],[-37.89296616,145.31021637],[-37.89297334,145.31035926],[-37.8929793,145.31058611],[-37.89297907,145.31082721],[-37.89297156,145.3111392],[-37.89291543,145.31250344],[-37.89291227,145.31271014],[-37.89291461,145.31282335],[-37.89292572,145.31302621],[-37.89293614,145.31313673],[-37.89297073,145.31335588],[-37.89301058,145.31354545],[-37.89304389,145.31367525],[-37.89308394,145.31380375],[-37.89313051,145.31392823],[-37.89317783,145.31404815],[-37.89322466,145.31415285],[-37.89326932,145.3142378],[-37.89339974,145.31445897],[-37.89350816,145.31461059],[-37.8936313,145.31476415],[-37.89376407,145.31490988],[-37.89389832,145.31502747],[-37.89404696,145.31514929],[-37.89443582,145.31542565],[-37.89468146,145.31561258],[-37.89480151,145.31571402],[-37.89493389,145.31583291],[-37.89508361,145.31599213],[-37.89524267,145.31618695],[-37.89534109,145.3163263],[-37.89544014,145.31649042],[-37.8957639,145.31710478],[-37.89625668,145.31809458],[-37.89639084,145.31835117],[-37.89653891,145.31862245],[-37.8967615,145.31898097],[-37.89730956,145.3197663],[-37.89749908,145.3200561],[-37.89764682,145.3203109],[-37.89781851,145.3206276],[-37.89802539,145.32099116],[-37.89824639,145.32137156],[-37.89858298,145.32196487],[-37.89902142,145.32276126],[-37.89932996,145.32330949],[-37.89950738,145.32363006],[-37.89966393,145.32394677],[-37.89979107,145.3242305],[-37.90000321,145.32476773],[-37.90012074,145.32505349],[-37.90021596,145.32526003],[-37.90034092,145.32551026],[-37.90049237,145.32578615],[-37.90071379,145.32616556],[-37.90093471,145.32656101],[-37.90126008,145.32716519],[-37.90139192,145.32741845],[-37.90152218,145.32769983],[-37.90162149,145.3279345],[-37.90174177,145.32826866],[-37.90183069,145.32850754],[-37.90192962,145.32875347],[-37.90204143,145.32899832],[-37.90213671,145.32919088],[-37.90224494,145.32939986],[-37.90235011,145.32957093],[-37.90247621,145.3297628],[-37.90265419,145.33007337],[-37.90271216,145.33017055],[-37.90278704,145.33029011],[-37.90286123,145.33039295],[-37.90294391,145.33049788],[-37.90302153,145.33058848],[-37.90311128,145.33068905],[-37.90350577,145.33111734],[-37.90357016,145.33119027],[-37.90368154,145.33131639],[-37.90383442,145.33150345],[-37.90399717,145.3317127],[-37.90423637,145.33203782],[-37.90436142,145.33221357],[-37.90447936,145.33238936],[-37.90457354,145.33254215],[-37.90466214,145.33270223],[-37.90474753,145.33287682],[-37.90484174,145.33310195],[-37.90506718,145.33367137],[-37.9051622,145.33392218],[-37.90522786,145.33413556],[-37.90526847,145.33429877],[-37.90529716,145.33444143],[-37.90532559,145.33462869],[-37.90534374,145.334784],[-37.90535833,145.33494893],[-37.90539922,145.3356101],[-37.90542923,145.33587728],[-37.90545313,145.33601255],[-37.90548887,145.33617542],[-37.90552879,145.33634115],[-37.90556596,145.33647145],[-37.90561194,145.33661908],[-37.90571462,145.33688258],[-37.90579872,145.3370687],[-37.90587947,145.33722874],[-37.90602681,145.33750193],[-37.90636596,145.33811669],[-37.90662411,145.33859213],[-37.90669163,145.33873325],[-37.90678864,145.33896594],[-37.90684207,145.33910556],[-37.90689989,145.33928192],[-37.90695699,145.33949675],[-37.90699338,145.33967394],[-37.90701963,145.33982872],[-37.90704437,145.34001141],[-37.90708591,145.34037502],[-37.90711891,145.34063805],[-37.90714105,145.34078326],[-37.9071704,145.34094719],[-37.90720916,145.34110749],[-37.90728034,145.34137444],[-37.90734709,145.34156415],[-37.90740648,145.34171148],[-37.90747046,145.34185154],[-37.90756013,145.34202435],[-37.90765449,145.34219729],[-37.90777116,145.34239315],[-37.9080135,145.34278992],[-37.90812999,145.34297942],[-37.9084341,145.34349469],[-37.9084805,145.34358328],[-37.90852682,145.34367893],[-37.90860387,145.3438518],[-37.90865777,145.34399926],[-37.90871639,145.34417561],[-37.90874678,145.34427901],[-37.90880243,145.34451276],[-37.9088247,145.34462897],[-37.90885578,145.34483324],[-37.90887447,145.34498274],[-37.9088874,145.34513965],[-37.90889486,145.34526665],[-37.90890444,145.34547345],[-37.90891479,145.34583152],[-37.90893461,145.34617095],[-37.90895869,145.34642839],[-37.90899202,145.34669677],[-37.90903272,145.34695747],[-37.90916976,145.34774415],[-37.90934313,145.34868631],[-37.90940697,145.34897778],[-37.90944349,145.34913325],[-37.90948539,145.34928735],[-37.90954941,145.34949499],[-37.90961756,145.34968263],[-37.90970579,145.3499011],[-37.90975514,145.35000783],[-37.90979519,145.35008815],[-37.90988933,145.35027169],[-37.91013939,145.35074521],[-37.91020486,145.35087695],[-37.9102714,145.35102094],[-37.91035598,145.35123609],[-37.91041023,145.35140994],[-37.91044957,145.35156137],[-37.91049421,145.35178161],[-37.91050901,145.35188013],[-37.9105252,145.35201252],[-37.91053723,145.35217059],[-37.91054129,145.35227355],[-37.91054144,145.35250275],[-37.91052954,145.35268308],[-37.91052152,145.35276653],[-37.9104919,145.35296875],[-37.91044088,145.35319955],[-37.9103962,145.35335524],[-37.91033483,145.35353565],[-37.9102622,145.35371665],[-37.91022751,145.35379443],[-37.91018757,145.35387745],[-37.91012553,145.35399667],[-37.91003914,145.35413475],[-37.90997898,145.35422163],[-37.90990463,145.35431804],[-37.90981431,145.35442675],[-37.90973334,145.35451387],[-37.9096791,145.35456637],[-37.90953726,145.35469568],[-37.90907662,145.35509348]];
const ALAMEIN_REAL_BRANCH: [number, number][] = [[-37.82759324,145.00769617],[-37.82776821,145.00928652],[-37.82782544,145.00976126],[-37.8278986,145.01050689],[-37.82790983,145.01073405],[-37.82791708,145.01104085],[-37.82791509,145.01135516],[-37.82790734,145.01157885],[-37.82789442,145.01179575],[-37.82787644,145.01202779],[-37.82784981,145.01227085],[-37.82781784,145.01250155],[-37.82779056,145.01266862],[-37.82776836,145.01279521],[-37.82771696,145.01304405],[-37.82764527,145.01334035],[-37.82759747,145.01351967],[-37.82750833,145.01381814],[-37.82741157,145.01411875],[-37.82735423,145.01428833],[-37.82723767,145.01461207],[-37.8271757,145.01476905],[-37.82704097,145.01507885],[-37.82695002,145.01526989],[-37.82680633,145.01553505],[-37.82668314,145.01573832],[-37.82643907,145.01613205],[-37.82618208,145.01656135],[-37.8255646,145.01763255],[-37.82498831,145.01864538],[-37.82468319,145.0192033],[-37.82434427,145.01976122],[-37.82399166,145.02029326],[-37.82369767,145.02071],[-37.82331727,145.0212564],[-37.82292734,145.02180396],[-37.82228418,145.02264161],[-37.82216208,145.0228138],[-37.82175942,145.02336055],[-37.82160051,145.0235895],[-37.82150873,145.02372714],[-37.82139871,145.02391048],[-37.82121231,145.02425196],[-37.82106347,145.02458152],[-37.82100554,145.0247278],[-37.82093548,145.02492439],[-37.82086701,145.02514559],[-37.82081549,145.02535168],[-37.82076966,145.02556864],[-37.82072841,145.02580115],[-37.82069866,145.02599439],[-37.8206745,145.02619805],[-37.82065764,145.02637493],[-37.8206413,145.02669062],[-37.82064063,145.02684957],[-37.82064433,145.02701136],[-37.82065127,145.02717227],[-37.82067917,145.02749826],[-37.82070913,145.02778045],[-37.82079427,145.028463],[-37.82084377,145.02879784],[-37.82096499,145.02955237],[-37.82103636,145.03007988],[-37.82121479,145.03151862],[-37.82127119,145.03201347],[-37.82131049,145.03246174],[-37.8213256,145.03276205],[-37.82133896,145.03308139],[-37.8213577,145.03378264],[-37.82137797,145.0342354],[-37.82139457,145.03446887],[-37.82141987,145.03475324],[-37.8214484,145.03502105],[-37.82153317,145.03569965],[-37.82155957,145.03596956],[-37.82162487,145.03645373],[-37.82164511,145.03661395],[-37.8216768,145.03693075],[-37.82169752,145.03726557],[-37.82170924,145.03756848],[-37.82173873,145.03814846],[-37.82175637,145.03841202],[-37.82177694,145.03860824],[-37.82183361,145.03908889],[-37.82196517,145.04004585],[-37.8222034,145.04199895],[-37.82223912,145.04233145],[-37.82225876,145.04257485],[-37.82229212,145.04300988],[-37.82233679,145.04372909],[-37.82236021,145.04404294],[-37.82238739,145.04434488],[-37.82242046,145.0446645],[-37.82247847,145.04517352],[-37.82256622,145.04590467],[-37.82261579,145.04631803],[-37.82269702,145.04693336],[-37.82276497,145.04737385],[-37.82306568,145.04907995],[-37.82336514,145.05085347],[-37.82343306,145.05122183],[-37.82347709,145.05142085],[-37.82350269,145.0515247],[-37.82355631,145.05172063],[-37.82361339,145.05190261],[-37.82369339,145.05212443],[-37.82376991,145.05231033],[-37.82382631,145.05243473],[-37.82392094,145.05262561],[-37.82396789,145.05271277],[-37.82408382,145.05291127],[-37.82421121,145.05310503],[-37.82427652,145.05319659],[-37.8243587,145.05330486],[-37.82442833,145.05339029],[-37.82453621,145.05351583],[-37.8246164,145.05360234],[-37.82473508,145.05372181],[-37.82482682,145.05380359],[-37.82515088,145.05410286],[-37.82528082,145.05422771],[-37.82540442,145.05435614],[-37.82552386,145.05448877],[-37.82567898,145.05468114],[-37.825735,145.0547559],[-37.82582887,145.05489011],[-37.82588269,145.05497323],[-37.82596708,145.05511156],[-37.8260185,145.05520246],[-37.82610398,145.05536905],[-37.82616432,145.05549755],[-37.82626077,145.05572804],[-37.82635066,145.05597587],[-37.82644722,145.05626793],[-37.82649137,145.0564147],[-37.82652623,145.05653933],[-37.82655093,145.05664367],[-37.82656932,145.05674226],[-37.82660378,145.0569954],[-37.82663114,145.05728281],[-37.82664591,145.05748965],[-37.82669922,145.0580502],[-37.82671416,145.05823977],[-37.82672846,145.05848969],[-37.82673341,145.05870248],[-37.82673276,145.05885997],[-37.82672526,145.05923021],[-37.82671849,145.05936059],[-37.82669292,145.05966859],[-37.82661648,145.06038353],[-37.8265972,145.06069079],[-37.8265358,145.06266488],[-37.8264856,145.06418795],[-37.82648728,145.064323],[-37.82650254,145.0646539],[-37.82650189,145.06484445],[-37.82649586,145.06500958],[-37.82647777,145.06524682],[-37.82645986,145.0653909],[-37.82644336,145.06549983],[-37.82623229,145.06669535],[-37.82619742,145.06690985],[-37.82617772,145.06705443],[-37.82616751,145.06716252],[-37.82615797,145.06730104],[-37.82615628,145.06747207],[-37.82615922,145.06756357],[-37.82616619,145.0676753],[-37.82618312,145.06783926],[-37.82620241,145.06797145],[-37.82622471,145.06808392],[-37.82627352,145.06829011],[-37.82631367,145.06842494],[-37.82635243,145.06853528],[-37.82641353,145.06868934],[-37.82646812,145.0688088],[-37.82651904,145.06890757],[-37.8266325,145.06909991],[-37.82668321,145.06917562],[-37.82678447,145.06931057],[-37.8269055,145.06944808],[-37.82698826,145.06953272],[-37.8271054,145.06963635],[-37.82720996,145.06971441],[-37.82727613,145.06975961],[-37.82734406,145.06980249],[-37.82740847,145.06983944],[-37.82748506,145.06987755],[-37.8275736,145.06991853],[-37.82764517,145.06994689],[-37.82770354,145.06996696],[-37.82777602,145.06999041],[-37.82787233,145.07001676],[-37.82795246,145.07003387],[-37.82808106,145.07005586],[-37.82815086,145.07006415],[-37.82825913,145.07007212],[-37.82832728,145.07007353],[-37.82839024,145.07007132],[-37.82846749,145.07006715],[-37.82856692,145.07005763],[-37.82882198,145.07002053],[-37.82934772,145.06993184],[-37.82963218,145.06989034],[-37.82996536,145.06984701],[-37.83054093,145.0697802],[-37.83071591,145.06975655],[-37.83102186,145.06971187],[-37.83139244,145.06964677],[-37.83270872,145.06939964],[-37.83313078,145.06932489],[-37.83324022,145.06931091],[-37.83334356,145.06930333],[-37.83343347,145.06930166],[-37.8335806,145.06930521],[-37.83367544,145.06931263],[-37.83376067,145.06932245],[-37.83385591,145.06933826],[-37.8339516,145.06935906],[-37.83406228,145.06938765],[-37.83415557,145.06941578],[-37.83424212,145.0694458],[-37.83433129,145.06948097],[-37.83443792,145.06952614],[-37.83453572,145.06957188],[-37.83474733,145.06968204],[-37.83486247,145.06974608],[-37.83498968,145.06982105],[-37.83549341,145.07014302],[-37.8357246,145.07029346],[-37.83615151,145.07056982],[-37.83666223,145.07089502],[-37.83834118,145.07194273],[-37.83895373,145.07232893],[-37.84030333,145.07320311],[-37.84083374,145.07354272],[-37.84170807,145.07410987],[-37.84236126,145.07452914],[-37.84256406,145.07465251],[-37.84280174,145.07478701],[-37.84307376,145.07492722],[-37.84332953,145.07505489],[-37.84349724,145.07514315],[-37.8436082,145.07520493],[-37.84375579,145.07529155],[-37.84405792,145.07547677],[-37.84433788,145.07566166],[-37.84443351,145.07572861],[-37.84464734,145.07588738],[-37.84536771,145.07643665],[-37.8457238,145.07669231],[-37.84603718,145.07690396],[-37.84693874,145.07748945],[-37.84948429,145.07913299],[-37.85154892,145.08047019],[-37.85425317,145.08221551],[-37.85455193,145.08240485],[-37.85486518,145.08258143],[-37.855098,145.08269462],[-37.85529349,145.08277935],[-37.85546897,145.08284664],[-37.85558613,145.08288588],[-37.85569499,145.0829192],[-37.85595266,145.08298652],[-37.85614606,145.08302573],[-37.8563349,145.08305562],[-37.85643983,145.08306904],[-37.8565494,145.08307881],[-37.85664514,145.08308656],[-37.85676526,145.08309175],[-37.85697042,145.08309462],[-37.85717613,145.08308758],[-37.85741382,145.08306813],[-37.85752387,145.08305277],[-37.85776833,145.08301166],[-37.85797072,145.08296675],[-37.85809651,145.08293234],[-37.85821118,145.0828963],[-37.8583389,145.08285321],[-37.858486,145.08279915],[-37.85867508,145.08272265],[-37.8588548,145.08264638],[-37.86043371,145.0819571],[-37.86054319,145.08191221],[-37.86064775,145.08187506],[-37.86079829,145.08183307],[-37.86088777,145.08180495],[-37.86094902,145.08178108],[-37.86111658,145.08170536],[-37.86198344,145.0813247],[-37.86362258,145.08060959],[-37.86372297,145.08057095],[-37.86385766,145.08052449],[-37.86398369,145.08048303],[-37.8640971,145.08045223],[-37.86425033,145.08041541],[-37.86442306,145.08038046],[-37.86619178,145.0800473],[-37.86633393,145.08002133],[-37.8669585,145.0799194],[-37.86726871,145.07986577],[-37.86791019,145.07974521],[-37.86818462,145.07969648]];
const LILYDALE_LINE: [number, number][] = [
  ...RICHMOND_TO_BURNLEY_TRACK,
  ...LILYDALE_REAL_BRANCH,
];
const BELGRAVE_LINE: [number, number][] = [
  ...RICHMOND_TO_BURNLEY_TRACK,
  ...BELGRAVE_REAL_BRANCH,
];
const ALAMEIN_LINE: [number, number][] = [
  ...RICHMOND_TO_BURNLEY_TRACK,
  ...ALAMEIN_REAL_BRANCH,
];
// Real GTFS shapes.txt track, spliced from two shapes at Town Hall (the
// schedule genuinely splits every Metro Tunnel trip's TDN there, so no
// single shape spans Arden all the way to Anzac): shape 2-SUY-vpt-1.1.H for
// the Arden -> Town Hall half, shape 2-CBE-vpt-1.1.H for Town Hall -> Anzac.
const METRO_TUNNEL_REAL_TRACK: [number, number][] = [
  [-37.80131483, 144.94134642],
  [-37.80061241, 144.94654158],
  [-37.80013454, 144.95049533],
  [-37.79982747, 144.95274631],
  [-37.79969464, 144.9536907],
  [-37.7996524, 144.95402372],
  [-37.79962079, 144.95434146],
  [-37.79960854, 144.9545803],
  [-37.79959273, 144.95506103],
  [-37.79959073, 144.95524666],
  [-37.79959673, 144.95545195],
  [-37.79960717, 144.95563315],
  [-37.79982137, 144.95800091],
  [-37.79983419, 144.95810629],
  [-37.79994778, 144.95920027],
  [-37.80008698, 144.96054069],
  [-37.80012972, 144.96092714],
  [-37.8001752, 144.96119619],
  [-37.80024424, 144.9614571],
  [-37.80031886, 144.96170719],
  [-37.80040982, 144.96194285],
  [-37.80055228, 144.96225467],
  [-37.80068769, 144.96250762],
  [-37.80082368, 144.96272104],
  [-37.80093503, 144.96287006],
  [-37.80107518, 144.96302237],
  [-37.80119533, 144.96313844],
  [-37.80133693, 144.96326504],
  [-37.80147602, 144.96337673],
  [-37.80160919, 144.96347415],
  [-37.80177376, 144.96357367],
  [-37.8019198, 144.96364995],
  [-37.80204316, 144.96370108],
  [-37.80214182, 144.96373642],
  [-37.80224941, 144.9637672],
  [-37.80240937, 144.96380403],
  [-37.80255551, 144.96382807],
  [-37.80266463, 144.96384302],
  [-37.80276153, 144.96384933],
  [-37.80296913, 144.96385294],
  [-37.80305962, 144.96384841],
  [-37.80322368, 144.96382483],
  [-37.80338786, 144.96378238],
  [-37.80357481, 144.96371751],
  [-37.80383457, 144.96360486],
  [-37.80402346, 144.96348041],
  [-37.80422502, 144.96331154],
  [-37.80441004, 144.96314029],
  [-37.80478263, 144.96283532],
  [-37.80510357, 144.96264409],
  [-37.80544492, 144.9624925],
  [-37.80560231, 144.96244286],
  [-37.80576056, 144.9624167],
  [-37.80594582, 144.96240025],
  [-37.80611879, 144.96239686],
  [-37.80631943, 144.96240418],
  [-37.80650186, 144.96242165],
  [-37.8066499, 144.96244143],
  [-37.80684454, 144.96248742],
  [-37.80714141, 144.96259785],
  [-37.80744164, 144.96272567],
  [-37.80824717, 144.96309392],
  [-37.8094122, 144.96362462],
  [-37.81608984, 144.96670228],
  [-37.81688297, 144.96731315],
  [-37.81733083, 144.96752068],
  [-37.8185997, 144.96808535],
  [-37.81953042, 144.96878916],
  [-37.82137526, 144.97039609],
  [-37.82209848, 144.97081105],
  [-37.82453902, 144.97154663],
  [-37.82527159, 144.97167756],
  [-37.82591589, 144.97170695],
  [-37.8266697, 144.97166382],
  [-37.82706774, 144.97160565],
  [-37.82755573, 144.97151185],
  [-37.82801821, 144.97143851],
  [-37.82927534, 144.97124422],
  [-37.82956916, 144.97121516],
  [-37.82999246, 144.97118981],
  [-37.83069767, 144.97122912],
  [-37.83098478, 144.97128602],
  [-37.83153844, 144.9715148],
  [-37.83200344, 144.97174488],
  [-37.83223646, 144.97190541],
  [-37.83236647, 144.97205012],
  [-37.83252257, 144.97227128],
  [-37.83267602, 144.97247387],
  [-37.83304147, 144.97285734],
];
const METRO_TUNNEL_LINE: [number, number][] = METRO_TUNNEL_REAL_TRACK;
const RENDERED_MERNDA_LINE = [MERNDA_LINE[0], ...JOLIMONT_TO_WEST_RICHMOND, ...MERNDA_BRANCH_LINE.slice(1)];
const RENDERED_MERNDA_STATIONS = alignStationsToPolyline(MERNDA_STATIONS, RENDERED_MERNDA_LINE);
const RENDERED_HURSTBRIDGE_STATIONS = alignStationsToPolyline(HURSTBRIDGE_STATIONS, HURSTBRIDGE_BRANCH_LINE);
const RENDERED_CLIFTONHILL_LOOP_STATIONS = alignStationsToPolyline(
  CLIFTONHILLGROUPLOOP_STATIONS,
  [...JOLIMONT_TO_WEST_RICHMOND, ...CLIFTONHILL_LOOP],
);
const RENDERED_NORTHERN_LOOP_STATIONS = alignStationsToPolyline(NORTHERNGROUPLOOP_STATIONS, NORTHERN_LOOP);
const RENDERED_NORTHERN_LOOP_CRAIGIEBURN_STATIONS = alignStationsToRenderedPolyline(
  NORTHERNGROUPLOOP_STATIONS,
  NORTHERN_LOOP,
  "left",
  0.42,
);
const RENDERED_BURNLEY_LOOP_STATIONS = alignStationsToRenderedPolyline(
  BURNLEYGROUPLOOP_STATIONS,
  BURNLEY_LOOP,
  "left",
  0.45,
);
const RENDERED_CRAIGIEBURN_STATIONS = alignStationsToRenderedPolyline(
  CRAIGIEBURN_STATIONS,
  CRAIGIEBURN_LINE,
  "left",
  0.45,
);
const RENDERED_CRANBOURNE_STATIONS = alignStationsToRenderedPolyline(
  CRANBOURNE_STATIONS,
  CRANBOURNE_LINE,
  "left",
  0.6,
);
const RENDERED_SUNBURY_STATIONS = alignStationsToRenderedPolyline(
  SUNBURY_STATIONS,
  SUNBURY_LINE,
  "left",
  0.6,
);
const RENDERED_METRO_TUNNEL_STATIONS = alignStationsToRenderedPolyline(
  METRO_TUNNEL_STATIONS,
  METRO_TUNNEL_LINE,
  "left",
  0.6,
);
const GIPPSLAND_LINE: [number, number][] = [
  [-37.81760709859187, 144.95075647527574], // Southern Cross PL 15 
  [-37.82003795534144, 144.9528633468371], // other End of Southern Cross
  [-37.82129209074471, 144.9550755519225],
  [-37.82136837320113, 144.9559339066656],
  [-37.82131857949724, 144.95652927526464],
  [-37.820857746012116, 144.95761022756787],
  [-37.820073469467914, 144.9597783875615],
  [-37.818990477433246, 144.96368834682139],
  [-37.818821008246935, 144.96515822429285], // Flinders Street
  [-37.818150662566204, 144.96736131393143],
[-37.81818831342351, 144.96738684195435],
  [-37.817639232385886, 144.96846961450348],
  [-37.81714544962751, 144.97007759187528],
  [-37.81681551870191, 144.97131452441218],
  [-37.81660939712368, 144.9731447175639],
  [-37.81685517913301, 144.97491898208378],
  [-37.81755762249785, 144.9762976432565],
  [-37.81794590442121, 144.97726539063947],
  [-37.81817605752223, 144.9775121630495],
  [-37.818423759304906, 144.97790945754892],
  [-37.818742642858254, 144.9783909140706],
  [-37.8196908100639, 144.97988356338206],
  [-37.82112098337264, 144.9820521293735],
  [-37.82230421180452, 144.98414375600464],
  [-37.823516110116486, 144.98802759456223],
  [-37.823476053233385, 144.9882499129706], // Richmond
  [-37.82399301107746, 144.9901703745477],
  [-37.82466788109256, 144.99168870460775],
  [-37.82663700198918, 144.9937727998178], // adsf
  [-37.8311146308829, 144.99377198472502],
  [-37.831791409259644, 144.99362628424882],
  [-37.832731891109304, 144.99342654024068],
  [-37.83392014167189, 144.99317215202188],
  [-37.83511518438329, 144.99299724118583],
  [-37.835784644893494, 144.99289278063767],
  [-37.83725989427833, 144.99260545847454],
  [-37.83792726162909, 144.99254420463757],
  [-37.83845859357905, 144.99236423742724], // South Yarra
[-37.83996928304227, 144.9924849986416],
[-37.84097754580992, 144.9934720515407],
[-37.841667764546266, 144.99487698594072],
[-37.84332351771486, 144.9989121534479],
  [-37.84450296093722, 145.00179929213567], // Hawksburn
  [-37.84484397157079, 145.00257981496097], // hwksburn end 
  [-37.8506631, 145.0136792], // Toorak
  [-37.8562948, 145.0192436], // Armadale
  [-37.8663425, 145.029464], // Malvern
  [-37.8773212, 145.0423811], // Caulfield
  [-37.88584755576908, 145.0576145973216], // Carnegie
  [-37.889800131059374, 145.06676121081267], // Murrumbeena
  [-37.89413917232323, 145.07620072615813], // Hughesdale
  [-37.900458908475315, 145.08839984150381], // Oakleigh
  [-37.91097055312629, 145.10241977630986], // Huntingdale
  [-37.924541507360765, 145.12053998830723], // Clayton
  [-37.937755318504934, 145.13805369881837], // Westall
  [-37.94893771437316, 145.15307099140574], // Springvale
  [-37.95653055647639, 145.1628965591817], // Sandown Park
  [-37.966678, 145.176944], // Noble Park
  [-37.978254, 145.191501], // Yarraman
  [-37.98991938287247, 145.20988128532633], // Dandenong
  ...PAKENHAM_GTFS_OUTER_TRACK.slice(1),
  [-38.0954, 145.5802],
  [-38.1088, 145.6761],
  [-38.1217, 145.7688],
  [-38.1348, 145.8539],
  [-38.1489, 145.9318],
  [-38.15965088085526, 145.92871651094258], // Warragul
  [-38.1689, 146.0374],
  [-38.1738, 146.1452],
  [-38.17588027961461, 146.26083329049215], // Moe
  [-38.1967, 146.3314],
  [-38.2165, 146.3718],
  [-38.23555857042696, 146.39640612076153], // Morwell
  [-38.2206, 146.4587],
  [-38.2058, 146.5029],
  [-38.19489747401578, 146.5415475189243], // Traralgon
];
const GIPPSLAND_CARNEGIE_INDEX = GIPPSLAND_LINE.findIndex(
  ([lat, lng]) =>
    Math.abs(lat - -37.88584755576908) < 0.000001 &&
    Math.abs(lng - 145.0576145973216) < 0.000001,
);
const GIPPSLAND_PRE_CARNEGIE_LINE =
  GIPPSLAND_CARNEGIE_INDEX >= 0 ? GIPPSLAND_LINE.slice(0, GIPPSLAND_CARNEGIE_INDEX + 1) : GIPPSLAND_LINE;
const GIPPSLAND_POST_CARNEGIE_LINE =
  GIPPSLAND_CARNEGIE_INDEX >= 0 ? GIPPSLAND_LINE.slice(GIPPSLAND_CARNEGIE_INDEX) : GIPPSLAND_LINE;
const GIPPSLAND_RICHMOND_INDEX = GIPPSLAND_PRE_CARNEGIE_LINE.findIndex(
  ([lat, lng]) =>
    Math.abs(lat - -37.823476053233385) < 0.000001 &&
    Math.abs(lng - 144.9882499129706) < 0.000001,
);
const GIPPSLAND_VISIBLE_PRE_CARNEGIE_LINE =
  GIPPSLAND_RICHMOND_INDEX >= 0
    ? GIPPSLAND_PRE_CARNEGIE_LINE.slice(GIPPSLAND_RICHMOND_INDEX)
    : GIPPSLAND_PRE_CARNEGIE_LINE;
const MAP_GIPPSLAND_STATIONS = GIPPSLAND_STATIONS.filter(
  (station) => station.name !== "Southern Cross" && station.name !== "Flinders Street",
);
const RENDERED_PAKENHAM_STATIONS = alignStationsToPolyline(PAKENHAM_STATIONS, PAKENHAM_GTFS_LINE);
const RENDERED_GIPPSLAND_LINE = [
  ...GIPPSLAND_VISIBLE_PRE_CARNEGIE_LINE,
  ...offsetPolylineCoordinates(GIPPSLAND_POST_CARNEGIE_LINE, "right", 0.38).slice(1),
];
const RENDERED_GIPPSLAND_STATIONS = alignStationsToPolyline(MAP_GIPPSLAND_STATIONS, RENDERED_GIPPSLAND_LINE);
const BAIRNSDALE_DEBUG_TRACK_POINTS = [
  ...GIPPSLAND_VISIBLE_PRE_CARNEGIE_LINE,
  ...offsetPolylineCoordinates(GIPPSLAND_POST_CARNEGIE_LINE, "right", 0.38).slice(1),
].map((position, index) => ({ position, index }));
const GEELONG_LINE: [number, number][] = [
  [-37.79971717185788, 144.92584789732544], // South Kensington
  [-37.801696124765726, 144.90150029345793], // Footscray
  [-37.80244211892746, 144.89150101820428], // Middle Footscray
  [-37.80159439768236, 144.88351876420322], // West Footscray
  [-37.79906652439008, 144.86302968739224], // Tottenham
  [-37.7941, 144.8474], // White City
  [-37.78812106172095, 144.83237218696007], // Sunshine
  [-37.7794, 144.8008], // Ardeer
  [-37.7686, 144.7759], // Deer Park
  [-37.745, 144.7312], // Robinsons Road Junction corridor
  [-37.8361, 144.6948], // Tarneit
  [-37.8646, 144.6567], // Wyndham Vale
  [-37.8976, 144.6519], // Little River
  [-38.0222, 144.4066], // Lara
  [-38.0709, 144.3595], // Corio
  [-38.0954, 144.3465], // North Shore
  [-38.1113, 144.343], // North Geelong
  [-38.1471, 144.3607], // Geelong
  [-38.1608, 144.3733], // South Geelong
  [-38.1713, 144.3792], // Geelong Racecourse corridor
  [-38.1912, 144.3618], // Marshall
  [-38.2143, 144.3222], // Waurn Ponds
];
const BALLARAT_SHARED_VLINE_TRUNK: [number, number][] = [
  [-37.81767225337158, 144.950639128634], // Southern Cross
  [-37.8128, 144.9469],
  [-37.8096, 144.9443],
  [-37.8073, 144.9426], // North Melbourne
  [-37.8047, 144.9378],
  [-37.8022, 144.9326],
  [-37.8008, 144.9291],
  [-37.79971717185788, 144.92584789732544], // South Kensington
  [-37.801696124765726, 144.90150029345793], // Footscray
  [-37.78812106172095, 144.83237218696007], // Sunshine
];
const SEYMOUR_REGIONAL_LINE: [number, number][] = [
  [-37.81767225337158, 144.950639128634], // Southern Cross
  [-37.8128, 144.9469],
  [-37.8096, 144.9443],
  [-37.8073, 144.9426], // North Melbourne
  [-37.7812, 144.9313],
  [-37.7407, 144.9241],
  [-37.6805, 144.9191], // Broadmeadows
  [-37.4684, 144.9594],
  [-37.2452, 145.0418],
  [-37.0264, 145.1337], // Seymour
];
const BENDIGO_REGIONAL_LINE: [number, number][] = [
  [-37.81767225337158, 144.950639128634], // Southern Cross
  [-37.801696124765726, 144.90150029345793], // Footscray
  [-37.78812106172095, 144.83237218696007], // Sunshine
  [-37.5792, 144.7282], // Sunbury
  [-37.4978, 144.7452], // Clarkefield
  [-37.4640, 144.6805], // Riddells Creek
  [-37.4591, 144.5994], // Gisborne
  [-37.4235, 144.5628], // Macedon
  [-37.3572, 144.5261], // Woodend
  [-37.2581, 144.4503], // Kyneton
  [-37.1894, 144.3741], // Malmsbury
  [-37.0631, 144.2138], // Castlemaine
  [-36.7964, 144.2493], // Kangaroo Flat
  [-36.7652, 144.2830], // Bendigo
];
const RENDERED_SEYMOUR_REGIONAL_STATIONS = alignStationsToPolyline(SEYMOUR_REGIONAL_STATIONS, SEYMOUR_REGIONAL_LINE);
const RENDERED_SEYMOUR_REGIONAL_OFFSET_STATIONS = alignStationsToRenderedPolyline(
  SEYMOUR_REGIONAL_STATIONS,
  SEYMOUR_REGIONAL_LINE,
  "right",
  0.45,
);
const SUNSHINE_VLINE_EXPRESS_OVERLAY: [number, number][] = [
  [-37.7929, 144.8468],
  [-37.7914, 144.8418],
  [-37.7901, 144.8373],
  [-37.7889, 144.8346],
  [-37.7867, 144.8278],
  [-37.7835, 144.8185],
  [-37.7794, 144.8008], // Ardeer
];
const SUNSHINE_VLINE_STOPPING_OVERLAY: [number, number][] = [
  [-37.78812106172095, 144.83237218696007], // Sunshine
  [-37.7869, 144.8283],
  [-37.7846, 144.8213],
  [-37.7817, 144.8115],
  [-37.7794, 144.8008], // Ardeer
];
const BALLARAT_LINE: [number, number][] = [
  ...BALLARAT_SHARED_VLINE_TRUNK,
  [-37.7295, 144.7752], // Deer Park corridor
  [-37.6918, 144.6151], // Rockbank corridor
  [-37.6832, 144.5837], // Cobblebank corridor
  [-37.6841, 144.5698], // Melton
  [-37.7017, 144.4419], // Bacchus Marsh
  [-37.7085, 144.2291], // Ballan
  [-37.7376, 144.1065], // Gordon corridor
  [-37.55861757585211, 143.85946145441608], // Ballarat
  [-37.5309, 143.8487], // Wendouree
];
const ARARAT_BRANCH_LINE: [number, number][] = [
  [-37.55861757585211, 143.85946145441608], // Ballarat
  [-37.5309, 143.8487], // Wendouree
  [-37.4730, 143.6578], // Burrumbeet corridor
  [-37.42768, 143.38232], // Beaufort
  [-37.4372, 143.2820], // Trawalla corridor
  [-37.3663, 143.1640], // Buangor corridor
  [-37.2823, 142.9367], // Ararat
];
const MARYBOROUGH_BRANCH_LINE: [number, number][] = [
  [-37.55861757585211, 143.85946145441608], // Ballarat
  [-37.4240, 143.8950], // Creswick
  [-37.2940, 143.7870], // Clunes
  [-37.1720, 143.7060], // Talbot
  [-37.0510, 143.7426], // Maryborough
];
const FREIGHT_LOCATIONS: FreightLocation[] = [
  { name: "Appleton Dock", kind: "Dock terminal", position: [-37.8261, 144.9159] },
  { name: "Dynon", kind: "Freight terminal", position: [-37.8139, 144.9388] },
  { name: "South Dynon", kind: "Freight yard", position: [-37.8189, 144.9305] },
  { name: "Tottenham Yard", kind: "Freight yard", position: [-37.7994, 144.8728] },
  { name: "West Footscray", kind: "Junction", position: [-37.80159439768236, 144.88351876420322] },
  { name: "North Geelong Yard", kind: "Freight yard", position: [-38.0972, 144.3447] },
  { name: "Gheringhap Loop", kind: "Passing loop", position: [-38.2213, 144.2054] },
  { name: "Maroona Loop", kind: "Passing loop", position: [-37.4364, 142.8823] },
  { name: "Seymour", kind: "Freight corridor", position: [-37.0264, 145.1337] },
  { name: "Benalla", kind: "Freight corridor", position: [-36.5515, 145.9843] },
  { name: "Wodonga", kind: "Freight corridor", position: [-36.1212, 146.8879] },
  { name: "Ballarat", kind: "Freight corridor", position: [-37.55861757585211, 143.85946145441608] },
  { name: "Maryborough", kind: "Freight corridor", position: [-37.0510, 143.7426] },
];
const FREIGHT_PORT_TERMINAL_LINE: [number, number][] = [
  [-37.8261, 144.9159], // Appleton Dock
  [-37.8219, 144.9202],
  [-37.8189, 144.9305], // South Dynon
  [-37.8139, 144.9388], // Dynon
  [-37.8078, 144.9136],
  [-37.80159439768236, 144.88351876420322], // West Footscray
  [-37.7994, 144.8728], // Tottenham Yard
];
const FREIGHT_WESTERN_CORRIDOR_LINE: [number, number][] = [
  [-37.8189, 144.9305], // South Dynon
  [-37.8078, 144.9136],
  [-37.80159439768236, 144.88351876420322], // West Footscray
  [-37.7994, 144.8728], // Tottenham Yard
  [-37.78812106172095, 144.83237218696007], // Sunshine corridor
  [-38.0972, 144.3447], // North Geelong Yard
  [-38.2213, 144.2054], // Gheringhap Loop
  [-37.4364, 142.8823], // Maroona Loop
  [-37.55861757585211, 143.85946145441608], // Ballarat
  [-37.0510, 143.7426], // Maryborough
];
const FREIGHT_NORTH_CORRIDOR_LINE: [number, number][] = [
  [-37.8189, 144.9305], // South Dynon
  [-37.8073, 144.9426], // North Melbourne corridor
  [-37.0264, 145.1337], // Seymour
  [-36.5515, 145.9843], // Benalla
  [-36.1212, 146.8879], // Wodonga
];
// Real GTFS shape for the Melbourne-Sydney corridor (7,586 points), not a
// hand-typed straight line between the ~18 named stops — those long straight
// hops (e.g. Southern Cross to Broadmeadows to Seymour, tens of km apart)
// rendered as sharp, jagged kinks instead of the track's real curvature.
const XPT_INTERSTATE_LINE: [number, number][] = (
  GENERATED_NSW_TRAINLINK_GTFS.find((trip) => trip.id === "4T.T.ST21")?.shape ?? []
).map(([lat, lng]) => [lat, lng]);
const XPT_INTERSTATE_STOPS: Array<{ name: string; position: [number, number]; note?: string }> = [
  { name: "Southern Cross", position: [-37.81767225337158, 144.950639128634] },
  { name: "Broadmeadows", position: [-37.6805, 144.9191], note: "Pick up only" },
  { name: "Seymour", position: [-37.0264, 145.1337], note: "Pick up only" },
  { name: "Wangaratta", position: [-36.3582, 146.3181] },
  { name: "Albury", position: [-36.0796, 146.924] },
  { name: "Culcairn", position: [-35.6682, 147.0396], note: "Request stop" },
  { name: "Henty", position: [-35.5209, 147.0399], note: "Request stop" },
  { name: "The Rock", position: [-35.2741, 147.1133], note: "Request stop" },
  { name: "Wagga Wagga", position: [-35.1082, 147.3673] },
  { name: "Junee", position: [-34.8654, 147.5859] },
  { name: "Cootamundra", position: [-34.6393, 148.0273] },
  { name: "Harden", position: [-34.5537, 148.373], note: "Request stop" },
  { name: "Yass Junction", position: [-34.8428, 148.9118], note: "Request stop" },
  { name: "Gunning", position: [-34.7874, 149.2661], note: "Request stop" },
  { name: "Goulburn", position: [-34.7545, 149.7202] },
  { name: "Moss Vale", position: [-34.5519, 150.3717] },
  { name: "Campbelltown", position: [-34.0657, 150.8148], note: "Drop off only" },
  { name: "Sydney Central", position: [-33.883, 151.207] },
];
export const ALL_STATIONS: Station[] = [
    ...CLIFTONHILLGROUPLOOP_STATIONS,
  ...MERNDA_STATIONS,
  ...HURSTBRIDGE_STATIONS,
  ...CAUFIELDLOOP_STATIONS,
  ...NORTHERNGROUPLOOP_STATIONS,
  ...BURNLEYGROUPLOOP_STATIONS,
  ...FRANKSTON_STATIONS,
  ...STONY_POINT_STATIONS,
  ...CRANBOURNE_STATIONS,
  ...PAKENHAM_STATIONS,
  ...SUNBURY_STATIONS,
  ...CRAIGIEBURN_STATIONS,
  ...UPFIELD_STATIONS,
  ...LILYDALE_STATIONS,
  ...BELGRAVE_STATIONS,
  ...ALAMEIN_STATIONS,
  ...GLEN_WAVERLEY_STATIONS,
  ...METRO_TUNNEL_STATIONS,
  ...SANDRINGHAM_STATIONS,
  ...WERRIBEE_STATIONS,
  ...WILLIAMSTOWN_STATIONS,
  ...ALTONA_LOOP_STATIONS,
  ...GIPPSLAND_STATIONS,
  ...BALLARAT_REGIONAL_STATIONS,
  ...SEYMOUR_REGIONAL_STATIONS,
].filter(
  (station, index, array) =>
    array.findIndex((item) => item.name === station.name) === index
);

const ROUTE_630_SURFACE_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "630", destination: "Elwood", departureLabel: "4 min", statusLabel: "Scheduled", note: "Toward Elwood" },
  { route: "630", destination: "Elwood", departureLabel: "17 min", statusLabel: "Scheduled", note: "Via North Rd" },
  { route: "630", destination: "Monash University", departureLabel: "29 min", statusLabel: "Scheduled", note: "Return working" },
];

const ROUTE_630_ELWOOD_STOP_DATA: Array<{
  name: string;
  locality: string;
  position: [number, number];
  platform?: string;
}> = [
  { name: "Monash University", locality: "Clayton", position: [-37.91464313, 145.13183523], platform: "Bay A" },
  { name: "Princes Hwy/North Rd", locality: "Clayton", position: [-37.91441604, 145.12492487] },
  { name: "Clayton Rd/North Rd", locality: "Clayton", position: [-37.91399193, 145.12150037] },
  { name: "Banksia St/North Rd", locality: "Clayton", position: [-37.91366689, 145.11864213] },
  { name: "Flora Rd/North Rd", locality: "Clayton", position: [-37.91337919, 145.11643134] },
  { name: "Colin Rd/North Rd", locality: "Oakleigh South", position: [-37.91295282, 145.11288186] },
  { name: "Milgate St/North Rd", locality: "Oakleigh South", position: [-37.91248923, 145.10926514] },
  { name: "Huntingdale Station/Haughton Rd", locality: "Oakleigh", position: [-37.91086528, 145.10299383], platform: "Bay C" },
  { name: "Windsor Ave/North Rd", locality: "Oakleigh South", position: [-37.91127333, 145.09924109] },
  { name: "Gadd St/North Rd", locality: "Oakleigh South", position: [-37.91095915, 145.09653065] },
  { name: "South Oakleigh Bowling Club/North Rd", locality: "Oakleigh South", position: [-37.91059896, 145.09376455] },
  { name: "Best St/North Rd", locality: "Oakleigh South", position: [-37.91034682, 145.09155304] },
  { name: "Cleek Ave/North Rd", locality: "Oakleigh South", position: [-37.90990941, 145.08792453] },
  { name: "Warrigal Rd/North Rd", locality: "Bentleigh East", position: [-37.90973552, 145.08609776] },
  { name: "White St/North Rd", locality: "Bentleigh East", position: [-37.90909080, 145.08137140] },
  { name: "Hallow St/North Rd", locality: "Bentleigh East", position: [-37.90875727, 145.07860476] },
  { name: "Coatesville Uniting Church/North Rd", locality: "Bentleigh East", position: [-37.90848136, 145.07661008] },
  { name: "Poet Rd/North Rd", locality: "Bentleigh East", position: [-37.90812580, 145.07360521] },
  { name: "Baker St/North Rd", locality: "Bentleigh East", position: [-37.90779433, 145.07097507] },
  { name: "Marlborough St/North Rd", locality: "Bentleigh East", position: [-37.90750444, 145.06868510] },
  { name: "Cobar St/North Rd", locality: "Bentleigh East", position: [-37.90716011, 145.06582787] },
  { name: "East Boundary Rd/North Rd", locality: "Bentleigh East", position: [-37.90671403, 145.06226815] },
  { name: "Murrong Ave/North Rd", locality: "Bentleigh East", position: [-37.90664972, 145.06055239] },
  { name: "Rochford St/North Rd", locality: "Bentleigh East", position: [-37.90634592, 145.05797851] },
  { name: "Elimatta Rd/North Rd", locality: "Bentleigh East", position: [-37.90613948, 145.05639161] },
  { name: "Tucker Rd/North Rd", locality: "Ormond", position: [-37.90590013514765, 145.05422800990036] },
  { name: "Collins St/North Rd", locality: "Ormond", position: [-37.90555663, 145.05166413] },
  { name: "Bewdley St/North Rd", locality: "Ormond", position: [-37.90532965, 145.04992995] },
  { name: "Tyrone St/North Rd", locality: "Ormond", position: [-37.90497624, 145.04709589] },
  { name: "Dunlop Ave/North Rd", locality: "Ormond", position: [-37.90440506, 145.04255022] },
  { name: "Ormond Station/North Rd", locality: "Ormond", position: [-37.90405375, 145.03985266] },
  { name: "Anthony St/North Rd", locality: "Ormond", position: [-37.90373414, 145.03743861] },
  { name: "Wheatley Rd/North Rd", locality: "Ormond", position: [-37.90349357, 145.03544330] },
  { name: "O'Loughlan St/North Rd", locality: "Ormond", position: [-37.90309942, 145.03234888] },
  { name: "Stewart St/North Rd", locality: "Ormond", position: [-37.90281931, 145.03014994] },
  { name: "Thompson St/North Rd", locality: "Ormond", position: [-37.90260406, 145.02859755] },
  { name: "Thomas St/North Rd", locality: "Brighton East", position: [-37.90232426, 145.02642138] },
  { name: "Hodder St/North Rd", locality: "Brighton East", position: [-37.90192567, 145.02307698] },
  { name: "Hawthorn Rd/North Rd", locality: "Brighton East", position: [-37.90141125, 145.01874626] },
  { name: "Landcox St/North Rd", locality: "Brighton East", position: [-37.90092984, 145.01477866] },
  { name: "North Rd/Kooyong Rd", locality: "Caulfield South", position: [-37.90001253, 145.01222170] },
  { name: "Kooyong Rd/Gardenvale Rd", locality: "Gardenvale", position: [-37.89841358, 145.01199178] },
  { name: "Magnolia Rd/Gardenvale Rd", locality: "Gardenvale", position: [-37.89816088, 145.00983781] },
  { name: "Begonia Rd/Gardenvale Rd", locality: "Gardenvale", position: [-37.89786557, 145.00729834] },
  { name: "Gardenvale Station/Martin St", locality: "Brighton", position: [-37.89744000, 145.00398910] },
  { name: "Cochrane St/Martin St", locality: "Brighton", position: [-37.89691743, 144.99974999] },
  { name: "Star Of The Sea College/Martin St", locality: "Brighton", position: [-37.89660293, 144.99715428] },
  { name: "New St/Martin St", locality: "Brighton", position: [-37.89637873, 144.99510199] },
  { name: "Martin St/Drake St", locality: "Brighton", position: [-37.89560444, 144.99197295] },
  { name: "Cole St/Drake St", locality: "Brighton", position: [-37.89405961, 144.99227648] },
  { name: "Head St/Drake St", locality: "Brighton", position: [-37.89213704, 144.99262437] },
  { name: "Head St/New St", locality: "Brighton", position: [-37.89173491, 144.99546678] },
  { name: "Elsternwick Park/Bent Ave", locality: "Brighton", position: [-37.88825917, 144.99457179] },
  { name: "St Kilda St/Bent Ave", locality: "Brighton", position: [-37.88791540, 144.99185211] },
];

const ROUTE_630_MONASH_STOP_DATA: Array<{
  name: string;
  locality: string;
  position: [number, number];
  platform?: string;
}> = [
  { name: "St Kilda St/Bent Ave", locality: "Brighton", position: [-37.88791540, 144.99185211] },
  { name: "St Kilda St/Head St", locality: "Brighton", position: [-37.89173681, 144.99135027] },
  { name: "Head St/Drake St", locality: "Brighton", position: [-37.89226547, 144.99275734] },
  { name: "Cole St/Drake St", locality: "Brighton", position: [-37.89378348, 144.99246593] },
  { name: "Martin St/Drake St", locality: "Brighton", position: [-37.89573287, 144.99210592] },
  { name: "New St/Martin St", locality: "Brighton", position: [-37.89613959, 144.99428969] },
  { name: "Star Of The Sea College/Martin St", locality: "Brighton", position: [-37.89648622, 144.99718018] },
  { name: "Cochrane St/Martin St", locality: "Brighton", position: [-37.89682202, 144.99996865] },
  { name: "Gardenvale Station/Martin St", locality: "Brighton", position: [-37.89732522, 145.00412867] },
  { name: "Begonia Rd/Gardenvale Rd", locality: "Gardenvale", position: [-37.89776037, 145.00747177] },
  { name: "Magnolia Rd/Gardenvale Rd", locality: "Gardenvale", position: [-37.89804455, 145.00988643] },
  { name: "Kooyong Rd/Gardenvale Rd", locality: "Gardenvale", position: [-37.89828709, 145.01197244] },
  { name: "North Rd/Kooyong Rd", locality: "Caulfield South", position: [-37.90004244, 145.01239148] },
  { name: "Younger Ave/North Rd", locality: "Brighton East", position: [-37.90077998, 145.01551055] },
  { name: "Hawthorn Rd/North Rd", locality: "Brighton East", position: [-37.90127822, 145.01994399] },
  { name: "Brighton Cemetery/North Rd", locality: "Brighton East", position: [-37.90159089, 145.02246042] },
  { name: "Bambra Rd/North Rd", locality: "Ormond", position: [-37.90197954, 145.02574821] },
  { name: "Spring Rd/North Rd", locality: "Ormond", position: [-37.90231010, 145.02826421] },
  { name: "Scott St/North Rd", locality: "Ormond", position: [-37.90263966, 145.03072339] },
  { name: "Frederick St/North Rd", locality: "Ormond", position: [-37.90294025, 145.03306964] },
  { name: "Ormond Uniting Hall/North Rd", locality: "Ormond", position: [-37.90325340, 145.03563166] },
  { name: "Dalmor Ave/North Rd", locality: "Ormond", position: [-37.90350411, 145.03769494] },
  { name: "Ormond Station/North Rd", locality: "Ormond", position: [-37.90372398, 145.03953158] },
  { name: "Ulupna Rd/North Rd", locality: "Ormond", position: [-37.90415719, 145.04281838] },
  { name: "Nicholls Rd/North Rd", locality: "Ormond", position: [-37.90463654, 145.04671817] },
  { name: "Wild Cherry Rd/North Rd", locality: "Bentleigh East", position: [-37.90507256, 145.05018696] },
  { name: "Koornang Rd/North Rd", locality: "Bentleigh East", position: [-37.90533354, 145.05234106] },
  { name: "Tara Gr/North Rd", locality: "Bentleigh East", position: [-37.90564590, 145.05488053] },
  { name: "Elimatta Rd/North Rd", locality: "Bentleigh East", position: [-37.90580056, 145.05605932] },
  { name: "Parkview Dr/North Rd", locality: "Bentleigh East", position: [-37.90615412, 145.05891621] },
  { name: "Murrumbeena Rd/North Rd", locality: "Bentleigh East", position: [-37.90637403, 145.06077573] },
  { name: "Crosbie Rd/North Rd", locality: "Bentleigh East", position: [-37.90697169, 145.06587830] },
  { name: "Brett St/North Rd", locality: "Bentleigh East", position: [-37.90733782, 145.06841648] },
  { name: "Reid St/North Rd", locality: "Bentleigh East", position: [-37.90780396, 145.07211223] },
  { name: "Poath Rd/North Rd", locality: "Bentleigh East", position: [-37.90799068, 145.07360873] },
  { name: "Brine St/North Rd", locality: "Bentleigh East", position: [-37.90835451, 145.07656789] },
  { name: "Austin St/North Rd", locality: "Bentleigh East", position: [-37.90862494, 145.07877881] },
  { name: "White St/North Rd", locality: "Bentleigh East", position: [-37.90896654, 145.08148837] },
  { name: "Warrigal Rd/North Rd", locality: "Bentleigh East", position: [-37.90932042, 145.08440237] },
  { name: "Eastgate St/North Rd", locality: "Oakleigh South", position: [-37.90976455, 145.08788279] },
  { name: "Best St/North Rd", locality: "Oakleigh South", position: [-37.91010431, 145.09104746] },
  { name: "Young St/North Rd", locality: "Oakleigh South", position: [-37.91046717, 145.09453005] },
  { name: "Gadd St/North Rd", locality: "Oakleigh South", position: [-37.91068726, 145.09643529] },
  { name: "McIntosh St/North Rd", locality: "Oakleigh South", position: [-37.91100511, 145.09937311] },
  { name: "Huntingdale Station/Haughton Rd", locality: "Oakleigh", position: [-37.91119986, 145.10306485], platform: "Bay A" },
  { name: "Shafton St/North Rd", locality: "Oakleigh South", position: [-37.91190920, 145.10738041] },
  { name: "Fenton St/North Rd", locality: "Clayton", position: [-37.91219501, 145.11002341] },
  { name: "Franklyn St/North Rd", locality: "Clayton", position: [-37.91255311, 145.11324470] },
  { name: "Coane St/North Rd", locality: "Clayton", position: [-37.91295044, 145.11666977] },
  { name: "Kennaugh St/North Rd", locality: "Clayton", position: [-37.91325242, 145.11921006] },
  { name: "Clayton North Primary School/North Rd", locality: "Clayton", position: [-37.91362920, 145.12248785] },
  { name: "Princes Hwy/North Rd", locality: "Clayton", position: [-37.91411960, 145.12611541] },
  { name: "Monash University", locality: "Clayton", position: [-37.91464313, 145.13183523], platform: "Bay A" },
];

const ROUTE_630_SURFACE_STOPS: SurfaceStop[] = ROUTE_630_ELWOOD_STOP_DATA.map((stop, index) => ({
  id: `route-630-elwood-${index + 1}`,
  name: stop.name,
  locality: stop.locality,
  position: stop.position,
  subtitle: stop.platform ? `630 bus stop · ${stop.platform}` : "630 bus stop",
  modes: ["bus"],
  routeLabel: "630",
  departures: ROUTE_630_SURFACE_DEPARTURES,
}));

const ROUTE_630_MONASH_SURFACE_STOPS: SurfaceStop[] = ROUTE_630_MONASH_STOP_DATA.map((stop, index) => ({
  id: `route-630-monash-${index + 1}`,
  name: stop.name,
  locality: stop.locality,
  position: stop.position,
  subtitle: stop.platform ? `630 bus stop · ${stop.platform}` : "630 bus stop",
  modes: ["bus"],
  routeLabel: "630",
  departures: ROUTE_630_SURFACE_DEPARTURES,
}));

const ROUTE_64_EASTBOUND_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "64", destination: "East Brighton", departureLabel: "2 min", statusLabel: "Tram due", note: "Southbound" },
  { route: "64", destination: "Melbourne University", departureLabel: "7 min", statusLabel: "Scheduled", note: "Northbound" },
  { route: "64", destination: "East Brighton", departureLabel: "14 min", statusLabel: "Scheduled", note: "Via St Kilda Rd" },
];

const ROUTE_64_WESTBOUND_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "64", destination: "Melbourne University", departureLabel: "1 min", statusLabel: "Tram due", note: "Northbound" },
  { route: "64", destination: "East Brighton", departureLabel: "8 min", statusLabel: "Scheduled", note: "Southbound" },
  { route: "64", destination: "Melbourne University", departureLabel: "16 min", statusLabel: "Scheduled", note: "Via Swanston St" },
];

const ROUTE_64_EASTBOUND_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Melbourne University/Swanston St #1", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Carlton" },
  { name: "Queensberry St/Swanston St #4", locality: "Melbourne City" },
  { name: "RMIT University/Swanston St #7", locality: "Melbourne City" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne City" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Melbourne City" },
  { name: "City Square/Swanston St #11", locality: "Melbourne City" },
  { name: "Federation Square/Swanston St #13", locality: "Melbourne City" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Southbank" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Southbank" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Melbourne City" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Melbourne City" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "South Melbourne" },
  { name: "Leopold St/St Kilda Rd #24", locality: "South Melbourne" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "South Melbourne" },
  { name: "Moubray St/St Kilda Rd #26", locality: "South Melbourne" },
  { name: "High St/St Kilda Rd #27", locality: "St Kilda" },
  { name: "Union St/St Kilda Rd #29", locality: "St Kilda" },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "St Kilda" },
  { name: "Queens Way/Queens Way #31", locality: "Windsor" },
  { name: "Chapel St/Dandenong Rd #32", locality: "Windsor" },
  { name: "Hornby St/Dandenong Rd #33", locality: "Windsor" },
  { name: "The Avenue/Dandenong Rd #34", locality: "Prahran" },
  { name: "Williams Rd/Dandenong Rd #35", locality: "Prahran" },
  { name: "Closeburn Ave/Dandenong Rd #36", locality: "St Kilda East" },
  { name: "Lansdowne Rd/Dandenong Rd #37", locality: "Prahran" },
  { name: "Orrong Rd/Dandenong Rd #38", locality: "Armadale" },
  { name: "Wattletree Rd/Dandenong Rd #40", locality: "Armadale" },
  { name: "Kooyong Rd/Dandenong Rd #42", locality: "Armadale" },
  { name: "Egerton Rd/Dandenong Rd #43", locality: "Armadale" },
  { name: "Bailey Ave/Dandenong Rd #44", locality: "Caulfield North" },
  { name: "Hawthorn Rd/Dandenong Rd #48", locality: "Caulfield North" },
  { name: "Arthur St/Hawthorn Rd #49", locality: "Caulfield North" },
  { name: "Inkerman Rd/Hawthorn Rd #50", locality: "Caulfield North" },
  { name: "Balaclava Rd/Hawthorn Rd #51", locality: "Caulfield North" },
  { name: "Halstead St/Hawthorn Rd #52", locality: "Caulfield North" },
  { name: "Northcote Ave/Hawthorn Rd #53", locality: "Caulfield North" },
  { name: "Glen Eira Rd/Hawthorn Rd #54", locality: "Caulfield North" },
  { name: "Sylverly Gr/Hawthorn Rd #55", locality: "Caulfield" },
  { name: "Briggs St/Hawthorn Rd #56", locality: "Caulfield" },
  { name: "Glenhuntly Rd/Hawthorn Rd #57", locality: "Caulfield South" },
  { name: "Sycamore St/Hawthorn Rd #58", locality: "Caulfield South" },
  { name: "Princes Park/Hawthorn Rd #59", locality: "Caulfield South" },
  { name: "Dover St/Hawthorn Rd #60", locality: "Caulfield South" },
  { name: "Stone St/Hawthorn Rd #61", locality: "Caulfield South" },
  { name: "Gardenvale Rd/Hawthorn Rd #62", locality: "Brighton East" },
  { name: "North Rd/Hawthorn Rd #63", locality: "Brighton East" },
  { name: "Taylor St/Hawthorn Rd #64", locality: "Brighton East" },
  { name: "Davey Ave/Hawthorn Rd #65", locality: "Brighton East" },
  { name: "Union St/Hawthorn Rd #66", locality: "Brighton East" },
  { name: "Rogers Ave/Hawthorn Rd #67", locality: "Brighton East" },
  { name: "East Brighton/Hawthorn Rd #68", locality: "East Brighton" },
];

const ROUTE_64_WESTBOUND_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "East Brighton/Hawthorn Rd #68", locality: "East Brighton" },
  { name: "Howell St/Hawthorn Rd #67", locality: "Brighton East" },
  { name: "Union St/Hawthorn Rd #66", locality: "Brighton East" },
  { name: "Davey Ave/Hawthorn Rd #65", locality: "Brighton East" },
  { name: "Taylor St/Hawthorn Rd #64", locality: "Brighton East" },
  { name: "North Rd/Hawthorn Rd #63", locality: "Caulfield South" },
  { name: "Gardenvale Rd/Hawthorn Rd #62", locality: "Caulfield South" },
  { name: "Raynes St/Hawthorn Rd #61", locality: "Caulfield South" },
  { name: "Dover St/Hawthorn Rd #60", locality: "Caulfield South" },
  { name: "Princes Park/Hawthorn Rd #59", locality: "Princes Park" },
  { name: "Sycamore St/Hawthorn Rd #58", locality: "Caulfield South" },
  { name: "Glenhuntly Rd/Hawthorn Rd #57", locality: "Caulfield" },
  { name: "Lockhart St/Hawthorn Rd #56", locality: "Caulfield" },
  { name: "Sylverly Gr/Hawthorn Rd #55", locality: "Caulfield" },
  { name: "Glen Eira Rd/Hawthorn Rd #54", locality: "Caulfield North" },
  { name: "Crotonhurst Ave/Hawthorn Rd #53", locality: "Caulfield North" },
  { name: "Halstead St/Hawthorn Rd #52", locality: "Caulfield North" },
  { name: "Balaclava Rd/Hawthorn Rd #51", locality: "Caulfield North" },
  { name: "Inkerman Rd/Hawthorn Rd #50", locality: "Caulfield North" },
  { name: "Wanda Rd/Hawthorn Rd #49", locality: "Caulfield North" },
  { name: "48A-Dandenong Rd/Hawthorn Rd", locality: "Caulfield North" },
  { name: "Hawthorn Rd/Dandenong Rd #48", locality: "Armadale" },
  { name: "Bailey Ave/Dandenong Rd #44", locality: "Armadale" },
  { name: "Matlock Ct/Dandenong Rd #43", locality: "Armadale" },
  { name: "Kooyong Rd/Dandenong Rd #42", locality: "Armadale" },
  { name: "Wattletree Rd/Dandenong Rd #40", locality: "Armadale" },
  { name: "Orrong Rd/Dandenong Rd #38", locality: "Prahran" },
  { name: "Lansdowne Rd/Dandenong Rd #37", locality: "Prahran" },
  { name: "Alexandra St/Dandenong Rd #36", locality: "Prahran" },
  { name: "Williams Rd/Dandenong Rd #35", locality: "St Kilda East" },
  { name: "Westbury St/Dandenong Rd #34", locality: "Windsor" },
  { name: "Hornby St/Dandenong Rd #33", locality: "Windsor" },
  { name: "Chapel St/Dandenong Rd #32", locality: "St Kilda" },
  { name: "Queens Way/Queens Way #31", locality: "Queens Way" },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "St Kilda Junction" },
  { name: "Union St/St Kilda Rd #29", locality: "Melbourne City" },
  { name: "Lorne St/St Kilda Rd #27", locality: "Melbourne City" },
  { name: "Beatrice St/St Kilda Rd #26", locality: "Melbourne City" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "Melbourne City" },
  { name: "Leopold St/St Kilda Rd #24", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "Melbourne City" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Anzac Station" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Shrine of Remembrance" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Southbank" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Federation Square/Swanston St #13", locality: "Melbourne City" },
  { name: "City Square/Swanston St #11", locality: "Melbourne City" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Melbourne City" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne City" },
  { name: "RMIT University/Swanston St #7", locality: "Melbourne City" },
  { name: "Queensberry St/Swanston St #4", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Carlton" },
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
];

const ROUTE_64_ROUTE_LINE: [number, number][] = [
  [-37.79775, 144.96102], // Melbourne University
  [-37.7962, 144.9631],
  [-37.7935, 144.9632],
  [-37.8093, 144.9631], // Melbourne Central / Swanston
  [-37.8139, 144.9631],
  [-37.8169, 144.9672], // Federation Square / Flinders
  [-37.8219, 144.9687],
  [-37.8298, 144.9686], // Arts Centre / Shrine
  [-37.8377, 144.9732], // Anzac
  [-37.8449, 144.9785], // St Kilda Junction
  [-37.8518, 144.9874],
  [-37.8603, 145.0006],
  [-37.8677, 145.0119],
  [-37.8738, 145.0213], // Hawthorn / Dandenong intersection
  [-37.8796, 145.0210],
  [-37.8852, 145.0206],
  [-37.8910, 145.0201],
  [-37.8971, 145.0196],
  [-37.9014, 145.01875], // North Rd
  [-37.90378, 145.01881], // Taylor St
  [-37.9076, 145.0187],
  [-37.9112, 145.01855], // East Brighton
];

function interpolateStopsAlongPolyline(
  polyline: [number, number][],
  stopCount: number,
): [number, number][] {
  if (polyline.length === 0 || stopCount <= 0) return [];
  if (polyline.length === 1) return Array.from({ length: stopCount }, () => polyline[0]);

  const cumulativeDistances = [0];
  for (let index = 1; index < polyline.length; index += 1) {
    cumulativeDistances.push(
      cumulativeDistances[index - 1] + getDistanceInMetres(polyline[index - 1], polyline[index]),
    );
  }

  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;
  if (totalDistance <= 0) return Array.from({ length: stopCount }, () => polyline[0]);

  return Array.from({ length: stopCount }, (_, index) => {
    if (index === 0) return polyline[0];
    if (index === stopCount - 1) return polyline[polyline.length - 1];

    const targetDistance = (index / (stopCount - 1)) * totalDistance;
    let segmentIndex = 1;
    while (segmentIndex < cumulativeDistances.length && cumulativeDistances[segmentIndex] < targetDistance) {
      segmentIndex += 1;
    }

    const previousDistance = cumulativeDistances[segmentIndex - 1] ?? 0;
    const nextDistance = cumulativeDistances[segmentIndex] ?? totalDistance;
    const segmentProgress =
      nextDistance === previousDistance ? 0 : (targetDistance - previousDistance) / (nextDistance - previousDistance);
    const [startLat, startLng] = polyline[segmentIndex - 1] ?? polyline[0];
    const [endLat, endLng] = polyline[segmentIndex] ?? polyline[polyline.length - 1];

    return [
      startLat + (endLat - startLat) * segmentProgress,
      startLng + (endLng - startLng) * segmentProgress,
    ];
  });
}

function normaliseSurfaceRouteLabel(routeLabel: string) {
  const trimmed = routeLabel.trim();
  const numericMatch = trimmed.match(/^0*(\d+[A-Z]?)$/i);
  if (numericMatch?.[1]) {
    return numericMatch[1].toUpperCase();
  }
  return trimmed.toUpperCase();
}

// PTV's tram vehicle-positions feed reports the physical tram's class code in
// vehicle.label (e.g. "B2", "E", "C2") — Yarra Trams fleet classes, not a
// route/destination label. Map the known codes to their real fleet names.
const TRAM_CLASS_LABELS: Record<string, string> = {
  A1: "A1 class",
  A2: "A2 class",
  B2: "B2 class",
  C1: "C1 class (Citadis)",
  C2: "C2 class (Citadis)",
  D1: "D1 class (Combino)",
  D2: "D2 class (Combino)",
  E: "E class",
  E2: "E2 class (Metro Tunnel-clearance)",
  Z3: "Z3 class",
  W2: "W class (heritage)",
  W6: "W class (heritage)",
  W7: "W class (heritage)",
  W8: "W class (heritage)",
};

function getTramClassLabel(tram: LiveTram) {
  const code = tram.label?.trim().toUpperCase();
  if (!code) return "Type not published";
  return TRAM_CLASS_LABELS[code] ?? code;
}

function createLiveTramIcon(tram: LiveTram) {
  const routeNumberLabel = normaliseSurfaceRouteLabel(tram.route).slice(0, 6);
  const destinationLabel = tram.destination
    ?.replace(/\s+via\s+.+$/i, "")
    .trim();
  const hasRealDestination = Boolean(destinationLabel) && !/^(tram|unknown)$/i.test(destinationLabel ?? "");
  const routeLabel = hasRealDestination
    ? `${destinationLabel!.slice(0, 24)} · ${routeNumberLabel}`
    : routeNumberLabel;
  const escapedRouteLabel = escapeInlineMarkerHtml(routeLabel);
  const classLabel = tram.fleetNumber
    ? `${getTramClassLabel(tram)} · ${tram.fleetNumber}`
    : getTramClassLabel(tram);
  const escapedClassLabel = escapeInlineMarkerHtml(classLabel);
  const rotation = typeof tram.heading === "number" && Number.isFinite(tram.heading) ? tram.heading : 0;
  const { fillColor, strokeColor } = getSurfaceRouteColors(routeNumberLabel, "#00ab8e", "#065f56");

  return L.divIcon({
      html: `
        <div style="position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;">
          <div style="position:absolute;inset:0;border-radius:50%;background:${fillColor};opacity:0.18;animation:ping 2.2s infinite;"></div>
          <div style="
            width:22px;
            height:22px;
            border-radius:9999px;
            background:${fillColor};
            border:2px solid ${strokeColor};
            box-shadow:0 4px 14px rgba(0,0,0,0.55);
            display:flex;
            align-items:center;
            justify-content:center;
            transform:rotate(${rotation}deg);
          ">
          <img src="${tramIcon}" alt="" style="width:11px;height:11px;object-fit:contain;filter:brightness(0) invert(1);" />
        </div>
        <div style="position:absolute;top:-4px;left:50%;transform:translateX(-50%);background:#0f172a;color:white;font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.18);box-shadow:0 3px 9px rgba(0,0,0,.45);white-space:nowrap;line-height:1.15;">
          ${escapedRouteLabel}
        </div>
        <div style="position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);background:#0f172a;color:rgba(255,255,255,.75);font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.14);box-shadow:0 3px 9px rgba(0,0,0,.45);white-space:nowrap;line-height:1.15;">
          ${escapedClassLabel}
        </div>
      </div>
    `,
    className: "bg-transparent border-none",
    iconSize: [52, 52],
    iconAnchor: [26, 26],
    popupAnchor: [0, -26],
  });
}

function createCleanStationNodeIcon(
  color: string,
  options?: { interchange?: boolean; endpoint?: boolean; staffed?: boolean },
) {
  const interchange = options?.interchange ?? false;
  const endpoint = options?.endpoint ?? false;
  const staffed = options?.staffed ?? false;
  const nodeSize = interchange ? 17 : endpoint ? 14 : 11;
  const hitSize = 30;

  return L.divIcon({
    html: `
      <div style="width:${hitSize}px;height:${hitSize}px;display:flex;align-items:center;justify-content:center;">
        <div style="
          position:relative;
          width:${nodeSize}px;
          height:${nodeSize}px;
          border-radius:9999px;
          background:#f8fafc;
          border:${interchange ? 3 : 2}px solid ${color};
          box-shadow:0 1px 5px rgba(0,0,0,0.6),0 0 0 1px rgba(15,23,42,0.8);
        ">
          ${interchange ? `<span style="position:absolute;inset:3px;border-radius:9999px;background:${color};"></span>` : ""}
          ${staffed ? `<span style="position:absolute;right:-4px;top:-4px;width:5px;height:5px;border-radius:9999px;background:#38bdf8;border:1px solid #f8fafc;"></span>` : ""}
        </div>
      </div>
    `,
    className: "bg-transparent border-none",
    iconSize: [hitSize, hitSize],
    iconAnchor: [hitSize / 2, hitSize / 2],
    popupAnchor: [0, -10],
  });
}

// Concentric coloured rings (outermost first) for a station genuinely served
// by several distinct line groups, each with its own established colour
// elsewhere in the app — a single-colour node would misrepresent it as
// belonging to just one of them. Supports any number of rings (South Yarra
// uses 2, Caulfield uses 3).
function createMultiRingStationIcon(colors: string[]) {
  const innermostSize = 8;
  const ringStep = 8;
  const outermostSize = innermostSize + (colors.length - 1) * ringStep;
  const hitSize = Math.max(30, outermostSize + 8);

  // Builds from the centre outward: the last colour becomes a solid filled
  // core dot, each earlier colour wraps it in a ring one step further out,
  // so colors[0] ends up as the outermost ring.
  const rings = colors.reduceRight<string>((inner, color, index) => {
    const depthFromCentre = colors.length - 1 - index;
    const size = innermostSize + depthFromCentre * ringStep;
    const isCore = depthFromCentre === 0;
    return `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:9999px;
        background:${isCore ? color : "#f8fafc"};
        border:${isCore ? 0 : 2.5}px solid ${color};
        display:flex;
        align-items:center;
        justify-content:center;
        ${index === 0 ? "box-shadow:0 1px 5px rgba(0,0,0,0.6),0 0 0 1px rgba(15,23,42,0.8);" : ""}
      ">${inner}</div>
    `;
  }, "");

  return L.divIcon({
    html: `<div style="width:${hitSize}px;height:${hitSize}px;display:flex;align-items:center;justify-content:center;">${rings}</div>`,
    className: "bg-transparent border-none",
    iconSize: [hitSize, hitSize],
    iconAnchor: [hitSize / 2, hitSize / 2],
    popupAnchor: [0, -10],
  });
}

function getSurfaceRouteColors(routeLabel: string, fallbackFillColor: string, fallbackStrokeColor: string) {
  switch (normaliseSurfaceRouteLabel(routeLabel)) {
    case "1":
      return { fillColor: "#b5bd00", strokeColor: "#7e8500" };
    case "3":
      return { fillColor: "#8dc8e8", strokeColor: "#4f88a8" };
    case "5":
      return { fillColor: "#d50032", strokeColor: "#8f0022" };
    case "6":
      return { fillColor: "#01426a", strokeColor: "#012c47" };
    case "11":
      return { fillColor: "#6eceb2", strokeColor: "#3f8f7d" };
    case "12":
      return { fillColor: "#007e92", strokeColor: "#005866" };
    case "16":
      return { fillColor: "#fbd872", strokeColor: "#b8952f" };
    case "19":
      return { fillColor: "#8a1b61", strokeColor: "#5d1242" };
    case "30":
      return { fillColor: "#534f96", strokeColor: "#3b386c" };
    case "35":
      return { fillColor: "#6b3529", strokeColor: "#4a251d" };
    case "48":
      return { fillColor: "#333434", strokeColor: "#1e1f20" };
    case "57":
      return { fillColor: "#00c1d5", strokeColor: "#008a99" };
    case "58":
      return { fillColor: "#969696", strokeColor: "#666666" };
    case "59":
      return { fillColor: "#00653a", strokeColor: "#004427" };
    case "64":
      return { fillColor: "#00ab8e", strokeColor: "#007866" };
    case "67":
      return { fillColor: "#956c58", strokeColor: "#6b4c3d" };
    case "70":
      return { fillColor: "#f59bbb", strokeColor: "#c56d8c" };
    case "72":
      return { fillColor: "#9abeaa", strokeColor: "#6d8d7c" };
    case "75":
      return { fillColor: "#00a9e0", strokeColor: "#00779e" };
    case "78":
      return { fillColor: "#a0a0d6", strokeColor: "#6f6fa0" };
    case "82":
      return { fillColor: "#d2d755", strokeColor: "#9a9f2e" };
    case "86":
      return { fillColor: "#ffb500", strokeColor: "#c58800" };
    case "96":
      return { fillColor: "#c6007e", strokeColor: "#8b0058" };
    case "109":
      return { fillColor: "#e87722", strokeColor: "#aa5312" };
    default:
      return { fillColor: fallbackFillColor, strokeColor: fallbackStrokeColor };
  }
}

const ROUTE_64_EASTBOUND_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  ROUTE_64_ROUTE_LINE,
  ROUTE_64_EASTBOUND_STOP_DATA.length,
).map((position, index) => ({
  id: `route-64-east-brighton-${index + 1}`,
  name: ROUTE_64_EASTBOUND_STOP_DATA[index]?.name ?? `Route 64 stop ${index + 1}`,
  locality: ROUTE_64_EASTBOUND_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 64 tram stop",
  modes: ["tram"],
  routeLabel: "64",
  departures: ROUTE_64_EASTBOUND_DEPARTURES,
}));

const ROUTE_64_WESTBOUND_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  [...ROUTE_64_ROUTE_LINE].reverse() as [number, number][],
  ROUTE_64_WESTBOUND_STOP_DATA.length,
).map((position, index) => ({
  id: `route-64-melbourne-university-${index + 1}`,
  name: ROUTE_64_WESTBOUND_STOP_DATA[index]?.name ?? `Route 64 return stop ${index + 1}`,
  locality: ROUTE_64_WESTBOUND_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 64 tram stop",
  modes: ["tram"],
  routeLabel: "64",
  departures: ROUTE_64_WESTBOUND_DEPARTURES,
}));

const ROUTE_16_KEW_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "16", destination: "Kew", departureLabel: "3 min", statusLabel: "Tram due", note: "Eastbound" },
  { route: "16", destination: "Melbourne University", departureLabel: "8 min", statusLabel: "Scheduled", note: "Westbound" },
  { route: "16", destination: "Kew", departureLabel: "16 min", statusLabel: "Scheduled", note: "Via Glenferrie Rd" },
];

const ROUTE_16_UNIVERSITY_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "16", destination: "Melbourne University", departureLabel: "2 min", statusLabel: "Tram due", note: "Westbound" },
  { route: "16", destination: "Kew", departureLabel: "9 min", statusLabel: "Scheduled", note: "Eastbound" },
  { route: "16", destination: "Melbourne University", departureLabel: "18 min", statusLabel: "Scheduled", note: "Via Swanston St" },
];

const ROUTE_16_KEW_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Melbourne University/Swanston St #1", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Carlton" },
  { name: "Queensberry St/Swanston St #4", locality: "Melbourne City" },
  { name: "RMIT University/Swanston St #7", locality: "Melbourne City" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne City" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Melbourne City" },
  { name: "City Square/Swanston St #11", locality: "Melbourne City" },
  { name: "Federation Square/Swanston St #13", locality: "Melbourne City" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Southbank" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Southbank" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Melbourne City" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Melbourne City" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "South Melbourne" },
  { name: "Leopold St/St Kilda Rd #24", locality: "South Melbourne" },
  { name: "Moubray St/St Kilda Rd #26", locality: "South Melbourne" },
  { name: "High St/St Kilda Rd #27", locality: "St Kilda" },
  { name: "Union St/St Kilda Rd #29", locality: "St Kilda" },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "St Kilda Junction" },
  { name: "St Kilda Rd/Fitzroy St #131", locality: "St Kilda" },
  { name: "Princes St/Fitzroy St #132", locality: "St Kilda" },
  { name: "Canterbury Rd/Fitzroy St #133", locality: "St Kilda" },
  { name: "Park St/Fitzroy St #134", locality: "St Kilda" },
  { name: "Jacka Bvd/Fitzroy St #135", locality: "St Kilda" },
  { name: "Alfred Square/The Esplanade #136", locality: "St Kilda" },
  { name: "Luna Park/The Esplanade #138", locality: "St Kilda" },
  { name: "Barkly St/Carlisle St #33", locality: "St Kilda" },
  { name: "Greeves St/Carlisle St #34", locality: "St Kilda" },
  { name: "St Kilda Rd/Carlisle St #35", locality: "St Kilda" },
  { name: "St Kilda Town Hall/Carlisle St #36", locality: "St Kilda Town Hall" },
  { name: "Chapel St/Carlisle St #37", locality: "Balaclava" },
  { name: "Balaclava Station/Carlisle St #38", locality: "Balaclava Station" },
  { name: "Orange Gr/Carlisle St #39", locality: "Balaclava" },
  { name: "Hotham St/Carlisle St #40", locality: "St Kilda East" },
  { name: "Empress Rd/Balaclava Rd #41", locality: "Caulfield North" },
  { name: "Sidwell Ave/Balaclava Rd #42", locality: "Caulfield North" },
  { name: "Orrong Rd/Balaclava Rd #43", locality: "Caulfield North" },
  { name: "Ontario St/Balaclava Rd #44", locality: "Caulfield North" },
  { name: "Kent Gr/Balaclava Rd #45", locality: "Caulfield North" },
  { name: "Kooyong Rd/Balaclava Rd #46", locality: "Caulfield North" },
  { name: "Elmhurst Rd/Balaclava Rd #47", locality: "Caulfield North" },
  { name: "Hawthorn Rd/Balaclava Rd #51", locality: "Caulfield North" },
  { name: "Inkerman Rd/Hawthorn Rd #50", locality: "Caulfield North" },
  { name: "Wanda Rd/Hawthorn Rd #49", locality: "Caulfield North" },
  { name: "48A-Dandenong Rd/Hawthorn Rd", locality: "Malvern" },
  { name: "Hawthorn Rd/Dandenong Rd #48", locality: "Malvern" },
  { name: "Malvern Railway Station/Glenferrie Rd #53", locality: "Malvern Railway Station" },
  { name: "Wattletree Rd/Glenferrie Rd #54", locality: "Malvern" },
  { name: "Llaneast St/Glenferrie Rd #55", locality: "Malvern" },
  { name: "Malvern Tram Depot/Glenferrie Rd #56", locality: "Malvern Tram Depot" },
  { name: "High St/Glenferrie Rd #57", locality: "Malvern" },
  { name: "Bell St/Glenferrie Rd #58", locality: "Malvern" },
  { name: "Malvern Rd/Glenferrie Rd #59", locality: "Malvern" },
  { name: "Stonnington Pl/Glenferrie Rd #60", locality: "Malvern" },
  { name: "Moorakyne Ave/Glenferrie Rd #61", locality: "Malvern" },
  { name: "Mayfield Ave/Glenferrie Rd #62", locality: "Malvern" },
  { name: "Toorak Rd/Glenferrie Rd #63", locality: "Kooyong" },
  { name: "Mernda Rd/Glenferrie Rd #64", locality: "Toorak" },
  { name: "Warra St/Glenferrie Rd #65", locality: "Toorak" },
  { name: "Kooyong Tennis Centre/Glenferrie Rd #66", locality: "Kooyong Tennis Centre" },
  { name: "Gardiner Rd/Glenferrie Rd #67", locality: "Hawthorn" },
  { name: "Callantina Rd/Glenferrie Rd #68", locality: "Hawthorn" },
  { name: "South St/Glenferrie Rd #69", locality: "Hawthorn" },
  { name: "Riversdale Rd/Glenferrie Rd #70", locality: "Hawthorn" },
  { name: "Urquhart St/Glenferrie Rd #71", locality: "Hawthorn" },
  { name: "Manningtree Rd/Glenferrie Rd #72", locality: "Hawthorn" },
  { name: "Burwood Rd/Glenferrie Rd #73", locality: "Hawthorn" },
  { name: "Glenferrie Station/Glenferrie Rd #74", locality: "Glenferrie Station" },
  { name: "Chrystobel Cres/Glenferrie Rd #75", locality: "Hawthorn" },
  { name: "Johnson St/Glenferrie Rd #76", locality: "Hawthorn" },
  { name: "Barkers Rd/Glenferrie Rd #77", locality: "Hawthorn" },
  { name: "Fitzwilliam St/Glenferrie Rd #78", locality: "Hawthorn" },
  { name: "Wellington St/Glenferrie Rd #79", locality: "Hawthorn" },
  { name: "Cotham Rd/Glenferrie Rd #80", locality: "Kew" },
];

const ROUTE_16_UNIVERSITY_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Cotham Rd/Glenferrie Rd #80", locality: "Hawthorn" },
  { name: "Wellington St/Glenferrie Rd #79", locality: "Hawthorn" },
  { name: "Fitzwilliam St/Glenferrie Rd #78", locality: "Hawthorn" },
  { name: "Barkers Rd/Glenferrie Rd #77", locality: "Hawthorn" },
  { name: "Johnson St/Glenferrie Rd #76", locality: "Hawthorn" },
  { name: "Liddiard St/Glenferrie Rd #75", locality: "Hawthorn" },
  { name: "Glenferrie Railway Station/Glenferrie Rd #74", locality: "Glenferrie Railway Station" },
  { name: "Burwood Rd/Glenferrie Rd #73", locality: "Hawthorn" },
  { name: "Manningtree Rd/Glenferrie Rd #72", locality: "Hawthorn" },
  { name: "Urquhart St/Glenferrie Rd #71", locality: "Hawthorn" },
  { name: "Riversdale Rd/Glenferrie Rd #70", locality: "Hawthorn" },
  { name: "South St/Glenferrie Rd #69", locality: "Hawthorn" },
  { name: "Callantina Rd/Glenferrie Rd #68", locality: "Hawthorn" },
  { name: "Gardiner Rd/Glenferrie Rd #67", locality: "Kooyong" },
  { name: "Vision Australia/Glenferrie Rd #66", locality: "Vision Australia" },
  { name: "Kooyong Railway Station/Glenferrie Rd #65", locality: "Kooyong Railway Station" },
  { name: "Power St/Glenferrie Rd #64", locality: "Kooyong" },
  { name: "Toorak Rd/Glenferrie Rd #63", locality: "Malvern" },
  { name: "Mayfield Ave/Glenferrie Rd #62", locality: "Malvern" },
  { name: "Moorakyne Ave/Glenferrie Rd #61", locality: "Malvern" },
  { name: "Stonnington Pl/Glenferrie Rd #60", locality: "Malvern" },
  { name: "Malvern Rd/Glenferrie Rd #59", locality: "Malvern" },
  { name: "Sorrett Ave/Glenferrie Rd #58", locality: "Malvern" },
  { name: "High St/Glenferrie Rd #57", locality: "Malvern" },
  { name: "Malvern Tram Depot/Glenferrie Rd #56", locality: "Malvern Tram Depot" },
  { name: "Edsall St/Glenferrie Rd #55", locality: "Malvern" },
  { name: "Wattletree Rd/Glenferrie Rd #54", locality: "Malvern" },
  { name: "Malvern Railway Station/Glenferrie Rd #53", locality: "Malvern Railway Station" },
  { name: "Dandenong Rd/Glenferrie Rd #52", locality: "Malvern" },
  { name: "Hawthorn Rd/Dandenong Rd #48", locality: "Caulfield North" },
  { name: "Arthur St/Hawthorn Rd #49", locality: "Caulfield North" },
  { name: "Inkerman Rd/Hawthorn Rd #50", locality: "Caulfield North" },
  { name: "Balaclava Rd/Hawthorn Rd #51", locality: "Caulfield North" },
  { name: "Caulfield Junior College/Balaclava Rd #47", locality: "Caulfield Junior College" },
  { name: "Kooyong Rd/Balaclava Rd #46", locality: "Caulfield North" },
  { name: "Kent Gr/Balaclava Rd #45", locality: "Caulfield North" },
  { name: "Otira Rd/Balaclava Rd #44", locality: "Caulfield North" },
  { name: "Orrong Rd/Balaclava Rd #43", locality: "St Kilda East" },
  { name: "Allan Rd/Balaclava Rd #42", locality: "St Kilda East" },
  { name: "Vadlure Ave/Balaclava Rd #41", locality: "St Kilda East" },
  { name: "Hotham St/Balaclava Rd #40", locality: "St Kilda" },
  { name: "Carlisle Ave/Carlisle St #39", locality: "Balaclava" },
  { name: "Balaclava Station/Carlisle St #38", locality: "Balaclava Station" },
  { name: "Chapel St/Carlisle St #37", locality: "St Kilda" },
  { name: "St Kilda Town Hall/Carlisle St #36", locality: "St Kilda Town Hall" },
  { name: "Brighton Rd/Carlisle St #35", locality: "St Kilda" },
  { name: "Mitchell St/Carlisle St #34", locality: "St Kilda" },
  { name: "Barkly St/Carlisle St #33", locality: "St Kilda" },
  { name: "Havelock St/Carlisle St #32", locality: "St Kilda" },
  { name: "Luna Park/The Esplanade #138", locality: "Luna Park" },
  { name: "Alfred Square/The Esplanade #136", locality: "St Kilda" },
  { name: "Acland St/Fitzroy St #135", locality: "St Kilda" },
  { name: "Park St/Fitzroy St #134", locality: "St Kilda" },
  { name: "Canterbury Rd/Fitzroy St #133", locality: "St Kilda" },
  { name: "Princes St/Fitzroy St #132", locality: "St Kilda" },
  { name: "St Kilda Rd/Fitzroy St #131", locality: "St Kilda Junction" },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "St Kilda Junction" },
  { name: "Union St/St Kilda Rd #29", locality: "Melbourne City" },
  { name: "Lorne St/St Kilda Rd #27", locality: "Melbourne City" },
  { name: "Beatrice St/St Kilda Rd #26", locality: "Melbourne City" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "Melbourne City" },
  { name: "Leopold St/St Kilda Rd #24", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "Melbourne City" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Anzac Station" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Shrine of Remembrance" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Southbank" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Federation Square/Swanston St #13", locality: "Federation Square" },
  { name: "City Square/Swanston St #11", locality: "Melbourne City" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Melbourne City" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne Central Station" },
  { name: "RMIT University/Swanston St #7", locality: "RMIT University" },
  { name: "Queensberry St/Swanston St #4", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Lincoln Square" },
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
];

const ROUTE_16_ROUTE_LINE: [number, number][] = [
  [-37.79775, 144.96102], // Melbourne University
  [-37.8093, 144.9631],
  [-37.8169, 144.9672], // Federation Square
  [-37.8298, 144.9686],
  [-37.8377, 144.9732], // Anzac
  [-37.8449, 144.9785], // St Kilda Junction
  [-37.8609, 144.9790], // Fitzroy / Acland / Esplanade
  [-37.8682, 144.9820], // Carlisle
  [-37.8726, 144.9904], // Balaclava Rd
  [-37.8764, 145.0022],
  [-37.8802, 145.0146], // Hawthorn Rd / Dandenong
  [-37.8756, 145.0200], // Glenferrie Rd south
  [-37.8641, 145.0202],
  [-37.8500, 145.0210],
  [-37.8379, 145.0218], // Toorak / Kooyong
  [-37.8229, 145.0224],
  [-37.8073, 145.0233], // Glenferrie
  [-37.7999, 145.0240], // Kew / Cotham
];

const ROUTE_16_KEW_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  ROUTE_16_ROUTE_LINE,
  ROUTE_16_KEW_STOP_DATA.length,
).map((position, index) => ({
  id: `route-16-kew-${index + 1}`,
  name: ROUTE_16_KEW_STOP_DATA[index]?.name ?? `Route 16 stop ${index + 1}`,
  locality: ROUTE_16_KEW_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 16 tram stop",
  modes: ["tram"],
  routeLabel: "16",
  departures: ROUTE_16_KEW_DEPARTURES,
}));

const ROUTE_16_UNIVERSITY_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  [...ROUTE_16_ROUTE_LINE].reverse() as [number, number][],
  ROUTE_16_UNIVERSITY_STOP_DATA.length,
).map((position, index) => ({
  id: `route-16-university-${index + 1}`,
  name: ROUTE_16_UNIVERSITY_STOP_DATA[index]?.name ?? `Route 16 return stop ${index + 1}`,
  locality: ROUTE_16_UNIVERSITY_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 16 tram stop",
  modes: ["tram"],
  routeLabel: "16",
  departures: ROUTE_16_UNIVERSITY_DEPARTURES,
}));

const ROUTE_3_EAST_MALVERN_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "3", destination: "East Malvern", departureLabel: "4 min", statusLabel: "Tram due", note: "Eastbound" },
  { route: "3", destination: "Melbourne University", departureLabel: "10 min", statusLabel: "Scheduled", note: "Westbound" },
  { route: "3", destination: "East Malvern", departureLabel: "19 min", statusLabel: "Scheduled", note: "Via Balaclava Rd" },
];

const ROUTE_3_UNIVERSITY_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "3", destination: "Melbourne University", departureLabel: "3 min", statusLabel: "Tram due", note: "Westbound" },
  { route: "3", destination: "East Malvern", departureLabel: "9 min", statusLabel: "Scheduled", note: "Eastbound" },
  { route: "3", destination: "Melbourne University", departureLabel: "18 min", statusLabel: "Scheduled", note: "Via Swanston St" },
];

const ROUTE_3_EAST_MALVERN_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Melbourne University/Swanston St #1", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Carlton" },
  { name: "Queensberry St/Swanston St #4", locality: "Melbourne City" },
  { name: "RMIT University/Swanston St #7", locality: "Melbourne City" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne City" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Melbourne City" },
  { name: "City Square/Swanston St #11", locality: "Melbourne City" },
  { name: "Federation Square/Swanston St #13", locality: "Melbourne City" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Southbank" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Southbank" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Melbourne City" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Melbourne City" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "South Melbourne" },
  { name: "Leopold St/St Kilda Rd #24", locality: "South Melbourne" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "South Melbourne" },
  { name: "Moubray St/St Kilda Rd #26", locality: "South Melbourne" },
  { name: "High St/St Kilda Rd #27", locality: "St Kilda" },
  { name: "Union St/St Kilda Rd #29", locality: "St Kilda" },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "St Kilda Junction" },
  { name: "Barkly St/St Kilda Rd #31", locality: "St Kilda" },
  { name: "Alma Rd/St Kilda Rd #32", locality: "St Kilda" },
  { name: "Argyle St/St Kilda Rd #33", locality: "St Kilda" },
  { name: "Inkerman St/St Kilda Rd #34", locality: "St Kilda" },
  { name: "Carlisle St/St Kilda Rd #35", locality: "St Kilda" },
  { name: "St Kilda Town Hall/Carlisle St #36", locality: "St Kilda Town Hall" },
  { name: "Chapel St/Carlisle St #37", locality: "Balaclava" },
  { name: "Balaclava Station/Carlisle St #38", locality: "Balaclava Station" },
  { name: "Orange Gr/Carlisle St #39", locality: "Balaclava" },
  { name: "Hotham St/Carlisle St #40", locality: "St Kilda East" },
  { name: "Empress Rd/Balaclava Rd #41", locality: "Caulfield North" },
  { name: "Sidwell Ave/Balaclava Rd #42", locality: "Caulfield North" },
  { name: "Orrong Rd/Balaclava Rd #43", locality: "Caulfield North" },
  { name: "Ontario St/Balaclava Rd #44", locality: "Caulfield North" },
  { name: "Kent Gr/Balaclava Rd #45", locality: "Caulfield North" },
  { name: "Kooyong Rd/Balaclava Rd #46", locality: "Caulfield North" },
  { name: "Elmhurst Rd/Balaclava Rd #47", locality: "Caulfield North" },
  { name: "Hawthorn Rd/Balaclava Rd #51", locality: "Caulfield North" },
  { name: "Caulfield Park Bowling Club/Balaclava Rd #52", locality: "Caulfield Park Bowling Club" },
  { name: "Caulfield Park/Balaclava Rd #53", locality: "Caulfield Park" },
  { name: "Kambrook Rd/Balaclava Rd #54", locality: "Caulfield North" },
  { name: "Normanby Rd/Balaclava Rd #55", locality: "Caulfield North" },
  { name: "Caulfield Racecourse/Normanby Rd #56", locality: "Caulfield Racecourse" },
  { name: "Caulfield Railway Station/Derby Rd #57", locality: "Caulfield Railway Station" },
  { name: "Dandenong Rd/Derby Rd #58", locality: "Caulfield North" },
  { name: "Dandenong Rd/Waverley Rd #59", locality: "Malvern East" },
  { name: "Burke Rd/Waverley Rd #60", locality: "Malvern East" },
  { name: "Tennyson St/Waverley Rd #61", locality: "Malvern East" },
  { name: "The Avenue/Waverley Rd #62", locality: "Malvern East" },
  { name: "Oak Gr/Waverley Rd #63", locality: "Malvern East" },
  { name: "Darling Rd/Waverley Rd #64", locality: "Malvern East" },
];

const ROUTE_3_UNIVERSITY_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Darling Rd/Waverley Rd #64", locality: "Malvern East" },
  { name: "Hughes St/Waverley Rd #63", locality: "Malvern East" },
  { name: "Macgregor St/Waverley Rd #62", locality: "Malvern East" },
  { name: "Tennyson St/Waverley Rd #61", locality: "Malvern East" },
  { name: "Burke Rd/Waverley Rd #60", locality: "Caulfield East" },
  { name: "Dandenong Rd/Waverley Rd #59", locality: "Caulfield East" },
  { name: "Caulfield Railway Station/Derby Rd #57", locality: "Caulfield Railway Station" },
  { name: "Caulfield Racecourse/Normanby Rd #56", locality: "Caulfield Racecourse" },
  { name: "Balaclava Rd/Normanby Rd #55", locality: "Caulfield East" },
  { name: "Kambrook Rd/Balaclava Rd #54", locality: "Caulfield North" },
  { name: "Caulfield Park/Balaclava Rd #53", locality: "Caulfield Park" },
  { name: "Caulfield Park Bowling Club/Balaclava Rd #52", locality: "Caulfield Park Bowling Club" },
  { name: "Hawthorn Rd/Balaclava Rd #51", locality: "Caulfield North" },
  { name: "Caulfield Junior College/Balaclava Rd #47", locality: "Caulfield Junior College" },
  { name: "Kooyong Rd/Balaclava Rd #46", locality: "Caulfield North" },
  { name: "Kent Gr/Balaclava Rd #45", locality: "Caulfield North" },
  { name: "Otira Rd/Balaclava Rd #44", locality: "Caulfield North" },
  { name: "Orrong Rd/Balaclava Rd #43", locality: "St Kilda East" },
  { name: "Allan Rd/Balaclava Rd #42", locality: "St Kilda East" },
  { name: "Vadlure Ave/Balaclava Rd #41", locality: "St Kilda East" },
  { name: "Hotham St/Balaclava Rd #40", locality: "St Kilda" },
  { name: "Carlisle Ave/Carlisle St #39", locality: "Balaclava" },
  { name: "Balaclava Station/Carlisle St #38", locality: "Balaclava Station" },
  { name: "Chapel St/Carlisle St #37", locality: "St Kilda" },
  { name: "St Kilda Town Hall/Carlisle St #36", locality: "St Kilda Town Hall" },
  { name: "Brighton Rd/Carlisle St #35", locality: "St Kilda" },
  { name: "Carlisle St/St Kilda Rd #35", locality: "St Kilda" },
  { name: "Inkerman St/St Kilda Rd #34", locality: "St Kilda" },
  { name: "Argyle St/St Kilda Rd #33", locality: "St Kilda" },
  { name: "Alma Rd/St Kilda Rd #32", locality: "St Kilda" },
  { name: "Barkly St/St Kilda Rd #31", locality: "St Kilda" },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "St Kilda Junction" },
  { name: "Union St/St Kilda Rd #29", locality: "Melbourne City" },
  { name: "Lorne St/St Kilda Rd #27", locality: "Melbourne City" },
  { name: "Beatrice St/St Kilda Rd #26", locality: "Melbourne City" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "Melbourne City" },
  { name: "Leopold St/St Kilda Rd #24", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "Melbourne City" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Anzac Station" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Shrine of Remembrance" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Southbank" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Federation Square/Swanston St #13", locality: "Federation Square" },
  { name: "City Square/Swanston St #11", locality: "Melbourne City" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Melbourne City" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne Central Station" },
  { name: "RMIT University/Swanston St #7", locality: "RMIT University" },
  { name: "Queensberry St/Swanston St #4", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Lincoln Square" },
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
];

const ROUTE_3_ROUTE_LINE: [number, number][] = [
  [-37.79775, 144.96102], // Melbourne University
  [-37.8093, 144.9631],
  [-37.8169, 144.9672], // Federation Square
  [-37.8298, 144.9686],
  [-37.8377, 144.9732], // Anzac
  [-37.8449, 144.9785], // St Kilda Junction
  [-37.8568, 144.9824], // Carlisle / Balaclava
  [-37.8708, 144.9928], // Balaclava Rd
  [-37.8738, 145.0068], // Caulfield Park / Normanby
  [-37.8774, 145.0181], // Derby / Waverley Rd start
  [-37.8778, 145.0325], // East Malvern
];

const ROUTE_3_EAST_MALVERN_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  ROUTE_3_ROUTE_LINE,
  ROUTE_3_EAST_MALVERN_STOP_DATA.length,
).map((position, index) => ({
  id: `route-3-east-malvern-${index + 1}`,
  name: ROUTE_3_EAST_MALVERN_STOP_DATA[index]?.name ?? `Route 3 stop ${index + 1}`,
  locality: ROUTE_3_EAST_MALVERN_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 3 tram stop",
  modes: ["tram"],
  routeLabel: "3",
  departures: ROUTE_3_EAST_MALVERN_DEPARTURES,
}));

const ROUTE_3_UNIVERSITY_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  [...ROUTE_3_ROUTE_LINE].reverse() as [number, number][],
  ROUTE_3_UNIVERSITY_STOP_DATA.length,
).map((position, index) => ({
  id: `route-3-university-${index + 1}`,
  name: ROUTE_3_UNIVERSITY_STOP_DATA[index]?.name ?? `Route 3 return stop ${index + 1}`,
  locality: ROUTE_3_UNIVERSITY_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 3 tram stop",
  modes: ["tram"],
  routeLabel: "3",
  departures: ROUTE_3_UNIVERSITY_DEPARTURES,
}));

const ROUTE_1_SOUTH_MELBOURNE_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "1", destination: "South Melbourne Beach", departureLabel: "2 min", statusLabel: "Tram due", note: "Southbound" },
  { route: "1", destination: "East Coburg", departureLabel: "8 min", statusLabel: "Scheduled", note: "Northbound" },
  { route: "1", destination: "South Melbourne Beach", departureLabel: "15 min", statusLabel: "Scheduled", note: "Via Sturt St" },
];

const ROUTE_1_EAST_COBURG_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "1", destination: "East Coburg", departureLabel: "3 min", statusLabel: "Tram due", note: "Northbound" },
  { route: "1", destination: "South Melbourne Beach", departureLabel: "9 min", statusLabel: "Scheduled", note: "Southbound" },
  { route: "1", destination: "East Coburg", departureLabel: "17 min", statusLabel: "Scheduled", note: "Via Lygon St" },
];

const ROUTE_1_SOUTH_MELBOURNE_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Bell St/Nicholson St #135", locality: "Coburg" },
  { name: "Merribell Ave/Nicholson St #134", locality: "Coburg" },
  { name: "Harding St/Nicholson St #133", locality: "Coburg" },
  { name: "Crozier St/Nicholson St #132", locality: "Coburg" },
  { name: "Rennie St/Nicholson St #131", locality: "Coburg" },
  { name: "The Avenue/Nicholson St #130", locality: "Coburg" },
  { name: "Moreland Rd/Nicholson St #129", locality: "Brunswick" },
  { name: "Moreland Rd/Holmes St #129", locality: "Brunswick East" },
  { name: "Mitchell St/Holmes St #128", locality: "Brunswick East" },
  { name: "Albion St/Holmes St #127", locality: "Brunswick East" },
  { name: "Stewart St/Lygon St #126", locality: "Brunswick East" },
  { name: "Blyth St/Lygon St #125", locality: "Brunswick East" },
  { name: "Victoria St/Lygon St #124", locality: "Brunswick East" },
  { name: "Albert St/Lygon St #123", locality: "Brunswick East" },
  { name: "Glenlyon Rd/Lygon St #122", locality: "Brunswick East" },
  { name: "Weston St/Lygon St #121", locality: "Brunswick" },
  { name: "Brunswick Rd/Lygon St #120", locality: "Carlton North" },
  { name: "Pigdon St/Lygon St #118", locality: "Carlton North" },
  { name: "Richardson St/Lygon St #117", locality: "Carlton North" },
  { name: "Fenwick St/Lygon St #116", locality: "Carlton North" },
  { name: "Melbourne Cemetery/Lygon St #115", locality: "Melbourne Cemetery" },
  { name: "Princes St/Lygon St #114", locality: "Carlton" },
  { name: "Lytton St/Lygon St #113", locality: "Carlton" },
  { name: "Lygon St/Elgin St #112", locality: "Carlton" },
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
  { name: "Lincoln Square/Swanston St #3", locality: "Lincoln Square" },
  { name: "Queensberry St/Swanston St #4", locality: "Melbourne City" },
  { name: "RMIT University/Swanston St #7", locality: "RMIT University" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne Central Station" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Bourke Street Mall" },
  { name: "City Square/Swanston St #11", locality: "Melbourne City" },
  { name: "Federation Square/Swanston St #13", locality: "Federation Square" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Arts Precinct/Sturt St #17", locality: "Arts Precinct" },
  { name: "Grant St/Sturt St #18", locality: "Southbank" },
  { name: "Miles St/Sturt St #19", locality: "Southbank" },
  { name: "Kings Way/Sturt St #20", locality: "South Melbourne" },
  { name: "Dorcas St/Eastern Rd #22", locality: "South Melbourne" },
  { name: "Moray St/Park St #23", locality: "South Melbourne" },
  { name: "Clarendon St/Park St #24", locality: "South Melbourne" },
  { name: "Cecil St/Park St #25", locality: "South Melbourne" },
  { name: "Ferrars St/Park St #26", locality: "South Melbourne" },
  { name: "Montague St/Park St #27", locality: "Albert Park" },
  { name: "Bridport St/Montague St #28", locality: "Albert Park" },
  { name: "Bridport St/Victoria Ave #29", locality: "Albert Park" },
  { name: "Richardson St/Victoria Ave #30", locality: "Albert Park" },
  { name: "Graham St/Victoria Ave #31", locality: "Albert Park" },
  { name: "Beaconsfield Pde/Victoria Ave #32", locality: "Albert Park" },
];

const ROUTE_1_EAST_COBURG_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Beaconsfield Pde/Victoria Ave #32", locality: "Albert Park" },
  { name: "Graham St/Victoria Ave #31", locality: "Albert Park" },
  { name: "Richardson St/Victoria Ave #30", locality: "Albert Park" },
  { name: "Bridport St/Victoria Ave #29", locality: "Albert Park" },
  { name: "Montague St/Bridport St #28", locality: "South Melbourne" },
  { name: "Park St/Montague St #27", locality: "South Melbourne" },
  { name: "Ferrars St/Park St #26", locality: "South Melbourne" },
  { name: "Cecil St/Park St #25", locality: "South Melbourne" },
  { name: "Clarendon St/Park St #24", locality: "South Melbourne" },
  { name: "Moray St/Park St #23", locality: "South Melbourne" },
  { name: "Dorcas St/Eastern Rd #22", locality: "South Melbourne" },
  { name: "Kings Way/Sturt St #20", locality: "Southbank" },
  { name: "Miles St/Sturt St #19", locality: "Southbank" },
  { name: "Grant St/Sturt St #18", locality: "Southbank" },
  { name: "Arts Precinct/Sturt St #17", locality: "Arts Precinct" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Federation Square/Swanston St #13", locality: "Federation Square" },
  { name: "City Square/Swanston St #11", locality: "Melbourne City" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Bourke Street Mall" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne Central Station" },
  { name: "RMIT University/Swanston St #7", locality: "RMIT University" },
  { name: "Queensberry St/Swanston St #4", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Lincoln Square" },
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
  { name: "Lygon St/Elgin St #112", locality: "Carlton" },
  { name: "Lytton St/Lygon St #113", locality: "Carlton North" },
  { name: "Princes St/Lygon St #114", locality: "Carlton North" },
  { name: "Melbourne Cemetery/Lygon St #115", locality: "Melbourne Cemetery" },
  { name: "Fenwick St/Lygon St #116", locality: "Carlton North" },
  { name: "Richardson St/Lygon St #117", locality: "Carlton North" },
  { name: "Pigdon St/Lygon St #118", locality: "Brunswick" },
  { name: "Brunswick Rd/Lygon St #120", locality: "Brunswick East" },
  { name: "Weston St/Lygon St #121", locality: "Brunswick East" },
  { name: "Glenlyon Rd/Lygon St #122", locality: "Brunswick East" },
  { name: "Albert St/Lygon St #123", locality: "Brunswick East" },
  { name: "Victoria St/Lygon St #124", locality: "Brunswick East" },
  { name: "Blyth St/Lygon St #125", locality: "Brunswick East" },
  { name: "Stewart St/Lygon St #126", locality: "Brunswick East" },
  { name: "Albion St/Lygon St #127", locality: "Brunswick East" },
  { name: "Mitchell St/Holmes St #128", locality: "Brunswick" },
  { name: "Moreland Rd/Holmes St #129", locality: "Coburg" },
  { name: "The Avenue/Nicholson St #130", locality: "Coburg" },
  { name: "Rennie St/Nicholson St #131", locality: "Coburg" },
  { name: "Crozier St/Nicholson St #132", locality: "Coburg" },
  { name: "Harding St/Nicholson St #133", locality: "Coburg" },
  { name: "Merribell Ave/Nicholson St #134", locality: "Coburg" },
  { name: "Bell St/Nicholson St #135", locality: "Coburg" },
];

const ROUTE_1_ROUTE_LINE: [number, number][] = [
  [-37.7406, 144.9798], // East Coburg / Bell St
  [-37.7524, 144.9801], // Moreland / Nicholson
  [-37.7664, 144.9728], // Holmes / Lygon transition
  [-37.7768, 144.9686], // Brunswick / Carlton North
  [-37.7897, 144.9660], // Melbourne Cemetery / Lygon
  [-37.79775, 144.96102], // Melbourne University
  [-37.8093, 144.9631],
  [-37.8169, 144.9672], // Federation Square
  [-37.8235, 144.9690],
  [-37.8312, 144.9705], // Sturt St
  [-37.8362, 144.9696], // South Melbourne
  [-37.8428, 144.9657], // Park St / Montague
  [-37.8473, 144.9625], // Victoria Ave
];

const ROUTE_1_SOUTH_MELBOURNE_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  ROUTE_1_ROUTE_LINE,
  ROUTE_1_SOUTH_MELBOURNE_STOP_DATA.length,
).map((position, index) => ({
  id: `route-1-south-melbourne-${index + 1}`,
  name: ROUTE_1_SOUTH_MELBOURNE_STOP_DATA[index]?.name ?? `Route 1 stop ${index + 1}`,
  locality: ROUTE_1_SOUTH_MELBOURNE_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 1 tram stop",
  modes: ["tram"],
  routeLabel: "1",
  departures: ROUTE_1_SOUTH_MELBOURNE_DEPARTURES,
}));

const ROUTE_1_EAST_COBURG_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  [...ROUTE_1_ROUTE_LINE].reverse() as [number, number][],
  ROUTE_1_EAST_COBURG_STOP_DATA.length,
).map((position, index) => ({
  id: `route-1-east-coburg-${index + 1}`,
  name: ROUTE_1_EAST_COBURG_STOP_DATA[index]?.name ?? `Route 1 return stop ${index + 1}`,
  locality: ROUTE_1_EAST_COBURG_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 1 tram stop",
  modes: ["tram"],
  routeLabel: "1",
  departures: ROUTE_1_EAST_COBURG_DEPARTURES,
}));

const ROUTE_96_ST_KILDA_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "96", destination: "St Kilda Beach", departureLabel: "2 min", statusLabel: "Tram due", note: "Southbound" },
  { route: "96", destination: "East Brunswick", departureLabel: "8 min", statusLabel: "Scheduled", note: "Northbound" },
  { route: "96", destination: "St Kilda Beach", departureLabel: "15 min", statusLabel: "Scheduled", note: "Via Bourke St" },
];

const ROUTE_96_EAST_BRUNSWICK_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "96", destination: "East Brunswick", departureLabel: "3 min", statusLabel: "Tram due", note: "Northbound" },
  { route: "96", destination: "St Kilda Beach", departureLabel: "9 min", statusLabel: "Scheduled", note: "Southbound" },
  { route: "96", destination: "East Brunswick", departureLabel: "18 min", statusLabel: "Scheduled", note: "Via Nicholson St" },
];

const ROUTE_96_ST_KILDA_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Blyth St/Nicholson St #23", locality: "Brunswick East" },
  { name: "Albert St/Nicholson St #22", locality: "Fitzroy North" },
  { name: "Glenlyon Rd/Nicholson St #21", locality: "Fitzroy North" },
  { name: "Miller St/Nicholson St #20", locality: "Fitzroy North" },
  { name: "Holden St/Nicholson St #19", locality: "Fitzroy North" },
  { name: "Scotchmer St/Nicholson St #18", locality: "Fitzroy North" },
  { name: "Reid St/Nicholson St #17", locality: "Fitzroy North" },
  { name: "Freeman St/Nicholson St #16", locality: "Fitzroy North" },
  { name: "Alexandra Pde/Nicholson St #15", locality: "Fitzroy" },
  { name: "Rose St/Nicholson St #14", locality: "Fitzroy" },
  { name: "Johnston St/Nicholson St #13", locality: "Fitzroy" },
  { name: "Moor St/Nicholson St #12", locality: "Fitzroy" },
  { name: "Melbourne Museum/Nicholson St #11", locality: "Melbourne Museum" },
  { name: "Albert St/Nicholson St #10", locality: "Melbourne City" },
  { name: "Spring St/Bourke St #9", locality: "Melbourne City" },
  { name: "Russell St/Bourke St #7", locality: "Melbourne City" },
  { name: "Swanston St/Bourke St #6", locality: "Melbourne City" },
  { name: "Elizabeth St/Bourke St #5", locality: "Melbourne City" },
  { name: "Queen St/Bourke St #4", locality: "Melbourne City" },
  { name: "William St/Bourke St #3", locality: "Melbourne City" },
  { name: "Spencer St/Bourke St #1", locality: "Melbourne City" },
  { name: "Southern Cross Railway Station/Spencer St #122", locality: "Southern Cross Railway Station" },
  { name: "Batman Park/Spencer St #124", locality: "Batman Park" },
  { name: "124A-Casino/MCEC/Clarendon St", locality: "Casino/MCEC" },
  { name: "Port Junction/79 Whiteman St #125", locality: "Port Junction" },
  { name: "City Rd/Light Rail #126", locality: "South Melbourne" },
  { name: "South Melbourne Station/Light Rail #127", locality: "South Melbourne Station" },
  { name: "Albert Park Station/Light Rail #128", locality: "Albert Park Station" },
  { name: "Melbourne Sports and Aquatic Centre/Light Rail #129", locality: "Melbourne Sports and Aquatic Centre" },
  { name: "Middle Park Station/Light Rail #130", locality: "Middle Park Station" },
  { name: "Fraser St/Light Rail #131", locality: "St Kilda" },
  { name: "St Kilda Station/Fitzroy St #132", locality: "St Kilda Station" },
  { name: "Canterbury Rd/Fitzroy St #133", locality: "St Kilda" },
  { name: "Park St/Fitzroy St #134", locality: "St Kilda" },
  { name: "Jacka Bvd/Fitzroy St #135", locality: "St Kilda" },
  { name: "Alfred Square/The Esplanade #136", locality: "St Kilda" },
  { name: "Luna Park/The Esplanade #138", locality: "Luna Park" },
  { name: "Belford St/Acland St #139", locality: "St Kilda" },
];

const ROUTE_96_EAST_BRUNSWICK_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Belford St/Acland St #139", locality: "St Kilda" },
  { name: "Luna Park/The Esplanade #138", locality: "Luna Park" },
  { name: "Alfred Square/The Esplanade #136", locality: "St Kilda" },
  { name: "Acland St/Fitzroy St #135", locality: "St Kilda" },
  { name: "Park St/Fitzroy St #134", locality: "St Kilda" },
  { name: "Canterbury Rd/Fitzroy St #133", locality: "St Kilda" },
  { name: "St Kilda Station/Fitzroy St #132", locality: "St Kilda Station" },
  { name: "Fraser St/Light Rail #131", locality: "Middle Park" },
  { name: "Middle Park Station/Light Rail #130", locality: "Middle Park Station" },
  { name: "Melbourne Sports and Aquatic Centre/Light Rail #129", locality: "Melbourne Sports and Aquatic Centre" },
  { name: "Albert Park Station/Light Rail #128", locality: "Albert Park Station" },
  { name: "South Melbourne Station/Light Rail #127", locality: "South Melbourne Station" },
  { name: "City Rd/Light Rail #126", locality: "Southbank" },
  { name: "Clarendon St/Whiteman St #125", locality: "Casino/MCEC" },
  { name: "Batman Park/Spencer St #124", locality: "Batman Park" },
  { name: "Southern Cross Railway Station/Spencer St #122", locality: "Southern Cross Railway Station" },
  { name: "Spencer St/Bourke St #1", locality: "Melbourne City" },
  { name: "William St/Bourke St #3", locality: "Melbourne City" },
  { name: "Queen St/Bourke St #4", locality: "Melbourne City" },
  { name: "Elizabeth St/Bourke St #5", locality: "Melbourne City" },
  { name: "Swanston St/Bourke St #6", locality: "Melbourne City" },
  { name: "Russell St/Bourke St #7", locality: "Melbourne City" },
  { name: "Spring St/Bourke St #9", locality: "East Melbourne" },
  { name: "Albert St/Nicholson St #10", locality: "Fitzroy" },
  { name: "Melbourne Museum/Nicholson St #11", locality: "Melbourne Museum" },
  { name: "Moor St/Nicholson St #12", locality: "Carlton" },
  { name: "Johnston St/Nicholson St #13", locality: "Carlton" },
  { name: "Rose St/Nicholson St #14", locality: "Carlton" },
  { name: "Alexandra Pde/Nicholson St #15", locality: "Fitzroy North" },
  { name: "Freeman St/Nicholson St #16", locality: "Carlton North" },
  { name: "Reid St/Nicholson St #17", locality: "Carlton North" },
  { name: "Scotchmer St/Nicholson St #18", locality: "Fitzroy" },
  { name: "Brunswick Rd/Nicholson St #19", locality: "Brunswick East" },
  { name: "Miller St/Nicholson St #20", locality: "Brunswick East" },
  { name: "Glenlyon Rd/Nicholson St #21", locality: "Brunswick East" },
  { name: "Albert St/Nicholson St #22", locality: "Brunswick East" },
  { name: "Blyth St/Nicholson St #23", locality: "Brunswick East" },
];

const ROUTE_96_ROUTE_LINE: [number, number][] = [
  [-37.7655, 144.9788], // East Brunswick
  [-37.7796, 144.9783], // Fitzroy North
  [-37.7913, 144.9794], // Nicholson / Museum
  [-37.8111, 144.9689], // Bourke St city
  [-37.8177, 144.9522], // Southern Cross
  [-37.8228, 144.9556], // Whiteman / Clarendon
  [-37.8367, 144.9618], // Light rail
  [-37.8507, 144.9700], // Fitzroy St
  [-37.8670, 144.9817], // Acland / St Kilda Beach
];

const ROUTE_96_ST_KILDA_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  ROUTE_96_ROUTE_LINE,
  ROUTE_96_ST_KILDA_STOP_DATA.length,
).map((position, index) => ({
  id: `route-96-st-kilda-${index + 1}`,
  name: ROUTE_96_ST_KILDA_STOP_DATA[index]?.name ?? `Route 96 stop ${index + 1}`,
  locality: ROUTE_96_ST_KILDA_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 96 tram stop",
  modes: ["tram"],
  routeLabel: "96",
  departures: ROUTE_96_ST_KILDA_DEPARTURES,
}));

const ROUTE_96_EAST_BRUNSWICK_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  [...ROUTE_96_ROUTE_LINE].reverse() as [number, number][],
  ROUTE_96_EAST_BRUNSWICK_STOP_DATA.length,
).map((position, index) => ({
  id: `route-96-east-brunswick-${index + 1}`,
  name: ROUTE_96_EAST_BRUNSWICK_STOP_DATA[index]?.name ?? `Route 96 return stop ${index + 1}`,
  locality: ROUTE_96_EAST_BRUNSWICK_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 96 tram stop",
  modes: ["tram"],
  routeLabel: "96",
  departures: ROUTE_96_EAST_BRUNSWICK_DEPARTURES,
}));

const ROUTE_5_MALVERN_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "5", destination: "Malvern", departureLabel: "3 min", statusLabel: "Tram due", note: "Southbound" },
  { route: "5", destination: "Melbourne University", departureLabel: "9 min", statusLabel: "Scheduled", note: "Northbound" },
  { route: "5", destination: "Malvern", departureLabel: "17 min", statusLabel: "Scheduled", note: "Via Wattletree Rd" },
];

const ROUTE_5_UNIVERSITY_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "5", destination: "Melbourne University", departureLabel: "2 min", statusLabel: "Tram due", note: "Northbound" },
  { route: "5", destination: "Malvern", departureLabel: "8 min", statusLabel: "Scheduled", note: "Southbound" },
  { route: "5", destination: "Melbourne University", departureLabel: "16 min", statusLabel: "Scheduled", note: "Via Swanston St" },
];

const ROUTE_5_MALVERN_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
  { name: "Lincoln Square/Swanston St #3", locality: "Lincoln Square" },
  { name: "Queensberry St/Swanston St #4", locality: "Melbourne City" },
  { name: "RMIT University/Swanston St #7", locality: "RMIT University" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne Central Station" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Bourke Street Mall" },
  { name: "City Square/Swanston St #11", locality: "City Square" },
  { name: "Federation Square/Swanston St #13", locality: "Federation Square" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Grant St-Police Memorial" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Shrine of Remembrance" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Anzac Station" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "South Melbourne" },
  { name: "Leopold St/St Kilda Rd #24", locality: "South Melbourne" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "South Melbourne" },
  { name: "Moubray St/St Kilda Rd #26", locality: "South Melbourne" },
  { name: "High St/St Kilda Rd #27", locality: "St Kilda" },
  { name: "Union St/St Kilda Rd #29", locality: "St Kilda" },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "St Kilda Junction" },
  { name: "Queens Way/Queens Way #31", locality: "Queens Way" },
  { name: "Chapel St/Dandenong Rd #32", locality: "Windsor" },
  { name: "Hornby St/Dandenong Rd #33", locality: "Windsor" },
  { name: "The Avenue/Dandenong Rd #34", locality: "Prahran" },
  { name: "Williams Rd/Dandenong Rd #35", locality: "St Kilda East" },
  { name: "Closeburn Ave/Dandenong Rd #36", locality: "St Kilda East" },
  { name: "Lansdowne Rd/Dandenong Rd #37", locality: "Prahran" },
  { name: "Orrong Rd/Dandenong Rd #38", locality: "Armadale" },
  { name: "Wattletree Rd/Dandenong Rd #40", locality: "Armadale" },
  { name: "Armadale St/Wattletree Rd #41", locality: "Armadale" },
  { name: "Kooyong Rd/Wattletree Rd #42", locality: "Armadale" },
  { name: "Egerton Rd/Wattletree Rd #43", locality: "Armadale" },
  { name: "Duncraig Ave/Wattletree Rd #44", locality: "Malvern" },
  { name: "Glenferrie Rd/Wattletree Rd #45", locality: "Malvern" },
  { name: "Nicholls St/Wattletree Rd #46", locality: "Malvern" },
  { name: "Cabrini Hospital/Wattletree Rd #47", locality: "Cabrini Hospital" },
  { name: "Dixon St/Wattletree Rd #48", locality: "Malvern East" },
  { name: "Tooronga Rd/Wattletree Rd #49", locality: "Malvern East" },
  { name: "Vincent St/Wattletree Rd #50", locality: "Malvern East" },
  { name: "Erica Ave/Wattletree Rd #51", locality: "Malvern East" },
  { name: "Burke Rd/Wattletree Rd #52", locality: "Malvern East" },
];

const ROUTE_5_UNIVERSITY_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Burke Rd/Wattletree Rd #52", locality: "Malvern East" },
  { name: "Nott St/Wattletree Rd #51", locality: "Malvern East" },
  { name: "Anderson St/Wattletree Rd #50", locality: "Malvern East" },
  { name: "Tooronga Rd/Wattletree Rd #49", locality: "Malvern East" },
  { name: "Dixon St/Wattletree Rd #48", locality: "Malvern" },
  { name: "Cabrini Hospital/Wattletree Rd #47", locality: "Cabrini Hospital" },
  { name: "Soudan St/Wattletree Rd #46", locality: "Malvern" },
  { name: "Glenferrie Rd/Wattletree Rd #45", locality: "Armadale" },
  { name: "Duncraig Ave/Wattletree Rd #44", locality: "Armadale" },
  { name: "Egerton Rd/Wattletree Rd #43", locality: "Armadale" },
  { name: "Kooyong Rd/Wattletree Rd #42", locality: "Armadale" },
  { name: "Wattletree Rd/Dandenong Rd #40", locality: "Armadale" },
  { name: "Orrong Rd/Dandenong Rd #38", locality: "Prahran" },
  { name: "Lansdowne Rd/Dandenong Rd #37", locality: "Prahran" },
  { name: "Alexandra St/Dandenong Rd #36", locality: "Prahran" },
  { name: "Williams Rd/Dandenong Rd #35", locality: "St Kilda East" },
  { name: "Westbury St/Dandenong Rd #34", locality: "Windsor" },
  { name: "Hornby St/Dandenong Rd #33", locality: "Windsor" },
  { name: "Chapel St/Dandenong Rd #32", locality: "St Kilda" },
  { name: "Queens Way/Queens Way #31", locality: "Queens Way" },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "St Kilda Junction" },
  { name: "Union St/St Kilda Rd #29", locality: "Melbourne City" },
  { name: "Lorne St/St Kilda Rd #27", locality: "Melbourne City" },
  { name: "Beatrice St/St Kilda Rd #26", locality: "Melbourne City" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "Melbourne City" },
  { name: "Leopold St/St Kilda Rd #24", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "Melbourne City" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Anzac Station" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Shrine of Remembrance" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Grant St-Police Memorial" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Federation Square/Swanston St #13", locality: "Federation Square" },
  { name: "City Square/Swanston St #11", locality: "City Square" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Bourke Street Mall" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne Central Station" },
  { name: "RMIT University/Swanston St #7", locality: "RMIT University" },
  { name: "Queensberry St/Swanston St #4", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Lincoln Square" },
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
];

const ROUTE_5_ROUTE_LINE: [number, number][] = [
  [-37.79775, 144.96102],
  [-37.8093, 144.9631],
  [-37.8169, 144.9672],
  [-37.8298, 144.9686],
  [-37.8377, 144.9732],
  [-37.8449, 144.9785],
  [-37.8518, 144.9874],
  [-37.8603, 145.0006],
  [-37.8677, 145.0119],
  [-37.8728, 145.0215],
  [-37.8753, 145.0288],
  [-37.8766, 145.0368],
];

const ROUTE_5_MALVERN_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  ROUTE_5_ROUTE_LINE,
  ROUTE_5_MALVERN_STOP_DATA.length,
).map((position, index) => ({
  id: `route-5-malvern-${index + 1}`,
  name: ROUTE_5_MALVERN_STOP_DATA[index]?.name ?? `Route 5 stop ${index + 1}`,
  locality: ROUTE_5_MALVERN_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 5 tram stop",
  modes: ["tram"],
  routeLabel: "5",
  departures: ROUTE_5_MALVERN_DEPARTURES,
}));

const ROUTE_5_UNIVERSITY_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  [...ROUTE_5_ROUTE_LINE].reverse() as [number, number][],
  ROUTE_5_UNIVERSITY_STOP_DATA.length,
).map((position, index) => ({
  id: `route-5-university-${index + 1}`,
  name: ROUTE_5_UNIVERSITY_STOP_DATA[index]?.name ?? `Route 5 return stop ${index + 1}`,
  locality: ROUTE_5_UNIVERSITY_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 5 tram stop",
  modes: ["tram"],
  routeLabel: "5",
  departures: ROUTE_5_UNIVERSITY_DEPARTURES,
}));

const ROUTE_6_GLEN_IRIS_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "6", destination: "Glen Iris", departureLabel: "4 min", statusLabel: "Tram due", note: "Southbound" },
  { route: "6", destination: "Moreland", departureLabel: "11 min", statusLabel: "Scheduled", note: "Northbound" },
  { route: "6", destination: "Glen Iris", departureLabel: "19 min", statusLabel: "Scheduled", note: "Via High St" },
];

const ROUTE_6_MORELAND_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "6", destination: "Moreland", departureLabel: "3 min", statusLabel: "Tram due", note: "Northbound" },
  { route: "6", destination: "Glen Iris", departureLabel: "9 min", statusLabel: "Scheduled", note: "Southbound" },
  { route: "6", destination: "Moreland", departureLabel: "17 min", statusLabel: "Scheduled", note: "Via Lygon St" },
];

const ROUTE_6_GLEN_IRIS_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Moreland Station/Cameron St #133", locality: "Moreland Station" },
  { name: "Sydney Rd/Moreland Rd #132", locality: "Coburg" },
  { name: "De Carle St/Moreland Rd #131", locality: "Coburg" },
  { name: "Barrow St/Moreland Rd #130", locality: "Coburg" },
  { name: "Moreland Rd/Holmes St #129", locality: "Brunswick" },
  { name: "Mitchell St/Holmes St #128", locality: "Brunswick East" },
  { name: "Albion St/Holmes St #127", locality: "Brunswick East" },
  { name: "Stewart St/Lygon St #126", locality: "Brunswick East" },
  { name: "Blyth St/Lygon St #125", locality: "Brunswick East" },
  { name: "Victoria St/Lygon St #124", locality: "Brunswick East" },
  { name: "Albert St/Lygon St #123", locality: "Brunswick East" },
  { name: "Glenlyon Rd/Lygon St #122", locality: "Brunswick East" },
  { name: "Weston St/Lygon St #121", locality: "Brunswick" },
  { name: "Brunswick Rd/Lygon St #120", locality: "Carlton North" },
  { name: "Pigdon St/Lygon St #118", locality: "Carlton North" },
  { name: "Richardson St/Lygon St #117", locality: "Carlton North" },
  { name: "Fenwick St/Lygon St #116", locality: "Carlton North" },
  { name: "Melbourne Cemetery/Lygon St #115", locality: "Melbourne Cemetery" },
  { name: "Princes St/Lygon St #114", locality: "Carlton" },
  { name: "Lytton St/Lygon St #113", locality: "Carlton" },
  { name: "Lygon St/Elgin St #112", locality: "Carlton" },
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
  { name: "Lincoln Square/Swanston St #3", locality: "Lincoln Square" },
  { name: "Queensberry St/Swanston St #4", locality: "Melbourne City" },
  { name: "RMIT University/Swanston St #7", locality: "RMIT University" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne Central Station" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Bourke Street Mall" },
  { name: "City Square/Swanston St #11", locality: "City Square" },
  { name: "Federation Square/Swanston St #13", locality: "Federation Square" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Grant St-Police Memorial" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Shrine of Remembrance" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Anzac Station" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "South Melbourne" },
  { name: "Leopold St/St Kilda Rd #24", locality: "South Melbourne" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "South Melbourne" },
  { name: "Moubray St/St Kilda Rd #26", locality: "South Melbourne" },
  { name: "High St/St Kilda Rd #27", locality: "Prahran" },
  { name: "Punt Rd/High St #28", locality: "Prahran" },
  { name: "Perth St/High St #29", locality: "Prahran" },
  { name: "Prahran Station/High St #30", locality: "Prahran Station" },
  { name: "Chapel St/High St #31", locality: "Prahran" },
  { name: "Hornby St/High St #32", locality: "Prahran" },
  { name: "Prahran RSL/High St #33", locality: "Prahran RSL" },
  { name: "Lewisham Rd/High St #34", locality: "Prahran" },
  { name: "Williams Rd/High St #35", locality: "Prahran" },
  { name: "Chatsworth Rd/High St #36", locality: "Prahran" },
  { name: "Airlie Ave/High St #37", locality: "Prahran" },
  { name: "Orrong Rd/High St #38", locality: "Armadale" },
  { name: "Auburn Gr/High St #39", locality: "Armadale" },
  { name: "Armadale Station/High St #40", locality: "Armadale Station" },
  { name: "Kooyong Rd/High St #41", locality: "Armadale" },
  { name: "Huntingtower Rd/High St #42", locality: "Armadale" },
  { name: "Mercer Rd/High St #43", locality: "Malvern" },
  { name: "Glenferrie Rd/High St #44", locality: "Malvern" },
  { name: "De La Salle College/High St #45", locality: "De La Salle College" },
  { name: "Fraser St/High St #46", locality: "Malvern" },
  { name: "Dixon St/High St #47", locality: "Glen Iris" },
  { name: "Tooronga Rd/High St #48", locality: "Glen Iris" },
  { name: "Harold Holt Swim Centre/High St #49", locality: "Harold Holt Swim Centre" },
  { name: "Belmont Ave/High St #50", locality: "Glen Iris" },
  { name: "Burke Rd/High St #51", locality: "Glen Iris" },
  { name: "Boyanda Rd/High St #52", locality: "Glen Iris" },
  { name: "Malvern Rd/High St #53", locality: "Glen Iris" },
];

const ROUTE_6_MORELAND_STOP_DATA: Array<{ name: string; locality: string }> = [
  { name: "Malvern Rd/High St #53", locality: "Glen Iris" },
  { name: "Boyanda Rd/High St #52", locality: "Glen Iris" },
  { name: "Burke Rd/High St #51", locality: "Glen Iris" },
  { name: "Belmont Ave/High St #50", locality: "Glen Iris" },
  { name: "Harold Holt Swim Centre/High St #49", locality: "Harold Holt Swim Centre" },
  { name: "Tooronga Rd/High St #48", locality: "Malvern" },
  { name: "Dixon St/High St #47", locality: "Malvern" },
  { name: "Fraser St/High St #46", locality: "Malvern" },
  { name: "De La Salle College/High St #45", locality: "De La Salle College" },
  { name: "Glenferrie Rd/High St #44", locality: "Armadale" },
  { name: "Mercer Rd/High St #43", locality: "Armadale" },
  { name: "Huntingtower Rd/High St #42", locality: "Armadale" },
  { name: "Kooyong Rd/High St #41", locality: "Armadale" },
  { name: "Armadale Station/High St #40", locality: "Armadale Station" },
  { name: "Auburn Gr/High St #39", locality: "Armadale" },
  { name: "Orrong Rd/High St #38", locality: "Prahran" },
  { name: "Airlie Ave/High St #37", locality: "Prahran" },
  { name: "Chatsworth Rd/High St #36", locality: "Prahran" },
  { name: "Williams Rd/High St #35", locality: "Prahran" },
  { name: "Lewisham Rd/High St #34", locality: "Prahran" },
  { name: "Prahran RSL/High St #33", locality: "Prahran RSL" },
  { name: "Hornby St/High St #32", locality: "Prahran" },
  { name: "Chapel St/High St #31", locality: "Windsor" },
  { name: "Prahran Station/High St #30", locality: "Prahran Station" },
  { name: "Perth St/High St #29", locality: "Windsor" },
  { name: "Punt Rd/High St #28", locality: "Melbourne City" },
  { name: "Lorne St/St Kilda Rd #27", locality: "Melbourne City" },
  { name: "Beatrice St/St Kilda Rd #26", locality: "Melbourne City" },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "Melbourne City" },
  { name: "Leopold St/St Kilda Rd #24", locality: "Melbourne City" },
  { name: "Arthur St/St Kilda Rd #23", locality: "Melbourne City" },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "Melbourne City" },
  { name: "Anzac Station/St Kilda Rd #20", locality: "Anzac Station" },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "Shrine of Remembrance" },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "Grant St-Police Memorial" },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "Arts Precinct" },
  { name: "Federation Square/Swanston St #13", locality: "Federation Square" },
  { name: "City Square/Swanston St #11", locality: "City Square" },
  { name: "Bourke Street Mall/Swanston St #10", locality: "Bourke Street Mall" },
  { name: "Melbourne Central Station/Swanston St #8", locality: "Melbourne Central Station" },
  { name: "RMIT University/Swanston St #7", locality: "RMIT University" },
  { name: "Queensberry St/Swanston St #4", locality: "Carlton" },
  { name: "Lincoln Square/Swanston St #3", locality: "Lincoln Square" },
  { name: "Melbourne University/Swanston St #1", locality: "Melbourne University" },
  { name: "Lygon St/Elgin St #112", locality: "Carlton" },
  { name: "Lytton St/Lygon St #113", locality: "Carlton North" },
  { name: "Princes St/Lygon St #114", locality: "Carlton North" },
  { name: "Melbourne Cemetery/Lygon St #115", locality: "Melbourne Cemetery" },
  { name: "Fenwick St/Lygon St #116", locality: "Carlton North" },
  { name: "Richardson St/Lygon St #117", locality: "Carlton North" },
  { name: "Pigdon St/Lygon St #118", locality: "Brunswick" },
  { name: "Brunswick Rd/Lygon St #120", locality: "Brunswick East" },
  { name: "Weston St/Lygon St #121", locality: "Brunswick East" },
  { name: "Glenlyon Rd/Lygon St #122", locality: "Brunswick East" },
  { name: "Albert St/Lygon St #123", locality: "Brunswick East" },
  { name: "Victoria St/Lygon St #124", locality: "Brunswick East" },
  { name: "Blyth St/Lygon St #125", locality: "Brunswick East" },
  { name: "Stewart St/Lygon St #126", locality: "Brunswick East" },
  { name: "Albion St/Lygon St #127", locality: "Brunswick East" },
  { name: "Mitchell St/Holmes St #128", locality: "Brunswick" },
  { name: "Moreland Rd/Holmes St #129", locality: "Coburg" },
  { name: "Barrow St/Moreland Rd #130", locality: "Coburg" },
  { name: "De Carle St/Moreland Rd #131", locality: "Coburg" },
  { name: "Sydney Rd/Moreland Rd #132", locality: "Coburg" },
  { name: "Moreland Station/Moreland Rd #133", locality: "Moreland Station" },
];

const ROUTE_6_ROUTE_LINE: [number, number][] = [
  [-37.7542, 144.9649], // Moreland
  [-37.7664, 144.9728], // Holmes / Lygon
  [-37.7768, 144.9686], // Carlton North
  [-37.7897, 144.9660], // Cemetery / Carlton
  [-37.79775, 144.96102],
  [-37.8093, 144.9631],
  [-37.8169, 144.9672],
  [-37.8298, 144.9686],
  [-37.8377, 144.9732],
  [-37.8468, 144.9835], // High St / Prahran
  [-37.8559, 145.0042], // Armadale / Malvern
  [-37.8618, 145.0215],
  [-37.8656, 145.0298], // Glen Iris
];

const ROUTE_6_GLEN_IRIS_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  ROUTE_6_ROUTE_LINE,
  ROUTE_6_GLEN_IRIS_STOP_DATA.length,
).map((position, index) => ({
  id: `route-6-glen-iris-${index + 1}`,
  name: ROUTE_6_GLEN_IRIS_STOP_DATA[index]?.name ?? `Route 6 stop ${index + 1}`,
  locality: ROUTE_6_GLEN_IRIS_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 6 tram stop",
  modes: ["tram"],
  routeLabel: "6",
  departures: ROUTE_6_GLEN_IRIS_DEPARTURES,
}));

const ROUTE_6_MORELAND_SURFACE_STOPS: SurfaceStop[] = interpolateStopsAlongPolyline(
  [...ROUTE_6_ROUTE_LINE].reverse() as [number, number][],
  ROUTE_6_MORELAND_STOP_DATA.length,
).map((position, index) => ({
  id: `route-6-moreland-${index + 1}`,
  name: ROUTE_6_MORELAND_STOP_DATA[index]?.name ?? `Route 6 return stop ${index + 1}`,
  locality: ROUTE_6_MORELAND_STOP_DATA[index]?.locality ?? "Melbourne",
  position,
  subtitle: "Route 6 tram stop",
  modes: ["tram"],
  routeLabel: "6",
  departures: ROUTE_6_MORELAND_DEPARTURES,
}));

const ROUTE_11_DOCKLANDS_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "11", destination: "Victoria Harbour Docklands", departureLabel: "3 min", statusLabel: "Tram due", note: "Southbound" },
  { route: "11", destination: "West Preston", departureLabel: "9 min", statusLabel: "Scheduled", note: "Northbound" },
  { route: "11", destination: "Victoria Harbour Docklands", departureLabel: "17 min", statusLabel: "Scheduled", note: "Via Collins St" },
];

const ROUTE_11_WEST_PRESTON_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "11", destination: "West Preston", departureLabel: "2 min", statusLabel: "Tram due", note: "Northbound" },
  { route: "11", destination: "Victoria Harbour Docklands", departureLabel: "8 min", statusLabel: "Scheduled", note: "Southbound" },
  { route: "11", destination: "West Preston", departureLabel: "16 min", statusLabel: "Scheduled", note: "Via Brunswick St" },
];

const ROUTE_11_DOCKLANDS_STOP_DATA: Array<{ name: string; locality: string; position: [number, number] }> = [
  { name: "West Preston/Gilbert Rd #47", locality: "PTV GTFS", position: [-37.72918594, 144.99158656] },
  { name: "Jacka St/Gilbert Rd #45", locality: "PTV GTFS", position: [-37.73276368, 144.99105870] },
  { name: "Cooper St/Gilbert Rd #44", locality: "PTV GTFS", position: [-37.73460563, 144.99073657] },
  { name: "Murray Rd/Gilbert Rd #43", locality: "PTV GTFS", position: [-37.73646559, 144.99041394] },
  { name: "Cramer St/Gilbert Rd #42", locality: "PTV GTFS", position: [-37.73891028, 144.99003009] },
  { name: "Bruce St/Gilbert Rd #41", locality: "PTV GTFS", position: [-37.74095959, 144.98971365] },
  { name: "Bell St/Gilbert Rd #40", locality: "PTV GTFS", position: [-37.74353804, 144.98924668] },
  { name: "Latona Ave/Gilbert Rd #39", locality: "PTV GTFS", position: [-37.74562396, 144.98896324] },
  { name: "Oakover Rd/Gilbert Rd #38", locality: "PTV GTFS", position: [-37.74823019, 144.98854086] },
  { name: "Miller St/Gilbert Rd #37", locality: "PTV GTFS", position: [-37.75060223, 144.98812478] },
  { name: "Devon St/Miller St #36", locality: "PTV GTFS", position: [-37.75126315, 144.99094434] },
  { name: "St Georges Rd/Miller St #35", locality: "PTV GTFS", position: [-37.75164413, 144.99479302] },
  { name: "Miller St/St Georges Rd #34", locality: "PTV GTFS", position: [-37.75226818, 144.99492372] },
  { name: "Hutton St/St Georges Rd #33", locality: "PTV GTFS", position: [-37.75508521, 144.99417799] },
  { name: "Normanby Ave/St Georges Rd #32", locality: "PTV GTFS", position: [-37.75846227, 144.99350787] },
  { name: "Gadd St/St Georges Rd #31", locality: "PTV GTFS", position: [-37.76263888, 144.99269120] },
  { name: "Gladstone Ave/St Georges Rd #30", locality: "PTV GTFS", position: [-37.76519815, 144.99215657] },
  { name: "Arthurton Rd/St Georges Rd #29", locality: "PTV GTFS", position: [-37.76814455, 144.99160008] },
  { name: "Sumner Ave/St Georges Rd #28", locality: "PTV GTFS", position: [-37.77141000, 144.99072837] },
  { name: "Westbourne Gr/St Georges Rd #27", locality: "PTV GTFS", position: [-37.77364614, 144.99027046] },
  { name: "Clarke St/St Georges Rd #26", locality: "PTV GTFS", position: [-37.77573893, 144.98986183] },
  { name: "Miller St/St Georges Rd #25", locality: "PTV GTFS", position: [-37.77795152, 144.98855296] },
  { name: "Holden St/St Georges Rd #24", locality: "PTV GTFS", position: [-37.77987866, 144.98688841] },
  { name: "Park St/St Georges Rd #23", locality: "PTV GTFS", position: [-37.78173486, 144.98529383] },
  { name: "Scotchmer St/St Georges Rd #22", locality: "PTV GTFS", position: [-37.78321817, 144.98402724] },
  { name: "Alfred Cres/St Georges Rd #21", locality: "PTV GTFS", position: [-37.78538493, 144.98215155] },
  { name: "Fitzroy Bowls Club/Brunswick St #20", locality: "PTV GTFS", position: [-37.78817377, 144.98029287] },
  { name: "Newry St/Brunswick St #19", locality: "PTV GTFS", position: [-37.79053694, 144.97988784] },
  { name: "Alexandra Pde/Brunswick St #18", locality: "PTV GTFS", position: [-37.79292673, 144.97945935] },
  { name: "Leicester St/Brunswick St #17", locality: "PTV GTFS", position: [-37.79546083, 144.97903825] },
  { name: "Johnston St/Brunswick St #16", locality: "PTV GTFS", position: [-37.79816569, 144.97858975] },
  { name: "St David St/Brunswick St #15", locality: "PTV GTFS", position: [-37.80053784, 144.97818436] },
  { name: "King William St/Brunswick St #14", locality: "PTV GTFS", position: [-37.80270321, 144.97780729] },
  { name: "Gertrude St/Brunswick St #13", locality: "PTV GTFS", position: [-37.80559663, 144.97731947] },
  { name: "St Vincents Plaza/Victoria Pde #12", locality: "PTV GTFS", position: [-37.80827390, 144.97631501] },
  { name: "Albert St/Gisborne St #11", locality: "PTV GTFS", position: [-37.80939028, 144.97572795] },
  { name: "Parliament Railway Station/Macarthur St #10", locality: "PTV GTFS", position: [-37.81244860, 144.97434947] },
  { name: "Spring St/Collins St #8", locality: "PTV GTFS", position: [-37.81353855, 144.97327462] },
  { name: "Exhibition St/Collins St #7", locality: "PTV GTFS", position: [-37.81435556, 144.97048055] },
  { name: "Melbourne Town Hall/Collins St #6", locality: "PTV GTFS", position: [-37.81568334, 144.96595711] },
  { name: "Elizabeth St/Collins St #5", locality: "PTV GTFS", position: [-37.81639699, 144.96344972] },
  { name: "William St/Collins St #3", locality: "PTV GTFS", position: [-37.81756122, 144.95938493] },
  { name: "Spencer St/Collins St #1", locality: "PTV GTFS", position: [-37.81884589, 144.95499861] },
  { name: "Southern Cross Station/Collins St #D14", locality: "PTV GTFS", position: [-37.81966206, 144.95218145] },
  { name: "Batman's Hill/Collins St #D15", locality: "PTV GTFS", position: [-37.82024859, 144.95015445] },
  { name: "Harbour Esp/Collins St #D16", locality: "PTV GTFS", position: [-37.82081807, 144.94818470] },
  { name: "Merchant St/Collins St #D17", locality: "PTV GTFS", position: [-37.82151400, 144.94520032] },
  { name: "Bourke St/Collins St #D18", locality: "PTV GTFS", position: [-37.82081855, 144.94201596] },
];

const ROUTE_11_WEST_PRESTON_STOP_DATA: Array<{ name: string; locality: string; position: [number, number] }> = [
  { name: "Bourke St/Collins St #D18", locality: "PTV GTFS", position: [-37.82078292, 144.94203967] },
  { name: "Merchant St/Collins St #D17", locality: "PTV GTFS", position: [-37.82145630, 144.94550865] },
  { name: "Harbour Esp/Collins St #D16", locality: "PTV GTFS", position: [-37.82080570, 144.94799191] },
  { name: "Batman's Hill/Collins St #D15", locality: "PTV GTFS", position: [-37.82009180, 144.95046552] },
  { name: "Southern Cross Station/Collins St #D14", locality: "PTV GTFS", position: [-37.81948862, 144.95257249] },
  { name: "Spencer St/Collins St #1", locality: "PTV GTFS", position: [-37.81870592, 144.95524103] },
  { name: "William St/Collins St #3", locality: "PTV GTFS", position: [-37.81739736, 144.95980976] },
  { name: "Elizabeth St/Collins St #5", locality: "PTV GTFS", position: [-37.81624916, 144.96376050] },
  { name: "Melbourne Town Hall/Collins St #6", locality: "PTV GTFS", position: [-37.81551769, 144.96627972] },
  { name: "Exhibition St/Collins St #7", locality: "PTV GTFS", position: [-37.81422456, 144.97072269] },
  { name: "Spring St/Collins St #8", locality: "PTV GTFS", position: [-37.81341597, 144.97348244] },
  { name: "Parliament Railway Station/Macarthur St #10", locality: "PTV GTFS", position: [-37.81217073, 144.97443658] },
  { name: "Albert St/Gisborne St #11", locality: "PTV GTFS", position: [-37.80969458, 144.97560605] },
  { name: "Gertrude St/Brunswick St #13", locality: "PTV GTFS", position: [-37.80585453, 144.97711935] },
  { name: "Hanover St/Brunswick St #14", locality: "PTV GTFS", position: [-37.80283501, 144.97761062] },
  { name: "Bell St/Brunswick St #15", locality: "PTV GTFS", position: [-37.80044523, 144.97803924] },
  { name: "Johnston St/Brunswick St #16", locality: "PTV GTFS", position: [-37.79853129, 144.97836400] },
  { name: "Leicester St/Brunswick St #17", locality: "PTV GTFS", position: [-37.79562886, 144.97885197] },
  { name: "Alexandra Pde/Brunswick St #18", locality: "PTV GTFS", position: [-37.79362503, 144.97919049] },
  { name: "Newry St/Brunswick St #19", locality: "PTV GTFS", position: [-37.79080346, 144.97966482] },
  { name: "Fitzroy Bowls Club/Brunswick St #20", locality: "PTV GTFS", position: [-37.78829657, 144.98009648] },
  { name: "Alfred Cres/St Georges Rd #21", locality: "PTV GTFS", position: [-37.78542589, 144.98191198] },
  { name: "Scotchmer St/St Georges Rd #22", locality: "PTV GTFS", position: [-37.78340992, 144.98364732] },
  { name: "Park St/St Georges Rd #23", locality: "PTV GTFS", position: [-37.78150928, 144.98527725] },
  { name: "Holden St/St Georges Rd #24", locality: "PTV GTFS", position: [-37.78007062, 144.98651987] },
  { name: "Miller St/St Georges Rd #25", locality: "PTV GTFS", position: [-37.77801932, 144.98830133] },
  { name: "Clarke St/St Georges Rd #26", locality: "PTV GTFS", position: [-37.77592635, 144.98975457] },
  { name: "Westbourne Gr/St Georges Rd #27", locality: "PTV GTFS", position: [-37.77380673, 144.99017529] },
  { name: "Sumner Ave/St Georges Rd #28", locality: "PTV GTFS", position: [-37.77157059, 144.99063320] },
  { name: "Arthurton Rd/St Georges Rd #29", locality: "PTV GTFS", position: [-37.76856211, 144.99124820] },
  { name: "Gladstone Ave/St Georges Rd #30", locality: "PTV GTFS", position: [-37.76529375, 144.99194965] },
  { name: "Bird Ave/St Georges Rd #31", locality: "PTV GTFS", position: [-37.76241020, 144.99249306] },
  { name: "Normanby Ave/St Georges Rd #32", locality: "PTV GTFS", position: [-37.75922271, 144.99318084] },
  { name: "Hutton St/St Georges Rd #33", locality: "PTV GTFS", position: [-37.75566608, 144.99388989] },
  { name: "Miller St/St Georges Rd #34", locality: "PTV GTFS", position: [-37.75204240, 144.99489576] },
  { name: "Bracken Ave/Miller St #36", locality: "PTV GTFS", position: [-37.75144068, 144.99131409] },
  { name: "Miller St/Gilbert Rd #37", locality: "PTV GTFS", position: [-37.75031243, 144.98804183] },
  { name: "Oakover Rd/Gilbert Rd #38", locality: "PTV GTFS", position: [-37.74808317, 144.98837460] },
  { name: "Latona Ave/Gilbert Rd #39", locality: "PTV GTFS", position: [-37.74563926, 144.98880394] },
  { name: "Bell St/Gilbert Rd #40", locality: "PTV GTFS", position: [-37.74407502, 144.98902787] },
  { name: "Bruce St/Gilbert Rd #41", locality: "PTV GTFS", position: [-37.74131642, 144.98949972] },
  { name: "Cramer St/Gilbert Rd #42", locality: "PTV GTFS", position: [-37.73909615, 144.98983215] },
  { name: "Murray Rd/Gilbert Rd #43", locality: "PTV GTFS", position: [-37.73671452, 144.99021430] },
  { name: "Cooper St/Gilbert Rd #44", locality: "PTV GTFS", position: [-37.73454006, 144.99059083] },
  { name: "Jacka St/Gilbert Rd #45", locality: "PTV GTFS", position: [-37.73299440, 144.99084821] },
  { name: "McNamara St/Gilbert Rd #46", locality: "PTV GTFS", position: [-37.73005621, 144.99135880] },
  { name: "West Preston/Gilbert Rd #47", locality: "PTV GTFS", position: [-37.72918594, 144.99158656] },
];

const ROUTE_11_ROUTE_LINE: [number, number][] = ROUTE_11_DOCKLANDS_STOP_DATA.map((stop) => stop.position);

const ROUTE_11_DOCKLANDS_SURFACE_STOPS: SurfaceStop[] = ROUTE_11_DOCKLANDS_STOP_DATA.map((stop, index) => ({
  id: `route-11-docklands-${index + 1}`,
  name: stop.name,
  locality: stop.locality,
  position: stop.position,
  subtitle: "Route 11 tram stop",
  modes: ["tram"],
  routeLabel: "11",
  departures: ROUTE_11_DOCKLANDS_DEPARTURES,
}));

const ROUTE_11_WEST_PRESTON_SURFACE_STOPS: SurfaceStop[] = ROUTE_11_WEST_PRESTON_STOP_DATA.map((stop, index) => ({
  id: `route-11-west-preston-${index + 1}`,
  name: stop.name,
  locality: stop.locality,
  position: stop.position,
  subtitle: "Route 11 tram stop",
  modes: ["tram"],
  routeLabel: "11",
  departures: ROUTE_11_WEST_PRESTON_DEPARTURES,
}));

const ROUTE_67_CARNEGIE_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "67", destination: "Carnegie", departureLabel: "4 min", statusLabel: "Tram due", note: "Southbound" },
  { route: "67", destination: "Melbourne University", departureLabel: "11 min", statusLabel: "Scheduled", note: "Northbound" },
  { route: "67", destination: "Carnegie", departureLabel: "19 min", statusLabel: "Scheduled", note: "Via Glenhuntly Rd" },
];

const ROUTE_67_UNIVERSITY_DEPARTURES: SurfaceStopDeparture[] = [
  { route: "67", destination: "Melbourne University", departureLabel: "3 min", statusLabel: "Tram due", note: "Northbound" },
  { route: "67", destination: "Carnegie", departureLabel: "10 min", statusLabel: "Scheduled", note: "Southbound" },
  { route: "67", destination: "Melbourne University", departureLabel: "18 min", statusLabel: "Scheduled", note: "Via Swanston St" },
];

const ROUTE_67_CARNEGIE_STOP_DATA: Array<{ name: string; locality: string; position: [number, number] }> = [
  { name: "Melbourne University/Swanston St #1", locality: "PTV GTFS", position: [-37.79930548, 144.96419183] },
  { name: "Lincoln Square/Swanston St #3", locality: "PTV GTFS", position: [-37.80236978, 144.96368745] },
  { name: "Queensberry St/Swanston St #4", locality: "PTV GTFS", position: [-37.80569411, 144.96310774] },
  { name: "RMIT University/Swanston St #7", locality: "PTV GTFS", position: [-37.80813946, 144.96329043] },
  { name: "Melbourne Central Station/Swanston St #8", locality: "PTV GTFS", position: [-37.81038237, 144.96427381] },
  { name: "Bourke Street Mall/Swanston St #10", locality: "PTV GTFS", position: [-37.81319863, 144.96558229] },
  { name: "City Square/Swanston St #11", locality: "PTV GTFS", position: [-37.81637753, 144.96701723] },
  { name: "Federation Square/Swanston St #13", locality: "PTV GTFS", position: [-37.81847551, 144.96795936] },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "PTV GTFS", position: [-37.82184570, 144.96951422] },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "PTV GTFS", position: [-37.82474278, 144.97080951] },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "PTV GTFS", position: [-37.82879869, 144.97136874] },
  { name: "Anzac Station/St Kilda Rd #20", locality: "PTV GTFS", position: [-37.83366407, 144.97340570] },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "PTV GTFS", position: [-37.83595132, 144.97539977] },
  { name: "Arthur St/St Kilda Rd #23", locality: "PTV GTFS", position: [-37.83885520, 144.97657033] },
  { name: "Leopold St/St Kilda Rd #24", locality: "PTV GTFS", position: [-37.84115853, 144.97740511] },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "PTV GTFS", position: [-37.84452295, 144.97863142] },
  { name: "Moubray St/St Kilda Rd #26", locality: "PTV GTFS", position: [-37.84755154, 144.97971927] },
  { name: "High St/St Kilda Rd #27", locality: "PTV GTFS", position: [-37.84986386, 144.98055399] },
  { name: "Union St/St Kilda Rd #29", locality: "PTV GTFS", position: [-37.85300170, 144.98170720] },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "PTV GTFS", position: [-37.85529579, 144.98253116] },
  { name: "Barkly St/St Kilda Rd #31", locality: "PTV GTFS", position: [-37.85826072, 144.98358695] },
  { name: "Alma Rd/St Kilda Rd #32", locality: "PTV GTFS", position: [-37.86098010, 144.98451310] },
  { name: "Argyle St/St Kilda Rd #33", locality: "PTV GTFS", position: [-37.86208602, 144.98489218] },
  { name: "Inkerman St/St Kilda Rd #34", locality: "PTV GTFS", position: [-37.86511320, 144.98590098] },
  { name: "Carlisle St/St Kilda Rd #35", locality: "PTV GTFS", position: [-37.86754374, 144.98680105] },
  { name: "St Kilda Primary School/Brighton Rd #36", locality: "PTV GTFS", position: [-37.87005858, 144.98841507] },
  { name: "Chapel St/Brighton Rd #37", locality: "PTV GTFS", position: [-37.87177121, 144.98949396] },
  { name: "Brunning St/Brighton Rd #38", locality: "PTV GTFS", position: [-37.87280032, 144.99012535] },
  { name: "Glen Eira Rd/Brighton Rd #39", locality: "PTV GTFS", position: [-37.87663555, 144.99254505] },
  { name: "Scott St/Brighton Rd #40", locality: "PTV GTFS", position: [-37.87888580, 144.99397335] },
  { name: "Coleridge St/Brighton Rd #41", locality: "PTV GTFS", position: [-37.88079850, 144.99516076] },
  { name: "Hotham St/Brighton Rd #42", locality: "PTV GTFS", position: [-37.88295709, 144.99650074] },
  { name: "Brighton Rd/Glenhuntly Rd #43", locality: "PTV GTFS", position: [-37.88379999, 144.99784232] },
  { name: "Elsternwick Railway Station/Glenhuntly Rd #44", locality: "PTV GTFS", position: [-37.88414954, 145.00037979] },
  { name: "Elsternwick Shopping Centre/Glenhuntly Rd #45", locality: "PTV GTFS", position: [-37.88461334, 145.00381246] },
  { name: "Orrong Rd/Glenhuntly Rd #46", locality: "PTV GTFS", position: [-37.88486171, 145.00570461] },
  { name: "Shoobra Rd/Glenhuntly Rd #47", locality: "PTV GTFS", position: [-37.88527112, 145.00912745] },
  { name: "Parkside St/Glenhuntly Rd #48", locality: "PTV GTFS", position: [-37.88564862, 145.01226692] },
  { name: "Kooyong Rd/Glenhuntly Rd #49", locality: "PTV GTFS", position: [-37.88596297, 145.01487370] },
  { name: "Royal Pde/Glenhuntly Rd #50", locality: "PTV GTFS", position: [-37.88639071, 145.01833026] },
  { name: "Hawthorn Rd/Glenhuntly Rd #51", locality: "PTV GTFS", position: [-37.88680896, 145.02176438] },
  { name: "Jasmine St/Glenhuntly Rd #52", locality: "PTV GTFS", position: [-37.88710990, 145.02412145] },
  { name: "Glenhuntly Tram Depot/Glenhuntly Rd #53", locality: "PTV GTFS", position: [-37.88745140, 145.02675035] },
  { name: "Bambra Rd/Glenhuntly Rd #54", locality: "PTV GTFS", position: [-37.88767314, 145.02868885] },
  { name: "Fallon St/Glenhuntly Rd #55", locality: "PTV GTFS", position: [-37.88793069, 145.03061504] },
  { name: "Kambrook Rd/Glenhuntly Rd #56", locality: "PTV GTFS", position: [-37.88825137, 145.03308536] },
  { name: "Clarke Ave/Glenhuntly Rd #57", locality: "PTV GTFS", position: [-37.88850154, 145.03511412] },
  { name: "Booran Rd/Glenhuntly Rd #58", locality: "PTV GTFS", position: [-37.88879435, 145.03753974] },
  { name: "Glenhuntly Shops/Glenhuntly Rd #60", locality: "PTV GTFS", position: [-37.88913166, 145.04047590] },
  { name: "Glen Huntly Railway Station/Glen Huntly Rd  #61", locality: "PTV GTFS", position: [-37.88930730, 145.04182441] },
  { name: "Grange Rd/Glenhuntly Rd #62", locality: "PTV GTFS", position: [-37.88963266, 145.04459036] },
  { name: "Maroona Rd/Glenhuntly Rd #63", locality: "PTV GTFS", position: [-37.88993824, 145.04725452] },
  { name: "Mernda Ave/Glenhuntly Rd #64", locality: "PTV GTFS", position: [-37.89023661, 145.04948679] },
  { name: "Mimosa Rd/Glenhuntly Rd #65", locality: "PTV GTFS", position: [-37.89051748, 145.05175364] },
  { name: "Truganini Rd/Glenhuntly Rd #66", locality: "PTV GTFS", position: [-37.89078104, 145.05406646] },
  { name: "Centre Rd/Truganini Rd #67", locality: "PTV GTFS", position: [-37.89265356, 145.05449476] },
  { name: "Carnegie/Truganini Rd #68", locality: "PTV GTFS", position: [-37.89386477, 145.05580476] },
];

const ROUTE_67_UNIVERSITY_STOP_DATA: Array<{ name: string; locality: string; position: [number, number] }> = [
  { name: "Carnegie/Truganini Rd #68", locality: "PTV GTFS", position: [-37.89386477, 145.05580476] },
  { name: "Centre Rd/Truganini Rd #67", locality: "PTV GTFS", position: [-37.89269653, 145.05436854] },
  { name: "Glenhuntly Rd/Truganini Rd #66", locality: "PTV GTFS", position: [-37.89106911, 145.05404750] },
  { name: "Mimosa Rd/Glenhuntly Rd #65", locality: "PTV GTFS", position: [-37.89071398, 145.05219195] },
  { name: "Mernda Ave/Glenhuntly Rd #64", locality: "PTV GTFS", position: [-37.89040572, 145.04990306] },
  { name: "Maroona Rd/Glenhuntly Rd #63", locality: "PTV GTFS", position: [-37.89014321, 145.04765847] },
  { name: "Grange Rd/Glenhuntly Rd #62", locality: "PTV GTFS", position: [-37.88983839, 145.04503977] },
  { name: "Glen Huntly Railway Station/Glen Huntly Rd  #61", locality: "PTV GTFS", position: [-37.88954800, 145.04275047] },
  { name: "Glenhuntly Shops/Glenhuntly Rd #60", locality: "PTV GTFS", position: [-37.88930772, 145.04076688] },
  { name: "Booran Rd/Glenhuntly Rd #58", locality: "PTV GTFS", position: [-37.88896104, 145.03780822] },
  { name: "Laura St/Glenhuntly Rd #57", locality: "PTV GTFS", position: [-37.88866994, 145.03548488] },
  { name: "Kean St/Glenhuntly Rd #56", locality: "PTV GTFS", position: [-37.88841940, 145.03343339] },
  { name: "Fallon St/Glenhuntly Rd #55", locality: "PTV GTFS", position: [-37.88810811, 145.03098555] },
  { name: "Bambra Rd/Glenhuntly Rd #54", locality: "PTV GTFS", position: [-37.88783890, 145.02890048] },
  { name: "Glenhuntly Tram Depot/Glenhuntly Rd #53", locality: "PTV GTFS", position: [-37.88761063, 145.02710997] },
  { name: "Jasmine St/Glenhuntly Rd #52", locality: "PTV GTFS", position: [-37.88721838, 145.02414129] },
  { name: "Hawthorn Rd/Glenhuntly Rd #51", locality: "PTV GTFS", position: [-37.88698794, 145.02222579] },
  { name: "Royal Pde/Glenhuntly Rd #50", locality: "PTV GTFS", position: [-37.88649766, 145.01825917] },
  { name: "Kooyong Rd/Glenhuntly Rd #49", locality: "PTV GTFS", position: [-37.88610173, 145.01508602] },
  { name: "Parkside St/Glenhuntly Rd #48", locality: "PTV GTFS", position: [-37.88575632, 145.01224128] },
  { name: "Shoobra Rd/Glenhuntly Rd #47", locality: "PTV GTFS", position: [-37.88538803, 145.00911293] },
  { name: "Orrong Rd/Glenhuntly Rd #46", locality: "PTV GTFS", position: [-37.88505052, 145.00621119] },
  { name: "Elsternwick Shopping Centre/Glenhuntly Rd #45", locality: "PTV GTFS", position: [-37.88475077, 145.00394520] },
  { name: "Elsternwick Railway Station/Glenhuntly Rd #44", locality: "PTV GTFS", position: [-37.88430576, 145.00055749] },
  { name: "Brighton Rd/Glenhuntly Rd #43", locality: "PTV GTFS", position: [-37.88390364, 144.99757800] },
  { name: "Hotham St/Brighton Rd #42", locality: "PTV GTFS", position: [-37.88286431, 144.99634407] },
  { name: "Coleridge St/Brighton Rd #41", locality: "PTV GTFS", position: [-37.88084218, 144.99507998] },
  { name: "Scott St/Brighton Rd #40", locality: "PTV GTFS", position: [-37.87894750, 144.99389209] },
  { name: "Glen Eira Rd/Brighton Rd #39", locality: "PTV GTFS", position: [-37.87595969, 144.99201768] },
  { name: "Wimbledon Ave/Brighton Rd #38", locality: "PTV GTFS", position: [-37.87288061, 144.99007770] },
  { name: "St Kilda Primary School/Brighton Rd #36", locality: "PTV GTFS", position: [-37.87012046, 144.98834518] },
  { name: "Carlisle St/St Kilda Rd #35", locality: "PTV GTFS", position: [-37.86732465, 144.98663650] },
  { name: "Inkerman St/St Kilda Rd #34", locality: "PTV GTFS", position: [-37.86406917, 144.98545198] },
  { name: "Argyle St/St Kilda Rd #33", locality: "PTV GTFS", position: [-37.86248255, 144.98489274] },
  { name: "Alma Rd/St Kilda Rd #32", locality: "PTV GTFS", position: [-37.85994487, 144.98405254] },
  { name: "Barkly St/St Kilda Rd #31", locality: "PTV GTFS", position: [-37.85796839, 144.98335622] },
  { name: "St Kilda Junction/St Kilda Rd #30", locality: "PTV GTFS", position: [-37.85503126, 144.98234516] },
  { name: "Union St/St Kilda Rd #29", locality: "PTV GTFS", position: [-37.85248340, 144.98143720] },
  { name: "Lorne St/St Kilda Rd #27", locality: "PTV GTFS", position: [-37.84935476, 144.98029512] },
  { name: "Beatrice St/St Kilda Rd #26", locality: "PTV GTFS", position: [-37.84789461, 144.97975537] },
  { name: "Commercial Rd/St Kilda Rd #25", locality: "PTV GTFS", position: [-37.84401326, 144.97833851] },
  { name: "Leopold St/St Kilda Rd #24", locality: "PTV GTFS", position: [-37.84148319, 144.97741896] },
  { name: "Arthur St/St Kilda Rd #23", locality: "PTV GTFS", position: [-37.83929754, 144.97661506] },
  { name: "Toorak Rd/St Kilda Rd #22", locality: "PTV GTFS", position: [-37.83547648, 144.97503778] },
  { name: "Anzac Station/St Kilda Rd #20", locality: "PTV GTFS", position: [-37.83321372, 144.97237268] },
  { name: "Shrine of Remembrance/St Kilda Rd #19", locality: "PTV GTFS", position: [-37.82893146, 144.97122876] },
  { name: "Grant St-Police Memorial/St Kilda Rd #17", locality: "PTV GTFS", position: [-37.82427870, 144.97054956] },
  { name: "Arts Precinct/St Kilda Rd #14", locality: "PTV GTFS", position: [-37.82151653, 144.96923923] },
  { name: "Federation Square/Swanston St #13", locality: "PTV GTFS", position: [-37.81806508, 144.96767526] },
  { name: "City Square/Swanston St #11", locality: "PTV GTFS", position: [-37.81572996, 144.96656925] },
  { name: "Bourke Street Mall/Swanston St #10", locality: "PTV GTFS", position: [-37.81275921, 144.96518542] },
  { name: "Melbourne Central Station/Swanston St #8", locality: "PTV GTFS", position: [-37.80988909, 144.96388980] },
  { name: "RMIT University/Swanston St #7", locality: "PTV GTFS", position: [-37.80779872, 144.96286817] },
  { name: "Queensberry St/Swanston St #4", locality: "PTV GTFS", position: [-37.80513545, 144.96311173] },
  { name: "Lincoln Square/Swanston St #3", locality: "PTV GTFS", position: [-37.80262884, 144.96355540] },
  { name: "Melbourne University/Swanston St #1", locality: "PTV GTFS", position: [-37.79876562, 144.96424072] },
];

const ROUTE_67_ROUTE_LINE: [number, number][] = ROUTE_67_CARNEGIE_STOP_DATA.map((stop) => stop.position);

const ROUTE_67_CARNEGIE_SURFACE_STOPS: SurfaceStop[] = ROUTE_67_CARNEGIE_STOP_DATA.map((stop, index) => ({
  id: `route-67-carnegie-${index + 1}`,
  name: stop.name,
  locality: stop.locality,
  position: stop.position,
  subtitle: "Route 67 tram stop",
  modes: ["tram"],
  routeLabel: "67",
  departures: ROUTE_67_CARNEGIE_DEPARTURES,
}));

const ROUTE_67_UNIVERSITY_SURFACE_STOPS: SurfaceStop[] = ROUTE_67_UNIVERSITY_STOP_DATA.map((stop, index) => ({
  id: `route-67-university-${index + 1}`,
  name: stop.name,
  locality: stop.locality,
  position: stop.position,
  subtitle: "Route 67 tram stop",
  modes: ["tram"],
  routeLabel: "67",
  departures: ROUTE_67_UNIVERSITY_DEPARTURES,
}));

const GENERATED_TRAM_SURFACE_STOPS: SurfaceStop[] = GENERATED_TRAM_ROUTE_BUNDLES.flatMap((bundle) => {
  const forwardDepartures: SurfaceStopDeparture[] = [
    {
      route: bundle.routeLabel,
      destination: bundle.forwardDestination,
      departureLabel: "4 min",
      statusLabel: "Tram due",
      note: "Live route",
    },
    {
      route: bundle.routeLabel,
      destination: bundle.reverseDestination,
      departureLabel: "11 min",
      statusLabel: "Scheduled",
      note: "Return service",
    },
    {
      route: bundle.routeLabel,
      destination: bundle.forwardDestination,
      departureLabel: "19 min",
      statusLabel: "Scheduled",
      note: bundle.longName,
    },
  ];

  const reverseDepartures: SurfaceStopDeparture[] = [
    {
      route: bundle.routeLabel,
      destination: bundle.reverseDestination,
      departureLabel: "3 min",
      statusLabel: "Tram due",
      note: "Live route",
    },
    {
      route: bundle.routeLabel,
      destination: bundle.forwardDestination,
      departureLabel: "9 min",
      statusLabel: "Scheduled",
      note: "Outbound service",
    },
    {
      route: bundle.routeLabel,
      destination: bundle.reverseDestination,
      departureLabel: "17 min",
      statusLabel: "Scheduled",
      note: bundle.longName,
    },
  ];

  return [
    ...bundle.forwardStops.map((stop, index) => ({
      id: `generated-tram-${bundle.routeLabel}-forward-${index + 1}`,
      name: stop.name,
      locality: stop.locality,
      position: stop.position,
      subtitle: `Route ${bundle.routeLabel} tram stop`,
      modes: ["tram"] as TransportMode[],
      routeLabel: bundle.routeLabel,
      departures: forwardDepartures,
    })),
    ...bundle.reverseStops.map((stop, index) => ({
      id: `generated-tram-${bundle.routeLabel}-reverse-${index + 1}`,
      name: stop.name,
      locality: stop.locality,
      position: stop.position,
      subtitle: `Route ${bundle.routeLabel} tram stop`,
      modes: ["tram"] as TransportMode[],
      routeLabel: bundle.routeLabel,
      departures: reverseDepartures,
    })),
  ];
});

// Real per-bay GTFS stops (stop_id + exact coordinates + platform_code) for
// multi-bay bus interchanges. Each bay is its own official stop in the static
// schedule, sharing only the interchange's stop_name — deliberately kept as
// separate entries here (never merged by name or proximity) so each bay gets
// its own marker, its own PTV stop match, and its own boarding point in the
// journey planner. `routeLabel: ""` means "serves multiple routes"; backend
// departure lookups already treat an empty route filter as "every route at
// this stop" (see getVerifiedSurfaceStopDepartures).
function buildInterchangeBay(
  gtfsStopId: string,
  interchangeName: string,
  bayNumber: number | string,
  position: [number, number],
): SurfaceStop {
  return {
    id: gtfsStopId,
    name: `${interchangeName} – Bus Bay ${bayNumber}`,
    locality: interchangeName,
    position,
    subtitle: `Bus interchange · Bay ${bayNumber}`,
    modes: ["bus"],
    routeLabel: "",
    departures: [],
  };
}

const CHADSTONE_INTERCHANGE_BAYS: SurfaceStop[] = [
  buildInterchangeBay("47923", "Chadstone Shopping Centre", 1, [-37.88774681, 145.08333558]),
  buildInterchangeBay("47924", "Chadstone Shopping Centre", 2, [-37.88781264, 145.08350444]),
  buildInterchangeBay("47925", "Chadstone Shopping Centre", 3, [-37.88796578, 145.08350047]),
  buildInterchangeBay("47926", "Chadstone Shopping Centre", 4, [-37.88813674, 145.08348466]),
  buildInterchangeBay("47927", "Chadstone Shopping Centre", 5, [-37.88813897, 145.08362106]),
  buildInterchangeBay("47928", "Chadstone Shopping Centre", 6, [-37.88798583, 145.08362503]),
  buildInterchangeBay("47930", "Chadstone Shopping Centre", 7, [-37.88782406, 145.08365196]),
  buildInterchangeBay("47929", "Chadstone Shopping Centre", 8, [-37.88760842, 145.08369167]),
  buildInterchangeBay("47931", "Chadstone Shopping Centre", 9, [-37.88787243, 145.08385539]),
  buildInterchangeBay("47932", "Chadstone Shopping Centre", 10, [-37.88815994, 145.08380245]),
];

const BOX_HILL_INTERCHANGE_BAYS: SurfaceStop[] = [
  buildInterchangeBay("19651", "Box Hill", 1, [-37.81936982, 145.12224314]),
  buildInterchangeBay("19650", "Box Hill", 2, [-37.81953143, 145.12220496]),
  buildInterchangeBay("19649", "Box Hill", 3, [-37.81969303, 145.12216678]),
  buildInterchangeBay("19648", "Box Hill", 4, [-37.81982780, 145.12214065]),
  buildInterchangeBay("19647", "Box Hill", 5, [-37.81996238, 145.12210315]),
  buildInterchangeBay("19646", "Box Hill", 6, [-37.82003698, 145.12226031]),
  buildInterchangeBay("19645", "Box Hill", 7, [-37.82006600, 145.12238454]),
  buildInterchangeBay("19644", "Box Hill", 8, [-37.81992331, 145.12247904]),
  buildInterchangeBay("19643", "Box Hill", 9, [-37.81977954, 145.12250541]),
  buildInterchangeBay("19642", "Box Hill", 10, [-37.81962676, 145.12253200]),
  buildInterchangeBay("19641", "Box Hill", 11, [-37.81948335, 145.12258108]),
  buildInterchangeBay("19640", "Box Hill", 12, [-37.81926552, 145.12248435]),
  buildInterchangeBay("19639", "Box Hill", 13, [-37.81924497, 145.12232582]),
];

const HUNTINGDALE_INTERCHANGE_BAYS: SurfaceStop[] = [
  buildInterchangeBay("51586", "Huntingdale Station", "A", [-37.91119986, 145.10306485]),
  buildInterchangeBay("51587", "Huntingdale Station", "B", [-37.91094030, 145.10261654]),
  buildInterchangeBay("51588", "Huntingdale Station", "C", [-37.91086528, 145.10299383]),
  buildInterchangeBay("51589", "Huntingdale Station", "D", [-37.91098422, 145.10310452]),
  buildInterchangeBay("51590", "Huntingdale Station", "E", [-37.91115794, 145.10325930]),
];

const BERWICK_INTERCHANGE_BAYS: SurfaceStop[] = [
  buildInterchangeBay("28341", "Berwick Station", "A", [-38.03908048, 145.34422907]),
  buildInterchangeBay("28342", "Berwick Station", "B", [-38.03944502, 145.34451712]),
  buildInterchangeBay("28343", "Berwick Station", "C", [-38.03959994, 145.34463898]),
  buildInterchangeBay("28344", "Berwick Station", "D", [-38.03976386, 145.34476063]),
  buildInterchangeBay("28345", "Berwick Station", "E", [-38.03965835, 145.34430721]),
  buildInterchangeBay("28346", "Berwick Station", "F", [-38.03944905, 145.34416379]),
  buildInterchangeBay("28347", "Berwick Station", "G", [-38.03911202, 145.3439093]),
  buildInterchangeBay("28348", "Berwick Station", "H", [-38.03895694, 145.34377606]),
];

const BUS_INTERCHANGE_BAYS: SurfaceStop[] = [
  ...CHADSTONE_INTERCHANGE_BAYS,
  ...BOX_HILL_INTERCHANGE_BAYS,
  ...HUNTINGDALE_INTERCHANGE_BAYS,
  ...BERWICK_INTERCHANGE_BAYS,
];

// Routes 1, 3, 5, 6, 16, 64 and 96 used to be listed here from
// *_SURFACE_STOPS arrays built by interpolateStopsAlongPolyline — evenly
// spaced guesses along the track polyline, not real stop positions. They now
// come from GENERATED_TRAM_ROUTE_BUNDLES (real GTFS stop_lat/stop_lon), so
// the guessed versions were removed rather than left in as duplicates.
const ANYTRIP_SURFACE_STOPS: SurfaceStop[] = [
  ...ROUTE_630_SURFACE_STOPS,
  ...ROUTE_630_MONASH_SURFACE_STOPS,
  ...ROUTE_11_DOCKLANDS_SURFACE_STOPS,
  ...ROUTE_11_WEST_PRESTON_SURFACE_STOPS,
  ...ROUTE_67_CARNEGIE_SURFACE_STOPS,
  ...ROUTE_67_UNIVERSITY_SURFACE_STOPS,
  ...GENERATED_TRAM_SURFACE_STOPS,
];

// Every real bus stop in Victoria (22,578, from the official GTFS
// stops.txt) — not route-specific like ANYTRIP_SURFACE_STOPS above, so
// routeLabel/departures are left blank; opening one still hands the real
// stop_id/name/position to the same surface-stop detail flow every other
// bus stop marker on this map already uses. Rendered only above
// allowDenseSurfaceStops zoom (see its render call). Loaded via dynamic
// import (see useAllBusStops below), not a static import — the raw data is
// ~880KB and most sessions never zoom in far enough to need it at all.
//
// ROUTE_630_/ROUTE_11_/ROUTE_67_*_SURFACE_STOPS above cover the same real
// physical stops with their own synthetic ids, so without this dedup the
// two layers would draw a second, overlapping circle on every stop those
// three curated routes already show.
const CURATED_BUS_STOP_POSITION_KEYS = new Set(
  ANYTRIP_SURFACE_STOPS.filter((stop) => stop.modes.includes("bus")).map(
    (stop) => `${stop.position[0].toFixed(5)},${stop.position[1].toFixed(5)}`,
  ),
);

// A handful of real stops in PTV's official GTFS feed publish their raw
// stop_id as the stop_name too (a genuine data-quality gap in the source
// data, not something derived/guessed here) — verified real names below,
// confirmed against the actual signage at the stop rather than inferred.
const KNOWN_BUS_STOP_NAME_OVERRIDES: Record<string, { name: string; locality: string }> = {
  "45960": { name: "Hawthorn Rd/North Rd", locality: "Brighton East" },
};

function buildAllBusStopsAsSurfaceStops(stops: GeneratedBusStop[]): SurfaceStop[] {
  return stops
    .filter(([, , lat, lng]) => !CURATED_BUS_STOP_POSITION_KEYS.has(`${lat.toFixed(5)},${lng.toFixed(5)}`))
    .map(([id, name, lat, lng]) => {
      const override = KNOWN_BUS_STOP_NAME_OVERRIDES[id];
      return {
        id,
        name: override?.name ?? name,
        locality: override?.locality ?? "",
        position: [lat, lng] as [number, number],
        subtitle: "Bus stop",
        modes: ["bus"] as TransportMode[],
        routeLabel: "",
        departures: [],
      };
    });
}

// Loads the full real bus-stop dataset the first time it's actually needed
// (the caller only passes shouldLoad=true once the map is zoomed in past
// allowDenseSurfaceStops) rather than on every page load.
function useAllBusStops(shouldLoad: boolean): SurfaceStop[] {
  const [stops, setStops] = useState<SurfaceStop[]>([]);
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (!shouldLoad || hasLoaded.current) return;
    hasLoaded.current = true;
    import("@/lib/generated-bus-stops")
      .then(({ GENERATED_ALL_BUS_STOPS }) => {
        setStops(buildAllBusStopsAsSurfaceStops(GENERATED_ALL_BUS_STOPS));
      })
      .catch((error) => {
        // A chunk that fails to load (e.g. right after a deploy) used to leave
        // bus stops empty for the whole session; allow the next render to retry.
        console.warn("[map] Bus stops failed to load", error);
        hasLoaded.current = false;
      });
  }, [shouldLoad]);
  return stops;
}

function getNearestKnownBusStop(bus: LiveBus) {
  // A bus sitting at one of these named bays is a far more precise signal
  // than the generic same-route nearest-stop match below — the bays sit only
  // metres apart, so check them first (any route — the whole point of an
  // interchange is that many different routes share it) with a tight radius
  // before falling back to the looser route-matched search.
  let nearestBay: { stop: SurfaceStop; distanceMetres: number } | null = null;
  for (const stop of BUS_INTERCHANGE_BAYS) {
    const distanceMetres = getDistanceInMetres([bus.lat, bus.lng], stop.position);
    if (!nearestBay || distanceMetres < nearestBay.distanceMetres) {
      nearestBay = { stop, distanceMetres };
    }
  }
  if (nearestBay && nearestBay.distanceMetres <= 60) return nearestBay;

  let nearest: { stop: SurfaceStop; distanceMetres: number } | null = null;

  for (const stop of ANYTRIP_SURFACE_STOPS) {
    if (!stop.modes.includes("bus") || stop.routeLabel !== bus.route) continue;
    const distanceMetres = getDistanceInMetres([bus.lat, bus.lng], stop.position);
    if (!nearest || distanceMetres < nearest.distanceMetres) {
      nearest = { stop, distanceMetres };
    }
  }

  return nearest && nearest.distanceMetres <= 1200 ? nearest : null;
}

function getLiveBusAreaLabel(bus: LiveBus) {
  const publishedDestination = bus.destination
    ?.replace(/\s+(?:Bus Interchange|Shopping Centre|SC|Station)$/i, "")
    .replace(/\s+via\s+.+$/i, "")
    .trim();
  if (publishedDestination && !/^(bus|unknown)$/i.test(publishedDestination)) {
    return publishedDestination.slice(0, 24);
  }

  const nearestStop = getNearestKnownBusStop(bus)?.stop;
  if (nearestStop?.locality) return nearestStop.locality.slice(0, 24);

  // The nearest train station within 5km is just physical proximity, not
  // this bus's route or destination — a bus on route 923 near Sandringham
  // station has nothing to do with the Sandringham line. Shown bare
  // ("Sandringham · 923") this reads exactly like real route info instead
  // of a location guess, so it needs the same explicit "proximity, not
  // fact" framing already used for nearest-stop estimates elsewhere.
  const nearestStation = ALL_STATIONS.reduce<{ station: Station; distanceMetres: number } | null>((best, station) => {
    const distanceMetres = getDistanceInMetres([bus.lat, bus.lng], station.position);
    return !best || distanceMetres < best.distanceMetres ? { station, distanceMetres } : best;
  }, null);
  if (nearestStation && nearestStation.distanceMetres <= 5000) {
    return `Near ${nearestStation.station.name.replace(/\s+Station$/i, "")}`.slice(0, 24);
  }

  return "Melbourne";
}

function getLiveBusStopLabel(bus: LiveBus) {
  if (bus.stopId) {
    const prefix =
      bus.stopStatus === "stopped"
        ? "At PTV stop"
        : bus.stopStatus === "incoming"
          ? "Approaching PTV stop"
          : "PTV stop";
    return `${prefix} ${bus.stopId}`;
  }

  const nearest = getNearestKnownBusStop(bus);
  if (nearest) {
    return `Nearest mapped stop: ${nearest.stop.name} (${Math.round(nearest.distanceMetres)} m away)`;
  }

  return null;
}

function getPrimarySurfaceDestination(stop: SurfaceStop) {
  return stop.departures[0]?.destination?.trim() ?? "";
}

function getOrderedSurfaceRouteStops(referenceStop: SurfaceStop) {
  const primaryDestination = getPrimarySurfaceDestination(referenceStop);

  return ANYTRIP_SURFACE_STOPS.filter((stop) => {
    if (stop.routeLabel !== referenceStop.routeLabel) {
      return false;
    }

    if (!stop.modes.some((mode) => referenceStop.modes.includes(mode))) {
      return false;
    }

    return getPrimarySurfaceDestination(stop) === primaryDestination;
  });
}

export const LINES = {
  mernda: MERNDA_STATIONS,
  hurstbridge: HURSTBRIDGE_STATIONS,
  cliftonHillLoop: CLIFTONHILLGROUPLOOP_STATIONS,
  frankston: FRANKSTON_STATIONS,
  stonyPoint: STONY_POINT_STATIONS,
  cranbourne: CRANBOURNE_STATIONS,
  pakenham: PAKENHAM_STATIONS,
  sunbury: SUNBURY_STATIONS,
  craigieburn: CRAIGIEBURN_STATIONS,
  upfield: UPFIELD_STATIONS,
  lilydale: LILYDALE_STATIONS,
  belgrave: BELGRAVE_STATIONS,
  alamein: ALAMEIN_STATIONS,
  glenWaverley: GLEN_WAVERLEY_STATIONS,
  metroTunnel: METRO_TUNNEL_STATIONS,
  sandringham: SANDRINGHAM_STATIONS,
  werribee: WERRIBEE_STATIONS,
  williamstown: WILLIAMSTOWN_STATIONS,
  altonaLoop: ALTONA_LOOP_STATIONS,
  gippsland: GIPPSLAND_STATIONS,
};

type TramPatternStop = {
  name: string;
  position?: [number, number];
  platform?: string;
  stopCode?: string;
  expectedAt?: string;
  status?: "passed" | "upcoming" | "skipped";
};

function getMetroStoppingPatternStations(vehicle: LiveTrain, fullRoute = false): Station[] {
  const searchable = `${vehicle.line} ${vehicle.destination}`.toLowerCase();
  const lineKey = (
    [
      ["sandringham", "sandringham"], ["stony point", "stonyPoint"], ["frankston", "frankston"], ["cranbourne", "cranbourne"],
      ["pakenham", "pakenham"], ["sunbury", "sunbury"], ["craigieburn", "craigieburn"],
      ["upfield", "upfield"], ["mernda", "mernda"], ["hurstbridge", "hurstbridge"],
      ["lilydale", "lilydale"], ["belgrave", "belgrave"], ["alamein", "alamein"],
      ["glen waverley", "glenWaverley"], ["werribee", "werribee"],
      ["williamstown", "williamstown"], ["metro tunnel", "metroTunnel"],
    ] as const
  ).find(([label]) => searchable.includes(label))?.[1];

  if (!lineKey) return [];

  let stations = Array.from(
    new globalThis.Map(LINES[lineKey].map((station) => [station.name, station])).values(),
  );
  if (fullRoute) return stations;
  const destinationIndex = stations.findIndex(
    (station) => station.name.toLowerCase() === vehicle.destination.trim().toLowerCase(),
  );

  if (destinationIndex === 0) {
    stations = [...stations].reverse();
  } else if (destinationIndex > 0 && destinationIndex < stations.length - 1) {
    stations = stations.slice(0, destinationIndex + 1);
  }

  return stations;
}

const PLATFORM_PRESET_PRIORITY = [
  "metroTunnel",
  "frankston",
  "sandringham",
  "werribee",
  "williamstown",
  "mernda",
  "hurstbridge",
  "sunbury",
  "cranbourne",
  "pakenham",
  "craigieburn",
  "upfield",
  "belgrave",
  "lilydale",
  "glenWaverley",
  "alamein",
  "altonaLoop",
] as const;

type PlatformBoardEntry = {
  platform: string;
  label: string;
  tone: string;
  layoutClass?: string;
  services: Array<{
    destination: string;
    etaLabel: string;
    tdnLabel: string;
    statusLabel?: string;
    originLabel?: string;
    viaLabel?: string;
  }>;
  emptyState?: string;
};

type DepartureBoardColumn = {
  title: string;
  accent: string;
  platform: string;
  scheduledTime: string;
  departingTime: string;
  status: string;
  via: string;
  stops: string[];
};

type SouthernCrossAccessAlert = {
  title: string;
  summary: string;
  affectedPlatforms: string[];
  groups: string[];
  tone: string;
};

type FreightMovement = {
  operator: string;
  serviceId: string;
  movement: string;
  timeLabel: string;
  lineLabel: string;
  statusLabel: string;
  note?: string;
};

const SOUTH_YARRA_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · Flinders Street / Newport",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Flinders Street", etaLabel: "13:53", tdnLabel: "TDN X086", statusLabel: "1m late" },
      { destination: "Flinders Street → Newport", etaLabel: "14:23", tdnLabel: "TDN X090 → 6265", statusLabel: "On Time" },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Sandringham",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Sandringham", etaLabel: "13:43", tdnLabel: "TDN X081", statusLabel: "1m late" },
      { destination: "Sandringham", etaLabel: "13:58", tdnLabel: "TDN X083", statusLabel: "On Time" },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 · City Loop",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      { destination: "City Loop", etaLabel: "13:45", tdnLabel: "TDN 4902", statusLabel: "On Time" },
      { destination: "City Loop", etaLabel: "13:55", tdnLabel: "TDN 4904", statusLabel: "2m late" },
    ],
  },
  {
    platform: "4",
    label: "Platform 4 · Frankston",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      { destination: "Frankston", etaLabel: "13:43", tdnLabel: "TDN 4413", statusLabel: "On Time" },
      { destination: "Frankston", etaLabel: "13:53", tdnLabel: "TDN 4415", statusLabel: "On Time" },
    ],
  },
];

const RICHMOND_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 - Flinders Street / Newport",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Flinders Street", etaLabel: "13:56", tdnLabel: "TDN X086", statusLabel: "1m late" },
      { destination: "Flinders Street", etaLabel: "14:11", tdnLabel: "TDN X088", statusLabel: "2m late" },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 - Sandringham",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Sandringham", etaLabel: "13:55", tdnLabel: "TDN X083", statusLabel: "On Time" },
      { destination: "Sandringham", etaLabel: "14:10", tdnLabel: "TDN X085", statusLabel: "On Time" },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 - City Loop",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      { destination: "City Loop", etaLabel: "13:58", tdnLabel: "TDN 4904", statusLabel: "1m late" },
      { destination: "City Loop", etaLabel: "14:08", tdnLabel: "TDN 4906", statusLabel: "On Time" },
    ],
  },
  {
    platform: "4",
    label: "Platform 4 - Frankston",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      { destination: "Frankston", etaLabel: "13:50", tdnLabel: "TDN 4415", statusLabel: "On Time" },
      { destination: "Frankston", etaLabel: "14:00", tdnLabel: "TDN 4417", statusLabel: "On Time" },
    ],
  },
  {
    platform: "5",
    label: "Platform 5 - Southern Cross",
    tone: "bg-violet-500/12 border-violet-400/20 text-violet-100",
    services: [
      { destination: "Southern Cross", etaLabel: "14:02", tdnLabel: "TDN 8428", statusLabel: "1m late" },
      { destination: "Southern Cross", etaLabel: "14:42", tdnLabel: "TDN 8430", statusLabel: "On Time" },
    ],
  },
  {
    platform: "6",
    label: "Platform 6 - Traralgon",
    tone: "bg-violet-500/12 border-violet-400/20 text-violet-100",
    services: [
      { destination: "Traralgon", etaLabel: "13:58", tdnLabel: "TDN 8427", statusLabel: "Scheduled" },
      { destination: "Traralgon", etaLabel: "14:38", tdnLabel: "TDN 8429", statusLabel: "Scheduled" },
    ],
  },
  {
    platform: "7",
    label: "Platform 7 - Flinders Street",
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
    services: [
      { destination: "Flinders Street", etaLabel: "14:03", tdnLabel: "TDN 2080", statusLabel: "On Time" },
      { destination: "Flinders Street", etaLabel: "14:17", tdnLabel: "TDN 3004", statusLabel: "4m late" },
    ],
  },
  {
    platform: "8",
    label: "Platform 8 - Flinders Street",
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
    services: [
      { destination: "Flinders Street", etaLabel: "14:02", tdnLabel: "TDN 3204", statusLabel: "2m late" },
      { destination: "Flinders Street", etaLabel: "14:18", tdnLabel: "TDN 2082", statusLabel: "On Time" },
    ],
  },
  {
    platform: "9",
    label: "Platform 9 - Burnley group",
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
    services: [
      { destination: "Glen Waverley", etaLabel: "13:51", tdnLabel: "TDN 2605", statusLabel: "3m late" },
      { destination: "Belgrave", etaLabel: "13:53", tdnLabel: "TDN 3603", statusLabel: "4m late" },
    ],
  },
  {
    platform: "10",
    label: "Platform 10 - Burnley group",
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
    services: [
      { destination: "Glen Waverley", etaLabel: "15:21", tdnLabel: "TDN 2081", statusLabel: "1m late" },
      { destination: "Blackburn", etaLabel: "15:50", tdnLabel: "TDN 3905", statusLabel: "3m late" },
    ],
  },
];

const FOOTSCRAY_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · Metro Tunnel eastbound",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      { destination: "Town Hall → East Pakenham", etaLabel: "14:42", tdnLabel: "TDN Z074 → C071", statusLabel: "On Time", originLabel: "Origin Footscray", viaLabel: "Metro Tunnel" },
      { destination: "Town Hall → Cranbourne", etaLabel: "14:52", tdnLabel: "TDN Z458 → C471", statusLabel: "On Time", originLabel: "Origin Footscray", viaLabel: "Metro Tunnel" },
      { destination: "Town Hall → East Pakenham", etaLabel: "15:02", tdnLabel: "TDN Z076 → C073", statusLabel: "On Time", originLabel: "Origin Footscray", viaLabel: "Metro Tunnel" },
      { destination: "Town Hall → Cranbourne", etaLabel: "15:12", tdnLabel: "TDN Z460 → C473", statusLabel: "On Time", originLabel: "Origin Footscray", viaLabel: "Metro Tunnel" },
      { destination: "Town Hall → East Pakenham", etaLabel: "15:22", tdnLabel: "TDN Z078 → C075", statusLabel: "On Time", originLabel: "Origin Footscray", viaLabel: "Metro Tunnel" },
      { destination: "Town Hall → Cranbourne", etaLabel: "15:32", tdnLabel: "TDN Z462 → C475", statusLabel: "1m late", originLabel: "Origin Footscray", viaLabel: "Metro Tunnel" },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Sunbury / Watergardens",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      { destination: "Sunbury", etaLabel: "14:46", tdnLabel: "TDN Z069", statusLabel: "On Time", originLabel: "Origin Town Hall", viaLabel: "Metro Tunnel" },
      { destination: "Watergardens", etaLabel: "14:56", tdnLabel: "TDN Z467", statusLabel: "On Time", originLabel: "Origin Town Hall", viaLabel: "Metro Tunnel" },
      { destination: "Sunbury", etaLabel: "15:06", tdnLabel: "TDN Z071", statusLabel: "On Time", originLabel: "Origin Town Hall", viaLabel: "Metro Tunnel" },
      { destination: "Watergardens", etaLabel: "15:16", tdnLabel: "TDN Z469", statusLabel: "On Time", originLabel: "Origin Town Hall", viaLabel: "Metro Tunnel" },
      { destination: "Sunbury", etaLabel: "15:26", tdnLabel: "TDN Z073", statusLabel: "On Time", originLabel: "Origin Town Hall", viaLabel: "Metro Tunnel" },
      { destination: "Watergardens", etaLabel: "15:36", tdnLabel: "TDN Z471", statusLabel: "On Time", originLabel: "Origin Town Hall", viaLabel: "Metro Tunnel" },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 · Southern Cross / regional",
    tone: "bg-violet-500/12 border-violet-400/20 text-violet-100",
    services: [
      { destination: "Southern Cross", etaLabel: "14:42", tdnLabel: "TDN 8134", statusLabel: "On Time", originLabel: "Regional shuttle", viaLabel: "Westbound arrival" },
      { destination: "Southern Cross", etaLabel: "14:50", tdnLabel: "TDN 8772", statusLabel: "2m early", originLabel: "Regional shuttle", viaLabel: "Westbound arrival" },
      { destination: "Southern Cross", etaLabel: "15:10", tdnLabel: "TDN 8774", statusLabel: "1m early", originLabel: "Regional shuttle", viaLabel: "Westbound arrival" },
      { destination: "Southern Cross", etaLabel: "15:19", tdnLabel: "TDN 8074", statusLabel: "On Time", originLabel: "Regional shuttle", viaLabel: "Westbound arrival" },
      { destination: "Southern Cross", etaLabel: "15:22", tdnLabel: "TDN 8136", statusLabel: "1m late", originLabel: "Regional shuttle", viaLabel: "Westbound arrival" },
      { destination: "Southern Cross", etaLabel: "15:30", tdnLabel: "TDN 8776", statusLabel: "On Time", originLabel: "Regional shuttle", viaLabel: "Westbound arrival" },
    ],
  },
  {
    platform: "4",
    label: "Platform 4 · Geelong / Ballarat / Bendigo",
    tone: "bg-violet-500/12 border-violet-400/20 text-violet-100",
    services: [
      { destination: "Waurn Ponds", etaLabel: "14:38", tdnLabel: "TDN 8759", statusLabel: "1m late", originLabel: "Origin Southern Cross", viaLabel: "Regional" },
      { destination: "Wendouree", etaLabel: "14:43", tdnLabel: "TDN 8129", statusLabel: "2m late", originLabel: "Origin Southern Cross", viaLabel: "Regional" },
      { destination: "Waurn Ponds", etaLabel: "14:58", tdnLabel: "TDN 8761", statusLabel: "1m late", originLabel: "Origin Southern Cross", viaLabel: "Regional" },
      { destination: "Bendigo", etaLabel: "15:10", tdnLabel: "TDN 8027", statusLabel: "1m late", originLabel: "Origin Southern Cross", viaLabel: "Regional" },
      { destination: "Waurn Ponds", etaLabel: "15:18", tdnLabel: "TDN 8763", statusLabel: "1m late", originLabel: "Origin Southern Cross", viaLabel: "Regional" },
      { destination: "Wendouree", etaLabel: "15:23", tdnLabel: "TDN 8131", statusLabel: "2m late", originLabel: "Origin Southern Cross", viaLabel: "Regional" },
    ],
  },
  {
    platform: "5",
    label: "Platform 5 · Flinders Street",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Flinders Street", etaLabel: "14:45", tdnLabel: "TDN 6320", statusLabel: "4m late", originLabel: "Origin Williamstown", viaLabel: "City bound" },
      { destination: "Flinders Street", etaLabel: "14:55", tdnLabel: "TDN 6456", statusLabel: "2m late", originLabel: "Origin Werribee", viaLabel: "City bound" },
      { destination: "Flinders Street", etaLabel: "15:05", tdnLabel: "TDN 6322", statusLabel: "3m late", originLabel: "Origin Williamstown", viaLabel: "City bound" },
      { destination: "Flinders Street", etaLabel: "15:15", tdnLabel: "TDN 6458", statusLabel: "2m late", originLabel: "Origin Werribee", viaLabel: "City bound" },
      { destination: "Flinders Street", etaLabel: "15:25", tdnLabel: "TDN 6324", statusLabel: "On Time", originLabel: "Origin Williamstown", viaLabel: "City bound" },
      { destination: "Flinders Street", etaLabel: "15:35", tdnLabel: "TDN 6460", statusLabel: "1m late", originLabel: "Origin Werribee", viaLabel: "City bound" },
    ],
  },
  {
    platform: "6",
    label: "Platform 6 · Werribee / Williamstown",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Williamstown", etaLabel: "14:43", tdnLabel: "TDN 6325", statusLabel: "On Time", originLabel: "Origin Flinders Street", viaLabel: "Werribee corridor" },
      { destination: "Werribee", etaLabel: "14:53", tdnLabel: "TDN 6457", statusLabel: "On Time", originLabel: "Origin Flinders Street", viaLabel: "Werribee corridor" },
      { destination: "Williamstown", etaLabel: "15:03", tdnLabel: "TDN 6327", statusLabel: "On Time", originLabel: "Origin Flinders Street", viaLabel: "Werribee corridor" },
      { destination: "Werribee", etaLabel: "15:13", tdnLabel: "TDN 6459", statusLabel: "3m late", originLabel: "Origin Flinders Street", viaLabel: "Werribee corridor" },
      { destination: "Williamstown", etaLabel: "15:23", tdnLabel: "TDN 6329", statusLabel: "On Time", originLabel: "Origin Flinders Street", viaLabel: "Werribee corridor" },
      { destination: "Werribee", etaLabel: "15:33", tdnLabel: "TDN 6461", statusLabel: "On Time", originLabel: "Origin Flinders Street", viaLabel: "Werribee corridor" },
    ],
  },
];

const MALVERN_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · City Loop / Metro Tunnel",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      {
        destination: "City Loop",
        etaLabel: "10:06",
        tdnLabel: "TDN Z458 → C471",
        statusLabel: "On Time",
        originLabel: "Origin Frankston",
        viaLabel: "Via Flinders Street",
      },
      {
        destination: "Flinders Street",
        etaLabel: "10:15",
        tdnLabel: "TDN 4858 → 4375",
        statusLabel: "3m late",
        originLabel: "Origin Frankston",
        viaLabel: "Frankston line",
      },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Frankston",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      {
        destination: "Frankston",
        etaLabel: "10:24",
        tdnLabel: "TDN 4860 → 4377",
        statusLabel: "8m late",
        originLabel: "Origin City Loop",
        viaLabel: "Stops all stations",
      },
      {
        destination: "Mordialloc",
        etaLabel: "10:33",
        tdnLabel: "TDN 4862 → 4379",
        statusLabel: "1m late",
        originLabel: "Origin Flinders Street",
        viaLabel: "Frankston line",
      },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 · Cranbourne / Pakenham",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      {
        destination: "Cranbourne",
        etaLabel: "10:32",
        tdnLabel: "TDN Z460 → C473",
        statusLabel: "On Time",
        originLabel: "Platform 3",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Pakenham",
        etaLabel: "10:42",
        tdnLabel: "TDN Z078 → C075",
        statusLabel: "On Time",
        originLabel: "Platform 3",
        viaLabel: "Metro Tunnel",
      },
    ],
  },
];

const CAULFIELD_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · City Loop",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      {
        destination: "City Loop",
        etaLabel: "10:05",
        tdnLabel: "TDN 4860",
        statusLabel: "2m late",
        originLabel: "Origin Caulfield",
        viaLabel: "Stops all via City Loop",
      },
      {
        destination: "City Loop",
        etaLabel: "10:14",
        tdnLabel: "TDN 4862",
        statusLabel: "3m late",
        originLabel: "Origin Caulfield",
        viaLabel: "Stops all via City Loop",
      },
      {
        destination: "City Loop",
        etaLabel: "10:24",
        tdnLabel: "TDN 4864",
        statusLabel: "2m late",
        originLabel: "Origin Caulfield",
        viaLabel: "Stops all via City Loop",
      },
      {
        destination: "City Loop",
        etaLabel: "10:34",
        tdnLabel: "TDN 4866",
        statusLabel: "2m late",
        originLabel: "Origin Caulfield",
        viaLabel: "Stops all via City Loop",
      },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Frankston / Dandenong / Sunbury",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      {
        destination: "Frankston",
        etaLabel: "10:04",
        tdnLabel: "TDN 4367",
        statusLabel: "On Time",
        originLabel: "Origin Flinders Street",
        viaLabel: "Frankston line",
      },
      {
        destination: "Frankston",
        etaLabel: "10:24",
        tdnLabel: "TDN 4371",
        statusLabel: "On Time",
        originLabel: "Origin Flinders Street",
        viaLabel: "Frankston line",
      },
      {
        destination: "Frankston",
        etaLabel: "10:34",
        tdnLabel: "TDN 4373",
        statusLabel: "On Time",
        originLabel: "Origin Flinders Street",
        viaLabel: "Frankston line",
      },
      {
        destination: "Town Hall → Sunbury",
        etaLabel: "10:40",
        tdnLabel: "TDN C456 → Z047",
        statusLabel: "On Time",
        originLabel: "Origin Cranbourne / Pakenham",
        viaLabel: "Metro Tunnel",
      },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 · Cranbourne / Pakenham / Watergardens",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      {
        destination: "Town Hall → Sunbury",
        etaLabel: "10:00",
        tdnLabel: "TDN C452 → Z043",
        statusLabel: "2m late",
        originLabel: "Origin Pakenham corridor",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "East Pakenham",
        etaLabel: "10:09",
        tdnLabel: "TDN C041",
        statusLabel: "On Time",
        originLabel: "Origin Town Hall",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Cranbourne",
        etaLabel: "10:19",
        tdnLabel: "TDN C441",
        statusLabel: "On Time",
        originLabel: "Origin Town Hall",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Town Hall → Watergardens",
        etaLabel: "10:30",
        tdnLabel: "TDN C054 → Z443",
        statusLabel: "1m late",
        originLabel: "Origin Cranbourne / Pakenham",
        viaLabel: "Metro Tunnel",
      },
    ],
  },
  {
    platform: "4",
    label: "Platform 4 · Gippsland / City Loop / Frankston",
    tone: "bg-violet-500/12 border-violet-400/20 text-violet-100",
    services: [
      {
        destination: "Traralgon",
        etaLabel: "10:04",
        tdnLabel: "TDN 8415",
        statusLabel: "1m late",
        originLabel: "V/Line",
        viaLabel: "Gippsland line",
      },
      {
        destination: "City Loop",
        etaLabel: "10:14",
        tdnLabel: "TDN 4862",
        statusLabel: "3m late",
        originLabel: "Origin Caulfield",
        viaLabel: "Stops all via City Loop",
      },
      {
        destination: "Town Hall → Sunbury",
        etaLabel: "10:20",
        tdnLabel: "TDN C454 → Z045",
        statusLabel: "On Time",
        originLabel: "Origin Cranbourne / Pakenham",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Frankston",
        etaLabel: "10:34",
        tdnLabel: "TDN 4373",
        statusLabel: "On Time",
        originLabel: "Origin Flinders Street",
        viaLabel: "Frankston line",
      },
    ],
  },
];

const DANDENONG_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · City bound",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      {
        destination: "Town Hall → Watergardens",
        etaLabel: "14:02",
        tdnLabel: "TDN C064 → Z453",
        statusLabel: "On Time",
        originLabel: "Origin Cranbourne / Pakenham",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Town Hall → Sunbury",
        etaLabel: "14:12",
        tdnLabel: "TDN C458 → Z049",
        statusLabel: "1m late",
        originLabel: "Origin Pakenham corridor",
        viaLabel: "Metro Tunnel",
      },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Cranbourne / Pakenham",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      {
        destination: "Cranbourne",
        etaLabel: "14:09",
        tdnLabel: "TDN C447",
        statusLabel: "On Time",
        originLabel: "Origin Town Hall",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "East Pakenham",
        etaLabel: "14:19",
        tdnLabel: "TDN C049",
        statusLabel: "On Time",
        originLabel: "Origin Town Hall",
        viaLabel: "Metro Tunnel",
      },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 · Gippsland regional",
    tone: "bg-violet-500/12 border-violet-400/20 text-violet-100",
    services: [
      {
        destination: "Southern Cross",
        etaLabel: "14:24",
        tdnLabel: "TDN 8420",
        statusLabel: "Westbound",
        originLabel: "Origin Traralgon",
        viaLabel: "Gippsland line",
      },
      {
        destination: "Traralgon",
        etaLabel: "14:44",
        tdnLabel: "TDN 8421",
        statusLabel: "Eastbound",
        originLabel: "Origin Southern Cross",
        viaLabel: "Gippsland line",
      },
    ],
  },
];

const CLAYTON_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · City bound / Gippsland westbound",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      {
        destination: "Town Hall â†’ Watergardens",
        etaLabel: "14:08",
        tdnLabel: "TDN C064 â†’ Z453",
        statusLabel: "On Time",
        originLabel: "Origin Cranbourne / Pakenham",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Southern Cross",
        etaLabel: "14:36",
        tdnLabel: "TDN 8420",
        statusLabel: "Regional express",
        originLabel: "Origin Traralgon",
        viaLabel: "Gippsland line",
      },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Pakenham / Gippsland eastbound",
    tone: "bg-violet-500/12 border-violet-400/20 text-violet-100",
    services: [
      {
        destination: "East Pakenham",
        etaLabel: "14:19",
        tdnLabel: "TDN C049",
        statusLabel: "On Time",
        originLabel: "Origin Town Hall",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Traralgon",
        etaLabel: "14:44",
        tdnLabel: "TDN 8421",
        statusLabel: "Regional express",
        originLabel: "Origin Southern Cross",
        viaLabel: "Gippsland line",
      },
    ],
  },
];

const CITY_LOOP_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · Clifton Hill loop",
    tone: "bg-red-500/12 border-red-400/20 text-red-100",
    services: [
      { destination: "Mernda", etaLabel: "09:59", tdnLabel: "TDN 1673", statusLabel: "1m late", originLabel: "Origin Flinders Street", viaLabel: "Via City Loop" },
      { destination: "Hurstbridge", etaLabel: "10:06", tdnLabel: "TDN 1861", statusLabel: "On Time", originLabel: "Origin Flinders Street", viaLabel: "Via City Loop" },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Caulfield / Frankston",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      { destination: "Flinders Street → Frankston", etaLabel: "10:06", tdnLabel: "TDN 4856 → 4373", statusLabel: "1m late" },
      { destination: "Flinders Street → Frankston", etaLabel: "10:15", tdnLabel: "TDN 4858 → 4375", statusLabel: "3m late" },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 · Northern loop",
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
    services: [
      { destination: "Flinders Street → Craigieburn", etaLabel: "10:05", tdnLabel: "TDN 5634 → 5261", statusLabel: "3m late" },
      { destination: "Flinders Street → Upfield", etaLabel: "10:15", tdnLabel: "TDN 5868 → 5037", statusLabel: "2m late" },
    ],
  },
  {
    platform: "4",
    label: "Platform 4 · Burnley loop",
    tone: "bg-blue-500/12 border-blue-400/20 text-blue-100",
    services: [
      { destination: "Flinders Street → Lilydale", etaLabel: "09:54", tdnLabel: "TDN 3634 → 3227", statusLabel: "4m late" },
      { destination: "Flinders Street → Glen Waverley", etaLabel: "10:08", tdnLabel: "TDN 3918 → 2055", statusLabel: "3m late" },
    ],
  },
];

const TOWN_HALL_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · Sunbury / Watergardens",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      {
        destination: "Sunbury",
        etaLabel: "10:06",
        tdnLabel: "TDN Z069",
        statusLabel: "On Time",
        originLabel: "Origin Footscray",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Watergardens",
        etaLabel: "10:16",
        tdnLabel: "TDN Z071",
        statusLabel: "On Time",
        originLabel: "Origin Footscray",
        viaLabel: "Metro Tunnel",
      },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Cranbourne / Pakenham",
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
    services: [
      {
        destination: "Cranbourne",
        etaLabel: "10:08",
        tdnLabel: "TDN Z458 → C471",
        statusLabel: "On Time",
        originLabel: "Origin Footscray",
        viaLabel: "Metro Tunnel",
      },
      {
        destination: "Pakenham",
        etaLabel: "10:18",
        tdnLabel: "TDN Z074 → C071",
        statusLabel: "On Time",
        originLabel: "Origin Footscray",
        viaLabel: "Metro Tunnel",
      },
    ],
  },
  {
    platform: "EXT",
    label: "Extension · Flinders Street",
    tone: "bg-white/6 border-white/15 text-white",
    services: [
      {
        destination: "Flinders Street",
        etaLabel: "10:10",
        tdnLabel: "TDN Z069",
        statusLabel: "2 min after Town Hall",
        originLabel: "Southbound extension",
        viaLabel: "Continues beyond Town Hall",
      },
      {
        destination: "Flinders Street",
        etaLabel: "10:20",
        tdnLabel: "TDN Z458 → C471",
        statusLabel: "2 min after Town Hall",
        originLabel: "Southbound extension",
        viaLabel: "Continues beyond Town Hall",
      },
    ],
  },
];

const METRO_TUNNEL_CONNECTION_BOARD: PlatformBoardEntry = {
  platform: "MT",
  label: "Metro Tunnel · Platforms 1 / 2",
  tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
  services: [
    {
      destination: "Sunbury",
      etaLabel: "10:02",
      tdnLabel: "TDN MT01",
      statusLabel: "On Time",
      originLabel: "Platform 1",
      viaLabel: "Watergardens branch",
    },
    {
      destination: "Pakenham / Cranbourne",
      etaLabel: "10:08",
      tdnLabel: "TDN MT02",
      statusLabel: "1m late",
      originLabel: "Platform 2",
      viaLabel: "Metro Tunnel",
    },
  ],
};

const FLINDERS_STREET_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 - Mernda / Hurstbridge",
    tone: "bg-[#BE1014]/12 border-[#BE1014]/25 text-[#ffd6d8]",
    services: [
      { destination: "Mernda", etaLabel: "09:47", tdnLabel: "TDN 1671", statusLabel: "On Time" },
      { destination: "Mernda", etaLabel: "09:52", tdnLabel: "TDN 1673", statusLabel: "2m late" },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 - Burnley group",
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
    services: [
      { destination: "Blackburn", etaLabel: "09:44", tdnLabel: "TDN 3427", statusLabel: "On Time" },
      { destination: "Belgrave", etaLabel: "09:56", tdnLabel: "TDN 3021", statusLabel: "On Time" },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 - Burnley group",
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
    services: [
      { destination: "Lilydale", etaLabel: "09:40", tdnLabel: "TDN 3225", statusLabel: "On Time" },
      { destination: "Glen Waverley", etaLabel: "09:48", tdnLabel: "TDN 2051", statusLabel: "1m late" },
    ],
  },
  {
    platform: "4",
    label: "Platform 4 - Northern group",
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
    services: [
      { destination: "Broadmeadows", etaLabel: "09:54", tdnLabel: "TDN 5257", statusLabel: "On Time" },
      { destination: "Upfield", etaLabel: "10:06", tdnLabel: "TDN 5035", statusLabel: "On Time" },
    ],
  },
  {
    platform: "5",
    label: "Platform 5 - Northern group",
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
    services: [
      { destination: "Upfield", etaLabel: "09:50", tdnLabel: "TDN 5033", statusLabel: "On Time" },
      { destination: "Craigieburn", etaLabel: "09:58", tdnLabel: "TDN 5259", statusLabel: "On Time" },
    ],
  },
  {
    platform: "6",
    label: "Platform 6 - Frankston / regional",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      { destination: "Frankston", etaLabel: "09:46", tdnLabel: "TDN 4367", statusLabel: "1m late" },
      { destination: "Traralgon", etaLabel: "09:52", tdnLabel: "TDN 8415", statusLabel: "On Time" },
    ],
  },
  {
    platform: "7",
    label: "Platform 7 - Frankston / regional",
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
    services: [
      { destination: "Frankston", etaLabel: "10:06", tdnLabel: "TDN 4369", statusLabel: "On Time" },
      { destination: "Bairnsdale", etaLabel: "10:32", tdnLabel: "TDN 8417", statusLabel: "On Time" },
    ],
  },
  {
    platform: "8",
    label: "Platform 8 - Cross-City: Werribee / Williamstown / Sandringham",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Sandringham", etaLabel: "Live", tdnLabel: "Through service", statusLabel: "Check board" },
      { destination: "Werribee", etaLabel: "Live", tdnLabel: "Through service", statusLabel: "Check board" },
    ],
  },
  {
    platform: "9",
    label: "Platform 9 - Cross-City: Werribee / Williamstown / Sandringham",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Werribee", etaLabel: "Live", tdnLabel: "Through service", statusLabel: "Check board" },
      { destination: "Sandringham", etaLabel: "Live", tdnLabel: "Through service", statusLabel: "Check board" },
    ],
  },
  {
    platform: "10",
    label: "Platform 10 - Cross-City: Werribee / Williamstown / Sandringham",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      { destination: "Sandringham", etaLabel: "Live", tdnLabel: "Through service", statusLabel: "Check board" },
      { destination: "Williamstown / Laverton", etaLabel: "Live", tdnLabel: "Through service", statusLabel: "Check board" },
    ],
  },
];

const NORTH_MELBOURNE_PLATFORM_BOARD: PlatformBoardEntry[] = [
  {
    platform: "1",
    label: "Platform 1 · City Loop starters",
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
    services: [
      {
        destination: "City Loop",
        etaLabel: "15:20",
        tdnLabel: "TDN X046",
        statusLabel: "Next service",
        originLabel: "Origin North Melbourne",
        viaLabel: "Via North Melbourne Loop",
      },
      {
        destination: "City Loop",
        etaLabel: "15:27",
        tdnLabel: "TDN UFD13",
        statusLabel: "Following",
        originLabel: "Origin North Melbourne",
        viaLabel: "Loop departure",
      },
    ],
  },
  {
    platform: "2",
    label: "Platform 2 · Upfield outbound",
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
    services: [
      {
        destination: "Upfield",
        etaLabel: "15:23",
        tdnLabel: "TDN UFD21",
        statusLabel: "Next service",
        originLabel: "Origin City Loop",
        viaLabel: "Stops all outbound",
      },
      {
        destination: "Coburg",
        etaLabel: "15:32",
        tdnLabel: "TDN UFD22",
        statusLabel: "Following",
        originLabel: "Origin Flinders Street",
        viaLabel: "Short run",
      },
    ],
  },
  {
    platform: "3",
    label: "Platform 3 · Northern group City Loop",
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
    services: [
      {
        destination: "City Loop",
        etaLabel: "15:24",
        tdnLabel: "TDN CGB15",
        statusLabel: "Next service",
        originLabel: "Origin North Melbourne",
        viaLabel: "Northern group via Loop",
      },
      {
        destination: "City Loop",
        etaLabel: "15:34",
        tdnLabel: "TDN CGB17",
        statusLabel: "Following",
        originLabel: "Origin North Melbourne",
        viaLabel: "Loop departure",
      },
    ],
  },
  {
    platform: "4",
    label: "Platform 4 · Craigieburn / Broadmeadows outbound",
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
    services: [
      {
        destination: "Craigieburn",
        etaLabel: "15:26",
        tdnLabel: "TDN CGB31",
        statusLabel: "Next service",
        originLabel: "Origin City Loop",
        viaLabel: "Stops all outbound",
      },
      {
        destination: "Broadmeadows",
        etaLabel: "15:36",
        tdnLabel: "TDN CGB33",
        statusLabel: "Following",
        originLabel: "Origin Flinders Street",
        viaLabel: "Short run",
      },
    ],
  },
  {
    platform: "5",
    label: "Platform 5 · Flinders Street / through city",
    tone: "bg-slate-500/12 border-slate-300/20 text-slate-100",
    services: [
      {
        destination: "Flinders Street",
        etaLabel: "15:28",
        tdnLabel: "TDN XCY41",
        statusLabel: "Next service",
        originLabel: "Cross-city movement",
        viaLabel: "Through to city",
      },
      {
        destination: "City Loop",
        etaLabel: "15:39",
        tdnLabel: "TDN XCY43",
        statusLabel: "Following",
        originLabel: "Cross-city movement",
        viaLabel: "Loop-bound",
      },
    ],
  },
  {
    platform: "6",
    label: "Platform 6 · Werribee / Williamstown / Laverton",
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
    services: [
      {
        destination: "Werribee",
        etaLabel: "15:23",
        tdnLabel: "TDN WER21",
        statusLabel: "Next service",
        originLabel: "Origin Flinders Street",
        viaLabel: "Cross-city westbound",
      },
      {
        destination: "Laverton",
        etaLabel: "15:32",
        tdnLabel: "TDN WER22",
        statusLabel: "Following",
        originLabel: "Origin Flinders Street",
        viaLabel: "Stops all westbound",
      },
    ],
  },
];

const SOUTHERN_CROSS_DEPARTURE_BOARD: DepartureBoardColumn[] = [
  {
    title: "Waurn Ponds",
    accent: "bg-[#7c3aed]",
    platform: "2A",
    scheduledTime: "12:18",
    departingTime: "Now",
    status: "Geelong corridor",
    via: "via Geelong",
    stops: ["Southern Cross", "Footscray", "Tarneit", "Wyndham Vale", "Geelong", "Waurn Ponds"],
  },
  {
    title: "Wendouree",
    accent: "bg-[#7c3aed]",
    platform: "2B",
    scheduledTime: "12:24",
    departingTime: "12:24",
    status: "Ballarat line",
    via: "via Sunshine and Ballarat",
    stops: ["Southern Cross", "Sunshine", "Melton", "Ballarat", "Wendouree"],
  },
  {
    title: "Bendigo",
    accent: "bg-[#7c3aed]",
    platform: "3A",
    scheduledTime: "12:32",
    departingTime: "12:32",
    status: "Bendigo line",
    via: "via Sunbury and Castlemaine",
    stops: ["Southern Cross", "Sunbury", "Castlemaine", "Bendigo"],
  },
  {
    title: "Shepparton",
    accent: "bg-[#7c3aed]",
    platform: "3B",
    scheduledTime: "12:40",
    departingTime: "12:40",
    status: "Seymour corridor",
    via: "via Broadmeadows and Seymour",
    stops: ["Southern Cross", "Broadmeadows", "Seymour", "Nagambie", "Murchison East", "Shepparton"],
  },
  {
    title: "Traralgon",
    accent: "bg-[#7c3aed]",
    platform: "15/16",
    scheduledTime: "12:49",
    departingTime: "12:49",
    status: "Gippsland line",
    via: "via Pakenham and Moe",
    stops: ["Southern Cross", "Richmond", "Pakenham", "Moe", "Morwell", "Traralgon"],
  },
  {
    title: "Warrnambool",
    accent: "bg-[#7c3aed]",
    platform: "7A",
    scheduledTime: "13:02",
    departingTime: "13:02",
    status: "South West line",
    via: "via Geelong and Colac",
    stops: ["Southern Cross", "Geelong", "Colac", "Camperdown", "Warrnambool"],
  },
  {
    title: "Bacchus Marsh",
    accent: "bg-[#7c3aed]",
    platform: "8A",
    scheduledTime: "13:10",
    departingTime: "13:10",
    status: "Western regional",
    via: "via Sunshine and Melton",
    stops: ["Southern Cross", "Sunshine", "Caroline Springs", "Melton", "Bacchus Marsh"],
  },
];

const SOUTHERN_CROSS_PLATFORM_1_SERVICES = [
  {
    runId: "621",
    destination: "Sydney Central",
    lineLabel: "NSW TrainLink XPT",
    consist: "XP set",
    departureLabel: "7:50pm",
    dayLabel: "Tonight",
    statusLabel: "Timetabled",
  },
  {
    runId: "623",
    destination: "Sydney Central",
    lineLabel: "NSW TrainLink XPT",
    consist: "XP set",
    departureLabel: "8:30am",
    dayLabel: "Tomorrow",
    statusLabel: "Timetabled",
  },
  {
    runId: "XPT",
    destination: "Albury / Sydney Central",
    lineLabel: "NSW TrainLink XPT",
    consist: "Long distance",
    departureLabel: "Check boards",
    dayLabel: "Updates live",
    statusLabel: "Timetabled",
  },
];

const SOUTHERN_CROSS_ACCESS_ALERTS: SouthernCrossAccessAlert[] = [
  {
    title: "Southern Cross Escalator Upgrade Project",
    summary: "We’re upgrading the escalators on platforms 9–14 to make them more efficient and reliable.",
    affectedPlatforms: ["9/10", "11/12", "13/14"],
    groups: ["Burnley Loop", "Northern Loop", "Caulfield Loop", "Through suburban"],
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
  },
  {
    title: "Southern Cross Platforms 11 and 12",
    summary: "There is limited escalator access for passengers exiting Platforms 11/12 onto the Collins Street concourse.",
    affectedPlatforms: ["11/12"],
    groups: ["Northern Loop", "Caulfield Loop"],
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-50",
  },
];

const FREIGHT_MOVEMENT_BOARD: Record<string, FreightMovement[]> = {
  "North Melbourne": [
    {
      operator: "Pacific National",
      serviceId: "3MC1",
      movement: "Dynon -> Melbourne Freight Terminal",
      timeLabel: "18:42",
      lineLabel: "Broad gauge freight roads",
      statusLabel: "Due",
      note: "Interstate handoff",
    },
    {
      operator: "SCT Logistics",
      serviceId: "6PM7",
      movement: "Westbound interstate",
      timeLabel: "19:03",
      lineLabel: "Standard gauge main line",
      statusLabel: "Path set",
      note: "Through movement with no passenger boarding",
    },
  ],
  "South Kensington": [
    {
      operator: "Qube",
      serviceId: "9142",
      movement: "Appleton Dock transfer",
      timeLabel: "18:36",
      lineLabel: "Dock corridor",
      statusLabel: "Approaching",
      note: "Container shuttle",
    },
    {
      operator: "Pacific National",
      serviceId: "9791",
      movement: "Dynon -> Tottenham",
      timeLabel: "18:58",
      lineLabel: "Freight bypass",
      statusLabel: "Due",
      note: "Through movement",
    },
  ],
  Footscray: [
    {
      operator: "SCT Logistics",
      serviceId: "7MA8",
      movement: "Westbound interstate",
      timeLabel: "18:47",
      lineLabel: "Independent goods lines",
      statusLabel: "Due",
      note: "Runs clear of metro platforms",
    },
    {
      operator: "Pacific National",
      serviceId: "8246",
      movement: "Tottenham transfer",
      timeLabel: "19:12",
      lineLabel: "Freight corridor",
      statusLabel: "Path set",
      note: "Local terminal move",
    },
  ],
  Sunshine: [
    {
      operator: "Pacific National",
      serviceId: "9146",
      movement: "Maryvale paper train",
      timeLabel: "18:51",
      lineLabel: "Ballarat corridor",
      statusLabel: "Due",
      note: "Westbound freight path",
    },
    {
      operator: "SSR",
      serviceId: "7924",
      movement: "Grain working",
      timeLabel: "19:24",
      lineLabel: "Regional freight corridor",
      statusLabel: "Timetabled",
      note: "Indicative path",
    },
  ],
  Newport: [
    {
      operator: "Pacific National",
      serviceId: "8452",
      movement: "Appleton Dock -> Geelong",
      timeLabel: "18:40",
      lineLabel: "Western freight route",
      statusLabel: "Due",
      note: "Through freight road",
    },
    {
      operator: "Qube",
      serviceId: "9031",
      movement: "Port shuttle",
      timeLabel: "19:06",
      lineLabel: "Dock transfer corridor",
      statusLabel: "Approaching",
      note: "No passenger boarding",
    },
  ],
  Dandenong: [
    {
      operator: "Pacific National",
      serviceId: "9461",
      movement: "Long Island steel",
      timeLabel: "18:55",
      lineLabel: "South-east freight corridor",
      statusLabel: "Due",
      note: "Freight road movement",
    },
    {
      operator: "Qube",
      serviceId: "8810",
      movement: "Lyndhurst intermodal",
      timeLabel: "19:21",
      lineLabel: "Industrial branch path",
      statusLabel: "Timetabled",
      note: "Indicative path",
    },
  ],
};

const LINE_PLATFORM_PRESETS: Record<
  (typeof PLATFORM_PRESET_PRIORITY)[number],
  {
    inboundLabel: string;
    inboundServices: string[];
    outboundLabel: string;
    outboundServices: string[];
    tone: string;
  }
> = {
  metroTunnel: {
    inboundLabel: "Platform 1 � Sunbury / Watergardens",
    inboundServices: ["Sunbury", "Watergardens"],
    outboundLabel: "Platform 2 � Cranbourne / Pakenham",
    outboundServices: ["Cranbourne", "Pakenham"],
    tone: "bg-cyan-500/12 border-cyan-400/20 text-cyan-100",
  },
  frankston: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Frankston bound",
    outboundServices: ["Frankston", "Mordialloc"],
    tone: "bg-emerald-500/12 border-emerald-400/20 text-emerald-100",
  },
  sandringham: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["Flinders Street", "City Loop"],
    outboundLabel: "Platform 2 · Sandringham bound",
    outboundServices: ["Sandringham", "Brighton Beach"],
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
  },
  werribee: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["Flinders Street", "City Loop"],
    outboundLabel: "Platform 2 · Werribee bound",
    outboundServices: ["Werribee", "Laverton"],
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
  },
  williamstown: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["Flinders Street", "Southern Cross"],
    outboundLabel: "Platform 2 · Williamstown bound",
    outboundServices: ["Williamstown", "Newport"],
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
  },
  mernda: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Mernda bound",
    outboundServices: ["Mernda", "South Morang"],
    tone: "bg-[#BE1014]/12 border-[#BE1014]/25 text-[#ffd6d8]",
  },
  hurstbridge: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Hurstbridge bound",
    outboundServices: ["Hurstbridge", "Greensborough"],
    tone: "bg-[#BE1014]/12 border-[#BE1014]/25 text-[#ffd6d8]",
  },
  sunbury: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Sunbury bound",
    outboundServices: ["Sunbury", "Watergardens"],
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
  },
  cranbourne: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["Town Hall", "State Library"],
    outboundLabel: "Platform 2 · Cranbourne bound",
    outboundServices: ["Cranbourne", "Dandenong"],
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
  },
  pakenham: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["Town Hall", "State Library"],
    outboundLabel: "Platform 2 · Pakenham bound",
    outboundServices: ["Pakenham", "Westall"],
    tone: "bg-[#279FD5]/12 border-[#279FD5]/25 text-[#d7f4ff]",
  },
  craigieburn: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Craigieburn bound",
    outboundServices: ["Craigieburn", "Broadmeadows"],
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
  },
  upfield: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Upfield bound",
    outboundServices: ["Upfield", "Coburg"],
    tone: "bg-yellow-500/12 border-yellow-400/25 text-yellow-100",
  },
  belgrave: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Belgrave bound",
    outboundServices: ["Belgrave", "Ringwood"],
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
  },
  lilydale: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Lilydale bound",
    outboundServices: ["Lilydale", "Ringwood"],
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
  },
  glenWaverley: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Glen Waverley bound",
    outboundServices: ["Glen Waverley", "Mount Waverley"],
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
  },
  alamein: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["City Loop", "Flinders Street"],
    outboundLabel: "Platform 2 · Alamein bound",
    outboundServices: ["Alamein", "Camberwell"],
    tone: "bg-blue-500/12 border-blue-400/25 text-blue-100",
  },
  altonaLoop: {
    inboundLabel: "Platform 1 · City bound",
    inboundServices: ["Flinders Street", "Southern Cross"],
    outboundLabel: "Platform 2 · Altona Loop",
    outboundServices: ["Laverton", "Altona"],
    tone: "bg-pink-500/12 border-pink-400/20 text-pink-100",
  },
};
// =========================
// Helpers
// =========================
// The station's mode (Metro / V/Line / both) is shown as its own badge next
// to the station name — kept out of the details string below so it isn't
// repeated twice in the same panel.
function getStationTypeBadge(station: Station): string {
  if (station.name === "Southern Cross") return "Metro, V/Line, XPT & coaches";
  if (station.metro && station.vline) return "Metro + V/Line station";
  if (station.vline) return "V/Line station";
  return "Metro station";
}

function getStationDetails(station: Station): string {
  if (station.name === "Southern Cross") {
    return "XPT, coaches, replacement buses";
  }
  if (station.name === "Flinders Street") {
    return "13 platforms · Staffed (premium) · Partially gated (some Myki barriers + open entrances) · Accessible · Major CBD hub with tram connections and easy interchange to Town Hall via City Loop";
  }

  const details: string[] = [];

  if (typeof station.staffed === "boolean") {
    details.push(station.staffed ? "Staffed" : "Unstaffed");
  }
  if (typeof station.barriers === "boolean") {
    details.push(station.barriers ? "Myki barriers" : "No barriers");
  }
  if (station.zone) details.push(`Zone ${station.zone}`);
  if (FREIGHT_MOVEMENT_BOARD[station.name]?.length) details.push("Freight corridor");
  const interchangeSummary = getStationInterchangeSummary(station.name);
  if (interchangeSummary) details.push(interchangeSummary);

  return details.join(" · ");
}

function renderBoardingZoneGraphic(bestBoarding: BoardingZoneKey, accentColor: string) {
  return (
    <div className="mt-3 flex overflow-hidden rounded-full border border-white/10 bg-black/25 p-0.5">
      {(["front", "middle", "rear"] as BoardingZoneKey[]).map((zone) => {
        const active = zone === bestBoarding;
        return (
          <div
            key={zone}
            className={`flex-1 rounded-full py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors ${
              active ? "text-white shadow-sm" : "text-white/40"
            }`}
            style={active ? { background: accentColor } : undefined}
          >
            {zone}
          </div>
        );
      })}
    </div>
  );
}

function renderStationBoardingGuide(stationName: string) {
  const guide = STATION_BOARDING_GUIDES[stationName];
  if (!guide) return null;

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-cyan-400/15 bg-[linear-gradient(160deg,_rgba(8,47,73,0.55),_rgba(15,23,42,0.85))] shadow-lg shadow-cyan-950/20">
      <div className="flex items-start justify-between gap-3 border-b border-white/5 px-4 pt-4 pb-3.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300/90">Boarding guide</p>
          <p className="mt-1 text-base font-semibold text-white">{stationName}</p>
        </div>
        <span className="mt-0.5 shrink-0 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
          Interchange help
        </span>
      </div>

      <div className="space-y-3 px-4 pb-4 pt-3.5">
        <p className="text-xs leading-relaxed text-white/60">{guide.summary}</p>

        <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Best general advice</p>
          <p className="mt-1.5 text-sm leading-relaxed text-white/80">{guide.interchange}</p>
        </div>

        <div className="grid gap-2.5 lg:grid-cols-3">
          {guide.boardingZones.map((zone) => (
            <div
              key={`${stationName}-${zone.fleet}-${zone.formation}`}
              className="rounded-2xl border border-white/8 bg-white/[0.04] p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{zone.fleet}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-white/40">{zone.formation}</p>
                </div>
                <span className="shrink-0 rounded-full border border-cyan-300/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                  Best: {zone.bestBoarding}
                </span>
              </div>
              {renderBoardingZoneGraphic(zone.bestBoarding, "#06b6d4")}
              <p className="mt-3 text-xs leading-relaxed text-white/60">{zone.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getFreightMovements(stationName: string) {
  return FREIGHT_MOVEMENT_BOARD[stationName] ?? [];
}

function unverifiedTransitPanelsEnabled() {
  return false;
}

function getStationLineMemberships(stationName: string) {
  return PLATFORM_PRESET_PRIORITY.filter((lineKey) =>
    LINES[lineKey].some((station) => station.name === stationName),
  );
}

function buildPlatformBoard(station: Station): PlatformBoardEntry[] {
  // Never present generated schedules as live departures.
  void station;
  return [];
  /*
  if (station.name === "South Yarra") {
    return SOUTH_YARRA_PLATFORM_BOARD;
  }
  if (station.name === "Richmond") {
    return RICHMOND_PLATFORM_BOARD;
  }
  if (station.name === "North Melbourne") {
    return NORTH_MELBOURNE_PLATFORM_BOARD;
  }
  if (station.name === "Footscray") {
    return FOOTSCRAY_PLATFORM_BOARD;
  }
  if (station.name === "Malvern") {
    return MALVERN_PLATFORM_BOARD.filter((platform) => platform.platform !== "3");
  }
  if (station.name === "Caulfield") {
    return CAULFIELD_PLATFORM_BOARD;
  }
  if (station.name === "Clayton") {
    return CLAYTON_PLATFORM_BOARD;
  }
  if (station.name === "Dandenong") {
    return DANDENONG_PLATFORM_BOARD;
  }
  if (station.name === "Flinders Street") {
    return FLINDERS_STREET_PLATFORM_BOARD;
  }
  if (station.name === "Town Hall") {
    return TOWN_HALL_PLATFORM_BOARD;
  }
  if (["Flagstaff", "Melbourne Central", "Parliament", "State Library", "Town Hall"].includes(station.name)) {
    return CITY_LOOP_PLATFORM_BOARD;
  }

  const memberships = getStationLineMemberships(station.name);
  const primaryLine = memberships[0] ?? "frankston";
  const preset = LINE_PLATFORM_PRESETS[primaryLine];
  const isSunburyCorridorStation =
    station.name === "Sunbury" ||
    station.name === "Watergardens" ||
    station.name === "Diggers Rest" ||
    memberships.includes("sunbury");
  const inboundServices =
    isSunburyCorridorStation ? ["Town Hall", "State Library"] : preset.inboundServices;
  const outboundServices =
    isSunburyCorridorStation ? ["Sunbury", "Watergardens"] : preset.outboundServices;
  const now = new Date();
  const minuteOffsets = [4, 11, 7, 16];

  const formatEta = (offsetMinutes: number) => {
    const nextTime = new Date(now.getTime() + offsetMinutes * 60_000);
    return nextTime.toLocaleTimeString("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const buildTdnLabel = (destination: string, platform: string, index: number) => {
    const destCode = destination
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 3);

    const lineCode = primaryLine
      .replace(/[^a-z]/gi, "")
      .slice(0, 1)
      .toUpperCase();

    return `TDN ${lineCode}${destCode}${platform}${index + 1}`;
  };

  return [
    {
      platform: "1",
      label: preset.inboundLabel,
      tone: preset.tone,
      services: inboundServices.slice(0, 2).map((destination, index) => ({
        destination,
        etaLabel: formatEta(minuteOffsets[index] ?? 5 + index * 6),
        tdnLabel: buildTdnLabel(destination, "1", index),
      })),
    },
    {
      platform: "2",
      label: preset.outboundLabel,
      tone: preset.tone,
      services: outboundServices.slice(0, 2).map((destination, index) => ({
        destination,
        etaLabel: formatEta(minuteOffsets[index + 2] ?? 10 + index * 7),
        tdnLabel: buildTdnLabel(destination, "2", index),
      })),
    },
  ];
  */
}

function renderPlatformBoardCard(
  stationName: string,
  platform: PlatformBoardEntry,
  indexOffset = 0,
  isPremium = false,
  onServiceClick?: (
    stationName: string,
    platform: PlatformBoardEntry,
    service: PlatformBoardEntry["services"][number],
  ) => void,
) {
  if (platform.platform === "MT") {
    const primaryService = platform.services[0];
    const secondaryServices = platform.services.slice(1);
    const formatMetroTunnelStatus = (service: (typeof platform.services)[number]) =>
      service.viaLabel === "Watergardens branch" ? "Stops all" : "Metro Tunnel";
    const formatMetroTunnelCountdown = (
      service: (typeof platform.services)[number],
      fallback: string,
    ) => (service.etaLabel.toLowerCase().includes("now") ? "Now" : fallback);

    return (
      <div
        key={`${stationName}-platform-${platform.platform}-${indexOffset}`}
        className="overflow-hidden rounded-[1.1rem] border border-[#279FD5]/30 bg-white text-slate-950 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
      >
        <div className="border-l-[8px] border-l-[#279FD5] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Metro Tunnel · Platforms 1 / 2
          </p>
          {primaryService && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <button
                type="button"
                onClick={() => onServiceClick?.(stationName, platform, primaryService)}
                className="min-w-0 text-left transition hover:opacity-90"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[2rem] font-semibold leading-none text-slate-950">
                    {primaryService.etaLabel}
                  </span>
                  <span className="min-w-0 text-[2rem] font-semibold leading-[0.95] text-slate-950 break-words">
                    {primaryService.destination}
                  </span>
                </div>
                <p className="mt-2 text-[15px] font-medium text-slate-900">
                  {formatMetroTunnelStatus(primaryService)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  {primaryService.originLabel && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-700">
                      {primaryService.originLabel}
                    </span>
                  )}
                  {isPremium && primaryService.tdnLabel ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-700">
                      {primaryService.tdnLabel}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-700">
                      {getPublicServiceReference(primaryService.destination, primaryService.etaLabel)}
                    </span>
                  )}
                  <span>{primaryService.statusLabel ?? "Scheduled"}</span>
                </div>
              </button>
              <div className="shrink-0 bg-black px-4 py-2 text-[2rem] font-semibold leading-none text-white shadow-[0_6px_16px_rgba(0,0,0,0.25)]">
                {formatMetroTunnelCountdown(primaryService, "5 min")}
              </div>
            </div>
          )}
        </div>

        {secondaryServices.length > 0 && (
          <div className="border-t border-black/10 bg-white px-4 py-3">
            <div className="space-y-3">
              {secondaryServices.map((service, index) => (
                <button
                  type="button"
                  onClick={() => onServiceClick?.(stationName, platform, service)}
                  key={`${platform.platform}-${service.destination}-${index}`}
                  className="grid w-full gap-3 border-l-[6px] border-l-[#279FD5] border-t border-black/15 pt-3 text-left transition hover:opacity-90 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                >
                  <div className="min-w-0 pl-3">
                    <p className="text-[1.8rem] font-semibold leading-none text-slate-950">
                      {service.etaLabel}
                    </p>
                    <p className="mt-1 text-[1.85rem] font-semibold leading-[0.95] text-slate-950 break-words">
                      {service.destination}
                    </p>
                    <p className="mt-2 text-[15px] font-medium text-slate-900">
                      {formatMetroTunnelStatus(service)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      {service.originLabel && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-700">
                          {service.originLabel}
                        </span>
                      )}
                      {isPremium && service.tdnLabel ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-700">
                          {service.tdnLabel}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-700">
                          {getPublicServiceReference(service.destination, service.etaLabel)}
                        </span>
                      )}
                      <span>{service.statusLabel ?? "Scheduled"}</span>
                    </div>
                  </div>
                  <div className="shrink-0 bg-black px-4 py-2 text-[2rem] font-semibold leading-none text-white shadow-[0_6px_16px_rgba(0,0,0,0.25)]">
                    {formatMetroTunnelCountdown(service, index === 0 ? "13 min" : "24 min")}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      key={`${stationName}-platform-${platform.platform}-${indexOffset}`}
      className={`rounded-[1rem] border p-2.5 ${platform.tone}`}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55">
        {platform.label}
      </p>
      <div className="mt-2 space-y-1.5">
        {platform.services.length > 0 ? (
          platform.services.map((service, index) => {
            const display = getPlatformServiceDisplay(
              stationName,
              platform.label,
              service,
            );

            return (
              <div
                key={`${platform.platform}-${service.destination}-${index}`}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/15 px-2.5 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => onServiceClick?.(stationName, platform, service)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left transition hover:opacity-90"
                >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">{display.destination}</p>
                  {(display.originLabel || display.viaLabel) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {display.originLabel && (
                        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-medium text-white/70">
                          {display.originLabel}
                        </span>
                      )}
                      {display.viaLabel && (
                        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-medium text-white/70">
                          {display.viaLabel}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <p className="text-[10px] text-white/50">{service.statusLabel ?? "Next service"}</p>
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/80">
                      {isPremium ? service.tdnLabel : getPublicServiceReference(display.destination, service.etaLabel)}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/85">
                  {service.etaLabel}
                </span>
                </button>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 bg-black/10 px-3 py-5 text-center">
            <p className="text-xs font-semibold text-white/85">No regular departures</p>
            <p className="mt-1 text-[10px] text-white/55">
              {platform.emptyState ?? "Check the live station displays for any special movements."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function getPlatformServiceDisplay(
  stationName: string,
  platformLabel: string,
  service: PlatformBoardEntry["services"][number],
) {
  let destination = service.destination;
  let originLabel = service.originLabel;
  let viaLabel = service.viaLabel;
  const stationMemberships = getStationLineMemberships(stationName);
  const isSunburyCorridorStation =
    stationName === "Sunbury" ||
    stationName === "Watergardens" ||
    stationName === "Diggers Rest" ||
    stationMemberships.includes("sunbury");

  const arrowParts = destination
    .split(/\s*(?:→|->|â†’)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const isCityLoopStation = ["Flagstaff", "Melbourne Central", "Parliament", "State Library", "Town Hall"].includes(stationName);

  if (isCityLoopStation) {
    const isCaulfieldFrankstonPlatform = /caulfield|frankston/i.test(platformLabel);
    const isCliftonHillPlatform = /clifton hill/i.test(platformLabel);
    const isNorthernPlatform = /northern/i.test(platformLabel);
    const isBurnleyPlatform = /burnley/i.test(platformLabel);

    if (isCaulfieldFrankstonPlatform && arrowParts.length > 1) {
      originLabel ||= `Origin ${arrowParts[arrowParts.length - 1]}`;
      destination = "City Loop";
      viaLabel ||= "Stops all via City Loop";
    } else if (isCliftonHillPlatform) {
      destination = arrowParts.length > 1 ? arrowParts[arrowParts.length - 1] : destination;
      originLabel ||= "Origin Flinders Street";
      viaLabel ||= "Stops all via City Loop";
    } else if (isNorthernPlatform) {
      destination = arrowParts.length > 1 ? arrowParts[arrowParts.length - 1] : destination;
      originLabel ||= "Origin Flinders Street";
      viaLabel ||= "Stops all via City Loop";
    } else if (isBurnleyPlatform) {
      destination = arrowParts.length > 1 ? arrowParts[arrowParts.length - 1] : destination;
      originLabel ||= "Origin Flinders Street";
      viaLabel ||= "Stops all via City Loop";
    } else if (arrowParts.length > 1) {
      originLabel ||= `Origin ${arrowParts[0]}`;
      destination = arrowParts[arrowParts.length - 1];
      viaLabel ||= "Via City Loop";
    }
  }

  if (
    isSunburyCorridorStation &&
    /city bound/i.test(platformLabel) &&
    /^(city loop|flinders street|flinders st|flinders)$/i.test(destination)
  ) {
    destination = /flinders/i.test(destination) ? "State Library" : "Town Hall";
    viaLabel = "Metro Tunnel";
  }

  return {
    destination,
    originLabel,
    viaLabel,
  };
}

function normaliseServiceMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\bline\b/g, "")
    .replace(/\bstreet\b/g, "st")
    .replace(/city loop/g, "city loop")
    .replace(/\s*(?:â†’|->|Ã¢â€ â€™)\s*/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractServiceTdnCandidates(tdnLabel?: string) {
  if (!tdnLabel) return [];

  return [...new Set(
    tdnLabel
      .replace(/^TDN\s+/i, "")
      .split(/\s*(?:â†’|->|Ã¢â€ â€™)\s*/g)
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean),
  )];
}

function stripTdnPrefix(tdnLabel?: string) {
  if (!tdnLabel) return "";
  return tdnLabel.replace(/^TDN\s+/i, "").trim();
}

function isRegionalSetIdentifier(value?: string | null) {
  if (!value) return false;
  return /^V\d{3,4}$/i.test(value.trim());
}

function getPlatformLineHints(
  stationName: string,
  platform: PlatformBoardEntry,
  service: PlatformBoardEntry["services"][number],
) {
  const display = getPlatformServiceDisplay(stationName, platform.label, service);
  const searchable = normaliseServiceMatchText(
    `${platform.label} ${service.destination} ${display.destination} ${display.originLabel ?? ""} ${display.viaLabel ?? ""}`,
  );

  const hints = new Set<string>();
  const hintMap: Array<[string, string]> = [
    ["frankston", "frankston"],
    ["werribee", "werribee"],
    ["williamstown", "williamstown"],
    ["sandringham", "sandringham"],
    ["sunbury", "sunbury"],
    ["watergardens", "sunbury"],
    ["cranbourne", "cranbourne"],
    ["pakenham", "pakenham"],
    ["mernda", "mernda"],
    ["hurstbridge", "hurstbridge"],
    ["lilydale", "lilydale"],
    ["belgrave", "belgrave"],
    ["alamein", "alamein"],
    ["glen waverley", "glen waverley"],
    ["craigieburn", "craigieburn"],
    ["upfield", "upfield"],
    ["traralgon", "traralgon"],
    ["geelong", "geelong"],
    ["waurn ponds", "waurn ponds"],
    ["wendouree", "ballarat"],
    ["ballarat", "ballarat"],
    ["bendigo", "bendigo"],
    ["shepparton", "shepparton"],
  ];

  hintMap.forEach(([needle, value]) => {
    if (searchable.includes(needle)) {
      hints.add(value);
    }
  });

  return [...hints];
}

function getRegionalTrainTypeLabel(vehicle: LiveTrain) {
  if (!isVlineLiveTrain(vehicle)) {
    return vehicle.trainType;
  }

  const joined = `${vehicle.consist} ${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toUpperCase();
  const genericRegionalLabel =
    !vehicle.trainType.trim() ||
    /^(REGIONAL TRAIN|TRAIN|V\/LINE|VLINE|UNKNOWN)$/i.test(vehicle.trainType.trim());
  const setMentions = joined.match(/\bV\d{3,4}\b/g) ?? [];

  // Stony Point is the one non-electrified Metro branch — every service on it
  // runs as a Sprinter railcar, unconditionally, regardless of whether PTV's
  // feed happens to mention the rolling stock by name. The inbound (Stony
  // Point -> Frankston) direction's real trip_headsign is "Frankston", so
  // line/destination/serviceDescription can all come back with no text
  // mentioning Stony Point at all for that direction — the real route code
  // "STY" survives in tripId regardless (static schedule format
  // "02-STY--1-T5-8518"), so check that too.
  if (/STONY POINT/.test(joined) || /-STY--/i.test(vehicle.tripId ?? "")) {
    return "Sprinter";
  }

  // The feed's line/trainType/serviceDescription text for these is almost
  // always just generic "V/Line Train" with no rolling-stock word at all —
  // but V/Line's own consist numbering scheme prefixes real Sprinter railcars
  // "S" (e.g. "S7018", confirmed against the real TDN 8341 → set 7018 on the
  // Seymour line), the same way VLocity sets are prefixed "V". That prefix is
  // authoritative where the free text isn't.
  if (/SPRINTER/.test(joined) || /\bS\d{3,4}\b/.test(joined)) {
    return "Sprinter";
  }

  if (/XPT/.test(joined)) {
    return "NSW TrainLink XPT";
  }

  if (/XPLORER/.test(joined)) {
    return "NSW TrainLink Xplorer";
  }

  // Same authoritative-prefix logic as the Sprinter "S" check above: N-class
  // locomotives are numbered with an "N" prefix in the live feed's own
  // consist/vehicle ID (e.g. "N460", confirmed against TDN 8089 on the Swan
  // Hill line) even when every text field just says generic "V/Line Train".
  if (/\bN\d{2,4}\b/.test(joined)) {
    return "N class";
  }

  if (/N\s*CLASS|N-?SET|LOCOMOTIVE|LOCO/.test(joined)) {
    return genericRegionalLabel ? "N class" : vehicle.trainType;
  }

  if (/VLOCITY/.test(joined) || setMentions.length > 0) {
    return "VLocity";
  }

  return genericRegionalLabel ? "Regional train" : vehicle.trainType;
}

function getRegionalTrainFamilyLabel(vehicle: LiveTrain) {
  const typeLabel = getRegionalTrainTypeLabel(vehicle);
  const joined = `${vehicle.consist} ${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toUpperCase();

  if (/XPT|XPLORER/.test(joined)) return typeLabel;
  if (/STONY POINT|SPRINTER/.test(joined) || /-STY--/i.test(vehicle.tripId ?? "")) return "Sprinter";
  if (/N\s*CLASS|N-?SET|LOCOMOTIVE|LOCO/.test(joined)) return "N class";
  if (/VLOCITY|\bV\d{3,4}\b/.test(joined) || /VLOCITY/i.test(typeLabel)) return "VLocity";
  if (/LOCOMOTIVE|LOCO/i.test(typeLabel)) return typeLabel;
  return typeLabel === "Regional train" ? "Other locomotive" : typeLabel;
}

function getRegionalCarLengthLabel(vehicle: LiveTrain) {
  const allocation = getCurrentVlineAllocation(vehicle);
  if (allocation) return `${allocation.carCount}-car`;
  if (vehicle.tripId?.startsWith("01-") || /VLOCITY|V\/LINE/i.test(`${vehicle.trainType} ${vehicle.line}`)) return "";
  const typeLabel = getRegionalTrainTypeLabel(vehicle);
  const joined = `${vehicle.consist} ${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""} ${typeLabel}`.toUpperCase();
  const explicitCarMatch = joined.match(/\b(3|4|5|6|7|8|9)\s*[- ]?CAR\b/);
  if (explicitCarMatch?.[1]) return `${explicitCarMatch[1]}-car`;
  if (/N\s*CLASS|N-?SET|LOCOMOTIVE|LOCO/.test(joined)) return "loco set";
  if (/XPT/.test(joined)) return "7-car";
  if (/XPLORER|SPRINTER/.test(joined)) return "special";
  return "set TBC";
}

function getRegionalRouteDisplayLabel(vehicle: LiveTrain) {
  const fallbackMeta = getRegionalFallbackMeta(vehicle);
  // fallbackMeta.destination is already the real, direction-aware station
  // (e.g. "Southern Cross" for a city-bound Ballarat-line service, not
  // "Ballarat" regardless of which way it's actually travelling) — this used
  // to read fallbackMeta.serviceLabel instead, which is only ever the static
  // corridor name and doesn't know which direction this specific vehicle is
  // running, so every inbound V/Line service showed its outbound-terminus
  // town as if it were still travelling away from Melbourne. Not a one-off:
  // this feeds every unselected V/Line marker's tooltip, so the fix applies
  // network-wide, not just to one train.
  const raw = !isGenericRegionalPlaceholder(vehicle.destination)
    ? vehicle.destination
    : fallbackMeta?.destination ?? fallbackMeta?.serviceLabel ?? vehicle.line ?? "V/Line";
  return raw
    .replace(/\s+line$/i, "")
    .replace(/^V\/Line$/i, "Regional")
    .trim();
}

// The service's own trip number (e.g. tripId "731.070926.31.1415" or
// "NT32.807...") is the same number the feed already prints in parens in its
// own label ("02:15pm (731) Wagga Wagga - Mildura") — the closest thing NSW
// TrainLink has to V/Line's tracked "leading set" identity, since NSW doesn't
// publish a real consist/set number the way transportvic.me does for V/Line.
function getNswTrainLinkSetNumber(vehicle: LiveTrain) {
  return vehicle.tripId?.split(".")[0] || vehicle.tdn;
}

// "STATIC" means the backend fell back to a per-station UP/DOWN platform
// assignment (V/Line's own GTFS rarely publishes a platform for regional
// stops at all) — real for that station, but not the specific confirmed
// live/scheduled allocation for this particular service, hence "usual"
// rather than a bare platform number.
function getPlatformLabel(stop: { platform?: string; platformSource?: string }): string {
  if (!stop.platform) return "Platform not published";
  return stop.platformSource === "static_direction" ? `Platform ${stop.platform} · usual` : `Platform ${stop.platform}`;
}

function getRegionalSpecialTrainLabel(vehicle: LiveTrain) {
  const joined = `${vehicle.consist} ${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toUpperCase();
  if (/XPLORER/.test(joined)) return `Xplorer leading set ${getNswTrainLinkSetNumber(vehicle)}`;
  if (/XPT|NSW TRAINLINK/.test(joined)) return `XPT leading set ${getNswTrainLinkSetNumber(vehicle)}`;
  if (/SPRINTER|N\s*CLASS|N-?SET|LOCOMOTIVE|LOCO/.test(joined)) {
    return `V/Line leading set ${getRegionalAllocatedSetLabel(vehicle) || vehicle.tdn}`;
  }
  // A missing V-number in the feed just means this specific vehicle's
  // consist field is blank right now (confirmed live: TDN 8089, a real
  // Bendigo-line VLocity working, consist "Unknown") — it is not real
  // evidence the physical train is locomotive-hauled. Claiming "V/Line
  // leading set Unknown" here was a guess dressed up as a fact for every
  // VLocity service the feed simply hadn't published a consist for yet.
  return "";
}

function getRegionalRealtimeTripLabel(vehicle: LiveTrain) {
  return [getMarkerServiceTime(vehicle.timestamp), getRegionalRouteDisplayLabel(vehicle), getRegionalCarLengthLabel(vehicle), getRegionalTrainFamilyLabel(vehicle)].filter(Boolean).join(" · ");
}

function getRegionalAllocatedSetLabel(vehicle: LiveTrain) {
  const identifier = getRegionalAllocatedSetIdentifier(vehicle);
  if (!identifier) return identifier;
  // Multi-part identifiers ("851M-1626T-852M + 853M-1627T-854M" for a double
  // consist) get each real, named set annotated individually rather than
  // just the first one matched.
  return identifier
    .split(" + ")
    .map((part) => {
      const nickname = getFleetNickname(part.replace(/\s*\(leading set\)$/, ""));
      return nickname ? `${part} "${nickname}"` : part;
    })
    .join(" + ");
}

function getRegionalAllocatedSetIdentifier(vehicle: LiveTrain) {
  // NSW TrainLink has no real consist/set number the way transportvic.me
  // publishes for V/Line — falling through to the generic candidates below
  // used to surface the raw service description text (e.g. "08:40am (224)
  // Armidale - Sydney") in the Allocated Set field instead of a real
  // identifier. getNswTrainLinkSetNumber's trip-number-derived code (e.g.
  // "NP24") is the same real identifier already shown on the map marker's
  // "XPT leading set NP24" label — use that here too instead.
  if (isNswTrainLinkLiveTrain(vehicle)) {
    return getNswTrainLinkSetNumber(vehicle);
  }
  const allocation = getCurrentVlineAllocation(vehicle);
  if (allocation) return allocation.setIds.join(" + ");
  // leadingSet only ever gets populated for VLocity sets (that's all
  // TransportVic's bot tracks) — a "01-" V/Line tripId with no leadingSet
  // used to return "" outright here, which is every Sprinter/N-class service,
  // even though the live feed's own consist field already carries the real
  // number (e.g. "N460", "S7018"). Fall through to that instead of giving up.
  if (vehicle.tripId?.startsWith("01-") && vehicle.leadingSet) {
    return `${vehicle.leadingSet.setId} (leading set)`;
  }
  // Stony Point's own live feed has no real reporting mark at all — just
  // the literal word "train" glued to its trip-derived number (e.g.
  // "train68340") — so strip that prefix rather than display it as if
  // "train" were part of the identifier.
  const candidates = [vehicle.consist, vehicle.tdn]
    .map((value) => value.trim().replace(/^train(?=\d)/i, ""))
    .filter(Boolean);
  return candidates.find((value) => isRegionalSetIdentifier(value)) ?? candidates[0] ?? "";
}

function getVehicleAlertKeywords(vehicle: LiveTrain, snapshot?: ConsistSnapshot) {
  const keywords = new Set<string>();
  const pushKeyword = (value?: string | null) => {
    if (!value) return;
    const normalised = normaliseServiceMatchText(value);
    if (normalised.length >= 4) {
      keywords.add(normalised);
    }
  };

  pushKeyword(vehicle.line);
  pushKeyword(vehicle.destination);
  pushKeyword(snapshot?.current_trip?.origin);
  pushKeyword(snapshot?.current_trip?.destination);
  pushKeyword(snapshot?.next_trip?.origin);
  pushKeyword(snapshot?.next_trip?.destination);
  pushKeyword(snapshot?.position?.current_stop);
  pushKeyword(snapshot?.position?.next_stop);

  if (normaliseServiceMatchText(vehicle.line) === "upfield") {
    pushKeyword("upfield");
    pushKeyword("craigieburn");
    pushKeyword("northern");
  }

  if (normaliseServiceMatchText(vehicle.line) === "frankston") {
    pushKeyword("frankston");
    pushKeyword("stony point");
    pushKeyword("caulfield");
  }

  return [...keywords];
}

function offsetPolylineCoordinates(
  coordinates: [number, number][],
  direction: "left" | "right" = "left",
  multiplier = 1
): [number, number][] {
  if (coordinates.length < 2) return coordinates;

  const offsetDistance = 0.0004 * multiplier;
  const sign = direction === "left" ? 1 : -1;

  return coordinates.map((coord, index) => {
    let perpendicular: [number, number] = [0, 0];

    if (index === 0) {
      const next = coordinates[1];
      const dx = next[1] - coord[1];
      const dy = next[0] - coord[0];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      perpendicular = [-dy / len, dx / len];
    } else if (index === coordinates.length - 1) {
      const prev = coordinates[index - 1];
      const dx = coord[1] - prev[1];
      const dy = coord[0] - prev[0];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      perpendicular = [-dy / len, dx / len];
    } else {
      const prev = coordinates[index - 1];
      const next = coordinates[index + 1];

      const dx1 = coord[1] - prev[1];
      const dy1 = coord[0] - prev[0];
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
      const perp1: [number, number] = [-dy1 / len1, dx1 / len1];

      const dx2 = next[1] - coord[1];
      const dy2 = next[0] - coord[0];
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
      const perp2: [number, number] = [-dy2 / len2, dx2 / len2];

      perpendicular = [
        (perp1[0] + perp2[0]) / 2,
        (perp1[1] + perp2[1]) / 2,
      ];
    }

    return [
      coord[0] + perpendicular[0] * offsetDistance * sign,
      coord[1] + perpendicular[1] * offsetDistance * sign,
    ];
  });
}

function createFeaturedConsistIcon(isLive: boolean) {
  const glowColor = isLive ? "#facc15" : "#94a3b8";
  const badgeTone = isLive ? "#0f172a" : "#1e293b";
  const badgeText = isLive ? "LIVE" : "EST";

  return L.divIcon({
    html: `
      <div style="position:relative;width:58px;height:58px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${glowColor};opacity:${isLive ? "0.22" : "0.14"};animation:ping 2.2s infinite;"></div>
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:9999px;background:#0f172a;border:2px solid ${glowColor};box-shadow:0 8px 20px rgba(15,23,42,0.58);">
          <span style="font-size:20px;line-height:1;color:${glowColor};">★</span>
        </div>
        <div style="position:absolute;top:-7px;right:-2px;border-radius:9999px;background:${badgeTone};border:1px solid rgba(255,255,255,0.18);padding:2px 6px;color:#f8fafc;font-size:9px;font-weight:800;letter-spacing:0.08em;">430M</div>
        <div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);border-radius:9999px;background:rgba(15,23,42,0.92);border:1px solid rgba(255,255,255,0.12);padding:2px 6px;color:${glowColor};font-size:8px;font-weight:800;letter-spacing:0.12em;">${badgeText}</div>
      </div>
    `,
    className: "bg-transparent border-none",
    iconSize: [58, 58],
    iconAnchor: [29, 29],
    popupAnchor: [0, -24],
  });
}

// Always the non-live ("EST") visual — this feature has no GPS by design,
// so it must never be able to render as if it were a real live position.
// Mirrors createFeaturedConsistIcon's non-live branch above.
function createNonPassengerServiceIcon(serviceType: NonPassengerServiceType) {
  const glowColor = "#94a3b8";
  const symbol = serviceType === "HERITAGE SPECIAL" ? "🏛" : serviceType === "EMPTY CARS" ? "○" : "▣";

  return L.divIcon({
    html: `
      <div style="position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${glowColor};opacity:0.14;animation:ping 2.2s infinite;"></div>
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:#0f172a;border:2px solid ${glowColor};box-shadow:0 8px 20px rgba(15,23,42,0.58);">
          <span style="font-size:16px;line-height:1;color:${glowColor};">${symbol}</span>
        </div>
        <div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);border-radius:9999px;background:rgba(15,23,42,0.92);border:1px solid rgba(255,255,255,0.12);padding:2px 6px;color:${glowColor};font-size:8px;font-weight:800;letter-spacing:0.12em;">EST</div>
      </div>
    `,
    className: "bg-transparent border-none",
    iconSize: [52, 52],
    iconAnchor: [26, 26],
    popupAnchor: [0, -22],
  });
}

function resolveConsistSnapshotCoordinate(snapshot?: ConsistSnapshot | null): [number, number] | null {
  if (!snapshot) return null;

  if (typeof snapshot.position?.lat === "number" && typeof snapshot.position?.lng === "number") {
    return [snapshot.position.lat, snapshot.position.lng];
  }

  return (
    findStationCoordinate(snapshot.position?.current_stop) ??
    findStationCoordinate(snapshot.position?.next_stop) ??
    findStationCoordinate(snapshot.current_trip?.origin) ??
    findStationCoordinate(snapshot.current_trip?.destination) ??
    findStationCoordinate(snapshot.next_trip?.origin) ??
    findStationCoordinate(snapshot.next_trip?.destination) ??
    SOUTHERN_CROSS_POSITION
  );
}

function projectPointToSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): [number, number] {
  const segmentLat = end[0] - start[0];
  const segmentLng = end[1] - start[1];
  const segmentLengthSquared = segmentLat * segmentLat + segmentLng * segmentLng;

  if (segmentLengthSquared === 0) {
    return start;
  }

  const pointLat = point[0] - start[0];
  const pointLng = point[1] - start[1];
  const t = Math.max(
    0,
    Math.min(1, (pointLat * segmentLat + pointLng * segmentLng) / segmentLengthSquared),
  );

  return [start[0] + segmentLat * t, start[1] + segmentLng * t];
}

function getDistanceSquared(left: [number, number], right: [number, number]) {
  const latDelta = left[0] - right[0];
  const lngDelta = left[1] - right[1];
  return latDelta * latDelta + lngDelta * lngDelta;
}

function alignStationsToPolyline(stations: Station[], track: [number, number][]): Station[] {
  if (track.length < 2) {
    return stations;
  }

  return stations.map((station) => {
    let closestPoint = station.position;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < track.length - 1; index += 1) {
      const projectedPoint = projectPointToSegment(
        station.position,
        track[index],
        track[index + 1],
      );
      const distance = getDistanceSquared(station.position, projectedPoint);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPoint = projectedPoint;
      }
    }

    return {
      ...station,
      position: closestPoint,
    };
  });
}

function alignStationsToRenderedPolyline(
  stations: Station[],
  track: [number, number][],
  direction: "left" | "right",
  multiplier: number,
): Station[] {
  const renderedTrack = offsetPolylineCoordinates(track, direction, multiplier);
  return alignStationsToPolyline(stations, renderedTrack);
}

const MULTI_RING_STATION_COLORS: Record<string, string[]> = {
  "South Kensington": ["#F178AF"],
  "South Yarra": ["#F178AF", "#22c55e"],
  "Caulfield": ["#279FD5", "#22c55e", "#7c3aed"],
  "Richmond": ["#F178AF", "#003A8F", "#22c55e", "#7c3aed"],
  "Pakenham": ["#279FD5", "#7c3aed"],
  "Dandenong": ["#279FD5", "#7c3aed"],
  "Clayton": ["#279FD5", "#7c3aed"],
};

function renderStationMarkers(
  renderedStationKeys: Set<string>,
  stations: Station[],
  fillColor: string,
  strokeColor: string,
  resolveStation: (station: Station) => Station,
  onSelectStation: (station: Station) => void,
  onToggleStationLine?: (station: Station) => boolean,
  visibleBounds?: L.LatLngBounds | null,
) {
  return stations.map((station, index) => {
    const resolvedStation = resolveStation(station);
    const isCityLoopPill =
      CITY_LOOP_PILL_STATIONS.has(resolvedStation.name) || SPECIAL_PILL_STATIONS.has(resolvedStation.name);
    // Genuinely served by multiple distinct line groups — reuse each line's
    // own established colour elsewhere in the app (LayerControl: Sandringham
    // "#F178AF", Frankston/Caulfield group "#22c55e", Metro Tunnel "#279FD5",
    // V/Line "#7c3aed") rather than showing the station as belonging to just
    // whichever single line happened to render its marker first.
    const multiRingColors = MULTI_RING_STATION_COLORS[resolvedStation.name];
    const isSharedCaulfieldMetroStation = CAULFIELD_METRO_SHARED_STATIONS.has(resolvedStation.name);
    const isFrankstonGreenSharedStation = FRANKSTON_GREEN_SHARED_STATIONS.has(resolvedStation.name);
    const isSharedNorthernStation = NORTHERN_SHARED_STATIONS.has(resolvedStation.name);
    const isCraigieburnLineStation = CRAIGIEBURN_LINE_STATION_NAMES.has(resolvedStation.name);
    // A physical station gets one marker even when several route arrays share it.
    // This prevents duplicate Richmond/East Richmond/Flinders Street nodes.
    const shouldRenderOnce = true;
    const isCombinedLoopInterchange = COMBINED_LOOP_INTERCHANGES.has(resolvedStation.name);
    const stationRenderKey = isCombinedLoopInterchange
      ? "Melbourne Central / State Library"
      : `${resolvedStation.name}`;
    const markerPosition = isCombinedLoopInterchange
      ? MELBOURNE_CENTRAL_STATE_LIBRARY_INTERCHANGE
      : resolvedStation.position;
    const markerName = isCombinedLoopInterchange
      ? "Melbourne Central / State Library"
      : resolvedStation.name;
    const isEndpoint = index === 0 || index === stations.length - 1;
    const isMobileBoundedMarkerSet = Boolean(visibleBounds && stations.length > 10);
    // Viewport bounds already cap the marker set. Only thin labels at city-wide
    // zooms; suburban views need every station to remain discoverable.
    const hasSuburbanStationDetail =
      !visibleBounds || visibleBounds.getNorth() - visibleBounds.getSouth() <= 0.17;
    const shouldThinMobileStationMarker =
      isMobileBoundedMarkerSet &&
      !hasSuburbanStationDetail &&
      !isEndpoint &&
      !isCityLoopPill &&
      !shouldRenderOnce &&
      index % 2 === 1;
    const shouldHideDenseMobileStationMarker =
      isMobileBoundedMarkerSet &&
      !hasSuburbanStationDetail &&
      stations.length > 16 &&
      !isEndpoint &&
      !isCityLoopPill &&
      !shouldRenderOnce &&
      !isSharedCaulfieldMetroStation &&
      !isSharedNorthernStation &&
      !isCraigieburnLineStation &&
      index % 4 !== 0;

    if (visibleBounds && !visibleBounds.contains(L.latLng(markerPosition[0], markerPosition[1]))) {
      return null;
    }

    if (shouldThinMobileStationMarker || shouldHideDenseMobileStationMarker) {
      return null;
    }

    if (shouldRenderOnce && renderedStationKeys.has(stationRenderKey)) {
      return null;
    }

    if (shouldRenderOnce) {
      renderedStationKeys.add(stationRenderKey);
    }

    if (isCityLoopPill) {
      return (
        <Marker
          key={`${station.name}-${station.position[0]}-${station.position[1]}`}
          alt={`${markerName} station`}
          title={`${markerName} station`}
          position={markerPosition}
          icon={multiRingColors
            ? createMultiRingStationIcon(multiRingColors)
            : createCleanStationNodeIcon(strokeColor, {
                interchange: true,
                staffed: resolvedStation.staffed === true,
              })}
          pane="stationPane"
          zIndexOffset={3400}
          eventHandlers={{
            click: () => {
              if (!onToggleStationLine?.(resolvedStation)) {
                onSelectStation(resolvedStation);
              }
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -9]} opacity={0.96} sticky>
            {markerName}
          </Tooltip>
        </Marker>
      );
    }

    return (
      <Marker
        key={`${station.name}-${station.position[0]}-${station.position[1]}`}
        alt={`${resolvedStation.name} station`}
        title={`${resolvedStation.name} station`}
        position={resolvedStation.position}
        pane="stationPane"
        icon={multiRingColors
          ? createMultiRingStationIcon(multiRingColors)
          : createCleanStationNodeIcon(
              isFrankstonGreenSharedStation ? "#22c55e" : strokeColor,
              {
                endpoint: isEndpoint,
                interchange: shouldRenderOnce || isSharedCaulfieldMetroStation || isSharedNorthernStation,
                staffed: resolvedStation.staffed === true,
              },
            )}
        zIndexOffset={3300}
        eventHandlers={{
          click: () => {
            if (!onToggleStationLine?.(resolvedStation)) {
              onSelectStation(resolvedStation);
            }
          },
        }}
      >
        <Tooltip direction="top" offset={[0, -7]} opacity={0.96} sticky>
          {resolvedStation.name}
        </Tooltip>
      </Marker>
    );
  });
}

function renderRouteStopMarkers(
  stops: Array<{ name: string; position: [number, number]; note?: string }>,
  fillColor: string,
  strokeColor: string,
  subtitle: string,
  visibleBounds?: L.LatLngBounds | null,
) {
  return stops
    .filter((stop) => !visibleBounds || visibleBounds.contains(L.latLng(stop.position[0], stop.position[1])))
    .map((stop, index) => (
    <Marker
      key={`${stop.name}-${stop.position[0]}-${stop.position[1]}`}
      alt={`${stop.name} stop`}
      title={`${stop.name} stop`}
      position={stop.position}
      icon={createInlineStationStopIcon(stop.name, strokeColor, {
        endpoint: index === 0 || index === stops.length - 1,
      })}
      zIndexOffset={3200}
    >
      <Popup>
        <div className="p-3 w-48">
          <p className="font-semibold text-white">{stop.name}</p>
          <p className="text-xs text-white/60 mt-1">{subtitle}</p>
          {stop.note ? <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200">{stop.note}</p> : null}
        </div>
      </Popup>
    </Marker>
  ));
}

function renderFreightLocationMarkers(stops: FreightLocation[], visibleBounds?: L.LatLngBounds | null) {
  return stops
    .filter((stop) => !visibleBounds || visibleBounds.contains(L.latLng(stop.position[0], stop.position[1])))
    .map((stop, index) => (
    <Marker
      key={`${stop.name}-${stop.position[0]}-${stop.position[1]}`}
      alt={`${stop.name} freight location`}
      title={`${stop.name} freight location`}
      position={stop.position}
      icon={createInlineStationStopIcon(stop.name, FREIGHT_BROWN, {
        endpoint: index === 0 || index === stops.length - 1,
      })}
      pane="stationPane"
      zIndexOffset={3250}
    >
      <Popup>
        <div className="p-3 w-56">
          <p className="font-semibold text-white">{stop.name}</p>
          <p className="mt-1 text-xs text-white/70">
            {stop.kind} · Freight corridor
          </p>
        </div>
      </Popup>
    </Marker>
  ));
}

function renderSurfaceStops(
  stops: SurfaceStop[],
  fillColor: string,
  strokeColor: string,
  onSelect: (stop: SurfaceStop) => void,
  visibleBounds?: L.LatLngBounds | null,
  mode: "bus" | "tram" = "bus",
  pane?: string,
) {
  return stops
    .filter((stop) => !visibleBounds || visibleBounds.contains(L.latLng(stop.position[0], stop.position[1])))
    .map((stop) => (
    <CircleMarker
      key={stop.id}
      center={stop.position}
      radius={mode === "tram" ? 3.5 : 5}
      pane={pane}
      pathOptions={{
        ...getSurfaceRouteColors(stop.routeLabel, fillColor, strokeColor),
        fillOpacity: 0.98,
        stroke: mode !== "tram",
        weight: mode === "tram" ? 0 : 2,
      }}
      eventHandlers={{
        click: () => onSelect(stop),
      }}
    >
      <Popup>
        <div className="p-3 w-56">
          <p className="font-semibold text-white">{stop.name}</p>
          <p className="mt-1 text-xs text-white/70">
            {stop.locality} · {stop.subtitle}
          </p>
          <button
            type="button"
            onClick={() => onSelect(stop)}
            className="mt-3 inline-flex rounded-full border border-white/15 bg-white/6 px-3 py-1 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10"
          >
            Open schedules
          </button>
        </div>
      </Popup>
    </CircleMarker>
  ));
}

function getDebugPointLabel(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < alphabet.length) {
    return alphabet[index];
  }

  const first = Math.floor(index / alphabet.length) - 1;
  const second = index % alphabet.length;
  return `${alphabet[Math.max(0, first)]}${alphabet[second]}`;
}

function createDebugPointIcon(label: string, color: string) {
  return L.divIcon({
    html: `
      <div style="
        min-width:22px;
        height:22px;
        padding:0 6px;
        border-radius:9999px;
        background:rgba(15,23,42,0.92);
        border:1px solid ${color};
        color:${color};
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:11px;
        font-weight:700;
        box-shadow:0 4px 10px rgba(0,0,0,0.45);
      ">
        ${escapeInlineMarkerHtml(label)}
      </div>
    `,
    className: "bg-transparent border-none",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function escapeInlineMarkerHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createInlineStationStopIcon(
  stationName: string,
  color: string,
  options?: {
    endpoint?: boolean;
    compact?: boolean;
    staffed?: boolean;
  },
) {
  const endpoint = options?.endpoint ?? false;
  const compact = options?.compact ?? false;
  const staffed = options?.staffed ?? false;
  const escapedName = escapeInlineMarkerHtml(stationName);
  const useRotatedPill = ROTATED_FRANKSTON_PILL_STATIONS.has(stationName);
  // Tram-route pills overwhelmed the map at mobile zoom levels. Tram lines remain
  // visible on the map and inside stop details without duplicating every route here.
  const routeTags = getStationConnectionTags(stationName).filter((tag) => !/^tram\b/i.test(tag));
  const routeCard = STATION_SURFACE_ROUTE_CARDS[stationName] ?? [];
  const tickHeight = useRotatedPill ? 0 : endpoint ? (compact ? 14 : 16) : compact ? 10 : 14;
  const iconHeight = useRotatedPill
    ? routeCard.length > 0
      ? 62
      : routeTags.length > 0
        ? 58
        : 34
    : endpoint
      ? compact ? 46 : 60
      : compact ? 40 : 52;
  const labelMargin = useRotatedPill ? 0 : compact ? 2 : 4;
  const translateY = useRotatedPill ? 0 : compact ? -22 : -30;
  const iconWidth = routeCard.length > 0 ? 190 : 136;
  const iconAnchorX = Math.round(iconWidth / 2);
  const iconAnchorY = routeCard.length > 0 ? 17 : useRotatedPill ? Math.round(iconHeight / 2) : iconHeight - 2;
  const routeTagsMarkup = routeTags.length > 0
    ? `<div style="
          margin-top:2px;
          display:flex;
          flex-wrap:wrap;
          align-items:center;
          justify-content:center;
          gap:2px;
          max-width:132px;
        ">
          ${routeTags.map((tag) => {
            const isBusTag = /^bus\b/i.test(tag);
            const tramRouteMatch = tag.match(/^tram\s+(.+)$/i);
            const tramStyle = tramRouteMatch ? getTramRouteStyle(tramRouteMatch[1]) : null;
            const tagBackground = tramStyle?.background ?? (isBusTag ? "#f59e0b" : "rgba(15,23,42,0.82)");
            const tagBorder = tramStyle?.border ?? (isBusTag ? "rgba(251,191,36,0.82)" : "rgba(255,255,255,0.16)");
            const tagColor = tramStyle?.color ?? (isBusTag ? "#111827" : "#f8fafc");
            const tagShadow = tramStyle ? "0 4px 10px rgba(0,0,0,0.32)" : isBusTag ? "0 4px 10px rgba(245,158,11,0.34)" : "0 2px 6px rgba(0,0,0,0.28)";

            return `<span style="
            border-radius:9999px;
            background:${tagBackground};
            border:1px solid ${tagBorder};
            color:${tagColor};
            font-size:9px;
            font-weight:900;
            line-height:1;
            padding:3px 5px;
            box-shadow:${tagShadow};
          ">${escapeInlineMarkerHtml(tag)}</span>`;
          }).join("")}
        </div>`
    : "";
  const routeCardMarkup = routeCard.length > 0
    ? `<details style="
          position:absolute;
          left:50%;
          top:34px;
          width:146px;
          border-radius:12px;
          background:linear-gradient(135deg,rgba(3,7,18,0.96),rgba(13,30,54,0.94));
          border:1px solid rgba(96,165,250,0.34);
          box-shadow:0 8px 18px rgba(0,0,0,0.38),0 0 0 1px rgba(255,255,255,0.05) inset;
          padding:4px 6px 5px;
          color:#f8fafc;
          text-align:left;
          transform:translateX(-50%) rotate(0deg);
          pointer-events:auto;
          overflow:visible;
        ">
          <div style="
            position:absolute;
            left:50%;
            top:-12px;
            width:4px;
            height:13px;
            border-radius:9999px;
            background:linear-gradient(180deg,${color},rgba(96,165,250,0.72));
            box-shadow:0 0 12px rgba(34,197,94,0.38);
            transform:translateX(-50%);
          "></div>
          <div style="
            position:absolute;
            left:50%;
            top:-18px;
            width:10px;
            height:10px;
            border-radius:9999px;
            background:${color};
            border:2px solid rgba(255,255,255,0.88);
            box-shadow:0 4px 12px rgba(0,0,0,0.42);
            transform:translateX(-50%);
          "></div>
          <summary style="
            list-style:none;
            cursor:pointer;
            display:flex;
            align-items:center;
            justify-content:center;
            gap:4px;
            border-radius:9999px;
            background:rgba(245,158,11,0.18);
            border:1px solid rgba(251,191,36,0.46);
            padding:3px 6px;
            color:#fde68a;
            font-size:9px;
            font-weight:950;
            line-height:1;
            white-space:nowrap;
          ">
            <span style="color:#f59e0b;">Bus</span>
            <span>625 + 630</span>
            <span style="font-size:8px;color:rgba(253,230,138,0.74);">details</span>
          </summary>
          <div style="
            margin-top:5px;
            border-top:1px solid rgba(255,255,255,0.1);
            padding-top:5px;
          ">
          ${routeCard.map((route, index) => `<div style="
            display:grid;
            grid-template-columns:28px 1fr;
            gap:5px;
            align-items:start;
            padding:${index === 0 ? "0 0 4px" : "4px 0 0"};
            ${index === 0 ? "border-bottom:1px solid rgba(255,255,255,0.08);" : ""}
          ">
            <span style="
              display:inline-flex;
              align-items:center;
              justify-content:center;
              min-width:25px;
              border-radius:9999px;
              background:#f59e0b;
              color:#111827;
              font-size:9px;
              font-weight:950;
              line-height:1;
              padding:3px 5px;
              box-shadow:0 5px 12px rgba(245,158,11,0.32);
            ">${escapeInlineMarkerHtml(route.route)}</span>
            <span>
              <span style="display:block;font-size:8px;font-weight:900;line-height:1.15;color:#ffffff;">${route.destination}</span>
              <span style="display:block;margin-top:1px;font-size:7px;font-weight:800;line-height:1.15;color:rgba(226,232,240,0.76);">${escapeInlineMarkerHtml(route.via)}</span>
            </span>
          </div>`).join("")}
          </div>
        </details>`
    : "";
  const staffedBadgeMarkup = staffed
    ? `<span style="
          display:inline-flex;
          align-items:center;
          justify-content:center;
          width:13px;
          height:13px;
          border-radius:9999px;
          background:#f8fafc;
          color:#0f172a;
          border:1px solid rgba(15,23,42,0.88);
          font-size:9px;
          font-weight:950;
          line-height:1;
          box-shadow:0 2px 6px rgba(0,0,0,0.35);
        ">i</span>`
    : "";
  const stationNameMarkup = staffed
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;">${escapedName}${staffedBadgeMarkup}</span>`
    : escapedName;
  const labelStyle = useRotatedPill
    ? `
          margin-bottom:${labelMargin}px;
          color:#ffffff;
          font-size:12px;
          font-weight:800;
          line-height:1.1;
          white-space:nowrap;
          letter-spacing:0.01em;
          display:inline-flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          padding:4px 10px 5px;
          border-radius:9999px;
          background:${color};
          border:1px solid rgba(255,255,255,0.18);
          box-shadow:0 4px 10px rgba(0,0,0,0.38), 0 0 0 1px rgba(15,23,42,0.42);
          transform:rotate(-10deg);
          transform-origin:center;
        `
    : `
          margin-bottom:${labelMargin}px;
          color:#ffffff;
          font-size:12px;
          font-weight:700;
          line-height:1.1;
          white-space:nowrap;
          text-shadow:0 2px 10px rgba(2,6,23,0.95), 0 0 6px rgba(2,6,23,0.85);
          letter-spacing:0.01em;
        `;
  const stationTickMarkup = useRotatedPill
    ? ""
    : `<div style="
          width:3px;
          height:${tickHeight}px;
          background:${color};
          border-radius:999px;
          box-shadow:0 0 0 1px rgba(255,255,255,0.12);
        "></div>
        ${
          endpoint
            ? `<div style="
                width:12px;
                height:12px;
                margin-top:-1px;
                border-radius:999px;
                background:${color};
                border:2px solid rgba(255,255,255,0.95);
                box-shadow:0 0 0 2px rgba(15,23,42,0.92);
              "></div>`
            : ""
        }`;

  return L.divIcon({
    html: `
      <div style="
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:${routeCard.length > 0 ? "flex-start" : useRotatedPill ? "center" : "flex-end"};
        position:relative;
        min-width:${iconWidth}px;
        ${routeCard.length > 0 ? "padding-top:4px;" : ""}
        transform:translateY(${translateY}px);
      ">
        ${routeCardMarkup}
        <div style="${labelStyle}">
          ${stationNameMarkup}
          ${routeTagsMarkup}
        </div>
        ${stationTickMarkup}
      </div>
    `,
    className: "bg-transparent border-none",
    iconSize: [iconWidth, iconHeight],
    iconAnchor: [iconAnchorX, iconAnchorY],
  });
}

function renderTrackDebugMarkers(
  trackName: string,
  points: Array<{ position: [number, number]; index: number }>,
  color: string,
) {
  return points.map((point, labelIndex) => (
    <Marker
      key={`${trackName}-debug-${point.index}`}
      position={point.position}
      icon={createDebugPointIcon(getDebugPointLabel(labelIndex), color)}
      pane="stationPane"
      zIndexOffset={3600}
    >
      <Popup>
        <div className="p-3 w-64">
          <p className="font-semibold text-white">
            {trackName}[{point.index}]
          </p>
          <p className="mt-1 text-xs text-white/70">Label {getDebugPointLabel(labelIndex)}</p>
          <p className="mt-2 text-xs break-all text-white/60">
            [{point.position[0]}, {point.position[1]}]
          </p>
        </div>
      </Popup>
    </Marker>
  ));
}

function formatRouteWindow(time?: string | null) {
  if (!time) {
    return "Unknown";
  }

  return time.slice(0, 5);
}

// GTFS static schedule times use "HH:MM:SS" and can run past "24:00:00" for
// a trip that continues after midnight (real for the overnight XPT legs) —
// wrap those back onto a real 24-hour clock rather than displaying "25:14".
function formatGtfsScheduleTime(time?: string | null) {
  if (!time) return null;
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]) % 24;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

type RegionalServiceStop = {
  time: string;
  name: string;
  platform?: string;
  side?: string;
  note?: string;
  delayMinutes?: number;
};

type RegionalServiceProfile = {
  line: string;
  accent: string;
  serviceType: string;
  origin: string;
  destination: string;
  window: string;
  duration: string;
  platform: string;
  stops: RegionalServiceStop[];
};

const TRARALGON_REGIONAL_PROFILE: RegionalServiceProfile = {
  line: "Traralgon",
  accent: "#7c3aed",
  serviceType: "Express Service",
  origin: "Traralgon",
  destination: "Southern Cross",
  window: "05:54 - 08:15",
  duration: "2h 21m",
  platform: "15",
  stops: [
    { time: "05:54", name: "Traralgon", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "05:59", name: "Morwell Industrial Sidings", note: "Express", delayMinutes: 0 },
    { time: "06:00", name: "Maryvale Sidings", note: "Express", delayMinutes: 0 },
    { time: "06:02", name: "Morwell East", note: "Express", delayMinutes: 0 },
    { time: "06:02", name: "Morwell", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "06:03", name: "Morwell Loop", note: "Express", delayMinutes: 0 },
    { time: "06:04", name: "Morwell Loop West", note: "Express", delayMinutes: 0 },
    { time: "06:07", name: "Herne's Oak", note: "Express", delayMinutes: 0 },
    { time: "06:12", name: "Moe", platform: "1", side: "Left", delayMinutes: 0 },
    { time: "06:12", name: "Moe West Junction", note: "Express", delayMinutes: 0 },
    { time: "06:18", name: "Trafalgar", delayMinutes: 0 },
    { time: "06:24", name: "Yarragon", delayMinutes: 0 },
    { time: "06:32", name: "Warragul", delayMinutes: 0 },
    { time: "06:38", name: "Drouin", delayMinutes: 0 },
    { time: "06:44", name: "Longwarry", platform: "1", side: "Left", delayMinutes: 0 },
    { time: "06:48", name: "Bunyip", platform: "1", side: "Left", delayMinutes: 0 },
    { time: "06:50", name: "Bunyip West", note: "Express", delayMinutes: 0 },
    { time: "06:52", name: "Garfield", delayMinutes: 0 },
    { time: "06:56", name: "Tynong", delayMinutes: 0 },
    { time: "07:00", name: "Nar Nar Goon", delayMinutes: 0 },
    { time: "07:02", name: "Pakenham MTM Boundary", note: "Express", delayMinutes: 0 },
    { time: "07:06", name: "Pakenham East", note: "Express", delayMinutes: 0 },
    { time: "07:08", name: "East Pakenham", note: "Express", delayMinutes: 0 },
    { time: "07:10", name: "Pakenham", platform: "1", side: "Left", delayMinutes: -1 },
    { time: "07:13", name: "Cardinia Road", platform: "1", side: "Left", note: "Express", delayMinutes: -1 },
    { time: "07:14", name: "Officer", platform: "1", side: "Left", note: "Express", delayMinutes: -1 },
    { time: "07:17", name: "Beaconsfield", platform: "1", side: "Right", note: "Express", delayMinutes: -1 },
    { time: "07:19", name: "Berwick", platform: "1", side: "Right", note: "Express", delayMinutes: -1 },
    { time: "07:21", name: "Narre Warren", platform: "1", side: "Left", note: "Express", delayMinutes: -1 },
    { time: "07:23", name: "Hallam", platform: "1", side: "Left", note: "Express", delayMinutes: -1 },
    { time: "07:25", name: "General Motors", side: "Waypoint", delayMinutes: -1 },
    { time: "07:27", name: "Dandenong East Junction", side: "Waypoint", delayMinutes: -1 },
    { time: "07:28", name: "Dandenong", delayMinutes: -1 },
    { time: "07:30", name: "Yarraman", platform: "1", side: "Right", note: "Express", delayMinutes: -1 },
    { time: "07:32", name: "Noble Park", platform: "1", side: "Right", note: "Express", delayMinutes: -1 },
    { time: "07:34", name: "Sandown Park", platform: "1", side: "Right", note: "Express", delayMinutes: -1 },
    { time: "07:35", name: "Springvale", platform: "1", side: "Left", note: "Express", delayMinutes: -1 },
    { time: "07:37", name: "Westall", note: "Express", delayMinutes: 0 },
    { time: "07:39", name: "Clayton", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "07:42", name: "Huntingdale", platform: "1", side: "Right", note: "Express", delayMinutes: 0 },
    { time: "07:45", name: "Oakleigh", platform: "1", side: "Left", note: "Express", delayMinutes: 0 },
    { time: "07:47", name: "Hughesdale", platform: "1", side: "Right", note: "Express", delayMinutes: -1 },
    { time: "07:48", name: "Murrumbeena", platform: "1", side: "Right", note: "Express", delayMinutes: -1 },
    { time: "07:49", name: "Carnegie", platform: "1", side: "Right", note: "Express", delayMinutes: -1 },
    { time: "07:52", name: "Caulfield", delayMinutes: -1 },
    { time: "07:54", name: "Malvern", note: "Express", delayMinutes: -1 },
    { time: "07:56", name: "Armadale", note: "Express", delayMinutes: -1 },
    { time: "07:57", name: "Toorak", note: "Express", delayMinutes: -1 },
    { time: "07:58", name: "Hawksburn", note: "Express", delayMinutes: -1 },
    { time: "08:00", name: "South Yarra", note: "Express", delayMinutes: -1 },
    { time: "08:02", name: "Richmond", delayMinutes: -1 },
    { time: "08:11", name: "Flinders Street", delayMinutes: -6 },
    { time: "08:14", name: "Viaduct Junction", side: "Waypoint", delayMinutes: -2 },
    { time: "08:15", name: "Southern Cross", platform: "15", side: "Right", delayMinutes: 0 },
  ],
};

const WAURN_PONDS_REGIONAL_PROFILE: RegionalServiceProfile = {
  line: "Waurn Ponds",
  accent: "#7c3aed",
  serviceType: "Express Service",
  origin: "Southern Cross",
  destination: "Waurn Ponds",
  window: "14:30 - 15:48",
  duration: "1h 18m",
  platform: "4A",
  stops: [
    { time: "14:30", name: "Southern Cross", platform: "4A", side: "Right", delayMinutes: 1 },
    { time: "14:31", name: "North Melbourne Junction", side: "Waypoint", delayMinutes: 1 },
    { time: "14:33", name: "South Kensington Junction", side: "Waypoint", delayMinutes: 1 },
    { time: "14:34", name: "South Kensington", note: "Express", delayMinutes: 2 },
    { time: "14:38", name: "Footscray", delayMinutes: 3 },
    { time: "14:39", name: "Middle Footscray", platform: "2", side: "Right", note: "Express", delayMinutes: 3 },
    { time: "14:39", name: "West Footscray", platform: "2", side: "Left", note: "Express", delayMinutes: 3 },
    { time: "14:41", name: "Tottenham", platform: "2", side: "Right", note: "Express", delayMinutes: 3 },
    { time: "14:41", name: "White City", side: "Waypoint", delayMinutes: 3 },
    { time: "14:43", name: "Sunshine", delayMinutes: 4 },
    { time: "14:46", name: "Ardeer", note: "Express", delayMinutes: 4 },
    { time: "14:48", name: "Deer Park", delayMinutes: 5 },
    { time: "14:57", name: "Robinsons Road Junction", note: "Express", delayMinutes: 4 },
    { time: "14:57", name: "Tarneit", delayMinutes: 4 },
    { time: "15:04", name: "Wyndham Vale", delayMinutes: 6 },
    { time: "15:12", name: "Little River", delayMinutes: 6 },
    { time: "15:18", name: "Lara", delayMinutes: 6 },
    { time: "15:22", name: "Corio", note: "Express", delayMinutes: 6 },
    { time: "15:24", name: "North Shore", delayMinutes: 6 },
    { time: "15:26", name: "North Geelong A Box", note: "Express", delayMinutes: 6 },
    { time: "15:27", name: "North Geelong", delayMinutes: 7 },
    { time: "15:34", name: "Geelong", delayMinutes: 5 },
    { time: "15:37", name: "South Geelong", delayMinutes: 7 },
    { time: "15:39", name: "Geelong Racecourse", note: "Express", delayMinutes: 7 },
    { time: "15:42", name: "Marshall", delayMinutes: 7 },
    { time: "15:48", name: "Waurn Ponds", delayMinutes: 5 },
  ],
};

const XPT_SYDNEY_PROFILE: RegionalServiceProfile = {
  line: "NSW TrainLink XPT",
  accent: "#d9480f",
  serviceType: "Interstate long-distance service",
  origin: "Southern Cross",
  destination: "Sydney Central",
  window: "19:50 - 06:47",
  duration: "10h 57m",
  platform: "1",
  stops: [
    { time: "19:50", name: "Southern Cross", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "20:16", name: "Broadmeadows", platform: "3", side: "Right", note: "Pick up only", delayMinutes: 0 },
    { time: "21:01", name: "Seymour", platform: "1", side: "Right", note: "Pick up only", delayMinutes: 0 },
    { time: "22:22", name: "Wangaratta", platform: "2", side: "Right", delayMinutes: 0 },
    { time: "23:07", name: "Albury", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "23:36", name: "Culcairn", platform: "1", side: "Right", note: "Request stop", delayMinutes: 0 },
    { time: "23:47", name: "Henty", platform: "1", side: "Right", note: "Request stop", delayMinutes: 0 },
    { time: "00:04", name: "The Rock", platform: "1", side: "Right", note: "Request stop", delayMinutes: 0 },
    { time: "00:22", name: "Wagga Wagga", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "00:48", name: "Junee", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "01:35", name: "Cootamundra", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "02:16", name: "Harden", platform: "1", side: "Right", note: "Request stop", delayMinutes: 0 },
    { time: "03:07", name: "Yass Junction", platform: "1", side: "Right", note: "Request stop", delayMinutes: 0 },
    { time: "03:35", name: "Gunning", platform: "1", side: "Right", note: "Request stop", delayMinutes: 0 },
    { time: "04:13", name: "Goulburn", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "05:01", name: "Moss Vale", platform: "1", side: "Right", delayMinutes: 0 },
    { time: "06:09", name: "Campbelltown", platform: "2", side: "Right", note: "Drop off only", delayMinutes: 0 },
    { time: "06:47", name: "Sydney Central", platform: "1", side: "Right", delayMinutes: 0 },
  ],
};

function getRegionalServiceProfile(vehicle: LiveTrain, snapshot?: ConsistSnapshot): RegionalServiceProfile | null {
  // The current API does not provide a verified stop-by-stop regional timeline.
  void vehicle;
  void snapshot;
  return null;
  /*
  const joined = `${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toLowerCase();

  if (/(xpt|nsw trainlink|sydney central|albury|wagga|cootamundra)/.test(joined)) {
    return {
      ...XPT_SYDNEY_PROFILE,
      origin: snapshot?.current_trip?.origin ?? XPT_SYDNEY_PROFILE.origin,
      destination: snapshot?.current_trip?.destination ?? XPT_SYDNEY_PROFILE.destination,
      window:
        snapshot?.current_trip
          ? `${formatRouteWindow(snapshot.current_trip.departs)} - ${formatRouteWindow(snapshot.current_trip.arrives)}`
          : XPT_SYDNEY_PROFILE.window,
    };
  }

  if (joined.includes("traralgon")) {
    return {
      ...TRARALGON_REGIONAL_PROFILE,
      origin: snapshot?.current_trip?.origin ?? TRARALGON_REGIONAL_PROFILE.origin,
      destination: snapshot?.current_trip?.destination ?? TRARALGON_REGIONAL_PROFILE.destination,
      window:
        snapshot?.current_trip
          ? `${formatRouteWindow(snapshot.current_trip.departs)} - ${formatRouteWindow(snapshot.current_trip.arrives)}`
          : TRARALGON_REGIONAL_PROFILE.window,
    };
  }

  if (joined.includes("waurn ponds")) {
    return {
      ...WAURN_PONDS_REGIONAL_PROFILE,
      origin: snapshot?.current_trip?.origin ?? WAURN_PONDS_REGIONAL_PROFILE.origin,
      destination: snapshot?.current_trip?.destination ?? WAURN_PONDS_REGIONAL_PROFILE.destination,
      window:
        snapshot?.current_trip
          ? `${formatRouteWindow(snapshot.current_trip.departs)} - ${formatRouteWindow(snapshot.current_trip.arrives)}`
          : WAURN_PONDS_REGIONAL_PROFILE.window,
    };
  }

  return null;
  */
}

function getRegionalStopDelayLabel(delayMinutes?: number) {
  if (typeof delayMinutes !== "number") return "0";
  if (delayMinutes === 0) return "0";
  return `${delayMinutes}`;
}

function formatRegionalServiceDate(timestamp?: string) {
  if (!timestamp) return new Date().toLocaleDateString("en-AU");
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return new Date().toLocaleDateString("en-AU");
  return parsed.toLocaleDateString("en-AU");
}

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng);
}

// Leaflet's flyTo throws synchronously ("Invalid LatLng object") when given a
// NaN/undefined coordinate, which live vehicles briefly have before their
// first real GPS fix arrives on the feed — and since flyTo is called from
// effects and click handlers rather than render, that throw isn't caught by
// the app's error boundary until it unwinds, crashing the whole page. Every
// call site that flies to a live vehicle/bus/tram position needs this guard.
function safeFlyTo(map: L.Map | null | undefined, lat: unknown, lng: unknown, zoom: number, options?: L.ZoomPanOptions) {
  if (!map || !isValidLatLng(lat, lng)) return false;
  // The map container can still measure as 0x0 for a moment right after it's
  // mounted or made visible again (e.g. switching from the Fleet Tracker tab
  // straight to a "Track"ed vehicle on the map tab) — flyTo does its own
  // pixel-space projection math to build the pan/zoom animation curve, and
  // that math produces NaN internally when the container has no real size
  // yet, throwing "Invalid LatLng object" past this function's own
  // lat/lng check and crashing the whole app. Recalculate the real size
  // first; if it's still not laid out, jump straight there without the
  // animation curve instead of risking another flyTo on a 0-size container.
  const size = map.getSize();
  if (size.x === 0 || size.y === 0) {
    map.invalidateSize();
    const revalidatedSize = map.getSize();
    if (revalidatedSize.x === 0 || revalidatedSize.y === 0) {
      map.setView([lat, lng], zoom, { animate: false });
      return true;
    }
  }
  map.flyTo([lat, lng], zoom, options);
  return true;
}

function getDistanceInMetres(from: [number, number], to: [number, number]) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const lat1 = toRadians(from[0]);
  const lat2 = toRadians(to[0]);
  const dLat = toRadians(to[0] - from[0]);
  const dLng = toRadians(to[1] - from[1]);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceLabel(distanceMetres: number) {
  if (distanceMetres < 1000) {
    return `${Math.round(distanceMetres)} m away`;
  }

  return `${(distanceMetres / 1000).toFixed(1)} km away`;
}

function isGenericRegionalPlaceholder(value?: string | null) {
  const normalised = value?.trim().toLowerCase() ?? "";
  return !normalised || normalised === "v/line" || normalised === "vline" || normalised === "unknown";
}

function getPolylinePointDistanceMetres(position: [number, number], line: [number, number][]) {
  if (line.length < 2) {
    return line.length === 1 ? getDistanceInMetres(position, line[0]) : Number.POSITIVE_INFINITY;
  }

  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < line.length - 1; index += 1) {
    const projected = projectPointToSegment(position, line[index], line[index + 1]);
    closest = Math.min(closest, getDistanceInMetres(position, projected));
  }
  return closest;
}

function getRegionalFallbackMeta(
  vehicle: Pick<LiveTrain, "lat" | "lng" | "line" | "destination" | "serviceDescription" | "direction" | "tripId">,
) {
  if (!isVlineLiveTrain(vehicle)) {
    return null;
  }

  const cityBound =
    vehicle.direction === "city-bound" ||
    vehicle.direction === "up" ||
    /southern cross|flinders street|melbourne central|flagstaff|parliament|city/i.test(vehicle.destination);

  const codeMeta = getVlineRouteMetaFromTripId(vehicle.tripId, cityBound);
  if (codeMeta) {
    return codeMeta;
  }

  const joined = `${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toLowerCase();

  const explicitMetas = [
    // Albury is served by both V/Line and NSW TrainLink. Only explicit NSW/XPT
    // identity is enough to classify a vehicle as an interstate XPT.
    { match: /(xpt|nsw trainlink|sydney central|campbelltown|goulburn)/, outbound: "Sydney Central", inbound: "Southern Cross", serviceLabel: "NSW TrainLink XPT" },
    { match: /(waurn ponds|geelong|warrnambool)/, outbound: "Waurn Ponds", inbound: "Southern Cross", serviceLabel: "Geelong line" },
    { match: /(ballarat|wendouree|ararat|maryborough)/, outbound: "Ballarat", inbound: "Southern Cross", serviceLabel: "Ballarat line" },
    { match: /(bendigo|castlemaine|echuca|swan hill)/, outbound: "Bendigo", inbound: "Southern Cross", serviceLabel: "Bendigo line" },
    { match: /(seymour|shepparton|albury|wallan|broadford|tallarook)/, outbound: "Seymour", inbound: "Southern Cross", serviceLabel: "Seymour line" },
    { match: /(traralgon|bairnsdale|sale|morwell|moe)/, outbound: "Bairnsdale", inbound: "Southern Cross", serviceLabel: "Gippsland line" },
  ] as const;

  for (const meta of explicitMetas) {
    if (meta.match.test(joined)) {
      return {
        ...meta,
        origin: cityBound ? meta.outbound : meta.inbound,
        destination: cityBound ? meta.inbound : meta.outbound,
      };
    }
  }

  const position: [number, number] = [vehicle.lat, vehicle.lng];
  const inferredMetas = [
    {
      outbound: "Waurn Ponds",
      inbound: "Southern Cross",
      serviceLabel: "Geelong line",
      distance: getPolylinePointDistanceMetres(position, GEELONG_LINE),
    },
    {
      outbound: "Ballarat",
      inbound: "Southern Cross",
      serviceLabel: "Ballarat line",
      distance: getPolylinePointDistanceMetres(position, BALLARAT_LINE),
    },
    {
      outbound: "Maryborough",
      inbound: "Southern Cross",
      serviceLabel: "Maryborough line",
      distance: getPolylinePointDistanceMetres(position, MARYBOROUGH_BRANCH_LINE),
    },
    {
      outbound: "Ararat",
      inbound: "Southern Cross",
      serviceLabel: "Ararat line",
      distance: getPolylinePointDistanceMetres(position, ARARAT_BRANCH_LINE),
    },
    {
      outbound: "Bendigo",
      inbound: "Southern Cross",
      serviceLabel: "Bendigo line",
      distance: getPolylinePointDistanceMetres(position, BENDIGO_REGIONAL_LINE),
    },
    {
      outbound: "Seymour",
      inbound: "Southern Cross",
      serviceLabel: "Seymour line",
      distance: getPolylinePointDistanceMetres(position, SEYMOUR_REGIONAL_LINE),
    },
    {
      outbound: "Bairnsdale",
      inbound: "Southern Cross",
      serviceLabel: "Gippsland line",
      distance: getPolylinePointDistanceMetres(position, GIPPSLAND_LINE),
    },
  ];

  const closest = inferredMetas.sort((left, right) => left.distance - right.distance)[0];
  if (!closest) {
    return null;
  }

  return {
    ...closest,
    origin: cityBound ? closest.outbound : closest.inbound,
    destination: cityBound ? closest.inbound : closest.outbound,
  };
}

function getVehicleServiceSummary(vehicle: LiveTrain) {
  const route = vehicle.serviceDescription?.trim();
  if (route) {
    return route;
  }

  if (isGenericRegionalPlaceholder(vehicle.line) || isGenericRegionalPlaceholder(vehicle.destination)) {
    const regionalMeta = getRegionalFallbackMeta(vehicle);
    if (regionalMeta) {
      return `${regionalMeta.serviceLabel} service to ${regionalMeta.destination}`;
    }
  }

  return `${vehicle.line} to ${vehicle.destination}`.trim();
}

function getVehicleOriginFallback(vehicle: LiveTrain) {
  const summary = getVehicleServiceSummary(vehicle);
  const match = summary.match(/^(.*?)\s+to\s+(.*)$/i);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }

  // NSW TrainLink is interstate — none of the Melbourne-line guesses below
  // (up to and including the "Flinders Street" default) apply to it, and
  // guessing one is actively wrong rather than just imprecise.
  if (isNswTrainLinkLiveTrain(vehicle)) {
    return vehicle.origin || "Origin not published";
  }

  const normalizedLine = vehicle.line.trim().toLowerCase();
  const headingToCity = /city|flinders street|southern cross|parliament|melbourne central|flagstaff|town hall|state library/i.test(
    vehicle.destination,
  );

  if (headingToCity) {
    switch (normalizedLine) {
      case "lilydale":
        return "Lilydale";
      case "belgrave":
        return "Belgrave";
      case "glen waverley":
        return "Glen Waverley";
      case "alamein":
        return "Alamein";
      case "mernda":
        return "Mernda";
      case "hurstbridge":
        return "Hurstbridge";
      case "frankston":
        return "Frankston";
      case "sandringham":
        return "Sandringham";
      case "williamstown":
        return "Williamstown";
      case "werribee":
        return "Werribee";
      case "sunbury":
        return "Sunbury";
      case "cranbourne":
        return "Cranbourne";
      case "pakenham":
        return "Pakenham";
      case "traralgon":
        return "Traralgon";
      case "craigieburn":
        return "Craigieburn";
      case "upfield":
        return "Upfield";
      case "metro tunnel":
        return "Cranbourne / Pakenham";
      case "v/line":
        return getRegionalFallbackMeta(vehicle)?.origin ?? "Regional origin";
      default:
        return `${vehicle.line} origin`;
    }
  }

  switch (normalizedLine) {
    case "metro tunnel":
      return "Sunbury / Watergardens";
    case "v/line":
      return getRegionalFallbackMeta(vehicle)?.origin ?? "Southern Cross";
    case "traralgon":
      return "Southern Cross";
    default:
      return "Flinders Street";
  }
}

function getVehicleStoppingPattern(vehicle: LiveTrain) {
  const summary = getVehicleServiceSummary(vehicle);
  if (/ to /i.test(summary)) {
    return summary;
  }

  if (/(xpt|nsw trainlink|sydney central|albury|wagga|cootamundra)/i.test(`${vehicle.line} ${vehicle.destination}`)) {
    return "NSW TrainLink XPT interstate service to Sydney Central";
  }

  if (/traralgon/i.test(`${vehicle.line} ${vehicle.destination}`)) {
    return "Traralgon express service to Southern Cross";
  }

  if (isGenericRegionalPlaceholder(vehicle.line) || isGenericRegionalPlaceholder(vehicle.destination)) {
    const regionalMeta = getRegionalFallbackMeta(vehicle);
    if (regionalMeta) {
      return `${regionalMeta.serviceLabel} service to ${regionalMeta.destination}`;
    }
  }

  return `${vehicle.line} line service to ${vehicle.destination}`;
}

function getRegionalRestrictionSummary(profile?: RegionalServiceProfile | null) {
  if (!profile) return "";
  const notes = Array.from(
    new Set(
      profile.stops
        .map((stop) => stop.note?.trim())
        .filter((note): note is string => Boolean(note) && !/^express$/i.test(note)),
    ),
  );
  return notes.join(" · ");
}

function getVehicleWindowLabel(snapshot: ConsistSnapshot | undefined, vehicle: LiveTrain) {
  if (snapshot?.current_trip) {
    return `${formatRouteWindow(snapshot.current_trip.departs)}-${formatRouteWindow(snapshot.current_trip.arrives)}`;
  }

  if (snapshot?.next_trip) {
    return `${formatRouteWindow(snapshot.next_trip.departs)}-${formatRouteWindow(snapshot.next_trip.arrives)}`;
  }

  return vehicle.timestamp ? "Live now" : "Waiting";
}

function normaliseVehicleLineText(vehicle: Pick<LiveTrain, "line" | "destination" | "serviceDescription">) {
  return `${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toLowerCase();
}

function getRegionalLayerVisibility(
  vehicle: Pick<LiveTrain, "line" | "destination" | "serviceDescription">,
  layers: LayerState,
) {
  const joined = normaliseVehicleLineText(vehicle);

  // Checked in an order that puts the more specific real town name first so
  // e.g. a real Warrnambool service (which also passes through Geelong-line
  // track) is gated by its own toggle, not lumped under "Geelong".
  if (/warrnambool/i.test(joined)) return layers.warrnamboolLine;
  if (/(waurn ponds|geelong)/i.test(joined)) return layers.geelongLine;
  if (/ararat/i.test(joined)) return layers.araratLine;
  if (/maryborough/i.test(joined)) return layers.maryboroughLine;
  if (/(ballarat|wendouree)/i.test(joined)) return layers.ballaratLine;
  if (/echuca/i.test(joined)) return layers.echucaLine;
  if (/swan hill/i.test(joined)) return layers.swanHillLine;
  if (/(bendigo|castlemaine)/i.test(joined)) return layers.bendigoLine;
  if (/shepparton/i.test(joined)) return layers.sheppartonLine;
  if (/albury/i.test(joined)) return layers.alburyLine;
  if (/(seymour|wallan|broadford|tallarook)/i.test(joined)) return layers.seymourLine;
  if (/bairnsdale/i.test(joined)) return layers.bairnsdaleLine;
  if (/(traralgon|sale|morwell|moe)/i.test(joined)) return layers.traralgonLine;

  return true;
}

function getVehicleLayerVisibility(
  vehicle: Pick<LiveTrain, "line" | "destination" | "serviceDescription" | "trainType">,
  layers: LayerState,
) {
  const joined = normaliseVehicleLineText(vehicle);
  const line = vehicle.line.trim().toLowerCase();

  if (isVlineLiveTrain(vehicle)) {
    return getRegionalLayerVisibility(vehicle, layers);
  }

  if (/stony point/i.test(joined)) return layers.stonyPointLine;
  if (/frankston/i.test(joined)) return layers.frankstonLine;
  if (/(mernda)/i.test(joined)) return layers.merndaLine;
  if (/(hurstbridge)/i.test(joined)) return layers.hurstbridgeLine;
  if (/(craigieburn)/i.test(joined)) return layers.craigieburnLine;
  if (/(upfield)/i.test(joined)) return layers.upfieldLine;
  if (/(lilydale)/i.test(joined)) return layers.lilydaleLine;
  if (/(belgrave)/i.test(joined)) return layers.belgraveLine;
  if (/(alamein)/i.test(joined)) return layers.alameinLine;
  if (/(glen waverley)/i.test(joined)) return layers.glenWaverleyLine;
  if (/(sandringham)/i.test(joined)) return layers.sandringhamLine;
  if (/(werribee|williamstown|altona|newport|laverton)/i.test(joined)) return layers.werribeeLine;
  if (/(sunbury|watergardens)/i.test(joined)) return layers.sunburyLine || layers.metroTunnel;
  if (/(cranbourne)/i.test(joined)) return layers.cranbourneLine || layers.metroTunnel;
  if (/(pakenham|east pakenham)/i.test(joined)) return layers.pakenhamLine || layers.metroTunnel;
  if (/(metro tunnel|town hall|state library|anzac|arden|parkville)/i.test(joined)) return layers.metroTunnel;

  return true;
}

function isRouteIdentifier(value: string) {
  return /^aus:vic:vic-02-[A-Z0-9]+:/i.test(value) || /^vic-02-[A-Z0-9]+:/i.test(value);
}

function isValidConsistPart(part: string) {
  return /^\d{2,4}[A-Z]?$/i.test(part);
}

function normaliseDisplayedConsistParts(consist: string) {
  const trimmed = consist.trim();
  if (!trimmed || isRouteIdentifier(trimmed)) {
    return [];
  }

  const rawParts = trimmed
    .split(/[\s-]+/)
    .map((part) => part.trim())
    .filter((part) => Boolean(part) && !isRouteIdentifier(part) && isValidConsistPart(part));

  const looksLikeHcmt =
    rawParts.length >= 2 &&
    rawParts.every((part) => /^\d{4}M?$/i.test(part));

  const parts = looksLikeHcmt ? rawParts.map((part) => part.replace(/M$/i, "")) : rawParts;
  const trailerCars = parts.filter((part) => /\d+T$/i.test(part));
  const motorCars = parts.filter((part) => /\d+M$/i.test(part));
  const trailersLead =
    trailerCars.length > 0 &&
    parts.slice(0, trailerCars.length).every((part) => /\d+T$/i.test(part)) &&
    parts.slice(trailerCars.length).every((part) => /\d+M$/i.test(part));

  if (trailersLead && motorCars.length === trailerCars.length * 2) {
    const arrangedParts: string[] = [];

    for (let index = 0; index < trailerCars.length; index += 1) {
      const motorOffset = index * 2;
      arrangedParts.push(motorCars[motorOffset], trailerCars[index], motorCars[motorOffset + 1]);
    }

    return arrangedParts.filter(Boolean);
  }

  return parts;
}

function formatDisplayedConsist(parts: string[]) {
  if (parts.length === 6 && parts[1]?.endsWith("T") && parts[4]?.endsWith("T")) {
    return `${parts.slice(0, 3).join("-")}, ${parts.slice(3).join("-")}`;
  }

  if (parts.length === 3 && parts[1]?.endsWith("T")) {
    return parts.join("-");
  }

  return parts.join("-");
}

function getDisplayConsist(consist: string) {
  const trimmed = consist.trim();
  if (!trimmed || /^unknown$/i.test(trimmed) || isRouteIdentifier(trimmed)) {
    return null;
  }

  const parts = normaliseDisplayedConsistParts(trimmed);
  if (parts.length === 0) {
    return null;
  }

  return formatDisplayedConsist(parts);
}

type GeneratedGtfsRoute = {
  id: string;
  shortName: string;
  longName: string;
  color: string;
  shape: readonly (readonly [number, number])[];
  stations: readonly {
    name: string;
    position: readonly [number, number];
    scheduledArrival?: string | null;
    scheduledDeparture?: string | null;
    platform?: string | null;
    pickupType?: string;
    dropOffType?: string;
  }[];
};

// Shared by both the V/Line and NSW TrainLink pattern lookups below: orders
// a route's real GTFS stations along its real shape, dedupes adjacent
// repeats, then flips the order if the vehicle's live destination clearly
// matches the tail end rather than the head (GTFS shapes/stations aren't
// always stored in the vehicle's current direction of travel).
function orderGtfsStationsForVehicle(matchedRoute: GeneratedGtfsRoute, vehicle: LiveTrain): Station[] {
  const ordered = [...matchedRoute.stations]
    .map((station) => {
      let shapeIndex = 0;
      let nearest = Number.POSITIVE_INFINITY;
      matchedRoute.shape.forEach((point, index) => {
        const distance = (point[0] - station.position[0]) ** 2 + (point[1] - station.position[1]) ** 2;
        if (distance < nearest) {
          nearest = distance;
          shapeIndex = index;
        }
      });
      return { ...station, position: [station.position[0], station.position[1]] as [number, number], shapeIndex };
    })
    .sort((left, right) => left.shapeIndex - right.shapeIndex)
    .filter((station, index, stations) => index === 0 || station.name !== stations[index - 1].name)
    .map(({ name, position, scheduledArrival, scheduledDeparture, platform, pickupType, dropOffType }) => ({
      name,
      position,
      scheduledArrival,
      scheduledDeparture,
      platform,
      pickupType,
      dropOffType,
    }));

  const destination = vehicle.destination.toLowerCase().replace(/\s+station\b/g, "");
  const firstMatchesDestination = destination.includes(ordered[0]?.name.toLowerCase().replace(/\s+station\b/g, "") ?? "");
  const lastMatchesDestination = destination.includes(ordered.at(-1)?.name.toLowerCase().replace(/\s+station\b/g, "") ?? "");
  return firstMatchesDestination && !lastMatchesDestination ? ordered.reverse() : ordered;
}

// The Sydney-Melbourne XPT's real stopping pattern, from Transport for NSW's
// own static GTFS schedule (see scripts/import-nsw-trainlink-gtfs.mjs) — the
// same real-data-only approach as V/Line below, just sourced from NSW's
// schedule instead of Victoria's since this service runs almost entirely
// outside Victoria. The down (621/623, to Melbourne) and up (622/624, to
// Sydney) routes share one physical corridor, so direction is picked from
// the vehicle's real destination text, not nearest-shape-point distance
// (which can't tell direction apart on a single shared track).
function getNswTrainLinkGtfsPatternStations(vehicle: LiveTrain): Station[] {
  const destination = vehicle.destination.toLowerCase();
  const towardMelbourne = /melbourne|southern cross/.test(destination);
  const towardSydney = /sydney|central/.test(destination);
  const matchedRoute = GENERATED_NSW_TRAINLINK_GTFS.find((route) =>
    towardMelbourne
      ? /melbourne|southern cross/i.test(route.longName)
      : towardSydney
        ? /sydney|central/i.test(route.longName)
        : false,
  ) ?? GENERATED_NSW_TRAINLINK_GTFS[0];
  if (!matchedRoute) return [];
  return orderGtfsStationsForVehicle(matchedRoute, vehicle);
}

function getRegionalGtfsPatternStations(vehicle: LiveTrain): Station[] {
  if (isNswTrainLinkLiveTrain(vehicle)) {
    return getNswTrainLinkGtfsPatternStations(vehicle);
  }
  if (!isVlineLiveTrain(vehicle)) return [];
  const searchable = `${vehicle.line} ${vehicle.origin ?? ""} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toLowerCase();
  const candidates = GENERATED_VLINE_GTFS.map((route) => {
    const name = `${route.shortName} ${route.longName}`.toLowerCase();
    const nameBonus = searchable.includes(route.shortName.toLowerCase())
      || route.longName.toLowerCase().split(/\s+-\s+|\s+via\s+/).some((part) => part.length > 3 && searchable.includes(part.trim()))
      ? -0.05
      : 0;
    const nearestDistance = route.shape.reduce((best, point) => {
      const distance = (point[0] - vehicle.lat) ** 2 + (point[1] - vehicle.lng) ** 2;
      return Math.min(best, distance);
    }, Number.POSITIVE_INFINITY);
    return { route, score: nearestDistance + nameBonus };
  }).sort((left, right) => left.score - right.score);
  const matchedRoute = candidates[0]?.route;
  if (!matchedRoute) return [];
  return orderGtfsStationsForVehicle(matchedRoute, vehicle);
}

function getLivePositionOnStopTimeline(
  vehicle: { lat: number; lng: number },
  stops: Array<{ name: string; position?: [number, number] }>,
) {
  let closest: { beforeIndex: number; progress: number; distance: number; from: string; to: string } | null = null;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    if (!from.position || !to.position) continue;
    const scale = Math.cos(((from.position[0] + to.position[0]) / 2) * Math.PI / 180);
    const trainX = vehicle.lng * scale;
    const trainY = vehicle.lat;
    const fromX = from.position[1] * scale;
    const fromY = from.position[0];
    const deltaX = to.position[1] * scale - fromX;
    const deltaY = to.position[0] - fromY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    if (lengthSquared === 0) continue;
    const progress = Math.max(0, Math.min(1, ((trainX - fromX) * deltaX + (trainY - fromY) * deltaY) / lengthSquared));
    const distance = (trainX - (fromX + progress * deltaX)) ** 2 + (trainY - (fromY + progress * deltaY)) ** 2;
    if (!closest || distance < closest.distance) closest = { beforeIndex: index + 1, progress, distance, from: from.name, to: to.name };
  }
  return closest;
}

function getLeadingMotorCarriages(consist: string) {
  const parts = normaliseDisplayedConsistParts(consist);
  if (parts.length === 0) return null;

  // A Metro six-car train is formed from two three-car sets. Show the leading
  // motor car from each set instead of squeezing the complete consist into the map pill.
  if (parts.length >= 6) {
    const firstSetLead = parts.slice(0, 3).find((part) => /\d+M$/i.test(part));
    const secondSetLead = parts.slice(3, 6).find((part) => /\d+M$/i.test(part));
    const setLeads = [firstSetLead, secondSetLead].filter((part): part is string => Boolean(part));
    if (setLeads.length > 0) return setLeads.join(" + ");
  }

  const motorCars = parts.filter((part) => /\d+M$/i.test(part));
  return motorCars.length > 0 ? motorCars.slice(0, 2).join(" + ") : null;
}

function getHcmtSetLabel(consist: string) {
  // HCMT end cars are supplied as 90xxM-99xxM. Their shared final two
  // digits identify the fleet set (for example 9059M-9959M is Set 59).
  const matches = [...consist.toUpperCase().matchAll(/\b(?:90|99)(\d{2})M?\b/g)];
  const setNumbers = matches
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  if (setNumbers.length === 0) return null;

  const matchingSet = setNumbers.find((value) => setNumbers.filter((candidate) => candidate === value).length > 1)
    ?? setNumbers[0];
  return `SET ${Number.parseInt(matchingSet, 10)}`;
}

function getSnapshotConsistId(consist: string) {
  const trimmed = consist.trim();
  if (!trimmed || /^unknown$/i.test(trimmed) || isRouteIdentifier(trimmed)) {
    return null;
  }

  const parts = normaliseDisplayedConsistParts(trimmed);
  return parts.length > 0 ? parts.join("-") : null;
}

function normaliseConsistLookupValue(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function splitConsistCars(consist: string) {
  const displayConsist = getDisplayConsist(consist);
  if (!displayConsist) {
    return [];
  }

  if (displayConsist === "430M") {
    return ["369M", "1035T", "370M", "429M", "1065T", "430M"];
  }
  return normaliseDisplayedConsistParts(displayConsist);
}

// Saved layout presets for future TransitAlert consist visualisation work.
// These keep the rough carriage-slot shape we want for Metro 6-car and
// non-Metro-Tunnel 7-car style capacity mockups.
const CONSIST_LAYOUT_PRESETS = {
  metroSixCar: {
    label: "Metro 6-car",
    slotCount: 6,
    activeSlots: [0, 1, 2, 3, 4, 5],
    blockedSlots: [],
    endCars: [0, 5],
  },
  regionalSevenCar: {
    label: "Regional / 7-car",
    slotCount: 10,
    activeSlots: [4, 5, 6, 7, 8, 9],
    blockedSlots: [0, 1, 2, 3],
    endCars: [9],
  },
} as const;

function sortVehiclesByViewportDistance<T extends { lat: number; lng: number }>(
  vehicles: T[],
  bounds: L.LatLngBounds,
) {
  const center = bounds.getCenter();
  return [...vehicles].sort((left, right) => {
    const leftDistance = center.distanceTo(L.latLng(left.lat, left.lng));
    const rightDistance = center.distanceTo(L.latLng(right.lat, right.lng));
    return leftDistance - rightDistance;
  });
}

// EDI/Alstom Comeng sub-split, sourced from VICSIG's current Melbourne fleet
// list (updated 6 August 2026) — VICSIG marks the former M>Train sets with
// (M), which are the EDI-Rail refurbished Comengs; the remaining current
// sets are Alstom refurbished. 51 EDI 3-car sets (102 motor cars) and 49
// Alstom 3-car sets (98 motor cars) as currently in service — this is the
// live fleet as VICSIG lists it, not every Comeng that has ever existed,
// so a withdrawn/scrapped set's old number won't appear in either list.
const ALSTOM_COMENG_MOTOR_NUMBERS = new Set([
  561, 565, 562, 566, 563, 564, 567, 568, 569, 612, 570, 661, 573, 574, 579,
  580, 581, 584, 582, 651, 587, 588, 590, 647, 591, 592, 593, 594, 595, 596,
  599, 600, 601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 662, 615,
  616, 619, 620, 621, 622, 623, 624, 625, 626, 627, 648, 628, 652, 629, 630,
  631, 632, 635, 636, 637, 638, 639, 640, 641, 674, 642, 673, 643, 644, 645,
  646, 653, 654, 655, 656, 657, 658, 659, 660, 663, 664, 665, 666, 667, 668,
  669, 670, 675, 676, 677, 678, 679, 680,
]);
const EDI_COMENG_MOTOR_NUMBERS = new Set([
  324, 342, 327, 349, 328, 464, 329, 366, 335, 387, 343, 384, 351, 352, 353,
  354, 355, 356, 357, 358, 369, 370, 371, 372, 377, 378, 379, 380, 381, 382,
  389, 426, 391, 392, 397, 398, 401, 402, 405, 406, 417, 418, 421, 422, 423,
  424, 429, 430, 431, 432, 433, 434, 443, 444, 455, 456, 457, 458, 471, 472,
  477, 478, 481, 482, 485, 486, 495, 496, 499, 534, 501, 502, 505, 506, 507,
  508, 511, 512, 513, 514, 518, 551, 521, 522, 525, 526, 530, 552, 531, 532,
  535, 536, 541, 542, 543, 544, 545, 546, 547, 548, 549, 550,
]);

function getVehicleFormation(vehicle: LiveTrain) {
  const cars = splitConsistCars(vehicle.consist);
  const trailerCars = cars.filter((car) => /\d+T$/i.test(car));
  const rawCarCount =
    trailerCars.length > 0
      ? trailerCars.length * 3
      : cars.length >= 6
        ? 6
        : cars.length >= 3
          ? 3
          : Math.max(cars.length, 0);
  // A lone 3-car set (one detected trailer, or a bare 3-token consist) never
  // carries passengers on the Metro network by itself — it only ever moves
  // coupled to a matching set for a real 6-car service, or empty out of
  // service. When we can see part of a real consist, floor the count to 6
  // rather than reporting a formation that can't exist in revenue service.
  // Zero stays zero: that means no consist signal at all, not "3 cars".
  const inferredCarCount = rawCarCount > 0 ? Math.max(rawCarCount, 6) : 0;

  const upperTrainType = vehicle.trainType.toUpperCase();
  const upperConsist = vehicle.consist.toUpperCase();
  const joinedCars = cars.join(" ").toUpperCase();

  let family: string | null = null;

  // Real HCMT carriage numbers run 9001-9070 per set, with individual cars in
  // the 90xx/99xx ranges (vicsig.net/suburban/fleet). The live feed usually
  // also says "HCMT" in trainType/consist, but not always (e.g. a generic
  // "Metro Train" trainType) — checking the actual car numbers too means a
  // real HCMT set never gets misreported as a plain "Metro Train" just
  // because the feed's text label happened to be generic that trip.
  // The "M" suffix is optional here: normaliseDisplayedConsistParts() above
  // already strips it from HCMT-shaped 90xx/99xx pairs before this string is
  // built, so matching only "...M" would silently never fire.
  const hasHcmtMotor = /\b9[09]\d{2}M?\b/.test(joinedCars);
  const hasXtrapolis2Motor = /8[1-6]\d{2}M/.test(joinedCars);
  const hasXtrapolisTrailer = /12\d{2}T|13\d{2}T|14\d{2}T|15\d{2}T|16\d{2}T/.test(joinedCars);
  const hasSiemensTrailer = /25\d{2}T/.test(joinedCars);
  const hasComengTrailer = /10\d{2}T|11\d{2}T/.test(joinedCars);

  if (/HCMT/.test(upperTrainType) || /HCMT/.test(upperConsist) || /HCMT/.test(joinedCars) || hasHcmtMotor) {
    family = "HCMT";
  } else if (/X['’]?TRAPOLIS\s*2(\.0)?/.test(upperTrainType) || hasXtrapolis2Motor) {
    family = "X'Trapolis 2.0";
  } else if (/X['’]?TRAPOLIS|XTRAPOLIS/.test(upperTrainType) || hasXtrapolisTrailer) {
    family = "X'Trapolis 100";
  } else if (/SIEMENS/.test(upperTrainType) || hasSiemensTrailer) {
    family = "Siemens Nexas";
  } else if (/COMENG/.test(upperTrainType) || hasComengTrailer || /3\d{2}M|4\d{2}M|5\d{2}M|6\d{2}M/.test(joinedCars)) {
    // Real Comeng carriage numbers (324M-680M motor, 1008T-1190T trailer per
    // VicSig's published fleet roster) run system-wide across every metro
    // line, so this no longer guesses an "EDI" vs "Alstom" split from the
    // line the train happens to be on. The only real EDI/Alstom attribution
    // available (vicsig's Comeng Refurbishment Program pages) is a specific
    // 2000-2003 contractor list covering a minority of the ~100 active sets —
    // matched cars get that label, everything else stays generic "Comeng"
    // rather than being guessed into one side or the other.
    const carMotorNumbers = Array.from(joinedCars.matchAll(/(\d+)M/g)).map((match) => Number(match[1]));
    family = carMotorNumbers.some((n) => ALSTOM_COMENG_MOTOR_NUMBERS.has(n))
      ? "Alstom Comeng"
      : carMotorNumbers.some((n) => EDI_COMENG_MOTOR_NUMBERS.has(n))
        ? "EDI Comeng"
        : "Comeng";
  }
  return {
    family,
    cars: family === "HCMT" ? 7 : inferredCarCount,
  };
}

function getVehicleDisplayType(vehicle: LiveTrain) {
  if (isVlineLiveTrain(vehicle)) {
    return getRegionalTrainTypeLabel(vehicle);
  }

  const formation = getVehicleFormation(vehicle);

  if (formation.family && formation.cars >= 3) {
    return `${formation.family} (${formation.cars}-car)`;
  }

  if (formation.family) {
    return formation.family;
  }

  return vehicle.trainType;
}

function getVehicleTypeIcon(vehicle: LiveTrain) {
  const joined = `${vehicle.line} ${vehicle.destination} ${vehicle.trainType} ${vehicle.consist}`.toLowerCase();
  if (/(xpt|nsw trainlink)/.test(joined)) {
    return "/images/xpt.svg";
  }
  const formation = getVehicleFormation(vehicle);

  switch (formation.family) {
    case "HCMT":
      return hcmtIcon;
    case "Siemens Nexas":
      return siemensIcon;
    case "X'Trapolis 100":
    case "X'Trapolis 2.0":
      return xtrapolisIcon;
    case "Comeng":
    case "EDI Comeng":
    case "Alstom Comeng":
      return comengIcon;
    default:
      return null;
  }
}

export function getVehicleFocusKey(vehicle: Pick<LiveTrain, "consist" | "tdn" | "tripId">) {
  const consist = vehicle.consist.trim();
  if (consist && !/^unknown$/i.test(consist)) return `consist:${consist}`;
  if (vehicle.tripId) return `trip:${vehicle.tripId}`;
  return `tdn:${vehicle.tdn}`;
}

function getDistanceInKm(a: [number, number], b: [number, number]) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(b[0] - a[0]);
  const deltaLng = toRadians(b[1] - a[1]);
  const lat1 = toRadians(a[0]);
  const lat2 = toRadians(b[0]);

  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function createEditorMarkerIcon(isSelected: boolean) {
  return L.divIcon({
    html: `<div style="
      width:26px;
      height:26px;
      border-radius:9999px;
      background:${isSelected ? "#f59e0b" : "#60a5fa"};
      border:3px solid white;
      box-shadow:0 6px 18px rgba(0,0,0,0.55);
      outline:${isSelected ? "6px solid rgba(245, 158, 11, 0.18)" : "4px solid rgba(96, 165, 250, 0.14)"};
    "></div>`,
    className: "bg-transparent border-none",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function createCustomIcon(report: Report) {
  const emoji = TRANSPORT_EMOJI[report.transportType] ?? "📍";
  const color = REPORT_COLOR[report.reportType] ?? "#6b7280";
  const isInspector = report.reportType === "inspector";

  const html = `
    <div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
      ${
        isInspector
          ? `<div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.35;animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>`
          : ""
      }
      <div style="
        width:36px;
        height:36px;
        border-radius:50%;
        background:${color};
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:18px;
        border:2px solid rgba(255,255,255,0.35);
        box-shadow:0 4px 14px rgba(0,0,0,0.6);
        position:relative;
        z-index:1;
      ">${emoji}</div>
    </div>
  `;

  return L.divIcon({
    html,
    className: "bg-transparent border-none",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  });
}

// =========================
// Small Components
// =========================
function ViewportListener({
  onViewportChange,
  onManualMove,
}: {
  onViewportChange: (zoom: number, bounds: L.LatLngBounds) => void;
  onManualMove?: () => void;
}) {
  const map = useMap();
  const viewportCallback = useRef(onViewportChange);
  const manualMoveCallback = useRef(onManualMove);
  viewportCallback.current = onViewportChange;
  manualMoveCallback.current = onManualMove;
  useEffect(() => {
    const updateViewport = () => viewportCallback.current(map.getZoom(), map.getBounds());
    const manualMove = () => manualMoveCallback.current?.();
    updateViewport();
    map.on("zoomend", updateViewport);
    map.on("moveend", updateViewport);
    map.on("dragstart", manualMove);

    return () => {
      map.off("zoomend", updateViewport);
      map.off("moveend", updateViewport);
      map.off("dragstart", manualMove);
    };
  }, [map]);

  return null;
}

function LayerControl({
  layers,
  onChange,
  open,
  onOpenChange,
}: {
  layers: LayerState;
  onChange: (key: keyof LayerState | (keyof LayerState)[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {

  const controls: {
    key: keyof LayerState | (keyof LayerState)[];
    label: string;
    icon: React.ReactNode;
    color: string;
  }[] = [
    
    {
      key: ["werribeeLine", "sandringhamLine"],
      label: "Werribee / Williamstown / Altona / Sandringham",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#F178AF",
    },
    {
      key: "frankstonLine",
      label: "Frankston Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#22c55e",
    },
    {
      key: "stonyPointLine",
      label: "Stony Point Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#028430",
    },
    {
      key: ["merndaLine", "hurstbridgeLine", "cliftonHillLoop"],
      label: "Mernda / Hurstbridge / Clifton Hill",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#BE1014",
    },
    {
      key: ["cranbourneLine", "pakenhamLine", "sunburyLine"],
      label: "Cranbourne / Pakenham / Sunbury",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#279FD5",
    },
    {
      key: ["craigieburnLine", "upfieldLine"],
      label: "Upfield / Craigieburn",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#FFD200",
    },
    {
      key: ["belgraveLine", "lilydaleLine", "alameinLine", "glenWaverleyLine", "burnleyLoop"],
      label: "Belgrave / Lilydale / Alamein / Glen Waverley",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#152C6B",
    },
    {
      key: "geelongLine",
      label: "Geelong Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "warrnamboolLine",
      label: "Warrnambool Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "ballaratLine",
      label: "Ballarat Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "araratLine",
      label: "Ararat Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "maryboroughLine",
      label: "Maryborough Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "bendigoLine",
      label: "Bendigo Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "echucaLine",
      label: "Echuca Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "swanHillLine",
      label: "Swan Hill Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "seymourLine",
      label: "Seymour Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "sheppartonLine",
      label: "Shepparton Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "alburyLine",
      label: "Albury Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "traralgonLine",
      label: "Traralgon Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "bairnsdaleLine",
      label: "Bairnsdale Line",
      icon: <Train className="w-3.5 h-3.5" />,
      color: "#7c3aed",
    },
    {
      key: "inspectors",
      label: "Inspectors",
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
      color: "#e11d48",
    },
    {
      key: "delays",
      label: "Delays",
      icon: <Clock className="w-3.5 h-3.5" />,
      color: "#f59e0b",
    },
    {
      key: "incidents",
      label: "Incidents",
      icon: <Info className="w-3.5 h-3.5" />,
      color: "#3b82f6",
    },
    {
      key: "heatCircles",
      label: "Hotspot Glow",
      icon: <MapPin className="w-3.5 h-3.5" />,
      color: "#f43f5e",
    },
    {
      key: "sydneyTransit",
      label: "Sydney Buses/Trams/Metro",
      icon: <MapPin className="w-3.5 h-3.5" />,
      color: "#0ea5e9",
    },
    // Timetable-estimated only, never live GPS — see createNonPassengerServiceIcon.
    {
      key: "freight",
      label: "Freight (passing, does not stop)",
      icon: <Package className="w-3.5 h-3.5" />,
      color: "#a16207",
    },
    {
      key: "heritage",
      label: "Heritage specials",
      icon: <Landmark className="w-3.5 h-3.5" />,
      color: "#b45309",
    },
    {
      key: "nonPassenger",
      label: "Empty cars / non-passenger",
      icon: <Ban className="w-3.5 h-3.5" />,
      color: "#64748b",
    },
  ];

  return (
    <div className="absolute top-20 right-3 z-[1000] flex flex-col items-end gap-2">
      <button
        onClick={() => onOpenChange(!open)}
        className="w-10 h-10 rounded-full bg-gray-900/90 border border-white/10 shadow-xl flex items-center justify-center text-white hover:bg-gray-800 transition-colors"
        title="Map Layers"
      >
        <Layers className="w-5 h-5" />
      </button>

      {open && (
        <div className="flex max-h-[calc(100vh-11rem)] min-w-[170px] flex-col gap-1.5 overflow-y-auto rounded-2xl border border-white/10 bg-gray-900/95 p-3 shadow-2xl">
          <p className="sticky -top-3 -mx-3 -mt-3 bg-gray-900/95 px-4 pb-1 pt-3 text-[10px] uppercase tracking-widest text-white/40">
            Map Layers
          </p>

          {controls.map(({ key, label, icon, color }) => {
            // A grouped row (e.g. "Northern Group") controls several
            // individual LayerState flags at once so every line that shares
            // a physical corridor toggles together instead of needing N
            // separate rows — it reads as "on" if any member is currently
            // on, matching the same lockstep on/off convention already used
            // by the service-filter groups elsewhere on the map.
            const isOn = Array.isArray(key) ? key.some((k) => layers[k]) : layers[key];
            return (
              <button
                key={Array.isArray(key) ? key.join("+") : key}
                onClick={() => onChange(key)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  isOn
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/60 hover:bg-white/5"
                }`}
              >
                <span style={{ color: isOn ? color : undefined }}>
                  {icon}
                </span>
                <span>{label}</span>
                <span className="ml-auto">
                  {isOn ? (
                    <Eye className="w-3.5 h-3.5 text-white/50" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-white/20" />
                  )}
                </span>
              </button>
            );
          })}

          <div className="border-t border-white/10 mt-1 pt-2">
            <p className="text-[10px] text-white/30 px-1">Filter by Transport</p>
            <div className="flex gap-1.5 mt-1.5 flex-wrap px-1">
              {Object.entries(TRANSPORT_EMOJI).map(([type, emoji]) => (
                <span
                  key={type}
                  title={type}
                  className="text-base cursor-default select-none"
                >
                  {emoji}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================
// Main Component
// =========================
export function Map({
  journeyRoute = [],
  journeyLegSegments = [],
  journeyBusRoutes = [],
  splitCrossCityGroup = false,
  transportModes = [...DEFAULT_TRANSPORT_MODES],
  onTransportModesChange,
  persistedLayerState,
  onLayerStateChange,
  isAdmin = false,
  isGuest = false,
  isPremium = false,
  premiumPaypalLink = "",
  favouriteConsists = [],
  onToggleFavouriteConsist,
  showFilterRail = true,
  focusedVehicleKey = null,
  onFocusedVehicleHandled,
  debugLineKey = "none",
  mobilePerformanceMode = "auto",
}: MapProps = {}) {
  const isMobile = useIsMobile();
  const isIos =
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/i.test(navigator.userAgent);
  const mobilePerformanceEnabled =
    mobilePerformanceMode === "on" || (mobilePerformanceMode === "auto" && isMobile);
  const aggressiveMobileProtectionEnabled = mobilePerformanceEnabled || isIos;
  const iosLeanMapEnabled = isIos && mobilePerformanceMode !== "off";
  const mapRef = useRef<L.Map | null>(null);
  const lastEmittedLayerStateRef = useRef<LayerState | null>(null);
  const lastAppliedPersistedLayerStateRef = useRef<Partial<LayerState> | null>(null);
  const consistData = { active: false } as any;
  const [trainLookupQuery, setTrainLookupQuery] = useState("");
  const [trainLookupMessage, setTrainLookupMessage] = useState("");
  const [isMobileMapKeyOpen, setIsMobileMapKeyOpen] = useState(false);
  const [isNearbyStopsOpen, setIsNearbyStopsOpen] = useState(false);
  const [activeSurfaceRouteFilters, setActiveSurfaceRouteFilters] = useState<string[]>(
    () => SURFACE_ROUTE_FILTERS.map((filter) => filter.key),
  );
  const [mapZoom, setMapZoom] = useState(13);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const viewportBoundsQuery = useMemo(() => {
    const sourceBounds = mapBounds?.pad(aggressiveMobileProtectionEnabled ? 0.14 : 0.35) ?? L.latLngBounds([-38.25, 144.35], [-37.45, 145.55]);
    return {
      minLat: Number(sourceBounds.getSouth().toFixed(5)),
      maxLat: Number(sourceBounds.getNorth().toFixed(5)),
      minLng: Number(sourceBounds.getWest().toFixed(5)),
      maxLng: Number(sourceBounds.getEast().toFixed(5)),
    };
  }, [aggressiveMobileProtectionEnabled, mapBounds]);
  const allowMobileHeavySurfaceTracking = !aggressiveMobileProtectionEnabled || mapZoom >= 12.5;
  // Keep the train query alive at every zoom. Pausing it on iPhone while the
  // user zoomed out left the fleet frozen and stale when they zoomed back in.
  const allowMobileHeavyTrainTracking = true;
  const allowIosSurfaceStops = !iosLeanMapEnabled || mapZoom >= 15.8;
  const allowIosFreightLayer = !iosLeanMapEnabled || mapZoom >= 13.2;
  const allowIosReportLayer = !iosLeanMapEnabled || mapZoom >= 14.8;
  const allowDenseSurfaceStops = mapZoom >= 17;
  const allBusStops = useAllBusStops(allowDenseSurfaceStops);
  // Tram platforms are small and useful at neighbourhood zoom. Keep the
  // heavier bus-stop layer at the old close-zoom threshold, but expose every
  // tram stop much earlier and cull it to the visible viewport.
  const allowTramStops = mapZoom >= 14.25;
  const visibleViewportBounds = useMemo(
    () =>
      L.latLngBounds(
        [viewportBoundsQuery.minLat, viewportBoundsQuery.minLng],
        [viewportBoundsQuery.maxLat, viewportBoundsQuery.maxLng],
      ),
    [viewportBoundsQuery],
  );
  // Station markers are cheap static divIcons, not a live-data fetch, so cull
  // them against a much more generous pad than the live-vehicle query bounds
  // above. The tight 0.14 mobile pad on visibleViewportBounds exists to limit
  // API payload size; reusing it here made stations just past the edge of a
  // phone's small viewport disappear entirely until the user panned further,
  // which read as "this station has no marker" even though it was rendering
  // correctly a few hundred metres off-screen.
  const stationMarkerBounds = useMemo(
    () => mapBounds?.pad(0.35) ?? L.latLngBounds([-38.25, 144.35], [-37.45, 145.55]),
    [mapBounds],
  );
  const stationMarkerVisibleBounds = aggressiveMobileProtectionEnabled ? stationMarkerBounds : null;
  const selectedAdminDebugOverlay = useMemo(() => {
    switch (debugLineKey) {
      case "glenWaverleyLine":
        return renderTrackDebugMarkers("GLEN_WAVERLEY_LINE", GLEN_WAVERLEY_DEBUG_TRACK_POINTS, "#93c5fd");
      case "bairnsdaleLine":
        return renderTrackDebugMarkers("BAIRNSDALE_LINE", BAIRNSDALE_DEBUG_TRACK_POINTS, "#c4b5fd");
      case "cliftonHillLoop":
        return renderTrackDebugMarkers("CLIFTON_HILL_LOOP", CLIFTON_HILL_DEBUG_TRACK_POINTS, "#fda4af");
      case "northernLoop":
        return renderTrackDebugMarkers("NORTHERN_LOOP", NORTHERN_DEBUG_TRACK_POINTS, "#fde68a");
      case "caulfieldLoop":
        return renderTrackDebugMarkers("CAULFIELD_LOOP", CAULFIELD_DEBUG_TRACK_POINTS, "#86efac");
      default:
        return null;
    }
  }, [debugLineKey]);

  const { data } = useGetReports({
    query: { refetchInterval: 30000 },
  });

  // Declared ahead of the layers useState below (which the Sydney toggle
  // lives on) purely so it's available as this early query's `enabled` gate;
  // kept in sync with layers.sydneyTransit via a useEffect further down.
  const [sydneyTransitEnabled, setSydneyTransitEnabled] = useState(false);
  const { data: sydneyTransitData } = useQuery({
    queryKey: ["/api/ptv/sydney-transit"],
    queryFn: () => fetchSydneyTransit(),
    enabled: sydneyTransitEnabled,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 5_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
  });

  const {
    data: liveVehiclesRaw = [],
    isLoading: isLiveTrainsLoading,
    error: liveTrainsError,
  } = useQuery({
    // Keep one stable fleet in memory while the user pans. Viewport-scoped
    // requests made trains disappear then reappear on every map movement.
    queryKey: ["/api/ptv/live-trains", "full-fleet"],
    queryFn: async () => {
      const trains = await fetchLiveTrains();
      saveLiveTrainMapCache(trains);
      return trains;
    },
    initialData: readInitialLiveTrainMapCache,
    enabled:
      allowMobileHeavyTrainTracking &&
      (transportModes.includes("train") || transportModes.includes("vline")),
    // Poll consistently while the map is open. The server coalesces callers
    // into one short-lived feed cache, so this follows movement without a
    // request burst from every marker or map pan.
    refetchInterval: aggressiveMobileProtectionEnabled ? 15_000 : 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 0,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
  });
  const { data: feedStatus } = useQuery({
    queryKey: ["/api/feed-status"],
    queryFn: async () => {
      const response = await fetch("/api/feed-status");
      if (!response.ok) throw new Error("Feed status unavailable");
      return response.json() as Promise<{
        gtfsSchedule?: { installed?: boolean };
        gtfsRealtime?: { configured?: boolean };
      }>;
    },
    staleTime: 60_000,
    retry: false,
  });
  const {
    data: liveBusesRaw = [],
    isLoading: isLiveBusesLoading,
  } = useQuery({
    // Viewport changes must not swap the whole cached fleet. Fetch one stable
    // snapshot and perform viewport filtering only when rendering markers.
    queryKey: ["/api/ptv/live-buses", "full-fleet"],
    queryFn: () => fetchLiveBuses(),
    enabled:
      transportModes.includes("bus") &&
      allowMobileHeavySurfaceTracking,
    refetchInterval: aggressiveMobileProtectionEnabled ? 45_000 : 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: aggressiveMobileProtectionEnabled ? 30_000 : 5_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
  });
  const {
    data: liveTramsRaw = [],
    isLoading: isLiveTramsLoading,
  } = useQuery({
    queryKey: ["/api/ptv/live-trams", viewportBoundsQuery],
    queryFn: () => fetchLiveTrams(viewportBoundsQuery),
    // Each viewport is a new cache key; keep showing the previous trams
    // while the new area loads instead of every tram blinking out per pan.
    placeholderData: keepPreviousData,
    enabled:
      transportModes.includes("tram") &&
      allowMobileHeavySurfaceTracking,
    refetchInterval: aggressiveMobileProtectionEnabled ? 45_000 : 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: aggressiveMobileProtectionEnabled ? 30_000 : 5_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
  });
  const { data: featuredConsistSnapshot } = useQuery({
    queryKey: ["consist-snapshot", FEATURED_CONSIST, "featured-marker"],
    queryFn: () => fetchConsistSnapshot(FEATURED_CONSIST),
    enabled: !isGuest,
    refetchInterval: 30000,
    retry: false,
  });

  // Sydney data is additive and only ever present while the layer is on
  // (sydneyTransitEnabled gates the fetch itself) — everything downstream
  // keeps using liveVehicles/liveBuses/liveTrams unchanged either way.
  const liveVehicles = useMemo(
    () => (sydneyTransitData?.trains.length ? [...liveVehiclesRaw, ...sydneyTransitData.trains] : liveVehiclesRaw),
    [liveVehiclesRaw, sydneyTransitData],
  );
  const liveBuses = useMemo(
    () => (sydneyTransitData?.buses.length ? [...liveBusesRaw, ...sydneyTransitData.buses] : liveBusesRaw),
    [liveBusesRaw, sydneyTransitData],
  );
  const liveTrams = useMemo(
    () => (sydneyTransitData?.trams.length ? [...liveTramsRaw, ...sydneyTransitData.trams] : liveTramsRaw),
    [liveTramsRaw, sydneyTransitData],
  );

  const reports = Array.isArray(data) ? data : [];
  const [selectedDetail, setSelectedDetail] = useState<
    | { type: "station"; station: Station }
    | { type: "vehicle"; vehicle: LiveTrain }
    | { type: "bus"; bus: LiveBus }
    | { type: "tram"; tram: LiveTram }
    | { type: "surfaceStop"; stop: SurfaceStop }
    | { type: "report"; report: Report }
    | null
  >(null);
  const [selectedBoardServiceContext, setSelectedBoardServiceContext] = useState<{
    vehicleKey: string;
    tdn: string;
    origin: string;
    destination: string;
  } | null>(null);
  const [selectedStationService, setSelectedStationService] = useState<VerifiedDeparture | null>(null);
  const [serviceTripToFit, setServiceTripToFit] = useState<string | null>(null);
  const [showPriorStops, setShowPriorStops] = useState(false);
  // Which real platform groups are collapsed in a multi-platform station's
  // departure card (Dandenong-style) — keyed by platform number string,
  // default expanded (not present in the set) to match the reference layout.
  const [collapsedPlatformGroups, setCollapsedPlatformGroups] = useState<Set<string>>(new Set());
  const [isSurfaceStopPanelCollapsed, setIsSurfaceStopPanelCollapsed] = useState(false);
  const [followSelectedService, setFollowSelectedService] = useState(false);
  const selectedVehicleSeed = selectedDetail?.type === "vehicle" ? selectedDetail.vehicle : null;
  const selectedBusSeed = selectedDetail?.type === "bus" ? selectedDetail.bus : null;
  const selectedTramSeed = selectedDetail?.type === "tram" ? selectedDetail.tram : null;
  const selectedVehicleLive = selectedVehicleSeed
    ? liveVehicles.find((vehicle) => vehicle.tripId === selectedVehicleSeed.tripId || getVehicleFocusKey(vehicle) === getVehicleFocusKey(selectedVehicleSeed)) ?? selectedVehicleSeed
    : null;
  const selectedVehicle = selectedVehicleLive && selectedBoardServiceContext?.vehicleKey === getVehicleFocusKey(selectedVehicleLive)
    ? {
        ...selectedVehicleLive,
        origin: selectedBoardServiceContext.origin,
        destination: selectedBoardServiceContext.destination,
        serviceDescription: `${selectedVehicleLive.line} · ${selectedBoardServiceContext.origin} → ${selectedBoardServiceContext.destination}`,
      }
    : selectedVehicleLive;
  const selectedBus = selectedBusSeed
    ? liveBuses.find((bus) => bus.tripId === selectedBusSeed.tripId || bus.id === selectedBusSeed.id) ?? selectedBusSeed
    : null;
  const selectedTram = selectedTramSeed
    ? liveTrams.find((tram) => tram.tripId === selectedTramSeed.tripId || tram.id === selectedTramSeed.id) ?? selectedTramSeed
    : null;
  const selectedStation = selectedDetail?.type === "station" ? selectedDetail.station : null;
  const selectedFollowTarget = selectedVehicle ?? selectedBus ?? selectedTram;

  // Opening a live service should immediately frame the vehicle and keep it in view.
  // Fitting an entire trip here can jump the map hundreds of kilometres when a feed
  // contains one malformed stop coordinate (for example a metro run near Seymour).
  const selectedFollowIdentity = selectedFollowTarget
    ? `${selectedDetail?.type}:${selectedFollowTarget.tripId ?? selectedFollowTarget.id}`
    : null;
  const keepTrackedVehicleInVisibleMap = useCallback((lat: number, lng: number, animate = true) => {
    const map = mapRef.current;
    if (!map) return;
    const target = L.latLng(lat, lng);
    const size = map.getSize();
    const desiredPoint = L.point(
      size.x / 2,
      // The bottom service sheet occupies most of a phone screen. Put the
      // tracked marker high in the remaining map strip, not near its edge.
      window.innerWidth < 768 ? Math.min(185, Math.max(125, size.y * 0.13)) : size.y * 0.4,
    );
    const currentPoint = map.latLngToContainerPoint(target);
    const offset = currentPoint.subtract(desiredPoint);
    if (offset.distanceTo(L.point(0, 0)) < 10) return;
    map.panBy(offset, { animate, duration: animate ? 0.4 : 0 });
  }, []);

  useEffect(() => {
    if (!selectedFollowTarget || !mapRef.current) return;
    if (!isValidLatLng(selectedFollowTarget.lat, selectedFollowTarget.lng)) return;
    setFollowSelectedService(true);
    const map = mapRef.current;
    // Removed on cleanup: picking another vehicle mid-fly used to leave this
    // handler behind, and it then panned back to the first vehicle.
    const handleMoveEnd = () => {
      const target = selectedFollowTargetRef.current;
      if (!target || !isValidLatLng(target.lat, target.lng)) return;
      keepTrackedVehicleInVisibleMap(target.lat, target.lng, true);
    };
    map.once("moveend", handleMoveEnd);
    safeFlyTo(map, selectedFollowTarget.lat, selectedFollowTarget.lng, Math.max(map.getZoom(), 15), { animate: true, duration: 0.75 });
    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [keepTrackedVehicleInVisibleMap, selectedFollowIdentity]);

  // A one-off effect keyed on lat/lng can miss corrections if a render is
  // skipped or a position update arrives mid-animation. Poll instead, so the
  // map keeps nudging back to the tracked vehicle for as long as follow stays on.
  const selectedFollowTargetRef = useRef(selectedFollowTarget);
  selectedFollowTargetRef.current = selectedFollowTarget;
  useEffect(() => {
    if (!followSelectedService) return;
    const intervalId = window.setInterval(() => {
      const target = selectedFollowTargetRef.current;
      if (!target || !mapRef.current || !isValidLatLng(target.lat, target.lng)) return;
      keepTrackedVehicleInVisibleMap(target.lat, target.lng, true);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [followSelectedService, keepTrackedVehicleInVisibleMap]);

  useEffect(() => {
    if (!selectedFollowTarget) setFollowSelectedService(false);
  }, [selectedFollowTarget]);
  const selectedVehicleKey = selectedVehicle ? getVehicleFocusKey(selectedVehicle) : null;
  const selectedVehicleMetroStops = (() => {
      if (!selectedVehicle) return [];
      const mappedStops = getMetroStoppingPatternStations(selectedVehicle);
      if (mappedStops.length > 0) return mappedStops;

      const currentName = "Current vehicle position";
      const destinationName = selectedVehicle.destination || "Destination not published";
      const fallbackStops: Station[] = [
        { name: currentName, position: [selectedVehicle.lat, selectedVehicle.lng] },
      ];
      if (destinationName.toLowerCase() !== currentName.toLowerCase()) {
        fallbackStops.push({
          name: destinationName,
          position: findStationCoordinate(destinationName) ?? [selectedVehicle.lat, selectedVehicle.lng],
        });
      }
      return fallbackStops;
  })();
  const selectedSurfaceStop = selectedDetail?.type === "surfaceStop" ? selectedDetail.stop : null;
  useEffect(() => {
    setIsSurfaceStopPanelCollapsed(false);
  }, [selectedSurfaceStop?.id]);
  const selectedSurfaceScheduleMode = selectedSurfaceStop?.modes.includes("bus") ? "bus" as const : selectedSurfaceStop?.modes.includes("tram") ? "tram" as const : null;
  const {
    data: selectedSurfaceStopDepartures,
    isLoading: isSurfaceStopDeparturesLoading,
    error: surfaceStopDeparturesError,
  } = useQuery({
    queryKey: ["verified-surface-stop-departures", selectedSurfaceScheduleMode, selectedSurfaceStop?.routeLabel, selectedSurfaceStop?.position],
    queryFn: () => fetchSurfaceStopDepartures({
      mode: selectedSurfaceScheduleMode!,
      route: selectedSurfaceStop!.routeLabel,
      lat: selectedSurfaceStop!.position[0],
      lng: selectedSurfaceStop!.position[1],
    }),
    enabled: Boolean(selectedSurfaceStop && selectedSurfaceScheduleMode),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 20_000,
    retry: 2,
  });
  const fallbackSelectedTramStops = (() => {
    if (!selectedTram) return [];
    const route = normaliseSurfaceRouteLabel(selectedTram.route);
    if (route === "67") {
      const destination = selectedTram.destination?.toLowerCase() ?? "";
      const headsToUniversity = /university|city/.test(destination) ||
        (!destination && typeof selectedTram.heading === "number" && (selectedTram.heading >= 270 || selectedTram.heading <= 90));
      return headsToUniversity ? ROUTE_67_UNIVERSITY_SURFACE_STOPS : ROUTE_67_CARNEGIE_SURFACE_STOPS;
    }
    return Array.from(
      new globalThis.Map(
        ANYTRIP_SURFACE_STOPS
          .filter(
            (stop) => stop.modes.includes("tram") && normaliseSurfaceRouteLabel(stop.routeLabel) === route,
          )
          .map((stop) => [stop.name, stop]),
      ).values(),
    );
  })();
  const {
    data: selectedTramTrip,
    isLoading: isTramTripLoading,
    error: tramTripError,
  } = useQuery({
    queryKey: ["verified-tram-trip", selectedTram?.tripId],
    queryFn: () => fetchTramTrip(selectedTram!.tripId!),
    enabled: Boolean(selectedTram?.tripId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 20_000,
    retry: 3,
  });
  const selectedTramStops: TramPatternStop[] = selectedTramTrip?.stops.length
    ? selectedTramTrip.stops.map((stop) => ({
        ...stop,
        position: typeof stop.lat === "number" && typeof stop.lng === "number"
          ? [stop.lat, stop.lng] as [number, number]
          : undefined,
      }))
    : fallbackSelectedTramStops.map((stop) => ({ name: stop.name, position: stop.position }));
  const selectedTramCurrentStopIndex = (() => {
    if (!selectedTram || selectedTramStops.length === 0) return -1;
    // A dated trip update knows whether a tram has passed a stop. Prefer it to
    // proximity: a tram can be physically close to its next stop while still
    // approaching, and must not be shown as already dwelling there.
    if (selectedTramTrip?.stops.length) {
      const nextIndex = selectedTramTrip.stops.findIndex((stop) => stop.status === "upcoming");
      return nextIndex >= 0 ? nextIndex : selectedTramTrip.stops.length - 1;
    }
    return selectedTramStops.reduce((bestIndex, stop, index, stops) => {
      if (!stop.position) return bestIndex;
      const distance = (stop.position[0] - selectedTram.lat) ** 2 + (stop.position[1] - selectedTram.lng) ** 2;
      const best = stops[bestIndex];
      if (!best.position) return index;
      const bestDistance = (best.position[0] - selectedTram.lat) ** 2 + (best.position[1] - selectedTram.lng) ** 2;
      return distance < bestDistance ? index : bestIndex;
    }, 0);
  })();
  const selectedTramLiveTimelinePosition = selectedTram
    ? getLivePositionOnStopTimeline(selectedTram, selectedTramStops)
    : null;
  const selectedTramVisibleStops = selectedTramStops
    .map((stop, index) => ({ stop, index }))
    .slice(showPriorStops ? 0 : selectedTramCurrentStopIndex > 0 ? selectedTramCurrentStopIndex - 1 : 0);
  const selectedTramDestination = selectedTram?.destination ||
    selectedTramStops.at(-1)?.name.replace(/\/.*$/, "").replace(/\s+#\d+.*$/, "") ||
    undefined;
  const {
    data: selectedStationDepartures,
    isLoading: isStationDeparturesLoading,
    error: stationDeparturesError,
  } = useQuery({
    queryKey: ["verified-station-departures", selectedStation?.name],
    queryFn: () => fetchStationDepartures(selectedStation!.name),
    enabled: Boolean(selectedStation?.name),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 20_000,
    retry: 3,
  });
  const {
    data: selectedBusTrip,
    isLoading: isBusTripLoading,
    error: busTripError,
  } = useQuery({
    queryKey: ["verified-bus-trip", selectedBus?.tripId],
    queryFn: () => fetchBusTrip(selectedBus!.tripId!),
    enabled: Boolean(selectedBus?.tripId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 20_000,
    retry: 3,
  });
  const selectedBusCurrentStopIndex = selectedBus && selectedBusTrip?.stops.length
    ? selectedBusTrip.stops.reduce((bestIndex, stop, index, stops) => {
        if (typeof stop.lat !== "number" || typeof stop.lng !== "number") return bestIndex;
        const best = stops[bestIndex];
        if (typeof best?.lat !== "number" || typeof best?.lng !== "number") return index;
        const distance = (stop.lat - selectedBus.lat) ** 2 + (stop.lng - selectedBus.lng) ** 2;
        const bestDistance = (best.lat - selectedBus.lat) ** 2 + (best.lng - selectedBus.lng) ** 2;
        return distance < bestDistance ? index : bestIndex;
      }, 0)
    : -1;
  const selectedBusLiveTimelinePosition = selectedBus && selectedBusTrip?.stops.length
    ? getLivePositionOnStopTimeline(selectedBus, selectedBusTrip.stops.map((stop) => ({
        name: stop.name,
        position: typeof stop.lat === "number" && typeof stop.lng === "number"
          ? [stop.lat, stop.lng] as [number, number]
          : undefined,
      })))
    : null;
  const selectedBusVisibleStops = selectedBusTrip?.stops
    ? selectedBusTrip.stops
        .map((stop, index) => ({ stop, index }))
        .slice(showPriorStops ? 0 : selectedBusCurrentStopIndex > 0 ? selectedBusCurrentStopIndex - 1 : 0)
    : [];
  // The verified-trip lookup below queries Victoria's own static GTFS by
  // tripId. NSW TrainLink tripIds (interstate, a completely different feed)
  // have no legitimate entry there, so any "match" is a false positive on an
  // unrelated Victorian trip — seen in practice as a Brisbane-Sydney XPT
  // showing Albury-line V/Line stations as its "stopping pattern". Skip the
  // lookup entirely for those rather than let it attach the wrong timetable.
  const activeTrainTripId =
    selectedVehicle && isNswTrainLinkLiveTrain(selectedVehicle)
      ? null
      : selectedVehicle?.tripId ?? selectedStationService?.tripId ?? null;
  const {
    data: selectedTrainTrip,
    isLoading: isTrainTripLoading,
    error: trainTripError,
  } = useQuery({
    queryKey: ["verified-train-trip", activeTrainTripId],
    queryFn: () => fetchTrainTrip(activeTrainTripId!),
    enabled: Boolean(activeTrainTripId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 20_000,
    retry: 3,
  });
  useEffect(() => {
    if (!serviceTripToFit || selectedTrainTrip?.tripId !== serviceTripToFit || !mapRef.current) return;
    if (selectedVehicle) {
      const map = mapRef.current;
      if (isValidLatLng(selectedVehicle.lat, selectedVehicle.lng)) {
        map.once("moveend", () => {
          keepTrackedVehicleInVisibleMap(selectedVehicle.lat, selectedVehicle.lng, true);
        });
        safeFlyTo(map, selectedVehicle.lat, selectedVehicle.lng, Math.max(map.getZoom(), 15), { animate: true, duration: 0.75 });
      }
      setFollowSelectedService(true);
      setServiceTripToFit(null);
      return;
    }
    const coordinates = selectedTrainTrip.stops
      .filter((stop) => typeof stop.lat === "number" && typeof stop.lng === "number")
      .map((stop) => [stop.lat!, stop.lng!] as [number, number]);
    // Keep station-board trip fitting within metropolitan Melbourne and reject
    // isolated bad coordinates before calculating the bounds.
    const metroCoordinates = coordinates.filter(([lat, lng]) =>
      lat >= -38.5 && lat <= -37.35 && lng >= 144.3 && lng <= 146.2
    );
    if (metroCoordinates.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(metroCoordinates), {
        animate: true,
        duration: 0.9,
        paddingTopLeft: [28, 90],
        paddingBottomRight: [28, 150],
        maxZoom: 14,
      });
    } else if (metroCoordinates.length === 1) {
      mapRef.current.flyTo(metroCoordinates[0], 15, { animate: true, duration: 0.85 });
    }
    setServiceTripToFit(null);
  }, [keepTrackedVehicleInVisibleMap, selectedTrainTrip, serviceTripToFit, selectedVehicle]);
  const selectedVehiclePatternStops: Station[] = selectedTrainTrip?.stops.length
    ? selectedTrainTrip.stops.map((stop) => ({
        name: stop.name,
        position:
          typeof stop.lat === "number" && typeof stop.lng === "number"
            ? [stop.lat, stop.lng]
            : findStationCoordinate(stop.name) ?? selectedStation?.position ??
              (selectedVehicle ? [selectedVehicle.lat, selectedVehicle.lng] : [-37.8184, 144.9665]),
      }))
    // A regional vehicle without a matched GTFS trip must not inherit a metro
    // line pattern. That created false stops such as a next stop named “V/Line”.
    : selectedVehicle && (isVlineLiveTrain(selectedVehicle) || isNswTrainLinkLiveTrain(selectedVehicle))
      ? getRegionalGtfsPatternStations(selectedVehicle)
      : selectedVehicleMetroStops;
  const selectedVerifiedHeadingStops: Station[] | undefined = selectedTrainTrip?.stops.flatMap((stop) => {
    const position: [number, number] | null = typeof stop.lat === "number" && typeof stop.lng === "number"
      ? [stop.lat, stop.lng]
      : findStationCoordinate(stop.name);
    return position ? [{ name: stop.name, position }] : [];
  });
  const selectedVehicleSnapshotConsist = selectedVehicle ? getSnapshotConsistId(selectedVehicle.consist) : null;
  const { data: selectedVehicleSnapshot } = useQuery({
    queryKey: ["consist-snapshot", selectedVehicleSnapshotConsist],
    queryFn: () => fetchConsistSnapshot(selectedVehicleSnapshotConsist!),
    enabled: Boolean(selectedVehicleSnapshotConsist),
    refetchInterval: 30000,
    retry: false,
  });
  const selectedRegionalProfile = selectedVehicle
    ? getRegionalServiceProfile(selectedVehicle, selectedVehicleSnapshot)
    : null;
  const selectedVehicleIsHcmtMetroTunnel = Boolean(
    selectedVehicle &&
      (/HCMT/i.test(getVehicleDisplayType(selectedVehicle)) ||
        (/metro tunnel|special/i.test(selectedVehicle.line) &&
          selectedTrainTrip?.stops.some((stop) => /town hall/i.test(stop.name)))),
  );
  const selectedTrainFormationSegments = selectedTrainTrip?.formationSegments?.length
    ? selectedTrainTrip.formationSegments
    : selectedTrainTrip?.segments ?? [];
  const selectedTrainFormationOriginRaw = selectedTrainFormationSegments[0]?.origin
    ?.replace(/\s+Station$/i, "");
  const selectedTrainFormationDestinationRaw = selectedTrainFormationSegments.at(-1)?.destination
    ?.replace(/\s+Station$/i, "")
    .replace(/\s+via\s+.+$/i, "");
  // A City Loop out-and-back (Frankston -> city -> Frankston) is a completely
  // normal same-terminus round trip across the day's full formation chain,
  // but showing that span as "Frankston to Frankston service via City Loop"
  // reads as a bug, not a real destination. When the chain's first and last
  // segment share a terminus, there's no useful "spans the whole day" label
  // to show — fall through to the CURRENT leg's own real origin/destination
  // instead (selectedTrainCurrentOrigin/Destination below).
  const selectedTrainFormationSpansSameTerminus =
    Boolean(selectedTrainFormationOriginRaw) &&
    selectedTrainFormationOriginRaw === selectedTrainFormationDestinationRaw;
  const selectedTrainFormationOrigin = selectedTrainFormationSpansSameTerminus ? undefined : selectedTrainFormationOriginRaw;
  const selectedTrainFormationDestination = selectedTrainFormationSpansSameTerminus ? undefined : selectedTrainFormationDestinationRaw;
  const selectedHcmtOrigin = selectedVehicleIsHcmtMetroTunnel
    ? selectedTrainFormationOrigin ?? selectedTrainTrip?.stops[0]?.name.replace(/\s+Station$/i, "")
    : undefined;
  const selectedHcmtDestination = selectedVehicleIsHcmtMetroTunnel
    ? selectedTrainFormationDestination ?? selectedTrainTrip?.destination?.replace(/\s+via\s+Metro Tunnel.*$/i, "").replace(/\s+Station$/i, "")
    : undefined;
  const selectedTrainCurrentFormationIndex = selectedTrainTrip
    ? selectedTrainFormationSegments.findIndex((segment) => segment.tripId === selectedTrainTrip.tripId)
    : -1;
  const selectedTrainCurrentFormation = selectedTrainCurrentFormationIndex >= 0
    ? selectedTrainFormationSegments[selectedTrainCurrentFormationIndex]
    : undefined;
  const selectedTrainNextFormation = selectedTrainCurrentFormationIndex >= 0
    ? selectedTrainFormationSegments.at(-1)
    : undefined;
  const selectedTrainCurrentOrigin = (
    selectedTrainCurrentFormation?.origin ?? selectedTrainTrip?.stops[0]?.name
  )?.replace(/\s+Station$/i, "");
  const selectedTrainCurrentDestination = (
    selectedTrainCurrentFormation?.destination ?? selectedTrainTrip?.stops.at(-1)?.name
  )?.replace(/\s+Station$/i, "");
  const selectedTrainFinalDestination = !selectedTrainFormationSpansSameTerminus
    && selectedTrainCurrentFormationIndex >= 0
    && selectedTrainCurrentFormationIndex < selectedTrainFormationSegments.length - 1
    ? selectedTrainNextFormation?.destination
        ?.replace(/\s+Station$/i, "")
        .replace(/\s+via\s+.+$/i, "")
    : undefined;
  const selectedTrainUsesCityLoop = Boolean(selectedTrainTrip?.stops.some((stop) =>
    /^(Parliament|Melbourne Central|Flagstaff)( Station)?$/i.test(stop.name)
  ));
  const selectedTrainCrossCityVia = selectedTrainUsesCityLoop
    ? "City Loop"
    : selectedTrainCurrentDestination;
  const selectedTrainCrossCityDestination = selectedTrainFinalDestination
    && selectedTrainCurrentDestination
    ? `${selectedTrainCurrentDestination}${selectedTrainUsesCityLoop ? " via City Loop" : ""} → ${selectedTrainFinalDestination}`
    : undefined;
  const selectedTrainFormationHandover = selectedTrainFormationSegments[0]?.destination
    ?.replace(/\s+Station$/i, "") ?? "";
  const selectedServiceViaLabel = selectedVehicleIsHcmtMetroTunnel
    ? "Metro Tunnel"
    : selectedTrainUsesCityLoop
      ? "City Loop"
      : /Flinders Street|Flinders Street/i.test(selectedTrainFormationHandover)
        ? "Flinders Street"
        : selectedTrainFormationSegments.length > 1 && selectedTrainFormationHandover
          ? selectedTrainFormationHandover
          : "";
  const selectedVehicleOriginLabel = selectedVehicle
    ? selectedHcmtOrigin ??
      selectedTrainFormationOrigin ??
      selectedTrainCurrentOrigin ??
      selectedVehicleSnapshot?.current_trip?.origin ??
      selectedRegionalProfile?.origin ??
      selectedVehicleSnapshot?.next_trip?.origin ??
      getVehicleOriginFallback(selectedVehicle)
    : "";
  const selectedVehicleDestinationLabel = selectedVehicle
    ? selectedHcmtDestination ??
      selectedTrainFormationDestination ??
      selectedTrainCrossCityDestination ??
      selectedTrainCurrentDestination ??
      selectedVehicleSnapshot?.current_trip?.destination ??
      selectedRegionalProfile?.destination ??
      selectedVehicleSnapshot?.next_trip?.destination ??
      (isGenericRegionalPlaceholder(selectedVehicle.destination)
        ? getRegionalFallbackMeta(selectedVehicle)?.destination ?? selectedVehicle.destination
        : selectedVehicle.destination)
    : "";
  // The Werribee/Williamstown/Altona/Sandringham group runs real point-to-
  // point through services between two outer termini via Flinders Street —
  // for those, which terminus this service actually came from is the real,
  // useful fact, not the interchange every cross-city service already
  // passes through, so this shows "<destination> via <origin>" instead of
  // "<origin> to <destination> service via Flinders Street".
  const selectedVehicleIsCrossCity = selectedVehicle ? isCrossCityLiveTrain(selectedVehicle) : false;
  const selectedVehiclePatternLabel = selectedVehicle
    ? selectedVehicleIsCrossCity && selectedVehicleOriginLabel && selectedVehicleDestinationLabel
      && selectedVehicleOriginLabel.toLowerCase() !== selectedVehicleDestinationLabel.toLowerCase()
      ? `${selectedVehicleDestinationLabel} via ${selectedVehicleOriginLabel}`
      : selectedServiceViaLabel && selectedVehicleOriginLabel && selectedVehicleDestinationLabel
      ? `${selectedVehicleOriginLabel} to ${selectedVehicleDestinationLabel} service via ${selectedServiceViaLabel}`
      : selectedTrainFormationSegments.length > 1 && selectedTrainFormationOrigin && selectedTrainFormationDestination
        ? `${selectedTrainFormationOrigin} → ${selectedTrainFormationDestination} through service`
      : selectedTrainCrossCityDestination && selectedTrainCurrentOrigin && selectedTrainCrossCityVia && selectedTrainFinalDestination
        ? `${selectedTrainCurrentOrigin} → ${selectedTrainUsesCityLoop ? "City Loop → " : ""}${selectedTrainCurrentDestination} → ${selectedTrainFinalDestination} through service`
      : selectedVehicleSnapshot?.current_trip
      ? `${selectedVehicleSnapshot.current_trip.origin} to ${selectedVehicleSnapshot.current_trip.destination}`
      : selectedRegionalProfile
        ? `${selectedRegionalProfile.origin} to ${selectedRegionalProfile.destination}`
      : selectedVehicleSnapshot?.next_trip
        ? `Next: ${selectedVehicleSnapshot.next_trip.origin} to ${selectedVehicleSnapshot.next_trip.destination}`
        : getVehicleStoppingPattern(selectedVehicle)
    : "";
  const selectedVehiclePositionEstimateLabel = selectedVehicle
    ? selectedVehicleSnapshot?.position
      ? selectedVehicleSnapshot.position.vehicle_stop_status === "STOPPED_AT"
        ? `Stopped at ${selectedVehicleSnapshot.position.current_stop} at ${formatRouteWindow(selectedVehicleSnapshot.position.current_stop_time)}`
        : `Between ${selectedVehicleSnapshot.position.current_stop} and ${selectedVehicleSnapshot.position.next_stop ?? "the next stop"}`
      : selectedVehicleSnapshot?.current_trip
        ? `Running ${selectedVehicleSnapshot.current_trip.origin} to ${selectedVehicleSnapshot.current_trip.destination}`
        : selectedVehicleSnapshot?.next_trip
          ? `Waiting to form ${selectedVehicleSnapshot.next_trip.origin} to ${selectedVehicleSnapshot.next_trip.destination}`
          : (() => {
              const candidateStops = selectedTrainTrip?.stops.filter((stop) => typeof stop.lat === "number" && typeof stop.lng === "number") ?? [];
              if (!candidateStops.length) return `Last reported toward ${selectedVehicleDestinationLabel}`;
              const nearestIndex = candidateStops.reduce((bestIndex, stop, index, stops) =>
                getDistanceInMetres([selectedVehicle.lat, selectedVehicle.lng], [stop.lat!, stop.lng!]) <
                getDistanceInMetres([selectedVehicle.lat, selectedVehicle.lng], [stops[bestIndex].lat!, stops[bestIndex].lng!]) ? index : bestIndex, 0);
              const nearest = candidateStops[nearestIndex];
              const nearestDistance = getDistanceInMetres([selectedVehicle.lat, selectedVehicle.lng], [nearest.lat!, nearest.lng!]);
              const next = candidateStops[Math.min(nearestIndex + (nearestDistance < 120 ? 0 : 1), candidateStops.length - 1)];
              const distance = getDistanceInMetres([selectedVehicle.lat, selectedVehicle.lng], [next.lat!, next.lng!]);
              // Vehicle position alone cannot prove a station dwell. Only the
              // explicit STOPPED_AT feed status above may use that wording.
              if (distance < 120) return `Approaching ${next.name} · ${Math.round(distance)} m away`;
              if (distance < 800) return `Approaching ${next.name} · ${Math.round(distance)} m away`;
              return `Last reported ${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`} from ${next.name}`;
            })()
    : "";
  const selectedRegionalRestrictionSummary = getRegionalRestrictionSummary(selectedRegionalProfile);
  const selectedVehicleAccent = selectedVehicle ? getLiveLineColor(selectedVehicle.line) : "#3b82f6";
  const selectedVehicleIsRegional = Boolean(selectedVehicle && isVlineLiveTrain(selectedVehicle));
  const selectedVehicleDelayMinutes = selectedRegionalProfile?.stops[selectedRegionalProfile.stops.length - 1]?.delayMinutes ??
    Math.round((selectedTrainTrip?.stops[selectedTrainTrip.stops.length - 1]?.delaySeconds ?? 0) / 60);
  const selectedVehicleWindowLabel = selectedRegionalProfile?.window ?? (selectedVehicle ? getVehicleWindowLabel(selectedVehicleSnapshot, selectedVehicle) : "");
  const selectedVehicleDurationLabel = selectedRegionalProfile?.duration ?? "Live trip";
  const selectedVehicleDateLabel = selectedVehicle ? formatRegionalServiceDate(selectedVehicle.timestamp) : "";
  const selectedVehicleServiceTypeLabel = selectedRegionalProfile?.serviceType ?? (selectedVehicleIsHcmtMetroTunnel ? "HCMT Metro Tunnel" : selectedVehicleIsRegional ? "Regional Service" : "Metro Service");
  const selectedVehicleHeadingLabel = selectedVehicle
    ? selectedBoardServiceContext?.vehicleKey === selectedVehicleKey && selectedVehicleDestinationLabel
      ? `${selectedVehicleDestinationLabel} service`
      : selectedServiceViaLabel && selectedVehicleDestinationLabel
      ? `${selectedVehicleOriginLabel} to ${selectedVehicleDestinationLabel} service via ${selectedServiceViaLabel}`
      : selectedTrainCrossCityDestination
      ? `${selectedTrainCrossCityDestination} service`
      : selectedTrainCurrentDestination
        ? `${selectedTrainCurrentDestination} service`
      : selectedVehicleSnapshot?.current_trip
      ? `${selectedVehicleSnapshot.current_trip.origin} to ${selectedVehicleSnapshot.current_trip.destination}`
      : selectedVehicleSnapshot?.next_trip
        ? `${selectedVehicleSnapshot.next_trip.origin} to ${selectedVehicleSnapshot.next_trip.destination}`
        : selectedVehicleIsHcmtMetroTunnel
          ? `${selectedVehicleDestinationLabel || selectedVehicle.destination} service`
        : selectedVehicleIsRegional
          ? `${getRegionalFallbackMeta(selectedVehicle)?.serviceLabel ?? "Regional"} service`
          : `${selectedVehicleIsHcmtMetroTunnel ? "Metro Tunnel" : selectedVehicle.line} service`
    : "";
  const selectedVehicleJourneyId = selectedVehicle
    ? (selectedBoardServiceContext?.vehicleKey === selectedVehicleKey ? selectedBoardServiceContext.tdn : null) ??
      selectedVehicleSnapshot?.current_trip?.id ??
      selectedVehicleSnapshot?.next_trip?.id ??
      (isRegionalSetIdentifier(selectedVehicle.tdn) ? "" : selectedVehicle.tdn)
    : "";
  const selectedVehicleJourneyLabel = selectedVehicle
    ? `${getMarkerServiceTime(selectedVehicle.timestamp)} ${selectedVehicleOriginLabel || "Origin"} → ${selectedVehicleDestinationLabel || selectedVehicle.destination}`
    : "";
  const selectedVehicleRegionalSetLabel = selectedVehicleIsRegional && selectedVehicle
    ? getRegionalAllocatedSetLabel(selectedVehicle)
    : "";
  const selectedVehicleTypeLabel = selectedVehicle
    ? (selectedVehicleIsRegional ? getRegionalTrainTypeLabel(selectedVehicle) : getVehicleDisplayType(selectedVehicle))
    : "";
  const selectedVehicleRealtimeLabel = selectedVehicleIsRegional && selectedVehicle
    ? getRegionalRealtimeTripLabel(selectedVehicle)
    : "";
  const selectedVehicleSpecialLabel = selectedVehicleIsRegional && selectedVehicle
    ? getRegionalSpecialTrainLabel(selectedVehicle)
    : "";
  const selectedVehicleDisplayConsist = selectedVehicle ? getDisplayConsist(selectedVehicle.consist) : "";
  const selectedVehiclePassengerConsistLabel = selectedVehicleIsHcmtMetroTunnel && selectedVehicleDisplayConsist
    ? `HCMT SET ${(selectedVehicleDisplayConsist.match(/\d{4}/)?.[0] ?? selectedVehicleDisplayConsist).slice(-2)}`
    : selectedVehicleRegionalSetLabel || selectedVehicleDisplayConsist;
  const selectedVehicleIsFavouriteConsist = Boolean(
    selectedVehicleDisplayConsist &&
      favouriteConsists.some(
        (consist) => normaliseConsistLookupValue(consist) === normaliseConsistLookupValue(selectedVehicleDisplayConsist),
      ),
  );
  const selectedVehicleRelevantAlerts = useMemo(() => {
    if (!selectedVehicleSnapshot?.network_alerts?.length || !selectedVehicle) {
      return [];
    }

    const keywords = getVehicleAlertKeywords(selectedVehicle, selectedVehicleSnapshot);
    if (keywords.length === 0) {
      return [];
    }

    return selectedVehicleSnapshot.network_alerts.filter((alert) => {
      const searchable = normaliseServiceMatchText(alert);
      return keywords.some((keyword) => searchable.includes(keyword));
    });
  }, [selectedVehicle, selectedVehicleSnapshot]);
  const selectedVehicleIsStoppedAtPublishedStop = Boolean(
    selectedVehicleSnapshot?.position?.vehicle_stop_status === "STOPPED_AT" &&
    selectedVehicleSnapshot?.position?.current_stop,
  );
  // Computed before selectedVehicleCurrentStopIndex (not just used by the
  // "Train is here" banner) because it's the most reliable signal available
  // for where the train actually is: real GPS position projected onto the
  // route, independent of the schedule. The per-stop status field below is
  // derived from scheduled/expected TIME instead — for a delayed train, "now"
  // can already be past several stops' scheduled times even though the
  // vehicle's real GPS position hasn't reached them yet, which showed real
  // upcoming stops (and the line leading to them) as already "passed".
  const selectedVehicleLiveTimelinePosition = (() => {
    if (!selectedVehicle || selectedVehicleIsStoppedAtPublishedStop || selectedVehiclePatternStops.length < 2) return null;
    let closest: { beforeIndex: number; progress: number; distance: number; from: string; to: string } | null = null;
    const trainY = selectedVehicle.lat;

    for (let index = 0; index < selectedVehiclePatternStops.length - 1; index += 1) {
      const from = selectedVehiclePatternStops[index];
      const to = selectedVehiclePatternStops[index + 1];
      const averageLat = (from.position[0] + to.position[0]) / 2;
      const scale = Math.cos(averageLat * Math.PI / 180);
      const trainX = selectedVehicle.lng * scale;
      const fromX = from.position[1] * scale;
      const fromY = from.position[0];
      const toX = to.position[1] * scale;
      const toY = to.position[0];
      const deltaX = toX - fromX;
      const deltaY = toY - fromY;
      const lengthSquared = deltaX * deltaX + deltaY * deltaY;
      if (lengthSquared === 0) continue;
      const progress = Math.max(0, Math.min(1, ((trainX - fromX) * deltaX + (trainY - fromY) * deltaY) / lengthSquared));
      const projectedX = fromX + progress * deltaX;
      const projectedY = fromY + progress * deltaY;
      const distance = (trainX - projectedX) ** 2 + (trainY - projectedY) ** 2;
      if (!closest || distance < closest.distance) {
        closest = { beforeIndex: index + 1, progress, distance, from: from.name, to: to.name };
      }
    }
    return closest;
  })();
  const selectedVehicleCurrentStopIndex = (() => {
    if (!selectedVehicle || selectedVehiclePatternStops.length === 0) return -1;

    const publishedStop = selectedVehicleSnapshot?.position?.current_stop?.trim().toLowerCase();
    if (publishedStop && selectedVehicleIsStoppedAtPublishedStop) {
      const publishedIndex = selectedVehiclePatternStops.findIndex(
        (station) => station.name.toLowerCase() === publishedStop,
      );
      if (publishedIndex >= 0) return publishedIndex;
    }

    // The real GPS-projected position (computed above) says exactly which
    // segment the train is on right now — trust it over the schedule's own
    // passed/upcoming status, which a delay can throw off (see note above).
    // This index means "the upcoming/current-relevant stop" everywhere else
    // in this variable (isPassed below treats it as the first NOT-yet-passed
    // stop, isNext treats it as the very next stop) — beforeIndex already IS
    // that stop (the one the train hasn't reached yet), not beforeIndex - 1.
    if (selectedVehicleLiveTimelinePosition) return selectedVehicleLiveTimelinePosition.beforeIndex;

    // A nearby station is not proof that the train is stopped there. Until
    // the feed explicitly reports STOPPED_AT, the map marker stays at the
    // vehicle GPS point and this list highlights only the next stop.
    const nextScheduledIndex = selectedTrainTrip?.stops.findIndex((stop) => stop.status === "upcoming");
    if (typeof nextScheduledIndex === "number" && nextScheduledIndex >= 0) return nextScheduledIndex;

    return selectedVehiclePatternStops.reduce(
      (bestIndex, station, index, stations) => {
        const distance = (station.position[0] - selectedVehicle.lat) ** 2 + (station.position[1] - selectedVehicle.lng) ** 2;
        const best = stations[bestIndex];
        const bestDistance = (best.position[0] - selectedVehicle.lat) ** 2 + (best.position[1] - selectedVehicle.lng) ** 2;
        return distance < bestDistance ? index : bestIndex;
      },
      0,
    );
  })();
  const selectedVehicleVisiblePatternStops = selectedVehiclePatternStops
    .map((station, index) => ({ station, index }))
    .slice(showPriorStops ? 0 : selectedVehicleCurrentStopIndex > 0 ? selectedVehicleCurrentStopIndex - 1 : 0);
  useEffect(() => {
    setShowPriorStops(false);
  }, [selectedVehicle?.tripId, selectedBus?.tripId, selectedTram?.tripId]);
  const featuredConsistLiveVehicle = useMemo(
    () => liveVehicles.find((vehicle) => vehicle.consist === FEATURED_CONSIST) ?? null,
    [liveVehicles],
  );
  const featuredConsistPosition = useMemo<[number, number]>(
    () =>
      featuredConsistLiveVehicle
        ? [featuredConsistLiveVehicle.lat, featuredConsistLiveVehicle.lng]
        : resolveConsistSnapshotCoordinate(featuredConsistSnapshot) ?? SOUTHERN_CROSS_POSITION,
    [featuredConsistLiveVehicle, featuredConsistSnapshot],
  );
  const featuredConsistIsLive = Boolean(
    featuredConsistLiveVehicle ||
      featuredConsistSnapshot?.status === "active" ||
      featuredConsistSnapshot?.position,
  );
  // Lifted out of LayerControl so the live-count pills (top-left) can hide
  // themselves while the layers panel is open — with the panel's width now
  // driven by its longest combined line label, it overlaps that fixed pill
  // position on narrow screens; hiding the pills for as long as the panel is
  // open is the simplest fix without needing to cap the panel's width.
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const [layers, setLayers] = useState<LayerState>({
    merndaLine: true,
    hurstbridgeLine: true,
    cliftonHillLoop: true,
    frankstonLine: true,
    stonyPointLine: true,
    cranbourneLine: true,
    pakenhamLine: true,
    sunburyLine: true,
    craigieburnLine: true,
    upfieldLine: true,
    lilydaleLine: true,
    belgraveLine: true,
    alameinLine: true,
    glenWaverleyLine: true,
    northernLoop: true,
    burnleyLoop: true,
    metroTunnel: true,
    werribeeLine: true,
    sandringhamLine: true,
    geelongLine: true,
    warrnamboolLine: true,
    ballaratLine: true,
    araratLine: true,
    maryboroughLine: true,
    bendigoLine: true,
    echucaLine: true,
    swanHillLine: true,
    seymourLine: true,
    sheppartonLine: true,
    alburyLine: true,
    traralgonLine: true,
    bairnsdaleLine: true,
    inspectors: true,
    delays: true,
    incidents: true,
    heatCircles: !aggressiveMobileProtectionEnabled,
    sydneyTransit: false,
    freight: false,
    heritage: false,
    nonPassenger: false,
  });
  useEffect(() => {
    setSydneyTransitEnabled(layers.sydneyTransit);
  }, [layers.sydneyTransit]);
  const regularLiveVehicles = useMemo(
    () => {
      const filtered = liveVehicles.filter((vehicle) => vehicle.consist !== FEATURED_CONSIST);
      return filtered;
    },
    [liveVehicles],
  );
  const metroLiveVehicles = useMemo(
    () =>
      regularLiveVehicles.filter(
        (vehicle) =>
          !isVlineLiveTrain(vehicle) &&
          getVehicleLayerVisibility(vehicle, layers),
      ),
    [focusedVehicleKey, layers, regularLiveVehicles, selectedVehicle?.tripId, selectedVehicleKey],
  );
  const vlineLiveVehicles = useMemo(
    () =>
      regularLiveVehicles.filter(
        (vehicle) =>
          isVlineLiveTrain(vehicle) &&
          getVehicleLayerVisibility(vehicle, layers),
      ),
    [focusedVehicleKey, layers, regularLiveVehicles, selectedVehicle?.tripId, selectedVehicleKey],
  );
  const focusVehicleOnMap = useCallback((vehicle: LiveTrain) => {
    setSelectedDetail({ type: "vehicle", vehicle });
    safeFlyTo(mapRef.current, vehicle.lat, vehicle.lng, Math.max(mapRef.current?.getZoom() ?? 13, 14), {
      animate: true,
      duration: 0.85,
    });
  }, []);
  const handleTrainLookup = useCallback(() => {
    if (!isPremium) {
      setTrainLookupMessage("Premium unlocks live TDN and consist lookup.");
      return;
    }

    const rawQuery = trainLookupQuery.trim();
    if (!rawQuery) {
      setTrainLookupMessage("Enter a TDN or consist to find a live service.");
      return;
    }

    const normalisedQuery = normaliseConsistLookupValue(rawQuery);
    const allVehicles = [...metroLiveVehicles, ...vlineLiveVehicles];
    const matchedByTdn =
      allVehicles.find((vehicle) => {
        const rawTdn = stripTdnPrefix(vehicle.tdn);
        const tdnCandidates = [vehicle.tdn, rawTdn]
          .filter(Boolean)
          .map((value) => normaliseConsistLookupValue(value));
        return tdnCandidates.some(
          (candidate) =>
            candidate === normalisedQuery ||
            candidate.startsWith(normalisedQuery) ||
            normalisedQuery.startsWith(candidate),
        );
      }) ?? null;

    if (matchedByTdn) {
      focusVehicleOnMap(matchedByTdn);
      setTrainLookupMessage(`Jumped to TDN ${stripTdnPrefix(matchedByTdn.tdn)}.`);
      return;
    }

    const matchedByConsist =
      allVehicles.find((vehicle) => {
        const consistCandidates = [vehicle.consist, getDisplayConsist(vehicle.consist), getSnapshotConsistId(vehicle.consist) ?? ""]
          .filter(Boolean)
          .map((value) => normaliseConsistLookupValue(value));
        return consistCandidates.some(
          (candidate) =>
            candidate === normalisedQuery ||
            candidate.startsWith(normalisedQuery) ||
            normalisedQuery.startsWith(candidate),
        );
      }) ?? null;

    if (matchedByConsist) {
      focusVehicleOnMap(matchedByConsist);
      setTrainLookupMessage(`Jumped to consist ${getDisplayConsist(matchedByConsist.consist)}.`);
      return;
    }

    setTrainLookupMessage("No live train matched that TDN or consist right now.");
  }, [focusVehicleOnMap, isPremium, metroLiveVehicles, trainLookupQuery, vlineLiveVehicles]);
  const handleFavouriteConsistClick = useCallback(
    (consist: string) => {
      if (!isPremium || !onToggleFavouriteConsist) {
        setTrainLookupMessage("Premium is required to favourite train consists.");
        return;
      }

      onToggleFavouriteConsist(consist);
      const isSaved = favouriteConsists.some(
        (item) => normaliseConsistLookupValue(item) === normaliseConsistLookupValue(consist),
      );
      setTrainLookupMessage(isSaved ? `Removed ${consist} from favourite consists.` : `Saved ${consist} as a favourite consist.`);
    },
    [favouriteConsists, isPremium, onToggleFavouriteConsist],
  );
  const handlePlatformBoardServiceClick = useCallback(
    (
      stationName: string,
      platform: PlatformBoardEntry,
      service: PlatformBoardEntry["services"][number],
    ) => {
      const tdnCandidates = extractServiceTdnCandidates(service.tdnLabel);
      const display = getPlatformServiceDisplay(stationName, platform.label, service);
      const destinationCandidates = [
        service.destination,
        display.destination,
        display.originLabel?.replace(/^Origin\s+/i, ""),
      ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .map((value) => normaliseServiceMatchText(value));
      const lineHints = getPlatformLineHints(stationName, platform, service);

      const matchedVehicle =
        liveVehicles.find((vehicle) =>
          tdnCandidates.some((candidate) => vehicle.tdn.trim().toUpperCase() === candidate),
        ) ??
        liveVehicles.find((vehicle) => {
          const destinationText = normaliseServiceMatchText(vehicle.destination);
          const lineText = normaliseServiceMatchText(vehicle.line);
          const descriptionText = normaliseServiceMatchText(vehicle.serviceDescription ?? "");
          const destinationMatches = destinationCandidates.some(
            (candidate) =>
              candidate.length > 0 &&
              (destinationText.includes(candidate) ||
                candidate.includes(destinationText) ||
                lineText.includes(candidate) ||
                descriptionText.includes(candidate)),
          );
          const lineHintMatches =
            lineHints.length === 0 ||
            lineHints.some(
              (hint) =>
                lineText.includes(normaliseServiceMatchText(hint)) ||
                descriptionText.includes(normaliseServiceMatchText(hint)),
            );

          return destinationMatches && lineHintMatches;
        });

      if (!matchedVehicle) {
        return;
      }

      setSelectedBoardServiceContext({
        vehicleKey: getVehicleFocusKey(matchedVehicle),
        tdn: stripTdnPrefix(service.tdnLabel),
        origin: stationName.replace(/\s+Station$/i, ""),
        destination: display.destination.replace(/\s+Station$/i, ""),
      });
      setSelectedDetail({ type: "vehicle", vehicle: matchedVehicle });
      safeFlyTo(mapRef.current, matchedVehicle.lat, matchedVehicle.lng, Math.max(mapRef.current?.getZoom() ?? 13, 14), {
        animate: true,
        duration: 0.85,
      });
    },
    [liveVehicles],
  );
  useEffect(() => {
    if (!selectedBoardServiceContext) {
      return;
    }

    if (!selectedVehicleKey || selectedBoardServiceContext.vehicleKey !== selectedVehicleKey) {
      setSelectedBoardServiceContext(null);
    }
  }, [selectedBoardServiceContext, selectedVehicleKey]);
  const [isMarkerEditMode, setIsMarkerEditMode] = useState(false);
  const [draftMarkerOverrides, setDraftMarkerOverrides] = useState<Record<string, MarkerOverride>>({});
  const [hoveredVehicleKey, setHoveredVehicleKey] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<[number, number] | null>(null);

  const { data: markerOverrides = [], refetch: refetchMarkerOverrides } = useQuery({
    queryKey: ["admin-marker-overrides"],
    queryFn: fetchMarkerOverrides,
    enabled: isAdmin,
    retry: false,
  });

  // This only reacts to persistedLayerState itself changing (e.g. saved
  // preferences finishing their initial load) — it used to also depend on
  // `layers` and compare against the live value, which meant every local
  // toggle re-ran it immediately. Since onLayerStateChange's save below is
  // async, persistedLayerState is still the OLD value for a moment after a
  // toggle, so that comparison kept finding a "difference" and snapping the
  // just-toggled flag straight back — the toggle "spazzing" back and forth
  // instead of sticking.
  useEffect(() => {
    if (!persistedLayerState) return;
    if (areLayerStatesEqual(lastAppliedPersistedLayerStateRef.current, persistedLayerState)) return;
    lastAppliedPersistedLayerStateRef.current = persistedLayerState;
    setLayers((prev) => ({ ...prev, ...persistedLayerState }));
  }, [persistedLayerState]);

  useEffect(() => {
    if (!onLayerStateChange) return;
    if (lastEmittedLayerStateRef.current && areLayerStatesEqual(lastEmittedLayerStateRef.current, layers)) {
      return;
    }
    lastEmittedLayerStateRef.current = layers;
    // Home.tsx echoes this straight back down as the next persistedLayerState
    // (its preferences state updates synchronously, unlike the actual server
    // save) — pre-mark it as already-applied so the sync effect above doesn't
    // treat that echo as new external data and run an extra, redundant
    // setLayers on top of the toggle that's already correct. That redundant
    // round trip was the remaining cause of the visible "spazz": every toggle
    // was applying twice in a row.
    lastAppliedPersistedLayerStateRef.current = layers;
    onLayerStateChange(layers);
  }, [layers, onLayerStateChange]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (isMarkerEditMode) {
      mapRef.current.dragging.disable();
      mapRef.current.doubleClickZoom.disable();
      mapRef.current.touchZoom.disable();
      mapRef.current.scrollWheelZoom.disable();
      mapRef.current.boxZoom.disable();
      mapRef.current.keyboard.disable();
      return () => {
        mapRef.current?.dragging.enable();
        mapRef.current?.doubleClickZoom.enable();
        mapRef.current?.touchZoom.enable();
        mapRef.current?.scrollWheelZoom.enable();
        mapRef.current?.boxZoom.enable();
        mapRef.current?.keyboard.enable();
      };
    }

    mapRef.current.dragging.enable();
    mapRef.current.doubleClickZoom.enable();
    mapRef.current.touchZoom.enable();
    mapRef.current.scrollWheelZoom.enable();
    mapRef.current.boxZoom.enable();
    mapRef.current.keyboard.enable();
  }, [isMarkerEditMode]);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLoc([position.coords.latitude, position.coords.longitude]);
      },
      () => {
        // Keep the location empty if GPS is unavailable instead of treating Melbourne as the user's fix.
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLoc([position.coords.latitude, position.coords.longitude]);
      },
      () => {
        // Ignore background watch errors and keep the last known valid location.
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 15000,
      },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  const focusedVehicleKeyRef = useRef(focusedVehicleKey);
  focusedVehicleKeyRef.current = focusedVehicleKey;
  useEffect(() => {
    if (!focusedVehicleKey) return;

      // Fleet Tracker rows for buses/trams use a "bus:<tripId>" / "tram:<tripId>"
      // focus key (trains have no such prefix — see getVehicleFocusKey) since
      // those vehicles don't share the train fleet's consist/tdn identity.
      if (focusedVehicleKey.startsWith("bus:")) {
        const requestedTripId = focusedVehicleKey.slice("bus:".length);
        const bus = liveBuses.find((candidate) => (candidate.tripId ?? candidate.id) === requestedTripId);
        if (!bus) return;
        setSelectedDetail({ type: "bus", bus });
        safeFlyTo(mapRef.current, bus.lat, bus.lng, Math.max(mapRef.current?.getZoom() ?? 13, 14), { animate: true, duration: 0.85 });
        onFocusedVehicleHandled?.();
        return;
      }
      if (focusedVehicleKey.startsWith("tram:")) {
        const requestedTripId = focusedVehicleKey.slice("tram:".length);
        const focusTram = (tram: LiveTram) => {
          setSelectedDetail({ type: "tram", tram });
          safeFlyTo(mapRef.current, tram.lat, tram.lng, Math.max(mapRef.current?.getZoom() ?? 13, 14), { animate: true, duration: 0.85 });
        };
        const tram = liveTrams.find((candidate) => (candidate.tripId ?? candidate.id) === requestedTripId);
        if (tram) {
          focusTram(tram);
          onFocusedVehicleHandled?.();
          return;
        }
        // liveTrams only holds the current viewport, so a tram tracked from
        // the Fleet Tracker while off screen was never found: look it up in
        // the full fleet, and mark the request handled either way so it
        // can't fire later when the tram happens to drift into view.
        const requestedKey = focusedVehicleKey;
        const isStillRequested = () => focusedVehicleKeyRef.current === requestedKey;
        void fetchLiveTrams()
          .then((allTrams) => {
            if (!isStillRequested()) return;
            const match = allTrams.find((candidate) => (candidate.tripId ?? candidate.id) === requestedTripId);
            if (match) focusTram(match);
          })
          .catch(() => undefined)
          .finally(() => {
            if (isStillRequested()) onFocusedVehicleHandled?.();
          });
        return;
      }

      // The journey planner's "take this service" cards only ever have a
      // real trip_id from the departures API (no consist/tdn to build the
      // usual consist-first key from) — match directly by trip_id, the same
      // way the bus/tram branches above already do, rather than requiring a
      // full FleetTrip-shaped object just to construct a focus key.
      if (focusedVehicleKey.startsWith("trip:")) {
        const requestedTripId = focusedVehicleKey.slice("trip:".length);
        const trainByTripId = liveVehicles.find((candidate) => candidate.tripId === requestedTripId);
        if (!trainByTripId) return;
        setSelectedDetail({ type: "vehicle", vehicle: trainByTripId });
        safeFlyTo(mapRef.current, trainByTripId.lat, trainByTripId.lng, Math.max(mapRef.current?.getZoom() ?? 13, 14), { animate: true, duration: 0.85 });
        onFocusedVehicleHandled?.();
        return;
      }

      const vehicle = liveVehicles.find((candidate) => getVehicleFocusKey(candidate) === focusedVehicleKey);
      if (!vehicle) return;

      if (vehicle.consist === FEATURED_CONSIST) {
        setSelectedDetail(null);
        safeFlyTo(mapRef.current, featuredConsistPosition[0], featuredConsistPosition[1], Math.max(mapRef.current?.getZoom() ?? 13, 14), {
          animate: true,
          duration: 0.85,
        });
        onFocusedVehicleHandled?.();
        return;
      }

      // Always show the detail panel, even when the vehicle's live position
      // is momentarily NaN/missing (no GPS fix yet) or the map ref hasn't
      // attached yet (Fleet Tracker's "Track" button switches tabs and sets
      // this key in the same batch, which can fire this effect before
      // Leaflet's ref callback runs) — only the camera move needs the guard,
      // so either case degrades to "panel opens without recentring" instead
      // of crashing the whole app on a null mapRef.current.getZoom() call.
      setSelectedDetail({ type: "vehicle", vehicle });
      safeFlyTo(mapRef.current, vehicle.lat, vehicle.lng, Math.max(mapRef.current?.getZoom() ?? 13, 14), {
        animate: true,
        duration: 0.85,
      });
      onFocusedVehicleHandled?.();
    }, [featuredConsistPosition, focusedVehicleKey, liveBuses, liveTrams, liveVehicles, onFocusedVehicleHandled]);

  const centerOnUserLocation = useCallback(() => {
    if (!mapRef.current) return;

    const moveToLocation = (location: [number, number]) => {
      setUserLoc(location);
      safeFlyTo(mapRef.current, location[0], location[1], Math.max(mapRef.current?.getZoom() ?? 13, 14), {
        animate: true,
        duration: 0.75,
      });
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          moveToLocation([position.coords.latitude, position.coords.longitude]);
        },
        () => {
          if (userLoc) {
            moveToLocation(userLoc);
            return;
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 12000,
        },
      );
      return;
    }

    if (userLoc) {
      moveToLocation(userLoc);
      return;
    }

    safeFlyTo(mapRef.current, MELBOURNE_CENTER[0], MELBOURNE_CENTER[1], Math.max(mapRef.current?.getZoom() ?? 11, 12), {
      animate: true,
      duration: 0.75,
    });
  }, [userLoc]);

  const nearbyStops = useMemo(() => {
    if (!userLoc) return [] as Array<
      | { kind: "station"; distanceMetres: number; station: Station }
      | { kind: "surface"; distanceMetres: number; stop: SurfaceStop }
    >;
    const seenPositionKeys = new Set<string>();
    const entries: Array<
      | { kind: "station"; distanceMetres: number; station: Station }
      | { kind: "surface"; distanceMetres: number; stop: SurfaceStop }
    > = [];

    for (const station of ALL_STATIONS) {
      const distanceMetres = getDistanceInMetres(userLoc, station.position);
      if (distanceMetres > 1200) continue;
      const key = `s:${station.position[0].toFixed(4)},${station.position[1].toFixed(4)}`;
      if (seenPositionKeys.has(key)) continue;
      seenPositionKeys.add(key);
      entries.push({ kind: "station", distanceMetres, station });
    }

    for (const stop of [...ANYTRIP_SURFACE_STOPS, ...BUS_INTERCHANGE_BAYS]) {
      const distanceMetres = getDistanceInMetres(userLoc, stop.position);
      if (distanceMetres > 1200) continue;
      const key = `p:${stop.position[0].toFixed(4)},${stop.position[1].toFixed(4)}`;
      if (seenPositionKeys.has(key)) continue;
      seenPositionKeys.add(key);
      entries.push({ kind: "surface", distanceMetres, stop });
    }

    return entries.sort((a, b) => a.distanceMetres - b.distanceMetres).slice(0, 8);
  }, [userLoc]);

  const toggleLayer = useCallback((key: keyof LayerState | (keyof LayerState)[]) => {
    setLayers((prev) => {
      if (Array.isArray(key)) {
        const nextValue = !key.some((groupKey) => prev[groupKey]);
        return { ...prev, ...Object.fromEntries(key.map((groupKey) => [groupKey, nextValue])) };
      }
      return { ...prev, [key]: !prev[key] };
    });
  }, []);

  const toggleStationPillLine = useCallback((station: Station) => {
    switch (station.name) {
      case "Frankston":
        setLayers((prev) => ({ ...prev, frankstonLine: !prev.frankstonLine }));
        return true;
      case "Pakenham":
        setLayers((prev) => ({ ...prev, pakenhamLine: !prev.pakenhamLine }));
        return true;
      case "Dandenong":
        setLayers((prev) => ({
          ...prev,
          pakenhamLine: !(prev.pakenhamLine || prev.cranbourneLine),
          cranbourneLine: !(prev.pakenhamLine || prev.cranbourneLine),
        }));
        return true;
      default:
        return false;
    }
  }, []);

  const renderedStationKeys = new Set<string>();

  const toggleServiceFilter = useCallback((filter: ServiceFilterKey) => {
    const shouldForceShowRegional = !transportModes.includes("vline") && (
      filter === "geelongRegionalGroup" ||
      filter === "ballaratRegionalGroup" ||
      filter === "bendigoRegionalGroup" ||
      filter === "seymourRegionalGroup" ||
      filter === "traralgonRegionalGroup"
    );
    if (shouldForceShowRegional) {
      onTransportModesChange?.([...transportModes, "vline"]);
    }
    setLayers((prev) => {
      switch (filter) {
        // Each of these groups now toggles the union of the specific named
        // lines that made up its corridor (see the LayerState split above) —
        // this chip's own on/off behaviour is unchanged, it just fans out to
        // more than one underlying flag now.
        case "geelongRegionalGroup": {
          const nextValue = shouldForceShowRegional ? true : !(prev.geelongLine || prev.warrnamboolLine);
          return { ...prev, geelongLine: nextValue, warrnamboolLine: nextValue };
        }
        case "ballaratRegionalGroup": {
          const nextValue = shouldForceShowRegional ? true : !(prev.ballaratLine || prev.araratLine || prev.maryboroughLine);
          return { ...prev, ballaratLine: nextValue, araratLine: nextValue, maryboroughLine: nextValue };
        }
        case "bendigoRegionalGroup": {
          const nextValue = shouldForceShowRegional ? true : !(prev.bendigoLine || prev.echucaLine || prev.swanHillLine);
          return { ...prev, bendigoLine: nextValue, echucaLine: nextValue, swanHillLine: nextValue };
        }
        case "seymourRegionalGroup": {
          const nextValue = shouldForceShowRegional ? true : !(prev.seymourLine || prev.sheppartonLine || prev.alburyLine);
          return { ...prev, seymourLine: nextValue, sheppartonLine: nextValue, alburyLine: nextValue };
        }
        case "traralgonRegionalGroup": {
          const nextValue = shouldForceShowRegional ? true : !(prev.traralgonLine || prev.bairnsdaleLine);
          return { ...prev, traralgonLine: nextValue, bairnsdaleLine: nextValue };
        }
        case "metroTunnelServices":
          return {
            ...prev,
            metroTunnel: !prev.metroTunnel,
            sunburyLine: !prev.metroTunnel,
            cranbourneLine: !prev.metroTunnel,
            pakenhamLine: !prev.metroTunnel,
          };
        case "crossCityPink":
          return {
            ...prev,
            werribeeLine: !prev.werribeeLine,
            sandringhamLine: !prev.sandringhamLine,
          };
        case "werribeeWilliamstownGroup":
          return {
            ...prev,
            werribeeLine: !prev.werribeeLine,
          };
        case "sandringhamGroup":
          return {
            ...prev,
            sandringhamLine: !prev.sandringhamLine,
          };
        case "burnleyGroup": {
          const nextValue = !(prev.belgraveLine || prev.lilydaleLine || prev.glenWaverleyLine || prev.alameinLine || prev.burnleyLoop);
          return {
            ...prev,
            belgraveLine: nextValue,
            lilydaleLine: nextValue,
            glenWaverleyLine: nextValue,
            alameinLine: nextValue,
            burnleyLoop: nextValue,
          };
        }
        case "cliftonHillGroup": {
          const nextValue = !(prev.merndaLine || prev.hurstbridgeLine || prev.cliftonHillLoop);
          return {
            ...prev,
            merndaLine: nextValue,
            hurstbridgeLine: nextValue,
            cliftonHillLoop: nextValue,
          };
        }
        case "caulfieldGroup":
        case "frankstonGroup": {
          const nextValue = !prev.frankstonLine;
          return {
            ...prev,
            frankstonLine: nextValue,
          };
        }
        case "upfieldCraigieburn":
          return {
            ...prev,
            upfieldLine: !prev.upfieldLine,
            craigieburnLine: !prev.craigieburnLine,
          };
        case "upfieldCraigieburnCityLoop":
          return { ...prev, northernLoop: !prev.northernLoop };
        default:
          return prev;
      }
    });
  }, [onTransportModesChange, transportModes]);

  const isSurfaceRouteFilterActive = useCallback(
    (filter: SurfaceRouteFilter) =>
      transportModes.includes(filter.mode) && activeSurfaceRouteFilters.includes(filter.key),
    [activeSurfaceRouteFilters, transportModes],
  );

  const toggleSurfaceRouteFilter = useCallback(
    (filter: SurfaceRouteFilter) => {
      if (!transportModes.includes(filter.mode)) {
        onTransportModesChange?.([...transportModes, filter.mode]);
      }

      setActiveSurfaceRouteFilters((prev) =>
        prev.includes(filter.key) ? prev.filter((key) => key !== filter.key) : [...prev, filter.key],
      );
    },
    [onTransportModesChange, transportModes],
  );

  const isSurfaceRouteVisible = useCallback(
    (mode: Extract<TransportMode, "tram" | "bus">, routeLabel: string) => {
      const matchingFilter = SURFACE_ROUTE_FILTERS.find(
        (filter) => filter.mode === mode && filter.route === routeLabel,
      );

      if (!matchingFilter) {
        const modeFilterKeys = SURFACE_ROUTE_FILTERS.filter((filter) => filter.mode === mode).map((filter) => filter.key);
        return modeFilterKeys.every((key) => activeSurfaceRouteFilters.includes(key));
      }

      return activeSurfaceRouteFilters.includes(matchingFilter.key);
    },
    [activeSurfaceRouteFilters],
  );

  // Journey/selection focus is deliberately separate from the user's saved
  // filters. Closing the trip or bus sheet therefore restores the exact prior
  // network view without writing any preference state.
  const focusedBusRoutes = useMemo(() => {
    if (selectedBus?.route && selectedBus.route !== "Bus") {
      return new Set([normaliseSurfaceRouteLabel(selectedBus.route)]);
    }
    // Opening a bus stop should surface every live bus actually relevant to
    // it, the same way selecting one specific bus already narrows the map —
    // otherwise a route the rider has toggled off (or one outside the
    // zoom-level route cap) never appears on the map even though it's right
    // there in the stop's own departures card.
    if (selectedSurfaceStop?.modes.includes("bus")) {
      const stopRoutes = selectedSurfaceStop.routeLabel
        ? [selectedSurfaceStop.routeLabel]
        : (selectedSurfaceStopDepartures?.departures ?? []).map((departure) => departure.route);
      const normalisedStopRoutes = stopRoutes.map(normaliseSurfaceRouteLabel).filter((route) => route && route !== "Bus");
      if (normalisedStopRoutes.length > 0) return new Set(normalisedStopRoutes);
    }
    const routes = journeyBusRoutes
      .map(normaliseSurfaceRouteLabel)
      .filter((route) => route && route !== "Bus");
    return routes.length > 0 ? new Set(routes) : null;
  }, [journeyBusRoutes, selectedBus?.route, selectedSurfaceStop, selectedSurfaceStopDepartures]);
  const isBusRouteFocused = useCallback(
    (route: string) => !focusedBusRoutes || focusedBusRoutes.has(normaliseSurfaceRouteLabel(route)),
    [focusedBusRoutes],
  );

  const visibleLiveBuses = useMemo(
    () => {
      const filtered = liveBuses.filter(
        (bus) =>
          isBusRouteFocused(bus.route) && isSurfaceRouteVisible("bus", bus.route) &&
          visibleViewportBounds.contains(L.latLng(bus.lat, bus.lng)),
      );

      if (!isMobile) {
        return filtered;
      }

      const cap = mapZoom >= 14 ? 90 : mapZoom >= 13.25 ? 50 : 18;
      return sortVehiclesByViewportDistance(filtered, visibleViewportBounds).slice(0, cap);
    },
    [isBusRouteFocused, isMobile, isSurfaceRouteVisible, liveBuses, mapZoom, visibleViewportBounds],
  );
  const labelledLiveBusIds = useMemo(() => {
    const selectedId = selectedBus?.id;
    if (mapZoom < 14 || !mapRef.current) return new Set(selectedId ? [selectedId] : []);

    const map = mapRef.current;
    const size = map.getSize();
    const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const labelled = new Set<string>();
    const maximumLabels = mapZoom >= 16 ? 30 : mapZoom >= 15 ? 18 : 10;
    const candidates = [...visibleLiveBuses].sort((left, right) => {
      if (left.id === selectedId) return -1;
      if (right.id === selectedId) return 1;
      return left.id.localeCompare(right.id);
    });

    for (const bus of candidates) {
      if (labelled.size >= maximumLabels && bus.id !== selectedId) break;
      const point = map.latLngToContainerPoint([bus.lat, bus.lng]);
      const labelWidth = Math.min(132, Math.max(76, ((bus.destination?.length ?? 8) + 10) * 5.2));
      const rectangle = {
        left: point.x - labelWidth / 2 - 5,
        right: point.x + labelWidth / 2 + 5,
        top: point.y + 21,
        bottom: point.y + 48,
      };
      const insideSafeViewport = rectangle.left >= 12 && rectangle.right <= size.x - 12 && rectangle.bottom <= size.y - 92;
      const collides = occupied.some((other) =>
        rectangle.left < other.right && rectangle.right > other.left && rectangle.top < other.bottom && rectangle.bottom > other.top,
      );
      if (bus.id !== selectedId && (!insideSafeViewport || collides)) continue;
      labelled.add(bus.id);
      occupied.push(rectangle);
    }
    return labelled;
  }, [mapBounds, mapZoom, selectedBus?.id, visibleLiveBuses]);
  const visibleLiveTrams = useMemo(
    () => {
      const filtered = liveTrams.filter(
        (tram) =>
          isSurfaceRouteVisible("tram", tram.route) &&
          visibleViewportBounds.contains(L.latLng(tram.lat, tram.lng)),
      );

      if (!isMobile) {
        return filtered;
      }

      const cap = mapZoom >= 14 ? 110 : mapZoom >= 13.25 ? 60 : 22;
      return sortVehiclesByViewportDistance(filtered, visibleViewportBounds).slice(0, cap);
    },
    [isMobile, isSurfaceRouteVisible, liveTrams, mapZoom, visibleViewportBounds],
  );
  const selectedSurfaceStopLiveBuses = useMemo(() => {
    if (!selectedSurfaceStop || !selectedSurfaceStop.modes.includes("bus")) {
      return [];
    }

    // A multi-route interchange bay has routeLabel "" — no live bus's route
    // ever equals that, so this used to always come back empty for exactly
    // the stops (like a shared interchange bay) that most need it. Match
    // against every route actually shown on this stop's departures card
    // instead of a single (and here, unmatchable) routeLabel.
    const relevantRoutes = selectedSurfaceStop.routeLabel
      ? new Set([selectedSurfaceStop.routeLabel])
      : new Set((selectedSurfaceStopDepartures?.departures ?? []).map((departure) => departure.route));

    return visibleLiveBuses
      .map((bus) => ({
        bus,
        distanceMetres: getDistanceInMetres(selectedSurfaceStop.position, [bus.lat, bus.lng]),
      }))
      .filter(({ bus, distanceMetres }) => relevantRoutes.has(bus.route) && distanceMetres <= 3000)
      .sort((left, right) => left.distanceMetres - right.distanceMetres);
  }, [selectedSurfaceStop, selectedSurfaceStopDepartures, visibleLiveBuses]);
  const selectedSurfaceBusRouteStops = useMemo(() => {
    if (!selectedSurfaceStop || !selectedSurfaceStop.modes.includes("bus")) {
      return [];
    }

    return getOrderedSurfaceRouteStops(selectedSurfaceStop);
  }, [selectedSurfaceStop]);
  const selectedSurfaceBusLeadVehicle = useMemo(() => {
    if (selectedSurfaceStopLiveBuses.length === 0) {
      return null;
    }

    return (
      selectedSurfaceStopLiveBuses.find(({ bus }) => {
        const destination = bus.destination?.trim().toLowerCase();
        return destination && destination === getPrimarySurfaceDestination(selectedSurfaceStop!).trim().toLowerCase();
      }) ?? selectedSurfaceStopLiveBuses[0]
    );
  }, [selectedSurfaceStop, selectedSurfaceStopLiveBuses]);
  const selectedSurfaceBusCurrentStopIndex = useMemo(() => {
    if (selectedSurfaceBusRouteStops.length === 0) {
      return -1;
    }

    if (selectedSurfaceBusLeadVehicle) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;

      selectedSurfaceBusRouteStops.forEach((stop, index) => {
        const distance = getDistanceInMetres(stop.position, [
          selectedSurfaceBusLeadVehicle.bus.lat,
          selectedSurfaceBusLeadVehicle.bus.lng,
        ]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });

      return bestIndex;
    }

    return selectedSurfaceBusRouteStops.findIndex((stop) => stop.id === selectedSurfaceStop?.id);
  }, [selectedSurfaceBusLeadVehicle, selectedSurfaceBusRouteStops, selectedSurfaceStop]);
  const selectedSurfaceBusTrackingStops = useMemo(() => {
    if (selectedSurfaceBusRouteStops.length === 0) {
      return [];
    }

    const currentIndex =
      selectedSurfaceBusCurrentStopIndex >= 0
        ? selectedSurfaceBusCurrentStopIndex
        : Math.max(
            0,
            selectedSurfaceBusRouteStops.findIndex((stop) => stop.id === selectedSurfaceStop?.id),
          );

    return selectedSurfaceBusRouteStops.slice(currentIndex, currentIndex + 6);
  }, [selectedSurfaceBusCurrentStopIndex, selectedSurfaceBusRouteStops, selectedSurfaceStop]);
  const selectedSurfaceStopLiveTrams = useMemo(() => {
    if (!selectedSurfaceStop || !selectedSurfaceStop.modes.includes("tram")) {
      return [];
    }

    return visibleLiveTrams
      .map((tram) => ({
        tram,
        distanceMetres: getDistanceInMetres(selectedSurfaceStop.position, [tram.lat, tram.lng]),
      }))
      .filter(({ tram, distanceMetres }) => tram.route === selectedSurfaceStop.routeLabel && distanceMetres <= 3000)
      .sort((left, right) => left.distanceMetres - right.distanceMetres)
      .slice(0, 4);
  }, [selectedSurfaceStop, visibleLiveTrams]);

  const isServiceFilterActive = useCallback((filter: ServiceFilterKey) => {
    switch (filter) {
      case "geelongRegionalGroup":
        return transportModes.includes("vline") && (layers.geelongLine || layers.warrnamboolLine);
      case "ballaratRegionalGroup":
        return transportModes.includes("vline") && (layers.ballaratLine || layers.araratLine || layers.maryboroughLine);
      case "bendigoRegionalGroup":
        return transportModes.includes("vline") && (layers.bendigoLine || layers.echucaLine || layers.swanHillLine);
      case "seymourRegionalGroup":
        return transportModes.includes("vline") && (layers.seymourLine || layers.sheppartonLine || layers.alburyLine);
      case "traralgonRegionalGroup":
        return transportModes.includes("vline") && (layers.traralgonLine || layers.bairnsdaleLine);
      case "metroTunnelServices":
        return layers.metroTunnel || layers.sunburyLine || layers.cranbourneLine || layers.pakenhamLine;
      case "crossCityPink":
        return layers.werribeeLine || layers.sandringhamLine;
      case "werribeeWilliamstownGroup":
        return layers.werribeeLine;
      case "sandringhamGroup":
        return layers.sandringhamLine;
      case "burnleyGroup":
        return layers.belgraveLine || layers.lilydaleLine || layers.glenWaverleyLine || layers.alameinLine || layers.burnleyLoop;
      case "cliftonHillGroup":
        return layers.merndaLine || layers.hurstbridgeLine || layers.cliftonHillLoop;
      case "caulfieldGroup":
      case "frankstonGroup":
        return layers.frankstonLine;
      case "upfieldCraigieburn":
        return layers.upfieldLine || layers.craigieburnLine;
      case "upfieldCraigieburnCityLoop":
        return layers.northernLoop;
      default:
        return false;
    }
  }, [layers, transportModes]);

  const visibleReports = reports.filter((report) => {
    if (report.reportType === "inspector" && !layers.inspectors) return false;
    if (report.reportType === "delay" && !layers.delays) return false;
    if (report.reportType === "incident" && !layers.incidents) return false;
    if (report.transportType === "train" && !transportModes.includes("train")) return false;
    if (report.transportType === "tram" && !transportModes.includes("tram")) return false;
    if (report.transportType === "bus" && !transportModes.includes("bus")) return false;
    return true;
  });

  const inspectorReports = reports.filter(
    (report) => report.reportType === "inspector" && report.lat && report.lng
  );

  const liveTrainsErrorMessage =
    liveTrainsError instanceof Error ? liveTrainsError.message : null;
  const hasLiveTrainFeedError = Boolean(liveTrainsErrorMessage);
  const liveTrainStatusTone = hasLiveTrainFeedError
    ? "text-amber-200 border-amber-400/30 bg-amber-500/12"
    : liveVehicles.length > 0
      ? "text-emerald-200 border-emerald-400/30 bg-emerald-500/12"
      : "text-white/75 border-white/10 bg-slate-950/70";
  const liveTrainStatusLabel = hasLiveTrainFeedError
    ? "Live tracker needs attention"
    : mobilePerformanceEnabled && !allowMobileHeavyTrainTracking
      ? "Zoom in to load live trains"
    : isLiveTrainsLoading
      ? "Loading live trains"
      : liveVehicles.length > 0
        ? `${liveVehicles.length} live train${liveVehicles.length === 1 ? "" : "s"} on map`
        : "No active trains returned right now";
  const liveTrainStatusDetail = hasLiveTrainFeedError
    ? liveTrainsErrorMessage
    : mobilePerformanceEnabled && !allowMobileHeavyTrainTracking
      ? "Mobile mode delays train tracking until you zoom in a little further, which helps keep iPhone stable."
    : "Tap a train marker or use the planner live list to jump straight into trip tracking.";
  const liveBusStatusTone = visibleLiveBuses.length > 0
    ? "text-emerald-200 border-emerald-400/30 bg-emerald-500/12"
    : "text-white/75 border-white/10 bg-slate-950/70";
  const liveBusStatusLabel = isLiveBusesLoading
    ? "Loading live buses"
    : visibleLiveBuses.length > 0
      ? `${visibleLiveBuses.length} live bus${visibleLiveBuses.length === 1 ? "" : "es"} on map`
      : "No active buses returned right now";
  const liveTramStatusTone = visibleLiveTrams.length > 0
    ? "text-emerald-200 border-emerald-400/30 bg-emerald-500/12"
    : "text-white/75 border-white/10 bg-slate-950/70";
  const liveTramStatusLabel = isLiveTramsLoading
    ? "Loading live trams"
    : visibleLiveTrams.length > 0
      ? `${visibleLiveTrams.length} live tram${visibleLiveTrams.length === 1 ? "" : "s"} on map`
      : "No active trams returned right now";
  const visibleServiceFilters = SERVICE_FILTERS.filter((filter) => {
    if (filter.key === "crossCityPink") {
      return !splitCrossCityGroup;
    }
    if (filter.key === "werribeeWilliamstownGroup" || filter.key === "sandringhamGroup") {
      return splitCrossCityGroup;
    }
    if (filter.key === "upfieldCraigieburnCityLoop") {
      return false;
    }
    if (filter.key === "frankstonGroup") {
      return false;
    }
    return true;
  });
  const visibleTramRouteFilters = SURFACE_ROUTE_FILTERS.filter((filter) => filter.mode === "tram");
  const visibleBusRouteFilters = SURFACE_ROUTE_FILTERS.filter((filter) => filter.mode === "bus");
  const modeIsTrainVisible = transportModes.includes("train");
  const modeIsBusVisible = transportModes.includes("bus");
  const modeIsTramVisible = transportModes.includes("tram");
  const modeIsVlineVisible = transportModes.includes("vline");
  const markerOverrideMap = useMemo(
    () =>
      Object.fromEntries(
        [...markerOverrides, ...Object.values(draftMarkerOverrides)].map((override) => [override.markerName, override]),
      ),
    [draftMarkerOverrides, markerOverrides],
  );
  const resolveStation = useCallback(
    (station: Station): Station => {
      if (station.name === "Flagstaff") {
        return { ...station, position: FLAGSTAFF_POSITION };
      }
      if (station.name === "Melbourne Central") {
        return { ...station, position: MELBOURNE_CENTRAL_POSITION };
      }
      const canonicalPosition = findStationCoordinate(station.name);
      if (canonicalPosition) {
        station = { ...station, position: canonicalPosition };
      }
      const override = markerOverrideMap[station.name];
      if (!override) return station;
      if (!isMarkerEditMode && getDistanceInKm(station.position, [override.lat, override.lng]) > 0.75) {
        return station;
      }
      return { ...station, position: [override.lat, override.lng] };
    },
    [isMarkerEditMode, markerOverrideMap],
  );
  const editableStations = useMemo(() => {
    const seen = new Set<string>();
    return ALL_STATIONS.filter((station) => {
      if (seen.has(station.name)) return false;
      seen.add(station.name);
      return true;
    }).map(resolveStation);
  }, [resolveStation]);

  const toggleTransportMode = (mode: TransportMode) => {
    const nextModes = transportModes.includes(mode)
      ? transportModes.filter((item) => item !== mode)
      : [...transportModes, mode];
    onTransportModesChange?.(nextModes.length > 0 ? nextModes : [...DEFAULT_TRANSPORT_MODES]);
  };

  const saveEditedMarkers = async () => {
    const overrides = Object.values(draftMarkerOverrides);
    if (overrides.length === 0) {
      setIsMarkerEditMode(false);
      return;
    }
    await saveMarkerOverrides(overrides);
    setDraftMarkerOverrides({});
    await refetchMarkerOverrides();
    setIsMarkerEditMode(false);
  };

  const cancelEditedMarkers = () => {
    setDraftMarkerOverrides({});
    setIsMarkerEditMode(false);
  };

  const resetSavedMarkers = async () => {
    await saveMarkerOverrides([]);
    setDraftMarkerOverrides({});
    await refetchMarkerOverrides();
    setSelectedDetail(null);
    setIsMarkerEditMode(false);
  };

  return (
    <div className="absolute inset-0 z-0">
      <style>{`
        @keyframes ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }

        .leaflet-popup-content-wrapper {
          background: rgba(15,23,42,0.97) !important;
          border: 1px solid rgba(255,255,255,0.08) !important;
          border-radius: 16px !important;
          color: white !important;
          box-shadow: 0 20px 60px rgba(0,0,0,0.8) !important;
          padding: 0 !important;
        }

        .leaflet-popup-content {
          margin: 0 !important;
        }

        .leaflet-popup-tip {
          background: rgba(15,23,42,0.97) !important;
        }

        .leaflet-container {
          background: #0f172a;
        }

        .leaflet-control-zoom,
        .leaflet-control-attribution {
          display: none;
        }

        .transit-alert-map .leaflet-overlay-pane svg path {
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        @media (max-width: 700px) {
          .transit-alert-map .leaflet-overlay-pane svg path {
            stroke-width: 3px;
          }
        }

        .transit-alert-map .leaflet-tooltip {
          border: 1px solid rgba(148, 163, 184, 0.24);
          border-radius: 8px;
          background: rgba(8, 13, 24, 0.94);
          color: #f8fafc;
          box-shadow: 0 5px 18px rgba(0, 0, 0, 0.45);
          padding: 4px 7px;
          font-size: 11px;
          font-weight: 700;
        }

        .transit-alert-map .leaflet-tooltip::before {
          display: none;
        }
      `}</style>

      <MapContainer
        center={MELBOURNE_CENTER}
        zoom={13}
        zoomControl={false}
        preferCanvas={mobilePerformanceEnabled}
        zoomAnimation={!mobilePerformanceEnabled}
        fadeAnimation={!mobilePerformanceEnabled}
        markerZoomAnimation={!mobilePerformanceEnabled}
        dragging={!isMarkerEditMode}
        doubleClickZoom={!isMarkerEditMode}
        touchZoom={!isMarkerEditMode}
        scrollWheelZoom={!isMarkerEditMode}
        boxZoom={!isMarkerEditMode}
        keyboard={!isMarkerEditMode}
        className="transit-alert-map w-full h-full"
        style={{ background: "#0f172a" }}
        ref={(mapInstance) => {
          if (mapInstance) mapRef.current = mapInstance;
        }}
      >
        <ViewportListener
          onViewportChange={(zoom, bounds) => {
            setMapZoom(zoom);
            setMapBounds((previous) => previous?.equals(bounds) ? previous : bounds);
          }}
          onManualMove={() => setFollowSelectedService(false)}
        />
        <Pane name="stationPane" style={{ zIndex: 950 }} />
        {/* When you're not actively following a live vehicle, a stop you're
            standing at/near should win taps over any live bus/tram marker
            that happens to render on top of it — swap to a pane above both
            markerPane and stationPane. While a journey is being tracked,
            keep the old ordering so the followed vehicle stays on top. */}
        <Pane
          name="surfaceStopPriorityPane"
          style={{
            zIndex:
              selectedDetail?.type === "vehicle" || selectedDetail?.type === "tram" || selectedDetail?.type === "bus"
                ? 500
                : 970,
          }}
        />
        {consistData?.active && consistData.currentTrip?.estimatedPos && (
          <Marker
            position={consistData.currentTrip.estimatedPos as [number, number]}
            icon={L.divIcon({
              html: `
                <div style="position:relative;width:48px;height:48px;display:flex;align-items:center;justify-content:center;">
                  <div style="position:absolute;inset:0;border-radius:50%;background:#3b82f6;opacity:0.2;animation:ping 2s infinite;"></div>
                  <div style="width:38px;height:38px;border-radius:12px;background:#1e293b;border:2px solid #3b82f6;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.5);position:relative;">
                    <span style="font-size:18px;">🚂</span>
                    <div style="position:absolute;top:-8px;right:-8px;background:#3b82f6;color:white;font-size:9px;font-weight:bold;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);">430M</div>
                  </div>
                </div>
              `,
    className: "bg-transparent border-none",
              iconSize: [48, 48],
              iconAnchor: [24, 24],
            })}
          >
            <Popup>
              <div className="p-3 w-64">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
                  <span className="text-xl">🚂</span>
                  <div>
                    <p className="font-bold text-white text-sm">Consist 430M</p>
                    <p className="text-[10px] text-blue-400 font-semibold uppercase tracking-wider">
                      Live Tracking
                    </p>
                  </div>
                  <div className="ml-auto bg-green-500/20 text-green-400 text-[10px] px-2 py-0.5 rounded-full font-bold">
                    ACTIVE
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">
                      Current Trip
                    </p>
                    <p className="text-sm text-white/90 font-medium">
                      {consistData.currentTrip.route}
                    </p>
                    <p className="text-xs text-white/60">
                      to {consistData.currentTrip.destination}
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">
                      Progress
                    </p>
                    <p className="text-xs text-blue-400 font-bold">
                      {Math.round(consistData.currentTrip.progress * 100)}%
                    </p>
                  </div>

                  <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-500 h-full transition-all duration-1000"
                      style={{ width: `${consistData.currentTrip.progress * 100}%` }}
                    />
                  </div>

                  {consistData.alerts.length > 0 && (
                    <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                      <p className="text-[10px] text-yellow-500 font-bold flex items-center gap-1 uppercase tracking-wider">
                        <AlertTriangle className="w-3 h-3" />
                        Alert
                      </p>
                      <p className="text-[11px] text-yellow-200/80 leading-tight mt-1">
                        {consistData.alerts[0]}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        <TileLayer
          // Keep the core map independent from commercial API keys. Transit data is
          // layered above these public OSM tiles, so a missing provider credential
          // must never prevent someone from using the live map.
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          maxZoom={19}
          crossOrigin="anonymous"
        />
        <Polyline
          positions={ZONE_1_2_BOUNDARY}
          pathOptions={{
            color: "#f8fafc",
            weight: 2,
            opacity: 0.72,
            dashArray: "2 6",
            lineCap: "round",
          }}
        />

        <Pane name="railRoutePane" className="transit-rail-track-pane" style={{ zIndex: 360 }}>
{modeIsTrainVisible && layers.frankstonLine && (
  <>
  <Polyline
      positions={CAUFIELD_LOOP}
      pathOptions={{ color: "#22c55e", weight: 5, opacity: 0.9 }}
 />
    <Polyline
      positions={FRANKSTON_TRACK}
      pathOptions={{ color: "#22c55e", weight: 5, opacity: 0.9 }}
    />
    {renderStationMarkers(renderedStationKeys, FRANKSTON_STATIONS, "#22c55e", "#16a34a", resolveStation, (station) => setSelectedDetail({ type: "station", station }), toggleStationPillLine, stationMarkerVisibleBounds)}
  </>
)}
{modeIsTrainVisible && layers.stonyPointLine && (
  <>
    <Polyline
      positions={STONY_POINT_TRACK}
      pathOptions={{ color: "#78716c", weight: 5, opacity: 0.9 }}
    />
    {renderStationMarkers(renderedStationKeys, STONY_POINT_STATIONS, "#78716c", "#57534e", resolveStation, (station) => setSelectedDetail({ type: "station", station }), toggleStationPillLine, stationMarkerVisibleBounds)}
  </>
)}
{modeIsTrainVisible && layers.merndaLine && (
  <>
    <Polyline
      positions={MERNDA_BRANCH_LINE}
      pathOptions={{ color: "#BE1014", weight: 5, opacity: 0.85 }}
    />
    {renderStationMarkers(renderedStationKeys, RENDERED_MERNDA_STATIONS, "#BE1014", "#BE1014", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}

{modeIsTrainVisible && layers.hurstbridgeLine && (
  <>
    <Polyline
      positions={HURSTBRIDGE_BRANCH_LINE}
      pathOptions={{ color: "#BE1014", weight: 5, opacity: 0.85 }}
    />
    {renderStationMarkers(renderedStationKeys, RENDERED_HURSTBRIDGE_STATIONS, "#BE1014", "#BE1014", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}

{modeIsTrainVisible && layers.cliftonHillLoop && (
  <>
  <Polyline
  positions={JOLIMONT_TO_WEST_RICHMOND}
  pathOptions={{
    color: "#BE1014",
    weight: 5,
    opacity: 0.95,
  }}
/>
    <Polyline
      positions={CLIFTONHILL_LOOP}
      pathOptions={{ color: "#BE1014", weight: 5, opacity: 0.85 }}
    />
    {renderStationMarkers(renderedStationKeys, RENDERED_CLIFTONHILL_LOOP_STATIONS, "#BE1014", "#BE1014", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}
{modeIsTrainVisible && (layers.sunburyLine || layers.craigieburnLine || layers.upfieldLine || layers.northernLoop) && (
  <>
    {layers.craigieburnLine ? (
      <>
        <Polyline
          positions={NORTHERN_LOOP}
          pathOptions={{ color: "#FFD200", weight: 4.5, opacity: 0.88 }}
        />
      </>
    ) : (
      <Polyline
        positions={NORTHERN_LOOP}
        pathOptions={{ color: "#FFD200", weight: 5, opacity: 0.85 }}
      />
    )}
    {renderStationMarkers(
      renderedStationKeys,
      layers.craigieburnLine ? RENDERED_NORTHERN_LOOP_CRAIGIEBURN_STATIONS : RENDERED_NORTHERN_LOOP_STATIONS,
      "#FFD200",
      "#cca700",
      resolveStation,
      (station) => setSelectedDetail({ type: "station", station }),
      undefined,
      stationMarkerVisibleBounds,
    )}
  </>
)}

{modeIsTrainVisible && (layers.lilydaleLine || layers.belgraveLine || layers.alameinLine || layers.glenWaverleyLine || layers.burnleyLoop) && (
  <>
    <Polyline
      positions={BURNLEY_LOOP}
  pathOptions={{ color: "#003A8F", weight: 3, opacity: 0.6 }}
    />
    <Polyline
      positions={RICHMOND_TO_CITY_PORTAL_TRACK}
      pathOptions={{ color: "#003A8F", weight: 3, opacity: 0.72 }}
    />
    {renderStationMarkers(renderedStationKeys, RENDERED_BURNLEY_LOOP_STATIONS, "#003A8F", "#003A8F", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}
{modeIsTrainVisible && layers.lilydaleLine && (
  <>
    <Polyline
      positions={LILYDALE_LINE}
      pathOptions={{
        color: "#003A8F",
        weight: 5,
        opacity: 0.85,
      }}
    />
    {renderStationMarkers(renderedStationKeys, LILYDALE_STATIONS, "#003A8F", "#003A8F", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}

{modeIsTrainVisible && layers.belgraveLine && (
  <>
    <Polyline
      positions={BELGRAVE_LINE}
      pathOptions={{
        color: "#003A8F",
        weight: 5,
        opacity: 0.85,
      }}
    />
    {renderStationMarkers(renderedStationKeys, BELGRAVE_STATIONS, "#003A8F", "#003A8F", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}

{modeIsTrainVisible && layers.alameinLine && (
  <>
    <Polyline
      positions={ALAMEIN_LINE}
      pathOptions={{
        color: "#003A8F",
        weight: 5,
        opacity: 0.85,
      }}
    />
    {renderStationMarkers(renderedStationKeys, ALAMEIN_STATIONS, "#003A8F", "#003A8F", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}

{modeIsTrainVisible && layers.glenWaverleyLine && (
  <>
    <Polyline
      positions={GLEN_WAVERLEY_LINE}
      pathOptions={{
        color: "#003A8F",
        weight: 5,
        opacity: 0.85,
      }}
    />
    {renderStationMarkers(renderedStationKeys, RENDERED_GLEN_WAVERLEY_STATIONS, "#003A8F", "#003A8F", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}
{modeIsTrainVisible && layers.craigieburnLine && (
  <>
    <Polyline
      positions={CRAIGIEBURN_LINE}
      pathOptions={{
        color: "#FFD200",
        weight: 4.75,
        opacity: 0.88,
      }}
    />
    {renderStationMarkers(renderedStationKeys, CRAIGIEBURN_STATIONS, "#FFD200", "#cca700", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}

{modeIsTrainVisible && layers.upfieldLine && (
  <>
    <Polyline
      positions={UPFIELD_LINE}
      pathOptions={{
        color: "#FFD200",
        weight: 5,
        opacity: 0.85,
      }}
    />
    {renderStationMarkers(renderedStationKeys, UPFIELD_STATIONS, "#FFD200", "#cca700", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}
        {modeIsTrainVisible && layers.cranbourneLine && (
          <>
            <Polyline
              positions={CRANBOURNE_LINE}
              pathOptions={{ color: "#279FD5", weight: 5, opacity: 0.85 }}
            />
            {renderStationMarkers(renderedStationKeys, CRANBOURNE_STATIONS, "#279FD5", "#1e7ba8", resolveStation, (station) => setSelectedDetail({ type: "station", station }), toggleStationPillLine, stationMarkerVisibleBounds)}
          </>
        )}

        {modeIsTrainVisible && layers.pakenhamLine && (
          <>
            <Polyline
              positions={PAKENHAM_GTFS_LINE}
              pathOptions={{ color: "#279FD5", weight: 5, opacity: 0.85 }}
            />
            {renderStationMarkers(renderedStationKeys, PAKENHAM_STATIONS, "#279FD5", "#1e7ba8", resolveStation, (station) => setSelectedDetail({ type: "station", station }), toggleStationPillLine, stationMarkerVisibleBounds)}
          </>
        )}

        {/* Sunbury-line trains stay visible while EITHER this layer or Metro
            Tunnel is on (see the live-vehicle filter above) — since real
            Sunbury services now run through the tunnel, the track/stations
            need the same OR so a train is never shown floating with no
            corridor drawn under it when only one of the two is toggled off. */}
        {modeIsTrainVisible && (layers.sunburyLine || layers.metroTunnel) && (
          <>
            <Polyline
              positions={SUNBURY_LINE}
              pathOptions={{ color: "#279FD5", weight: 5, opacity: 0.85 }}
            />
            {renderStationMarkers(renderedStationKeys, SUNBURY_STATIONS, "#279FD5", "#1e7ba8", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
          </>
        )}

        {modeIsTrainVisible && layers.metroTunnel && (
          <>
            <Polyline
              positions={METRO_TUNNEL_LINE}
              pathOptions={{ color: "#279FD5", weight: 5, opacity: 0.85 }}
            />
            {renderStationMarkers(renderedStationKeys, METRO_TUNNEL_STATIONS, "#279FD5", "#1e7ba8", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
          </>
        )}
{modeIsTrainVisible && layers.werribeeLine && (
  <>
    {/* Werribee main line */}
    <Polyline
      positions={WERRIBEE_LINE}
      pathOptions={{
        color: "#F178AF",
        weight: 5,
        opacity: 0.85,
      }}
    />


    {/* Williamstown branch */}
    <Polyline
      positions={WILLIAMSTOWN_LINE}
      pathOptions={{
        color: "#F178AF",
        weight: 5,
        opacity: 0.85,
      }}
    />

    {/* Altona loop branch */}
    <Polyline
      positions={ALTONA_LOOP_LINE}
      pathOptions={{
        color: "#F178AF",
        weight: 5,
        opacity: 0.85,
      }}
    />

    {renderStationMarkers(renderedStationKeys, RENDERED_WERRIBEE_STATIONS, "#F178AF", "#9f5d7c", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
    {renderStationMarkers(renderedStationKeys, RENDERED_WILLIAMSTOWN_STATIONS, "#F178AF", "#9f5d7c", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
    {renderStationMarkers(renderedStationKeys, RENDERED_ALTONA_LOOP_STATIONS, "#F178AF", "#9f5d7c", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
  </>
)}
        {modeIsTrainVisible && layers.sandringhamLine && (
          <>
            <Polyline
              positions={SANDRINGHAM_TRACK_UP}
              pathOptions={{ color: "#F178AF", weight: 3, opacity: 0.85 }}
            />
            <Polyline
              positions={SANDRINGHAM_TRACK_DOWN}
              pathOptions={{ color: "#F178AF", weight: 3, opacity: 0.85 }}
            />
            {renderStationMarkers(renderedStationKeys, SANDRINGHAM_STATIONS, "#F178AF", "#9f5d7c", resolveStation, (station) => setSelectedDetail({ type: "station", station }), undefined, stationMarkerVisibleBounds)}
          </>
        )}

        {modeIsVlineVisible && (
          <>
            {GENERATED_VLINE_GTFS.map((route) => {
              const routeKey = route.id.split("-").at(-1)?.replace(":", "") ?? "";
              const visible =
                (["GEL", "WBL"].includes(routeKey) && (layers.geelongLine || layers.warrnamboolLine)) ||
                (["BAT", "ART", "MBY"].includes(routeKey) && (layers.ballaratLine || layers.araratLine || layers.maryboroughLine)) ||
                (["BGO", "ECH", "SWL"].includes(routeKey) && (layers.bendigoLine || layers.echucaLine || layers.swanHillLine)) ||
                (["SER", "SNH", "ABY"].includes(routeKey) && (layers.seymourLine || layers.sheppartonLine || layers.alburyLine)) ||
                (["TRN", "BDE"].includes(routeKey) && (layers.traralgonLine || layers.bairnsdaleLine));
              if (!visible) return null;
              const stations: Station[] = route.stations.map((station) => ({
                // Real V/Line GTFS data names these "<Name> Station" while
                // every metro line array uses the bare name — left
                // unnormalised, a station served by both (e.g. Dandenong)
                // never matches the metro render's dedup key or a
                // MULTI_RING_STATION_COLORS lookup, and renders as two
                // separate overlapping markers instead of one.
                name: station.name.replace(/\s+Station$/i, ""),
                position: [station.position[0], station.position[1]],
                vline: true,
              }));
              return (
                <Fragment key={route.id}>
                  <Polyline
                    positions={route.shape as unknown as [number, number][]}
                    pathOptions={{ color: route.color, weight: 4.75, opacity: 0.92 }}
                  />
                  {renderStationMarkers(
                    renderedStationKeys,
                    stations,
                    route.color,
                    "#5b21b6",
                    resolveStation,
                    (station) => setSelectedDetail({ type: "station", station }),
                    toggleStationPillLine,
                    stationMarkerVisibleBounds,
                  )}
                </Fragment>
              );
            })}
            <Polyline
              positions={XPT_INTERSTATE_LINE}
              pathOptions={{ color: "#d9480f", weight: 4, opacity: 0.9, dashArray: "10 7" }}
            />
            {renderRouteStopMarkers(
              XPT_INTERSTATE_STOPS,
              "#d9480f",
              "#d9480f",
              "NSW TrainLink XPT standard-gauge interstate route",
              visibleViewportBounds,
            )}
          </>
        )}

        </Pane>

        {journeyLegSegments && journeyLegSegments.length > 0 ? (
          <>
            {journeyLegSegments.map((segment, index) => {
              const style = JOURNEY_LEG_MODE_STYLE[segment.mode];
              return (
                <Polyline
                  key={`journey-leg-${index}`}
                  positions={segment.positions}
                  pathOptions={{
                    color: getJourneyLegColor(segment),
                    weight: style.weight,
                    opacity: 0.95,
                    dashArray: style.dashArray,
                  }}
                />
              );
            })}

            {journeyLegSegments.slice(1).map((segment, index) => (
              <CircleMarker
                key={`journey-transfer-${index}`}
                center={segment.positions[0]}
                radius={5}
                pathOptions={{ color: "#f8fafc", fillColor: getJourneyLegColor(segment), fillOpacity: 1, weight: 2 }}
              />
            ))}

            {[
              { position: journeyLegSegments[0].positions[0], label: "Origin", color: "#fb923c" },
              {
                position: journeyLegSegments[journeyLegSegments.length - 1].positions.at(-1)!,
                label: "Destination",
                color: "#facc15",
              },
            ].map((point) => (
              <CircleMarker
                key={point.label}
                center={point.position}
                radius={8}
                pathOptions={{ color: "#f59e0b", fillColor: point.color, fillOpacity: 1, weight: 2 }}
              >
                <Popup>
                  <div className="p-3 w-48">
                    <p className="font-semibold text-white">{point.label}</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </>
        ) : (
          journeyRoute && journeyRoute.length > 1 && (
          <>
            <Polyline
              positions={journeyRoute.map((station) => station.position)}
              pathOptions={{
                color: "#facc15",
                weight: 6,
                opacity: 0.95,
                dashArray: "8 6",
              }}
            />

            {[journeyRoute[0], journeyRoute[journeyRoute.length - 1]].map(
              (station, index) => (
                <CircleMarker
                  key={`journey-${station.name}-${index}`}
                  center={station.position}
                  radius={8}
                  pathOptions={{
                    color: "#f59e0b",
                    fillColor: index === 0 ? "#fb923c" : "#facc15",
                    fillOpacity: 1,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div className="p-3 w-48">
                      <p className="font-semibold text-white">
                        {index === 0 ? "Origin" : "Destination"}
                      </p>
                      <p className="text-xs text-white/60 mt-1">{station.name}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              )
            )}
          </>
          )
        )}

        {modeIsBusVisible && selectedBusTrip?.stops.length ? (
          <>
            <Polyline
              positions={selectedBusTrip.stops
                .filter((stop) => typeof stop.lat === "number" && typeof stop.lng === "number")
                .map((stop) => [stop.lat!, stop.lng!] as [number, number])}
              pathOptions={{ color: "#fb923c", weight: 7, opacity: 0.92 }}
            />
            {selectedBusTrip.stops
              .filter((stop) => typeof stop.lat === "number" && typeof stop.lng === "number")
              .map((stop) => (
                <CircleMarker
                  key={`focused-bus-stop-${selectedBusTrip.tripId}-${stop.stopId}-${stop.stopSequence}`}
                  center={[stop.lat!, stop.lng!]}
                  radius={stop.stopSequence === selectedBusTrip.stops[selectedBusCurrentStopIndex]?.stopSequence ? 6 : 3.5}
                  pathOptions={{ color: "#fed7aa", fillColor: "#fb923c", fillOpacity: 1, weight: 2 }}
                >
                  <Tooltip direction="top">{stop.name}</Tooltip>
                </CircleMarker>
              ))}
          </>
        ) : null}

        {layers.heatCircles &&
          allowIosReportLayer &&
          inspectorReports.map((report) => (
            <Circle
              key={`heat-${report.id}`}
              center={[report.lat!, report.lng!]}
              radius={600}
              pathOptions={{
                color: "transparent",
                fillColor: "#e11d48",
                fillOpacity: 0.12,
              }}
            />
          ))}

        {userLoc && !selectedFollowTarget && (
          <Circle
            center={userLoc}
            radius={80}
            pathOptions={{
              color: "#60a5fa",
              fillColor: "#3b82f6",
              fillOpacity: 0.7,
              weight: 2,
            }}
          />
        )}

        {!isGuest && modeIsTrainVisible && (
          <Marker
            position={featuredConsistPosition}
            icon={createFeaturedConsistIcon(featuredConsistIsLive)}
            zIndexOffset={2800}
            riseOnHover
          >
            <Popup>
              <div className="w-64 p-3">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                  <div>
                    <p className="text-sm font-bold text-white">Consist {FEATURED_CONSIST}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300/80">
                      Starred map marker
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${featuredConsistIsLive ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/70 text-slate-200"}`}>
                    {featuredConsistIsLive ? "Live" : "Approx"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-white/85">
                  {featuredConsistSnapshot?.current_trip
                    ? `${featuredConsistSnapshot.current_trip.origin} to ${featuredConsistSnapshot.current_trip.destination}`
                    : featuredConsistSnapshot?.next_trip
                      ? `Next run: ${featuredConsistSnapshot.next_trip.origin} to ${featuredConsistSnapshot.next_trip.destination}`
                      : "No active trip right now, so this is a rough placeholder on the map."}
                </p>
                <p className="mt-2 text-xs text-white/55">
                  {featuredConsistSnapshot?.position?.vehicle_stop_status === "STOPPED_AT"
                    ? `Last known stop: ${featuredConsistSnapshot.position.current_stop}`
                    : featuredConsistSnapshot?.position?.current_stop
                      ? `Approx near ${featuredConsistSnapshot.position.current_stop}`
                      : "Pinned near the city until a better estimate is available."}
                </p>
              </div>
            </Popup>
          </Marker>
        )}
        {modeIsTrainVisible &&
          metroLiveVehicles.map((vehicle) => {
            const vehicleKey = getVehicleFocusKey(vehicle);
            const isSelected = selectedVehicleKey === vehicleKey || Boolean(selectedVehicle?.tripId && vehicle.tripId === selectedVehicle.tripId);
            const isHovered = hoveredVehicleKey === vehicleKey;
            const priority = getTrainLabelPriority(vehicle);
            const isZoomedOut = mapZoom <= 13;
            const hideSecondaryLabel = false;
            const boardContextVehicle = isSelected && selectedBoardServiceContext?.vehicleKey === vehicleKey
              ? {
                  ...vehicle,
                  origin: selectedBoardServiceContext.origin,
                  destination: selectedBoardServiceContext.destination,
                  serviceDescription: `${vehicle.line} · ${selectedBoardServiceContext.origin} → ${selectedBoardServiceContext.destination}`,
                }
              : vehicle;
            const markerVehicle = isSelected && selectedTrainTrip?.tripId === vehicle.tripId
              ? {
                  ...boardContextVehicle,
                  origin: selectedTrainFormationOrigin ?? selectedTrainCurrentOrigin ?? boardContextVehicle.origin,
                  destination: selectedTrainFormationDestination ?? selectedTrainFinalDestination ?? selectedTrainCurrentDestination ?? boardContextVehicle.destination,
                }
              : boardContextVehicle;

            return (
              <Marker
                key={vehicleKey}
                position={[vehicle.lat, vehicle.lng]}
                icon={createLiveTrainIcon(markerVehicle, {
                  expanded: isSelected || isHovered,
                  selected: isSelected,
                  dimmed: isZoomedOut && priority !== "high" && !isSelected && !isHovered,
                  hideSecondaryLabel,
                  routeStops: isSelected && selectedTrainTrip?.tripId === vehicle.tripId ? selectedVerifiedHeadingStops : undefined,
                })}
                zIndexOffset={isSelected ? 4600 : isHovered ? 4200 : hideSecondaryLabel ? 3600 : 3900}
                riseOnHover
                eventHandlers={{
                  mouseover: () => setHoveredVehicleKey(vehicleKey),
                  mouseout: () => setHoveredVehicleKey((current) => (current === vehicleKey ? null : current)),
                  click: () => setSelectedDetail({ type: "vehicle", vehicle }),
                }}
              />
            );
          })}
        {modeIsVlineVisible &&
          vlineLiveVehicles.map((vehicle) => {
            const vehicleKey = getVehicleFocusKey(vehicle);
            const isSelected = selectedVehicleKey === vehicleKey || Boolean(selectedVehicle?.tripId && vehicle.tripId === selectedVehicle.tripId);
            const isHovered = hoveredVehicleKey === vehicleKey;
            const isZoomedOut = mapZoom <= 13;
            const boardContextVehicle = isSelected && selectedBoardServiceContext?.vehicleKey === vehicleKey
              ? {
                  ...vehicle,
                  origin: selectedBoardServiceContext.origin,
                  destination: selectedBoardServiceContext.destination,
                  serviceDescription: `${vehicle.line} · ${selectedBoardServiceContext.origin} → ${selectedBoardServiceContext.destination}`,
                }
              : vehicle;
            const markerVehicle = isSelected && selectedTrainTrip?.tripId === vehicle.tripId
              ? {
                  ...boardContextVehicle,
                  destination: selectedTrainCrossCityDestination ?? selectedTrainCurrentDestination ?? boardContextVehicle.destination,
                }
              : boardContextVehicle;

            return (
              <Marker
                key={vehicleKey}
                position={[vehicle.lat, vehicle.lng]}
                icon={createLiveTrainIcon(markerVehicle, {
                  expanded: isSelected || isHovered || mapZoom >= 14.5,
                  selected: isSelected,
                  dimmed: false,
                  hideSecondaryLabel: false,
                  routeStops: isSelected && selectedTrainTrip?.tripId === vehicle.tripId ? selectedVerifiedHeadingStops : undefined,
                })}
                zIndexOffset={isSelected ? 4700 : isHovered ? 4300 : 4000}
                riseOnHover
                eventHandlers={{
                  mouseover: () => setHoveredVehicleKey(vehicleKey),
                  mouseout: () => setHoveredVehicleKey((current) => (current === vehicleKey ? null : current)),
                  click: () => setSelectedDetail({ type: "vehicle", vehicle }),
                }}
              />
            );
          })}
        {modeIsBusVisible &&
          visibleLiveBuses.map((bus) => {
            const isSelected = selectedBus?.id === bus.id || Boolean(selectedBus?.tripId && selectedBus.tripId === bus.tripId);
            return (
            <Marker
              key={bus.vehicleId || bus.registration || bus.fleetNumber || bus.id}
              position={[bus.lat, bus.lng]}
              icon={createLiveBusIcon(bus, { showLabel: isSelected || labelledLiveBusIds.has(bus.id), selected: isSelected })}
              zIndexOffset={isSelected ? 3100 : labelledLiveBusIds.has(bus.id) ? 1500 : 1000}
              riseOnHover
              eventHandlers={{
                click: () => setSelectedDetail({ type: "bus", bus }),
                popupopen: () => setSelectedDetail({ type: "bus", bus }),
              }}
            >
              <Popup>
                <div className="w-56 p-3">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                    <div>
                      <p className="text-sm font-bold text-white">
                        {bus.route === "Bus" ? "Live bus" : `Route ${bus.route}`}
                      </p>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-300/80">
                        Operated by {bus.operator ?? "Operator not published"}
                      </p>
                    </div>
                    <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-200">
                      Live
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Route direction</p>
                    <p className="mt-0.5 text-sm font-semibold text-white/90">
                      {bus.destination ? `To ${bus.destination}` : "Not supplied by PTV"}
                    </p>
                  </div>
                  {getLiveBusStopLabel(bus) ? (
                    <p className="mt-1.5 text-xs font-medium text-sky-200">{getLiveBusStopLabel(bus)}</p>
                  ) : null}
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                    {bus.fleetNumber ? (
                      <div className="rounded-lg bg-white/5 px-2 py-1.5 text-white/70">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-white/40">Bus number</span>
                        {bus.fleetNumber}
                      </div>
                    ) : null}
                    {bus.registration ? (
                      <div className="rounded-lg bg-white/5 px-2 py-1.5 text-white/70">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-white/40">Registration</span>
                        {bus.registration}
                      </div>
                    ) : null}
                    {bus.vehicleId && bus.vehicleId !== bus.fleetNumber ? (
                      <div className="rounded-lg bg-white/5 px-2 py-1.5 text-white/70">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-white/40">Vehicle ID</span>
                        {bus.vehicleId}
                      </div>
                    ) : null}
                    {bus.tripId ? (
                      <div className="rounded-lg bg-white/5 px-2 py-1.5 text-white/70">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-white/40">PTV run</span>
                        <span className="block truncate">{bus.tripId}</span>
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-white/55">
                    {bus.timestamp
                      ? `Last reported ${formatRelativeTime(bus.timestamp)}`
                      : "Live feed timestamp unavailable"}
                  </p>
                </div>
              </Popup>
            </Marker>
            );
          })}
        {modeIsTramVisible &&
          visibleLiveTrams.map((tram) => (
            <Marker
              key={tram.id}
              position={[tram.lat, tram.lng]}
              icon={createLiveTramIcon(tram)}
              zIndexOffset={1100}
              riseOnHover
              eventHandlers={{
                click: () => setSelectedDetail({ type: "tram", tram }),
                popupopen: () => setSelectedDetail({ type: "tram", tram }),
              }}
            >
              <Popup>
                <div className="w-56 p-3">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                    <div>
                      <p className="text-sm font-bold text-white">
                        {tram.route === "Tram" ? "Live tram" : `Route ${tram.route}`}
                      </p>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
                        {tram.operator ?? "Yarra Trams"}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                      Live
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-white/85">{tram.destination ?? "Live vehicle position"}</p>
                  <p className="mt-2 text-xs text-white/55">
                    {tram.timestamp
                      ? `Last reported ${formatRelativeTime(tram.timestamp)}`
                      : "Live feed timestamp unavailable"}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        {modeIsBusVisible &&
          allowIosSurfaceStops && allowDenseSurfaceStops &&
          renderSurfaceStops(
            ANYTRIP_SURFACE_STOPS.filter(
              (stop) => stop.modes.includes("bus") && isBusRouteFocused(stop.routeLabel) && isSurfaceRouteVisible("bus", stop.routeLabel),
            ),
            "#FF8200",
            "#FF8200",
            (stop) => setSelectedDetail({ type: "surfaceStop", stop }),
            visibleViewportBounds,
            "bus",
            "surfaceStopPriorityPane",
          )}
        {/* Every real bus stop statewide, not just the curated routes above —
            gated behind the same "very close zoom" threshold as the dense
            curated layer so this never renders more than the stops actually
            visible in a small viewport. */}
        {modeIsBusVisible &&
          allowIosSurfaceStops && allowDenseSurfaceStops &&
          renderSurfaceStops(
            allBusStops,
            "#FF8200",
            "#FF8200",
            (stop) => setSelectedDetail({ type: "surfaceStop", stop }),
            visibleViewportBounds,
            "bus",
            "surfaceStopPriorityPane",
          )}
        {modeIsTramVisible &&
          allowTramStops &&
          renderSurfaceStops(
            ANYTRIP_SURFACE_STOPS.filter(
              (stop) => stop.modes.includes("tram") && isSurfaceRouteVisible("tram", stop.routeLabel),
            ),
            "#78BE20",
            "#78BE20",
            (stop) => setSelectedDetail({ type: "surfaceStop", stop }),
            visibleViewportBounds,
            "tram",
            "surfaceStopPriorityPane",
          )}
        {/* Named interchange bays (Chadstone, Box Hill) always render as
            individual markers under the bus layer — never behind the
            mobile-performance dense-stop caps or per-route layer toggles
            above, since collapsing a 10-13 bay interchange back down to one
            marker is exactly what this list exists to prevent. */}
        {modeIsBusVisible &&
          renderSurfaceStops(
            BUS_INTERCHANGE_BAYS,
            "#FF8200",
            "#FF8200",
            (stop) => setSelectedDetail({ type: "surfaceStop", stop }),
            visibleViewportBounds,
            "bus",
            "surfaceStopPriorityPane",
          )}
        {/* Freight/heritage/empty-car pass-throughs — timetable-interpolated
            positions only, never real GPS, so always the "EST" icon variant
            and always gated behind its own opt-in layer toggle rather than
            mixed into the real live-vehicle layers above. */}
        {(layers.freight || layers.heritage || layers.nonPassenger) &&
          FREIGHT_TIMING_DATA.filter((service) => {
            if (service.serviceType === "PASSING FREIGHT" && !layers.freight) return false;
            if (service.serviceType === "HERITAGE SPECIAL" && !layers.heritage) return false;
            if ((service.serviceType === "EMPTY CARS" || service.serviceType === "NON-PASSENGER") && !layers.nonPassenger) return false;
            return true;
          }).map((service) => {
            const position = interpolatePositionAtTime(service, Math.floor(Date.now() / 1000) % 86400);
            if (!position) return null;
            return (
              <Marker key={service.trainNumber} position={position} icon={createNonPassengerServiceIcon(service.serviceType)}>
                <Popup>
                  <div className="w-56 p-3">
                    <p className="text-sm font-bold uppercase tracking-[0.08em] text-red-200">Does not stop</p>
                    <p className="mt-1 text-sm text-white/85">
                      {service.operator} {service.trainNumber}
                    </p>
                    <p className="mt-1 text-xs text-white/55">
                      {service.serviceType.charAt(0) + service.serviceType.slice(1).toLowerCase()} · {service.origin} → {service.destination}
                    </p>
                    <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300">Estimated position — timetable only, not GPS</p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        {allowIosReportLayer && visibleReports.map((report) => {
          if (!report.lat || !report.lng) return null;

          return (
            <Marker
              key={report.id}
              position={[report.lat, report.lng]}
              icon={createCustomIcon(report)}
              eventHandlers={{
                click: () => setSelectedDetail({ type: "report", report }),
              }}
            >
              <Popup>
                <div className="p-4 w-64">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
                    <span className="text-2xl">
                      {TRANSPORT_EMOJI[report.transportType]}
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm capitalize">
                        {REPORT_LABEL[report.reportType]}
                      </p>
                      <p className="text-[11px] text-white/40">
                        {formatRelativeTime(report.createdAt)}
                      </p>
                    </div>
                    <span
                      className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide"
                      style={{
                        background: `${REPORT_COLOR[report.reportType]}33`,
                        color: REPORT_COLOR[report.reportType],
                      }}
                    >
                      {report.transportType}
                    </span>
                  </div>

                  {(report.lineNumber || report.direction) && (
                    <div className="flex items-center gap-2 mb-2">
                      {report.lineNumber && (
                        <span className="bg-white/10 text-white text-xs font-bold px-2 py-1 rounded-lg">
                          Line {report.lineNumber}
                        </span>
                      )}
                      {report.direction && report.direction !== "unknown" && (
                        <span className="text-xs text-white/60">
                          {DIRECTION_LABEL[report.direction]}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mb-2">
                    <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">
                      Location
                    </p>
                    <p className="text-sm text-white/90 font-medium">
                      {report.locationName}
                    </p>
                  </div>

                  {report.notes && (
                    <div className="bg-white/5 border border-white/5 rounded-xl p-2 text-xs text-white/70 italic mb-2">
                      "{report.notes}"
                    </div>
                  )}

                  <p className="text-right text-[10px] text-white/30">
                    by{" "}
                    <span className="text-white/50 font-medium">
                      {report.username}
                    </span>
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {isAdmin ? selectedAdminDebugOverlay : null}

        {isAdmin &&
          isMarkerEditMode &&
          editableStations.map((station) => {
            const override = draftMarkerOverrides[station.name];
            const markerPosition: [number, number] = override ? [override.lat, override.lng] : station.position;
            const isSelected = selectedDetail?.type === "station" && selectedDetail.station.name === station.name;

            return (
              <Marker
                key={`editor-${station.name}`}
                position={markerPosition}
                draggable
                zIndexOffset={5000}
                riseOnHover
                icon={createEditorMarkerIcon(isSelected)}
                eventHandlers={{
                  click: () => setSelectedDetail({ type: "station", station: { ...station, position: markerPosition } }),
                  dragend: (event) => {
                    const latlng = event.target.getLatLng();
                    setDraftMarkerOverrides((prev) => ({
                      ...prev,
                      [station.name]: {
                        markerName: station.name,
                        markerType: "station",
                        lat: latlng.lat,
                        lng: latlng.lng,
                      },
                    }));
                    setSelectedDetail({
                      type: "station",
                      station: { ...station, position: [latlng.lat, latlng.lng] },
                    });
                  },
                }}
              />
            );
          })}
      </MapContainer>

      <LayerControl layers={layers} onChange={toggleLayer} open={isLayerPanelOpen} onOpenChange={setIsLayerPanelOpen} />

      {modeIsTrainVisible && !isLayerPanelOpen && (
        <div className="pointer-events-none absolute left-3 top-[7.25rem] z-[1000] sm:left-4 sm:top-28">
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur-xl ${liveTrainStatusTone}`}>
            <Train className="h-3.5 w-3.5" />
            <span>{liveTrainStatusLabel}</span>
          </div>
        </div>
      )}

      {modeIsBusVisible && !isLayerPanelOpen && (
        <div className="pointer-events-none absolute left-3 top-[9.25rem] z-[1000] sm:left-4 sm:top-36">
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur-xl ${liveBusStatusTone}`}>
            <Bus className="h-3.5 w-3.5" />
            <span>{liveBusStatusLabel}</span>
          </div>
        </div>
      )}

      {modeIsTramVisible && !isLayerPanelOpen && (
        <div className="pointer-events-none absolute left-3 top-[11.25rem] z-[1000] sm:left-4 sm:top-44">
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur-xl ${liveTramStatusTone}`}>
            <TramFront className="h-3.5 w-3.5" />
            <span>{liveTramStatusLabel}</span>
          </div>
        </div>
      )}

        {(modeIsTrainVisible || modeIsVlineVisible) && (
      <div className="pointer-events-auto absolute left-3 top-[14.45rem] z-[1000] hidden w-[12.5rem] sm:left-4 sm:top-[12.7rem] sm:block sm:w-[18.75rem]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/88 p-3 shadow-xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                {isPremium ? "Premium train lookup" : "Premium train lookup"}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {isPremium ? "Search by consist or TDN" : "Upgrade to search by TDN or consist"}
              </p>
            </div>
            <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
              Premium
            </span>
          </div>

          <div className="mt-3 flex gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
              <input
                value={trainLookupQuery}
                onChange={(event) => {
                  setTrainLookupQuery(event.target.value);
                  if (trainLookupMessage) {
                    setTrainLookupMessage("");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleTrainLookup();
                  }
                }}
                placeholder={isPremium ? "430M or X046" : "Premium required"}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none transition focus:border-blue-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!isPremium}
              />
            </label>
            <button
              type="button"
              onClick={handleTrainLookup}
              className="rounded-xl border border-blue-400/30 bg-blue-500/15 px-3 py-2 text-xs font-semibold text-blue-100 transition hover:bg-blue-500/25"
              disabled={!isPremium}
            >
              Find
            </button>
          </div>

          {trainLookupMessage ? (
            <p className="mt-2 text-xs leading-4 text-white/60">{trainLookupMessage}</p>
          ) : (
            <p className="mt-2 text-xs leading-4 text-white/50">
              {isPremium
                ? "Premium members can jump straight to live consists and save favourites."
                : "Public and standard accounts only see generic service labels like 22:57 FSS Service until premium is enabled."}
            </p>
          )}

          {isPremium && favouriteConsists.length > 0 ? (
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Favourite consists</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {favouriteConsists.slice(0, 8).map((consist) => (
                  <button
                    key={consist}
                    type="button"
                    onClick={() => {
                      setTrainLookupQuery(consist);
                      setTrainLookupMessage("");
                      const liveMatch = [...metroLiveVehicles, ...vlineLiveVehicles].find(
                        (vehicle) =>
                          normaliseConsistLookupValue(getDisplayConsist(vehicle.consist)) === normaliseConsistLookupValue(consist),
                      );
                      if (liveMatch) {
                        focusVehicleOnMap(liveMatch);
                        setTrainLookupMessage(`Jumped to favourite consist ${consist}.`);
                        return;
                      }
                      setTrainLookupMessage(`${consist} is saved, but no live match is showing right now.`);
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/75 transition hover:bg-white/10"
                  >
                    {consist}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      )}

      {showFilterRail && (
      <div className="absolute right-3 top-[8.55rem] z-[1000] w-[7.3rem] sm:right-6 sm:top-32 sm:w-[11.5rem]">
        <div className="max-h-[44vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/82 p-2 shadow-xl backdrop-blur-xl sm:max-h-[68vh] sm:p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
            Transport Modes
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:mt-3 sm:gap-2">
              {([
                { key: "train", label: "Trains", icon: "train" },
                { key: "vline", label: "V/Line", icon: "vline" },
                { key: "tram", label: "Trams", icon: "tram" },
                { key: "bus", label: "Buses", icon: "bus" },
              ] as Array<{ key: TransportMode; label: string; icon: "train" | "tram" | "bus" | "vline" }>).map((mode) => {
              const active = transportModes.includes(mode.key);
              return (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => toggleTransportMode(mode.key)}
                  className={`rounded-xl border px-2 py-1.5 text-left text-[11px] font-semibold leading-tight transition sm:px-3 sm:py-2 sm:text-xs ${
                    active
                      ? "border-blue-400/40 bg-blue-500/12 text-blue-100"
                      : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"
                  }`}
                >
                  <span className="flex items-center gap-1.5 sm:gap-2">
                    {mode.icon === "train" ? (
                      <img src={trainIcon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain opacity-90 sm:h-4 sm:w-4" />
                    ) : mode.icon === "bus" ? (
                      <img
                        src={smartbusIcon}
                        alt=""
                        className={`h-3.5 w-3.5 shrink-0 object-contain opacity-90 sm:h-4 sm:w-4 ${active ? "" : "grayscale brightness-75 opacity-55"}`}
                      />
                    ) : mode.icon === "tram" ? (
                      <img
                        src={tramIcon}
                        alt=""
                        className={`h-3.5 w-3.5 shrink-0 object-contain opacity-90 sm:h-4 sm:w-4 ${active ? "" : "grayscale brightness-75 opacity-55"}`}
                      />
                    ) : (
                      <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-current/25 px-1 text-[8px] font-bold leading-none sm:h-4 sm:min-w-4 sm:text-[9px]">
                        V
                      </span>
                    )}
                    <span className="truncate">{mode.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {isAdmin && (
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setIsMarkerEditMode((value) => !value)}
                className={`rounded-xl border px-2 py-1.5 text-left text-[11px] font-semibold transition sm:px-3 sm:py-2 sm:text-xs ${
                  isMarkerEditMode
                    ? "border-amber-400/40 bg-amber-500/12 text-amber-100"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {isMarkerEditMode ? "Marker edit mode on" : "Edit markers"}
              </button>
              {isMarkerEditMode && (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => void saveEditedMarkers()}
                  className="rounded-xl border border-emerald-400/30 bg-emerald-500/12 px-2 py-1.5 text-[11px] font-semibold text-emerald-100 sm:px-3 sm:py-2 sm:text-xs"
                  >
                    Save edits
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditedMarkers}
                  className="rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-white/70 sm:px-3 sm:py-2 sm:text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void resetSavedMarkers()}
                  className="rounded-xl border border-red-400/25 bg-red-500/10 px-2 py-1.5 text-[11px] font-semibold text-red-100 sm:px-3 sm:py-2 sm:text-xs"
                  >
                    Reset all
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
            Service Filters
          </p>
          <div className="mt-2.5 flex flex-col gap-1.5 sm:mt-3 sm:gap-2">
            {visibleServiceFilters.map((filter) => {
              const active = isServiceFilterActive(filter.key);
              const chips = getFilterChips(filter.key);
              return (
                <div key={filter.key} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggleServiceFilter(filter.key)}
                    className={`rounded-xl border px-2 py-1.5 text-left transition sm:px-3 sm:py-2 ${
                      active
                        ? filter.tone
                        : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    <div className="text-[11px] font-semibold leading-tight sm:text-xs">{filter.label}</div>
                    {filter.description && (
                      <div className="mt-0.5 text-[9px] font-medium leading-3.5 text-current/75 sm:text-[10px] sm:leading-4">
                        {filter.description}
                      </div>
                    )}
                    {chips.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {chips.map((chip) => (
                          <span
                            key={`${filter.key}-${chip}`}
                            className="rounded-full border border-current/20 bg-black/15 px-1.5 py-0.5 text-[9px] font-semibold text-current/85 sm:px-2 sm:text-[10px]"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                Tram Routes
              </p>
              <div className="mt-2.5 flex flex-col gap-1.5 sm:mt-3 sm:gap-2">
                {visibleTramRouteFilters.map((filter) => {
                  const active = isSurfaceRouteFilterActive(filter);
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => toggleSurfaceRouteFilter(filter)}
                      className={`rounded-xl border px-2 py-1.5 text-left transition sm:px-3 sm:py-2 ${
                        active
                          ? filter.tone
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      <div className="text-[11px] font-semibold leading-tight sm:text-xs">{filter.label}</div>
                      {filter.description && (
                        <div className="mt-0.5 text-[9px] font-medium leading-3.5 text-current/75 sm:text-[10px] sm:leading-4">
                          {filter.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                Bus Routes
              </p>
              <div className="mt-2.5 flex flex-col gap-1.5 sm:mt-3 sm:gap-2">
                {visibleBusRouteFilters.map((filter) => {
                  const active = isSurfaceRouteFilterActive(filter);
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => toggleSurfaceRouteFilter(filter)}
                      className={`rounded-xl border px-2 py-1.5 text-left transition sm:px-3 sm:py-2 ${
                        active
                          ? filter.tone
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      <div className="text-[11px] font-semibold leading-tight sm:text-xs">{filter.label}</div>
                      {filter.description && (
                        <div className="mt-0.5 text-[9px] font-medium leading-3.5 text-current/75 sm:text-[10px] sm:leading-4">
                          {filter.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

        <div
          className={`absolute bottom-[6.75rem] right-4 z-[1001] flex flex-col gap-3 max-[430px]:bottom-[6.5rem] max-[430px]:right-3 sm:bottom-24 sm:right-6 ${
            selectedDetail?.type === "vehicle" ? "md:left-auto md:right-[26rem]" : "md:left-auto md:right-6"
          }`}
        >
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          className="rounded-xl border border-white/20 bg-slate-950/78 p-2.5 shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4 text-white" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          className="rounded-xl border border-white/20 bg-slate-950/78 p-2.5 shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4 text-white" />
        </button>
        <button
          type="button"
          onClick={centerOnUserLocation}
          className="rounded-xl border border-white/20 bg-slate-950/78 p-2.5 shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
          title="Center on my location"
        >
          <Navigation className="h-4 w-4 text-white" />
        </button>
        {selectedFollowTarget && (
          <button
            type="button"
            onClick={() => {
              setFollowSelectedService((value) => !value);
              safeFlyTo(mapRef.current, selectedFollowTarget.lat, selectedFollowTarget.lng, mapRef.current?.getZoom() ?? 14, { animate: true, duration: 0.65 });
            }}
            className={`rounded-xl border p-2.5 shadow-lg backdrop-blur-md transition-colors ${followSelectedService ? "border-white/60 text-white" : "border-white/20 text-white/80"}`}
            style={{ backgroundColor: selectedVehicle ? "rgba(37,99,235,.86)" : selectedBus ? "rgba(234,88,12,.86)" : "rgba(5,150,105,.86)" }}
            title={followSelectedService ? "Stop following selected service" : "Follow selected service"}
            aria-label={followSelectedService ? "Stop following selected service" : "Follow selected service"}
          >
            <Crosshair className={`h-4 w-4 ${followSelectedService ? "animate-pulse" : ""}`} />
          </button>
        )}
      </div>

      {selectedDetail?.type === "vehicle" && (
        <div onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-0 z-[1003] mx-auto h-[72dvh] w-full max-w-full touch-pan-y overscroll-contain overflow-x-hidden overflow-y-auto rounded-t-[1.6rem] border border-white/10 bg-slate-950/98 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl md:inset-x-auto md:bottom-6 md:right-4 md:top-24 md:h-auto md:max-h-[calc(100%-7rem)] md:w-[24rem] md:rounded-[1.6rem] md:p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.24em]"
                style={{ color: `${selectedVehicleAccent}cc` }}
              >
                {selectedVehicleIsRegional ? "Regional tracker" : "Train tracker"}
              </p>
              <p className="mt-1.5 text-[1.35rem] font-semibold leading-tight text-white">
                {selectedVehicleHeadingLabel}
              </p>
              {selectedVehicleJourneyLabel && (
                <p className="mt-1 text-sm font-medium text-white/65">
                  {selectedVehicleJourneyLabel}
                </p>
              )}
              {isPremium ? (
                selectedVehicleJourneyId && (
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">TDN {selectedVehicleJourneyId}</p>
                )
              ) : (
                selectedVehicle?.timestamp && (
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                    {getMarkerServiceTime(selectedVehicle.timestamp)}
                  </p>
                )
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedStationService(null);
                setSelectedDetail(null);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white/70"
            >
              ×
            </button>
          </div>

          <div
            className="mt-3 rounded-[1.35rem] border p-3.5"
            style={{
              borderColor: selectedVehicleDelayMinutes >= 10 ? "rgba(248,113,113,0.30)" : selectedVehicleDelayMinutes > 0 ? "rgba(251,191,36,0.28)" : "rgba(52,211,153,0.24)",
              background: selectedVehicleDelayMinutes >= 10 ? "rgba(127,29,29,0.18)" : selectedVehicleDelayMinutes > 0 ? "rgba(120,53,15,0.16)" : "rgba(6,78,59,0.16)",
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
              {selectedVehicleIsRegional ? "Regional service" : "Running service"}
            </p>
            <p className="mt-1.5 text-lg font-semibold leading-tight text-white">
              {selectedVehiclePatternLabel}
            </p>
            <p className="mt-1.5 text-xs text-white/65">
              {selectedVehicleSnapshot?.current_trip
                ? `Running now from ${formatRouteWindow(selectedVehicleSnapshot.current_trip.departs)} to ${formatRouteWindow(selectedVehicleSnapshot.current_trip.arrives)}`
                : selectedRegionalProfile
                  ? `${selectedVehicleServiceTypeLabel} · Platform ${selectedRegionalProfile.platform} · Updated live`
                : selectedVehicleSnapshot?.next_trip
                  ? `Departs ${formatRouteWindow(selectedVehicleSnapshot.next_trip.departs)} and arrives ${formatRouteWindow(selectedVehicleSnapshot.next_trip.arrives)}`
                  : selectedTrainTrip?.stops.length
                    ? "Verified GTFS schedule with live stop updates."
                    : "Using the live feed fallback while trip-level timing is unavailable."}
            </p>
            {selectedRegionalRestrictionSummary ? (
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                Stop restrictions: {selectedRegionalRestrictionSummary}
              </p>
            ) : null}
          </div>

          {selectedRegionalProfile && (
            <div
              className="mt-3 rounded-[1.35rem] border p-3.5"
              style={{
                borderColor: "rgba(124,58,237,0.28)",
                background: "rgba(76,29,149,0.18)",
              }}
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Final delay</p>
                  <p className="mt-1 text-sm font-semibold text-white">{selectedVehicleDelayMinutes} min</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Type</p>
                  <p className="mt-1 text-sm font-semibold text-white">{selectedVehicleTypeLabel}</p>
                </div>
                {selectedVehicleRealtimeLabel && (
                  <div className="md:col-span-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Live trip</p>
                    <p className="mt-1 text-sm font-semibold text-white">{selectedVehicleRealtimeLabel}</p>
                  </div>
                )}
                {selectedVehicleSpecialLabel && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Special</p>
                    <p className="mt-1 text-sm font-semibold text-amber-100">{selectedVehicleSpecialLabel}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Window</p>
                  <p className="mt-1 text-sm font-semibold text-white">{selectedVehicleWindowLabel}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Duration</p>
                  <p className="mt-1 text-sm font-semibold text-white">{selectedVehicleDurationLabel}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Date</p>
                  <p className="mt-1 text-sm font-semibold text-white">{selectedVehicleDateLabel}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Journey</p>
                  <p className="mt-1 text-sm font-semibold text-white">{selectedVehicleJourneyLabel || "Live"}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3.5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 sm:gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
                  Origin
                </p>
                <p className="mt-1.5 break-words text-[clamp(.85rem,4vw,1.5rem)] font-semibold leading-tight tracking-tight text-white [overflow-wrap:anywhere]">
                  {selectedVehicleOriginLabel}
                </p>
              </div>
              <div className="mt-6 flex items-center gap-2 text-emerald-300/80">
                <div className="h-px w-5 bg-emerald-400/30" />
                <ArrowRight className="h-4 w-4" />
                <div className="h-px w-5 bg-emerald-400/30" />
              </div>
              <div className="min-w-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
                  Destination
                </p>
                <p className="mt-1.5 break-words text-[clamp(.85rem,4vw,1.5rem)] font-semibold leading-tight tracking-tight text-white [overflow-wrap:anywhere]">
                  {selectedVehicleDestinationLabel}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  border: `1px solid ${selectedVehicleIsRegional ? "rgba(196,181,253,0.30)" : "rgba(52,211,153,0.20)"}`,
                  background: selectedVehicleIsRegional ? "rgba(124,58,237,0.18)" : "rgba(16,185,129,0.10)",
                  color: selectedVehicleIsRegional ? "#ede9fe" : "#d1fae5",
                }}
              >
                {selectedVehicleSnapshot?.position?.vehicle_stop_status === "STOPPED_AT"
                  ? `Stopped at ${selectedVehicleSnapshot.position.current_stop}`
                  : selectedVehiclePatternLabel}
              </span>
              {selectedVehicleSnapshot?.current_trip?.url && (
                <a
                  href={selectedVehicleSnapshot.current_trip.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/70"
                >
                  Open source
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-white/10 pt-3.5 text-sm text-white/70 [&>*]:min-w-0 [&_p]:break-words">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Type</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedVehicleTypeLabel}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Operator</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {isNswTrainLinkLiveTrain(selectedDetail.vehicle)
                    ? "NSW TrainLink"
                    : isSydneyTrainsLiveTrain(selectedDetail.vehicle)
                      ? "Sydney Trains"
                      : isVlineLiveTrain(selectedDetail.vehicle)
                        ? "V/Line"
                        : /sydney metro/i.test(selectedDetail.vehicle.line)
                          ? "Sydney Metro"
                          : "Metro Trains Melbourne"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
                  Train type
                </p>
                <p className="mt-2.5 text-xl font-semibold leading-tight text-white">
                  {selectedVehicleTypeLabel}
                </p>
                </div>
              </div>
            </div>

            {(selectedVehicleRegionalSetLabel || getDisplayConsist(selectedDetail.vehicle.consist)) && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                      {selectedVehicleIsRegional ? "Allocated set" : "Consist"}
                    </p>
                    <p className="mt-1.5 text-sm font-semibold text-white">
                      {selectedVehiclePassengerConsistLabel}
                    </p>
                    {selectedVehicleIsHcmtMetroTunnel && selectedVehicleDisplayConsist && (
                      <p className="mt-0.5 text-[10px] font-medium text-white/35">Raw consist {selectedVehicleDisplayConsist}</p>
                    )}
                  </div>

                  {selectedVehicleDisplayConsist ? (
                    isPremium ? (
                      <button
                        type="button"
                        onClick={() => handleFavouriteConsistClick(selectedVehicleDisplayConsist)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                          selectedVehicleIsFavouriteConsist
                            ? "border-amber-400/30 bg-amber-500/15 text-amber-100"
                            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                        }`}
                      >
                        <Star className="h-3 w-3" />
                        {selectedVehicleIsFavouriteConsist ? "Saved" : "Favourite"}
                      </button>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                        Premium only
                      </span>
                    )
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
                Position estimate
              </p>
              <p className="mt-2.5 text-sm text-white/85">
                {selectedVehiclePositionEstimateLabel}
              </p>
              {selectedVehicleRelevantAlerts.length ? (
                <div className="mt-3 rounded-[1.1rem] border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-50/95">
                  {selectedVehicleRelevantAlerts[0]}
                </div>
              ) : null}
          </div>

          {(!selectedVehicleIsRegional || !selectedRegionalProfile) && selectedVehiclePatternStops.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.03]">
              <div className="border-b border-white/10 px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
                      Stopping pattern
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {selectedVehiclePatternStops.length} stops toward {selectedVehicleDestinationLabel}
                    </p>
                  </div>
                  <span
                    className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em]"
                    style={{
                      borderColor: selectedVehicleDelayMinutes >= 10 ? "rgba(248,113,113,.45)" : selectedVehicleDelayMinutes > 0 || selectedDetail.vehicle.status === "delayed" ? "rgba(251,191,36,.4)" : "rgba(52,211,153,.4)",
                      backgroundColor: selectedVehicleDelayMinutes >= 10 ? "rgba(239,68,68,.14)" : selectedVehicleDelayMinutes > 0 || selectedDetail.vehicle.status === "delayed" ? "rgba(245,158,11,.14)" : "rgba(16,185,129,.14)",
                      color: selectedVehicleDelayMinutes >= 10 ? "#fecaca" : selectedVehicleDelayMinutes > 0 || selectedDetail.vehicle.status === "delayed" ? "#fde68a" : "#a7f3d0",
                    }}
                  >
                    {selectedVehicleDelayMinutes >= 10
                      ? "Major delay"
                      : selectedDetail.vehicle.status === "delayed" || selectedVehicleDelayMinutes > 0
                      ? "Minor delay"
                      : selectedDetail.vehicle.status === "early"
                        ? "Running early"
                        : "On time"}
                  </span>
                </div>
                {selectedVehicleRelevantAlerts.length > 0 && (
                  <div className="mt-3 flex gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-50">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                    <span className="line-clamp-2">{selectedVehicleRelevantAlerts[0]}</span>
                  </div>
                )}
              </div>

              {isTrainTripLoading && (
                <p className="px-3.5 py-3 text-sm text-white/60">Loading verified trip times and platforms...</p>
              )}
              {trainTripError && selectedDetail.vehicle.tripId && (
                <p className="mx-3.5 mt-3 rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Verified trip details are temporarily unavailable. Showing the mapped stopping pattern.
                </p>
              )}
              {selectedVehiclePatternStops.length > 0 && (
                <div className="px-3.5 pt-3">
                  <StopProgressSummary
                    accent={selectedVehicleAccent}
                    progress={getStopProgress(
                      selectedVehiclePatternStops.map((station) => station.name),
                      selectedVehicleLiveTimelinePosition,
                      selectedVehicleIsStoppedAtPublishedStop ? selectedVehicleCurrentStopIndex : undefined,
                    )}
                  />
                  <button type="button" disabled={selectedVehicleCurrentStopIndex <= 1} onClick={() => setShowPriorStops((value) => !value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45">
                    {showPriorStops ? "Hide prior stops" : selectedVehicleCurrentStopIndex > 1 ? `Show ${selectedVehicleCurrentStopIndex - 1} prior stops` : "No hidden prior stops"}
                  </button>
                </div>
              )}
              {(() => {
                // The final stop's own dwellSeconds is always 0 — the trip
                // record ends there. The train doesn't vanish though: it sits
                // at the platform until it reforms as the next TDN in the
                // chain (the same "Next service" card below already shows
                // that TDN's real departure time) — real, computable dwell,
                // not a guess.
                let nextServiceDepartsAt: string | undefined;
                if (selectedTrainTrip?.segments?.length) {
                  const available = selectedTrainTrip.formationSegments?.length
                    ? selectedTrainTrip.formationSegments
                    : selectedTrainTrip.segments;
                  const activeTripId = selectedTrainTrip.scheduledTripId || selectedTrainTrip.tripId;
                  const workings = selectedTrainTrip.serviceWorkings ?? available.map((segment) => ({ crossCity: false, segments: [segment] }));
                  const currentIndex = workings.findIndex((working) => working.segments.some((segment) => segment.tripId === activeTripId));
                  const nextWorking = currentIndex >= 0 ? workings[currentIndex + 1] : undefined;
                  nextServiceDepartsAt = nextWorking?.segments[0]?.departsAt;
                }

                return (
              <div className="px-3.5 py-2">
                {selectedVehicleVisiblePatternStops.map(({ station, index }, visibleIndex) => {
                  const tripStop = selectedTrainTrip?.stops[index];
                  const isLastVisibleStop = visibleIndex === selectedVehicleVisiblePatternStops.length - 1;
                  const dwellUntilNextServiceMinutes = isLastVisibleStop && tripStop?.expectedArrivalAt && nextServiceDepartsAt
                    ? Math.round((Date.parse(nextServiceDepartsAt) - Date.parse(tripStop.expectedArrivalAt)) / 60_000)
                    : null;
                  const isCurrent = selectedVehicleIsStoppedAtPublishedStop && index === selectedVehicleCurrentStopIndex;
                  // selectedVehicleCurrentStopIndex is now GPS-position-derived when a
                  // live vehicle is selected (see its own definition) — trust that over
                  // tripStop.status, whose time-based passed/upcoming call a delay can
                  // throw off. Only fall back to the raw status when there's no vehicle
                  // position to derive an index from at all (e.g. a plain schedule view).
                  const isPassed = selectedVehicleCurrentStopIndex >= 0 ? index < selectedVehicleCurrentStopIndex : tripStop?.status === "passed";
                  const isLast = visibleIndex === selectedVehicleVisiblePatternStops.length - 1;
                  const isPrevious = selectedVehicleCurrentStopIndex > 0 && index === selectedVehicleCurrentStopIndex - 1;
                  const isNext = selectedVehicleCurrentStopIndex >= 0 && (isCurrent ? index === selectedVehicleCurrentStopIndex + 1 : index === selectedVehicleCurrentStopIndex);
                  const publishedTime = isCurrent
                    ? selectedVehicleSnapshot?.position?.current_stop_time
                    : null;
                  const arrivalTime = tripStop?.expectedArrivalAt
                    ? new Date(tripStop.expectedArrivalAt).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })
                    : null;
                  const departureTime = tripStop?.expectedDepartureAt
                    ? new Date(tripStop.expectedDepartureAt).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })
                    : null;
                  const delayMinutes = Math.round((tripStop?.delaySeconds ?? 0) / 60);
                  // NSW TrainLink XPT has no live per-stop match (fetchTrainTrip only
                  // queries PTV's Victorian timetable API), so tripStop is always
                  // undefined for it — fall back to the real published GTFS schedule
                  // this station carries instead of a blank "Time TBC".
                  const scheduledArrival = !tripStop ? formatGtfsScheduleTime(station.scheduledArrival) : null;
                  const scheduledDeparture = !tripStop ? formatGtfsScheduleTime(station.scheduledDeparture) : null;

                  const showLivePositionBefore = selectedVehicleLiveTimelinePosition?.beforeIndex === index;

                  return (
                    <Fragment key={`${selectedDetail.vehicle.tdn}-${station.name}-${index}`}>
                    {showLivePositionBefore && selectedVehicleLiveTimelinePosition && (
                      <div className="grid grid-cols-[4.25rem_1.25rem_minmax(0,1fr)] gap-2.5">
                        <div className="py-2 text-right text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-300/75">
                          Live
                        </div>
                        <div className="relative flex justify-center">
                          <div className="absolute inset-y-0 w-1" style={{ backgroundColor: `${selectedVehicleAccent}aa` }} />
                          <div
                            className="relative z-10 my-2 h-4 w-4 animate-pulse rounded-full border-2 border-white shadow-[0_0_0_5px_rgba(56,189,248,0.18)]"
                            style={{ backgroundColor: selectedVehicleAccent }}
                          />
                        </div>
                        <div className="my-1 rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-2">
                          <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-100">Train is here</p>
                          <p className="mt-0.5 text-[10px] text-white/55">
                            {formatLiveSegmentLabel(selectedVehicleLiveTimelinePosition)}
                          </p>
                          {formatUpdatedAgo(selectedVehicle?.timestamp) && (
                            <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-cyan-200/60">
                              {formatUpdatedAgo(selectedVehicle?.timestamp)}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    <div
                      className={`grid grid-cols-[4.25rem_1.25rem_minmax(0,1fr)] gap-2.5 ${isPassed ? "opacity-45" : ""}`}
                    >
                      <div className="py-3 text-right">
                        {/* A trip's first stop has only a departure time: show it as the
                            row's time rather than "Time TBC" above a separate "dep" line. */}
                        <p className={`text-sm font-semibold ${isCurrent ? "text-white" : "text-white/70"}`}>{arrivalTime || departureTime || (publishedTime ? formatRouteWindow(publishedTime) : scheduledArrival || scheduledDeparture || (isCurrent ? "Now" : "Time TBC"))}</p>
                        {(arrivalTime && departureTime && departureTime !== arrivalTime) || (scheduledArrival && scheduledDeparture && scheduledDeparture !== scheduledArrival) ? (
                          <p className="text-xs font-semibold text-white/55">{departureTime || scheduledDeparture} dep</p>
                        ) : null}
                        <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/35">
                          {tripStop?.status === "skipped"
                            ? "Not stopping"
                            : dwellUntilNextServiceMinutes !== null && dwellUntilNextServiceMinutes > 0
                              ? `${dwellUntilNextServiceMinutes}m dwell until next service`
                              : isPrevious ? "Last stop" : isCurrent ? "Stopped here" : isNext ? "Next stop" : tripStop ? `${Math.round(tripStop.dwellSeconds / 60)}m dwell` : scheduledArrival ? "Scheduled" : "Schedule unavailable"}
                        </p>
                      </div>

                      <div className="relative flex justify-center">
                        {!isLast && (
                          <div
                            className="absolute bottom-0 top-0 w-1"
                            style={{ backgroundColor: isPassed ? `${selectedVehicleAccent}55` : `${selectedVehicleAccent}aa` }}
                          />
                        )}
                        <div
                          className={`relative z-10 mt-[1.15rem] rounded-full border-2 ${isCurrent ? "h-5 w-5 shadow-[0_0_0_5px_rgba(255,255,255,0.08)]" : "h-2.5 w-2.5"}`}
                          style={{
                            borderColor: isCurrent ? "white" : selectedVehicleAccent,
                            backgroundColor: isCurrent ? selectedVehicleAccent : isPassed ? selectedVehicleAccent : "rgb(2 6 23)",
                          }}
                        />
                      </div>

                      <div className={`py-3 ${isCurrent ? "rounded-xl bg-white/[0.055] px-2.5" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`truncate font-semibold ${isCurrent ? "text-base text-white" : "text-sm text-white/90"}`}>
                              {station.name}
                            </p>
                            <p className="mt-0.5 text-xs text-white/45">{tripStop?.platform ? `Platform ${tripStop.platform}` : !tripStop && station.platform ? `Platform ${station.platform}` : "Platform not published"}</p>
                            {(tripStop?.pickupType === "none" || (!tripStop && station.pickupType === "1")) && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-white/70">
                                <Ban className="h-2.5 w-2.5" /> Drop off only
                              </span>
                            )}
                            {(tripStop?.dropOffType === "none" || (!tripStop && station.dropOffType === "1")) && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-white/70">
                                <Ban className="h-2.5 w-2.5" /> Pick up only
                              </span>
                            )}
                            {tripStop && <p className={`mt-1 text-[10px] font-semibold ${delayMinutes >= 10 ? "text-red-300" : delayMinutes > 0 ? "text-amber-300" : "text-emerald-300"}`}>{delayMinutes > 0 ? `${delayMinutes} min late` : delayMinutes < 0 ? `${Math.abs(delayMinutes)} min early` : "On time"}</p>}
                          </div>
                          {isCurrent && (
                            <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/75">
                              Stopped
                            </span>
                          )}
                          {isNext && !isCurrent && (
                            <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/75">
                              Next
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    </Fragment>
                  );
                })}
              </div>
                );
              })()}

              {selectedTrainTrip?.segments?.length ? (
                <div className="grid gap-2 border-t border-white/10 px-3.5 py-3">
                  {(() => {
                    const available = selectedTrainTrip.formationSegments?.length
                      ? selectedTrainTrip.formationSegments
                      : selectedTrainTrip.segments;
                    const activeTripId = selectedTrainTrip.scheduledTripId || selectedTrainTrip.tripId;
                    const workings = selectedTrainTrip.serviceWorkings ?? available.map((segment) => ({ crossCity: false, segments: [segment] }));
                    const currentIndex = workings.findIndex((working) => working.segments.some((segment) => segment.tripId === activeTripId));
                    type ChainCard =
                      | { kind: "linked"; label: string; segment: TrainFormationSegment; components: TrainFormationSegment[]; crossCity: boolean; crossCityKind?: "flinders-street" | "metro-tunnel"; highlighted?: boolean }
                      | { kind: "placeholder"; label: string; text: string };
                    const cards: ChainCard[] = [];
                    // Show up to 2 workings back and 2 ahead of the current one, so a
                    // full 5-service chain is visible when the timetable confirms it.
                    for (const [offset, label] of [[-2, "Earlier service"], [-1, "Previous service"], [0, "Current service"], [1, "Next service"], [2, "Following service"]] as const) {
                      const working = currentIndex >= 0 ? workings[currentIndex + offset] : undefined;
                      if (working) {
                        cards.push({ kind: "linked", label: "connectionSource" in working && working.connectionSource === "scheduled-turnaround" ? label + " · Scheduled connection" : label, segment: working.segments[0], components: working.segments, crossCity: working.crossCity, crossCityKind: "crossCityKind" in working ? working.crossCityKind : undefined, highlighted: offset === 0 });
                      } else if (offset === -1 || offset === 1) {
                        // The backend already checks every trip sharing this
                        // physical train's block_id, so "stabled" here is a
                        // confirmed fact (this run genuinely starts/ends
                        // service at this point today), not a guess — show it
                        // plainly instead of the vaguer "not confirmed"
                        // wording, which should only apply when that check
                        // was inconclusive ("unknown"). Only the immediate
                        // neighbour gets this explanatory placeholder — a
                        // missing 2nd-away working (offset ±2) just means the
                        // chain doesn't reach that far and needs no card.
                        const formationStatus = offset < 0
                          ? selectedTrainTrip.previousFormationStatus
                          : selectedTrainTrip.nextFormationStatus;
                        const text = formationStatus === "stabled"
                          ? (offset < 0
                            ? "No earlier service — this train starts service here today."
                            : "No further service — this train is stabled here for the rest of today.")
                          : (offset < 0
                            ? "Earlier working not confirmed by the available timetable."
                            : "Next working not confirmed by the available timetable.");
                        cards.push({ kind: "placeholder", label, text });
                      }
                    }

                    if (cards.length === 0) {
                      return <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-5 text-white/50">No separately published previous or next service is available for this run.</p>;
                    }

                    return cards.map((card) => {
                      if (card.kind === "placeholder") {
                        return (
                          <div
                            key={card.label}
                            className="rounded-[1.15rem] border border-dashed border-white/15 bg-white/[0.03] px-4 py-3"
                          >
                            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                              {card.label}
                            </p>
                            <p className="mt-1 text-sm font-medium text-white/60">{card.text}</p>
                          </div>
                        );
                      }

                      const { label, segment, components, crossCity, crossCityKind, highlighted } = card;
                      const crossCityLabel = crossCityKind === "metro-tunnel" ? "Metro Tunnel service" : "Cross-city through service";
                      const segmentLine = segment.route || selectedDetail.vehicle.line;
                      const segmentColor = getLiveLineColor(segmentLine);
                      const time = segment.departsAt
                        ? new Date(segment.departsAt).toLocaleTimeString("en-AU", {
                            timeZone: "Australia/Melbourne",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Time TBC";
                      const place = `${segment.origin?.replace(/\s+Station$/i, "") || "Unknown origin"} → ${segment.destination?.replace(/\s+Station$/i, "") || "Unknown destination"}`;

                      const serviceTitle = isPremium
                        ? (crossCity ? "TDNs " + components.map((part) => part.tdn).join(" + ") : "TDN " + segment.tdn)
                        : time;
                      const throughRoute = crossCity
                        ? segment.origin?.replace(/\s+Station$/i, "") + " → " + components.at(-1)?.destination?.replace(/\s+Station$/i, "") + (crossCityKind === "metro-tunnel" ? " via Metro Tunnel" : " via Flinders Street")
                        : place;
                      const secondaryLine = isPremium ? `${time} · ${throughRoute}` : throughRoute;
                      const componentList = crossCity ? (
                        <div className="mt-2 grid gap-1 text-xs">
                          {components.map((part) => {
                            const active = highlighted && part.tripId === activeTripId;
                            const partArrivalTime = part.arrivesAt
                              ? new Date(part.arrivesAt).toLocaleTimeString("en-AU", {
                                  timeZone: "Australia/Melbourne",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : null;
                            return <p key={part.tripId} aria-current={active ? "step" : undefined} className={active ? "rounded-md bg-white/15 px-2 py-1 font-bold text-white" : "px-2 py-1 text-white/60"}>
                              {isPremium ? `${part.tdn} — ` : ""}{part.origin?.replace(/\s+Station$/i, "")} → {part.destination?.replace(/\s+Station$/i, "")}
                              {partArrivalTime ? ` · arr ${partArrivalTime}` : ""}{active ? " · Active" : ""}
                            </p>;
                          })}
                        </div>
                      ) : null;

                      if (highlighted) {
                        return (
                          <div
                            key={`${crossCity ? (highlighted ? crossCityLabel : label + " · " + crossCityLabel) : label}-${segment.tripId}`}
                            className="relative w-full overflow-hidden rounded-[1.15rem] border-2 px-4 py-3"
                            style={{ borderColor: segmentColor, backgroundColor: `${segmentColor}26` }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: segmentColor }}>
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: segmentColor }} />
                                  {crossCity ? (highlighted ? crossCityLabel : label + " · " + crossCityLabel) : label}
                                </p>
                                <p className="mt-1 text-lg font-bold" style={{ color: segmentColor }}>{serviceTitle}</p>
                                <p className="mt-0.5 text-sm font-semibold text-white/85">
                                  {secondaryLine}
                                </p>
                                {componentList}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <button
                          type="button"
                          key={`${crossCity ? (highlighted ? crossCityLabel : label + " · " + crossCityLabel) : label}-${segment.tripId}`}
                          onClick={() => {
                            const segmentPosition = findStationCoordinate(segment.origin || "") ?? [selectedDetail.vehicle.lat, selectedDetail.vehicle.lng];
                            setServiceTripToFit(segment.tripId);
                            setSelectedDetail({
                              type: "vehicle",
                              vehicle: {
                                ...selectedDetail.vehicle,
                                tdn: segment.tdn,
                                tripId: segment.tripId,
                                lat: segmentPosition[0],
                                lng: segmentPosition[1],
                                line: segmentLine,
                                destination: segment.destination?.replace(/\s+Station$/i, "") || selectedDetail.vehicle.destination,
                                direction: segment.direction === "UP" ? "up" : "down",
                                serviceDescription: `${segmentLine} service to ${segment.destination?.replace(/\s+Station$/i, "") || "destination"}`,
                              },
                            });
                          }}
                          className="relative w-full overflow-hidden rounded-[1.15rem] border px-4 py-3 text-left transition hover:brightness-110 active:scale-[0.99]"
                          style={{ borderColor: `${segmentColor}45`, backgroundColor: `${segmentColor}14` }}
                        >
                          <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: segmentColor }} />
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: segmentColor }}>
                                {crossCity ? (highlighted ? crossCityLabel : label + " · " + crossCityLabel) : label}
                              </p>
                              <p className="mt-1 text-lg font-bold" style={{ color: segmentColor }}>{serviceTitle}</p>
                              <p className="mt-0.5 text-sm font-semibold text-white/75">
                                {time} · {throughRoute}
                              </p>
                                {componentList}
                            </div>
                            <span className="grid h-9 w-9 place-items-center rounded-full border text-xl" style={{ borderColor: `${segmentColor}45`, color: segmentColor }}>→</span>
                          </div>
                        </button>
                      );
                    });
                  })()}
                  <p className="text-[10px] leading-4 text-white/40">
                    Through-service links use official GTFS blocks. Scheduled connections match terminal, platform and turnaround time; vehicle continuity is not confirmed.
                  </p>
                </div>
              ) : null}

              <p className="border-t border-white/10 px-3.5 py-2.5 text-[10px] leading-4 text-white/40">
                {selectedTrainTrip?.source
                  || (isNswTrainLinkLiveTrain(selectedDetail.vehicle)
                    // fetchTrainTrip only ever queries PTV's Victorian timetable API, so
                    // this "checking" state would never resolve for a NSW TrainLink trip —
                    // say what's actually backing the times shown above instead.
                    ? "Transport for NSW GTFS schedule."
                    : selectedDetail.vehicle.tripId
                      ? "Checking the verified Transport Victoria timetable."
                      : "This vehicle feed did not publish a trip ID, so exact times and platforms cannot be matched safely.")}
              </p>
            </div>
          )}

          {selectedRegionalProfile && (
            <div
              className="mt-3 rounded-[1.35rem] border p-3.5"
              style={{
                borderColor: "rgba(124,58,237,0.28)",
                background: "rgba(30,22,59,0.92)",
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200/70">
                    Journey
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">{selectedVehicleJourneyLabel || "Live"}</p>
                  {selectedRegionalRestrictionSummary ? (
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                      {selectedRegionalRestrictionSummary}
                    </p>
                  ) : null}
                </div>
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white"
                  style={{ background: "rgba(124,58,237,0.25)", border: "1px solid rgba(196,181,253,0.22)" }}
                >
                  {selectedRegionalProfile.serviceType}
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {selectedRegionalProfile.stops.map((stop, index) => (
                  <div
                    key={`${stop.time}-${stop.name}`}
                    className="grid grid-cols-[56px_minmax(0,1fr)_38px] items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.025] px-3 py-2.5"
                  >
                    <p className="text-sm font-semibold text-white">{stop.time}</p>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight text-white">{stop.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
                        {stop.platform && <span>{`Pl ${stop.platform}`}</span>}
                        {stop.side && <span>{stop.side}</span>}
                        {stop.note && <span>{stop.note}</span>}
                        {!stop.platform && !stop.side && !stop.note && index !== 0 && index !== selectedRegionalProfile.stops.length - 1 && (
                          <span>Regional</span>
                        )}
                      </div>
                    </div>
                    <p className="text-right text-sm font-semibold text-violet-200">
                      {getRegionalStopDelayLabel(stop.delayMinutes)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedDetail?.type === "tram" && (
        <div onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-0 z-[1003] h-[72dvh] w-full touch-pan-y overscroll-contain overflow-y-auto rounded-t-[1.6rem] border border-emerald-300/15 bg-slate-950/96 p-3.5 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl md:inset-x-auto md:bottom-6 md:right-4 md:top-24 md:h-auto md:max-h-[calc(100%-7rem)] md:w-[24rem] md:rounded-[1.6rem]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-300/80">Live tram</p>
              <h2 className="mt-1.5 text-xl font-semibold text-white">
                {selectedDetail.tram.route === "Tram" ? "Yarra Trams service" : `Route ${selectedDetail.tram.route}`}
              </h2>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Route direction</p>
              <p className="mt-0.5 text-sm text-white/60">
                {selectedTramDestination ? `To ${selectedTramDestination}` : "Direction not published"}
              </p>
            </div>
            <button type="button" onClick={() => setSelectedDetail(null)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70">Close</button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
              <p className="uppercase tracking-[0.16em] text-white/40">Type</p>
              <p className="mt-1 font-semibold text-white">{getTramClassLabel(selectedDetail.tram)}</p>
              {selectedDetail.tram.fleetNumber && (
                <p className="mt-0.5 text-[11px] text-white/50">Tram {selectedDetail.tram.fleetNumber}</p>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
              <p className="uppercase tracking-[0.16em] text-white/40">Operator</p>
              <p className="mt-1 font-semibold text-white">{selectedDetail.tram.operator ?? "Yarra Trams"}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
              <p className="uppercase tracking-[0.16em] text-white/40">Position</p>
              <p className="mt-1 font-semibold text-emerald-100">
                {selectedDetail.tram.timestamp ? formatRelativeTime(selectedDetail.tram.timestamp) : "Live"}
              </p>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.03]">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-3 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-200/80">Stopping pattern</p>
                <p className="mt-1 text-xs text-white/55">
                  {selectedTramTrip
                    ? "Official scheduled stops and live trip updates."
                    : isTramTripLoading
                      ? "Loading the official tram schedule…"
                      : "Approximate route order from the published tram stop pattern."}
                </p>
              </div>
              <span className="rounded-full border border-emerald-300/15 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-100">
                {selectedTramStops.length ? `${selectedTramStops.length} stops` : "Route only"}
              </span>
            </div>

            {selectedTramStops.length ? (
              <div className="max-h-[23rem] overflow-y-auto px-3 py-2">
                <StopProgressSummary
                  accent="#00ab8e"
                  progress={getStopProgress(selectedTramStops.map((stop) => stop.name), selectedTramLiveTimelinePosition)}
                />
                <button type="button" disabled={selectedTramCurrentStopIndex <= 1} onClick={() => setShowPriorStops((value) => !value)} className="my-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45">
                  {showPriorStops ? "Hide prior stops" : selectedTramCurrentStopIndex > 1 ? `Show ${selectedTramCurrentStopIndex - 1} prior stops` : "No hidden prior stops"}
                </button>
                {selectedTramVisibleStops.map(({ stop, index }, visibleIndex) => {
                  const hasVerifiedTrip = Boolean(selectedTramTrip?.stops.length);
                  const isCurrent = !hasVerifiedTrip && index === selectedTramCurrentStopIndex;
                  const isPassed = hasVerifiedTrip
                    ? stop.status === "passed"
                    : selectedTramCurrentStopIndex >= 0 && index < selectedTramCurrentStopIndex;
                  const isLast = visibleIndex === selectedTramVisibleStops.length - 1;
                  const stopState = isPassed
                    ? "Passed"
                    : hasVerifiedTrip && index === selectedTramCurrentStopIndex
                      ? "Next stop"
                    : index === selectedTramCurrentStopIndex - 1
                    ? "Last stop"
                    : isCurrent
                      ? "Live position"
                      : index === selectedTramCurrentStopIndex + 1
                        ? "Next stop"
                        : "Upcoming";
                  const showLivePositionBefore = selectedTramLiveTimelinePosition?.beforeIndex === index;
                  return (
                    <Fragment key={`${selectedDetail.tram.id}-${stop.name}-${index}`}>
                    {showLivePositionBefore && selectedTramLiveTimelinePosition && (
                      <div className="grid grid-cols-[3.5rem_1.1rem_minmax(0,1fr)] gap-2">
                        <div className="py-2 text-right text-[9px] font-bold uppercase text-emerald-200">Live</div>
                        <div className="relative flex justify-center"><div className="absolute inset-y-0 w-1 bg-emerald-400/65" /><div className="relative z-10 my-2 h-4 w-4 animate-pulse rounded-full border-2 border-white bg-emerald-500 ring-4 ring-emerald-400/20" /></div>
                        <div className="my-1 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-2 text-xs text-emerald-50"><strong>Tram is here</strong><span className="mt-0.5 block text-[10px] text-white/55">{formatLiveSegmentLabel(selectedTramLiveTimelinePosition)}</span></div>
                      </div>
                    )}
                    <div className={`grid grid-cols-[3.5rem_1.1rem_minmax(0,1fr)] gap-2 ${isPassed ? "opacity-45" : ""}`}>
                      <div className="py-3 text-right">
                        <p className="text-xs font-semibold text-white/80">
                          {stop.expectedAt
                            ? new Date(stop.expectedAt).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })
                            : isCurrent ? "Now" : "Time TBC"}
                        </p>
                        <p className="mt-0.5 text-[9px] font-semibold uppercase text-white/45">{stopState}</p>
                      </div>
                      <div className="relative flex justify-center">
                        {!isLast && <div className="absolute inset-y-0 w-1 bg-emerald-400/65" />}
                        <div className={`relative z-10 mt-3.5 rounded-full border-2 border-emerald-300 ${isCurrent ? "h-5 w-5 bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.12)]" : "h-2.5 w-2.5 bg-slate-950"}`} />
                      </div>
                      <div className={`py-3 ${isCurrent ? "rounded-xl bg-white/[0.055] px-2.5" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{stop.name}</p>
                            <p className="mt-0.5 text-xs text-white/40">
                              {stop.stopCode ? `Stop ${stop.stopCode}` : stop.platform ?? "Published route stop"}
                              {stop.status === "skipped" ? " · Not stopping" : ""}
                            </p>
                          </div>
                          {isCurrent && <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[9px] font-semibold uppercase text-emerald-100">Current</span>}
                        </div>
                      </div>
                    </div>
                    </Fragment>
                  );
                })}
              </div>
            ) : (
              <p className="m-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                {isTramTripLoading
                  ? "Loading the official stop sequence…"
                  : tramTripError
                    ? "The official schedule for this live tram is temporarily unavailable."
                    : "The live feed has not supplied a matching scheduled trip for this tram yet."}
              </p>
            )}
            {selectedTramTrip?.source && (
              <p className="border-t border-white/10 px-3 py-2 text-[10px] leading-4 text-white/40">{selectedTramTrip.source}</p>
            )}

            {selectedTramTrip?.formationSegments?.length ? (
              <div className="mt-3 grid gap-2 px-3 pb-3">
                {selectedTramTrip.formationSegments.map((segment, index) => {
                  const linkedTram = visibleLiveTrams.find((tram) => tram.tripId === segment.tripId);
                  const isPrevious = index === 0 && segment.arrivesAt && selectedTramTrip.stops[0]?.expectedAt
                    ? Date.parse(segment.arrivesAt) <= Date.parse(selectedTramTrip.stops[0].expectedAt)
                    : false;
                  const label = isPrevious ? "Previous service" : "Next service";
                  const time = (isPrevious ? segment.arrivesAt : segment.departsAt)
                    ? new Date((isPrevious ? segment.arrivesAt : segment.departsAt)!).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })
                    : "Time TBC";
                  return (
                    <button
                      type="button"
                      key={`${label}-${segment.tripId}`}
                      onClick={() => setSelectedDetail({
                        type: "tram",
                        tram: linkedTram ?? {
                          ...selectedDetail.tram,
                          id: segment.tripId,
                          tripId: segment.tripId,
                          route: segment.route || selectedDetail.tram.route,
                          destination: segment.destination || selectedDetail.tram.destination,
                        },
                      })}
                      className="relative overflow-hidden rounded-[1.15rem] border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-left transition hover:bg-emerald-400/15 active:scale-[0.99]"
                    >
                      <span className="absolute inset-y-0 left-0 w-1 bg-emerald-400" />
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">{label}</span>
                      <span className="mt-1 block text-base font-bold text-emerald-200">Route {segment.route || selectedDetail.tram.route}</span>
                      <span className="mt-0.5 block text-sm font-semibold text-white/70">{time} {isPrevious ? "from" : "to"} {isPrevious ? segment.origin : segment.destination || "destination"}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {selectedDetail?.type === "bus" && (
        <div onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-0 z-[1003] h-[72dvh] w-full touch-pan-y overscroll-contain overflow-y-auto rounded-t-[1.6rem] border border-orange-300/15 bg-slate-950/96 p-3.5 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl md:inset-x-auto md:bottom-6 md:right-4 md:top-24 md:h-auto md:max-h-[calc(100%-7rem)] md:w-[24rem] md:rounded-[1.6rem]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-orange-300/80">Operated by {selectedDetail.bus.operator ?? "Operator not published"}</p>
              <h2 className="mt-1.5 text-xl font-semibold text-white">
                {selectedDetail.bus.route === "Bus" ? "PTV bus" : `Route ${selectedDetail.bus.route}`}
              </h2>
              <p className="mt-1 text-sm text-white/60">
                {(() => {
                  // Real data gap: this trip's own payload sometimes leaves
                  // the top-level destination field blank even though its
                  // real stopping pattern is fully populated — the trip's
                  // own real last stop IS the real destination, just not
                  // labelled as one, so use it before falling back to
                  // "not published".
                  const destination = selectedBusTrip?.destination
                    || selectedDetail.bus.destination
                    || selectedBusTrip?.stops?.at(-1)?.name;
                  return destination
                    ? `To ${destination}`
                    : isBusTripLoading
                      ? "Checking this trip's destination…"
                      : "Destination not published";
                })()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDetail(null)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70"
            >
              Close
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <span className="text-white/40">Vehicle heading </span><span className="font-semibold text-white">{getCompassDirection(selectedDetail.bus.heading)}</span>
            </div>
            {selectedDetail.bus.fleetNumber && (
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <span className="text-white/40">Bus number </span><span className="font-semibold text-white">{selectedDetail.bus.fleetNumber}</span>
              </div>
            )}
            {selectedDetail.bus.registration && (
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <span className="text-white/40">Registration </span><span className="font-semibold text-white">{selectedDetail.bus.registration}</span>
              </div>
            )}
          </div>

          {(() => {
            // Real fleet identity (chassis/body/powertrain) from the static
            // Australian Bus Fleet Lists database — see src/lib/bus-fleet.ts.
            // Only ever shown when the live bus actually matches a known
            // record; an unmatched bus (operator not yet covered, or no
            // registration to match on) shows nothing here rather than a
            // guessed powertrain.
            const fleetInfo = lookupBusFleetInfo(selectedDetail.bus);
            if (!fleetInfo) return null;
            const badge = getBusPowertrainBadge(fleetInfo.powertrain);
            return (
              <div className="mt-3 rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-orange-200/80">Fleet identity</p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {fleetInfo.chassisManufacturer} {fleetInfo.chassisModel}
                      {fleetInfo.bodyModel ? ` / ${fleetInfo.bodyManufacturer} ${fleetInfo.bodyModel}` : ` / ${fleetInfo.bodyManufacturer}`}
                    </p>
                  </div>
                  {badge && (
                    <span className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white">
                      {badge.emoji} {badge.label}
                    </span>
                  )}
                </div>
                {fleetInfo.depot && (
                  <p className="mt-2 text-xs text-white/50">Depot: {fleetInfo.depot}</p>
                )}
              </div>
            );
          })()}

          <div className="mt-3 rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-200/80">Upcoming stops</p>
                <p className="mt-1 text-xs text-white/55">Official PTV trip updates for this run.</p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/60">
                {isBusTripLoading ? "Loading" : `${selectedBusTrip?.stops.length ?? 0} stops`}
              </span>
            </div>

            {isBusTripLoading ? (
              <p className="mt-3 text-sm text-white/60">Checking the current dated trip update...</p>
            ) : busTripError ? (
              <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                {busTripError instanceof Error ? busTripError.message : "Bus stops are unavailable right now."}
              </p>
            ) : selectedBusTrip?.stops.length ? (
              <div className="mt-3">
                <StopProgressSummary
                  accent="#f97316"
                  progress={getStopProgress(selectedBusTrip.stops.map((stop) => stop.name), selectedBusLiveTimelinePosition)}
                />
                <button type="button" disabled={selectedBusCurrentStopIndex <= 1} onClick={() => setShowPriorStops((value) => !value)} className="mb-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45">
                  {showPriorStops ? "Hide prior stops" : selectedBusCurrentStopIndex > 1 ? `Show ${selectedBusCurrentStopIndex - 1} prior stops` : "No hidden prior stops"}
                </button>
                <div className="border-l-[3px] border-orange-400/75 pl-4">
                {selectedBusVisibleStops.map(({ stop, index }) => {
                  const showLivePositionBefore = selectedBusLiveTimelinePosition?.beforeIndex === index;
                  return (
                  <Fragment key={`${selectedBusTrip.tripId}-${stop.stopSequence}-${stop.stopId}`}>
                  {showLivePositionBefore && selectedBusLiveTimelinePosition && (
                    <div className="relative grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 pb-3">
                      <span className="absolute -left-[1.45rem] top-2 h-4 w-4 animate-pulse rounded-full border-2 border-white bg-orange-400 ring-4 ring-orange-400/25" />
                      <div className="pt-2 text-right text-[9px] font-bold uppercase text-orange-200">Live</div>
                      <div className="rounded-xl border border-orange-300/20 bg-orange-400/10 px-2.5 py-2 text-xs text-orange-50"><strong>Bus is here</strong><span className="mt-0.5 block text-[10px] text-white/55">{formatLiveSegmentLabel(selectedBusLiveTimelinePosition)}</span></div>
                    </div>
                  )}
                  <div
                    className={`relative grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0 ${index < selectedBusCurrentStopIndex ? "opacity-45" : ""}`}
                  >
                    <span className={`absolute -left-[1.32rem] top-1 h-3 w-3 rounded-full border-2 border-slate-950 ${index === selectedBusCurrentStopIndex ? "scale-125 bg-white ring-4 ring-orange-400/25" : "bg-orange-400"}`} />
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">
                        {stop.expectedAt
                          ? new Date(stop.expectedAt).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })
                          : "Time TBC"}
                      </p>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/35">{index === selectedBusCurrentStopIndex - 1 ? "Last stop" : index === selectedBusCurrentStopIndex ? "Live position" : index === selectedBusCurrentStopIndex + 1 ? "Next stop" : stop.status}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{stop.name}</p>
                      <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-white/40">
                        {stop.stopCode ? `Stop ${stop.stopCode}` : `PTV stop ${stop.stopId}`}
                        {stop.status === "skipped" ? " · Skipped" : ""}
                      </p>
                    </div>
                  </div>
                  </Fragment>
                );})}
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                PTV has not published a stop sequence for this live run yet.
              </p>
            )}

            <p className="mt-3 text-[10px] leading-4 text-white/40">
              {selectedBusTrip?.realtimeFeedAt
                ? `Realtime feed ${formatRelativeTime(selectedBusTrip.realtimeFeedAt)}. `
                : ""}
              {selectedBusTrip?.source ?? "Transport Victoria GTFS-Realtime"}
            </p>
          </div>

          {selectedBusTrip?.formationSegments?.length ? (
            <div className="mt-3 grid gap-2">
              {selectedBusTrip.formationSegments.map((segment, index) => {
                const linkedBus = visibleLiveBuses.find((bus) => bus.tripId === segment.tripId);
                const isPrevious = index === 0 && segment.arrivesAt && selectedBusTrip.stops[0]?.expectedAt
                  ? Date.parse(segment.arrivesAt) <= Date.parse(selectedBusTrip.stops[0].expectedAt)
                  : false;
                const label = isPrevious ? "Previous service" : "Next service";
                const time = (isPrevious ? segment.arrivesAt : segment.departsAt)
                  ? new Date((isPrevious ? segment.arrivesAt : segment.departsAt)!).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })
                  : "Time TBC";
                return (
                  <button
                    type="button"
                    key={`${label}-${segment.tripId}`}
                    onClick={() => setSelectedDetail({
                      type: "bus",
                      bus: linkedBus ?? {
                        ...selectedDetail.bus,
                        id: segment.tripId,
                        tripId: segment.tripId,
                        route: segment.route || selectedDetail.bus.route,
                        destination: segment.destination || selectedDetail.bus.destination,
                      },
                    })}
                    className="relative overflow-hidden rounded-[1.15rem] border border-orange-300/25 bg-orange-400/10 px-4 py-3 text-left transition hover:bg-orange-400/15 active:scale-[0.99]"
                  >
                    <span className="absolute inset-y-0 left-0 w-1 bg-orange-400" />
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-300">{label}</span>
                    <span className="mt-1 block text-base font-bold text-orange-200">Route {segment.route || selectedDetail.bus.route}</span>
                    <span className="mt-0.5 block text-sm font-semibold text-white/70">{time} {isPrevious ? "from" : "to"} {isPrevious ? segment.origin : segment.destination || "destination"}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {selectedDetail && (selectedDetail.type === "station" || selectedDetail.type === "surfaceStop" || selectedDetail.type === "report") && (
        <div onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()} className={`absolute inset-x-3 bottom-32 z-[1001] mx-auto w-full max-w-[95vw] touch-pan-y overscroll-contain overflow-y-auto rounded-[1.5rem] border border-white/10 bg-slate-950/90 p-3 shadow-2xl backdrop-blur-2xl sm:bottom-24 sm:p-3.5 lg:max-w-[760px] ${selectedDetail.type === "surfaceStop" ? (isSurfaceStopPanelCollapsed ? "max-h-24" : "max-h-[42vh]") : "max-h-[52vh]"}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300/75">
                {selectedDetail.type === "station"
                  ? "Station"
                  : selectedDetail.type === "surfaceStop"
                    ? "Stop"
                    : "Service report"}
              </p>
              <p className="mt-2 text-lg font-semibold text-white">
                {selectedDetail.type === "station"
                  ? selectedDetail.station.name
                  : selectedDetail.type === "surfaceStop"
                    // Our own generated bus-stop dataset's name is a bare
                    // numeric stop code for many minor stops (e.g. "3688") —
                    // the live PTV lookup usually has the real street-based
                    // name ("Princes Hwy/Webb St") once it's back, so prefer
                    // that the moment it loads rather than the stop code.
                    ? (selectedSurfaceStopDepartures?.stopName || selectedDetail.stop.name)
                    : selectedDetail.report.locationName}
              </p>
              {selectedDetail.type === "station" && (
                <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-blue-300/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-100/85">
                  {getStationTypeBadge(selectedDetail.station)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {selectedDetail.type === "surfaceStop" && (
                <button type="button" onClick={() => setIsSurfaceStopPanelCollapsed((value) => !value)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70">
                  {isSurfaceStopPanelCollapsed ? "Expand" : "Collapse"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedDetail(null)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70"
              >
                Close
              </button>
            </div>
          </div>

          {selectedDetail.type === "station" && (
            <div className="mt-3 space-y-3 text-sm text-white/70">
              {getStationDetails(selectedDetail.station) && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">{getStationDetails(selectedDetail.station)}</div>
              )}
              {renderStationBoardingGuide(selectedDetail.station.name)}

              {selectedStationService && (
                <div className="rounded-[1.35rem] border border-blue-300/25 bg-blue-500/[0.08] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-200/80">Selected service</p>
                      <p className="mt-1 text-base font-semibold text-white">
                        {selectedStationService.route} to {selectedStationService.destination}
                      </p>
                    </div>
                    <button type="button" onClick={() => setSelectedStationService(null)} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/65">Back</button>
                  </div>
                  {isTrainTripLoading ? (
                    <p className="mt-3 text-sm text-white/60">Loading the complete stopping pattern...</p>
                  ) : trainTripError ? (
                    <p className="mt-3 text-sm text-amber-100">The trip details could not be loaded right now.</p>
                  ) : selectedTrainTrip?.stops.length ? (
                    <div className="mt-3 max-h-[46dvh] space-y-0 overflow-y-auto border-l-2 border-blue-300/60 pl-4">
                      {selectedTrainTrip.stops.map((stop) => (
                        <div key={`${stop.stopId}-${stop.stopSequence}`} className="relative pb-4 last:pb-0">
                          <span className={`absolute -left-[1.28rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-slate-950 ${stop.status === "passed" ? "bg-white/35" : "bg-blue-300"}`} />
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-white">{stop.name}</p>
                              <p className="text-xs text-white/45">{getPlatformLabel(stop)}</p>
                              {stop.pickupType === "none" && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-white/70">
                                  <Ban className="h-2.5 w-2.5" /> Drop off only
                                </span>
                              )}
                              {stop.dropOffType === "none" && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-white/70">
                                  <Ban className="h-2.5 w-2.5" /> Pick up only
                                </span>
                              )}
                            </div>
                            <div className="shrink-0 text-right text-xs text-white/65">
                              <p>{new Date(stop.expectedDepartureAt).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })}</p>
                              <p className={stop.delaySeconds >= 600 ? "text-red-200" : stop.delaySeconds > 0 ? "text-amber-200" : "text-emerald-200"}>{stop.delaySeconds > 0 ? `${Math.round(stop.delaySeconds / 60)} min late` : "On time"}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              {(() => {
                const departures = selectedStationDepartures?.departures ?? [];
                const platformGroupMap = new globalThis.Map<string, VerifiedDeparture[]>();
                for (const departure of departures) {
                  if (!departure.platform) continue;
                  if (!platformGroupMap.has(departure.platform)) platformGroupMap.set(departure.platform, []);
                  platformGroupMap.get(departure.platform)!.push(departure);
                }
                const platformGroups = Array.from(platformGroupMap.entries()).sort(
                  ([a], [b]) => Number(a) - Number(b) || a.localeCompare(b),
                );
                const ungroupedDepartures = departures.filter((d) => !d.platform);
                // Real multi-platform interchanges only — a station with one
                // (or no) distinct real platform value across its departures
                // keeps the plain flat list, unchanged, below.
                const isMultiPlatformInterchange = platformGroups.length >= 2;

                const buildServiceVehicle = (departure: VerifiedDeparture): LiveTrain => {
                  const liveService = liveVehicles.find((vehicle) => vehicle.tripId === departure.tripId);
                  return liveService ?? {
                    tdn: departure.tripId.match(/-([A-Z]?\d+)$/i)?.[1] || departure.tripId,
                    tripId: departure.tripId,
                    lat: selectedDetail.station.position[0],
                    lng: selectedDetail.station.position[1],
                    line: departure.route,
                    destination: departure.destination.replace(/\s+via\s+.+$/i, ""),
                    status: (departure.delaySeconds ?? 0) > 60 ? "delayed" : (departure.delaySeconds ?? 0) < -60 ? "early" : "on_time",
                    timestamp: departure.expectedAt,
                    direction: "outbound",
                    trainType: isVlineLiveTrain({
                      line: departure.route,
                      destination: departure.destination,
                      serviceDescription: `${departure.route} service to ${departure.destination}`,
                      trainType: "",
                      tripId: departure.tripId,
                    })
                      ? "V/Line Train"
                      : "Metro Train",
                    consist: "Set not published",
                    serviceDescription: `${departure.route} service to ${departure.destination}`,
                  };
                };
                const openDeparture = (departure: VerifiedDeparture) => {
                  const serviceVehicle = buildServiceVehicle(departure);
                  setSelectedStationService(null);
                  setServiceTripToFit(departure.tripId);
                  setSelectedDetail({ type: "vehicle", vehicle: serviceVehicle });
                  safeFlyTo(mapRef.current, serviceVehicle.lat, serviceVehicle.lng, Math.max(mapZoom, 14.5), { animate: true, duration: 0.8 });
                };

                const renderCompactRow = (departure: VerifiedDeparture) => {
                  const expected = new Date(departure.expectedAt);
                  const delayMinutes = Math.round((departure.delaySeconds ?? 0) / 60);
                  const lineAccent = getLiveLineColor(departure.route);
                  return (
                    <button
                      type="button"
                      key={`${departure.tripId}-${departure.platform ?? "na"}`}
                      onClick={() => openDeparture(departure)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/10 px-3 py-2 text-left transition hover:bg-white/5 active:scale-[0.99]"
                    >
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: lineAccent }}>
                          {departure.route}
                          {departure.platform ? ` · Platform ${departure.platform}` : ""}
                        </p>
                        <p className="truncate text-sm font-semibold text-white">{departure.destination}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-white">
                          {expected.toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })}
                        </p>
                        <p className={`text-[10px] font-semibold ${departure.status === "cancelled" || departure.status === "skipped" || delayMinutes >= 10 ? "text-red-200" : delayMinutes > 0 ? "text-amber-200" : "text-emerald-200"}`}>
                          {departure.status === "cancelled"
                            ? "Cancelled"
                            : departure.status === "skipped"
                              ? "Not stopping"
                              : departure.status === "live"
                                ? delayMinutes > 0
                                  ? `${delayMinutes} min late`
                                  : delayMinutes < 0
                                    ? `${Math.abs(delayMinutes)} min early`
                                    : "On time"
                                : "On time"}
                        </p>
                      </div>
                    </button>
                  );
                };

                const vlineCheck = (d: VerifiedDeparture) =>
                  isVlineLiveTrain({ line: d.route, destination: d.destination, serviceDescription: "", trainType: "", tripId: d.tripId });
                const hasVline = departures.some(vlineCheck);
                const hasMetro = departures.some((d) => !vlineCheck(d));

                // Some stations' real platform assignments need hand-written
                // labels rather than the raw joined destination text — e.g.
                // Caulfield's Platform 1 is the Frankston line City Loop
                // direction and Platform 3 carries both Metro Tunnel trains
                // and V/Line services that pass through without picking up
                // Caulfield passengers (V/Line doesn't sell local Metro-area
                // trips here); Gardenvale's Platform 1 carries both
                // Williamstown- and Werribee-bound Sandringham line services
                // heading citybound via Flinders Street.
                const STATION_PLATFORM_LABELS: Record<string, Record<string, string>> = {
                  Caulfield: {
                    "1": "Flinders Street bound via loop",
                    "3": "Sunbury & Watergardens services via the Metro Tunnel · V/Line to Southern Cross — drop-off only at Caulfield",
                  },
                  // Every one of these is a plain single-purpose Sandringham
                  // line station (unlike South Yarra/Richmond/Flinders
                  // Street, which are shared with other lines on the same
                  // platform) — the real through-service pattern is
                  // identical at each one, so the same wording applies.
                  Prahran: { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  Windsor: { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  Balaclava: { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  Ripponlea: { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  Elsternwick: { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  Gardenvale: { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  "North Brighton": { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  "Middle Brighton": { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  "Brighton Beach": { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  Hampton: { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                  Sandringham: { "1": "All stations to Flinders Street · Then continues to Werribee, Williamstown or Altona" },
                };
                const getPlatformGroupLabel = (platform: string, uniqueDestinations: string[]) =>
                  STATION_PLATFORM_LABELS[selectedDetail.station.name]?.[platform] ||
                  `To ${uniqueDestinations.join(", ")}`;

                // Metro Tunnel stations have a real, fixed, simple two-platform
                // layout (Platform 1 = Sunbury-bound, Platform 2 =
                // Cranbourne/Pakenham-bound, straight from GTFS platform_code)
                // — shown as a side-by-side diagram instead of the vertical
                // collapsible groups used for bigger multi-platform interchanges.
                const isMetroTunnelStation = METRO_TUNNEL_STATIONS.some((s) => s.name === selectedDetail.station.name);
                const platform1Departures = departures.filter((d) => d.platform === "1");
                const platform2Departures = departures.filter((d) => d.platform === "2");
                const platformlessAtTunnelStation = departures.filter((d) => d.platform !== "1" && d.platform !== "2");

                return (
                  <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-300/75">
                          Verified departures
                        </p>
                        <p className="mt-1 text-xs text-white/55">
                          Official dated GTFS schedule with GTFS-Realtime updates.
                        </p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65">
                        {isStationDeparturesLoading ? "Loading" : `${departures.length} services`}
                      </span>
                    </div>

                    {isMetroTunnelStation && (
                      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-blue-300/25 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200">
                        Metro Tunnel underground station
                      </span>
                    )}
                    {!isMetroTunnelStation && isMultiPlatformInterchange && hasVline && hasMetro && (
                      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-blue-300/25 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200">
                        Metro + V/Line interchange
                      </span>
                    )}

                    {isStationDeparturesLoading ? (
                      <p className="mt-3 text-sm text-white/60">Checking today&apos;s active service calendar...</p>
                    ) : stationDeparturesError ? (
                      <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                        {stationDeparturesError instanceof Error
                          ? stationDeparturesError.message
                          : "Verified departures are unavailable right now."}
                      </p>
                    ) : departures.length ? (
                      isMetroTunnelStation ? (
                        <div className="mt-3 space-y-3">
                          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/15 px-3 py-4">
                            <div className="flex flex-1 items-center gap-2 text-left">
                              <ArrowLeft className="h-4 w-4 shrink-0 text-blue-300" />
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-white">Platform 1</p>
                                <p className="text-[10px] text-white/50">to the west</p>
                              </div>
                            </div>
                            <div className="h-px flex-1 bg-white/15" />
                            <div className="flex flex-1 items-center justify-end gap-2 text-right">
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-white">Platform 2</p>
                                <p className="text-[10px] text-white/50">to the east</p>
                              </div>
                              <ArrowRight className="h-4 w-4 shrink-0 text-blue-300" />
                            </div>
                          </div>
                          <p className="text-[10px] leading-4 text-white/40">
                            Metro Tunnel stations use a fixed side-by-side platform layout (Platform 1 west, Platform 2 east).
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { platform: "1", label: "To Sunbury", departures: platform1Departures },
                              { platform: "2", label: "To Cranbourne / Pakenham", departures: platform2Departures },
                            ].map(({ platform, label, departures: platformDepartures }) => {
                              const isExpanded = collapsedPlatformGroups.has(`tunnel-${platform}`);
                              const visible = isExpanded ? platformDepartures : platformDepartures.slice(0, 3);
                              return (
                                <div key={platform} className="space-y-1.5">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                                    Platform {platform} · {label}
                                  </p>
                                  {visible.length ? (
                                    visible.map(renderCompactRow)
                                  ) : (
                                    <p className="rounded-xl border border-white/5 bg-black/10 px-3 py-2 text-xs text-white/40">
                                      No verified departures right now.
                                    </p>
                                  )}
                                  {platformDepartures.length > 3 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setCollapsedPlatformGroups((prev) => {
                                          const next = new Set(prev);
                                          const key = `tunnel-${platform}`;
                                          if (next.has(key)) next.delete(key);
                                          else next.add(key);
                                          return next;
                                        })
                                      }
                                      className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-300/80 hover:text-blue-200"
                                    >
                                      {isExpanded ? "Show fewer" : `View all Platform ${platform} departures →`}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {platformlessAtTunnelStation.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Platform not published</p>
                              {platformlessAtTunnelStation.map(renderCompactRow)}
                            </div>
                          )}
                        </div>
                      ) : isMultiPlatformInterchange ? (
                        <div className="mt-3 space-y-3">
                          {platformGroups.map(([platform, group]) => {
                            const isCollapsed = collapsedPlatformGroups.has(platform);
                            const uniqueDestinations = Array.from(new Set(group.map((d) => d.destination)));
                            const accent = getLiveLineColor(group[0].route);
                            return (
                              <div key={platform} className="overflow-hidden rounded-2xl border" style={{ borderColor: `${accent}40` }}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCollapsedPlatformGroups((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(platform)) next.delete(platform);
                                      else next.add(platform);
                                      return next;
                                    })
                                  }
                                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                                  style={{ backgroundColor: `${accent}14` }}
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold" style={{ color: accent }}>Platform {platform}</p>
                                    <p
                                      className={`mt-0.5 text-xs text-white/60 ${
                                        STATION_PLATFORM_LABELS[selectedDetail.station.name]?.[platform] ? "" : "truncate"
                                      }`}
                                    >
                                      {getPlatformGroupLabel(platform, uniqueDestinations)}
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <span
                                      className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                                      style={{ borderColor: `${accent}45`, color: accent }}
                                    >
                                      {group.length} {group.length === 1 ? "departure" : "departures"}
                                    </span>
                                    <span className="text-xs" style={{ color: accent }}>{isCollapsed ? "▾" : "▴"}</span>
                                  </div>
                                </button>
                                {!isCollapsed && <div className="space-y-1.5 p-2">{group.map(renderCompactRow)}</div>}
                              </div>
                            );
                          })}
                          {ungroupedDepartures.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Platform not published</p>
                              {ungroupedDepartures.map(renderCompactRow)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {departures.map((departure) => {
                            const expected = new Date(departure.expectedAt);
                            const scheduled = new Date(departure.scheduledAt);
                            const delayMinutes = Math.round((departure.delaySeconds ?? 0) / 60);
                            const lineAccent = getLiveLineColor(departure.route);
                            return (
                              <button
                                type="button"
                                key={`${departure.tripId}-${departure.platform ?? "na"}`}
                                style={{ borderColor: `${lineAccent}45`, backgroundColor: `${lineAccent}14` }}
                                onClick={() => openDeparture(departure)}
                                className="w-full rounded-2xl border border-white/10 bg-black/15 p-3 text-left transition hover:border-blue-300/35 hover:bg-blue-500/10 active:scale-[0.99]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: lineAccent }}>
                                      {departure.route}
                                      {departure.platform ? ` · Platform ${departure.platform}` : ""}
                                    </p>
                                    <p className="mt-1 truncate text-base font-semibold text-white">{departure.destination}</p>
                                  </div>
                                  <p className="shrink-0 text-lg font-semibold text-white">
                                    {expected.toLocaleTimeString("en-AU", {
                                      timeZone: "Australia/Melbourne",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </p>
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                                  <span className="text-white/45">
                                    Scheduled{" "}
                                    {scheduled.toLocaleTimeString("en-AU", {
                                      timeZone: "Australia/Melbourne",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                  <span className={departure.status === "cancelled" || departure.status === "skipped" || delayMinutes >= 10 ? "font-semibold text-red-200" : delayMinutes > 0 ? "font-semibold text-amber-200" : "font-semibold text-emerald-200"}>
                                    {departure.status === "cancelled"
                                      ? "Cancelled"
                                      : departure.status === "skipped"
                                        ? "Not stopping"
                                        : departure.status === "live"
                                          ? delayMinutes > 0
                                            ? `${delayMinutes} min late`
                                            : delayMinutes < 0
                                              ? `${Math.abs(delayMinutes)} min early`
                                              : "Live · On time"
                                          : "Scheduled"}
                                  </span>
                                </div>
                                <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: `${lineAccent}b3` }}>View trip and live location →</p>
                              </button>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                        No verified departures were returned in the next three hours.
                      </p>
                    )}

                {/* Freight/heritage/empty-car pass-throughs — a fully separate,
                    non-GTFS list. Rendered as its own block after the real
                    departure grid so it can never affect that grid's
                    ordering/next-service logic, with a loud "DOES NOT STOP"
                    warning since these are not boardable. */}
                {(selectedStationDepartures?.nonPassengerPassThroughs?.length ?? 0) > 0 && (() => {
                  const passThroughs = selectedStationDepartures!.nonPassengerPassThroughs!;
                  const pairs = STATION_PLATFORM_PAIRS[selectedStationDepartures!.stationName];
                  const renderCard = (passThrough: NonPassengerPassThrough) => (
                    <div
                      key={`${passThrough.trainNumber}-${passThrough.expectedPassTime}`}
                      className="rounded-2xl border border-red-400/25 bg-red-500/10 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold uppercase tracking-[0.08em] text-red-200">
                          {passThrough.label}
                        </p>
                        <span className="rounded-full border border-slate-400/30 bg-slate-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-200">
                          {passThrough.trackingSource === "Estimated" ? "EST" : passThrough.trackingSource}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-white/80">
                        {passThrough.serviceType.charAt(0) + passThrough.serviceType.slice(1).toLowerCase()}
                        {" · "}
                        {passThrough.operator} {passThrough.trainNumber}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-white/55">
                        <span>
                          {passThrough.direction === "up" ? "Up" : "Down"} direction
                          {passThrough.platform ? ` · Platform ${passThrough.platform}` : ""}
                        </span>
                        <span className="font-semibold text-white/75">Expected pass {passThrough.expectedPassTime.slice(0, 5)}</span>
                      </div>
                    </div>
                  );
                  return (
                    <div className="mt-4 space-y-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
                        Passing through — not stopping
                      </p>
                      {pairs
                        ? pairs.map((pair) => {
                            const inPair = passThroughs.filter((p) => p.platform && pair.includes(p.platform));
                            if (inPair.length === 0) return null;
                            return (
                              <div key={pair.join("-")} className="space-y-2">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                                  Platforms {pair.join("–")}
                                </p>
                                {inPair.map(renderCard)}
                              </div>
                            );
                          })
                        : passThroughs.map(renderCard)}
                    </div>
                  );
                })()}

                <p className="mt-3 text-[10px] leading-4 text-white/40">
                  {selectedStationDepartures?.realtimeFeedAt
                    ? `Realtime feed ${formatRelativeTime(selectedStationDepartures.realtimeFeedAt)}. `
                    : ""}
                  {selectedStationDepartures?.scheduleUpdatedAt
                    ? `Schedule file checked ${new Date(selectedStationDepartures.scheduleUpdatedAt).toLocaleDateString("en-AU")}. `
                    : ""}
                  {selectedStationDepartures?.source ?? "Transport Victoria"}
                </p>
              </div>
                );
              })()}

              {unverifiedTransitPanelsEnabled() && selectedDetail.station.name === "Southern Cross" && (
                <div className="rounded-[1.35rem] border border-amber-300/20 bg-amber-500/[0.06] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200/85">
                    Live departures unavailable
                  </p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    A verified Southern Cross departures feed is not connected.
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-white/60">
                    TransitAlert will not generate departure times, platforms, delays, stopping patterns, or service IDs. Check the official station displays for current information.
                  </p>
                </div>
              )}

              {unverifiedTransitPanelsEnabled() && selectedDetail.station.name === "Southern Cross" && (
                <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-300/75">
                        Departure board
                      </p>
                      <p className="mt-1 text-xs text-white/55">
                        Styled like the concourse screens for a quick glance.
                      </p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                        Updated {new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                      Southern Cross
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-900/90 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                      <div className="border-b border-white/10 bg-slate-950/80 px-4 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                          Southern Cross
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <img
                            src="/images/xpt.svg"
                            alt="XPT icon"
                            className="h-8 w-8 rounded-md object-contain"
                          />
                          <p className="text-lg font-semibold text-white">Platform 1 · XPT</p>
                        </div>
                        <p className="mt-1 text-xs text-white/55">NSW TrainLink long-distance services. Check station displays for final boarding advice.</p>
                      </div>

                      <div className="divide-y divide-slate-800/90">
                        {SOUTHERN_CROSS_PLATFORM_1_SERVICES.map((service) => (
                          <div
                            key={`${service.runId}-${service.departureLabel}-${service.dayLabel}`}
                            className="bg-white px-4 py-3 text-slate-950"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="rounded-md bg-slate-950 px-2 py-1 text-xs font-bold text-white">
                                    {service.runId}
                                  </span>
                                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                    Plt 1
                                  </span>
                                </div>
                                <p className="mt-2 text-lg font-semibold leading-tight">{service.destination}</p>
                                <p className="mt-1 text-sm text-slate-700">{service.lineLabel} • {service.consist}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-slate-950">{service.departureLabel}</p>
                                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{service.dayLabel}</p>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                                {service.statusLabel}
                              </span>
                              <span className="rounded-md bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">
                                Platform 1
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                      {SOUTHERN_CROSS_DEPARTURE_BOARD.map((column) => (
                        <div
                          key={column.title}
                          className="min-w-0 overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#202020] shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
                        >
                          <div className={`h-1.5 w-full ${column.accent}`} />
                          <div className="bg-[#202020] px-5 py-4 text-white">
                            <div className="flex items-start justify-between gap-4">
                              <p className="min-w-0 flex-1 pr-2 text-[1.15rem] font-semibold leading-[1.12] text-white [overflow-wrap:anywhere]">{column.title}</p>
                              <div className="shrink-0 rounded-sm bg-white px-2 py-1 text-[1rem] font-bold leading-none text-slate-950">
                                {column.platform}
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] gap-4 border-t border-white/10 pt-3 text-left text-[8px] font-semibold uppercase tracking-[0.04em] text-white/70">
                              <div>
                                <p>Scheduled</p>
                                <p className="mt-2 text-[1.15rem] font-semibold tracking-normal text-white">{column.scheduledTime}</p>
                              </div>
                              <div>
                                <p>Departing</p>
                                <p className="mt-2 text-[1.15rem] font-semibold tracking-normal text-white">{column.departingTime}</p>
                              </div>
                              <div>
                                <p>Platform</p>
                                <p className="mt-2 text-[1.15rem] font-semibold tracking-normal text-white">{column.platform}</p>
                              </div>
                            </div>
                            <div className="mt-4 border-t border-white/10 pt-3">
                              <p className="text-[1.05rem] font-semibold text-white">{column.status}</p>
                              {column.via ? <p className="mt-1.5 text-sm text-white/70">{column.via}</p> : null}
                            </div>
                            <div className="mt-4 space-y-1.5 text-[1.05rem] leading-snug text-white/95">
                              {column.stops.map((stop) => (
                                <p key={`${column.title}-${stop}`}>{stop}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {unverifiedTransitPanelsEnabled() && selectedDetail.station.name !== "Southern Cross" && (
                (() => {
                  const isMetroTunnelConnectorStation =
                    selectedDetail.station.name === "Melbourne Central" ||
                    selectedDetail.station.name === "State Library";
                  const platformBoard = buildPlatformBoard(selectedDetail.station);
                  const freightMovements = getFreightMovements(selectedDetail.station.name);
                  const connectedStationName =
                    selectedDetail.station.name === "Melbourne Central"
                      ? "State Library"
                      : selectedDetail.station.name === "State Library"
                        ? "Melbourne Central"
                        : null;

                  return (
                    <div className={isMetroTunnelConnectorStation ? "w-[min(980px,95vw)] rounded-[1.45rem] border border-white/10 bg-white/[0.03] p-3" : ""}>
                      <div
                        className={
                          isMetroTunnelConnectorStation
                            ? "grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]"
                            : ""
                        }
                      >
                      {unverifiedTransitPanelsEnabled() && isMetroTunnelConnectorStation && (
                        <div className="min-w-[320px] max-w-[320px] rounded-[1.2rem] border border-[#279FD5]/20 bg-[#279FD5]/[0.08] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7cd9ff]">
                            Station
                          </p>
                          <p className="mt-1 text-2xl font-semibold leading-tight text-white">
                            {connectedStationName ?? selectedDetail.station.name}
                          </p>
                          <div className="mt-3 rounded-[1rem] border border-white/10 bg-black/15 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7cd9ff]">
                              Metro Tunnel interchange
                            </p>
                            <p className="mt-1 text-lg font-semibold leading-tight text-white">
                              {selectedDetail.station.name}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-white/65">
                              Platforms 1 and 2 with direct CBD interchange access.
                            </p>
                          </div>
                          <div className="mt-3">
                            {renderPlatformBoardCard(
                              selectedDetail.station.name,
                              METRO_TUNNEL_CONNECTION_BOARD,
                              100,
                              isPremium,
                              handlePlatformBoardServiceClick,
                            )}
                          </div>
                        </div>
                      )}

                      <div className={isMetroTunnelConnectorStation ? "min-w-0 rounded-[1.2rem] border border-white/10 bg-black/10 p-3" : "rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3"}>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-300/75">
                          Next services
                        </p>
                        <p className="mt-1 text-xs text-white/55">
                          A verified departures feed is not connected for {selectedDetail.station.name}.
                        </p>

                        <div className="mt-2.5 rounded-2xl border border-amber-300/20 bg-amber-500/[0.06] p-3">
                          <p className="text-sm font-semibold text-white">Live departures unavailable</p>
                          <p className="mt-1 text-xs leading-relaxed text-white/60">
                            TransitAlert does not generate times, platforms, delays, stopping patterns, or service IDs. Check official station displays for current information.
                          </p>
                        </div>

                        {unverifiedTransitPanelsEnabled() && freightMovements.length > 0 && isPremium && (
                          <div className="mt-3 rounded-[1.1rem] border border-[#8b5e34]/30 bg-[#8b5e34]/10 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#e8c9a7]">
                                  Freight movements
                                </p>
                                <p className="mt-1 max-w-[48ch] text-xs leading-relaxed text-white/55">
                                  Indicative freight paths through {selectedDetail.station.name}. These are corridor timings, not passenger departures.
                                </p>
                              </div>
                              <span className="rounded-full border border-[#8b5e34]/35 bg-black/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#f0dcc3]">
                                Through corridor
                              </span>
                            </div>

                            <div className="mt-3 grid gap-2 lg:grid-cols-2">
                              {freightMovements.map((movement) => (
                                <div
                                  key={`${selectedDetail.station.name}-${movement.serviceId}-${movement.timeLabel}`}
                                  className="rounded-[0.95rem] border border-white/10 bg-black/20 p-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-md bg-[#8b5e34]/25 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f0dcc3]">
                                          {movement.serviceId}
                                        </span>
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">
                                          {movement.operator}
                                        </span>
                                      </div>
                                      <p className="mt-2 text-sm font-semibold leading-snug text-white">
                                        {movement.movement}
                                      </p>
                                      <p className="mt-1 text-xs leading-relaxed text-white/60">{movement.lineLabel}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-base font-semibold text-white">{movement.timeLabel}</p>
                                      <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[#e8c9a7]/90">
                                        {movement.statusLabel}
                                      </p>
                                    </div>
                                  </div>
                                  {movement.note ? (
                                    <p className="mt-2 border-t border-white/10 pt-2 text-xs leading-relaxed text-white/55">{movement.note}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {unverifiedTransitPanelsEnabled() && freightMovements.length > 0 && !isPremium && (
                          <div className="mt-3 rounded-[1.1rem] border border-white/10 bg-white/[0.04] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#e8c9a7]">
                                  Premium
                                </p>
                                <p className="mt-1 text-sm font-semibold text-white">
                                  Freight tracking is part of TransitAlert Premium.
                                </p>
                                <p className="mt-1 max-w-[48ch] text-xs leading-relaxed text-white/60">
                                  Unlock corridor freight timing panels and advanced path visibility for major junction stations.
                                </p>
                              </div>
                              <span className="rounded-full border border-[#8b5e34]/35 bg-[#8b5e34]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#f0dcc3]">
                                Locked
                              </span>
                            </div>
                            {premiumPaypalLink ? (
                              <a
                                href={premiumPaypalLink}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex rounded-full border border-[#8b5e34]/35 bg-[#8b5e34]/10 px-3 py-1.5 text-[11px] font-semibold text-[#f0dcc3] transition hover:bg-[#8b5e34]/15"
                              >
                                Unlock with PayPal
                              </a>
                            ) : (
                              <p className="mt-3 text-xs text-white/50">Add a PayPal premium link in Settings to unlock this feature.</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    </div>
                  );
                })()
              )}
            </div>
          )}

          {selectedDetail.type === "report" && (
            <div className="mt-3 grid gap-2 text-sm text-white/70 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Mode {selectedDetail.report.transportType}</div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Type {selectedDetail.report.reportType}</div>
              {selectedDetail.report.lineNumber && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Route {selectedDetail.report.lineNumber}</div>
              )}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">By {selectedDetail.report.username}</div>
              {selectedDetail.report.notes && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:col-span-2">
                  {selectedDetail.report.notes}
                </div>
              )}
            </div>
          )}

          {selectedDetail.type === "surfaceStop" && !isSurfaceStopPanelCollapsed && (
            <div className="mt-3 space-y-3 text-sm text-white/70">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-sm font-semibold text-white">{selectedDetail.stop.locality}</p>
                <p className="mt-1 text-xs text-white/60">{selectedDetail.stop.subtitle}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedDetail.stop.modes.map((mode) => (
                    <span
                      key={`${selectedDetail.stop.id}-${mode}`}
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75"
                    >
                      {mode}
                    </span>
                  ))}
                  {selectedDetail.stop.routeLabel ? (
                    <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-100/85">
                      Route {selectedDetail.stop.routeLabel}
                    </span>
                  ) : (
                    <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-100/85">
                      Multi-route interchange bay
                    </span>
                  )}
                </div>
              </div>

              {(() => {
                // Bay C at the Huntingdale Station bus interchange is
                // physically only served by route 630 towards Elwood — PTV's
                // stop-location lookup resolves this bay to the same shared
                // stop as the interchange's other bays, so it otherwise
                // returns every route (601, 900, 630 both directions) that
                // stops anywhere at the interchange.
                const surfaceDepartures = selectedSurfaceStopDepartures?.departures ?? [];
                const displayDepartures = selectedDetail.stop.name === "Huntingdale Station – Bus Bay C"
                  ? surfaceDepartures.filter((departure) => departure.route === "630" && /elwood/i.test(departure.destination))
                  : surfaceDepartures;
                return (
              <div className="rounded-[1.35rem] border border-sky-300/20 bg-sky-500/[0.06] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-200/85">Official departures</p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {isSurfaceStopDeparturesLoading ? "Loading timetable…" : `${displayDepartures.length} upcoming services`}
                    </p>
                  </div>
                  {selectedSurfaceStopDepartures?.stopId && <span className="rounded-full border border-sky-300/20 bg-sky-500/10 px-2 py-1 text-[9px] font-semibold text-sky-100">PTV stop</span>}
                </div>

                {isSurfaceStopDeparturesLoading ? (
                  <p className="mt-3 text-xs text-white/60">Fetching scheduled and live departures from PTV…</p>
                ) : surfaceStopDeparturesError ? (
                  <p className="mt-3 text-xs leading-relaxed text-white/60">No scheduled departures available. Timetable information isn’t currently available for this stop.</p>
                ) : displayDepartures.length ? (
                  <div className="mt-3 divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-black/15">
                    {displayDepartures.map((departure) => {
                      const expected = new Date(departure.expectedAt);
                      const scheduled = new Date(departure.scheduledAt);
                      const isLive = departure.status === "live";
                      const hasValidExpectedTime = Number.isFinite(expected.getTime());
                      const hasValidScheduledTime = Number.isFinite(scheduled.getTime());
                      const showScheduledTime = isLive
                        && hasValidExpectedTime
                        && hasValidScheduledTime
                        && expected.getTime() !== scheduled.getTime();
                      const stopModeIsTram = selectedDetail.stop.modes.includes("tram") && !selectedDetail.stop.modes.includes("bus");
                      const stopPosition = selectedDetail.stop.position;
                      // The PTV Timetable API's own "live" flag just means PTV's backend
                      // has real-time data for this departure — it says nothing about
                      // whether OUR GTFS-realtime feed can currently show and track that
                      // physical vehicle on the map. Check that separately so riders can
                      // tell "this one you can watch move right now" from "this one is
                      // only known from the schedule so far".
                      // Matching by route + proximity alone picks whichever
                      // vehicle on this route happens to be nearest the stop
                      // right now — with two same-route vehicles both within
                      // range (one just departed, another arriving), that can
                      // grab the wrong physical one for this specific
                      // scheduled run. departure.runId is PTV's own real run
                      // identifier for this exact departure — try matching
                      // that against the live feed's tripId/id first, and
                      // only fall back to the proximity guess when no exact
                      // run match exists yet in the live feed.
                      const liveTramMatch = stopModeIsTram
                        ? (departure.runId && liveTrams.find((candidate) => (candidate.tripId ?? candidate.id) === departure.runId)) ||
                          liveTrams.find((candidate) =>
                            candidate.route === departure.route &&
                            getDistanceInMetres([candidate.lat, candidate.lng], stopPosition) <= 1500,
                          )
                        : undefined;
                      const liveBusMatch = !stopModeIsTram
                        ? (departure.runId && liveBuses.find((candidate) => (candidate.tripId ?? candidate.id) === departure.runId)) ||
                          liveBuses.find((candidate) =>
                            candidate.route === departure.route &&
                            getDistanceInMetres([candidate.lat, candidate.lng], stopPosition) <= 1500,
                          )
                        : undefined;
                      const isTrackableNow = Boolean(liveTramMatch || liveBusMatch);
                      return (
                        <button
                          type="button"
                          key={`${departure.runId ?? departure.expectedAt}-${departure.destination}`}
                          disabled={!isTrackableNow}
                          onClick={() => {
                            // No real live match for this run — the fallback
                            // vehicle below would just fake a "live" position
                            // at the stop itself with no real stop sequence,
                            // landing on an empty "0 stops" dead end. Nothing
                            // useful to show, so don't navigate there at all.
                            if (!isTrackableNow) return;
                            if (stopModeIsTram) {
                              const tramVehicle: LiveTram = liveTramMatch ?? {
                                id: `scheduled-${departure.runId ?? departure.expectedAt}`,
                                label: departure.route,
                                route: departure.route,
                                destination: departure.destination,
                                lat: stopPosition[0],
                                lng: stopPosition[1],
                                status: "live",
                                timestamp: departure.expectedAt,
                              };
                              setSelectedDetail({ type: "tram", tram: tramVehicle });
                              safeFlyTo(mapRef.current, tramVehicle.lat, tramVehicle.lng, Math.max(mapZoom, 14.5), { animate: true, duration: 0.8 });
                            } else {
                              const busVehicle: LiveBus = liveBusMatch ?? {
                                id: `scheduled-${departure.runId ?? departure.expectedAt}`,
                                label: departure.route,
                                route: departure.route,
                                destination: departure.destination,
                                lat: stopPosition[0],
                                lng: stopPosition[1],
                                status: "live",
                                timestamp: departure.expectedAt,
                              };
                              setSelectedDetail({ type: "bus", bus: busVehicle });
                              safeFlyTo(mapRef.current, busVehicle.lat, busVehicle.lng, Math.max(mapZoom, 14.5), { animate: true, duration: 0.8 });
                            }
                          }}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition ${isTrackableNow ? "hover:bg-sky-500/10 active:scale-[0.99] cursor-pointer" : "cursor-default opacity-70"}`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{departure.route} to {departure.destination}</p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
                              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${isTrackableNow ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/40"}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${isTrackableNow ? "animate-pulse bg-emerald-400" : "bg-white/30"}`} />
                                {isTrackableNow ? "Trackable now" : "Not tracked yet"}
                              </span>
                              {departure.platform ? `Platform ${departure.platform}` : isLive ? "Live PTV update" : "Scheduled"}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-white">{hasValidExpectedTime ? expected.toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" }) : "Time unavailable"}</p>
                            {showScheduledTime && <p className="text-[10px] text-amber-200">was {scheduled.toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit" })}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-relaxed text-white/60">No scheduled departures available for this route at the moment.</p>
                )}
                {selectedSurfaceStopDepartures?.source && <p className="mt-3 text-[10px] text-white/40">{selectedSurfaceStopDepartures.source}</p>}
              </div>
                );
              })()}

              {unverifiedTransitPanelsEnabled() && (isPremium ? (
              <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-300/75">
                      Schedules
                    </p>
                    <p className="mt-1 text-xs text-white/55">
                      Next scheduled departures for this stop in the app.
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                    {selectedDetail.stop.departures.length} listed
                  </span>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {selectedDetail.stop.departures.map((departure) => (
                    <div
                      key={`${selectedDetail.stop.id}-${departure.route}-${departure.destination}-${departure.departureLabel}`}
                      className="rounded-2xl border border-white/10 bg-black/15 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200/75">
                            Route {departure.route}
                          </p>
                          <p className="mt-1 text-base font-semibold leading-tight text-white">
                            {departure.destination}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/85">
                          {departure.departureLabel}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-white/55">
                        {departure.note ?? departure.statusLabel}
                      </p>
                      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/75">
                        {departure.statusLabel}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              ) : (
              <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-yellow-200/85">
                      Premium
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">Advanced stop schedules are locked.</p>
                    <p className="mt-1 text-xs text-white/55">
                      Premium unlocks the next scheduled departures panel for bus and tram stops.
                    </p>
                  </div>
                  <span className="rounded-full border border-yellow-300/20 bg-yellow-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-yellow-100/85">
                    Locked
                  </span>
                </div>
                {premiumPaypalLink ? (
                  <a
                    href={premiumPaypalLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex rounded-full border border-yellow-300/20 bg-yellow-500/10 px-3 py-1.5 text-[11px] font-semibold text-yellow-100 transition hover:bg-yellow-500/15"
                  >
                    Unlock with PayPal
                  </a>
                ) : (
                  <p className="mt-3 text-xs text-white/50">Add a PayPal premium link in Settings to unlock this feature.</p>
                )}
              </div>
              ))}

              {selectedDetail.stop.modes.includes("bus") && (
                <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300/75">
                        Live track buses
                      </p>
                      <p className="mt-1 text-xs text-white/55">
                        {selectedDetail.stop.routeLabel
                          ? `Nearby live buses on route ${selectedDetail.stop.routeLabel}.`
                          : "Nearby live buses on every route serving this stop."}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                      {selectedSurfaceStopLiveBuses.length > 0 ? `${selectedSurfaceStopLiveBuses.length} live` : "No live buses"}
                    </span>
                  </div>

                  {unverifiedTransitPanelsEnabled() && selectedSurfaceBusTrackingStops.length > 0 ? (
                    <div className="mt-3 overflow-hidden rounded-[1.25rem] border border-sky-300/15 bg-slate-950/70">
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-sky-500/10 px-3 py-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-200/80">
                            Onboard stop view
                          </p>
                          <p className="mt-1 text-sm font-semibold text-white">
                            Route {selectedDetail.stop.routeLabel} to {getPrimarySurfaceDestination(selectedDetail.stop)}
                          </p>
                        </div>
                        <span className="rounded-full border border-sky-300/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-100/85">
                          {selectedSurfaceBusLeadVehicle
                            ? `Live ${selectedSurfaceBusLeadVehicle.bus.route}`
                            : "Stop list"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">
                        <span>
                          {selectedSurfaceBusLeadVehicle?.bus.timestamp
                            ? getMarkerServiceTime(selectedSurfaceBusLeadVehicle.bus.timestamp)
                            : "Live now"}
                        </span>
                        <span>
                          {selectedSurfaceBusLeadVehicle
                            ? selectedSurfaceBusLeadVehicle.bus.destination ?? getPrimarySurfaceDestination(selectedDetail.stop)
                            : getPrimarySurfaceDestination(selectedDetail.stop)}
                        </span>
                      </div>

                      <div className="max-h-64 overflow-y-auto px-3 py-2">
                        {selectedSurfaceBusTrackingStops.map((stop, stopIndex) => {
                          const absoluteIndex =
                            (selectedSurfaceBusCurrentStopIndex >= 0 ? selectedSurfaceBusCurrentStopIndex : 0) + stopIndex;
                          const isCurrent = absoluteIndex === selectedSurfaceBusCurrentStopIndex;
                          const isSelectedStop = stop.id === selectedDetail.stop.id;

                          return (
                            <div
                              key={`${selectedDetail.stop.id}-bus-sequence-${stop.id}`}
                              className={`flex items-center gap-3 border-b border-white/5 py-2 last:border-b-0 ${
                                isCurrent ? "bg-sky-400/8" : ""
                              }`}
                            >
                              <div
                                className={`min-w-[54px] rounded-full border px-2 py-1 text-center text-[10px] font-bold ${
                                  isCurrent
                                    ? "border-sky-300/30 bg-sky-400 text-slate-950"
                                    : isSelectedStop
                                      ? "border-emerald-300/30 bg-emerald-400/20 text-emerald-100"
                                      : "border-white/10 bg-white/5 text-white/70"
                                }`}
                              >
                                {isCurrent ? "Now" : `Stop ${absoluteIndex + 1}`}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={`truncate text-sm font-semibold ${isCurrent ? "text-white" : "text-white/88"}`}>
                                  {stop.name}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-white/45">
                                  {stop.locality}
                                  {isCurrent
                                    ? selectedSurfaceBusLeadVehicle?.bus.timestamp
                                      ? ` · Updated ${formatRelativeTime(selectedSurfaceBusLeadVehicle.bus.timestamp)}`
                                      : " · Live position"
                                    : isSelectedStop
                                      ? " · Selected stop"
                                      : ""}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {selectedSurfaceStopLiveBuses.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {selectedSurfaceStopLiveBuses.map(({ bus, distanceMetres }) => (
                        <div
                          key={`${selectedDetail.stop.id}-${bus.id}`}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/15 p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">
                              Route {bus.route} to {bus.destination ?? "Live bus"}
                            </p>
                            <p className="mt-1 text-xs text-white/55">
                              {formatDistanceLabel(distanceMetres)}
                              {bus.timestamp
                                ? ` · Updated ${formatRelativeTime(bus.timestamp)}`
                                : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              safeFlyTo(mapRef.current, bus.lat, bus.lng, Math.max(mapRef.current?.getZoom() ?? 14, 14), {
                                animate: true,
                                duration: 0.85,
                              });
                              setSelectedDetail(null);
                            }}
                            className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/15"
                          >
                            Jump to bus
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-black/10 p-3">
                      <p className="text-sm font-semibold text-white/80">No nearby Route {selectedDetail.stop.routeLabel} buses</p>
                      <p className="mt-1 text-xs text-white/55">There are currently no reporting Route {selectedDetail.stop.routeLabel} vehicles near this stop.</p>
                    </div>
                  )}
                </div>
              )}

              {selectedDetail.stop.modes.includes("tram") && (
                <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300/75">
                        Live track trams
                      </p>
                      <p className="mt-1 text-xs text-white/55">
                        Nearby live trams on route {selectedDetail.stop.routeLabel}.
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                      {selectedSurfaceStopLiveTrams.length > 0 ? `${selectedSurfaceStopLiveTrams.length} live` : "No live trams"}
                    </span>
                  </div>

                  {selectedSurfaceStopLiveTrams.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {selectedSurfaceStopLiveTrams.map(({ tram, distanceMetres }) => (
                        <div
                          key={`${selectedDetail.stop.id}-${tram.id}`}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/15 p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">
                              Route {tram.route} to {tram.destination ?? "Live tram"}
                            </p>
                            <p className="mt-1 text-xs text-white/55">
                              {formatDistanceLabel(distanceMetres)}
                              {tram.timestamp
                                ? ` · Last reported ${formatRelativeTime(tram.timestamp)}`
                                : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              safeFlyTo(mapRef.current, tram.lat, tram.lng, Math.max(mapRef.current?.getZoom() ?? 14, 14), {
                                animate: true,
                                duration: 0.85,
                              });
                              setSelectedDetail(null);
                            }}
                            className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/15"
                          >
                            Jump to tram
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-black/10 p-3 text-sm text-white/55">
                      No route {selectedDetail.stop.routeLabel} trams are reporting live near this stop right now.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!selectedDetail && <button
        type="button"
        onClick={() => setIsMobileMapKeyOpen((open) => !open)}
        className="absolute bottom-[6.5rem] left-3 z-[1002] inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-slate-950/88 px-3 text-xs font-semibold text-white shadow-xl backdrop-blur-xl sm:hidden"
        aria-expanded={isMobileMapKeyOpen}
      >
        {isMobileMapKeyOpen ? <X className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
        {isMobileMapKeyOpen ? "Close key" : "Map key"}
      </button>}

      {!selectedDetail && <div className={`pointer-events-none absolute bottom-[9.5rem] left-3 z-[1001] max-w-[calc(100%-1.5rem)] sm:bottom-32 sm:left-4 sm:block sm:max-w-[20rem] ${isMobileMapKeyOpen ? "block" : "hidden"}`}>
        <div className="rounded-2xl border border-white/10 bg-slate-950/94 p-3 shadow-xl backdrop-blur-xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
            Map key
          </p>

          <div className="mt-3 space-y-2.5 text-[11px] leading-4 text-white/72">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-5 w-8 items-center justify-center rounded-full border-2 border-slate-950 bg-white shadow-[0_2px_6px_rgba(0,0,0,0.25)]">
                <div className="h-[3px] w-5 rounded-full bg-slate-900/20" />
              </div>
              <p>
                <span className="font-semibold text-white">Interchange station</span>
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-blue-600/90 text-white">
                <Accessibility className="h-3.5 w-3.5" />
              </div>
              <p>
                <span className="font-semibold text-white">Lift or ramp access</span> where accessible station access is available.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-950">
                <Info className="h-3.5 w-3.5" />
              </div>
              <p>
                <span className="font-semibold text-white">Stations staffed</span> from first to last train where full-time staffing applies.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="mt-[9px] h-0 w-8 border-t-2 border-dotted border-white/55" />
              <p>
                <span className="font-semibold text-white">Zone 1 and 2 boundary</span>
              </p>
            </div>
          </div>

          <p className="mt-3 border-t border-white/10 pt-2 text-[10px] leading-4 text-white/45">
            Metro staffed-station hours vary by station. Regional station staffing can vary more widely again.
          </p>
        </div>
      </div>}

      {!selectedDetail && <button
        type="button"
        onClick={() => setIsNearbyStopsOpen((open) => !open)}
        className="absolute top-[4.25rem] left-3 z-[1002] inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-slate-950/88 px-3 text-xs font-semibold text-white shadow-xl backdrop-blur-xl sm:hidden"
        aria-expanded={isNearbyStopsOpen}
      >
        {isNearbyStopsOpen ? <X className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
        {isNearbyStopsOpen ? "Close nearby" : "Nearby stops"}
      </button>}

      {!selectedDetail && <div className={`pointer-events-none absolute top-[7.25rem] left-3 z-[1001] max-w-[calc(100%-1.5rem)] sm:top-4 sm:left-4 sm:block sm:max-w-[19rem] ${isNearbyStopsOpen ? "block" : "hidden"}`}>
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/94 p-3 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
              Nearby stops
            </p>
            <button
              type="button"
              onClick={() => {
                if (!("geolocation" in navigator)) return;
                navigator.geolocation.getCurrentPosition(
                  (position) => setUserLoc([position.coords.latitude, position.coords.longitude]),
                  () => {},
                  { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 },
                );
              }}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/70 transition hover:bg-white/10"
              title="Use my location"
            >
              <Navigation className="h-3 w-3" />
            </button>
          </div>

          {!userLoc ? (
            <p className="mt-3 text-[11px] leading-4 text-white/55">
              Turn on location to see the stations, tram stops, and bus stops closest to you.
            </p>
          ) : nearbyStops.length === 0 ? (
            <p className="mt-3 text-[11px] leading-4 text-white/55">
              Nothing within 1.2km of your location right now.
            </p>
          ) : (
            <div className="mt-3 max-h-[16rem] space-y-1.5 overflow-y-auto pr-0.5">
              {nearbyStops.map((entry) => {
                const key = entry.kind === "station" ? `station-${entry.station.name}` : `surface-${entry.stop.id}`;
                const name = entry.kind === "station" ? entry.station.name : entry.stop.name;
                const position = entry.kind === "station" ? entry.station.position : entry.stop.position;
                const subtitle = entry.kind === "station"
                  ? (entry.station.zone ? `Zone ${entry.station.zone}` : "Train station")
                  : entry.stop.routeLabel
                    ? `Route ${entry.stop.routeLabel}`
                    : entry.stop.subtitle || "Multiple routes";
                const Icon = entry.kind === "station"
                  ? Train
                  : entry.stop.modes.includes("tram")
                    ? TramFront
                    : Bus;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      mapRef.current?.flyTo(position, Math.max(mapRef.current?.getZoom() ?? 15, 15), {
                        animate: true,
                        duration: 0.85,
                      });
                      if (entry.kind === "station") {
                        setSelectedDetail({ type: "station", station: entry.station });
                      } else {
                        setSelectedDetail({ type: "surfaceStop", stop: entry.stop });
                      }
                      setIsNearbyStopsOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-white/5 px-2.5 py-2 text-left transition hover:bg-white/10"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/80">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-white">{name}</span>
                      <span className="block truncate text-[10px] text-white/50">{subtitle}</span>
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold text-white/45">
                      {formatDistanceLabel(entry.distanceMetres)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>}

      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_rgba(10,10,20,0.7)] z-[500]" />
    </div>
  );
}

export function getFilterChips(filterKey: ServiceFilterKey) {
  switch (filterKey) {
    case "geelongRegionalGroup":
      return ["Waurn Ponds", "Warrnambool"];
    case "ballaratRegionalGroup":
      return ["Ararat", "Maryborough"];
    case "bendigoRegionalGroup":
      return ["Swan Hill", "Echuca"];
    case "seymourRegionalGroup":
      return ["Shepparton", "Albury"];
    case "traralgonRegionalGroup":
      return ["Bairnsdale"];
    case "metroTunnelServices":
      return [new Date().getMinutes() % 4 === 0 ? "Munnel" : "Metro Tunnel"];
    case "burnleyGroup":
      return ["Via Burnley Loop"];
    case "cliftonHillGroup":
      return ["Via Clifton Hill Loop"];
    case "caulfieldGroup":
      return ["Via Caulfield Loop", "Continues to Stony Point (shuttle)"];
    case "frankstonGroup":
      return ["Branch off Frankston"];
    case "upfieldCraigieburn":
      return ["Via Northern Loop"];
    default:
      return [];
  }
}










