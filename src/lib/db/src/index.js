import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const isPgliteUrl = databaseUrl.startsWith("pglite://");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function resolvePgliteDataDir(connectionString) {
  const relativePath = connectionString.slice("pglite://".length).replace(/^\/+/, "").trim() || ".local-db/transit-alert";
  return path.resolve(repoRoot, relativePath);
}

function ensurePgliteDataDir(connectionString) {
  const dataDir = resolvePgliteDataDir(connectionString);
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  return dataDir;
}

export const pool = databaseUrl && !isPgliteUrl
  ? new Pool({ connectionString: databaseUrl })
  : null;
export const pglite = isPgliteUrl
  ? new PGlite(ensurePgliteDataDir(databaseUrl))
  : null;
export const db = pglite
  ? drizzlePglite({ client: pglite, schema })
  : pool
    ? drizzleNodePostgres(pool, { schema })
    : null;
export const isDatabaseConfigured = Boolean(databaseUrl);

let databaseReadyPromise = null;

export async function ensureDatabaseReady() {
  if (!pool && !pglite) {
    return false;
  }

  if (!databaseReadyPromise) {
    databaseReadyPromise = (async () => {
      const bootstrapStatements = [
        `
        CREATE TABLE IF NOT EXISTS app_users (
          id text PRIMARY KEY,
          username text NOT NULL UNIQUE,
          email text NOT NULL UNIQUE,
          password_hash text NOT NULL,
          role text NOT NULL DEFAULT 'Traveller',
          is_admin boolean NOT NULL DEFAULT false,
          must_change_password boolean NOT NULL DEFAULT false,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        );
      `,
        `
        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id text PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
          favourite_stops jsonb NOT NULL DEFAULT '[]'::jsonb,
          favourite_routes jsonb NOT NULL DEFAULT '[]'::jsonb,
          selected_map_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
          transport_modes jsonb NOT NULL DEFAULT '["train","vline"]'::jsonb,
          app_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamp NOT NULL DEFAULT now()
        );
      `,
        `
        CREATE TABLE IF NOT EXISTS app_config (
          key text PRIMARY KEY,
          value jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_by text REFERENCES app_users(id) ON DELETE SET NULL,
          updated_at timestamp NOT NULL DEFAULT now()
        );
      `,
        `
        CREATE TABLE IF NOT EXISTS marker_overrides (
          id serial PRIMARY KEY,
          marker_type text NOT NULL DEFAULT 'station',
          marker_name text NOT NULL UNIQUE,
          lat double precision NOT NULL,
          lng double precision NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_by text REFERENCES app_users(id) ON DELETE SET NULL,
          updated_at timestamp NOT NULL DEFAULT now()
        );
      `,
        `
        ALTER TABLE user_preferences
        ALTER COLUMN transport_modes SET DEFAULT '["train","vline"]'::jsonb;
      `,
        `
        ALTER TABLE app_users
        ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
      `,
        `
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          token text PRIMARY KEY,
          user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          expires_at timestamp NOT NULL,
          used_at timestamp,
          created_at timestamp NOT NULL DEFAULT now()
        );
      `,
        `
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          endpoint text PRIMARY KEY,
          p256dh text NOT NULL,
          auth_key text NOT NULL,
          user_id text REFERENCES app_users(id) ON DELETE CASCADE,
          created_at timestamp NOT NULL DEFAULT now(),
          last_seen_at timestamp NOT NULL DEFAULT now()
        );
      `,
        `
        ALTER TABLE push_subscriptions
        ADD COLUMN IF NOT EXISTS notification_categories jsonb;
      `,
        `
        ALTER TABLE push_subscriptions
        ADD COLUMN IF NOT EXISTS notification_lines jsonb;
      `,
        `
        CREATE TABLE IF NOT EXISTS sent_push_alerts (
          alert_id text PRIMARY KEY,
          sent_at timestamp NOT NULL DEFAULT now()
        );
      `,
        `
        CREATE TABLE IF NOT EXISTS fleet_sightings (
          id serial PRIMARY KEY,
          consist text NOT NULL,
          tdn text,
          trip_id text NOT NULL,
          line text,
          destination text,
          train_type text,
          lat double precision,
          lng double precision,
          status text,
          service_date text,
          first_seen_at timestamp NOT NULL DEFAULT now(),
          last_seen_at timestamp NOT NULL DEFAULT now(),
          CONSTRAINT fleet_sightings_consist_trip_unique UNIQUE (consist, trip_id)
        );
      `,
        `
        CREATE INDEX IF NOT EXISTS fleet_sightings_consist_idx ON fleet_sightings (consist);
      `,
      ];

      if (pglite) {
        await pglite.exec(bootstrapStatements.join("\n"));
        return true;
      }

      for (const statement of bootstrapStatements) {
        await pool.query(statement);
      }
      return true;
    })().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }

  return databaseReadyPromise;
}

export * from "./schema/index.js";
