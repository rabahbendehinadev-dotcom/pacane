import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertsTable = pgTable("erp_alerts", {
  id: serial("id").primaryKey(),
  alertKey: text("alert_key").notNull().unique(),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("warning"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  module: text("module").notNull(),
  branchId: integer("branch_id"),
  entityId: integer("entity_id"),
  entityType: text("entity_type"),
  meta: jsonb("meta"),
  isRead: boolean("is_read").notNull().default(false),
  readByUserId: integer("read_by_user_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;

export const userNotificationsTable = pgTable("erp_user_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull().default("task_assigned"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  link: text("link"),
  isRead: boolean("is_read").notNull().default(false),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserNotificationSchema = createInsertSchema(userNotificationsTable).omit({ id: true, createdAt: true });
export type InsertUserNotification = z.infer<typeof insertUserNotificationSchema>;
export type UserNotification = typeof userNotificationsTable.$inferSelect;

// ── Push Subscriptions ────────────────────────────────────────────────────────

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: text("device_name"),
  browser: text("browser"),
  os: text("os"),
  isActive: boolean("is_active").notNull().default(true),
  lastActive: timestamp("last_active", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;

// ── Notification Preferences ──────────────────────────────────────────────────

export const notificationPreferencesTable = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  // Channels
  pushEnabled: boolean("push_enabled").notNull().default(true),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  // Types
  prefSales: boolean("pref_sales").notNull().default(true),
  prefRemise: boolean("pref_remise").notNull().default(true),
  prefStockLow: boolean("pref_stock_low").notNull().default(true),
  prefNewProduct: boolean("pref_new_product").notNull().default(false),
  prefReceivables: boolean("pref_receivables").notNull().default(true),
  prefInvoices: boolean("pref_invoices").notNull().default(true),
  prefReturns: boolean("pref_returns").notNull().default(true),
  prefExpenses: boolean("pref_expenses").notNull().default(true),
  prefCustomers: boolean("pref_customers").notNull().default(false),
  prefWorkers: boolean("pref_workers").notNull().default(false),
  prefAbsence: boolean("pref_absence").notNull().default(false),
  prefPrimes: boolean("pref_primes").notNull().default(false),
  prefAvertissements: boolean("pref_avertissements").notNull().default(false),
  prefLeaves: boolean("pref_leaves").notNull().default(false),
  prefUpdates: boolean("pref_updates").notNull().default(true),
  prefSecurity: boolean("pref_security").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type NotificationPreferences = typeof notificationPreferencesTable.$inferSelect;
