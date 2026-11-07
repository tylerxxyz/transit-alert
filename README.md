# Transit Alert 🚆

**Transit Alert** is an independent Melbourne public transport app focused on accurate live transport information for people who actually use the network — including gunzels, commuters and testers.

It is currently being developed as a **native-publishable app with a web version**, with iOS and Android support through the current app build.

> Transit Alert is unofficial and is not affiliated with, endorsed by, or operated by Transport Victoria, PTV, Metro Trains Melbourne, V/Line, Yarra Trams, bus operators, or any other transport authority.

## What Transit Alert does

- 🚆 **Live train tracking** — Metro and V/Line services with live vehicle/service information where the source feed provides it.
- 🚋 **Live tram tracking** — real-time tram positions and service information.
- 🚌 **Live bus tracking** — live buses with route, operator, vehicle and registration information where published.
- 🗺️ **Live map** — transport vehicles, routes, stations and stops in one map.
- 🚉 **Station & stop information** — verified departures, platforms, wayfinding and interchange information.
- 🧭 **Journey planning** — multi-modal journeys using trains, trams, buses and walking.
- 🔔 **Disruptions & notifications** — service alerts with configurable notification categories and line/corridor filters.
- 🚆 **Fleet tools** — search and track physical train sets/cars and view fleet information. Some fleet tools are Premium.
- 📋 **Departure boards** — live departure information for supported stations and stops.
- 🎫 **Fare support** — fare profiles and journey fare information.
- 📍 **Station Passport** — station check-ins, stamps, achievements and challenges.
- 🏛️ **Heritage trains** — heritage services and events.
- 🚂 **Freight** — separate freight service information where reliable data is available.
- 📝 **Community reports** — users can submit transport reports, with moderation and verification tools.
- 🛠️ **Tester/admin tools** — reports, data-quality checks, fleet data, traveller management, announcements and notification tooling.
- 👤 **Profiles & saved places** — traveller profiles, saved stops and personal preferences.

## Data accuracy

Transit Alert follows a **no-fake-data rule**.

Live departures, vehicle positions, platforms, fleet numbers, registrations and service details are only displayed when they can be supported by connected transport data or verified app data. If a value cannot be verified, the app should show it as unavailable rather than inventing an answer.

The app uses transport data sources including **PTV / Transport Victoria GTFS and GTFS-Realtime feeds**, plus NSW transport realtime data for supported NSW services.

## Current status

**Current app line: 1.89 beta**

Transit Alert is actively being developed and tested. Features can change quickly during the beta as live-data accuracy, performance, notifications and mobile behaviour are improved.

The project is intended to become a polished native app while retaining the web version for easy access and testing.

## Main navigation

The current app is organised around:

- **Live map**
- **Plan a trip**
- **Disruptions**
- **Departure boards**
- **Station Passport**
- **Heritage trains**
- **Freight**
- **Fleet / Premium tools**

The exact navigation and feature availability can change between beta releases.

## Notifications

Transit Alert supports web/native push notification infrastructure for service alerts and selected transport events.

Notification delivery is designed to work across:

- the app while open
- background operation
- supported fully-closed native app states

The notification system includes permission handling, subscriptions/tokens, filtering, duplicate suppression and alert formatting.

## Reports & data quality

The app has a reporting workflow rather than blindly accepting every user-submitted value.

Reports can be reviewed by authorised testers/admins and may be accepted, rejected or used to improve verified transport data. Data-quality tooling is also used to identify fleet/operator/register mismatches and other issues.

## Technology

The current application is built as a full-stack React application with:

- **React + TypeScript**
- **Floot native/web runtime**
- **Server endpoints**
- **PostgreSQL-backed persistence**
- **GTFS / GTFS-Realtime**
- **Leaflet / React Leaflet**
- **Push notification infrastructure**
- **Capacitor-based native publishing**

The repository also contains the web/PWA configuration and the project's server-side endpoint and helper code.

## Repository structure

```
components/     Reusable UI components
endpoints/      Server/API endpoints
helpers/        Data, fleet, notification and business logic
pages/          Application pages/routes
static/         App metadata, native configuration and static assets
```

## Development

Install dependencies:

```bash
pnpm install
```

Run the development build:

```bash
pnpm run dev
```

Run the production build:

```bash
pnpm run build
pnpm run start
```

Type-check the project:

```bash
pnpm run typecheck
```

## Security

Do **not** commit:

- transport API subscription keys
- database credentials
- authentication/session secrets
- push notification private keys
- production passwords
- other private deployment credentials

Use the deployment environment for secrets.

## Open source status

The repository contains the project's current source and development history, but Transit Alert is **not currently presented as a fully open-source project with every production dependency and credential configuration exposed**.

If the project is ever abandoned, the intention is to keep the source available rather than let the project disappear.

## Links

- **Live app:** https://transit-alert.com
- **Public web/test build:** https://tylerbnobleday-cmyk.github.io/transit-alert/

## Copyright

© 2026 Tyler Noble-day.

Transit Alert and its original app presentation, code and project assets are independent project work.

Transit Alert is not operated by, affiliated with, or endorsed by Transport Victoria, PTV, Metro Trains Melbourne, V/Line, Yarra Trams, or any other transport authority.
