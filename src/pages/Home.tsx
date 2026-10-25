import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { getApiUrl } from "@/lib/api-config";
import { getCurrentVlineAllocation } from "@/lib/vline-allocation";
import {
  Bell,
  ChevronDown,
  ChevronUp,
  CircleUserRound,
  Info,
  Map as MapIcon,
  MapPin,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Shield,
  X,
} from "lucide-react";
import {
  Map as TransitMap,
  ADMIN_DEBUG_LINE_OPTIONS,
  Station,
  ALL_STATIONS,
  LINES,
  SERVICE_FILTERS,
  getFilterChips,
  getLiveLineColor,
  getVehicleFocusKey,
  type AdminDebugLineKey,
  type LayerState,
  type ServiceFilterKey,
  type TransportMode,
} from "@/components/Map";
import { RiskyRoutes } from "@/components/RiskyRoutes";
import { AddReportDrawer } from "@/components/AddReportDrawer";
import { Tabs } from "@/components/ui/tabs";
import { TRANSITALERT_WEB_VERSION } from "@/lib/version";
import { continueAsGuest, fetchAuthSession, logoutSession, markGuestIntent } from "@/lib/auth";
import { isIosDevice, isStandaloneApp, notificationsEnabled } from "@/lib/pwa";
import {
  broadcastWelcomeEmail,
  fetchAdminAccounts,
  fetchAdminConfig,
  saveAdminConfig,
  updateAdminAccount,
  type AdminAccountRecord,
  type ApprovedDebugTesterRecord,
  type AdminRuntimeConfig,
} from "@/lib/admin-config";
import { fetchLiveTrains, isSydneyTrainsLiveTrain, isVlineLiveTrain, type LiveTrain } from "@/lib/live-trains";
import { getVlineRouteMetaFromTripId, isGenericRegionalPlaceholder } from "@/lib/regional-fallback";
import { fetchLiveBuses, type LiveBus } from "@/lib/live-buses";
import { lookupBusFleetInfo } from "@/lib/bus-fleet";
import { fetchLiveTrams, type LiveTram } from "@/lib/live-trams";
import { fetchSydneyTransit } from "@/lib/sydney-transit";
import busButtonIcon from "@/assets/icons/bus.png";
import tramButtonIcon from "@/assets/icons/tram.png";
import {
  DEFAULT_TRANSPORT_MODES,
  defaultPreferences,
  fetchAccountPreferences,
  getFavouriteConsists,
  getMobilePerformanceMode,
  getPremiumPaypalLink,
  hasPremiumAccess,
  mergeLocalPreferences,
  readLocalPreferences,
  saveAccountPreferences,
  type UserPreferences,
  writeLocalPreferences,
} from "@/lib/preferences";
import { fetchMetroNotifyAlerts, isAlertCurrent } from "@/lib/todays-alerts";
import { alertMatchesJourney, journeyDisruptionGuidance } from "@/lib/journey-disruptions";
import { fetchStationDepartures, fetchJourneyPlan, fetchSurfaceStopDepartures, fetchBusTrip, fetchTramTrip, fetchTrainTrip } from "@/lib/timetable";

const TRAIN_BOARDING_HINTS: Record<string, { zone: string; reason: string }> = {
  "North Melbourne": {
    zone: "Front third",
    reason: "Best for quick exits toward concourse links and northern platform changes.",
  },
  "Southern Cross": {
    zone: "Front third",
    reason: "Usually easiest for regional interchange, coach links, and the main concourse.",
  },
  "Flinders Street": {
    zone: "Middle cars",
    reason: "Best all-round spot for the subway, Swanston Street exits, and platform swaps.",
  },
  Richmond: {
    zone: "Middle cars",
    reason: "Keeps you close to the stairs for Burnley, Clifton Hill, Sandringham, and Frankston transfers.",
  },
  "South Yarra": {
    zone: "Middle to rear",
    reason: "Better for Sandringham and Frankston-side interchanges without a long platform walk.",
  },
  Parliament: {
    zone: "Middle cars",
    reason: "Closest to the main CBD concourse and exits.",
  },
  "Melbourne Central": {
    zone: "Middle cars",
    reason: "Best for the central concourse, escalators, and connecting walkways.",
  },
  Flagstaff: {
    zone: "Middle cars",
    reason: "Best for station exits and less rushing along the platform.",
  },
};

const SURFACE_PLANNER_STATIONS: Station[] = [
  { name: "Melbourne University", position: [-37.7982, 144.9605] },
  { name: "Balaclava Junction", position: [-37.8693, 144.9952] },
  { name: "Caulfield Junction", position: [-37.8772, 145.0242] },
  { name: "East Brighton", position: [-37.9152, 145.0165] },
  { name: "Elwood", position: [-37.8842, 144.9853] },
  { name: "Monash University", position: [-37.9105, 145.1362] },
  { name: "Lilac Cres/Centre Rd", position: [-37.9142, 145.0208] },
  { name: "Clayton Station/Carinish Rd", position: [-37.9249, 145.1202] },
  { name: "Hawthorn Rd/North Rd", position: [-37.9027, 145.0197] },
  { name: "Huntingdale Station/Haughton Rd", position: [-37.9108, 145.1027] },
];

const CURRENT_LOCATION_LABEL = "Current location";
const JOURNEY_STORAGE_KEY = "transitalert-active-journey-v1";
const ADMIN_DEBUG_STORAGE_KEY = "transitalert-admin-debug-line-v1";
// Generic Melbourne-area fallback point used only when a journey has no
// resolved origin/destination station coordinates yet.
const DEFAULT_FALLBACK_COORDS: [number, number] = [-37.9147, 145.0186];
const VERSION_SEEN_STORAGE_KEY = "transitalert-last-seen-version";
const ACCOUNT_ROLE_OPTIONS = ["Traveller", "Bug Tester", "Friend", "Special", "Train Driver", "Station Staff", "Admin"] as const;

type PlannerSheetProps = {
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

type DockedPanelSheetProps = {
  isOpen: boolean;
  onToggle: () => void;
  eyebrow: string;
  title: string;
  summary: string;
  fullPage?: boolean;
  children: ReactNode;
};

type VersionModalProps = {
  isOpen: boolean;
  onClose: () => void;
  showWelcome: boolean;
};

type FleetTypeKey =
  | "hcmt"
  | "xtrapolis"
  | "xtrapolis2"
  | "siemens"
  | "edi-comeng"
  | "alstom-comeng"
  | "n-class"
  | "sprinter"
  | "vlocity"
  | "vlocity-standard-gauge"
  | "xpt"
  | "tangara"
  | "waratah-a"
  | "waratah-b"
  | "millennium"
  | "k-set"
  | "oscar"
  | "sydney-trains-unclassified"
  | "mariyung"
  | "endeavour"
  | "hunter"
  | "xplorer"
  | "metropolis";
// Buses are categorised by their real vehicle type (Volvo B8RLE, Scania
// K320UB, BYD D9RA, etc. — sourced from the bus fleet database, not the
// operator) and trams by their real fleet class (B2, E, A2, etc., read
// straight from the live feed) rather than one flat "Bus" or "Tram" bucket —
// each gets its own dynamic fleet key derived from live data instead of a
// fixed, potentially-stale hardcoded list.
type BusTypeFleetKey = `bus:${string}`;
type TramClassFleetKey = `tram:${string}`;
type FleetFilterKey = "all" | FleetTypeKey | BusTypeFleetKey | TramClassFleetKey;
type HomeTabKey = "map" | "journey" | "fleets" | "pid" | "admin";

type FleetTripStatus = "running" | "upcoming";

type FleetTypeConfig = {
  key: FleetTypeKey;
  label: string;
  emoji: string;
  total: number;
};

type FleetFilterGroup = {
  label: string;
  filters: Array<{ key: FleetFilterKey; label: string }>;
};

type FleetTrip = {
  id: string;
  focusKey: string;
  tdn: string;
  tripNumber: string;
  line: string;
  route: string;
  fleet: FleetTypeKey | BusTypeFleetKey | TramClassFleetKey;
  status: FleetTripStatus;
  lineColor: string;
  statusLabel: string;
  updatedAt: string;
  consist: string;
  setNumber: string;
  realtimeLabel: string;
  consistPublicLabel: string;
  specialLabel: string;
  // Bus-only: the real chassis/model text (e.g. "Volvo B8RLEA"), shown as a
  // subtitle on each row alongside the operator-based fleet grouping.
  vehicleModel?: string;
};

type StationDeparture = {
  id: string;
  destination: string;
  platform: string;
  status: "On Time" | "Boarding" | "Departed" | "Delayed";
  time: string;
  tdn: string;
  lineLabel: string;
  lineTone: string;
};

type PidStyleKey = "metro-modern" | "connex-legacy" | "metlink-era" | "transitalert" | "vline" | "custom";
type PidPreviewMode = "single" | "split" | "multi-platform" | "station-wall" | "concourse" | "departure-board" | "operations";
type PidDisplayDensity = "comfortable" | "standard" | "dense";
type PidThemeMode = "dark" | "light";

type JourneyLeg = {
  mode: "train" | "tram" | "bus" | "walk";
  title: string;
  from: string;
  to: string;
  detail: string;
  badge: string;
};

// One polyline per leg, so the map can draw a walk from the door as a thin
// dashed line, a train leg along the real line colour, and a bus leg in its
// own colour — instead of one flat line straight through every stop that
// makes a mixed-mode trip look like a single, wrong service.
type JourneyLegSegment = {
  mode: JourneyLeg["mode"];
  positions: [number, number][];
  routeLabel?: string;
};

type JourneyDisplay = {
  summary: string;
  pattern: string;
  typeLabel: string;
  window: string;
  duration: string;
  date: string;
  stopCountLabel: string;
  legs: JourneyLeg[];
};

type PersistedJourneyState = {
  journeyOrigin: string;
  journeyDestination: string;
  currentLocationOrigin: string | null;
  currentLocationCoords: [number, number] | null;
  routeStationNames: string[];
  summary: string;
  boardingAdvice: string;
  display: JourneyDisplay | null;
  attachedServiceKey: string | null;
  attachedServiceLabel: string | null;
  startedAt: string | null;
};

type ChangelogEntry = {
  version: string;
  date: string;
  notes: string[];
};

const FLEET_TYPES: FleetTypeConfig[] = [
  { key: "hcmt", label: "HCMT", emoji: "Train", total: 37 },
  { key: "xtrapolis", label: "X'Trapolis 100", emoji: "Train", total: 32 },
  { key: "xtrapolis2", label: "X'Trapolis 2.0", emoji: "Train", total: 1 },
  { key: "siemens", label: "Siemens", emoji: "Train", total: 20 },
  { key: "edi-comeng", label: "EDI Comeng", emoji: "Train", total: 51 },
  { key: "alstom-comeng", label: "Alstom Comeng", emoji: "Train", total: 49 },
  // Real fleet is N451-N474 (VICSIG) — see N_CLASS_CONSIST_PATTERN below.
  { key: "n-class", label: "N Class", emoji: "Train", total: 24 },
  { key: "sprinter", label: "Sprinter", emoji: "Train", total: 1 },
  { key: "vlocity", label: "VLocity (Broad Gauge)", emoji: "Train", total: 25 },
  { key: "vlocity-standard-gauge", label: "VLocity (Standard Gauge)", emoji: "Train", total: 0 },
  { key: "xpt", label: "XPT", emoji: "Train", total: 1 },
  { key: "tangara", label: "Tangara (T Set)", emoji: "Train", total: 0 },
  { key: "waratah-a", label: "Waratah A Set", emoji: "Train", total: 0 },
  { key: "waratah-b", label: "Waratah B Set", emoji: "Train", total: 0 },
  { key: "millennium", label: "Millennium (M Set)", emoji: "Train", total: 0 },
  { key: "k-set", label: "K Set", emoji: "Train", total: 0 },
  { key: "oscar", label: "Oscar (H Set)", emoji: "Train", total: 0 },
  { key: "sydney-trains-unclassified", label: "Sydney Trains", emoji: "Train", total: 0 },
  { key: "mariyung", label: "Mariyung (D Set)", emoji: "Train", total: 0 },
  { key: "endeavour", label: "Endeavour", emoji: "Train", total: 0 },
  { key: "hunter", label: "Hunter", emoji: "Train", total: 0 },
  { key: "xplorer", label: "Xplorer", emoji: "Train", total: 0 },
  { key: "metropolis", label: "Metropolis", emoji: "Train", total: 0 },
];

const FLEET_FILTER_GROUPS: FleetFilterGroup[] = [
  {
    label: "Victoria",
    filters: [
      { key: "all", label: "All" },
      { key: "hcmt", label: "HCMT" },
      { key: "xtrapolis", label: "X'Trapolis 100" },
      { key: "xtrapolis2", label: "X'Trapolis 2.0" },
      { key: "siemens", label: "Siemens" },
      { key: "edi-comeng", label: "EDI Comeng" },
      { key: "alstom-comeng", label: "Alstom Comeng" },
      { key: "n-class", label: "N Class" },
      { key: "sprinter", label: "Sprinter" },
      { key: "vlocity", label: "VLocity (Broad Gauge)" },
      { key: "vlocity-standard-gauge", label: "VLocity (Standard Gauge)" },
    ],
  },
  {
    label: "Sydney Trains",
    filters: [
      { key: "tangara", label: "Tangara (T Set)" },
      { key: "waratah-a", label: "Waratah A Set" },
      { key: "waratah-b", label: "Waratah B Set" },
      { key: "millennium", label: "Millennium (M Set)" },
      { key: "k-set", label: "K Set" },
      { key: "oscar", label: "Oscar (H Set)" },
      // The live Sydney Trains feed doesn't publish which physical fleet
      // class a vehicle is (its own vehicle id is an anonymised, rotating
      // string — verified by fetching the real feed directly), so a real
      // vehicle that can't be matched to one of the specific sets above
      // lands here instead of being guessed into one.
      { key: "sydney-trains-unclassified", label: "Sydney Trains" },
      // Sydney Metro is operationally a separate network, but it's still
      // part of the same Sydney rail system as far as this filter grouping
      // is concerned — no need for its own top-level section for one fleet.
      { key: "metropolis", label: "Metropolis (Sydney Metro)" },
    ],
  },
  {
    label: "NSW TrainLink",
    filters: [
      { key: "mariyung", label: "Mariyung (D Set)" },
      { key: "endeavour", label: "Endeavour" },
      { key: "hunter", label: "Hunter" },
      { key: "xplorer", label: "Xplorer" },
      { key: "xpt", label: "XPT" },
    ],
  },
];

// One accent colour per fleet category so the tracker's filter groups read
// as distinct sections at a glance instead of a wall of identical grey
// cards — matches the tone each mode already uses elsewhere (orange for
// NSW/XPT, emerald for trams, amber for buses).
const FLEET_GROUP_ACCENTS: Record<string, { dot: string; selectedBorder: string; selectedBg: string; selectedGlow: string; countBg: string; countText: string }> = {
  Victoria: {
    dot: "bg-cyan-300",
    selectedBorder: "border-cyan-300/80",
    selectedBg: "bg-cyan-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(34,211,238,0.22)]",
    countBg: "bg-cyan-300/10",
    countText: "text-cyan-200",
  },
  "Sydney Trains": {
    dot: "bg-sky-400",
    selectedBorder: "border-sky-300/80",
    selectedBg: "bg-sky-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(56,189,248,0.22)]",
    countBg: "bg-sky-300/10",
    countText: "text-sky-200",
  },
  "NSW TrainLink": {
    dot: "bg-orange-400",
    selectedBorder: "border-orange-300/80",
    selectedBg: "bg-orange-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(251,146,60,0.22)]",
    countBg: "bg-orange-300/10",
    countText: "text-orange-200",
  },
  "Sydney Metro": {
    dot: "bg-violet-400",
    selectedBorder: "border-violet-300/80",
    selectedBg: "bg-violet-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(167,139,250,0.22)]",
    countBg: "bg-violet-300/10",
    countText: "text-violet-200",
  },
  "Victoria Buses": {
    dot: "bg-amber-400",
    selectedBorder: "border-amber-300/80",
    selectedBg: "bg-amber-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(251,191,36,0.22)]",
    countBg: "bg-amber-300/10",
    countText: "text-amber-200",
  },
  "NSW Buses": {
    dot: "bg-orange-400",
    selectedBorder: "border-orange-300/80",
    selectedBg: "bg-orange-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(251,146,60,0.22)]",
    countBg: "bg-orange-300/10",
    countText: "text-orange-200",
  },
  "Victoria Trams": {
    dot: "bg-emerald-400",
    selectedBorder: "border-emerald-300/80",
    selectedBg: "bg-emerald-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(52,211,153,0.22)]",
    countBg: "bg-emerald-300/10",
    countText: "text-emerald-200",
  },
  "NSW Trams": {
    dot: "bg-teal-400",
    selectedBorder: "border-teal-300/80",
    selectedBg: "bg-teal-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(45,212,191,0.22)]",
    countBg: "bg-teal-300/10",
    countText: "text-teal-200",
  },
  default: {
    dot: "bg-cyan-300",
    selectedBorder: "border-cyan-300/80",
    selectedBg: "bg-cyan-400/15",
    selectedGlow: "shadow-[0_0_18px_rgba(34,211,238,0.22)]",
    countBg: "bg-cyan-300/10",
    countText: "text-cyan-200",
  },
};

function slugifyFleetLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || "unknown";
}

const PID_STATIONS = [
  "Flinders Street",
  "Southern Cross",
  "Richmond",
  "Footscray",
  "Caulfield",
  "Ringwood",
  "Frankston",
  "North Melbourne",
  "Town Hall",
  "State Library",
  "Sunshine",
  "Dandenong",
  "Sandringham",
] as const;

const PID_STYLE_PRESETS: Array<{ key: PidStyleKey; label: string; description: string }> = [
  { key: "metro-modern", label: "Metro modern", description: "Clean current-generation suburban display direction." },
  { key: "connex-legacy", label: "Legacy Connex-style", description: "Green legacy-inspired tester mode, not an official clone." },
  { key: "metlink-era", label: "Metlink-era", description: "High-contrast blue/yellow era-inspired layout." },
  { key: "transitalert", label: "TransitAlert custom", description: "Original dark control-room visual system." },
  { key: "vline", label: "V/Line", description: "Regional departure board style for longer-distance services." },
  { key: "custom", label: "Custom editor", description: "Use your own colours, density, font and branding." },
];

const PID_PREVIEW_MODES: Array<{ key: PidPreviewMode; label: string }> = [
  { key: "single", label: "Single PID screen" },
  { key: "split", label: "Split screen" },
  { key: "multi-platform", label: "Multi-platform preview" },
  { key: "station-wall", label: "Entire station wall" },
  { key: "concourse", label: "Concourse overview" },
  { key: "departure-board", label: "Departure board" },
  { key: "operations", label: "Operations mode" },
];

const PID_FONTS = ["Inter", "Arial", "Helvetica", "DIN-style", "Mono operations"] as const;
const PID_RESOLUTIONS = ["1920x1080", "1366x768", "1280x720", "1080x1920", "3840x2160"] as const;
const PID_DENSITIES: PidDisplayDensity[] = ["comfortable", "standard", "dense"];
const PID_THEMES: PidThemeMode[] = ["dark", "light"];

const VERSION_LOG: ChangelogEntry[] = [
  {
    version: TRANSITALERT_WEB_VERSION,
    date: "17/09/2026",
    notes: [
      "Fixed a real map data bug on the Belgrave/Lilydale/Alamein lines: the shared Richmond-to-Burnley track was being cut down to just 2 points before jumping straight to each line's own branch data, drawing a long straight diagonal line across Richmond/East Richmond/Burnley instead of following the real curve. All three lines now follow their real GTFS shape through that corridor.",
      "Fixed live buses never showing for a multi-route bus interchange bay (e.g. a shared bay serving several routes) — the live-vehicle matching only ever checked a single route label, which a shared bay never has, so it silently came back empty for exactly the stops that need it most.",
      "Fixed departures sometimes linking to the wrong physical bus or tram: tapping a scheduled departure now matches PTV's own real run ID to the live feed first, instead of just picking whichever vehicle on that route happened to be nearest the stop (which could grab a different vehicle entirely when two were nearby).",
      "Selecting a bus stop now focuses the map on exactly the live buses relevant to that stop's departures card, the same way selecting one specific bus already narrows the view.",
      "Corrected 5 Sandringham line station markers (Ripponlea, Elsternwick, Gardenvale, North Brighton, Middle Brighton) that were up to ~46m off their real position, verified against OpenStreetMap's own station data.",
      "Added 'Change here for' interchange summaries for Glen Huntly, McKinnon, Ormond, Gardenvale, and North Brighton with their real bus/tram/train connections, and fixed Caulfield and Gardenvale's platform-level direction text.",
      "V/Line's single notification filter is now split into its 5 real corridors (Bairnsdale, Geelong, Ballarat, Bendigo, Seymour) matched against the disruption's actual resolved corridor, plus a dedicated Buses filter — instead of one catch-all V/Line toggle.",
      "Notification preference changes (alert types and lines) now stage locally and only save when you tap Apply changes, instead of firing a save on every single tap.",
      "Removed the 'Live tracking / How it works' card from the alerts page notification panel.",
    ],
  },
  {
    version: "1.25",
    date: "16/09/2026",
    notes: [
      "Added a full 'Lines & Services' notification filter alongside the existing alert-type categories — riders can now untick specific lines (Frankston, Sandringham, V/Line, Buses, etc.) so pushes only arrive for what they actually ride, with related lines that run as one real corridor (e.g. Sunbury/Cranbourne/Pakenham via the Metro Tunnel, Werribee/Williamstown/Sandringham/Altona Loop, Mernda/Hurstbridge, Craigieburn/Upfield, and the Belgrave/Lilydale/Glen Waverley/Alamein group) combined into single toggles instead of forcing several to be kept in sync by hand. Each toggle is coloured with that line's real map colour.",
      "Push notifications for a generic disruption (e.g. 'Delays up to 10 minutes due to extreme weather') now name the actual affected line in the message instead of reading as a systemwide alert with no context.",
      "Every station's detail panel now shows a proper 'Metro station' / 'V/Line station' / 'Metro + V/Line station' badge next to its name instead of repeating that inside the details text underneath.",
      "The Sandringham line now renders as two real parallel tracks on the map instead of one thick line, matching its actual double-track corridor.",
      "Rolled the 'Change here for: ...' interchange summary out to more stations (Glen Huntly, McKinnon, Ormond, Gardenvale) with the real, hand-verified connections at each one, and fixed several stations (Caulfield, Malvern) that had wrong or generic line data in that summary.",
      "Fixed Caulfield's Platform 1 and Platform 3 departure headers to describe the real direction and caveats (Platform 3 carries Metro Tunnel trains and V/Line services that pass through without picking up local passengers) instead of a raw destination list.",
      "Fixed Huntingdale Station Bus Bay C showing every route through the interchange — it now only shows the 630 towards Elwood, the route that actually stops there.",
      "Extended real GTFS-shaped bus route rendering across the network so bus routes follow actual roads instead of straight zig-zag lines between stops, and fixed the Footscray-to-Arden rail track to use its real shape instead of a straight line.",
      "Fixed every one of the map's 22,578 generated bus stops showing a bare numeric ID instead of its real street-based name (e.g. 'Webb St/Princes Hwy').",
      "Fixed a bus departure showing a garbled or wrong-direction destination label.",
      "Added a live 'Updated Xs/mins ago' timestamp under a train's live position card so it's clear how fresh that GPS fix actually is.",
      "Departure boards now keep a service visible for up to 2 minutes after it's left, up from 1, so a train you just missed doesn't vanish from the board immediately.",
      "Added notification preferences (by alert type — cancellations, delays, trespassers, works, etc.) so riders can mute categories they don't need.",
      "Fixed XT2 fleet history search to accept short set numbers (e.g. searching '7' now finds the real car number, 8107).",
      "Fixed the Caulfield station marker not being clickable, reordered its multi-ring colours (blue outer, green middle, purple centre), added its real V/Line Platform 3 fact for Southern Cross services, and removed its outdated boarding-zone guide.",
      "Made South Kensington's marker pink to match its real line colour.",
      "Verified the journey planner's train 'lock-in' behaviour (knowing which specific train you've boarded) already works correctly end to end.",
    ],
  },
  {
    version: "1.0",
    date: "07/09/2026",
    notes: [
      "TransitAlert 1.0: the journey planner, live alerts, and push notifications have all been through a full pass of real-data verification and are now considered production-ready.",
      "Release work also included real-data fixes across trains, trams, buses, and alerts, plus the About page and search-engine metadata.",
      "Fixed a real safety-relevant bug where the journey planner's 'next service' suggestion for a train leg could recommend a service heading the opposite direction — e.g. an Ormond to Glen Huntly trip could suggest an outbound Frankston-line train instead of a city-bound one. Departure matching now checks the actual station order on the line, not just the route name.",
      "Train legs in the journey planner — both the map line and the text leg cards — now use that line's real colour (e.g. Frankston green, Sandringham pink) instead of a generic blue. Tram and bus legs use their own real mode colours the same way.",
      "Live 'take this service' and 'next service' departure times in the journey planner now show a live-updating 'in X mins' countdown next to the clock time.",
      "The Train Tracker's service-continuity panel can now show up to two previous and two next workings (TDNs) for the same physical train, not just one each way, whenever the official timetable confirms that many linked services back-to-back.",
      "Fixed alert 'Details here' links that were pointing to a dead Metro Trains page with no actual content — they now open Transport Victoria's live disruptions page.",
      "Fixed a bug where multi-night works alerts (e.g. a bus replacement running Sunday to Wednesday) could disappear from the alerts list partway through, even though the disruption was still active — visibility now also checks the dates written in the alert text, not just when it was last updated.",
      "Fixed an alert title that was being cut off mid-sentence (e.g. 'Buses replace trains between the City and Caulfield from 8') — the title-shortening logic was mistaking the decimal point in times like '8.30pm' for the end of a sentence.",
      "Fixed duplicate alert cards for the same disruption caused by 'the City' and 'City' being treated as different locations.",
      "Added a dedicated 'Police request' alert filter, split out from Trespasser incidents so the two can be filtered separately.",
      "Fixed push notification links opening a 'Detour Ahead' 404 page instead of the alerts screen.",
      "TransitAlert now sends a push notification whenever a new version is released, summarising what changed.",
      "Journey planning uses real GTFS data across trains, V/Line, trams, and buses, so trips can be planned across the network.",
      "Fixed a bug that silently excluded every train route from journey planning (a GTFS route ID format collided with internal path-finding logic), which had been forcing bus-only routes even when a direct train was faster.",
      "Metro Tunnel journeys now show as one seamless leg end to end instead of a fake 'change trains' stop at Anzac or Town Hall — the schedule splits the TDN there, but it's the same physical train, and the planner now knows that.",
      "The journey map now draws each leg of a trip as its own line — train, tram, bus, and walking each get their own colour and style — instead of one flat line straight through every stop that made mixed-mode trips look broken.",
      "Bus and tram legs in the journey planner now get the same live 'take this service / next service' departure board as train legs, with real times pulled from the live feed.",
      "Removed the Google Maps cross-check link from the journey planner — planning now happens fully in TransitAlert using real schedule data.",
      "Destinations can now be found by their real public-facing name (like a tram's headsign) even when that differs from the technical stop name underneath.",
      "Fixed a bug where two different physical buses could be shown as the same vehicle's 'previous' or 'next' service — formation matching now requires the live feed to confirm it's actually the same vehicle before claiming continuity.",
      "TDNs are now hidden from non-premium users on the train detail panel and previous/next service cards, showing the service time instead.",
      "Corrected the Brighton Beach station marker, which was placed roughly 600m off in a nearby park instead of on the platform.",
      "Removed the boarding-guide 'best door' card from Flinders Street and Southern Cross, and gave the remaining boarding guide cards a cleaner look.",
      "Added a Nearby Stops panel to the map, listing real nearby stations, tram stops, and bus stops with live distance and one-tap navigation.",
      "Bus and tram stop departure boards now show a 'Trackable now' badge so it's clear which upcoming services actually have a live GPS-tracked vehicle behind them versus schedule-only.",
      "Added smooth, real GTFS-shaped track curves for the Metro Tunnel corridor instead of straight lines between stations.",
      "Fixed real push notifications: the background alert watcher was marking every disruption alert as 'already sent' even when nobody was subscribed yet, so alerts that existed before your first subscription could never reach you. New disruption alerts now push correctly.",
      "Confirmed Fleet Tracker search already finds buses and trams by their real fleet number or registration (e.g. searching a tram's fleet number or a bus's plate returns that exact vehicle).",
    ],
  },
  {
    version: "0.95",
    date: "05/09/2026",
    notes: [
      "Version 0.95 adds faster live-vehicle refresh and steadier train movement while zooming or moving the map.",
      "Train bubbles now use destination, origin and the real City Loop, Metro Tunnel or Flinders Street routing without duplicate wording such as Frankston via Frankston.",
      "Train formation bubbles now show car count, fleet family and useful consist identifiers; HCMTs show seven cars and their published set number.",
      "Regional stopping patterns now use live and verified GTFS data where available, preserve prior stops across TDN changes, and mark the train's current map position.",
      "V/Line and NSW TrainLink identity handling was separated so Albury V/Line services are not incorrectly labelled as XPT; genuine XPT services show as seven-car NSW TrainLink trains.",
      "Station-board selections now carry their exact origin, destination and TDN into both the service panel and selected map bubble.",
      "Bus map bubbles now lead with a nearby locality or published destination before the route number, and show the operator in the expanded label.",
      "Fleet Tracker is now a Premium sidebar feature with search, selection and automatic map centring on the chosen live service.",
      "Guest users can view TransitAlert's public live information without the previous guest-mode block.",
      "Selected-service map framing was improved for mobile so the marker remains visible above the detail sheet.",
      "Version 0.92 connected station departure cards to the current official Transport Victoria GTFS schedule and overlaid GTFS-Realtime times, delays, cancellations, and skipped stops.",
      "Reported by Jack Miller: station panels no longer stop at the unavailable notice after synthetic boards were removed; Ormond and other mapped stations now use verified current-date services only.",
      "Reported by Jack Miller: tapping a live bus now opens the exact PTV run and its officially published upcoming stop sequence, stop IDs, and expected times.",
      "GitHub Pages now ships an SPA fallback so shared TransitAlert routes open the app instead of GitHub's 404 page.",
      "No generated departures or stops were restored. Missing or sparse official feed values remain clearly unavailable.",
      "Reported by Jack Miller: V/Line corridor alignment and generic regional service classification were corrected so Maryborough-area trains are not shown as Geelong services.",
      "Reported by Jack Miller: synthetic station departures were removed after an incorrect Town Hall service appeared at Armadale.",
      "TransitAlert now shows an unavailable notice instead of generating platform times, delays, service IDs, regional timelines, freight movements, or bus and tram countdowns.",
      "The PID preview is unavailable until a verified departures source is connected.",
      "Temporary account passwords now trigger a mandatory one-time password change before the map, settings, or saved account tools can open.",
      "Real account storage now runs against the embedded database path used by the local host so sign-in, registration, and relaunch persistence work for live tests.",
      "Jack Miller was added as the first built-in debug tester alias set so tester-only account registration is easier to verify end-to-end.",
      "NSW TrainLink regional classification now prefers XPT labelling when the feed is generic, which avoids misreading those services as VLocity or other regional stock.",
      "Mobile login and account surfaces were tightened up with smaller spacing, lighter cards, and less cramped controls on narrow screens.",
      "Admin account notes now describe the real server allowlist instead of older Netlify wording.",
      "Guest guardrails, account messaging, and release board copy remain aligned with the public guest launch.",
    ],
  },
  {
    version: "0.92",
    date: "21/07/2026",
    notes: [
      "Connected station departure boards to verified schedule data and added bus-stop departures.",
      "Bound timetable feed requests so slow upstream responses do not hold up the app.",
    ],
  },
  {
    version: "0.91",
    date: "19/07/2026",
    notes: [
      "Improved real-data accuracy across trains, buses, and trams, including live vehicles on the map and mixed-mode routing.",
      "Removed synthetic live transit data and improved live train tracking on iPhone.",
      "Improved guest access to the live map and fleet board, mobile map layout, and notifications.",
    ],
  },
  {
    version: "0.90",
    date: "19/07/2026",
    notes: [
      "Released a guest version with public live train tracking and fleet information.",
      "Improved account sessions and the public map experience across deployments.",
    ],
  },
  {
    version: "Development update",
    date: "27/06/2026",
    notes: [
      "Improved GitHub Pages and Render deployment workflows, including the app's split deployment setup.",
    ],
  },
  {
    version: "Development update",
    date: "15/06/2026",
    notes: [
      "Refined alert-corridor labels to make transport disruption information clearer.",
    ],
  },
  {
    version: "Development update",
    date: "14/06/2026",
    notes: [
      "Polished map interchanges and fleet views across the app.",
    ],
  },
  {
    version: "Development update",
    date: "12/06/2026",
    notes: [
      "Polished disruption alerts and improved how replacement buses appear on the map.",
    ],
  },
  {
    version: "Development update",
    date: "11/06/2026",
    notes: [
      "Improved V/Line journey labels and journey alerts, and added a clearer fleet board for mobile.",
      "Expanded fleet tracking to cover XPT services and refined fleet filters and station markers.",
      "Expanded the PID Studio for inspecting and refining station departure displays.",
    ],
  },
  {
    version: "Development update",
    date: "03/06/2026",
    notes: [
      "Improved map status messaging and refined shared transport-mode and reporting colours.",
    ],
  },
  {
    version: "Development update",
    date: "20/05/2026",
    notes: [
      "Added a leaner iOS map-rendering mode to help the map run smoothly on mobile devices.",
    ],
  },
  {
    version: "Development update",
    date: "19/05/2026",
    notes: [
      "Added mobile crash diagnostics and prioritised train overlays for clearer, steadier map rendering.",
    ],
  },
  {
    version: "Development update",
    date: "18/05/2026",
    notes: [
      "Clarified the Comeng fleet variants and reduced the station-marker workload on mobile.",
    ],
  },
  {
    version: "Development update",
    date: "16/05/2026",
    notes: [
      "Aligned station markers with the rendered tracks and removed outdated loop overlays from the map.",
    ],
  },
  {
    version: "Development update",
    date: "15/05/2026",
    notes: [
      "Improved mobile map performance and accessibility, including a map legend and lighter station markers on iPhone.",
      "Refined station boards and markers across the Sunbury, Craigieburn, and northern corridors, and improved shared-track geometry through the city and Burnley loops.",
      "Added and refined corridor overlays around Sunshine and V/Line junctions, and improved service abbreviations on public boards.",
    ],
  },
  {
    version: "Development update",
    date: "14/05/2026",
    notes: [
      "Added admin controls for managing tester access during the beta period.",
    ],
  },
  {
    version: "Development update",
    date: "13/05/2026",
    notes: [
      "Strengthened account security and clarified TransitAlert's independent branding.",
      "Improved the mobile map, account handling, and database support for the Render deployment.",
      "Made city-loop map markers easier to select on touch screens.",
    ],
  },
  {
    version: "V0.88",
    date: "12/05/2026",
    notes: [
      "Original app and fleet artwork replaced older source-derived visuals so TransitAlert reads clearly as an independent project.",
      "Privacy and account security were tightened with safer auth responses, request throttling, and stronger backend-only secret handling.",
      "Responsible transport-data handling guidance was added so release decisions stay aligned with safer operational-data presentation before public launch.",
    ],
  },
  {
    version: "V0.87",
    date: "10/05/2026",
    notes: [
      "Glen Waverley debug overlays, Burnley loop rendering, and admin-side map debug tools were expanded.",
      "Fleet display rules were tightened so invalid train types stop showing on the wrong lines.",
      "Render deployment support was stabilised for the app’s post-Netlify hosting move.",
    ],
  },
  {
    version: "V0.86",
    date: "09/05/2026",
    notes: [
      "Surface route visuals, alert grouping, and line overlays were refined across the shared map renderer.",
      "Freight corridors and interstate overlays were improved as part of the broader network visual pass.",
    ],
  },
  {
    version: "V0.85",
    date: "08/05/2026",
    notes: [
      "First-open update boards and station boarding guides were added for key interchanges.",
      "Journey planning became more persistent and stable once a journey has started.",
      "Guest and login flows were tightened so people could get back to real auth from inside the app.",
    ],
  },
  {
    version: "V0.84",
    date: "07/05/2026",
    notes: [
      "Surface route filters for trams and buses were expanded and made easier to toggle from the map.",
      "Live tram colours and route styling were aligned more closely with route palettes.",
    ],
  },
  {
    version: "V0.83",
    date: "06/05/2026",
    notes: [
      "Live tram and bus tracking gained stronger map integration, popups, and stop-linked panels.",
      "More tram routes and stops were added so the surface network felt much more complete.",
    ],
  },
  {
    version: "V0.82",
    date: "05/05/2026",
    notes: [
      "Premium features, freight overlays, and admin-side controls were expanded during the major map feature push.",
      "Performance and UI stability improvements landed across the planner and interactive map layers.",
    ],
  },
  {
    version: "V0.81",
    date: "04/05/2026",
    notes: [
      "Auth, settings, and account preference saving were refined before the Render and database-first migration work.",
      "Planner and station detail interactions were improved for day-to-day testing.",
    ],
  },
  {
    version: "V0.80",
    date: "03/05/2026",
    notes: [
      "The shared app version system was formalised and exposed more clearly through the app UI.",
      "More route data, admin tooling, and early premium wiring landed in the lead-up to the later 0.8x releases.",
    ],
  },
  {
    version: "V0.70",
    date: "02/05/2026",
    notes: [
      "V/Line live tracking landed with Gippsland service detail support and better Southern Cross departure boards.",
      "Settings, preferences, and surface route layers were refined across the app.",
      "Regional route shaping and live service presentation improved for newer map overlays.",
    ],
  },
  {
    version: "V0.68",
    date: "29/04/2026",
    notes: [
      "Raw feed IDs were stripped out of live transit labels to clean up user-facing data.",
    ],
  },
  {
    version: "Development update",
    date: "25/04/2026",
    notes: [
      "Refactored the app's transit-data flow and interface to make core map and service features easier to maintain.",
    ],
  },
  {
    version: "Development update",
    date: "22/04/2026",
    notes: [
      "Refined the map interface and simplified account roles, with several stability fixes to the app's update and rendering flows.",
    ],
  },
  {
    version: "Development update",
    date: "20/04/2026",
    notes: [
      "Added station platform departure previews and improved the station detail panel alongside the journey planner.",
      "Built out live metro train tracking, map interactions, transport-mode filters, and editable map markers.",
      "Improved the mobile map layout and touch controls for navigating and dragging the map.",
    ],
  },
  {
    version: "Development update",
    date: "19/04/2026",
    notes: [
      "Brought together the mobile journey planner, account access, live tracking, service alerts, and transport filters.",
    ],
  },
  {
    version: "Development update",
    date: "14/04/2026",
    notes: [
      "Worked on initial train-route configuration and early app deployment setup.",
    ],
  },
  {
    version: "Development update",
    date: "13/04/2026",
    notes: [
      "TransitAlert development began with the initial app structure and project setup.",
    ],
  },
  {
    version: "V0.67",
    date: "21/06/2025",
    notes: [
      "Searching by station code now picks the station directly.",
      "Examples like THL now resolve to Town Hall instead of unrelated matches.",
    ],
  },
  {
    version: "V0.66",
    date: "15/06/2025",
    notes: [
      "Major departures template refresh.",
      "Fleet page received bigger visual upgrades.",
      "General backend and UI cleanups rolled into the same release.",
    ],
  },
];

const TRANSITALERT_SYSTEM_NOTES = [
  "Copyright 2026 Tyler Rose. TransitAlert, its app presentation, and original project assets are Tyler Rose work.",
  "Independent real-time transport platform pulling together public feeds, operator data where available, and app-side logic.",
  "Data can be delayed, incomplete, or unavailable, so the app should never be treated as an official operator source.",
  "Usage, diagnostics, and stability logging may be collected to improve reliability, performance, and safety of the system.",
];

const VERSION_HIGHLIGHT_CARDS = [
  {
    title: "Fixed the wrong-vehicle bug",
    body: "Tapping a departure now matches PTV's real run ID instead of guessing the nearest same-route vehicle, and multi-route bus bays finally show their live buses.",
  },
  {
    title: "Real train track fixed",
    body: "The Belgrave/Lilydale/Alamein lines no longer cut a straight diagonal line through Richmond/Burnley — they follow the real curve, and 5 Sandringham stations are now correctly placed.",
  },
  {
    title: "V/Line by corridor, faster preferences",
    body: "V/Line notifications are now 5 real corridors (Bairnsdale, Geelong, Ballarat, Bendigo, Seymour) instead of one toggle, and preference changes only save when you hit Apply.",
  },
] as const;

const PLANNER_LINES = [
  { name: "Frankston", stations: LINES.frankston },
  { name: "Cranbourne", stations: LINES.cranbourne },
  {
    name: "Pakenham",
    // Metro Tunnel services run directly between Anzac and Caulfield. The
    // legacy surface corridor stations are not valid Pakenham stopping points.
    stations: LINES.pakenham.filter(
      (station) => !["Hawksburn", "Toorak", "Armadale", "Malvern"].includes(station.name),
    ),
  },
  { name: "Sunbury", stations: LINES.sunbury },
  { name: "Metro Tunnel", stations: LINES.metroTunnel },
  { name: "Sandringham", stations: LINES.sandringham },
  { name: "Mernda", stations: LINES.mernda },
  { name: "Hurstbridge", stations: LINES.hurstbridge },
  { name: "Craigieburn", stations: LINES.craigieburn },
  { name: "Upfield", stations: LINES.upfield },
  { name: "Belgrave", stations: LINES.belgrave },
  { name: "Lilydale", stations: LINES.lilydale },
  { name: "Glen Waverley", stations: LINES.glenWaverley },
  { name: "Alamein", stations: LINES.alamein },
  { name: "Werribee", stations: LINES.werribee },
  { name: "Williamstown", stations: LINES.williamstown },
] as const;

const JOURNEY_DISRUPTION_TERMS = ["Delays", "Track work", "Service changes", "Incidents"] as const;

function getJourneyCorridorLabels(route: Station[]) {
  const routeNames = new Set(route.map((station) => station.name));
  return PLANNER_LINES
    .filter((line) => line.stations.filter((station) => routeNames.has(station.name)).length >= 2)
    .map((line) => line.name);
}

const STATUS_STYLES: Record<FleetTripStatus, string> = {
  running: "bg-emerald-500/15 text-emerald-300",
  upcoming: "bg-slate-500/15 text-slate-300",
};

const STATUS_LABELS: Record<FleetTripStatus, string> = {
  running: "Running",
  upcoming: "Recent",
};

function getFleetLineTone(line: string) {
  const joined = line.toLowerCase();
  if (/(sunbury|cranbourne|pakenham|metro tunnel)/i.test(joined)) return "bg-sky-500 text-sky-950";
  if (/(mernda|hurstbridge)/i.test(joined)) return "bg-red-600 text-white";
  if (/stony point/i.test(joined)) return "bg-[#028430] text-white";
  if (/frankston/i.test(joined)) return "bg-green-600 text-white";
  if (/(werribee|williamstown|sandringham|altona)/i.test(joined)) return "bg-pink-500 text-white";
  if (/(upfield|craigieburn)/i.test(joined)) return "bg-yellow-400 text-yellow-950";
  if (/(belgrave|lilydale|glen waverley|alamein)/i.test(joined)) return "bg-blue-600 text-white";
  // Matches the same real V/Line purple (#7c3aed) already used for its
  // route lines/markers on the live map — this badge previously fell
  // through to the generic grey default since "V/Line" and its regional
  // corridor names (Seymour, Bendigo, Gippsland, ...) matched none of the
  // metro-line patterns above.
  if (/(v\/?line|traralgon|bairnsdale|ballarat|wendouree|bendigo|echuca|geelong|waurn ponds|seymour|shepparton|warrnambool|maryborough|ararat|swan hill|albury)/i.test(joined)) {
    return "bg-violet-600 text-white";
  }
  return "bg-slate-500 text-white";
}

function getRegionalFleetKey(vehicle: LiveTrain): FleetTypeKey {
  const family = getRegionalFleetTrainFamily(vehicle).toLowerCase();
  const joined = `${vehicle.consist} ${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toLowerCase();
  if (/mariyung|d\s*set|\bd-set\b/.test(joined)) return "mariyung";
  if (/\bv\s*set\b|\bv-set\b/.test(joined)) return "v-set";
  if (/endeavour/.test(joined)) return "endeavour";
  if (/\bhunter\b/.test(joined)) return "hunter";
  if (/xplorer/.test(joined)) return "xplorer";
  if (family.includes("xpt") || /xpt|nsw trainlink/.test(joined)) return "xpt";
  if (family.includes("sprinter") || SPRINTER_CONSIST_PATTERN.test(joined) || STONY_POINT_LINE_PATTERN.test(joined) || /sprinter/.test(joined)) return "sprinter";
  // Bairnsdale/Albury/Swan Hill are DESTINATIONS, not train types — both
  // N class locomotive-hauled sets and VLocity railcars run all three real
  // routes, so matching on the town name alone wrongly classified every
  // VLocity service to those towns (real consist "V2117"/"V1296"/"V1299",
  // confirmed live) as N Class before the VLocity check below ever ran.
  if (family.includes("n class") || N_CLASS_CONSIST_PATTERN.test(joined) || /n\s*class|n-?set|\bloco\b|locomotive/.test(joined)) return "n-class";
  if (family.includes("vlocity") || /\bv\d{3,4}\b/.test(joined)) return getVlocityGaugeFleetKey(vehicle);
  return getVlocityGaugeFleetKey(vehicle);
}

// V/Line's network is broad gauge (1600mm) throughout except the Albury
// line, converted to standard gauge (1435mm) in 1962 for through running to
// Sydney — a small, dedicated sub-fleet of VLocity sets runs standard gauge
// on that line specifically, the rest of the VLocity fleet is broad gauge.
// Destination text can't identify this: an inbound Albury working reports
// the same generic "Southern Cross" text every other inbound V/Line service
// does (confirmed live: TDN 8620, consist V1195, destination "Southern
// Cross" — no mention of Albury anywhere in the text fields). The route
// code "ABY" in tripId survives regardless of direction (confirmed
// live/static: real trip_id "01-ABY--2-T0-8620", real route_id
// "aus:vic:vic-01-ABY:" = "Albury - Melbourne Via Seymour").
function getVlocityGaugeFleetKey(vehicle: LiveTrain): FleetTypeKey {
  return /-ABY--/i.test(vehicle.tripId ?? "") ? "vlocity-standard-gauge" : "vlocity";
}

// Real Melbourne suburban carriage number ranges (source: vicsig.net/suburban/fleet):
// Comeng motor 324M-680M / trailer 1008T-1190T, Siemens motor 701M-843M /
// trailer 2501T-2572T, X'Trapolis motor 1M-288M & 851M-985M / trailer
// 1301T-1444T & 1626T-1693T, the sole X'Trapolis 2.0 set 8105-8605, HCMT
// 9001-9070. These fleets are NOT rostered one-per-line — Comeng in
// particular "can run system wide" per that roster — so classification reads
// the vehicle's own car numbers instead of guessing from which line it
// happens to be on right now.
//
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

// The plain "Comeng" (unsplit) fleet category was removed once VICSIG's
// current fleet list (see ALSTOM/EDI sets above) confirmed every real
// in-service Comeng motor number is one or the other — verified live against
// the full running fleet with zero leftovers. If a future renumbering or
// refurbishment ever introduces a genuinely unlisted number, this needs the
// sets refreshed from VICSIG again rather than reviving a generic bucket.
function classifyComengMotorNumbers(motorNumbers: number[]): "alstom-comeng" | "edi-comeng" {
  return motorNumbers.some((n) => EDI_COMENG_MOTOR_NUMBERS.has(n)) ? "edi-comeng" : "alstom-comeng";
}

function inferFleetTypeKeyFromConsist(vehicle: LiveTrain): FleetTypeKey | null {
  // X'Trapolis 2.0 and HCMT car/set numbers can appear as a bare number with
  // no M/T letter at all, unlike Comeng/Siemens/X'Trapolis 100 which always
  // carry the suffix — matching the suffix as optional covers both without
  // missing either real-world format.
  const motorNumbers = Array.from(vehicle.consist.matchAll(/(\d+)[MT]?\b/gi)).map((match) => Number(match[1]));
  if (motorNumbers.some((n) => n >= 9000 && n <= 9999)) return "hcmt";
  if (motorNumbers.some((n) => n >= 8100 && n <= 8699)) return "xtrapolis2";
  if (motorNumbers.some((n) => (n >= 1 && n <= 288) || (n >= 851 && n <= 985))) return "xtrapolis";
  if (motorNumbers.some((n) => n >= 701 && n <= 843)) return "siemens";
  if (motorNumbers.some((n) => n >= 324 && n <= 680)) return classifyComengMotorNumbers(motorNumbers);
  return null;
}

function inferFleetTypeKey(vehicle: LiveTrain): FleetTypeKey {
  if (isVlineLiveTrain(vehicle)) return getRegionalFleetKey(vehicle);

  const searchable = `${vehicle.consist} ${vehicle.trainType} ${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toLowerCase();
  if (/metropolis|sydney metro|metro north west/.test(searchable)) return "metropolis";
  // Sydney Trains' real per-trip fleet class (e.g. "8 car Waratah", "8 car
  // Waratah Series 2", "4 car Tangara") comes straight from Transport for
  // NSW's own static schedule now (see buildSydneyTrainsLiveTrains /
  // loadSydneyTrainsFleetLookup) — sourced, not guessed. "Waratah" alone
  // (no "Series 2") is the original A-set batch; only the Series 2 batch
  // spells out "Series 2", so that check has to come first or every
  // Waratah would match the A-set pattern.
  if (/waratah.*series\s*2|waratah\s*b\b/.test(searchable)) return "waratah-b";
  if (/waratah/.test(searchable)) return "waratah-a";
  if (/tangara|\bt\s*set\b|\bt-set\b/.test(searchable)) return "tangara";
  if (/millennium|\bm\s*set\b|\bm-set\b/.test(searchable)) return "millennium";
  if (/\bk\s*set\b|\bk-set\b/.test(searchable)) return "k-set";
  if (/oscar|\bh\s*set\b|\bh-set\b/.test(searchable)) return "oscar";
  if (/(hcmt)/i.test(searchable)) return "hcmt";
  if (/(x'?trapolis\s*2(\.0)?)/i.test(searchable)) return "xtrapolis2";
  if (/(x'?trapolis)/i.test(searchable)) return "xtrapolis";
  if (/(siemens)/i.test(searchable)) return "siemens";
  if (/(comeng)/i.test(searchable)) {
    const motorNumbers = Array.from(vehicle.consist.matchAll(/(\d+)M\b/gi)).map((match) => Number(match[1]));
    return classifyComengMotorNumbers(motorNumbers);
  }
  // Checked after every specific real-class keyword above, and before the
  // Melbourne-only fallback further down (which used to silently claim
  // every unrecognised train as X'Trapolis 100) — a real Sydney Trains
  // vehicle whose fleet class wasn't resolved (schedule lookup miss, or a
  // genuinely new/rare category not in the list above) otherwise fell all
  // the way through to that and got mislabelled as Melbourne rolling stock.
  if (isSydneyTrainsLiveTrain(vehicle)) return "sydney-trains-unclassified";
  return inferFleetTypeKeyFromConsist(vehicle) ?? "xtrapolis";
}

function getHcmtSetLabel(vehicle: LiveTrain) {
  const joined = `${vehicle.consist} ${vehicle.tdn} ${vehicle.trainType}`.toUpperCase();
  const match = joined.match(/\b9[09](\d{2})M\b/);
  return match?.[1] ? `HCMT Set ${match[1]}` : "HCMT Set";
}

// X'Trapolis 2.0's raw consist string lists every car in the 6-car unit
// (e.g. "8105-8205-8305-8405-8505-8605") rather than a single set id —
// showing that whole string is the "long car number consist" that's harder
// to read than the real set number the operator uses. Each physical set N
// is cars 8100+N, 8200+N, ..., 8600+N (mirrors getXtrapolis2SetNumber in
// api/_lib/fleet-tracking.js), so any one car number maps back to it.
function getXtrapolis2SetLabel(vehicle: LiveTrain) {
  const carNumbers = Array.from(vehicle.consist.matchAll(/(\d+)[MT]?\b/gi)).map((match) => Number(match[1]));
  const units = new Set<number>();
  for (const n of carNumbers) {
    const hundreds = Math.floor(n / 100);
    const unit = n % 100;
    if (hundreds >= 81 && hundreds <= 86 && unit >= 1 && unit <= 50) units.add(unit);
  }
  if (units.size === 0) return vehicle.consist || vehicle.tdn || "Set TBC";
  return `XT2 Set ${Array.from(units)
    .map((u) => String(u).padStart(2, "0"))
    .join(" + ")}`;
}

function getFleetSetDisplay(vehicle: LiveTrain, fleet: FleetTypeKey) {
  if (fleet === "hcmt") return getHcmtSetLabel(vehicle);
  if (fleet === "xtrapolis2") return getXtrapolis2SetLabel(vehicle);
  if (fleet === "n-class" || fleet === "sprinter") {
    // Real reporting mark (e.g. "N453") when the live feed has one — the
    // fleet name is already shown right next to this and repeating it here
    // tells a rider nothing new. Stony Point's own placeholder consist is
    // literally the word "train" glued to its trip-derived number (e.g.
    // "train68340") rather than a real reporting mark — strip that prefix
    // so it doesn't read as if "train" were part of the identifier.
    const consist = vehicle.consist?.trim().replace(/^train(?=\d)/i, "");
    return consist && !/^unknown$/i.test(consist)
      ? consist
      : `${getRegionalFleetCarLength(vehicle)} ${getRegionalFleetTrainFamily(vehicle)}`;
  }
  if (fleet === "vlocity" || fleet === "vlocity-standard-gauge" || fleet === "xpt") {
    return `${getRegionalFleetCarLength(vehicle)} ${getRegionalFleetTrainFamily(vehicle)}`;
  }
  return vehicle.consist || vehicle.tdn || "Set TBC";
}

function buildFleetRoute(vehicle: LiveTrain) {
  const cleaned = vehicle.serviceDescription?.trim();
  if (cleaned && !isGenericRegionalPlaceholder(cleaned)) return cleaned;
  // A real V/Line service (Sprinter included) reports line/destination/
  // serviceDescription as the same generic literal "V/Line" — confirmed
  // live on the Seymour Sprinter (TDN 8326). Resolve the real corridor from
  // the trip's own route code before falling back to that placeholder text.
  if (isVlineLiveTrain(vehicle) && (isGenericRegionalPlaceholder(vehicle.line) || isGenericRegionalPlaceholder(vehicle.destination))) {
    const cityBound = vehicle.direction === "up" || vehicle.direction === "city-bound" ||
      /southern cross|flinders street|melbourne central|flagstaff|parliament|city/i.test(vehicle.destination);
    const meta = getVlineRouteMetaFromTripId(vehicle.tripId, cityBound);
    if (meta) return `${meta.origin} → ${meta.destination}`;
  }
  return `${vehicle.line} to ${vehicle.destination}`;
}

function formatFleetUpdatedAt(timestamp?: string) {
  if (!timestamp) return "Live now";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "Live now";
  return `Seen ${parsed.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

function formatServiceClock(timestamp?: string) {
  if (!timestamp) return "Live";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "Live";
  return parsed.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const PUBLIC_SERVICE_CODE_MAP: Array<[string, string]> = [
  ["flinders street", "FSS"],
  ["flinders st", "FSS"],
  ["flinders", "FSS"],
  ["southern cross", "SCS"],
  ["town hall", "THL"],
  ["state library", "STL"],
  ["parliament", "PAR"],
  ["melbourne central", "MCE"],
  ["flagstaff", "FGS"],
  ["glen waverley", "GWY"],
  ["lilydale", "LIL"],
  ["belgrave", "BEL"],
  ["alamein", "ALA"],
  ["mernda", "MER"],
  ["hurstbridge", "HBE"],
  ["sunbury", "SUN"],
  ["cranbourne", "CRA"],
  ["pakenham", "PAK"],
  ["frankston", "FKN"],
  ["sandringham", "SDM"],
  ["werribee", "WER"],
  ["williamstown", "WIL"],
  ["upfield", "UPF"],
  ["craigieburn", "CBN"],
  ["ballarat", "BAL"],
  ["bendigo", "BEN"],
  ["geelong", "GEL"],
  ["traralgon", "TRA"],
  ["bairnsdale", "BAI"],
];

function getPublicServiceCode(...values: string[]) {
  const joined = values.join(" ").toLowerCase();
  const matched = PUBLIC_SERVICE_CODE_MAP.find(([needle]) => joined.includes(needle));
  if (matched) return matched[1];

  const words = values
    .join(" ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);

  const fallback = words.map((word) => word[0]?.toUpperCase() ?? "").join("");
  return fallback || "SRV";
}

function getPublicFleetServiceLabel(trip: FleetTrip) {
  return trip.realtimeLabel || `${formatServiceClock(trip.updatedAt)} ${getPublicServiceCode(trip.route, trip.line)} Service`;
}

function getRegionalFleetRouteLabel(vehicle: LiveTrain) {
  const joined = `${vehicle.line} ${vehicle.destination} ${vehicle.serviceDescription ?? ""}`.toLowerCase();
  if (/(waurn ponds|geelong|warrnambool)/.test(joined)) return "Geelong";
  if (/(ballarat|wendouree|ararat|maryborough)/.test(joined)) return "Ballarat";
  if (/(bendigo|castlemaine|echuca|swan hill)/.test(joined)) return "Bendigo";
  if (/(seymour|shepparton|albury|wallan|broadford|tallarook)/.test(joined)) return "Seymour";
  if (/(traralgon|bairnsdale|sale|morwell|moe)/.test(joined)) return "Gippsland";
  if (/(xpt|nsw trainlink|sydney)/.test(joined)) return "XPT";
  return vehicle.line.replace(/\s+line$/i, "").replace(/^V\/Line$/i, "Regional");
}

// Real V/Line N-class locomotives report their live position under their
// plain reporting mark ("N453", "N460", ...) — the literal words "N class"
// never appear anywhere in the live feed (consist/trainType/line/destination
// are all generic, e.g. destination is literally "V/Line"), so the
// word-matching checks below always missed genuine live N-class trips and
// let them fall through to the VLocity default. N451-N474 is the real fleet
// (VICSIG), matched here by the shared reporting-mark pattern rather than a
// hardcoded number range so a fleet renumbering doesn't silently break this.
const N_CLASS_CONSIST_PATTERN = /\bN\d{3}\b/i;
// Same real-feed gap as N class: a live Sprinter's own reporting mark is
// "S70xx" (confirmed live: TDN 8326 = consist "S7002", with destination/
// line/serviceDescription all the same generic "V/Line" placeholder as
// everything else) — the literal word "Sprinter" never appears anywhere in
// the live feed, so the word-matching checks below always missed real
// Sprinter trips and let them fall through to the VLocity default.
const SPRINTER_CONSIST_PATTERN = /\bS70\d{2}\b/i;
// The Stony Point line is a further, separate gap: it is the one PTV
// metropolitan line worked exclusively by Sprinter railcars (no other
// fleet type ever runs there), but its live feed entries carry neither the
// word "Sprinter" nor a real S70xx reporting mark — just a generic
// placeholder like "train68340" (confirmed live: TDN 8508, line "Stony
// Point", consist "train68340"). Classifying by line identity here isn't a
// guess: it's the one line where the operator's rostered rolling stock
// really is always this one fleet.
const STONY_POINT_LINE_PATTERN = /stony point/i;
// The inbound (Stony Point -> Frankston) direction's real trip_headsign is
// "Frankston" — line/destination/serviceDescription can all come back
// "Frankston" with no text mentioning Stony Point at all for that direction.
// The real route code "STY" survives in tripId regardless (confirmed static
// schedule format: "02-STY--1-T5-8518"), so check that too rather than
// relying solely on direction-dependent display text.
function isStonyPointVehicle(vehicle: LiveTrain) {
  return STONY_POINT_LINE_PATTERN.test(`${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination}`)
    || /-STY--/i.test(vehicle.tripId ?? "");
}

function getRegionalFleetTrainFamily(vehicle: LiveTrain) {
  const joined = `${vehicle.consist} ${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination}`.toUpperCase();
  if (/XPT/.test(joined)) return "XPT";
  if (/XPLORER/.test(joined)) return "Xplorer";
  if (/NSW TRAINLINK/.test(joined)) return "XPT";
  if (/SPRINTER/.test(joined) || SPRINTER_CONSIST_PATTERN.test(joined) || isStonyPointVehicle(vehicle)) return "Sprinter";
  if (/N\s*CLASS|N-?SET|LOCOMOTIVE|LOCO/.test(joined) || N_CLASS_CONSIST_PATTERN.test(joined)) return "N class";
  if (/VLOCITY|\bV\d{3,4}\b/.test(joined)) return "VLocity";
  return "Other locomotive";
}

function getRegionalFleetCarLength(vehicle: LiveTrain) {
  const allocation = getCurrentVlineAllocation(vehicle);
  if (allocation) return `${allocation.carCount}-car`;
  if (vehicle.tripId?.startsWith("01-") || /VLOCITY|V\/LINE/i.test(`${vehicle.trainType} ${vehicle.line}`)) return "";
  const joined = `${vehicle.consist} ${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination}`.toUpperCase();
  const explicitCarMatch = joined.match(/\b(3|4|5|6|7|8|9)\s*[- ]?CAR\b/);
  if (explicitCarMatch?.[1]) return `${explicitCarMatch[1]}-car`;
  if (/N\s*CLASS|N-?SET|LOCOMOTIVE|LOCO/.test(joined) || N_CLASS_CONSIST_PATTERN.test(joined)) return "loco set";
  if (/XPT|XPLORER|SPRINTER/.test(joined) || SPRINTER_CONSIST_PATTERN.test(joined) || isStonyPointVehicle(vehicle)) return "special";
  return "set TBC";
}

// Mirrors getNswTrainLinkSetNumber/getRegionalAllocatedSetLabel in Map.tsx —
// NSW TrainLink has no tracked consist/set number, so its own trip number
// (already visible in its label, e.g. "(731)") stands in for one; V/Line's
// own loco-hauled specials use the real allocation/leadingSet data when known.
function getRegionalFleetSpecialLabel(vehicle: LiveTrain) {
  const joined = `${vehicle.consist} ${vehicle.trainType} ${vehicle.tdn} ${vehicle.line} ${vehicle.destination}`.toUpperCase();
  if (/XPLORER/.test(joined)) return `Xplorer leading set ${vehicle.tripId?.split(".")[0] || vehicle.tdn}`;
  if (/XPT|NSW TRAINLINK/.test(joined)) return `XPT leading set ${vehicle.tripId?.split(".")[0] || vehicle.tdn}`;
  if (/SPRINTER|N\s*CLASS|N-?SET|LOCOMOTIVE|LOCO/.test(joined) || N_CLASS_CONSIST_PATTERN.test(joined) || SPRINTER_CONSIST_PATTERN.test(joined)) {
    const allocation = getCurrentVlineAllocation(vehicle);
    return `V/Line leading set ${allocation?.setIds.join(" + ") || vehicle.leadingSet?.setId || vehicle.consist.trim() || vehicle.tdn}`;
  }
  if (!/VLOCITY|\bV\d{3,4}\b/.test(joined) && isVlineLiveTrain(vehicle)) {
    const allocation = getCurrentVlineAllocation(vehicle);
    return `V/Line leading set ${allocation?.setIds.join(" + ") || vehicle.leadingSet?.setId || vehicle.consist.trim() || vehicle.tdn}`;
  }
  return "";
}

function getFleetRealtimeLabel(vehicle: LiveTrain) {
  if (!isVlineLiveTrain(vehicle)) {
    return `${formatServiceClock(vehicle.timestamp)} ${getPublicServiceCode(buildFleetRoute(vehicle), vehicle.line)} Service`;
  }

  return [formatServiceClock(vehicle.timestamp), getRegionalFleetRouteLabel(vehicle), getRegionalFleetCarLength(vehicle), getRegionalFleetTrainFamily(vehicle)].filter(Boolean).join(" · ");
}

function buildFleetTripsFromLive(vehicles: LiveTrain[]): FleetTrip[] {
  return vehicles.map((vehicle, index) => {
    const fleet = inferFleetTypeKey(vehicle);
    return {
      id: `${vehicle.consist}-${vehicle.tdn}-${index}`,
      focusKey: getVehicleFocusKey(vehicle),
      tdn: vehicle.tdn.startsWith("TDN") ? vehicle.tdn : `TDN ${vehicle.tdn}`,
      tripNumber: vehicle.tdn.replace(/^TDN\s*/i, "").trim(),
      line: vehicle.line,
      route: buildFleetRoute(vehicle),
      fleet,
      status: vehicle.timestamp ? "running" : "upcoming",
      lineColor: getFleetLineTone(vehicle.line),
      statusLabel: formatFleetUpdatedAt(vehicle.timestamp),
      updatedAt: vehicle.timestamp ?? "",
      consist: vehicle.consist,
      setNumber: getFleetSetDisplay(vehicle, fleet),
      realtimeLabel: getFleetRealtimeLabel(vehicle),
      consistPublicLabel: isVlineLiveTrain(vehicle) ? `${getRegionalFleetCarLength(vehicle)} ${getRegionalFleetTrainFamily(vehicle)}` : getFleetSetDisplay(vehicle, fleet),
      specialLabel: isVlineLiveTrain(vehicle) ? getRegionalFleetSpecialLabel(vehicle) : "",
    };
  });
}

// Real chassis manufacturer + model (Volvo B8RLE, Scania K320UB, BYD D9RA,
// ...) from the bus fleet database, for DISPLAY only — never guessed from
// body style, since a Volgren Optimus body sits on diesel, hybrid and
// electric chassis alike. Falls back to "Unidentified model" for a bus
// whose registration/fleet number isn't in the database. Bus grouping
// itself is by operator (see busFilterGroup) — this is shown as a subtitle
// on each row so the real vehicle model is still visible per-bus.
function getBusChassisLabel(vehicle: LiveBus) {
  const info = lookupBusFleetInfo(vehicle);
  if (!info) return "Unidentified model";
  const model = info.chassisModel.replace(/\s+-\s+(Cat|Cummins|Volvo|Detroit|MAN|Scania)$/i, "");
  return `${info.chassisManufacturer} ${model}`.trim();
}

function buildBusFleetTrips(vehicles: LiveBus[], region: "vic" | "nsw" = "vic"): FleetTrip[] {
  return vehicles.map((vehicle, index) => {
    const identity = vehicle.fleetNumber ?? vehicle.registration ?? vehicle.vehicleId ?? "";
    const operator = vehicle.operator ?? (region === "nsw" ? "Sydney bus network" : "PTV contracted bus service");
    return {
      id: `bus-${region}-${vehicle.id}-${index}`,
      focusKey: `bus:${vehicle.tripId ?? vehicle.id}`,
      tdn: identity ? `Bus ${identity}` : `Route ${vehicle.route}`,
      tripNumber: vehicle.route,
      line: operator,
      route: vehicle.destination ? `To ${vehicle.destination}` : `Route ${vehicle.route}`,
      // Region-prefixed so a Victorian and NSW operator never collide under
      // the same filter key — see busFilterGroups below, which splits these
      // into separate "Victoria Buses" / "NSW Buses" sections.
      fleet: `bus:${region}-${slugifyFleetLabel(operator)}` as BusTypeFleetKey,
      status: vehicle.timestamp ? "running" : "upcoming",
      lineColor: "border border-orange-400/25 bg-orange-500/10 text-orange-200",
      statusLabel: formatFleetUpdatedAt(vehicle.timestamp),
      updatedAt: vehicle.timestamp ?? "",
      consist: vehicle.registration ?? "",
      setNumber: identity,
      realtimeLabel: "",
      consistPublicLabel: "",
      specialLabel: "",
      vehicleModel: region === "nsw" ? undefined : getBusChassisLabel(vehicle),
    };
  });
}

function buildTramFleetTrips(vehicles: LiveTram[], region: "vic" | "nsw" = "vic"): FleetTrip[] {
  return vehicles.map((vehicle, index) => {
    const operator = vehicle.operator ?? (region === "nsw" ? "Sydney Light Rail" : "Yarra Trams");
    // NSW light rail has no "class" concept the way Melbourne's tram fleet
    // does (B2, E, A2, ...) — its own two real operators (CBD & South East /
    // Newcastle) are the meaningful grouping there instead, so group by
    // operator rather than by vehicle.label for that region.
    const groupLabel = region === "nsw" ? operator : vehicle.label || "unknown";
    return {
      id: `tram-${region}-${vehicle.id}-${index}`,
      focusKey: `tram:${vehicle.tripId ?? vehicle.id}`,
      tdn: vehicle.fleetNumber ? `Tram ${vehicle.fleetNumber}` : `Route ${vehicle.route}`,
      tripNumber: vehicle.route,
      line: operator,
      route: vehicle.destination ? `To ${vehicle.destination}` : `Route ${vehicle.route}`,
      fleet: `tram:${region}-${slugifyFleetLabel(groupLabel)}` as TramClassFleetKey,
      status: vehicle.timestamp ? "running" : "upcoming",
      lineColor: "border border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
      statusLabel: formatFleetUpdatedAt(vehicle.timestamp),
      updatedAt: vehicle.timestamp ?? "",
      consist: "",
      setNumber: vehicle.fleetNumber ?? "",
      realtimeLabel: "",
      consistPublicLabel: "",
      specialLabel: "",
      // Shown as a small "Operated by ..." line above the fleet name, the
      // same way Google Transit shows "Operated by Sydney Trains" above a
      // vehicle's consist — Victorian trams are all Yarra Trams-operated in
      // reality, but that fact was previously buried in the Line badge only.
      vehicleModel: `Operated by ${operator}`,
    };
  });
}

function getFleetTripSortScore(trip: FleetTrip) {
  const seen = trip.updatedAt ? new Date(trip.updatedAt).getTime() : 0;
  const recencyScore = Number.isFinite(seen) ? seen : 0;
  const activeBonus = trip.status === "running" ? 10_000_000_000_000 : 0;
  const regionalBonus = trip.fleet === "xpt" || trip.fleet === "vlocity" || trip.fleet === "vlocity-standard-gauge" || trip.fleet === "n-class" || trip.fleet === "sprinter" ? 5_000 : 0;
  return activeBonus + recencyScore + regionalBonus;
}

function sortFleetTripsForOperationsBoard(trips: FleetTrip[]) {
  return [...trips].sort((left, right) => getFleetTripSortScore(right) - getFleetTripSortScore(left));
}

function addMinutesToTime(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

function formatPlannerTimeWindow(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `${formatter.format(start)}-${formatter.format(end)}`;
}

function formatPlannerDate(date: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatPlannerDuration(totalMinutes: number) {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

// Train legs use the real line's own colour (the same lookup the map uses),
// since "Frankston line" and "Sandringham line" are visually distinct
// everywhere else in the app — a single flat blue for every train leg here
// was the odd one out. Tram and bus stay their established mode colours.
function getJourneyLegAccentColor(leg: JourneyLeg): string {
  switch (leg.mode) {
    case "train":
      return getLiveLineColor(leg.title);
    case "tram":
      return "#34d399";
    case "bus":
      return "#FF8200";
    default:
      return "#94a3b8";
  }
}

function formatRelativeMinutes(targetIso: string): string {
  const diffMs = new Date(targetIso).getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes <= 0) return "due now";
  if (diffMinutes === 1) return "in 1 min";
  if (diffMinutes < 60) return `in ${diffMinutes} mins`;
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
}

// Bus/tram departures (SurfaceStopDeparturesPayload) never carry a
// delaySeconds field — only VerifiedDeparture (trains) does — so deriving
// delay from the real scheduledAt vs expectedAt gap works for both instead
// of silently reporting every bus/tram as "On time" regardless of its real
// live delay (confirmed live: a real Route 626 running 4 minutes late per
// PTV's own data was shown here as "On time").
function getDepartureDelayLabel(departure: { status: string; scheduledAt: string; expectedAt: string }): string {
  if (departure.status === "cancelled") return "Cancelled";
  const delayMinutes = Math.round((new Date(departure.expectedAt).getTime() - new Date(departure.scheduledAt).getTime()) / 60000);
  return delayMinutes > 1 ? `${delayMinutes} min late` : "On time";
}

function journeyLegsOrigin(display: JourneyDisplay) {
  return display.legs[0]?.from ?? "Unknown";
}

function journeyLegsDestination(display: JourneyDisplay) {
  return display.legs[display.legs.length - 1]?.to ?? "Unknown";
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function areBooleanMapsEqual(
  left: Record<string, boolean>,
  right: Record<string, boolean>,
) {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));

  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(([key, value], index) => {
    const [otherKey, otherValue] = rightEntries[index] ?? [];
    return key === otherKey && value === otherValue;
  });
}

function arePreferencePatchesEqual(current: UserPreferences, next: UserPreferences) {
  return (
    areStringArraysEqual(current.favouriteStops, next.favouriteStops) &&
    areStringArraysEqual(current.favouriteRoutes, next.favouriteRoutes) &&
    areStringArraysEqual(current.transportModes, next.transportModes) &&
    areBooleanMapsEqual(current.selectedMapFilters, next.selectedMapFilters) &&
    JSON.stringify(current.appPreferences) === JSON.stringify(next.appPreferences)
  );
}

function formatJourneyStarted(timestamp: string | null) {
  if (!timestamp) return "";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function readPersistedJourneyState(): PersistedJourneyState | null {
  try {
    const raw = window.localStorage.getItem(JOURNEY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedJourneyState;
  } catch {
    return null;
  }
}

function writePersistedJourneyState(state: PersistedJourneyState) {
  try {
    window.localStorage.setItem(JOURNEY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore local storage failures.
  }
}

const STATION_SERVICE_LOOKUP: Record<string, string[]> = {
  "Town Hall": ["Sunbury", "Cranbourne", "Pakenham", "Metro Tunnel"],
  "State Library": ["Sunbury", "Cranbourne", "Pakenham", "Metro Tunnel"],
  "Flinders Street": ["Sandringham", "Frankston", "Werribee", "Williamstown", "Mernda", "Hurstbridge"],
  "Southern Cross": ["Werribee", "Williamstown", "Sunbury", "Craigieburn", "Upfield"],
  "North Melbourne": ["Sunbury", "Craigieburn", "Upfield"],
};

const STATION_DEPARTURES: Record<string, StationDeparture[]> = {
  "Town Hall": [
    { id: "thl-1", destination: "Cranbourne", platform: "2", status: "Boarding", time: "22:43", tdn: "C531", lineLabel: "Metro Tunnel", lineTone: "bg-cyan-500/15 text-cyan-200" },
    { id: "thl-2", destination: "Sunbury", platform: "1", status: "On Time", time: "22:43", tdn: "Z135", lineLabel: "Metro Tunnel", lineTone: "bg-cyan-500/15 text-cyan-200" },
    { id: "thl-3", destination: "East Pakenham", platform: "2", status: "On Time", time: "22:53", tdn: "C137", lineLabel: "Metro Tunnel", lineTone: "bg-cyan-500/15 text-cyan-200" },
    { id: "thl-4", destination: "West Footscray", platform: "1", status: "Delayed", time: "23:03", tdn: "Z141", lineLabel: "Sunbury", lineTone: "bg-cyan-500/15 text-cyan-200" },
  ],
  "Flinders Street": [
    { id: "fss-1", destination: "Sandringham", platform: "10", status: "On Time", time: "Live", tdn: "Through service", lineLabel: "Cross-City", lineTone: "bg-pink-500/15 text-pink-200" },
    { id: "fss-2", destination: "Werribee", platform: "9", status: "On Time", time: "Live", tdn: "Through service", lineLabel: "Cross-City", lineTone: "bg-pink-500/15 text-pink-200" },
    { id: "fss-3", destination: "Mernda", platform: "1", status: "On Time", time: "22:47", tdn: "804M", lineLabel: "Clifton Hill", lineTone: "bg-rose-500/15 text-rose-200" },
  ],
};

function getStationDepartureBoard(stationName: string) {
  return STATION_DEPARTURES[stationName] ?? [
    { id: `${stationName}-1`, destination: "City Loop", platform: "1", status: "On Time", time: "22:45", tdn: "Z101", lineLabel: "Metro", lineTone: "bg-white/10 text-white/80" },
    { id: `${stationName}-2`, destination: "Outbound service", platform: "2", status: "Boarding", time: "22:53", tdn: "Z109", lineLabel: "Metro", lineTone: "bg-white/10 text-white/80" },
  ];
}

function getGeneratedPidPlatforms(stationName: string, departures: StationDeparture[]) {
  const fromDepartures = [...new Set(departures.map((departure) => departure.platform))].sort((left, right) => Number(left) - Number(right));
  const fallbackCount = /(flinders|southern cross|richmond)/i.test(stationName) ? 8 : /(caulfield|footscray|ringwood)/i.test(stationName) ? 4 : 2;
  const fallback = Array.from({ length: fallbackCount }, (_, index) => String(index + 1));
  return fromDepartures.length > 0 ? fromDepartures : fallback;
}

function getPidStyleClasses(style: PidStyleKey, theme: PidThemeMode) {
  if (style === "connex-legacy") return "border-emerald-300/30 bg-emerald-950/40 text-emerald-50";
  if (style === "metlink-era") return "border-yellow-300/30 bg-blue-950/55 text-yellow-50";
  if (style === "vline") return "border-violet-300/30 bg-violet-950/45 text-violet-50";
  if (style === "custom") return theme === "light" ? "border-slate-300 bg-slate-100 text-slate-950" : "border-white/15 bg-slate-950 text-white";
  if (style === "metro-modern") return theme === "light" ? "border-blue-200 bg-white text-slate-950" : "border-blue-300/25 bg-slate-950 text-white";
  return "border-cyan-300/25 bg-slate-950 text-white";
}

function getPidTrainFeatures(departure?: StationDeparture) {
  const searchable = `${departure?.lineLabel ?? ""} ${departure?.destination ?? ""}`.toLowerCase();
  if (/v\/line|regional|geelong|ballarat|bendigo/.test(searchable)) {
    return { length: "6-car VLocity", cars: 6, doorSide: "Left side", accessible: [2, 5], bikes: [3, 6], firstClass: [] };
  }
  if (/xpt|sydney/.test(searchable)) {
    return { length: "7-car XPT", cars: 7, doorSide: "Right side", accessible: [3], bikes: [6], firstClass: [1] };
  }
  if (/metro tunnel|cranbourne|pakenham|sunbury/.test(searchable)) {
    return { length: "7-car HCMT", cars: 7, doorSide: "Left side", accessible: [1, 7], bikes: [2, 6], firstClass: [] };
  }
  return { length: "6-car suburban", cars: 6, doorSide: "Platform side", accessible: [1, 6], bikes: [3], firstClass: [] };
}

function getPidStoppingPattern(departure?: StationDeparture) {
  if (!departure) return "Select a platform to preview stopping pattern.";
  if (/brighton beach/i.test(departure.destination)) return "Stopping all stations to Brighton Beach.";
  if (/city loop/i.test(departure.destination)) return "City Loop service. Check platform staff advice.";
  if (/werribee|sandringham|frankston|mernda|sunbury|cranbourne|pakenham/i.test(departure.destination)) {
    return `Stopping pattern generated for ${departure.destination}.`;
  }
  return departure.status === "Delayed" ? "Service delayed. Stopping pattern may change." : "Stopping pattern generated from selected station context.";
}

function getPidServiceTypeLabel(departure?: StationDeparture) {
  const features = getPidTrainFeatures(departure);
  const searchable = `${departure?.lineLabel ?? ""} ${departure?.destination ?? ""}`.toLowerCase();
  const type = /v\/line|regional|geelong|ballarat|bendigo/.test(searchable)
    ? "VLocity"
    : /xpt|sydney/.test(searchable)
      ? "XPT"
      : /metro tunnel|cranbourne|pakenham|sunbury/.test(searchable)
        ? "HCMT"
        : "Metro train";
  return `${features.length} · ${type}`;
}

function PlannerSheet({ isOpen, onToggle, children }: PlannerSheetProps) {
  return (
    <div
      className={`pointer-events-none overflow-hidden transition-all duration-300 ${
        isOpen
          ? "translate-y-0 rounded-t-[1.4rem] border border-white/10 bg-slate-950 shadow-2xl sm:rounded-[1.85rem]"
          : "ml-auto w-fit translate-y-0 border-0 bg-transparent shadow-none"
      }`}
    >
      <button
        onClick={onToggle}
        className="pointer-events-auto flex w-full flex-col items-center justify-center px-4 pb-2 pt-1.5 text-white sm:pb-2.5 sm:pt-2.5"
        aria-expanded={isOpen}
        aria-label={isOpen ? "Hide planner" : "Show planner"}
      >
        {isOpen && <span className="mb-1.5 h-1 w-10 rounded-full bg-white/20 sm:mb-2 sm:h-1.5 sm:w-12" />}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-600 px-3 py-1 text-xs font-semibold shadow-lg shadow-blue-950/35 sm:gap-2 sm:px-3.5 sm:py-1.5 sm:text-sm">
          <ChevronUp className={`h-3.5 w-3.5 transition-transform sm:h-4 sm:w-4 ${isOpen ? "rotate-180" : ""}`} />
          {isOpen ? "Hide Journey" : "Journey"}
        </span>
      </button>

      <div className={`${isOpen ? "pointer-events-auto" : "pointer-events-none"} max-h-[72vh] overflow-y-auto px-4 pb-4 max-[430px]:max-h-[66vh] max-[430px]:px-3 sm:px-5 sm:pb-4.5`}>
        {children}
      </div>
    </div>
  );
}

function VersionModal({ isOpen, onClose, showWelcome }: VersionModalProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/96 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-300/80">TransitAlert Melbourne</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">TransitAlert updates</h2>
            <p className="mt-1 text-sm text-white/65">
              System notes, version history, and recent release changes for the planner and live tools.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/70 sm:block">
              TransitAlert Web Version {TRANSITALERT_WEB_VERSION}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>

          <div className="overflow-y-auto px-5 py-5 sm:px-6">
            {showWelcome && (
              <div className="mb-4 rounded-[1.35rem] border border-blue-400/20 bg-blue-500/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-200/90">First open</p>
                    <p className="mt-2 text-xl font-semibold text-white">Welcome to TransitAlert {TRANSITALERT_WEB_VERSION}</p>
                    <p className="mt-1 max-w-3xl text-sm text-blue-50/80">
                      This board shows the main changes for the current build so new or returning users know what shifted straight away.
                    </p>
                  </div>
                  <span className="rounded-full border border-blue-300/20 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-blue-100">
                    New in {TRANSITALERT_WEB_VERSION}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {VERSION_HIGHLIGHT_CARDS.map((card) => (
                    <div key={card.title} className="rounded-[1.15rem] border border-white/10 bg-black/20 p-3">
                      <p className="text-sm font-semibold text-white">{card.title}</p>
                      <p className="mt-2 text-sm leading-6 text-white/72">{card.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-300/85">About This System</p>
            <div className="mt-3 grid gap-2">
              {TRANSITALERT_SYSTEM_NOTES.map((note) => (
                <div key={note} className="rounded-2xl border border-white/5 bg-black/20 px-3 py-2 text-sm text-white/80">
                  {note}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {VERSION_LOG.map((entry) => (
              <div key={`${entry.version}-${entry.date}`} className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-semibold text-white">{entry.version}</p>
                  <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-200">
                    {entry.date}
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  {entry.notes.map((note) => (
                    <div key={note} className="rounded-2xl border border-white/5 bg-black/20 px-3 py-2 text-sm text-white/80">
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DockedPanelSheet({ isOpen, onToggle, eyebrow, title, summary, fullPage = false, children }: DockedPanelSheetProps) {
  if (fullPage) {
    return (
      <section className="pointer-events-auto h-full min-h-0 overflow-x-hidden overflow-y-auto bg-slate-950 text-white">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 pb-4 pl-20 pr-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-7 sm:py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-300/85">{eyebrow}</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            <p className="max-w-2xl text-sm text-white/55">{summary}</p>
          </div>
        </header>
        <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-6 sm:py-6">{children}</div>
      </section>
    );
  }
  return (
    <div
      className={`pointer-events-none overflow-hidden rounded-t-[2rem] border border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur-2xl transition-transform duration-300 sm:rounded-[2rem] ${
        isOpen ? "translate-y-0" : "translate-y-[calc(100%-92px)]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="pointer-events-auto flex w-full items-start justify-between gap-4 px-5 pb-4 pt-4 text-left text-white"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-300/80">{eyebrow}</p>
          <p className="mt-2 text-lg font-semibold">{title}</p>
          <p className="mt-1 text-sm text-white/60">{summary}</p>
        </div>
        <span className="mt-1 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80">
          <ChevronUp className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          {isOpen ? "Collapse" : "Expand"}
        </span>
      </button>

      <div className={`${isOpen ? "pointer-events-auto" : "pointer-events-none"} max-h-[68vh] overflow-y-auto px-5 pb-5 max-[430px]:max-h-[58vh] max-[430px]:px-3 max-[430px]:pb-4`}>
        {children}
      </div>
    </div>
  );
}

function normaliseStopNameForMatch(value: string) {
  return value.replace(/\s+(railway\s+)?station$/i, "").trim().toLowerCase();
}

// A leg's departure card only ever shows when the vehicle LEAVES the
// boarding stop — riders actually want to know when they'll ARRIVE at the
// leg's destination stop, which needs this specific run's own real
// stopping pattern (the same per-stop data the map's vehicle detail panel
// already uses), not a guessed duration. Its own component so the
// per-departure fetch follows React's rules of hooks regardless of how many
// departure cards are showing. Bus/tram stops carry their real time as
// expectedAt; train stops carry it as expectedArrivalAt — the fetch and the
// field name both depend on which of the three real trip endpoints this is.
function JourneyArrivalTime({ mode, tripId, destinationStopName }: { mode: "bus" | "tram" | "train"; tripId: string; destinationStopName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["journey-arrival", mode, tripId],
    queryFn: () => (mode === "train" ? fetchTrainTrip(tripId) : mode === "tram" ? fetchTramTrip(tripId) : fetchBusTrip(tripId)),
    staleTime: 20_000,
    retry: 1,
  });

  const targetKey = normaliseStopNameForMatch(destinationStopName);
  const arrivalStop = data?.stops.find((stop) => normaliseStopNameForMatch(stop.name) === targetKey);
  const arrivalTime = arrivalStop
    ? ("expectedArrivalAt" in arrivalStop ? arrivalStop.expectedArrivalAt : arrivalStop.expectedAt)
    : undefined;

  if (isLoading) {
    return <p className="mt-1 text-xs text-white/45">Checking arrival time…</p>;
  }
  if (!arrivalTime) {
    return null;
  }

  return (
    <p className="mt-1 text-xs font-semibold text-blue-100">
      Arrive ~{new Date(arrivalTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} at {destinationStopName}
    </p>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { data: authSession } = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const session = await fetchAuthSession();
      if (session.authenticated) return session;
      const guestSession = await continueAsGuest();
      markGuestIntent();
      return guestSession;
    },
    refetchOnMount: "always",
    retry: false,
    staleTime: 60_000,
  });
  const { data: liveFleetVehicles = [], isFetching: isFleetRefreshing } = useQuery({
    queryKey: ["live-fleet-board"],
    queryFn: () => fetchLiveTrains(),
    enabled: Boolean(authSession?.authenticated),
    retry: false,
    refetchInterval: isMobile ? 30_000 : 15_000,
    staleTime: isMobile ? 20_000 : 10_000,
  });
  const { data: liveFleetBuses = [] } = useQuery({
    queryKey: ["live-fleet-board", "buses"],
    queryFn: () => fetchLiveBuses(),
    enabled: Boolean(authSession?.authenticated),
    retry: false,
    refetchInterval: isMobile ? 30_000 : 15_000,
    staleTime: isMobile ? 20_000 : 10_000,
  });
  const { data: liveFleetTrams = [], isError: isLiveTramsError } = useQuery({
    queryKey: ["live-fleet-board", "trams"],
    queryFn: () => fetchLiveTrams(),
    enabled: Boolean(authSession?.authenticated),
    retry: false,
    refetchInterval: isMobile ? 30_000 : 15_000,
    staleTime: isMobile ? 20_000 : 10_000,
  });
  // Sydney buses/light rail — a separate NSW Transport Open Data product from
  // the Melbourne PTV feeds above, so it's its own query rather than folded
  // into the Melbourne ones (see api/ptv/sydney-transit.js).
  const { data: sydneyTransitData } = useQuery({
    queryKey: ["live-fleet-board", "sydney-transit"],
    queryFn: () => fetchSydneyTransit(),
    enabled: Boolean(authSession?.authenticated),
    retry: false,
    refetchInterval: isMobile ? 30_000 : 15_000,
    staleTime: isMobile ? 20_000 : 10_000,
  });
  const sydneyLiveBuses = sydneyTransitData?.buses ?? [];
  const sydneyLiveTrams = sydneyTransitData?.trams ?? [];
  const { data: metroJourneyAlerts = [], isError: journeyAlertsError, dataUpdatedAt: journeyAlertsUpdatedAt } = useQuery({
    queryKey: ["/api/metro-notify/alerts", "journey-brief"],
    queryFn: fetchMetroNotifyAlerts,
    retry: false,
    refetchInterval: 90_000,
    staleTime: 60_000,
  });
    const isAuthenticated = authSession?.authenticated ?? false;
    const [activeTab, setActiveTab] = useState<HomeTabKey>("map");
    const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
    const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [isUtilityPanelOpen, setIsUtilityPanelOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isVersionFirstOpen, setIsVersionFirstOpen] = useState(false);
  const [userMenuMessage, setUserMenuMessage] = useState("");
  const [selectedFleetType, setSelectedFleetType] = useState<FleetFilterKey>("all");
  const [fleetSearchQuery, setFleetSearchQuery] = useState("");
  const [pidStation, setPidStation] = useState<string>("Flinders Street");
  const [pidPlatform, setPidPlatform] = useState<string>("1");
  const [pidStyle, setPidStyle] = useState<PidStyleKey>("transitalert");
  const [pidPreviewMode, setPidPreviewMode] = useState<PidPreviewMode>("single");
  const [pidDensity, setPidDensity] = useState<PidDisplayDensity>("standard");
  const [pidResolution, setPidResolution] = useState<(typeof PID_RESOLUTIONS)[number]>("1920x1080");
  const [pidTheme, setPidTheme] = useState<PidThemeMode>("dark");
  const [pidFont, setPidFont] = useState<(typeof PID_FONTS)[number]>("Inter");
  const [pidAccentColor, setPidAccentColor] = useState("#7c3aed");
  const [pidLineColor, setPidLineColor] = useState("#22c55e");
  const [pidBranding, setPidBranding] = useState("TransitAlert PID Studio");
  const [focusedVehicleKey, setFocusedVehicleKey] = useState<string | null>(null);
  const [journeyOrigin, setJourneyOrigin] = useState<string>("Flinders Street");
  const [journeyDestination, setJourneyDestination] = useState<string>("Sandringham");
  const [journeyRoute, setJourneyRoute] = useState<Station[]>([]);
  const [journeyLegSegments, setJourneyLegSegments] = useState<JourneyLegSegment[]>([]);
  const [journeySummary, setJourneySummary] = useState<string>("Plan a journey using the fields below.");
  const [journeyBoardingAdvice, setJourneyBoardingAdvice] = useState<string>("");
  const [journeyDisplay, setJourneyDisplay] = useState<JourneyDisplay | null>(null);
  const [currentLocationOrigin, setCurrentLocationOrigin] = useState<string | null>(null);
  const [currentLocationCoords, setCurrentLocationCoords] = useState<[number, number] | null>(null);
  const [journeyStartedAt, setJourneyStartedAt] = useState<string | null>(null);
  // How long the walk to the first boarding stop actually takes, from the
  // plan the server just computed. Without this, the "next train" board for
  // that first leg checks departures against the current moment — which
  // recommends trains you can't actually catch if you're still a few
  // minutes' walk from the platform.
  const [journeyOriginWalkSeconds, setJourneyOriginWalkSeconds] = useState(0);
  const activeJourneyBusRoutes = useMemo(() => {
    if (!journeyStartedAt || !journeyDisplay) return [];
    return Array.from(new Set(
      journeyDisplay.legs
        .filter((leg) => leg.mode === "bus")
        .flatMap((leg) => (`${leg.title} ${leg.badge}`.match(/(?:route\s*)?([A-Z]?\d{1,4}[A-Z]?)/gi) ?? [])
          .map((match) => match.replace(/^route\s*/i, "").toUpperCase())
          .filter(Boolean)),
    ));
  }, [journeyDisplay, journeyStartedAt]);
  const [attachedJourneyServiceKey, setAttachedJourneyServiceKey] = useState<string | null>(null);
  const [attachedJourneyServiceLabel, setAttachedJourneyServiceLabel] = useState<string | null>(null);
  const [hasHydratedJourney, setHasHydratedJourney] = useState(false);
  const [originPickerMessage, setOriginPickerMessage] = useState("");
  const [isOriginPickerOpen, setIsOriginPickerOpen] = useState(false);
  const [originSearch, setOriginSearch] = useState("");
  // Native <datalist> suggestions don't reliably respond to a tap on mobile
  // browsers (a well-known cross-browser gap, especially iOS Safari) — a
  // real button list guarantees the destination actually gets set on tap.
  const [isDestinationDropdownOpen, setIsDestinationDropdownOpen] = useState(false);
  const [journeyPlannerMessage, setJourneyPlannerMessage] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [adminSelectedStation, setAdminSelectedStation] = useState("Flinders Street");
  const [adminLat, setAdminLat] = useState("-37.8184161");
  const [adminLng, setAdminLng] = useState("144.9664779");
  const [adminSelectedLine, setAdminSelectedLine] = useState("metroTunnel");
  const [adminDebugLineKey, setAdminDebugLineKey] = useState<AdminDebugLineKey>(() => {
    if (typeof window === "undefined") {
      return "none";
    }

    const stored = window.localStorage.getItem(ADMIN_DEBUG_STORAGE_KEY);
    return ADMIN_DEBUG_LINE_OPTIONS.some((option) => option.key === stored)
      ? (stored as AdminDebugLineKey)
      : "none";
  });
  const [splitCrossCityGroup, setSplitCrossCityGroup] = useState(true);
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [hasMergedLocalPreferences, setHasMergedLocalPreferences] = useState(false);
  const [adminConfigDraft, setAdminConfigDraft] = useState<AdminRuntimeConfig>({});
  const [adminAccountDrafts, setAdminAccountDrafts] = useState<
    Record<string, Pick<AdminAccountRecord, "role" | "isAdmin" | "isPremium">>
  >({});
  const isAdmin = authSession?.user?.isAdmin ?? false;
  const isGuest = authSession?.user?.role === "Guest";
  // Admins already have more access than Premium unlocks — never let a stored
  // preferences flag (which may predate this account becoming admin) gate a
  // premium feature away from them.
  const isPremium = isAdmin || hasPremiumAccess(preferences);
  const mobilePerformanceMode = getMobilePerformanceMode(preferences);
  const premiumPaypalLink = getPremiumPaypalLink(preferences);
  const favouriteConsists = getFavouriteConsists(preferences);
  const isDatabaseConfigured = authSession?.databaseConfigured === true;

  useEffect(() => {
    if (isMobile) {
      setIsUtilityPanelOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_DEBUG_STORAGE_KEY, adminDebugLineKey);
  }, [adminDebugLineKey]);

  const { data: accountPreferences } = useQuery({
    queryKey: ["account-preferences", authSession?.user?.id],
    queryFn: fetchAccountPreferences,
    enabled: isAuthenticated && !isGuest,
    retry: false,
    staleTime: 60_000,
  });

  const { data: adminConfig } = useQuery({
    queryKey: ["admin-runtime-config"],
    queryFn: fetchAdminConfig,
    enabled: isAdmin,
    retry: false,
    staleTime: 60_000,
  });

  const { data: adminAccountsPayload } = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: fetchAdminAccounts,
    enabled: isAdmin,
    retry: false,
    staleTime: 30_000,
  });
  const adminAccounts = adminAccountsPayload?.accounts ?? [];
  const approvedDebugTesters = adminAccountsPayload?.approvedDebugTesters ?? [];

  const broadcastWelcomeMutation = useMutation({
    mutationFn: broadcastWelcomeEmail,
  });

  const signOutMutation = useMutation({
    mutationFn: logoutSession,
    onSuccess: async () => {
      queryClient.setQueryData(["auth-session"], { authenticated: false, user: null });
      await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
      setActiveTab("map");
      setLocation("/login");
    },
  });

  const adminAccountMutation = useMutation({
    mutationFn: ({ accountId, patch }: { accountId: string; patch: Pick<AdminAccountRecord, "role" | "isAdmin" | "isPremium"> }) =>
      updateAdminAccount(accountId, patch),
    onSuccess: async (account) => {
      if (account) {
        setAdminAccountDrafts((current) => ({
          ...current,
          [account.id]: {
            role: account.role,
            isAdmin: account.isAdmin,
            isPremium: account.isPremium,
          },
        }));
      }
      setAdminMessage("Account access updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
    },
    onError: (error) => {
      setAdminMessage(error instanceof Error ? error.message : "Failed to update account access.");
    },
  });

  const uniqueStations = useMemo(() => {
    const seen = new Map<string, Station>();
    for (const station of [...ALL_STATIONS, ...SURFACE_PLANNER_STATIONS]) {
      if (!seen.has(station.name)) seen.set(station.name, station);
    }
    return [...seen.values()];
  }, []);
  const stationOptions = useMemo(() => uniqueStations.map((station) => station.name).sort(), [uniqueStations]);
  const destinationSuggestions = useMemo(() => {
    const query = journeyDestination.trim().toLowerCase();
    if (!query) return [];
    return stationOptions.filter((name) => name.toLowerCase().includes(query)).slice(0, 8);
  }, [journeyDestination, stationOptions]);
  const stationByName = useMemo(
    () => new Map(uniqueStations.map((station) => [station.name, station])),
    [uniqueStations],
  );
  const stationByNormalizedName = useMemo(
    () => new Map(uniqueStations.map((station) => [station.name.trim().toLowerCase(), station])),
    [uniqueStations],
  );
  const journeyTrainLeg = journeyDisplay?.legs.find((leg) => leg.mode === "train") ?? null;
  const { data: journeyTrainDepartures } = useQuery({
    queryKey: ["journey-train-departures", journeyTrainLeg?.from],
    queryFn: () => fetchStationDepartures(journeyTrainLeg!.from),
    enabled: Boolean(journeyTrainLeg?.from),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: 3,
  });
  const journeyMatchingTrainDepartures = useMemo(() => {
    if (!journeyTrainLeg || !journeyTrainDepartures?.departures) return [];
    const routeText = journeyTrainLeg.title.toLowerCase();
    // A train departing before you've actually walked to the platform isn't
    // catchable — shift the "earliest usable departure" cutoff forward by
    // that walk time instead of always anchoring to right now.
    const now = Date.now() - 60_000 + journeyOriginWalkSeconds * 1000;

    // Matching on line name alone isn't enough — a line runs both directions,
    // so "Frankston line" departures from a station include trains heading
    // both toward the city AND away from it. Without also checking direction,
    // this could recommend boarding a real, correctly-timed train that's
    // going the opposite way from where this leg is actually headed. Resolve
    // the real line's station order (already used elsewhere for corridor
    // labels) and only keep departures whose destination lies on the same
    // side of the boarding stop as this leg's own destination.
    // Leg names come from the real GTFS stop ("Ormond Station"); LINES uses
    // the app's own bare station names ("Ormond") — strip the suffix before
    // comparing or this never matches anything at all.
    const stripStationSuffix = (value: string) => value.replace(/\s+(railway\s+)?station$/i, "").trim().toLowerCase();
    const legFromKey = stripStationSuffix(journeyTrainLeg.from);
    const legToKey = stripStationSuffix(journeyTrainLeg.to);
    const lineEntry = Object.values(LINES).find(
      (stations) =>
        stations.some((station) => stripStationSuffix(station.name) === legFromKey) &&
        stations.some((station) => stripStationSuffix(station.name) === legToKey),
    );
    const fromIndex = lineEntry?.findIndex((station) => stripStationSuffix(station.name) === legFromKey) ?? -1;
    const toIndex = lineEntry?.findIndex((station) => stripStationSuffix(station.name) === legToKey) ?? -1;
    const directionSign = lineEntry && fromIndex !== -1 && toIndex !== -1 ? Math.sign(toIndex - fromIndex) : 0;
    const resolveStationIndex = (text: string) => {
      if (!lineEntry) return -1;
      let bestIndex = -1;
      let bestLength = 0;
      for (let index = 0; index < lineEntry.length; index += 1) {
        const name = lineEntry[index].name.toLowerCase();
        if (text.includes(name) && name.length > bestLength) {
          bestIndex = index;
          bestLength = name.length;
        }
      }
      return bestIndex;
    };

    return journeyTrainDepartures.departures
      .filter((departure) => {
        const serviceText = `${departure.route} ${departure.destination}`.toLowerCase();
        const routeMatches = /pakenham/.test(routeText)
          ? /pakenham/.test(serviceText)
          : routeText.split(" ").some((part) => part.length > 4 && serviceText.includes(part));
        if (!routeMatches || new Date(departure.expectedAt || departure.scheduledAt).getTime() < now) return false;

        if (directionSign !== 0) {
          const destinationIndex = resolveStationIndex((departure.destination || "").toLowerCase());
          if (destinationIndex !== -1 && Math.sign(destinationIndex - fromIndex) !== directionSign) return false;
        }
        return true;
      })
      .sort((left, right) => new Date(left.expectedAt || left.scheduledAt).getTime() - new Date(right.expectedAt || right.scheduledAt).getTime())
      .slice(0, 2);
  }, [journeyTrainDepartures, journeyTrainLeg, journeyOriginWalkSeconds]);
  const journeySurfaceLeg = journeyDisplay?.legs.find((leg) => leg.mode === "bus" || leg.mode === "tram") ?? null;
  const journeySurfaceLegStop = journeySurfaceLeg
    ? journeyRoute.find((station) => station.name === journeySurfaceLeg.from) ?? null
    : null;
  const { data: journeySurfaceDepartures } = useQuery({
    queryKey: ["journey-surface-departures", journeySurfaceLeg?.mode, journeySurfaceLegStop?.name, journeySurfaceLeg?.title],
    queryFn: () =>
      fetchSurfaceStopDepartures({
        mode: journeySurfaceLeg!.mode as "bus" | "tram",
        route: journeySurfaceLeg!.title,
        lat: journeySurfaceLegStop!.position[0],
        lng: journeySurfaceLegStop!.position[1],
      }),
    enabled: Boolean(journeySurfaceLeg && journeySurfaceLegStop),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: 3,
  });
  const journeyMatchingSurfaceDepartures = useMemo(() => {
    if (!journeySurfaceLeg || !journeySurfaceDepartures?.departures) return [];
    const now = Date.now() - 60_000;
    return journeySurfaceDepartures.departures
      .filter((departure) => new Date(departure.expectedAt || departure.scheduledAt).getTime() >= now)
      .sort((left, right) => new Date(left.expectedAt || left.scheduledAt).getTime() - new Date(right.expectedAt || right.scheduledAt).getTime())
      .slice(0, 2);
  }, [journeySurfaceDepartures, journeySurfaceLeg]);
  const lineKeys = useMemo(() => Object.keys(LINES), []);

  const liveFleetTrips = useMemo(
    () => [
      ...buildFleetTripsFromLive(liveFleetVehicles),
      ...buildBusFleetTrips(liveFleetBuses, "vic"),
      ...buildBusFleetTrips(sydneyLiveBuses, "nsw"),
      ...buildTramFleetTrips(liveFleetTrams, "vic"),
      ...buildTramFleetTrips(sydneyLiveTrams, "nsw"),
    ],
    [liveFleetVehicles, liveFleetBuses, liveFleetTrams, sydneyLiveBuses, sydneyLiveTrams],
  );
  const fleetCountByType = useMemo(
    () =>
      liveFleetTrips.reduce<Record<string, number>>((counts, trip) => {
        counts[trip.fleet] = (counts[trip.fleet] ?? 0) + 1;
        return counts;
      }, {}),
    [liveFleetTrips],
  );
  // Bus operators and tram classes aren't a fixed enum like train rolling
  // stock — they're read straight from whatever the live feed reports right
  // now, so their filter buttons are generated from live data instead of a
  // hardcoded list that could drift out of date.
  const victoriaBusFilterGroup = useMemo<FleetFilterGroup>(() => {
    const operatorLabels = new Map<BusTypeFleetKey, string>();
    for (const bus of liveFleetBuses) {
      const operator = bus.operator?.trim() || "PTV contracted bus service";
      operatorLabels.set(`bus:vic-${slugifyFleetLabel(operator)}`, operator);
    }
    return {
      label: "Victoria Buses",
      filters: Array.from(operatorLabels, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [liveFleetBuses]);
  const nswBusFilterGroup = useMemo<FleetFilterGroup>(() => {
    const operatorLabels = new Map<BusTypeFleetKey, string>();
    for (const bus of sydneyLiveBuses) {
      const operator = bus.operator?.trim() || "Sydney bus network";
      operatorLabels.set(`bus:nsw-${slugifyFleetLabel(operator)}`, operator);
    }
    return {
      label: "NSW Buses",
      filters: Array.from(operatorLabels, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [sydneyLiveBuses]);
  const victoriaTramFilterGroup = useMemo<FleetFilterGroup>(() => {
    const classLabels = new Map<TramClassFleetKey, string>();
    for (const tram of liveFleetTrams) {
      const tramClass = tram.label?.trim() || "Unknown";
      classLabels.set(`tram:vic-${slugifyFleetLabel(tramClass)}`, `${tramClass} class`);
    }
    return {
      label: "Victoria Trams",
      filters: Array.from(classLabels, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [liveFleetTrams]);
  const nswTramFilterGroup = useMemo<FleetFilterGroup>(() => {
    const operatorLabels = new Map<TramClassFleetKey, string>();
    for (const tram of sydneyLiveTrams) {
      const operator = tram.operator?.trim() || "Sydney Light Rail";
      operatorLabels.set(`tram:nsw-${slugifyFleetLabel(operator)}`, operator);
    }
    return {
      label: "NSW Trams",
      filters: Array.from(operatorLabels, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [sydneyLiveTrams]);
  const allFleetFilterGroups = useMemo(
    () => [...FLEET_FILTER_GROUPS, victoriaBusFilterGroup, nswBusFilterGroup, victoriaTramFilterGroup, nswTramFilterGroup],
    [victoriaBusFilterGroup, nswBusFilterGroup, victoriaTramFilterGroup, nswTramFilterGroup],
  );
  const allFleetFilters = useMemo(
    () => allFleetFilterGroups.flatMap((group) => group.filters),
    [allFleetFilterGroups],
  );
  const fleetTypeLabels = useMemo(
    () => new Map<string, string>([
      ...FLEET_TYPES.map((type) => [type.key, type.label] as const),
      ...victoriaBusFilterGroup.filters.map((filter) => [filter.key, filter.label] as const),
      ...nswBusFilterGroup.filters.map((filter) => [filter.key, filter.label] as const),
      ...victoriaTramFilterGroup.filters.map((filter) => [filter.key, filter.label] as const),
      ...nswTramFilterGroup.filters.map((filter) => [filter.key, filter.label] as const),
    ]),
    [victoriaBusFilterGroup, nswBusFilterGroup, victoriaTramFilterGroup, nswTramFilterGroup],
  );
  const selectedFleetFilterLabel = useMemo(
    () => allFleetFilters.find((filter) => filter.key === selectedFleetType)?.label ?? "All",
    [allFleetFilters, selectedFleetType],
  );
  const getFleetFilterCount = useCallback(
    (fleetKey: FleetFilterKey) => (fleetKey === "all" ? liveFleetTrips.length : fleetCountByType[fleetKey] ?? 0),
    [fleetCountByType, liveFleetTrips.length],
  );
  const fleetTripsForSelection = useMemo(
    () => {
      const byType = selectedFleetType === "all"
        ? liveFleetTrips
        : liveFleetTrips.filter((trip) => trip.fleet === selectedFleetType);
      const query = fleetSearchQuery.trim().toLowerCase();
      if (!query) return byType;
      return byType.filter((trip) =>
        `${trip.tdn} ${trip.tripNumber} ${trip.setNumber} ${trip.route} ${trip.line} ${trip.fleet} ${trip.vehicleModel ?? ""}`
          .toLowerCase()
          .includes(query),
      );
    },
    [fleetSearchQuery, liveFleetTrips, selectedFleetType],
  );
  const fleetTripsToDisplay = useMemo(
    () => sortFleetTripsForOperationsBoard(fleetTripsForSelection),
    [fleetTripsForSelection],
  );
  const fleetStats = useMemo(() => {
    const trips = fleetTripsToDisplay;
    return {
      liveTrips: trips.length,
      runningNow: trips.filter((trip) => trip.status === "running").length,
      upcomingSoon: trips.filter((trip) => trip.status === "upcoming").length,
    };
  }, [fleetTripsToDisplay]);
  // A set that isn't currently running won't show up in fleetTripsToDisplay
  // (that's live-feed only). When the live search comes up empty and the
  // query looks like it's naming a specific set, fall back to the logged
  // sighting history so "where was it last / what did it run today" still
  // has an answer instead of just "no results".
  const trimmedFleetSearchQuery = fleetSearchQuery.trim();
  const shouldLookupFleetHistory = trimmedFleetSearchQuery.length > 0 && fleetTripsToDisplay.length === 0;
  const fleetHistoryQuery = useQuery({
    queryKey: ["/api/consist", trimmedFleetSearchQuery],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/api/consist/${encodeURIComponent(trimmedFleetSearchQuery)}`));
      if (!response.ok) throw new Error(`Lookup failed (${response.status})`);
      return (await response.json()) as {
        consist: string;
        status: "active" | "idle" | "finished";
        last_seen_at?: string | null;
        last_known_position?: { lat: number; lng: number } | null;
        last_service?: {
          consist: string;
          tdn: string | null;
          line: string | null;
          destination: string | null;
          trainType: string | null;
          firstSeenAt: string;
          lastSeenAt: string;
        } | null;
        todays_services?: Array<{
          consist: string;
          tdn: string | null;
          line: string | null;
          destination: string | null;
          firstSeenAt: string;
          lastSeenAt: string;
        }>;
      };
    },
    enabled: shouldLookupFleetHistory,
    staleTime: 30_000,
  });
  // Same idea as fleetHistoryQuery, but for browsing a whole fleet TYPE (e.g.
  // "X'Trapolis 2.0") rather than one specific set number — useful for fleets
  // that currently have very few sets, where "not running right now" is the
  // common case, not the exception.
  const shouldLookupFleetTypeHistory = trimmedFleetSearchQuery.length === 0 && selectedFleetType !== "all";
  const fleetTypeHistoryQuery = useQuery({
    queryKey: ["/api/fleet-type", selectedFleetType],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/api/fleet-type/${encodeURIComponent(selectedFleetType)}`));
      if (!response.ok) throw new Error(`Lookup failed (${response.status})`);
      return (await response.json()) as {
        fleetType: string;
        sets: Array<{
          setNumber: string;
          inService: boolean;
          lastSeenAt: string;
          lastKnownPosition: { lat: number; lng: number } | null;
          lastService: {
            consist: string;
            tdn: string | null;
            line: string | null;
            destination: string | null;
            trainType: string | null;
            firstSeenAt: string;
            lastSeenAt: string;
          };
          todaysServiceCount: number;
        }>;
      };
    },
    enabled: shouldLookupFleetTypeHistory,
    staleTime: 30_000,
  });
  const pidDepartures = useMemo(() => getStationDepartureBoard(pidStation), [pidStation]);
  const pidPlatforms = useMemo(() => getGeneratedPidPlatforms(pidStation, pidDepartures), [pidStation, pidDepartures]);
  const pidSelectedDeparture = useMemo(
    () => pidDepartures.find((departure) => departure.platform === pidPlatform) ?? pidDepartures[0],
    [pidDepartures, pidPlatform],
  );
  const pidPlatformDepartures = useMemo(
    () => pidDepartures.filter((departure) => departure.platform === pidPlatform),
    [pidDepartures, pidPlatform],
  );
  const pidTrainFeatures = useMemo(() => getPidTrainFeatures(pidSelectedDeparture), [pidSelectedDeparture]);
  const pidStyleClasses = useMemo(() => getPidStyleClasses(pidStyle, pidTheme), [pidStyle, pidTheme]);
  const serviceDayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-AU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date()),
    [],
  );
  const lastUpdatedLabel = useMemo(() => {
    const latestTimestamp = liveFleetTrips
      .map((trip) => (trip.updatedAt ? new Date(trip.updatedAt).getTime() : 0))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => b - a)[0];

    const baseDate = latestTimestamp ? new Date(latestTimestamp) : new Date();

    return new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(baseDate);
  }, [liveFleetTrips]);

  useEffect(() => {
    if (pidPlatforms.length > 0 && !pidPlatforms.includes(pidPlatform)) {
      setPidPlatform(pidPlatforms[0] ?? "1");
    }
  }, [pidPlatform, pidPlatforms]);
  const stationDraftPreview = useMemo(
    () => uniqueStations.find((station) => station.name === adminSelectedStation) ?? uniqueStations[0],
    [adminSelectedStation, uniqueStations],
  );
  const nearbyOriginStations = useMemo(
    () => ["Town Hall", "Flinders Street", "State Library", "Southern Cross", "North Melbourne"]
      .map((name) => uniqueStations.find((station) => station.name === name))
      .filter((station): station is Station => Boolean(station)),
    [uniqueStations],
  );
  const filteredOriginStations = useMemo(() => {
    const query = originSearch.trim().toLowerCase();
    if (!query) return uniqueStations.slice(0, 18);
    return uniqueStations.filter((station) => station.name.toLowerCase().includes(query)).slice(0, 24);
  }, [originSearch, uniqueStations]);
  const journeyDisruptionBrief = useMemo(() => {
    if (journeyRoute.length < 2) return null;

    const corridorLabels = getJourneyCorridorLabels(journeyRoute);
    const corridorText = corridorLabels.length > 0 ? corridorLabels.join(", ") : "your planned corridor";
    const matchingAlerts = metroJourneyAlerts
      .filter((alert) => isAlertCurrent(alert) && alertMatchesJourney(alert, journeyDisplay?.legs ?? []));
    const alertsFresh = !journeyAlertsError && journeyAlertsUpdatedAt > 0 && Date.now() - journeyAlertsUpdatedAt < 180_000;

    return {
      title: matchingAlerts.length > 0 ? `${matchingAlerts.length} relevant service notice${matchingAlerts.length === 1 ? "" : "s"}` : `${corridorText} alert check`,
      summary: journeyDisruptionGuidance(matchingAlerts, alertsFresh),
      terms: JOURNEY_DISRUPTION_TERMS,
      matchingAlerts,
    };
  }, [journeyRoute, journeyDisplay, metroJourneyAlerts, journeyAlertsError, journeyAlertsUpdatedAt]);
  const openLiveTrainOnMap = useCallback((trip: FleetTrip) => {
    setFocusedVehicleKey(trip.focusKey);
    setActiveTab("map");
    setIsPlannerOpen(false);
    setIsSidebarOpen(false);
  }, []);

  const attachJourneyToService = useCallback((trip: FleetTrip) => {
    setAttachedJourneyServiceKey(trip.focusKey);
    setAttachedJourneyServiceLabel(
      hasPremiumAccess(accountPreferences)
        ? `${trip.line} · TDN ${trip.tripNumber} · ${trip.route}`
        : getPublicFleetServiceLabel(trip),
    );
    setJourneyStartedAt((current) => current ?? new Date().toISOString());
    setFocusedVehicleKey(trip.focusKey);
    setActiveTab("map");
    setIsPlannerOpen(true);
  }, [accountPreferences]);

  // Attaching used to only be reachable from the Fleet Tracker's own trip
  // rows (a real FleetTrip, full of fields a journey-planner departure card
  // doesn't have) — this is the same attach, taking just the two real
  // things a departure card actually has: its focus key and a label to
  // show. Lets any departure card "lock on" in one tap, not just Fleet
  // Tracker rows.
  const attachJourneyServiceDirect = useCallback((focusKey: string, label: string) => {
    setAttachedJourneyServiceKey(focusKey);
    setAttachedJourneyServiceLabel(label);
    setJourneyStartedAt((current) => current ?? new Date().toISOString());
    setFocusedVehicleKey(focusKey);
    setActiveTab("map");
    setIsPlannerOpen(false);
    setIsSidebarOpen(false);
  }, []);

  const finishJourney = useCallback(() => {
    setJourneyRoute([]);
    setJourneyLegSegments([]);
    setJourneySummary("Plan a journey using the fields below.");
    setJourneyBoardingAdvice("");
    setJourneyDisplay(null);
    setAttachedJourneyServiceKey(null);
    setAttachedJourneyServiceLabel(null);
    setJourneyStartedAt(null);
  }, []);

  const useCurrentLocationForOrigin = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.geolocation) {
      setOriginPickerMessage("Current location is not available in this browser.");
      return;
    }

    setOriginPickerMessage("Finding your current location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nearestStation = uniqueStations
          .map((station) => ({
            station,
            distance:
              (station.position[0] - position.coords.latitude) ** 2 +
              (station.position[1] - position.coords.longitude) ** 2,
          }))
          .sort((left, right) => left.distance - right.distance)[0]?.station;
        const label = nearestStation
          ? `${CURRENT_LOCATION_LABEL} · Near ${nearestStation.name}`
          : `${CURRENT_LOCATION_LABEL} · ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
        setCurrentLocationOrigin(label);
        setCurrentLocationCoords([position.coords.latitude, position.coords.longitude]);
        setJourneyOrigin(label);
        setOriginPickerMessage("Current location ready.");
        setIsOriginPickerOpen(false);
      },
      (error) => {
        // An installed PWA is a separate app to the OS, so a location grant
        // given to the site in a regular browser tab doesn't carry over —
        // the OS blocks the request until the installed app itself is given
        // location permission, which reports as PERMISSION_DENIED here with
        // no prompt ever shown. Callers who only saw the generic message
        // couldn't tell that apart from a plain "you said no".
        //
        // Confirmed against a real device: iOS does not give "Add to Home
        // Screen" web apps their own entry in Settings > Location Services at
        // all in many iOS versions (Settings for the installed TransitAlert
        // icon showed only "Notifications", no Location row whatsoever) — so
        // telling an iOS user to go toggle it there sends them to a setting
        // that doesn't exist. The only real workaround is using the site in
        // Safari directly, where geolocation isn't tied to the home-screen icon.
        if (error.code === error.PERMISSION_DENIED) {
          setOriginPickerMessage(
            isStandaloneApp() && isIosDevice()
              ? "The installed TransitAlert app can't get your location — iOS doesn't expose a Location permission for home-screen web apps. Open transit-alert.com in Safari directly (not the home-screen icon) to use current location there."
              : isStandaloneApp()
                ? "Location is blocked for the installed TransitAlert app. Check Settings > Apps > TransitAlert > Permissions > Location and allow it, then try again."
                : "Location access is blocked for this site. Allow it in your browser's site settings, then try again.",
          );
          return;
        }
        if (error.code === error.TIMEOUT) {
          setOriginPickerMessage("Location took too long to respond. Try again.");
          return;
        }
        setOriginPickerMessage("Your device couldn't determine a location just now.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  useEffect(() => {
    if (activeTab === "admin" && !isAdmin) {
      setActiveTab("map");
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    setPreferences(readLocalPreferences());
  }, []);

  useEffect(() => {
    if (hasHydratedJourney || uniqueStations.length === 0) return;

    const persisted = readPersistedJourneyState();
    if (!persisted) {
      setHasHydratedJourney(true);
      return;
    }

    setJourneyOrigin(persisted.journeyOrigin || "Flinders Street");
    setJourneyDestination(persisted.journeyDestination || "Sandringham");
    setCurrentLocationOrigin(persisted.currentLocationOrigin ?? null);
    setCurrentLocationCoords(persisted.currentLocationCoords ?? null);
    setJourneySummary(persisted.summary || "Plan a journey using the fields below.");
    setJourneyBoardingAdvice(persisted.boardingAdvice || "");
    setJourneyDisplay(persisted.display ?? null);
    setAttachedJourneyServiceKey(persisted.attachedServiceKey ?? null);
    setAttachedJourneyServiceLabel(persisted.attachedServiceLabel ?? null);
    setJourneyStartedAt(persisted.startedAt ?? null);
    setJourneyRoute(
      (persisted.routeStationNames ?? [])
        .map((stationName) => stationByName.get(stationName))
        .filter((station): station is Station => Boolean(station)),
    );
    setHasHydratedJourney(true);
  }, [hasHydratedJourney, stationByName, uniqueStations.length]);

  useEffect(() => {
    if (!hasHydratedJourney) return;

    writePersistedJourneyState({
      journeyOrigin,
      journeyDestination,
      currentLocationOrigin,
      currentLocationCoords,
      routeStationNames: journeyRoute.map((station) => station.name),
      summary: journeySummary,
      boardingAdvice: journeyBoardingAdvice,
      display: journeyDisplay,
      attachedServiceKey: attachedJourneyServiceKey,
      attachedServiceLabel: attachedJourneyServiceLabel,
      startedAt: journeyStartedAt,
    });
  }, [
    attachedJourneyServiceKey,
    attachedJourneyServiceLabel,
    currentLocationCoords,
    currentLocationOrigin,
    hasHydratedJourney,
    journeyBoardingAdvice,
    journeyDestination,
    journeyDisplay,
    journeyOrigin,
    journeyRoute,
    journeyStartedAt,
    journeySummary,
  ]);

  useEffect(() => {
    if (accountPreferences && !isGuest) {
      setPreferences({
        ...defaultPreferences,
        ...accountPreferences,
      });
    }
  }, [accountPreferences, isGuest]);

  useEffect(() => {
    if (!isAuthenticated || isGuest || hasMergedLocalPreferences || !authSession?.user?.id) return;

    const localPreferences = readLocalPreferences();
    const hasLocalData =
      localPreferences.favouriteStops.length > 0 ||
      localPreferences.favouriteRoutes.length > 0 ||
      Object.keys(localPreferences.selectedMapFilters).length > 0 ||
      localPreferences.transportModes.length > 0 ||
      Object.keys(localPreferences.appPreferences).length > 0;

    if (!hasLocalData) {
      setHasMergedLocalPreferences(true);
      return;
    }

    void mergeLocalPreferences(localPreferences)
      .then((merged) => {
        setPreferences(merged);
        writeLocalPreferences(merged);
      })
      .finally(() => setHasMergedLocalPreferences(true));
  }, [authSession?.user?.id, hasMergedLocalPreferences, isAuthenticated, isGuest]);

  useEffect(() => {
    if (adminConfig) {
      setAdminConfigDraft(adminConfig);
    }
  }, [adminConfig]);

  useEffect(() => {
    if (adminAccounts.length === 0) return;
    setAdminAccountDrafts(
      Object.fromEntries(
        adminAccounts.map((account) => [
          account.id,
          {
            role: account.role,
            isAdmin: account.isAdmin,
            isPremium: account.isPremium,
          },
        ]),
      ),
    );
  }, [adminAccounts]);

  useEffect(() => {
    if (!authSession?.user) {
      setIsUserMenuOpen(false);
    }
  }, [authSession?.user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const lastSeenVersion = window.localStorage.getItem(VERSION_SEEN_STORAGE_KEY);
      if (lastSeenVersion !== TRANSITALERT_WEB_VERSION) {
        setIsVersionFirstOpen(true);
        setIsVersionOpen(true);
      }
    } catch {
      // Ignore local storage failures.
    }
  }, []);

  const handleCloseVersionModal = useCallback(() => {
    setIsVersionOpen(false);
    setIsVersionFirstOpen(false);
    try {
      window.localStorage.setItem(VERSION_SEEN_STORAGE_KEY, TRANSITALERT_WEB_VERSION);
    } catch {
      // Ignore local storage failures.
    }
  }, []);

  useEffect(() => {
    if (activeTab === "map") return;
    setIsUtilityPanelOpen(true);
  }, [activeTab]);

  const findNearestStation = useCallback(
    (coords: [number, number]) => {
      return uniqueStations
        .map((station) => ({
          station,
          distance:
            (station.position[0] - coords[0]) ** 2 +
            (station.position[1] - coords[1]) ** 2,
        }))
        .sort((left, right) => left.distance - right.distance)[0]?.station ?? null;
    },
    [uniqueStations],
  );

  const getJourneyBoardingAdvice = (route: Station[], summary: string) => {
    if (route.length < 2) return "";

    const transferMatch = summary.match(/Change at (.+?) from/);
    const focusStation = transferMatch?.[1] ?? route[route.length - 1]?.name;
    const hint = (focusStation && TRAIN_BOARDING_HINTS[focusStation]) || null;

    if (hint) {
      return `${hint.zone}: ${hint.reason}`;
    }

    return "Middle cars: usually the safest all-round pick for concourse access, stairs, and flexible transfers.";
  };

  const buildJourneyDisplay = (
    route: Station[],
    summary: string,
    legs: JourneyLeg[],
    pattern: string,
    typeLabel = "Metro train",
  ): JourneyDisplay => {
    const start = new Date();
    const totalMinutes = Math.max(route.length * 3, legs.length * 8, 9);
    const end = addMinutesToTime(start, totalMinutes);

    return {
      summary,
      pattern,
      typeLabel,
      window: formatPlannerTimeWindow(start, end),
      duration: formatPlannerDuration(totalMinutes),
      date: formatPlannerDate(start),
      stopCountLabel: `${Math.max(route.length - 1, 0)} stops`,
      legs,
    };
  };

  const applyJourneyPlan = (route: Station[], summary: string, display?: JourneyDisplay, legSegments?: JourneyLegSegment[]) => {
    setJourneyRoute(route);
    setJourneyLegSegments(legSegments ?? []);
    setJourneySummary(summary);
    setJourneyBoardingAdvice(getJourneyBoardingAdvice(route, summary));
    setJourneyDisplay(display ?? null);
    setJourneyStartedAt(route.length > 0 ? new Date().toISOString() : null);
    setAttachedJourneyServiceKey(null);
    setAttachedJourneyServiceLabel(null);
  };

  const computeJourneyRoute = async () => {
    try {
      setJourneyPlannerMessage("Planning your journey against the live network…");
      setJourneyOriginWalkSeconds(0);
      const trimmedDestination = journeyDestination.trim();
      const destination =
        stationByName.get(trimmedDestination) ??
        stationByNormalizedName.get(trimmedDestination.toLowerCase()) ??
        null;
      const isCurrentLocationOrigin = currentLocationOrigin !== null && journeyOrigin === currentLocationOrigin;

      let resolvedOrigin =
        stationByName.get(journeyOrigin) ??
        stationByNormalizedName.get(journeyOrigin.trim().toLowerCase()) ??
        null;
      let accessLeg: JourneyLeg | null = null;
      let originLat: number | undefined;
      let originLng: number | undefined;

      if (isCurrentLocationOrigin && currentLocationCoords) {
        originLat = currentLocationCoords[0];
        originLng = currentLocationCoords[1];
        const nearestGpsStation = findNearestStation(currentLocationCoords);
        if (nearestGpsStation) {
          resolvedOrigin = nearestGpsStation;
          accessLeg = {
            mode: "walk",
            title: "Start from current location",
            from: journeyOrigin,
            to: nearestGpsStation.name,
            detail: `Go to ${nearestGpsStation.name} first, then continue from there.`,
            badge: "GPS",
          };
        }
      }

      const trimmedOrigin = journeyOrigin.trim();
      if ((!trimmedOrigin && originLat === undefined) || !trimmedDestination) {
        applyJourneyPlan([], "Pick a start point and destination, then plan the trip again.");
        setJourneyPlannerMessage("Choose a start point and destination before planning.");
        return;
      }

      if (resolvedOrigin && destination && resolvedOrigin.name === destination.name) {
        const singleLegs: JourneyLeg[] = [
          ...(accessLeg ? [accessLeg] : []),
          {
            mode: "walk",
            title: "You have arrived",
            from: resolvedOrigin.name,
            to: destination.name,
            detail: "No further travel needed.",
            badge: "Arrived",
          },
        ];
        applyJourneyPlan(
          [resolvedOrigin],
          "You're already at your destination.",
          buildJourneyDisplay([resolvedOrigin], "You're already at your destination.", singleLegs, "Already there", "Station access"),
        );
        setJourneyPlannerMessage("");
        return;
      }

      const plan = await fetchJourneyPlan({
        originName: resolvedOrigin?.name ?? (originLat === undefined ? trimmedOrigin : undefined),
        originLat,
        originLng,
        destinationName: destination?.name ?? trimmedDestination,
      });
      setJourneyOriginWalkSeconds(plan.walkFromOriginSeconds ?? 0);

      if (!plan.found) {
        const fallbackOrigin = resolvedOrigin ?? { name: trimmedOrigin, position: DEFAULT_FALLBACK_COORDS };
        const fallbackDestination = destination ?? { name: trimmedDestination, position: DEFAULT_FALLBACK_COORDS };
        applyJourneyPlan(
          [fallbackOrigin, fallbackDestination],
          "No clean through-route was found right now, so the planner kept your start and end pinned.",
          buildJourneyDisplay(
            [fallbackOrigin, fallbackDestination],
            "No clean through-route was found right now.",
            [
              ...(accessLeg ? [accessLeg] : []),
              {
                mode: "walk",
                title: "Manual transfer",
                from: fallbackOrigin.name,
                to: fallbackDestination.name,
                detail: plan.reason === "origin-not-found"
                  ? "That start point couldn't be matched to a real stop or station."
                  : plan.reason === "destination-not-found"
                    ? "That destination couldn't be matched to a real stop or station."
                    : "Check live services manually or attach yourself to a specific trip below.",
                badge: "Fallback",
              },
            ],
            "Manual transfer",
            "Fallback route",
          ),
        );
        setJourneyPlannerMessage("");
        return;
      }

      if (plan.alreadyThere) {
        const arrivalStation = resolvedOrigin ?? destination ?? { name: trimmedDestination, position: DEFAULT_FALLBACK_COORDS };
        applyJourneyPlan(
          [arrivalStation],
          "You're already at your destination.",
          buildJourneyDisplay([arrivalStation], "You're already at your destination.", [
            ...(accessLeg ? [accessLeg] : []),
            { mode: "walk", title: "You have arrived", from: arrivalStation.name, to: arrivalStation.name, detail: "No further travel needed.", badge: "Arrived" },
          ], "Already there", "Station access"),
        );
        setJourneyPlannerMessage("");
        return;
      }

      const routeStations: Station[] = (plan.stops ?? []).map((stop) => ({
        name: stop.name,
        position: [stop.lat, stop.lng],
      }));

      // Slice the flat stop list back into one polyline per leg (using each
      // leg's own stopsCount) so a train ride, a walk, and a bus ride each
      // draw as their own distinct segment instead of one line straight
      // through every stop regardless of mode.
      const legSegments: JourneyLegSegment[] = [];
      let stopCursor = 0;
      for (const leg of plan.legs ?? []) {
        // A bus leg with real GTFS shape geometry draws the actual road it
        // drives, not a straight line jumping from stop to stop — every
        // other mode (and any bus route whose shape wasn't found) still
        // falls back to the stop-to-stop line below.
        const segmentPositions = leg.shapePositions && leg.shapePositions.length >= 2
          ? leg.shapePositions
          : routeStations
              .slice(stopCursor, stopCursor + leg.stopsCount + 1)
              .map((station): [number, number] => station.position);
        if (segmentPositions.length >= 2) {
          legSegments.push({ mode: leg.mode, positions: segmentPositions, routeLabel: leg.routeLabel });
        }
        stopCursor += leg.stopsCount;
      }
      if (accessLeg && legSegments.length > 0) {
        const trueOriginPosition: [number, number] =
          originLat !== undefined && originLng !== undefined ? [originLat, originLng] : DEFAULT_FALLBACK_COORDS;
        legSegments.unshift({ mode: "walk", positions: [trueOriginPosition, legSegments[0].positions[0]] });
      }

      const transitLegs: JourneyLeg[] = (plan.legs ?? []).map((leg) => ({
        mode: leg.mode,
        title: leg.mode === "walk" ? "Walk" : leg.routeLabel,
        from: leg.from,
        to: leg.to,
        detail: leg.mode === "walk"
          ? `Walk about ${leg.distanceMetres ?? "a short distance"}${typeof leg.distanceMetres === "number" ? " m" : ""} to ${leg.to}`
          : `${leg.stopsCount} stop${leg.stopsCount === 1 ? "" : "s"}${leg.headsign ? ` toward ${leg.headsign}` : ""}`,
        badge: leg.mode === "tram" ? "Tram" : leg.mode === "bus" ? "Bus" : leg.mode === "walk" ? "Walk" : "Train",
      }));

      const journeyLegs = [...(accessLeg ? [accessLeg] : []), ...transitLegs];
      if (accessLeg && transitLegs[0]) {
        accessLeg.detail = `Walk from your current location to ${transitLegs[0].from}. Board the ${transitLegs[0].title} toward ${transitLegs[0].to}.`;
      }
      const boardableLegs = transitLegs.filter((leg) => leg.mode !== "walk");
      const changeStations = boardableLegs.slice(0, -1).map((leg) => leg.to).filter(Boolean);
      const finalDestinationName = destination?.name ?? trimmedDestination;
      const railSummary =
        boardableLegs.length <= 1
          ? `Direct journey via ${boardableLegs[0]?.title ?? "the selected network"} (${Math.max(routeStations.length - 1, 0)} stops).`
          : `Stay on board, then change at ${changeStations.join(", ")} to finish the trip to ${finalDestinationName}.`;
      const summary = accessLeg
        ? `Start from your location by heading to ${transitLegs[0]?.from ?? finalDestinationName}. ${railSummary}`
        : railSummary;
      const pattern =
        boardableLegs.length <= 1
          ? boardableLegs[0]?.title ?? "Direct service"
          : `Change at ${changeStations.join(" + ")}`;

      applyJourneyPlan(
        routeStations,
        summary,
        buildJourneyDisplay(
          routeStations,
          summary,
          journeyLegs,
          pattern,
          accessLeg || transitLegs.some((leg) => leg.mode !== "train") ? "Mixed-mode journey" : "Rail journey",
        ),
        legSegments,
      );
      setJourneyPlannerMessage("");
    } catch (error) {
      console.error("Journey planning failed", error);
      setJourneyPlannerMessage("Journey planning hit a problem. Your inputs were kept, so please try again.");
      applyJourneyPlan([], "Journey planning hit a problem before the route could be drawn.");
    }
  };

  const loadStationDraft = (stationName: string) => {
    const station = uniqueStations.find((item) => item.name === stationName);
    setAdminSelectedStation(stationName);
    if (station) {
      setAdminLat(String(station.position[0]));
      setAdminLng(String(station.position[1]));
    }
  };

  const saveStationDraft = () => {
    setAdminMessage(
      `Draft saved for ${adminSelectedStation}: ${adminLat}, ${adminLng} on ${adminSelectedLine}. Persist this next.`,
    );
  };

  const updateAdminAccountDraft = useCallback(
    (
      accountId: string,
      field: "role" | "isAdmin" | "isPremium",
      value: string | boolean,
    ) => {
      setAdminAccountDrafts((current) => ({
        ...current,
        [accountId]: {
          role: current[accountId]?.role ?? "Traveller",
          isAdmin: current[accountId]?.isAdmin ?? false,
          isPremium: current[accountId]?.isPremium ?? false,
          ...(field === "role" ? { role: String(value) } : {}),
          ...(field === "isAdmin" ? { isAdmin: Boolean(value) } : {}),
          ...(field === "isPremium" ? { isPremium: Boolean(value) } : {}),
        },
      }));
    },
    [],
  );


  const updatePreferences = useCallback(
    (patch: Partial<UserPreferences>) => {
      setPreferences((current) => {
        const next = {
          ...current,
          ...patch,
        };

        if (arePreferencePatchesEqual(current, next)) {
          return current;
        }

        writeLocalPreferences(next);
        if (isAuthenticated && !isGuest) {
          void saveAccountPreferences(next).catch((error) => {
            console.warn("Unable to save account preferences right now.", error);
          });
        }
        return next;
      });
    },
    [isAuthenticated, isGuest],
  );

  useEffect(() => {
    const currentModes = Array.isArray(preferences.transportModes) ? preferences.transportModes : [];
    const appPreferences = preferences.appPreferences ?? {};
    const hasMigratedTransportModes = appPreferences.transportModesMigrated === true;

    if (hasMigratedTransportModes) {
      return;
    }

    const isLegacyTrainOnly = currentModes.length === 1 && currentModes[0] === "train";
    const hasInvalidModes = currentModes.length === 0;

    if (isLegacyTrainOnly || hasInvalidModes) {
      updatePreferences({
        transportModes: [...DEFAULT_TRANSPORT_MODES],
        appPreferences: {
          ...appPreferences,
          transportModesMigrated: true,
        },
      });
      return;
    }

    updatePreferences({
      appPreferences: {
        ...appPreferences,
        transportModesMigrated: true,
      },
    });
  }, [preferences.appPreferences, preferences.transportModes, updatePreferences]);

  useEffect(() => {
    const appPreferences = preferences.appPreferences ?? {};
    if (appPreferences.surfaceModesMigrated === true) return;

    const currentModes = Array.isArray(preferences.transportModes) ? preferences.transportModes : [];
    const nextModes = [...new Set([...currentModes, "tram", "bus"])] as TransportMode[];
    updatePreferences({
      transportModes: nextModes,
      appPreferences: {
        ...appPreferences,
        surfaceModesMigrated: true,
      },
    });
  }, [preferences.appPreferences, preferences.transportModes, updatePreferences]);

  const layerState = preferences.selectedMapFilters as Partial<LayerState>;

  const visiblePlannerFilters = useMemo(() => {
    return SERVICE_FILTERS.filter((filter) => {
      if (filter.key === "crossCityPink") {
        return !splitCrossCityGroup;
      }
      if (filter.key === "werribeeWilliamstownGroup" || filter.key === "sandringhamGroup") {
        return splitCrossCityGroup;
      }
      if (filter.key === "frankstonGroup") {
        return false;
      }
      if (filter.key === "upfieldCraigieburnCityLoop") {
        return false;
      }
      return true;
    });
  }, [splitCrossCityGroup]);

  const isPlannerFilterActive = (filter: ServiceFilterKey) => {
    switch (filter) {
      case "geelongRegionalGroup":
        return (preferences.transportModes as TransportMode[]).includes("vline") && Boolean(layerState.geelongRegional);
      case "ballaratRegionalGroup":
        return (preferences.transportModes as TransportMode[]).includes("vline") && Boolean(layerState.ballaratRegional);
      case "bendigoRegionalGroup":
        return (preferences.transportModes as TransportMode[]).includes("vline") && Boolean(layerState.bendigoRegional);
      case "seymourRegionalGroup":
        return (preferences.transportModes as TransportMode[]).includes("vline") && Boolean(layerState.seymourRegional);
      case "traralgonRegionalGroup":
        return (preferences.transportModes as TransportMode[]).includes("vline") && Boolean(layerState.traralgonRegional);
      case "metroTunnelServices":
        return Boolean(layerState.metroTunnel || layerState.sunburyLine || layerState.cranbourneLine || layerState.pakenhamLine);
      case "crossCityPink":
        return Boolean(layerState.werribeeLine || layerState.sandringhamLine);
      case "werribeeWilliamstownGroup":
        return Boolean(layerState.werribeeLine);
      case "sandringhamGroup":
        return Boolean(layerState.sandringhamLine);
      case "burnleyGroup":
        return Boolean(layerState.belgraveLine || layerState.lilydaleLine || layerState.glenWaverleyLine || layerState.alameinLine || layerState.burnleyLoop);
      case "cliftonHillGroup":
        return Boolean(layerState.merndaLine || layerState.hurstbridgeLine || layerState.cliftonHillLoop);
      case "caulfieldGroup":
      case "frankstonGroup":
        return Boolean(layerState.frankstonLine);
      case "upfieldCraigieburn":
        return Boolean(layerState.upfieldLine || layerState.craigieburnLine);
      case "upfieldCraigieburnCityLoop":
        return Boolean(layerState.northernLoop);
      default:
        return false;
    }
  };

  const togglePlannerTransportMode = useCallback((mode: TransportMode) => {
    const currentModes = (preferences.transportModes as TransportMode[]) || [...DEFAULT_TRANSPORT_MODES];
    const nextModes = currentModes.includes(mode)
      ? currentModes.filter((item) => item !== mode)
      : [...currentModes, mode];
    updatePreferences({ transportModes: nextModes.length > 0 ? nextModes : [...DEFAULT_TRANSPORT_MODES] });
  }, [preferences.transportModes, updatePreferences]);

  const togglePlannerServiceFilter = useCallback((filter: ServiceFilterKey) => {
    const prev = layerState;
    let next: Partial<LayerState> = { ...prev };
    const currentModes = (preferences.transportModes as TransportMode[]) || [...DEFAULT_TRANSPORT_MODES];
    const shouldForceShowRegional = !currentModes.includes("vline") && (
      filter === "geelongRegionalGroup" ||
      filter === "ballaratRegionalGroup" ||
      filter === "bendigoRegionalGroup" ||
      filter === "seymourRegionalGroup" ||
      filter === "traralgonRegionalGroup"
    );

    switch (filter) {
      case "geelongRegionalGroup":
        next = { ...prev, geelongRegional: shouldForceShowRegional ? true : !Boolean(prev.geelongRegional) };
        break;
      case "ballaratRegionalGroup":
        next = { ...prev, ballaratRegional: shouldForceShowRegional ? true : !Boolean(prev.ballaratRegional) };
        break;
      case "bendigoRegionalGroup":
        next = { ...prev, bendigoRegional: shouldForceShowRegional ? true : !Boolean(prev.bendigoRegional) };
        break;
      case "seymourRegionalGroup":
        next = { ...prev, seymourRegional: shouldForceShowRegional ? true : !Boolean(prev.seymourRegional) };
        break;
      case "traralgonRegionalGroup":
        next = { ...prev, traralgonRegional: shouldForceShowRegional ? true : !Boolean(prev.traralgonRegional) };
        break;
      case "metroTunnelServices": {
        const nextValue = !Boolean(prev.metroTunnel);
        next = {
          ...prev,
          metroTunnel: nextValue,
          sunburyLine: nextValue,
          cranbourneLine: nextValue,
          pakenhamLine: nextValue,
        };
        break;
      }
      case "crossCityPink":
        next = {
          ...prev,
          werribeeLine: !Boolean(prev.werribeeLine),
          sandringhamLine: !Boolean(prev.sandringhamLine),
        };
        break;
      case "werribeeWilliamstownGroup":
        next = {
          ...prev,
          werribeeLine: !Boolean(prev.werribeeLine),
        };
        break;
      case "sandringhamGroup":
        next = {
          ...prev,
          sandringhamLine: !Boolean(prev.sandringhamLine),
        };
        break;
      case "burnleyGroup": {
        const nextValue = !(prev.belgraveLine || prev.lilydaleLine || prev.glenWaverleyLine || prev.alameinLine || prev.burnleyLoop);
        next = {
          ...prev,
          belgraveLine: nextValue,
          lilydaleLine: nextValue,
          glenWaverleyLine: nextValue,
          alameinLine: nextValue,
          burnleyLoop: nextValue,
        };
        break;
      }
      case "cliftonHillGroup": {
        const nextValue = !(prev.merndaLine || prev.hurstbridgeLine || prev.cliftonHillLoop);
        next = {
          ...prev,
          merndaLine: nextValue,
          hurstbridgeLine: nextValue,
          cliftonHillLoop: nextValue,
        };
        break;
      }
      case "caulfieldGroup":
      case "frankstonGroup": {
        const nextValue = !Boolean(prev.frankstonLine);
        next = {
          ...prev,
          frankstonLine: nextValue,
        };
        break;
      }
      case "upfieldCraigieburn":
        next = {
          ...prev,
          upfieldLine: !Boolean(prev.upfieldLine),
          craigieburnLine: !Boolean(prev.craigieburnLine),
        };
        break;
      case "upfieldCraigieburnCityLoop":
        next = {
          ...prev,
          northernLoop: !Boolean(prev.northernLoop),
        };
        break;
      default:
        break;
    }

    updatePreferences({
      selectedMapFilters: next as Record<string, boolean>,
      ...(shouldForceShowRegional
        ? { transportModes: [...currentModes, "vline"] }
        : {}),
    });
  }, [layerState, preferences.transportModes, updatePreferences]);

  const toggleFavouriteStop = (stationName: string) => {
    const exists = preferences.favouriteStops.includes(stationName);
    updatePreferences({
      favouriteStops: exists
        ? preferences.favouriteStops.filter((item) => item !== stationName)
        : [...preferences.favouriteStops, stationName],
    });
  };

  const toggleFavouriteConsist = useCallback(
    (consist: string) => {
      const normalized = consist.trim();
      if (!normalized) return;

      const nextFavouriteConsists = favouriteConsists.includes(normalized)
        ? favouriteConsists.filter((item) => item !== normalized)
        : [...favouriteConsists, normalized];

      updatePreferences({
        appPreferences: {
          ...preferences.appPreferences,
          favouriteConsists: nextFavouriteConsists,
        },
      });
    },
    [favouriteConsists, preferences.appPreferences, updatePreferences],
  );

  const utilitySheetCopy = useMemo(() => {
    if (activeTab === "journey") {
      return {
        eyebrow: "Journey Planner",
        title: "Plan across Victoria",
        summary: "Real-time, multi-modal routing across trains, trams, and buses — planned end to end from the official Victorian GTFS schedule.",
      };
    }
    if (activeTab === "fleets") {
      return {
        eyebrow: "Fleets",
        title: "Live fleet board",
        summary: `Operations view filtered to ${selectedFleetFilterLabel}. Newer and active rows appear first.`,
      };
    }
    if (activeTab === "pid") {
      return {
        eyebrow: "Station tracker",
        title: "Station information display",
        summary: "A full-screen TransitAlert-style platform display for testing station screen layouts.",
      };
    }

    return {
      eyebrow: "Admin",
      title: "Network editor tools",
      summary: isAdmin
        ? "Station positions, line assignments, and admin drafting tools."
        : "Admin-only tools live here once your account has permission.",
    };
  }, [activeTab, isAdmin, selectedFleetFilterLabel]);

  const handleTabChange = (value: string) => {
    if (value === "fleets" && !isPremium) {
      setUserMenuMessage(`Fleet Tracker is a TransitAlert Premium feature in version ${TRANSITALERT_WEB_VERSION}.`);
      setIsUserMenuOpen(true);
      return;
    }
    setActiveTab(value as HomeTabKey);
    setIsUtilityPanelOpen(false);
    setIsSidebarOpen(false);
  };

  if (!authSession) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-white">
        <div className="rounded-[2rem] border border-white/10 bg-card/80 px-6 py-5 shadow-2xl backdrop-blur-xl">
          Loading your account session...
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-white">
        <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-card/85 p-6 shadow-2xl backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300/80">
            TransitAlert Melbourne
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Session ended</h1>
          <p className="mt-2 text-sm text-white/65">
            Your app session is no longer active, so we&apos;re sending you back to sign in.
          </p>
          <button
            type="button"
            onClick={() => setLocation("/login")}
            className="mt-5 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Go to login
          </button>
        </div>
      </main>
    );
  }

  if (authSession.user?.mustChangePassword) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-white">
        <div className="w-full max-w-md rounded-[2rem] border border-amber-300/20 bg-card/90 p-6 shadow-2xl backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200/85">
            Password update required
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Change your temporary password first</h1>
          <p className="mt-2 text-sm leading-6 text-white/65">
            TransitAlert will remain locked until this account chooses a new password.
          </p>
          <button
            type="button"
            onClick={() => setLocation("/login")}
            className="mt-5 w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
          >
            Change password
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-background">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setIsSidebarOpen(true)}
        className="absolute left-3 top-3 z-[72] grid h-11 w-11 place-items-center rounded-2xl border border-white/15 bg-slate-950/90 text-white shadow-2xl backdrop-blur-xl md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setIsSidebarOpen(false)}
          className="absolute inset-0 z-[68] bg-slate-950/55 backdrop-blur-sm md:hidden"
        />
      )}

      {isDesktopSidebarCollapsed && (
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setIsDesktopSidebarCollapsed(false)}
          className="absolute left-3 top-3 z-[72] hidden h-11 w-11 place-items-center rounded-2xl border border-white/15 bg-slate-950/90 text-white shadow-2xl backdrop-blur-xl md:grid"
        >
          <PanelLeftOpen className="h-5 w-5" />
        </button>
      )}

      <aside
        className={`absolute inset-y-0 left-0 z-[70] flex w-[min(84vw,19rem)] flex-col border-r border-white/10 bg-slate-950/94 p-3 text-white shadow-2xl backdrop-blur-2xl transition-transform duration-200 md:w-60 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${isDesktopSidebarCollapsed ? "md:-translate-x-full" : "md:translate-x-0"}`}
      >
        <div className="flex items-center justify-between rounded-[1.4rem] border border-white/10 bg-white/5 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-300/75">Melbourne</p>
            <p className="mt-0.5 text-lg font-bold tracking-tight">TransitAlert</p>
            <p className="text-[10px] text-white/40">v{TRANSITALERT_WEB_VERSION}</p>
          </div>
          <button type="button" aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl text-white/65 hover:bg-white/10 hover:text-white md:hidden">
            <X className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Collapse navigation"
            title="Collapse sidebar"
            onClick={() => setIsDesktopSidebarCollapsed(true)}
            className="hidden h-9 w-9 place-items-center rounded-xl text-white/65 hover:bg-white/10 hover:text-white md:grid"
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-4 space-y-1.5" aria-label="Main navigation">
          {[{ key: "map", label: "Live map", icon: MapIcon }].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleTabChange(key)}
              className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-sm font-semibold transition ${
                activeTab === key ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30" : "text-white/70 hover:bg-white/8 hover:text-white"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </button>
          ))}
          <button type="button" onClick={() => handleTabChange("journey")} className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-sm font-semibold transition ${activeTab === "journey" ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30" : "text-white/70 hover:bg-white/8 hover:text-white"}`}>
            <MapPin className="h-[18px] w-[18px]" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">Journey {journeyStartedAt && <span className="h-2 w-2 rounded-full bg-emerald-400" />}</span>
              {journeyStartedAt && journeyRoute.length > 1 && <span className="mt-0.5 block text-[10px] font-medium text-emerald-200/75">{journeyRoute.length - 1} stops remaining · ACTIVE</span>}
            </span>
          </button>
          <button type="button" onClick={() => setLocation("/alerts/today")} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-sm font-semibold text-white/70 transition hover:bg-white/8 hover:text-white">
            <Bell className="h-[18px] w-[18px]" /> Service alerts
          </button>
          {[
            { key: "fleets", label: "Fleet tracker", icon: Search },
            { key: "pid", label: "Station tracker", icon: Info },
            ...(isAdmin ? [{ key: "admin", label: "Admin", icon: Shield }] : []),
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => handleTabChange(key)} className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-sm font-semibold transition ${activeTab === key ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30" : "text-white/70 hover:bg-white/8 hover:text-white"}`}>
              <Icon className="h-[18px] w-[18px]" />
              <span className="min-w-0 flex-1">{label}</span>
              {key === "fleets" && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-amber-200">Premium</span>}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-1.5 border-t border-white/10 pt-3">
          <button type="button" onClick={() => { setIsVersionFirstOpen(false); setIsVersionOpen(true); setIsSidebarOpen(false); }} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm text-white/65 hover:bg-white/8 hover:text-white">
            <Info className="h-[18px] w-[18px]" /> Version &amp; changes
          </button>
          <button type="button" onClick={() => setLocation("/settings")} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left text-sm text-white/65 hover:bg-white/8 hover:text-white"><Settings className="h-[18px] w-[18px]" /> Settings</button>
          <button type="button" onClick={() => { setUserMenuMessage(""); setIsUserMenuOpen(true); setIsSidebarOpen(false); }} className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-left hover:bg-white/10">
            <CircleUserRound className="h-5 w-5 text-blue-300" />
            <span className="min-w-0"><span className="block truncate text-sm font-semibold">{authSession?.user?.username ?? "Account"}</span><span className="block text-[10px] uppercase tracking-[0.15em] text-white/40">{authSession?.user?.role ?? "Session"}</span></span>
          </button>
        </div>
      </aside>

      {isUserMenuOpen && (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            onClick={() => setIsUserMenuOpen(false)}
            className="absolute inset-0 z-[58] bg-transparent"
          />
          <div className="absolute left-3 right-3 top-16 z-[73] w-auto max-w-[19rem] rounded-[1.6rem] border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-2xl md:left-[15.75rem] md:right-auto md:top-4 md:w-[280px] md:max-w-none">
            <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-3">
              <p className="text-sm font-semibold text-white">{authSession?.user?.username ?? "Account"}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/45">{authSession?.user?.role ?? "Session"}</p>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {isGuest ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setUserMenuMessage("");
                      setLocation("/login");
                    }}
                    className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-left text-sm font-semibold text-blue-100 transition hover:bg-blue-500/15"
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setUserMenuMessage("");
                      setLocation("/register");
                    }}
                    className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-left text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15"
                  >
                    Create account
                  </button>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-relaxed text-white/65">
                    Guest mode now includes live trains and the fleet board. Log in or register to unlock saved account tools, station PID, and extra account controls.
                  </div>
                </>
              ) : (
                <>
              <button
                type="button"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  setUserMenuMessage("");
                  setLocation("/settings");
                }}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Open settings
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    setUserMenuMessage("");
                    setLocation("/settings");
                  }}
                  className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-left text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15"
                >
                  Admin settings
                </button>
              )}
              <button
                type="button"
                onClick={() => signOutMutation.mutate()}
                disabled={signOutMutation.isPending}
                className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-left text-sm font-semibold text-red-100 transition hover:bg-red-500/15 disabled:opacity-70"
              >
                {signOutMutation.isPending ? "Signing out..." : "Log out"}
              </button>
                </>
              )}
            </div>
            {userMenuMessage && (
              <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-white/65">
                {userMenuMessage}
              </p>
            )}
          </div>
        </>
      )}

      {isOriginPickerOpen && (
        <>
          <button
            type="button"
            aria-label="Close origin picker"
            onClick={() => setIsOriginPickerOpen(false)}
            className="absolute inset-0 z-[70] bg-black/55 backdrop-blur-sm"
          />
          <div className="absolute inset-x-3 top-[6.4rem] z-[71] mx-auto w-auto max-w-4xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur-2xl sm:inset-x-4 sm:top-28 sm:w-full">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 text-white">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300/75">Nearest Stations</p>
                <h3 className="mt-1 text-2xl font-semibold">Choose where you're starting from</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOriginPickerOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="grid max-h-[75vh] gap-5 overflow-y-auto p-5 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4">
                <p className="text-lg font-semibold text-white">Stops Near</p>
                <p className="mt-1 text-sm text-white/60">Quick-start stations for testing departures and route planning.</p>
                <div className="mt-4 space-y-3">
                  <button
                    type="button"
                    onClick={useCurrentLocationForOrigin}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-4 text-left transition hover:bg-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <MapPin className="h-5 w-5 text-cyan-300" />
                      <div>
                        <p className="text-base font-semibold text-white">Select your current location now</p>
                        <p className="text-xs text-white/55">Use live GPS as your trip origin</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-200">
                      GPS
                    </span>
                  </button>
                </div>
                {originPickerMessage && (
                  <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/65">
                    {originPickerMessage}
                  </p>
                )}
                <div className="mt-4 space-y-3">
                  {nearbyOriginStations.map((station, index) => (
                    <button
                      key={station.name}
                      type="button"
                      onClick={() => {
                        setJourneyOrigin(station.name);
                        setIsOriginPickerOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-4 text-left transition hover:bg-white/10"
                    >
                      <div className="flex items-center gap-3">
                        <MapPin className="h-5 w-5 text-blue-300" />
                        <div>
                          <p className="text-base font-semibold text-white">{station.name}</p>
                          <p className="text-xs text-white/55">
                            {index === 0 ? "Best quick test station" : "Nearby suggested station"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {preferences.favouriteStops.includes(station.name) && (
                          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
                            Favourite
                          </span>
                        )}
                        <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                          {index === 0 ? "Recommended" : `${(1.1 + index * 0.3).toFixed(2)} km`}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    value={originSearch}
                    onChange={(event) => setOriginSearch(event.target.value)}
                    placeholder="Search station"
                    className="w-full rounded-2xl border border-white/10 bg-slate-900 px-11 py-3 text-white outline-none transition focus:border-blue-400/50"
                  />
                </div>
                <div className="mt-4 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                  {filteredOriginStations.map((station) => (
                    <button
                      key={station.name}
                      type="button"
                      onClick={() => {
                        setJourneyOrigin(station.name);
                        setIsOriginPickerOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                        station.name === journeyOrigin
                          ? "border-blue-400/40 bg-blue-500/10"
                          : "border-white/10 bg-slate-900/80 hover:bg-white/10"
                      }`}
                    >
                      <div>
                        <p className="font-semibold text-white">{station.name}</p>
                        <p className="mt-1 text-xs text-white/50">
                          {(STATION_SERVICE_LOOKUP[station.name] ?? ["Metro services"]).join(" â€¢ ")}
                        </p>
                      </div>
                      {station.name === "Town Hall" && (
                        <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-200">
                          Town Hall test
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!(["journey", "fleets", "pid", "admin"] as HomeTabKey[]).includes(activeTab) && <TransitMap
        journeyRoute={journeyRoute}
        journeyLegSegments={journeyLegSegments}
        journeyBusRoutes={activeJourneyBusRoutes}
        splitCrossCityGroup={splitCrossCityGroup}
        transportModes={preferences.transportModes as Array<"train" | "tram" | "bus" | "vline">}
        onTransportModesChange={(transportModes) => updatePreferences({ transportModes })}
        persistedLayerState={preferences.selectedMapFilters}
        onLayerStateChange={(selectedMapFilters) => updatePreferences({ selectedMapFilters: selectedMapFilters as unknown as Record<string, boolean> })}
        isAdmin={isAdmin}
        isGuest={isGuest}
        isPremium={isPremium}
        mobilePerformanceMode={mobilePerformanceMode}
        premiumPaypalLink={premiumPaypalLink}
        favouriteConsists={favouriteConsists}
        onToggleFavouriteConsist={toggleFavouriteConsist}
        showFilterRail={false}
        focusedVehicleKey={focusedVehicleKey}
        onFocusedVehicleHandled={() => setFocusedVehicleKey(null)}
        debugLineKey={adminDebugLineKey}
      />}

      {activeTab === "map" && journeyStartedAt && journeyRoute.length > 0 && (
        <button
          type="button"
          onClick={finishJourney}
          className="absolute bottom-28 left-1/2 z-[1200] -translate-x-1/2 rounded-full border border-red-300/35 bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-2xl shadow-black/50 transition hover:bg-red-500 active:scale-95 md:bottom-8 md:left-auto md:right-6 md:translate-x-0"
          aria-label="End active journey"
        >
          End journey
        </button>
      )}

      {activeTab === "map" && !isMobile && <RiskyRoutes />}

      {false && activeTab === "map" && (
        <div className="absolute inset-x-0 bottom-0 z-40 pointer-events-none">
          <div className="w-full px-0 pb-0 pointer-events-none sm:px-0 sm:pb-0">
            <PlannerSheet isOpen={isPlannerOpen} onToggle={() => setIsPlannerOpen((value) => !value)}>
              <form
                className="space-y-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  computeJourneyRoute();
                }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-white/60">From your location or chosen station</span>
                    <button
                      type="button"
                      onClick={() => setIsOriginPickerOpen(true)}
                      className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-left text-base text-white outline-none transition hover:border-blue-400/40"
                    >
                      <span>{journeyOrigin}</span>
                      <ChevronDown className="h-4 w-4 text-white/55" />
                    </button>
                  </label>

                  <label className="relative block">
                    <span className="mb-1 block text-xs font-medium text-white/60">To</span>
                    <input
                      value={journeyDestination}
                      onChange={(event) => {
                        setJourneyDestination(event.target.value);
                        setIsDestinationDropdownOpen(true);
                      }}
                      onFocus={() => setIsDestinationDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setIsDestinationDropdownOpen(false), 150)}
                      placeholder="Where to?"
                      autoComplete="off"
                      className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-base text-white outline-none transition focus:border-primary"
                    />
                    {isDestinationDropdownOpen && destinationSuggestions.length > 0 && (
                      <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
                        {destinationSuggestions.map((name) => (
                          <button
                            key={name}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setJourneyDestination(name);
                              setIsDestinationDropdownOpen(false);
                            }}
                            className="block w-full px-4 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10"
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                </div>

                {journeyPlannerMessage && (
                  <div role="status" aria-live="polite" className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    {journeyPlannerMessage}
                  </div>
                )}

                <div className="sticky bottom-0 z-10 -mx-1 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent px-1 pb-1 pt-3">
                  <button
                    type="submit"
                    className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-xl shadow-blue-950/40 transition hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
                  >
                    Plan route
                  </button>
                </div>


                {(journeyRoute.length > 0 || journeyPlannerMessage) && <div className="rounded-[1.75rem] border border-white/10 bg-slate-900 p-4 text-sm text-white/75">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {journeyRoute.length > 0 ? "Journey board" : "Ready when you are"}
                      </p>
                      <p className="mt-1 text-sm">{journeySummary}</p>
                      {journeyStartedAt && (
                        <p className="mt-1 text-xs text-white/45">Started {formatJourneyStarted(journeyStartedAt)}</p>
                      )}
                    </div>
                    {journeyDisplay && journeyDisplay.legs.length > 0 && journeyRoute.length > 0 && (
                      <div className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-200">
                        {journeyDisplay.stopCountLabel}
                      </div>
                    )}
                  </div>

                  {journeyBoardingAdvice && journeyRoute.length > 1 && (
                    <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/85">
                        Best boarding position
                      </p>
                      <p className="mt-1 text-sm text-emerald-50/95">{journeyBoardingAdvice}</p>
                    </div>
                  )}

                  {journeyDisruptionBrief && (
                    <div className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-3 py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/85">
                            Journey disruption brief
                          </p>
                          <p className="mt-1 text-sm font-semibold text-amber-50">{journeyDisruptionBrief.title}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLocation("/alerts/today")}
                          className="rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100"
                        >
                          Open alerts
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-amber-50/90">{journeyDisruptionBrief.summary}</p>
                      {journeyDisruptionBrief.matchingAlerts.length > 0 && (
                        <div className="mt-3 grid gap-2">
                          {journeyDisruptionBrief.matchingAlerts.map((alert) => (
                            <div key={alert.id} className="rounded-2xl border border-amber-200/15 bg-black/20 px-3 py-2">
                              <p className="text-sm font-semibold text-amber-50">{alert.title || "Service notice"}</p>
                              {alert.summary && (
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-50/75">{alert.summary}</p>
                              )}
                              <a href={alert.url && /^https?:\/\//i.test(alert.url) ? alert.url : "https://transport.vic.gov.au/disruptions/disruptions-information"} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-amber-100 underline">Official travel and replacement stop details</a>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {journeyDisruptionBrief.terms.map((term) => (
                          <span
                            key={term}
                            className="rounded-full border border-amber-200/20 bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100/90"
                          >
                            {term}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {attachedJourneyServiceLabel && (
                    <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/85">
                        Attached service
                      </p>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-cyan-50/95">{attachedJourneyServiceLabel}</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => attachedJourneyServiceKey && setFocusedVehicleKey(attachedJourneyServiceKey)}
                            className="rounded-full border border-cyan-300/25 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-100"
                          >
                            Track service
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachedJourneyServiceKey(null);
                              setAttachedJourneyServiceLabel(null);
                            }}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/75"
                          >
                            Detach
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {journeyDisplay && journeyDisplay.legs.length > 0 && journeyRoute.length > 0 && (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-[1.7rem] border border-white/10 bg-white/5 p-5">
                        <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                              Origin
                            </p>
                            <p className="mt-2 text-3xl font-semibold text-white">{journeyLegsOrigin(journeyDisplay)}</p>
                          </div>
                          <div className="flex flex-col items-center gap-3 text-center">
                            <div className="text-lg font-semibold text-emerald-300">{"\u2014  \u2192  \u2014"}</div>
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
                              {journeyDisplay.pattern}
                            </span>
                          </div>
                          <div className="text-left lg:text-right">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                              Destination
                            </p>
                            <p className="mt-2 text-3xl font-semibold text-white">{journeyLegsDestination(journeyDisplay)}</p>
                          </div>
                        </div>

                        <div className="mt-5 h-px bg-white/10" />

                        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
                          <span>Type <span className="ml-2 text-sm normal-case tracking-normal text-white">{journeyDisplay.typeLabel}</span></span>
                          <span>Window <span className="ml-2 text-sm normal-case tracking-normal text-white">{journeyDisplay.window}</span></span>
                          <span>Duration <span className="ml-2 text-sm normal-case tracking-normal text-white">{journeyDisplay.duration}</span></span>
                          <span>Date <span className="ml-2 text-sm normal-case tracking-normal text-white">{journeyDisplay.date}</span></span>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        {journeyDisplay.legs.map((leg, index) => {
                          const accentColor = getJourneyLegAccentColor(leg);
                          return (
                          <div
                            key={`${leg.title}-${leg.from}-${leg.to}-${index}`}
                            className="rounded-[1.35rem] border px-4 py-4"
                            style={{ borderColor: `${accentColor}45`, backgroundColor: `${accentColor}1A`, color: accentColor }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-current/70">
                                  Leg {index + 1} · {leg.badge}
                                </p>
                                <p className="mt-2 text-lg font-semibold text-white">{leg.title}</p>
                                <p className="mt-1 text-sm text-current/90">
                                  {leg.from} to {leg.to}
                                </p>
                              </div>
                              <span className="rounded-full border border-current/25 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-current">
                                {leg.mode}
                              </span>
                            </div>
                            <p className="mt-3 text-sm text-current/80">{leg.detail}</p>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {journeyRoute.length > 0 && (
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={finishJourney}
                        className="rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-100 transition hover:bg-red-500/15"
                      >
                        Finish journey
                      </button>
                    </div>
                  )}
                </div>}

              </form>
            </PlannerSheet>
          </div>
        </div>
      )}

      <VersionModal isOpen={isVersionOpen} onClose={handleCloseVersionModal} showWelcome={isVersionFirstOpen} />

      {activeTab !== "map" && (
        <div className={activeTab === "journey" || activeTab === "fleets" || activeTab === "pid" || activeTab === "admin" ? `absolute inset-0 z-40 pointer-events-none ${isDesktopSidebarCollapsed ? "" : "md:pl-60"}` : "absolute inset-x-0 bottom-0 z-40 pointer-events-none"}>
          <div className={activeTab === "journey" || activeTab === "fleets" || activeTab === "pid" || activeTab === "admin" ? "h-full w-full pointer-events-none" : "mx-auto w-full max-w-6xl px-3 pb-3 pointer-events-none sm:px-4 sm:pb-4"}>
            <DockedPanelSheet
              isOpen={activeTab === "journey" || activeTab === "fleets" || activeTab === "pid" || activeTab === "admin" ? true : isUtilityPanelOpen}
              onToggle={() => setIsUtilityPanelOpen((value) => !value)}
              eyebrow={utilitySheetCopy.eyebrow}
              title={utilitySheetCopy.title}
              summary={utilitySheetCopy.summary}
              fullPage={activeTab === "journey" || activeTab === "fleets" || activeTab === "pid" || activeTab === "admin"}
            >
              <div className={activeTab === "journey" || activeTab === "fleets" || activeTab === "pid" || activeTab === "admin" ? "min-h-full text-white" : "rounded-[2rem] border border-white/10 bg-card/55 p-5 text-white shadow-2xl sm:p-6"}>
            {activeTab === "journey" && (
              <div className="mx-auto grid max-w-5xl gap-5">
                <form onSubmit={(event) => { event.preventDefault(); computeJourneyRoute(); }} className="rounded-[2rem] border border-blue-300/15 bg-slate-900 p-4 shadow-2xl sm:p-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-white/65">
                      From
                      <button type="button" onClick={() => setIsOriginPickerOpen(true)} className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-left text-base text-white">
                        <span>{journeyOrigin}</span><ChevronDown className="h-4 w-4" />
                      </button>
                    </label>
                    <label className="relative grid gap-2 text-sm text-white/65">
                      To
                      <input
                        value={journeyDestination}
                        onChange={(event) => {
                          setJourneyDestination(event.target.value);
                          setIsDestinationDropdownOpen(true);
                        }}
                        onFocus={() => setIsDestinationDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setIsDestinationDropdownOpen(false), 150)}
                        autoComplete="off"
                        className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-base text-white outline-none focus:border-blue-400"
                      />
                      {isDestinationDropdownOpen && destinationSuggestions.length > 0 && (
                        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
                          {destinationSuggestions.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setJourneyDestination(name);
                                setIsDestinationDropdownOpen(false);
                              }}
                              className="block w-full px-4 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/10"
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                    </label>
                  </div>
                  <button type="submit" className="mt-4 w-full rounded-2xl bg-blue-600 px-4 py-3.5 font-semibold text-white hover:bg-blue-500">Plan with TransitAlert schedule</button>
                </form>

                <div className="min-w-0 overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900 p-4 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300/80">TransitAlert result</p>
                    {journeyStartedAt && journeyRoute.length > 0 && (
                      <button
                        type="button"
                        onClick={finishJourney}
                        className="rounded-full border border-red-300/30 bg-red-500/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-red-100 transition hover:bg-red-500/25"
                      >
                        End journey
                      </button>
                    )}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-white">{journeySummary}</h2>
                  {journeyDisplay && (
                    <div className="mt-4 grid min-w-0 gap-3">
                      {journeyDisplay.legs.map((leg, index) => {
                        const isLiveTrainLeg = leg.mode === "train" && leg === journeyTrainLeg;
                        const isLiveSurfaceLeg = (leg.mode === "bus" || leg.mode === "tram") && leg === journeySurfaceLeg;
                        const liveDepartures = isLiveTrainLeg ? journeyMatchingTrainDepartures : isLiveSurfaceLeg ? journeyMatchingSurfaceDepartures : [];
                        // "Attach" (from Fleet Tracker, or a prior planner run) marks one
                        // specific real vehicle as the one you're actually on — the
                        // independent departures lookup above just picks the next
                        // upcoming service in the same DIRECTION-agnostic route/stop
                        // query, which is a genuinely different, possibly wrong-direction
                        // service (confirmed: a real Route 630 attached vehicle headed to
                        // Elwood, while the departures lookup surfaced upcoming 630s
                        // toward Monash University, the route's other terminus). When the
                        // attached vehicle is a real match for this leg's mode, show its
                        // own current live data instead of guessing from the board.
                        const attachedTripId = attachedJourneyServiceKey?.includes(":")
                          ? attachedJourneyServiceKey.slice(attachedJourneyServiceKey.indexOf(":") + 1)
                          : undefined;
                        // Trains key by consist/tdn first (getVehicleFocusKey), not trip_id —
                        // a plain trip_id lookup would miss most real attached trains.
                        const attachedSurfaceVehicle = isLiveSurfaceLeg && attachedTripId
                          ? (leg.mode === "bus" ? liveFleetBuses : liveFleetTrams).find(
                              (candidate) => (candidate.tripId ?? candidate.id) === attachedTripId,
                            )
                          : undefined;
                        const attachedTrainVehicle = isLiveTrainLeg && attachedJourneyServiceKey
                          ? liveFleetVehicles.find((candidate) => getVehicleFocusKey(candidate) === attachedJourneyServiceKey)
                          : undefined;
                        const attachedLiveVehicle = attachedSurfaceVehicle ?? attachedTrainVehicle;
                        const attachedRouteLabel = attachedTrainVehicle ? attachedTrainVehicle.line : attachedSurfaceVehicle?.route;
                        const legAccentColor = getJourneyLegAccentColor(leg);
                        return (
                          <div
                            key={`${leg.from}-${leg.to}-${index}`}
                            className="min-w-0 overflow-hidden rounded-2xl border p-4"
                            style={{ borderColor: `${legAccentColor}45`, backgroundColor: `${legAccentColor}1A`, color: legAccentColor }}
                          >
                            <p className="text-xs font-semibold uppercase tracking-wider text-current/70">Leg {index + 1} · {leg.mode}</p>
                            <p className="mt-2 break-words font-semibold text-white">{leg.from} → {leg.to}</p>
                            <p className="mt-1 break-words text-sm text-white/55">{leg.title} · {leg.detail}</p>
                            {attachedLiveVehicle && (
                              <button
                                type="button"
                                onClick={() => {
                                  setFocusedVehicleKey(attachedJourneyServiceKey);
                                  setActiveTab("map");
                                  setIsPlannerOpen(false);
                                  setIsSidebarOpen(false);
                                }}
                                className="mt-3 w-full rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2.5 text-left transition hover:bg-cyan-500/20"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">You're on this service</p>
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300/70">Show on map →</p>
                                </div>
                                <p className="mt-1 font-semibold text-white">
                                  {attachedRouteLabel} to {attachedLiveVehicle.destination || "destination"}
                                </p>
                                <p className="mt-1 text-xs text-white/50">Live position tracked — this is the real vehicle you attached to, not a board guess.</p>
                              </button>
                            )}
                            {(isLiveTrainLeg || isLiveSurfaceLeg) && (
                              <div className="mt-3 grid gap-2">
                                {liveDepartures.length > 0 ? liveDepartures.map((departure, departureIndex) => {
                                  // Train departures (VerifiedDeparture) carry a real tripId; bus/tram
                                  // departures (SurfaceStopDeparturesPayload) carry their real run
                                  // identifier as runId instead — no tripId field at all on that type.
                                  const trackingId = "tripId" in departure ? departure.tripId : "runId" in departure ? departure.runId : undefined;
                                  return (
                                  <button
                                    type="button"
                                    key={`${departure.route}-${departure.destination}-${departure.expectedAt || departure.scheduledAt}`}
                                    onClick={() => {
                                      if (!trackingId) return;
                                      const prefix = leg.mode === "train" ? "trip" : leg.mode;
                                      attachJourneyServiceDirect(
                                        `${prefix}:${trackingId}`,
                                        `${departure.route} · to ${departure.destination}`,
                                      );
                                    }}
                                    disabled={!trackingId}
                                    className="w-full rounded-xl border border-blue-300/15 bg-blue-500/10 px-3 py-2.5 text-left transition enabled:hover:bg-blue-500/20 disabled:cursor-default"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-200/75">{departureIndex === 0 ? "Take this service" : "If you miss it · next service"}</p>
                                      {trackingId && <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-300/70">Tap to lock on →</p>}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                                      <p className="font-semibold text-white">
                                        {new Date(departure.expectedAt || departure.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} to {departure.destination}
                                        <span className="ml-2 text-sm font-semibold text-blue-200">({formatRelativeMinutes(departure.expectedAt || departure.scheduledAt)})</span>
                                      </p>
                                      {"platform" in departure && departure.platform && <p className="text-sm font-semibold text-blue-100">Platform {departure.platform}</p>}
                                    </div>
                                    <p className="mt-1 text-xs text-white/50">{departure.route} · {getDepartureDelayLabel(departure)}</p>
                                    {trackingId && (leg.mode === "bus" || leg.mode === "tram" || leg.mode === "train") && (
                                      <JourneyArrivalTime mode={leg.mode} tripId={trackingId} destinationStopName={leg.to} />
                                    )}
                                  </button>
                                  );
                                }) : (
                                  <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">Checking live departure time…</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid gap-3">
                  <a href="https://www.ptv.vic.gov.au/journey/" target="_blank" rel="noreferrer" className="rounded-2xl border border-violet-300/20 bg-violet-500/10 p-4 text-center font-semibold text-violet-100 hover:bg-violet-500/15">Open official PTV planner</a>
                </div>
              </div>
            )}
            {activeTab === "fleets" && (
              <div className="rounded-[2rem] border border-cyan-400/15 bg-[linear-gradient(135deg,_rgba(2,6,23,0.98),_rgba(15,23,42,0.96)_45%,_rgba(8,13,24,1))] p-4 shadow-2xl sm:p-5">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="max-w-2xl text-center xl:text-left">
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/90">Rail Operations Fleet Board</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Live fleet control dashboard</h2>
                      <p className="mt-2 text-sm text-white/60">
                        Dense operations view for live train feed checks, fleet classification, last-seen status, and set identifiers.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
                      <div className="rounded-[1.2rem] border border-cyan-300/10 bg-black/25 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Service Day</p>
                        <p className="mt-2 font-mono text-lg font-semibold text-white">{serviceDayLabel}</p>
                      </div>
                      <div className="rounded-[1.2rem] border border-cyan-300/10 bg-black/25 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Last Updated</p>
                        <p className="mt-2 font-mono text-lg font-semibold text-cyan-200">{isFleetRefreshing ? "Refreshing..." : lastUpdatedLabel}</p>
                      </div>
                    </div>
                  </div>

                  <div className="h-px bg-cyan-300/10" />

                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-200/45" />
                    <input
                      value={fleetSearchQuery}
                      onChange={(event) => setFleetSearchQuery(event.target.value)}
                      placeholder="Search live TDN, car, set, route, or line"
                      className="w-full rounded-[1.1rem] border border-cyan-300/15 bg-black/25 py-3 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-300/45"
                    />
                  </label>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: "Live Trips", value: fleetStats.liveTrips },
                      { label: "Running Now", value: fleetStats.runningNow },
                      { label: "Upcoming Soon", value: fleetStats.upcomingSoon },
                      { label: "Filter", value: selectedFleetFilterLabel },
                    ].map((item) => (
                      <div key={item.label} className="rounded-[1.15rem] border border-white/10 bg-black/25 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/75">{item.label}</span>
                          <span className="font-mono text-lg font-semibold text-white">{item.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                      {allFleetFilterGroups.map((group) => {
                        const accent = FLEET_GROUP_ACCENTS[group.label] ?? FLEET_GROUP_ACCENTS.default;
                        return (
                        <div key={group.label} className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-2.5">
                          <div className="mb-2 flex items-center gap-1.5 px-1">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                              {group.label}
                            </p>
                          </div>
                          {group.label === "Victoria Trams" && isLiveTramsError && group.filters.length === 0 ? (
                            <p className="px-1 text-xs text-white/45">
                              PTV&apos;s live tram feed is down right now — this isn&apos;t a TransitAlert bug, trams will reappear once PTV&apos;s feed recovers.
                            </p>
                          ) : (
                          <div className="relative">
                            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              {group.filters.map((fleet) => {
                                const isSelected = selectedFleetType === fleet.key;
                                const count = getFleetFilterCount(fleet.key);
                                return (
                                  <button
                                    key={fleet.key}
                                    type="button"
                                    onClick={() => setSelectedFleetType(fleet.key)}
                                    className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-left text-[12px] font-medium transition duration-200 active:scale-95 ${
                                      isSelected
                                        ? `${accent.selectedBorder} ${accent.selectedBg} text-white ${accent.selectedGlow}`
                                        : "border-white/10 bg-slate-950/70 text-white/70 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
                                    }`}
                                  >
                                    <span>{fleet.label}</span>
                                    {count > 0 && (
                                      <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                                        isSelected ? "bg-white/15 text-white" : `${accent.countBg} ${accent.countText}`
                                      }`}>
                                        {count}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-950/80 to-transparent" />
                          </div>
                          )}
                        </div>
                        );
                      })}
                  </div>

                  {fleetTripsToDisplay.length > 0 ? (
                    <div className="overflow-hidden rounded-[1.35rem] border border-cyan-300/10 bg-black/30">
                      <div className="grid grid-cols-[92px_minmax(150px,1.1fr)_minmax(130px,0.9fr)_120px_110px_96px_112px] gap-3 border-b border-cyan-300/10 bg-cyan-950/20 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70 max-lg:hidden">
                        <span>Fleet</span>
                        <span>Service</span>
                        <span>Destination</span>
                        <span>Set Number</span>
                        <span>Line</span>
                        <span>Status</span>
                        <span>Last Seen</span>
                      </div>
                      <div className="max-h-[38vh] divide-y divide-white/5 overflow-y-auto">
                        {fleetTripsToDisplay.map((trip) => (
                          <article
                            key={`${trip.fleet}-${trip.tdn}-${trip.id}`}
                            className="grid gap-3 px-4 py-3 text-sm text-white/80 transition hover:bg-cyan-400/[0.04] lg:grid-cols-[92px_minmax(150px,1.1fr)_minmax(130px,0.9fr)_120px_110px_96px_112px] lg:items-center"
                          >
                            <div className="flex flex-col gap-0.5">
                              {/* Trams: the operator ("Operated by Yarra Trams" / a Sydney light
                                  rail operator) leads, above the class name — the same "Operated
                                  by ..." convention transit apps use, so it's the first thing read
                                  rather than a buried Line badge. */}
                              {trip.fleet.startsWith("tram:") && trip.vehicleModel && (
                                <span className="truncate text-[11px] text-white/45">{trip.vehicleModel}</span>
                              )}
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${trip.fleet === "hcmt" ? "bg-sky-300" : trip.fleet === "vlocity" || trip.fleet === "vlocity-standard-gauge" ? "bg-violet-300" : trip.fleet === "n-class" ? "bg-purple-400" : trip.fleet === "sprinter" ? "bg-purple-300" : trip.fleet === "xpt" ? "bg-orange-400" : trip.fleet.startsWith("bus:") ? "bg-amber-400" : trip.fleet.startsWith("tram:") ? "bg-emerald-400" : trip.fleet === "edi-comeng" || trip.fleet === "alstom-comeng" ? "bg-emerald-300" : "bg-cyan-300"}`} />
                                <span className="font-semibold text-white">{fleetTypeLabels.get(trip.fleet) ?? trip.fleet}</span>
                              </div>
                              {/* Category (above) is the physical size class — the real chassis/model
                                  name is shown here underneath so filtering by category never hides
                                  which actual vehicle this is, per the fleet database's per-vehicle model. */}
                              {!trip.fleet.startsWith("tram:") && trip.vehicleModel && (
                                <span className="truncate pl-4 text-[11px] text-white/45">{trip.vehicleModel}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-mono text-cyan-100">{hasPremiumAccess(accountPreferences) ? trip.tdn : getPublicFleetServiceLabel(trip)}</p>
                              <p className="truncate text-xs text-white/45 lg:hidden">{trip.route}</p>
                            </div>
                            <p className="hidden min-w-0 truncate text-white/80 lg:block">{trip.route}</p>
                            <p className="font-mono text-white">{trip.setNumber}</p>
                            <span className={`w-fit rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${trip.lineColor}`}>
                              {trip.line}
                            </span>
                            <span className={`w-fit rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${STATUS_STYLES[trip.status]}`}>
                              {STATUS_LABELS[trip.status]}
                            </span>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-white/65">{trip.statusLabel.replace(/^Seen\s+/i, "")}</span>
                              <button
                                type="button"
                                onClick={() => openLiveTrainOnMap(trip)}
                                className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                              >
                                Track
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>

                      <p className="border-t border-cyan-300/10 px-4 py-3 text-sm text-white/55">
                        Showing {fleetTripsToDisplay.length} live rows for {selectedFleetFilterLabel}. Counts are calculated from the current live feed after fleet classification.
                      </p>
                    </div>
                  ) : shouldLookupFleetHistory && fleetHistoryQuery.data && fleetHistoryQuery.data.status !== "idle" ? (
                    <div className="rounded-[1.8rem] border border-amber-300/20 bg-amber-500/[0.04] p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/80">
                        Not currently running — last known record
                      </p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {fleetHistoryQuery.data.consist}
                        <span className="ml-2 text-sm font-normal text-white/50">
                          last seen{" "}
                          {fleetHistoryQuery.data.last_seen_at
                            ? new Date(fleetHistoryQuery.data.last_seen_at).toLocaleString("en-AU")
                            : "unknown"}
                        </span>
                      </p>
                      {fleetHistoryQuery.data.last_known_position && (
                        <p className="mt-1 text-sm text-white/65">
                          Last known position: {fleetHistoryQuery.data.last_known_position.lat.toFixed(5)},{" "}
                          {fleetHistoryQuery.data.last_known_position.lng.toFixed(5)}
                        </p>
                      )}
                      {fleetHistoryQuery.data.last_service && (
                        <p className="mt-1 text-sm text-white/65">
                          Last service: {fleetHistoryQuery.data.last_service.line ?? "Unknown line"}
                          {fleetHistoryQuery.data.last_service.destination
                            ? ` to ${fleetHistoryQuery.data.last_service.destination}`
                            : ""}
                          {fleetHistoryQuery.data.last_service.tdn ? ` (TDN ${fleetHistoryQuery.data.last_service.tdn})` : ""}
                        </p>
                      )}
                      {(fleetHistoryQuery.data.todays_services?.length ?? 0) > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
                            Services today ({fleetHistoryQuery.data.todays_services!.length})
                          </p>
                          <div className="mt-2 space-y-1.5">
                            {fleetHistoryQuery.data.todays_services!.map((service, index) => (
                              <div
                                key={`${service.tdn}-${index}`}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
                              >
                                <span className="text-white/80">
                                  {service.line ?? "Unknown line"}
                                  {service.destination ? ` → ${service.destination}` : ""}
                                </span>
                                <span className="font-mono text-xs text-white/50">
                                  {new Date(service.firstSeenAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                                  {" – "}
                                  {new Date(service.lastSeenAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : shouldLookupFleetHistory && fleetHistoryQuery.isLoading ? (
                    <div className="rounded-[1.8rem] border border-dashed border-white/15 bg-black/15 px-6 py-16 text-center text-lg text-white/55">
                      Checking sighting history for {trimmedFleetSearchQuery}...
                    </div>
                  ) : !shouldLookupFleetTypeHistory ? (
                    <div className="rounded-[1.8rem] border border-dashed border-white/15 bg-black/15 px-6 py-16 text-center text-lg text-white/55">
                      No live rows match the {selectedFleetFilterLabel} fleet filter right now.
                      {shouldLookupFleetHistory && (
                        <span className="mt-2 block text-sm text-white/40">
                          No sighting history logged for {trimmedFleetSearchQuery} either — tracking only covers sets seen running since this feature was added.
                        </span>
                      )}
                    </div>
                  ) : null}

                  {/* The full fleet-type roster (every known set, in-service or not) shows
                      independent of whether any of them are live right now — a fleet with
                      only a handful of sets in service is exactly the case where you want
                      to see the ones that aren't running too, not just the live ones. */}
                  {shouldLookupFleetTypeHistory && fleetTypeHistoryQuery.isLoading && (
                    <div className="mt-3 rounded-[1.8rem] border border-dashed border-white/15 bg-black/15 px-6 py-16 text-center text-lg text-white/55">
                      Checking sighting history for {selectedFleetFilterLabel}...
                    </div>
                  )}
                  {shouldLookupFleetTypeHistory && fleetTypeHistoryQuery.data && fleetTypeHistoryQuery.data.sets.length > 0 && (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                        Full {selectedFleetFilterLabel} roster ({fleetTypeHistoryQuery.data.sets.filter((s) => s.inService).length} in service,{" "}
                        {fleetTypeHistoryQuery.data.sets.filter((s) => !s.inService).length} not in service)
                      </p>
                      {fleetTypeHistoryQuery.data.sets.map((set) => (
                        <div
                          key={set.setNumber}
                          className={`rounded-[1.4rem] border p-4 ${set.inService ? "border-emerald-300/25 bg-emerald-500/[0.04]" : "border-amber-300/20 bg-amber-500/[0.04]"}`}
                        >
                          <p className="text-lg font-semibold text-white">
                            {set.setNumber}
                            <span
                              className={`ml-2 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${set.inService ? "bg-emerald-500/20 text-emerald-100" : "bg-amber-500/20 text-amber-100"}`}
                            >
                              {set.inService ? "In service" : "Not in service"}
                            </span>
                            <span className="ml-2 text-sm font-normal text-white/50">
                              last seen {new Date(set.lastSeenAt).toLocaleString("en-AU")}
                            </span>
                          </p>
                          {set.lastKnownPosition && (
                            <p className="mt-1 text-sm text-white/65">
                              {set.inService ? "Current position" : "Last known position"}: {set.lastKnownPosition.lat.toFixed(5)},{" "}
                              {set.lastKnownPosition.lng.toFixed(5)}
                            </p>
                          )}
                          <p className="mt-1 text-sm text-white/65">
                            {set.inService ? "Current service" : "Last service"}: {set.lastService.line ?? "Unknown line"}
                            {set.lastService.destination ? ` to ${set.lastService.destination}` : ""}
                            {set.lastService.tdn ? ` (TDN ${set.lastService.tdn})` : ""}
                          </p>
                          <p className="mt-1 text-xs text-white/45">
                            {set.todaysServiceCount} service{set.todaysServiceCount === 1 ? "" : "s"} logged today
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {shouldLookupFleetTypeHistory && fleetTypeHistoryQuery.data && fleetTypeHistoryQuery.data.sets.length === 0 && fleetTripsToDisplay.length === 0 && (
                    <div className="mt-3 rounded-[1.8rem] border border-dashed border-white/15 bg-black/15 px-6 py-16 text-center text-lg text-white/55">
                      No sighting history logged for {selectedFleetFilterLabel} yet — tracking only covers sets seen running since this feature was added.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "pid" && (
              <div className="rounded-[2rem] border border-violet-300/15 bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.18),_rgba(2,6,23,0.98)_48%,_rgba(8,13,24,1))] p-4 text-white shadow-2xl sm:p-5">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-200/85">PID Studio</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight">Passenger information display designer</h2>
                      <p className="mt-2 max-w-2xl text-sm text-white/60">
                        Select a Victorian station, pick platforms, choose display styles, and generate realistic platform, concourse, wall, overview, and operations screens.
                      </p>
                    </div>
                    <span className="rounded-full border border-violet-200/20 bg-violet-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">
                      {pidResolution} · {pidTheme}
                    </span>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                    <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200/80">Controls</p>
                      <div className="mt-4 grid gap-3">
                        <label className="grid gap-1.5 text-sm">
                          <span className="text-white/60">Station</span>
                          <select value={pidStation} onChange={(event) => setPidStation(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white">
                            {PID_STATIONS.map((station) => <option key={station} value={station}>{station}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1.5 text-sm">
                          <span className="text-white/60">Platform</span>
                          <select value={pidPlatform} onChange={(event) => setPidPlatform(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white">
                            {pidPlatforms.map((platform) => <option key={platform} value={platform}>Platform {platform}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1.5 text-sm">
                          <span className="text-white/60">Preview mode</span>
                          <select value={pidPreviewMode} onChange={(event) => setPidPreviewMode(event.target.value as PidPreviewMode)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white">
                            {PID_PREVIEW_MODES.map((mode) => <option key={mode.key} value={mode.key}>{mode.label}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1.5 text-sm">
                          <span className="text-white/60">Style system</span>
                          <select value={pidStyle} onChange={(event) => setPidStyle(event.target.value as PidStyleKey)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white">
                            {PID_STYLE_PRESETS.map((style) => <option key={style.key} value={style.key}>{style.label}</option>)}
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="grid gap-1.5 text-sm">
                            <span className="text-white/60">Density</span>
                            <select value={pidDensity} onChange={(event) => setPidDensity(event.target.value as PidDisplayDensity)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white">
                              {PID_DENSITIES.map((density) => <option key={density} value={density}>{density}</option>)}
                            </select>
                          </label>
                          <label className="grid gap-1.5 text-sm">
                            <span className="text-white/60">Theme</span>
                            <select value={pidTheme} onChange={(event) => setPidTheme(event.target.value as PidThemeMode)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white">
                              {PID_THEMES.map((theme) => <option key={theme} value={theme}>{theme}</option>)}
                            </select>
                          </label>
                        </div>
                        <label className="grid gap-1.5 text-sm">
                          <span className="text-white/60">Screen resolution</span>
                          <select value={pidResolution} onChange={(event) => setPidResolution(event.target.value as (typeof PID_RESOLUTIONS)[number])} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white">
                            {PID_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1.5 text-sm">
                          <span className="text-white/60">Font</span>
                          <select value={pidFont} onChange={(event) => setPidFont(event.target.value as (typeof PID_FONTS)[number])} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white">
                            {PID_FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="grid gap-1.5 text-sm">
                            <span className="text-white/60">Accent</span>
                            <input type="color" value={pidAccentColor} onChange={(event) => setPidAccentColor(event.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 p-1" />
                          </label>
                          <label className="grid gap-1.5 text-sm">
                            <span className="text-white/60">Line colour</span>
                            <input type="color" value={pidLineColor} onChange={(event) => setPidLineColor(event.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 p-1" />
                          </label>
                        </div>
                        <label className="grid gap-1.5 text-sm">
                          <span className="text-white/60">Custom branding</span>
                          <input value={pidBranding} onChange={(event) => setPidBranding(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-white" />
                        </label>
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div
                        className={`overflow-hidden rounded-[1.5rem] border ${pidStyleClasses}`}
                        style={{ borderColor: pidStyle === "custom" ? pidAccentColor : undefined, fontFamily: pidFont.includes("Mono") ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined }}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-current/10 px-4 py-3" style={{ backgroundColor: pidStyle === "custom" ? `${pidAccentColor}22` : undefined }}>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">{pidBranding}</p>
                            <p className="mt-1 text-2xl font-semibold">{pidStation}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-60">Platform {pidPlatform}</p>
                            <p className="font-mono text-2xl font-semibold">{formatServiceClock(new Date().toISOString())}</p>
                          </div>
                        </div>
                        <div className={`grid gap-3 p-4 ${pidPreviewMode === "split" ? "lg:grid-cols-2" : ""}`}>
                          {(pidPreviewMode === "multi-platform" ? pidDepartures : pidPreviewMode === "station-wall" || pidPreviewMode === "concourse" || pidPreviewMode === "departure-board" || pidPreviewMode === "operations" ? pidDepartures : pidPlatformDepartures.length ? pidPlatformDepartures : [pidSelectedDeparture].filter(Boolean)).map((departure) => (
                            <div key={departure.id} className={`rounded-2xl border border-current/10 bg-black/20 ${pidDensity === "dense" ? "p-3" : "p-4"}`}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-60">Next train</p>
                                  <p className="mt-1 text-3xl font-semibold">{departure.destination}</p>
                                  <p className="mt-1 text-sm font-semibold opacity-85">{getPidServiceTypeLabel(departure)}</p>
                                  <p className="mt-1 text-sm opacity-70">{getPidStoppingPattern(departure)}</p>
                                </div>
                                <div className="text-right">
                                  <p className="font-mono text-4xl font-semibold">{departure.time}</p>
                                  <p className="mt-1 text-sm font-semibold uppercase tracking-[0.14em]" style={{ color: departure.status === "Delayed" ? "#fbbf24" : pidLineColor }}>{departure.status}</p>
                                </div>
                              </div>
                              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                                <span className="rounded-xl border border-current/10 bg-black/20 px-3 py-2 text-xs">Length: {pidTrainFeatures.length}</span>
                                <span className="rounded-xl border border-current/10 bg-black/20 px-3 py-2 text-xs">Doors: {pidTrainFeatures.doorSide}</span>
                                <span className="rounded-xl border border-current/10 bg-black/20 px-3 py-2 text-xs">Accessible: cars {pidTrainFeatures.accessible.join(", ")}</span>
                                <span className="rounded-xl border border-current/10 bg-black/20 px-3 py-2 text-xs">Bikes: cars {pidTrainFeatures.bikes.join(", ")}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                        <div className="rounded-[1.5rem] border border-white/10 bg-black/25 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200/80">Train visualisation</p>
                          <div className="mt-4 flex items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-3">
                            {Array.from({ length: pidTrainFeatures.cars }, (_, index) => {
                              const car = index + 1;
                              const isAccessibleCar = pidTrainFeatures.accessible.includes(car);
                              const isBikeCar = pidTrainFeatures.bikes.includes(car);
                              const isFirstClass = pidTrainFeatures.firstClass.includes(car);
                              return (
                                <div key={car} className="min-w-[54px] rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-center">
                                  <p className="text-xs font-semibold text-white">Car {car}</p>
                                  <p className="mt-1 text-[10px] text-white/55">{isFirstClass ? "First" : isAccessibleCar ? "Access" : isBikeCar ? "Bike" : "Std"}</p>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-3 h-2 rounded-full bg-white/10">
                            <div className="h-2 w-2/3 rounded-full" style={{ backgroundColor: pidLineColor }} />
                          </div>
                          <p className="mt-2 text-xs text-white/55">Train position along platform preview. Door side and carriage features are generated from the selected service type.</p>
                        </div>

                        <div className="rounded-[1.5rem] border border-amber-300/20 bg-amber-500/10 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/80">Station features</p>
                          <div className="mt-3 grid gap-2 text-sm text-amber-50/85">
                            <span>Platforms generated: {pidPlatforms.map((platform) => `P${platform}`).join(", ")}</span>
                            <span>Service notes: {pidSelectedDeparture?.status === "Delayed" ? "Delay messaging active" : "Normal operations"}</span>
                            <span>Replacement bus panel: ready for disruption mode</span>
                            <span>Display modes: platform, concourse, wall, overview, operations</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {PID_STYLE_PRESETS.map((style) => (
                      <button
                        key={style.key}
                        type="button"
                        onClick={() => setPidStyle(style.key)}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${pidStyle === style.key ? "border-violet-300 bg-violet-400/15" : "border-white/10 bg-black/20 hover:bg-white/5"}`}
                      >
                        <p className="text-sm font-semibold text-white">{style.label}</p>
                        <p className="mt-1 text-xs leading-5 text-white/55">{style.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "admin" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Network Admin</h2>
                  <p className="mt-1 text-sm text-white/60">
                    Adjust station coordinates and draft line placement changes from your authenticated admin account.
                  </p>
                </div>

                {!isAdmin ? (
                  <div className="max-w-xl rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
                    <p className="text-sm font-semibold text-white">Admin Sign-In Required</p>
                    <p className="mt-1 text-sm text-white/60">
                      This editor is now protected by your account session instead of a local page password.
                    </p>
                    <button
                      type="button"
                      onClick={() => setLocation("/login")}
                      className="mt-4 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-500"
                    >
                      Go to login
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                      <div className="rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
                        <p className="text-sm font-semibold text-white">Account Management</p>
                        <p className="mt-1 text-xs text-white/60">
                          Review registered accounts, adjust role/access, and manually control premium while registration stays tester-only.
                        </p>

                        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                          <p className="text-sm font-semibold text-white">Welcome email broadcast</p>
                          <p className="mt-1 text-xs text-white/60">
                            Sends the "Welcome to TransitAlert" email to every registered account ({adminAccounts.length} accounts). This
                            is a one-off send you trigger manually — it never fires on its own.
                          </p>
                          <button
                            type="button"
                            disabled={broadcastWelcomeMutation.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Send the welcome email to all ${adminAccounts.length} registered accounts now? This can't be undone.`,
                                )
                              ) {
                                broadcastWelcomeMutation.mutate();
                              }
                            }}
                            className="mt-3 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {broadcastWelcomeMutation.isPending ? "Sending..." : "Send welcome email to all users"}
                          </button>
                          {broadcastWelcomeMutation.isSuccess && (
                            <p className="mt-2 text-xs font-semibold text-emerald-300">
                              Sent to {broadcastWelcomeMutation.data.sent} of {broadcastWelcomeMutation.data.total} accounts
                              {broadcastWelcomeMutation.data.failed > 0 ? ` (${broadcastWelcomeMutation.data.failed} failed)` : ""}.
                            </p>
                          )}
                          {broadcastWelcomeMutation.error instanceof Error && (
                            <p className="mt-2 text-xs font-semibold text-amber-300">{broadcastWelcomeMutation.error.message}</p>
                          )}
                        </div>

                        <div className="mt-4 space-y-3">
                          {adminAccounts.length > 0 ? (
                            adminAccounts.map((account) => {
                              const draft = adminAccountDrafts[account.id] ?? {
                                role: account.role,
                                isAdmin: account.isAdmin,
                                isPremium: account.isPremium,
                              };
                              return (
                                <div key={account.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-white">{account.username}</p>
                                      <p className="mt-1 text-xs text-white/55">{account.email || "No email saved"}</p>
                                      <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
                                        Created {account.createdAt ? new Date(account.createdAt).toLocaleString() : "from fallback config"}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/75">
                                        {account.role}
                                      </span>
                                      {account.isAdmin ? (
                                        <span className="rounded-full border border-blue-400/30 bg-blue-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
                                          Admin
                                        </span>
                                      ) : null}
                                      {account.isPremium ? (
                                        <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                                          Premium
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="mt-4 grid gap-3 sm:grid-cols-4">
                                    <label className="block sm:col-span-2">
                                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">Role</span>
                                      <select
                                        value={draft.role}
                                        onChange={(event) => updateAdminAccountDraft(account.id, "role", event.target.value)}
                                        className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none"
                                      >
                                        {ACCOUNT_ROLE_OPTIONS.map((role) => (
                                          <option key={role} value={role}>
                                            {role}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white">
                                      <input
                                        type="checkbox"
                                        checked={draft.isAdmin}
                                        onChange={(event) => updateAdminAccountDraft(account.id, "isAdmin", event.target.checked)}
                                        className="h-4 w-4 rounded border-white/20 bg-slate-950"
                                      />
                                      Admin access
                                    </label>
                                    <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white">
                                      <input
                                        type="checkbox"
                                        checked={draft.isPremium}
                                        onChange={(event) => updateAdminAccountDraft(account.id, "isPremium", event.target.checked)}
                                        className="h-4 w-4 rounded border-white/20 bg-slate-950"
                                      />
                                      Premium tools
                                    </label>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      adminAccountMutation.mutate({
                                        accountId: account.id,
                                        patch: draft,
                                      })
                                    }
                                    className="mt-4 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={adminAccountMutation.isPending}
                                  >
                                    {adminAccountMutation.isPending ? "Saving account..." : "Save account access"}
                                  </button>
                                </div>
                              );
                            })
                          ) : (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/50 px-4 py-8 text-center text-sm text-white/55">
                              No accounts were returned from the current auth source yet.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
                        <p className="text-sm font-semibold text-white">How registration works right now</p>
                        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-white/45">Approved debug testers</p>
                              <p className="mt-2 text-sm text-white/70">
                                These usernames or emails are currently allowed through the tester-only registration gate.
                              </p>
                            </div>
                            <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-200">
                              {approvedDebugTesters.length} approved
                            </span>
                          </div>
                          <div className="mt-4 space-y-2">
                            {approvedDebugTesters.length > 0 ? (
                              approvedDebugTesters.map((tester: ApprovedDebugTesterRecord) => (
                                <div
                                  key={`${tester.source}-${tester.value}`}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-900 px-3 py-2"
                                >
                                  <span className="text-sm font-medium text-white">{tester.value}</span>
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65">
                                    {tester.source === "env"
                                      ? "Env allowlist"
                                      : tester.source === "built-in-account"
                                        ? "Built-in account"
                                        : "Built-in tester"}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 px-3 py-4 text-sm text-white/50">
                                No tester whitelist entries are being returned yet.
                              </div>
                            )}
                          </div>
                        </div>
                        {!isDatabaseConfigured && (
                          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                            The account database is not configured right now. Guest browsing still works, but proper account
                            registration, persistence after refresh/relaunch, and admin account management need
                            <span className="font-semibold text-white"> DATABASE_URL </span>
                            connected on the server.
                          </div>
                        )}
                        <div className="mt-4 space-y-3 text-sm text-white/70">
                          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-white/45">Sign-up gate</p>
                            <p className="mt-2 text-white">
                              Registration is currently limited to approved debug testers from the server allowlist <span className="font-semibold text-blue-200">APPROVED_DEBUG_TESTERS</span>.
                              Version {TRANSITALERT_WEB_VERSION} is the current guest-accessible release, and version 1.0 is where normal public traveller sign-up is meant to open.
                            </p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-white/45">Stored data</p>
                            <p className="mt-2 text-white">
                              We store username, email, password hash, role, admin flag, timestamps, plus preferences like favourites, transport filters, premium access, and saved map behaviour.
                            </p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-white/45">Login + live APIs</p>
                            <p className="mt-2 text-white">
                              Login creates a signed session cookie. Guests can browse viewport-scoped live trains, trams, buses, regional services, and the mixed-mode journey planner.
                              Premium access is controlled from this admin screen and unlocks things like consist favourites and consist-based search.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
                      <p className="text-sm font-semibold text-white">Station Position Editor</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="block sm:col-span-2">
                          <span className="mb-1 block text-xs font-medium text-white/60">Station</span>
                          <select
                            value={adminSelectedStation}
                            onChange={(event) => loadStationDraft(event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none"
                          >
                            {uniqueStations.map((station) => (
                              <option key={station.name} value={station.name}>
                                {station.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-white/60">Latitude</span>
                          <input
                            value={adminLat}
                            onChange={(event) => setAdminLat(event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-white/60">Longitude</span>
                          <input
                            value={adminLng}
                            onChange={(event) => setAdminLng(event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none"
                          />
                        </label>

                        <label className="block sm:col-span-2">
                          <span className="mb-1 block text-xs font-medium text-white/60">Target Line / Group</span>
                          <select
                            value={adminSelectedLine}
                            onChange={(event) => setAdminSelectedLine(event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none"
                          >
                            {lineKeys.map((lineKey) => (
                              <option key={lineKey} value={lineKey}>
                                {lineKey}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={saveStationDraft}
                          className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-500"
                        >
                          Save Draft
                        </button>
                        <button
                          type="button"
                          onClick={() => signOutMutation.mutate()}
                          className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
                        >
                          Sign out
                        </button>
                      </div>

                      <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-sm font-semibold text-white">Cross-City Filter Mode</p>
                        <p className="mt-1 text-xs text-white/60">
                          Switch between one combined Bayside filter or separate Sandringham and Werribee / Williamstown filters.
                        </p>
                        <button
                          type="button"
                          onClick={() => setSplitCrossCityGroup((value) => !value)}
                          className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                          {splitCrossCityGroup ? "Change back to combined Bayside filter" : "Split Sandringham and Werribee / Williamstown"}
                        </button>
                      </div>

                      <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-sm font-semibold text-white">Map Debug Overlay</p>
                        <p className="mt-1 text-xs text-white/60">
                          Pick one line or loop to show admin debug markers on the live map.
                        </p>
                        <label className="mt-3 block">
                          <span className="mb-1 block text-xs font-medium text-white/60">Debug line</span>
                          <select
                            value={adminDebugLineKey}
                            onChange={(event) => setAdminDebugLineKey(event.target.value as AdminDebugLineKey)}
                            className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none"
                          >
                            {ADMIN_DEBUG_LINE_OPTIONS.map((option) => (
                              <option key={option.key} value={option.key}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="mt-3 text-xs text-white/55">
                          For Glen Waverley and Mount Waverley edits in VS Code, use <span className="font-semibold text-white">GLEN_WAVERLEY_STATIONS</span> for stop locations and <span className="font-semibold text-white">GLEN_WAVERLEY_TRACK_POINTS</span> in <span className="font-semibold text-white">src/components/Map.tsx</span> for the drawn route shape between them.
                        </p>
                      </div>

                      <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-sm font-semibold text-white">Runtime API Sources</p>
                        <p className="mt-1 text-xs text-white/60">
                          Choose which live source each part of the app should point at in production.
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {[
                            ["trains", "Trains API"],
                            ["buses", "Buses API"],
                            ["trams", "Trams API"],
                            ["alerts", "Alerts API"],
                            ["shapes", "Shapes / routes API"],
                          ].map(([key, label]) => (
                            <div key={key} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">{label}</p>
                              <select
                                value={adminConfigDraft[key]?.environment ?? "production"}
                                onChange={(event) =>
                                  setAdminConfigDraft((current) => ({
                                    ...current,
                                    [key]: {
                                      environment: event.target.value as "production" | "staging" | "local" | "custom",
                                      url: current[key]?.url ?? "",
                                    },
                                  }))
                                }
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                              >
                                <option value="production">Production</option>
                                <option value="staging">Staging</option>
                                <option value="local">Local / dev</option>
                                <option value="custom">Custom URL</option>
                              </select>
                              <input
                                value={adminConfigDraft[key]?.url ?? ""}
                                onChange={(event) =>
                                  setAdminConfigDraft((current) => ({
                                    ...current,
                                    [key]: {
                                      environment: current[key]?.environment ?? "production",
                                      url: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="https://api.example.com"
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                              />
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void saveAdminConfig(adminConfigDraft)
                              .then((saved) => {
                                setAdminConfigDraft(saved);
                                setAdminMessage("Runtime API source settings saved.");
                              })
                              .catch((error) => {
                                setAdminMessage(error instanceof Error ? error.message : "Failed to save runtime API settings.");
                              });
                          }}
                          className="mt-4 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-500"
                        >
                          Save API source settings
                        </button>
                      </div>
                    </div>

                    <div className="rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
                      <p className="text-sm font-semibold text-white">Draft Preview</p>
                      <div className="mt-4 space-y-3 text-sm text-white/70">
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-white/45">Station</p>
                          <p className="mt-2 text-lg font-semibold text-white">{stationDraftPreview?.name ?? adminSelectedStation}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-white/45">New Coordinates</p>
                          <p className="mt-2 text-white">{adminLat}, {adminLng}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-white/45">Line Assignment</p>
                          <p className="mt-2 text-white">{adminSelectedLine}</p>
                        </div>
                        <p className="text-xs text-white/50">
                          This is a draft editor view for now. The next step would be persisting these adjustments to a backend or config file and reflecting them on the live map.
                        </p>
                        {adminMessage && <p className="text-sm text-blue-200">{adminMessage}</p>}
                      </div>
                    </div>
                  </div>
                  </div>
                )}
              </div>
            )}
              </div>
            </DockedPanelSheet>
          </div>
        </div>
      )}
      </Tabs>

      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-[5] flex justify-center px-4 max-[430px]:bottom-4 sm:bottom-8">
        <button
          onClick={() => {
            if (isGuest) {
              setUserMenuMessage("Create an account to add reports and community updates.");
              setIsUserMenuOpen(true);
              return;
            }
            setIsAddDrawerOpen(true);
          }}
          className="pointer-events-auto group flex min-h-11 max-w-[calc(100vw-8rem)] items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-black shadow-[0_10px_40px_rgba(255,255,255,0.3)] transition-all hover:scale-105 active:scale-95 max-[430px]:max-w-[calc(100vw-6rem)] max-[430px]:px-3.5 sm:min-h-12 sm:px-6 sm:py-3 sm:text-base"
        >
          <div className="rounded-full bg-black p-1 text-white transition-transform duration-300 group-hover:rotate-90">
            <Plus className="h-4 w-4" />
          </div>
          <span className="text-sm tracking-tight sm:text-base">Add a Report</span>
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-[4.4rem] left-2.5 z-30 hidden max-w-[10.75rem] rounded-[1.1rem] border border-white/10 bg-slate-950/78 px-2.5 py-2 text-[9px] leading-3.5 text-white/75 shadow-xl backdrop-blur-xl sm:bottom-6 sm:left-6 sm:block sm:max-w-xs sm:rounded-2xl sm:px-3 sm:py-2.5 sm:text-xs sm:leading-4">
        <p className="font-semibold text-white/85">Copyright 2026 Tyler Rose. TransitAlert.</p>
        <p className="mt-1">
          TransitAlert is an independent project. We are not operated by, affiliated with, or endorsed by the Department of Transport and Planning, Transport Victoria, PTV, or Metro Trains Melbourne.
        </p>
      </div>

        <AddReportDrawer isOpen={isAddDrawerOpen} onClose={() => setIsAddDrawerOpen(false)} />
      </main>
    );
  }


