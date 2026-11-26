import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBounds } from "leaflet";
import { getApiUrl } from "@/lib/api-config";
import "leaflet/dist/leaflet.css";

type Mode = "train" | "metro" | "tram" | "bus" | "ferry" | "other";
type Network = { id: string; name: string; center: [number, number]; zoom: number; attribution: string; source: string; alertsUrl: string; timezone: string; setup?: string; realtimeAvailable: boolean };
type Stop = { id: string; name: string; lat: number; lng: number; platform: string; modes: Mode[]; routes: string[] };
type TransitRoute = { id: string; sourceId: string; feed: string; name: string; description: string; mode: Mode; color: string; stops: string[]; shape: [number, number][] };
type Index = { network: string; importedAt: string; sources: { id: string; serviceEnd?: string }[]; failures: { id: string; error: string }[]; stops: Stop[]; routes: TransitRoute[] };
type Vehicle = { id: string; feed: string; routeId: string; label: string; lat: number; lng: number; timestamp: string | null; status: string };
type Alert = { id: string; feed: string; title: string; description: string; replacementBus: boolean; upcoming: boolean; stale: boolean; url?: string; affected: { routeId?: string; stopId?: string }[] };
type Live = { vehicles: Vehicle[]; alerts: Alert[]; feeds: { id: string; kind: string; status: string; error?: string }[] };
type Departures = { available: boolean; departures: { routeId: string; tripId: string; time: string; cancelled: boolean; skipped: boolean; status: string }[] };
const MODES: Mode[] = ["train", "metro", "tram", "bus", "ferry", "other"];
const COLORS: Record<Mode, string> = { train: "#fbbf24", metro: "#22d3ee", tram: "#4ade80", bus: "#60a5fa", ferry: "#c084fc", other: "#cbd5e1" };
const inputClass = "rounded-xl border border-white/20 bg-slate-900 px-3 py-2 text-sm text-white";

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("This network’s data is unavailable. Try again shortly or check the operator’s website.");
  return response.json();
}

function MapView({ network, selectedRoute, selectedStop, onBounds }: { network: Network; selectedRoute?: TransitRoute; selectedStop?: Stop; onBounds: (bounds: LatLngBounds) => void }) {
  const map = useMap();
  useMapEvents({ moveend: () => onBounds(map.getBounds()), zoomend: () => onBounds(map.getBounds()) });
  useEffect(() => { map.setView(network.center, network.zoom); onBounds(map.getBounds()); }, [map, network.id]);
  useEffect(() => { if (selectedRoute?.shape.length) map.fitBounds(selectedRoute.shape, { padding: [30, 30], maxZoom: 15 }); }, [map, selectedRoute]);
  useEffect(() => { if (selectedStop) map.setView([selectedStop.lat, selectedStop.lng], 16); }, [map, selectedStop]);
  return null;
}

export default function AustralianNetworks() {
  const [networkId, setNetworkId] = useState(() => new URLSearchParams(window.location.search).get("network") || "nsw");
  const [mode, setMode] = useState<Mode | "all">("all");
  const [search, setSearch] = useState("");
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [tab, setTab] = useState<"routes" | "stops" | "alerts">("routes");
  const [replacementOnly, setReplacementOnly] = useState(false);
  const [bounds, setBounds] = useState<LatLngBounds>();
  const catalog = useQuery({ queryKey: ["australian-network-catalog"], queryFn: ({ signal }) => json<{ networks: Network[] }>(getApiUrl("/api/transit/network"), signal), staleTime: 300_000 });
  const network = catalog.data?.networks.find(n => n.id === networkId) || catalog.data?.networks[0];
  const index = useQuery({ queryKey: ["australian-network-index", network?.id], enabled: !!network && !network.setup,
    queryFn: ({ signal }) => json<Index>(`${import.meta.env.BASE_URL}networks/${network!.id}.json`, signal), staleTime: 300_000 });
  const live = useQuery({ queryKey: ["australian-network-live", network?.id], enabled: !!network?.realtimeAvailable,
    queryFn: ({ signal }) => json<Live>(getApiUrl(`/api/transit/network?network=${encodeURIComponent(network!.id)}`), signal), refetchInterval: 30_000 });
  useEffect(() => { document.title = "Australian networks · Transit Alert"; }, []);
  const routeById = useMemo(() => new Map(index.data?.routes.map(r => [r.id, r]) || []), [index.data]);
  const routeDetails = useQuery({ queryKey: ["australian-route-shape", network?.id, routeId], enabled: !!network && !!routeId,
    queryFn: ({ signal }) => json<{ shape: [number, number][] }>(getApiUrl(`/api/transit/network?network=${encodeURIComponent(network!.id)}&route=${encodeURIComponent(routeId)}`), signal), staleTime: 300_000 });
  const selectedRoute = useMemo(() => { const route = routeById.get(routeId); return route ? { ...route, shape: routeDetails.data?.shape || [] } : undefined; }, [routeById, routeId, routeDetails.data]);
  const selectedStop = index.data?.stops.find(s => s.id === stopId);
  const departures = useQuery({ queryKey: ["australian-stop-departures", network?.id, stopId], enabled: !!network?.realtimeAvailable && !!stopId,
    queryFn: ({ signal }) => json<Departures>(getApiUrl(`/api/transit/network?network=${encodeURIComponent(network!.id)}&stop=${encodeURIComponent(stopId)}`), signal), refetchInterval: 30_000 });
  const query = search.trim().toLocaleLowerCase();
  const routes = useMemo(() => (index.data?.routes || []).filter(r => (mode === "all" || r.mode === mode) && `${r.name} ${r.description}`.toLocaleLowerCase().includes(query)), [index.data, mode, query]);
  const stops = useMemo(() => (index.data?.stops || []).filter(s => (!selectedRoute || s.routes.includes(selectedRoute.id)) && (mode === "all" || s.modes.includes(mode)) && s.name.toLocaleLowerCase().includes(query)), [index.data, selectedRoute, mode, query]);
  const visibleStops = stops.filter(s => !bounds || bounds.contains([s.lat, s.lng])).slice(0, 1200);
  const routeForVehicle = (v: Vehicle) => routeById.get(`${v.feed}:${v.routeId}`);
  const vehicles = (live.data?.vehicles || []).filter(v => {
    const route = routeForVehicle(v);
    return (mode === "all" || route?.mode === mode) && (!selectedRoute || (selectedRoute.sourceId === v.routeId && selectedRoute.feed === v.feed)) && (!bounds || bounds.contains([v.lat, v.lng]));
  }).slice(0, 1500);
  const sameFeed = (alertFeed: string, routeFeed: string) => routeFeed === alertFeed || routeFeed.startsWith(`${alertFeed}/`);
  const alertMatchesRoute = (a: Alert, r: TransitRoute) => sameFeed(a.feed, r.feed) && (!a.affected.length || a.affected.some(e => e.routeId ? e.routeId === r.sourceId : e.stopId ? r.stops.includes(`${r.feed}:${e.stopId}`) : true));
  const alerts = (live.data?.alerts || []).filter(a => (!replacementOnly || a.replacementBus) && (!selectedRoute || alertMatchesRoute(a, selectedRoute)) && (mode === "all" || (index.data?.routes || []).some(r => r.mode === mode && alertMatchesRoute(a, r))) && `${a.title} ${a.description}`.toLocaleLowerCase().includes(query));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: network?.timezone || "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
  const expiredSources = index.data?.sources?.filter(s => s.serviceEnd && s.serviceEnd < today) || [];
  const failedFeeds = live.data?.feeds.filter(f => f.status !== "available") || [];
  const alertFeeds = live.data?.feeds.filter(f => f.kind === "alerts") || [];
  const allAlertsUnavailable = !alertFeeds.length || alertFeeds.every(f => f.status !== "available");
  const changeNetwork = (id: string) => { setNetworkId(id); setRouteId(""); setStopId(""); setSearch(""); setMode("all"); setBounds(undefined); window.history.replaceState(null, "", `?network=${encodeURIComponent(id)}`); };

  return <main className="min-h-screen bg-slate-950 text-white">
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
      <Link href="/" className="text-sm text-sky-300 hover:underline">← Melbourne live map</Link>
      <h1 className="text-xl font-bold">Australian networks</h1>
      <label className="ml-auto flex w-full min-w-0 items-center gap-2 text-sm sm:w-auto">Network
        <select aria-label="Network" className={`${inputClass} min-w-0 flex-1`} value={network?.id || networkId} onChange={e => changeNetwork(e.target.value)}>
          {catalog.data?.networks.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </label>
    </header>
    {catalog.isPending && <p className="p-6" role="status">Loading Australian networks…</p>}
    {catalog.isError && <p className="p-6" role="alert">Couldn’t load the network list. <button className="underline" onClick={() => void catalog.refetch()}>Retry</button></p>}
    {network && <>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <label>Mode <select className={inputClass} value={mode} onChange={e => { setMode(e.target.value as Mode | "all"); setRouteId(""); setStopId(""); }}><option value="all">All modes</option>{MODES.map(m => <option key={m} value={m}>{m === "tram" ? "Tram / light rail" : m[0].toUpperCase() + m.slice(1)}</option>)}</select></label>
        <input aria-label="Search routes, stops or disruptions" placeholder="Search routes, stops or disruptions" className={`${inputClass} min-w-0 flex-1`} value={search} onChange={e => setSearch(e.target.value)} />
        <a href={network.alertsUrl} target="_blank" rel="noreferrer" className="text-sky-300 underline">Official service updates ↗</a>
      </div>
      <div className="px-4 pb-3 text-xs text-slate-300" aria-live="polite">
        {index.isPending && !network.setup ? "Loading published stops and routes… " : index.data ? `${index.data.stops.length.toLocaleString()} stops · ${index.data.routes.length.toLocaleString()} routes · timetable map imported ${new Date(index.data.importedAt).toLocaleDateString("en-AU", { timeZone: network.timezone })}. ` : ""}
        {network.setup || (!network.realtimeAvailable ? "Live tracking and disruption feeds are not connected here. Check official service updates." : "Vehicle timestamps distinguish live, stale and unavailable positions.")}
      </div>
      {(index.isError || live.isError || failedFeeds.length > 0 || !!index.data?.failures.length || expiredSources.length > 0) && <div className="mx-4 mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">
        {index.isError && <p>Stop and route data could not load. <button className="underline" onClick={() => void index.refetch()}>Retry</button></p>}
        {live.isError && <p>Live data could not refresh. Check official service updates. <button className="underline" onClick={() => void live.refetch()}>Retry</button></p>}
        {failedFeeds.length > 0 && <p>{failedFeeds.length} live feeds unavailable; map and alerts may be incomplete.</p>}
        {!!index.data?.failures.length && <p>Timetable coverage is incomplete: {index.data.failures.map(f => f.id).join(", ")} could not be imported.</p>}
        {expiredSources.length > 0 && <p>Some published timetables have expired. Stops and routes may have changed; check the operator before travelling.</p>}
      </div>}
      <div className="grid gap-3 px-4 pb-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-[55vh] min-h-80 overflow-hidden rounded-2xl lg:h-[72vh]">
          <MapContainer center={network.center} zoom={network.zoom} preferCanvas className="h-full w-full" aria-label={`${network.name} transport map`}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapView network={network} selectedRoute={selectedRoute} selectedStop={selectedStop} onBounds={setBounds} />
            {selectedRoute && selectedRoute.shape.length > 0 && <Polyline positions={selectedRoute.shape} pathOptions={{ color: selectedRoute.color, weight: 5 }}><Popup>{selectedRoute.name} · Published route pattern</Popup></Polyline>}
            {visibleStops.map(stop => <CircleMarker key={stop.id} center={[stop.lat, stop.lng]} radius={stop.id === stopId ? 8 : 4} pathOptions={{ color: COLORS[stop.modes[0] || "other"], weight: 2, fillOpacity: 0.8 }} eventHandlers={{ click: () => setStopId(stop.id) }}><Popup><strong>{stop.name}</strong>{stop.platform && <p>Platform / bay {stop.platform}</p>}<p>Published timetable stop · departures in stop details</p><div>{stop.routes.slice(0, 16).map(id => <button key={id} className="m-1 rounded border px-2 py-1" onClick={() => { setRouteId(id); setSearch(""); }}>{routeById.get(id)?.name || id}</button>)}</div></Popup></CircleMarker>)}
            {vehicles.map(v => <CircleMarker key={v.id} center={[v.lat, v.lng]} radius={7} pathOptions={{ color: v.status === "live" ? COLORS[routeForVehicle(v)?.mode || "other"] : "#94a3b8", weight: 3, fillOpacity: v.status === "live" ? 1 : 0.3 }}><Popup><strong>{routeForVehicle(v)?.name || v.routeId || v.label}</strong><p>{v.label} · {v.status}</p><p>{v.timestamp ? `Last position ${new Date(v.timestamp).toLocaleTimeString("en-AU", { timeZone: network.timezone })}` : "Position time unavailable"}</p></Popup></CircleMarker>)}
          </MapContainer>
        </div>
        <section className="min-w-0 rounded-2xl border border-white/10 bg-slate-900 p-3">
          <div className="mb-3 flex gap-2" role="tablist" aria-label="Network information">{(["routes", "stops", "alerts"] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={`flex-1 rounded-lg px-2 py-2 text-sm ${tab === t ? "bg-sky-600" : "bg-white/5"}`} onClick={() => setTab(t)}>{t === "alerts" ? "Disruptions" : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
          {selectedRoute && <div className="mb-3 rounded-lg bg-white/5 p-3 text-sm"><strong>{selectedRoute.name}</strong> {selectedRoute.description}<p className="mt-1 text-xs text-slate-300">One published route pattern; stopping patterns may vary by trip.</p>{routeDetails.isPending && <p>Loading route map…</p>}{routeDetails.isError && <p className="text-amber-200">Route shape unavailable; published stops are still shown.</p>}<button className="mt-2 text-sky-300 underline" onClick={() => { setRouteId(""); setStopId(""); }}>Clear route</button></div>}
          {selectedStop && <section className="mb-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-sm" aria-label="Stop details"><strong>{selectedStop.name}</strong>{selectedStop.platform && <p>Platform / bay {selectedStop.platform}</p>}
            {network.realtimeAvailable && departures.isPending ? <p className="mt-2" role="status">Loading departure predictions…</p> : !departures.data?.available ? <p className="mt-2 text-slate-300">Departure predictions unavailable. Check the operator’s timetable.</p> : !departures.data.departures.length ? <p className="mt-2 text-slate-300">No upcoming predictions in the connected feed. Services may still be scheduled.</p> : <ul className="mt-2 space-y-2">{departures.data.departures.map((d, i) => <li key={`${d.tripId}-${i}`} className="flex justify-between gap-2"><span>{index.data?.routes.find(r => r.sourceId === d.routeId)?.name || d.routeId || "Service"}{d.cancelled ? " · Cancelled" : d.skipped ? " · Not stopping" : ""}</span><span>{new Date(d.time).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZone: network.timezone })} · {d.status}</span></li>)}</ul>}
            <button className="mt-2 text-sky-300 underline" onClick={() => setStopId("")}>Close stop details</button>
          </section>}
          <div className="max-h-[58vh] space-y-2 overflow-y-auto" role="tabpanel">
            {tab === "routes" && <><p className="text-xs text-slate-400">{routes.length} matching routes. Select one to see its stops and map.</p>{routes.slice(0, 200).map(route => <button key={route.id} className="block w-full rounded-xl border border-white/10 p-3 text-left hover:bg-white/10" onClick={() => { setRouteId(route.id); setStopId(""); setSearch(""); }}><span className="font-semibold" style={{ color: route.color }}>{route.name}</span><span className="ml-2 text-xs text-slate-400">{route.mode}</span><p className="mt-1 text-sm text-slate-300">{route.description}</p></button>)}{routes.length > 200 && <p className="text-xs text-slate-400">Search to narrow these results.</p>}</>}
            {tab === "stops" && <><p className="text-xs text-slate-400">{stops.length} matching stops. The map shows up to 1,200 in view.</p>{stops.slice(0, 200).map(stop => <button key={stop.id} className="block w-full rounded-xl border border-white/10 p-3 text-left hover:bg-white/10" onClick={() => setStopId(stop.id)}><strong className="text-sm">{stop.name}</strong><p className="text-xs text-slate-400">{stop.modes.join(" · ")}{stop.platform && ` · Platform / bay ${stop.platform}`}</p></button>)}{stops.length > 200 && <p className="text-xs text-slate-400">Search to narrow these results.</p>}</>}
            {tab === "alerts" && <><label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={replacementOnly} onChange={e => setReplacementOnly(e.target.checked)} />Replacement bus notices</label>
              {live.isPending && network.realtimeAvailable ? <p role="status">Loading disruption feeds…</p> : allAlertsUnavailable ? <p className="text-sm text-amber-200">Disruption data is unavailable here. This does not mean services are running normally. Check official service updates.</p> : !alerts.length ? <p className="text-sm text-slate-300">No matching notices in the connected feeds. Check official updates for changes that may not appear here.</p> : null}
              {alerts.map(alert => <article key={alert.id} className="rounded-xl border border-white/10 p-3"><p className="text-xs text-amber-200">{alert.upcoming ? "Upcoming" : "Current"}{alert.replacementBus ? " · Replacement buses" : ""}{alert.stale ? " · Feed timestamp stale or unavailable" : ""}</p><h2 className="mt-1 font-semibold">{alert.title}</h2><p className="mt-2 whitespace-pre-line text-sm text-slate-300">{alert.description}</p>{alert.url && <a href={alert.url} target="_blank" rel="noreferrer" className="mt-2 block text-sm text-sky-300 underline">Operator details ↗</a>}</article>)}
            </>}
          </div>
        </section>
      </div>
      <footer className="px-4 pb-5 text-xs text-slate-400"><a href={network.source} target="_blank" rel="noreferrer" className="underline">{network.attribution}</a><p className="mt-1">Coverage follows the imported operator feeds. Private ferries, regional operators and unplanned replacement services may be absent.</p></footer>
    </>}
  </main>;
}
