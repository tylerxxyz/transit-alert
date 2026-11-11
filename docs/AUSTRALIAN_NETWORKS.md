# Australian network coverage

Checked and imported 30 October 2026. Open **Australian networks** from the main navigation, or `/networks`.

## Implemented

| Dataset | Stop records | Route records | Live integration |
| --- | ---: | ---: | --- |
| Sydney & NSW | 40,874 | 6,526 | Vehicles, disruption notices, departure predictions |
| South East Queensland | 13,117 | 1,144 | Vehicles, disruption notices, departure predictions |
| Cairns | 463 | 22 | Vehicles, disruption notices, departure predictions |
| Regional Queensland | 3,578 | 137 | Published stops/routes; official update link |
| Adelaide | 9,158 | 717 | Vehicles, disruption notices, departure predictions |
| Perth | 14,875 | 422 | Published stops/routes; official update link |
| Tasmania | 3,436 | 346 | Published stops/routes, including Derwent Ferry; official update link |
| Darwin & Palmerston | 624 | 38 | Published stops/routes; official update link |
| Alice Springs | 99 | 8 | Published stops/routes; official update link |
| Canberra | — | — | Explicit developer-access message; official update link |

Total: **86,224 stop records and 9,360 route records**, across 35 schedule feeds. These are source records, not deduplicated physical stops or unique passenger-facing lines. Multiple directions, operators, platforms and service variants can have separate records. Melbourne's existing interface remains available.

Sydney includes suburban/intercity trains, Metro, buses, published replacement-bus routes, Sydney Ferries, Manly Fast Ferry, Inner West/CBD/Newcastle/Parramatta light rail and NSW TrainLink. Regional Queensland includes 17 official feeds covering Bowen, Bundaberg, Gladstone, Gympie, Innisfail, Kilcoy, Mackay, Magnetic Island buses/ferries, Maleny–Landsborough, Maryborough–Hervey Bay, North Stradbroke Island, Rockhampton–Yeppoon, Toowoomba, Townsville, Warwick and Whitsundays.

The map supports mode/search filters, stops and platforms/bays, one published shape per route, live position age, stop departure predictions where the connected feed supplies absolute times, current/upcoming disruption notices and a replacement-bus notice filter. Agency update links remain visible when machine-readable data is unavailable. Feed failure is never reported as good service.

## What the code review found

- The original Sydney endpoint covered bus positions, Metro and CBD/Newcastle light rail; it did not provide the stop/line/wharf/alert catalogue requested here.
- Its Metro vehicle URL was v1. An authenticated request returned a header timestamp from September 2024. Both the new network view and existing Sydney layer now use v2. TfNSW documents the old Metro URLs as unsupported: [Metro feed transition](https://opendataforum.transport.nsw.gov.au/t/ptms-sydney-metro-v2-gtfs-feed/4075).
- The existing Sydney light-rail layer now also includes Inner West and Parramatta.
- Perth's official stop CSV has spaces in header names. The importer trims headers; a regression test ensures it cannot silently import zero stops again.
- NSW concurrent requests produced HTTP 429. The new API coalesces and caches requests, paces NSW requests and backs off rate-limited feeds.
- Canberra's current timetable endpoint returned HTTP 401. The old downloadable timetable ends in July 2025. It is not presented as current data. The [current developer guide](https://www.transport.act.gov.au/contact-us/information-for-developers) identifies the new MyWay+ access method.

## Platform competitor research

[Platform's official website](https://platformtransit.com/) positions the app around Sydney transport, native iPhone/Android experiences, journey planning/tracking, saved journeys and clear live/predicted/timetable/stale/unavailable labels. It advertises iPhone Live Activities/Dynamic Island and Android ongoing tracking, with no account or ads. These are the company's published claims; its installed beta was not tested.

Instagram searches did not establish a verified profile or return posts. Agent Reach's Instagram lookup could not run because its browser extension connection was not configured. No extension was installed and no Instagram content, follower counts or engagement figures were inferred.

Product recommendation: build national coverage around reliable stop/wharf details, replacement-bus boarding locations and precise affected-service notices. Native journey tracking, notifications and saved journeys also matter competitively; adding a city label alone is insufficient. This is a recommendation, not a claim that Platform lacks those features.

## Sources and limits

Source manifests and download URLs live in `api/_lib/australian-networks.js`. Schedule archives were actually downloaded and parsed, rather than relying on third-party feed directories. Official references: [TfNSW documentation](https://opendata.prod.transport.nsw.gov.au/developers/documentation), [Translink open data](https://translink.com.au/about-translink/open-data), [Adelaide Metro developers](https://www.adelaidemetro.com.au/developer-info), [Transperth spatial data](https://www.transperth.wa.gov.au/About/Spatial-Data-Access), [Tasmania GTFS](https://www.transport.tas.gov.au/public_transport/gtfs-data), [NT timetable data](https://dli.nt.gov.au/data/bus-timetable-data-and-geographic-information).

Remaining scope: Canberra developer access; live/alert access for Perth, Tasmania and NT; regional/private operators not in these feeds; scheduled departure fallback outside live coverage; countrywide journey planning; national push subscriptions and native journey tracking. This change does not claim full Melbourne feature parity or complete coverage of every Australian transport operator. Replacement notices are identified from published notice text; a replacement vehicle is not invented when its operator provides no position.

Refresh schedule snapshots with `pnpm import:networks` (requires `NSW_TRANSPORT_API_KEY` for NSW), or pass dataset IDs, e.g. `pnpm import:networks tasmania seq`. Run `pnpm verify:networks`, then `pnpm build`. Schedule refresh is manual in this implementation; service-end metadata and an expired-timetable warning are included. Geometry is stored compressed on the server and fetched only for the selected route; stop/route indexes are compressed over HTTP by the Node host.

## Verification

- Production Vite build passed.
- Five focused tests passed: CSV edge cases, extended mode types, stale positions, notice expiry/replacement works and departure cancellation/skipped-stop handling.
- All imported stop/route references and geometry files passed validation; no schedule feeds failed in the final import.
- Browser: selected Sydney F1, observed its route map; selected Tasmania and verified F2 Derwent Ferry and the unavailable-disruption message.
- Runtime NSW check returned 990 vehicle records and 231 notices with no failed feeds at that instant. Queensland and Adelaide also returned vehicles and notices. Counts change continuously and are not fleet totals.
- Full repository typecheck remains blocked by existing errors in Map, Home, TopBar and missing development type packages. No errors were reported in the new page or App changes. The build also emits an existing tooltip sourcemap warning.

Changes are local and uncommitted. The isolated preview runs on port 3210 with database/push disabled and Victoria graph warm-up pointed at an absent test archive; it is for this new network view, not a replacement for the regular host. The existing host was not restarted and no production deployment was triggered.
