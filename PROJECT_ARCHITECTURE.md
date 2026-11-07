# Transit Alert — Project Architecture

This document describes the **current Transit Alert application**, rather than the older pre-Floot architecture.

## Overview

Transit Alert is a full-stack React/TypeScript public transport application developed for Melbourne and selected NSW services.

The current project is designed for:

- web deployment
- PWA-style browser use
- native iOS/Android publishing through the app runtime
- server-side data processing
- persistent accounts/preferences/reports
- real-time transport feeds

The project is actively evolving during the beta, so this document intentionally describes the architecture at a high level rather than freezing implementation details that may change.

## Frontend

The frontend is React + TypeScript.

### Main areas

- Live map
- Journey planner
- Disruptions
- Departure boards
- Stations/stops
- Fleet
- Station Passport
- Heritage
- Freight
- Account/settings
- Traveller profiles
- Admin/tester tools

### Reusable components

The `components/` directory contains the application's UI and domain components, including:

- live vehicle layers
- departure lists
- journey timelines
- service panels
- vehicle/fleet details
- notification settings
- reports
- Passport
- station wayfinding
- Southern Cross-specific layouts
- admin/data-quality interfaces

## Server endpoints

The `endpoints/` directory contains the server-side API surface.

Major endpoint groups include:

- authentication and account management
- live departures
- live vehicles
- journey/service tracking
- station information
- nearby stops
- fare information
- notifications/push subscriptions
- user reports
- admin reports and data quality
- fleet and fleet history
- Passport
- heritage/freight-related data
- NSW realtime services
- Southern Cross platform information

Endpoints are kept backwards-compatible because the project is also deployed as a native mobile app.

## Helpers / business logic

The `helpers/` directory contains shared application logic for:

- PTV realtime data
- GTFS/static schedules
- Metro network and line geometry
- V/Line services and fleet
- bus operators and fleet registers
- train fleet identification
- vehicle diagnostics
- service alerts
- push notifications
- notification formatting
- reporting/moderation
- fares
- station indexing and wayfinding
- Passport
- heritage events
- freight
- NSW realtime data

## Transport data

Transit Alert combines verified transport data from supported public feeds.

The core Melbourne data pipeline uses PTV / Transport Victoria GTFS and GTFS-Realtime sources for supported:

- Metro trains
- V/Line
- trams
- buses

NSW realtime data is used for supported NSW TrainLink/Sydney services.

The app is deliberately conservative with data: unsupported or unavailable values should remain unavailable instead of being generated.

## Live vehicle model

Where the source data permits, a vehicle can carry information such as:

- operator
- route
- service/run
- vehicle/fleet number
- registration
- current position
- current/next stop
- destination
- platform
- consist/set information

Train fleet tooling can resolve individual physical sets/cars when the available data is sufficient.

## Notifications

The notification stack includes:

1. browser/native permission handling
2. push subscription/token registration
3. server-side preference storage
4. alert filtering
5. notification formatting
6. duplicate suppression
7. delivery to supported app states
8. unsubscribe/token refresh handling

Notification filters can be based on alert categories and supported lines/corridors.

## Reports and moderation

User reports are stored and exposed through a moderation workflow.

Authorised testers/admins can review reports and take actions such as:

- accept/verify
- reject
- resolve/close
- use the report to investigate data quality

This is deliberately separate from blindly treating every community report as authoritative live data.

## Accounts and persistence

The application supports authenticated users, tester/admin roles, preferences, saved stops, Passport progress and other persistent state.

Sensitive credentials and production secrets belong in the deployment environment and must not be committed to Git.

## Native publishing

The project is configured for native mobile publishing through the app runtime.

Native-specific configuration is kept under:

```
static/__dev/native/
```

This includes Android manifest and iOS Info.plist configuration used by the native builds.

Because the application is deployed natively, backend API changes must preserve existing request/response contracts unless a coordinated app update is intended.

## Repository layout

```
components/      React/UI components
endpoints/       Server endpoints
helpers/         Shared business/data logic
pages/           App routes/pages
static/          Static and native configuration
```

## Current development philosophy

Transit Alert is intended to behave more like a **live transport instrument** than a generic travel app.

Key principles:

- real data over guessed data
- clear live/verified states
- compact information-dense UI
- accurate fleet/service identifiers
- explicit unavailable states
- strong notification controls
- useful tools for transport enthusiasts and everyday passengers
- test and moderation workflows before questionable data becomes authoritative

## Current beta

The app is currently in active beta development. Architecture and feature details may change as the live data pipeline, native notification behaviour, performance and user-facing features continue to be improved.
