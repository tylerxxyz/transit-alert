# TransitAlert

The current self-hosted application serving transit-alert.com is maintained in
[transit-alert-selfhost](https://github.com/tylerbnobleday-cmyk/transit-alert-selfhost).
This repository preserves the earlier Vite application and its development
history. Both repositories belong to the same TransitAlert project; access to
the self-hosted repository follows its existing GitHub visibility settings.

TransitAlert is a free, independent public transit tracking web app for Melbourne, Australia. It
gives commuters live tracking of buses, trams and trains using real-time GTFS transit data, along
with bus bay locations and stop information — all in one lightweight, easy-to-use site. It runs
entirely in the browser at [transit-alert.com](https://transit-alert.com), no app install required.

TransitAlert is developed and maintained by Tyler Noble-day as an independent project. It is not
affiliated with, endorsed by, or operated by Public Transport Victoria (PTV) or any other
government transit authority.

## What it does

- **Live vehicle tracking** — see where buses, trams and trains actually are on their routes, not
  just scheduled times.
- **GTFS-powered data** — built on the same open transit data standard used by transport
  authorities worldwide, kept up to date automatically.
- **Bus bay markers** — know exactly which bay or platform to head to, especially useful at larger
  interchanges.
- Also covers V/Line regional trains, NSW TrainLink/Sydney Trains, and selected freight overlays,
  plus guest browsing and tester/admin tools for validating live transport features.

## Current release

- Web version: `1.0`
- Webpage: [transit-alert.com](https://transit-alert.com)
- Public guest frontend: [GitHub Pages](https://tylerbnobleday-cmyk.github.io/transit-alert/)
- Local/live backend host target: local Node server with optional tunnel or Render-style deployment
- Frontend: Vite + React + TypeScript
- Backend/API style: local Node server with API handlers under [`api/`](api/)

## Version 1.0

The first stable public release, built on top of the 0.9x guest-preview line.

- Real per-stop platform data for Metro trains resolved via a static-schedule + live-feed
  route/start-time match, covering trip IDs the live feed doesn't otherwise match.
- Fixed a live-feed race that could send the same push notification twice.
- Added a real GTFS-sourced planned-works feed from Metro's own public works index, filling in
  car park closures, access changes, and night works the disruption feed alone was missing.
- Corrected V/Line direction/destination reporting (the live feed's own direction field disagreed
  with the static schedule for some regional trips).
- Fixed Fleet Tracker misclassifying VLocity and inbound Stony Point Sprinter services.
- Split NSW/Sydney bus operators into their real contracted-operator categories instead of one
  generic bucket.
- Tram tracking now falls back to a secondary PTV data source when the primary feed is down, and
  surfaces real outages (and recovery) as an in-app alert and push notification instead of
  silently going quiet.
- Alert and push-notification text quality: enriched generic titles with the real cause, fixed a
  duplicate-alert-category bug, corrected stale "X hours ago" timestamps on cancellations, and
  fixed several corridor/station-naming inaccuracies.

## Guest version 0.95

Version `0.95` was the last public guest release before 1.0.

- Guest users can browse the map and planner without making an account
- Signed-in tester/admin accounts now persist in the real embedded database configured through `DATABASE_URL`
- Tester registration is still gated through `APPROVED_DEBUG_TESTERS`
- NSW TrainLink/XPT regional labelling was cleaned up to reduce generic fleet confusion
- Mobile account screens were tightened up so they feel less cramped on narrow phones

## Guest version 0.92

### 0.92 bug fixes

- Connected station cards to the official dated Transport Victoria GTFS schedule with GTFS-Realtime overlays for expected times, delays, cancellations, and skipped stops.
- Live bus markers now open the exact official trip update and show its published upcoming stops, stop IDs, and expected times.
- Added a GitHub Pages SPA fallback so direct and shared app routes no longer return a GitHub 404.
- Kept the no-fake-data rule: unpublished departures, stops, and vehicle details remain unavailable rather than being generated.
- Reported by Jack Miller: the missing verified station replacement after fake boards were removed, and live bus markers not opening their stop sequence.

### 0.91 bug fixes

- Restored Glen Huntly, Ormond, McKinnon, and other in-range station markers that mobile map thinning hid too aggressively.
- Added live bus route, PTV run, vehicle/fleet ID, registration, and current stop fields whenever those values are published by the PTV feed.
- Corrected regional corridor inference so a Maryborough-area train cannot be presented as a Geelong service simply because PTV supplied a generic V/Line label.
- Improved Ballarat, Ararat, Maryborough, and Bendigo regional line alignment and added the missing Bendigo map corridor.
- Removed generated station boards, surface-stop countdowns, regional timelines, freight movements, and PID previews. Missing feeds now show an honest unavailable state.
- Live markers no longer fall back to guessed station coordinates, and nearest mapped bus stops are explicitly labelled as proximity estimates.
- Temporary passwords can now be marked for mandatory replacement at next login; normal account tools remain locked until the user chooses a new password.
- Reported by Jack Miller: missing mobile station labels, inaccurate V/Line alignment/service classification, and the incorrect Town Hall departure shown at Armadale.

### Live-data policy

TransitAlert never presents generated or placeholder departures, times, delays, platforms, service IDs, vehicle positions, registrations, or fleet numbers as real. A user-facing live value must come from a connected transport feed; unavailable fields remain unavailable.

## Main features

- Guest map + planner access for public browsing
- Live Metro, tram, bus, and V/Line map layers
- Premium-gated train lookup tools
- Journey planner with saved active journey state
- Admin panel for:
  - account management
  - runtime config
  - marker overrides
  - approved debug tester visibility
- Freight overlay and selected interstate/XPT support
- Embedded local database hosting via `pglite://...` for self-hosted account persistence

## Copyright

Copyright 2026 Tyler Rose. TransitAlert, its app presentation, and original project assets are Tyler Rose work.

TransitAlert remains an independent project and is not operated by, affiliated with, or endorsed by the Department of Transport and Planning, Transport Victoria, PTV, or Metro Trains Melbourne.

## Account model

Right now the app is still in a tester/admin phase rather than open public registration.

- Public registration is not fully open yet
- Approved debug testers can register while tester mode is active
- Admins can manage roles, premium access, and tester visibility from the app
- A real `DATABASE_URL` is required for proper account persistence
- The local self-host path can use `pglite://.local-db/transit-alert`

## Important environment variables

- `DATABASE_URL`
- `AUTH_SESSION_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_EMAIL` (optional, but supported)
- `APPROVED_DEBUG_TESTERS`
- `PTV_SUBSCRIPTION_KEY`
- `NSW_TRANSPORT_API_KEY` (optional for NSW/XPT live support)

Set `NSW_TRANSPORT_API_KEY` on the live host for NSW TrainLink/XPT realtime support. Do not commit the token into the repo.

## Local development

Install dependencies:

```bash
pnpm install
