# TransitAlert Project Architecture

## 📋 Project Overview
**Name:** @workspace/transit-alert  
**Version:** 0.89.0  
**Type:** Full-stack Vite + React + Node.js  
**Node.js Version:** 22.x  
**Package Manager:** pnpm 10.12.4

---

## 🏗️ Project Structure

### Frontend (React + Vite)
**Location:** `src/`

#### Core Files
- **src/App.tsx** - Main application component with routing, error boundary, and QueryClient setup
- **src/main.tsx** - Vite entry point
- **src/index.css** - Global styles
- **vite.config.ts** - Vite configuration

#### Directory Structure
```
src/
├── components/          # React components
│   ├── AddReportDrawer.tsx
│   ├── ChatPanel.tsx
│   ├── Map.tsx
│   ├── RiskyRoutes.tsx
│   ├── TopBar.tsx
│   └── ui/              # Pre-built UI components (Radix UI + Tailwind)
├── hooks/              # Custom React hooks
│   ├── use-mobile.tsx
│   └── use-toast.ts
├── lib/                # Utility libraries and API clients (see below)
├── pages/              # Page components (routing)
│   ├── Home.tsx
│   ├── Login.tsx
│   ├── Settings.tsx
│   ├── TodaysAlerts.tsx
│   └── not-found.tsx
└── assets/            # Images, icons
    └── icons/
```

#### Routing (wouter)
- `/` → Login page
- `/app` → Home page
- `/settings` → Settings page
- `/login` → Login page
- `/alerts/today` → Today's Alerts page

#### UI Framework Stack
- **Radix UI** - Component primitives
- **Tailwind CSS** - Styling
- **Shadcn/ui** - Pre-built components using Radix + Tailwind
- **Lucide React** - Icons
- **Framer Motion** - Animations
- **Recharts** - Charts and visualizations

### Backend (Node.js + Express-like routing)
**Locations:** `server/` and `api/`

#### Main Backend Entry Point
- **server/render-server.js** - Node.js HTTP server that:
  - Routes `/api/*` requests to handlers
  - Serves static SPA files (dist/index.html)
  - Handles content-type negotiation
  - Imports all API route handlers

#### API Routes Structure
**Location:** `api/`

```
api/
├── _lib/
│   └── auth.js              # Shared authentication utilities
├── admin/
│   └── [resource].js        # Admin settings and accounts management
├── auth/
│   └── [action].js          # Auth actions: session, login, register, logout, guest, roles
├── consist/
│   └── [consist].js         # Train consist tracking
├── metro-notify/
│   └── alerts.js            # Metro alert notifications
├── preferences/
│   └── [[...slug]].js       # User preferences storage
├── ptv/
│   ├── live-buses.js        # PTV real-time bus data
│   ├── live-trains.js       # PTV real-time train data
│   └── live-trams.js        # PTV real-time tram data
├── reports/
│   └── [[...slug]].js       # User incident reports
└── telegram/
    └── status.js            # Telegram bot status
```

#### API Routing Resolution
The server uses `getApiResolution()` to route requests:
- `/api/auth/[action]` → authHandler
- `/api/preferences/[[...slug]]` → preferencesHandler
- `/api/reports/[[...slug]]` → reportsHandler
- `/api/admin/[resource]` → adminHandler
- `/api/consist/[consist]` → consistHandler
- `/api/metro-notify/alerts` → metroNotifyAlertsHandler
- `/api/ptv/live-buses` → liveBusesHandler
- `/api/ptv/live-trains` → liveTrainsHandler
- `/api/ptv/live-trams` → liveTramsHandler
- `/api/telegram/status` → telegramStatusHandler

---

## 📡 Frontend-Backend Communication

### API Client Library Files

**src/lib/** contains all API communication logic:

| File | Purpose |
|------|---------|
| **http-json.ts** | HTTP response utilities (`readJsonResponse`, `readJsonErrorMessage`) |
| **auth.ts** | Auth API calls (login, register, logout, fetchAuthSession) |
| **admin-config.ts** | Admin settings and accounts API |
| **preferences.ts** | User preferences fetch/save |
| **live-buses.ts** | Fetch real-time bus data from `/api/ptv/live-buses` |
| **live-trains.ts** | Fetch real-time train data from `/api/ptv/live-trains` |
| **live-trams.ts** | Fetch real-time tram data from `/api/ptv/live-trams` |
| **community-chat.ts** | Community chat messages |
| **marker-overrides.ts** | Map marker configuration |
| **todays-alerts.ts** | Today's transport alerts |

### HTTP Request Pattern
```typescript
const response = await fetch("/api/endpoint", {
  method: "POST|GET",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

// Response handling via http-json.ts utilities
const data = await readJsonResponse(response, "label");
```

### React Query Integration
- **App.tsx** initializes `QueryClient` with:
  - `retry: 1`
  - `refetchOnWindowFocus: false`
- Uses `@tanstack/react-query` v5.90.21 for data fetching and caching

---

## 🗄️ Database

### Database Setup
- **Type:** PostgreSQL
- **ORM:** Drizzle ORM v0.44.6
- **Config:** `src/lib/db/drizzle.config.ts`
- **Environment Variable:** `DATABASE_URL`

#### Database Configuration
```typescript
// src/lib/db/drizzle.config.ts
dialect: "postgresql"
schema: ./src/schema/index.ts
```

#### Database Module
- **Location:** `src/lib/db/src/`
- Files:
  - `index.ts` / `index.js` - Database initialization and exports
  - `schema/` - Drizzle schema definitions

#### Dependencies
- **drizzle-orm** - ORM
- **drizzle-zod** - Zod schema integration
- **pg** - PostgreSQL client

---

## 🚀 Deployment Configurations

### 1. **Render.yaml** (Primary Production Deployment)
```yaml
Service: transit-alert (Node.js web service)
Runtime: Node
Plan: Free
Build: pnpm install --frozen-lockfile && pnpm build
Start: node server/render-server.js
Database: PostgreSQL (transit-alert-db)
```

### 2. **Netlify.toml** (Netlify Deployment)
```toml
Build: pnpm build
Publish: dist/
Functions: netlify/functions/
  - API routes in netlify/functions/api.js
  - Included files: api/**, src/lib/db/**, vendor/**
Rewrites:
  - /api/* → /.netlify/functions/api/:splat
  - /* → /index.html (SPA)
```

### 3. Vercel (deprecated)
Vercel deployment configuration removed from this repository. The primary deployment options are Render and Netlify; Vercel-specific files (e.g. `vercel.json`) have been removed.

---

## 🔧 NPM/PNPM Scripts

| Script | Purpose |
|--------|---------|
| `dev` | Start dev server: `vite --host 0.0.0.0` |
| `build` | Production build: `vite build` |
| `build:workspace` | Build all workspace packages |
| `serve` | Preview production build |
| `start` | Run backend: `node server/render-server.js` |
| `typecheck` | Type check with TypeScript |
| `typecheck:libs` | Type check library files |
| `typecheck:workspace` | Type check entire workspace |

---

## 📦 Key Dependencies

### Frontend Dependencies
- **React** 19.1.0
- **React DOM** 19.1.0
- **Vite** 7.3.0
- **TypeScript** 5.9.3
- **Tailwind CSS** 4.1.14
- **Radix UI** (various components)
- **React Query** 5.90.21
- **React Hook Form** 7.55.0
- **Wouter** 3.3.5 (routing)
- **Sonner** 2.0.7 (toasts)
- **Zod** 3.25.76 (validation)
- **Framer Motion** 12.35.1
- **Recharts** 2.15.2
- **React Leaflet** 5.0.0 (mapping)

### Backend Dependencies
- **Drizzle ORM** 0.44.6
- **PostgreSQL Client (pg)** 8.16.3
- **GTFS Realtime Bindings** 1.1.1
- **Protobufjs** 8.0.1
- **Leaflet** 1.9.4

### Vite Plugins
- **@vitejs/plugin-react** 5.0.4
- **@tailwindcss/vite** 4.1.14
- **@replit/vite-plugin-runtime-error-modal**
- **@replit/vite-plugin-cartographer**

---

## 🔐 Authentication System

### Authentication Flow (api/auth/[action].js)
- **session** - Get current session user
- **roles** - Get available roles
- **login** - Username/password login
- **register** - New user registration
- **logout** - Clear session
- **guest** - Guest account creation

### Session Management
- Uses cookies: `transitalert_session`
- Session secret from `process.env.AUTH_SESSION_SECRET` or computed hash
- Fallback users for development
- Rate limiting on auth endpoints

### Admin Configuration
- Default admin credentials from environment variables:
  - `ADMIN_USERNAME` (default: "admin")
  - `ADMIN_PASSWORD` (required for admin password login; no default)
  - `ADMIN_EMAIL`

---

## 📊 External APIs Integrated

### Public Transport Victoria (PTV)
- **Base URLs:**
  - Metro trains: `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/metro`
  - V/Line trains: `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/vline`
  - Trams: `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/tram`
  - Buses: `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1/bus`
- Uses GTFS Realtime format (protobuf)
- Requires PTV subscription key

### NSW Trains (Australia)
- **URL:** `https://api.transport.nsw.gov.au/v2/gtfs/vehiclepos/nswtrains`

### Metro Healthboard (Melbourne)
- **URL:** `https://www.metrotrains.com.au/api?op=get_healthboard_alerts`

### TransportVic Bot
- **Base URL:** `https://transportvic.me`

---

## 📝 Configuration Constants (vite.config.ts)

### Pre-configured Transport Routes & Stations
- **Metro Melbourne Lines:** Defined stations across CBD, suburbs
- **Tram system:** Coverage area and routes
- **Bus system:** NSW coverage boundaries
- **Train types:** Metro Train, V/Line Train

### Role Options
- Admin
- Traveller
- Train Driver
- Station Staff
- Special
- Friend
- Bug Tester

---

## 🔄 Development Workflow

### Local Development
```bash
# Start dev server with hot reload
pnpm run dev

# In another terminal, start backend
pnpm run start

# The Vite dev server runs on 0.0.0.0:5173 (default)
# Backend server runs on 0.0.0.0:3000 (default)
```

### Production Build
```bash
# Build frontend
pnpm run build

# Start production server
pnpm run start
```

---

## 📂 Static Files & Assets

- **public/** - Static files served as-is
  - `site.webmanifest` - PWA manifest
  - `images/` - Image assets
- **vendor/** - Third-party code
  - `ptv/gtfs-realtime.cjs` - GTFS Realtime protobuf definitions
  - `ptv/protobuf.min.cjs` - Protobuf library

---

## 🎯 Key Architectural Patterns

1. **Monorepo Structure:** pnpm workspace with shared database library
2. **API-First Backend:** Node.js HTTP server with route handlers in ES modules
3. **SPA Frontend:** React with Vite, served by backend fallback to index.html
4. **Type Safety:** TypeScript throughout, with Zod validation
5. **Database:** PostgreSQL with Drizzle ORM, migrations-based schema
6. **Deployment Ready:** Multiple platform configs (Render, Netlify)
7. **Real-time Data:** GTFS Realtime feeds for live transport data
8. **Component Library:** Shadcn/ui for consistent, accessible UI

---

## 🔗 File References Summary

### Critical Configuration Files
- `vite.config.ts` - Frontend build config with pre-defined constants
- `server/render-server.js` - Backend HTTP server and routing
- `src/lib/db/drizzle.config.ts` - Database ORM configuration
- `render.yaml` - Render deployment config
- `netlify.toml` - Netlify deployment config
-- (removed) `vercel.json` - Vercel deployment config (deleted)

### Core Communication Files
- `src/lib/http-json.ts` - Response parsing utilities
- `src/lib/auth.ts` - Authentication API
- `src/lib/live-buses.ts`, `live-trains.ts`, `live-trams.ts` - Transport data APIs
- `src/lib/preferences.ts` - User preferences API
- `api/auth/[action].js` - Backend auth handler
- `api/ptv/*.js` - Real-time transport data handlers

### UI & Pages
- `src/App.tsx` - Main app component and routing
- `src/pages/*` - Page components
- `src/components/` - Reusable components
- `src/components/ui/` - Shadcn/ui component library
