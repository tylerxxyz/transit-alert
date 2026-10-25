import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { appUsersTable } from "./auth.js";

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  authKey: text("auth_key").notNull(),
  userId: text("user_id").references(() => appUsersTable.id, { onDelete: "cascade" }),
  // Which alert category ids (see ALERT_FILTERS in TodaysAlerts.tsx) this
  // subscription wants pushed. null means "every category" — the same
  // behaviour every existing subscriber already had before this column
  // existed, so adding it can never silently mute anyone.
  notificationCategories: jsonb("notification_categories"),
  notificationLines: jsonb("notification_lines"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});

export const sentPushAlertsTable = pgTable("sent_push_alerts", {
  alertId: text("alert_id").primaryKey(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});
