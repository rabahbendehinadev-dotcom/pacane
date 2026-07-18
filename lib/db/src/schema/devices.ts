import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const userDevicesTable = pgTable("user_devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  deviceType: text("device_type").notNull().default("desktop"),
  deviceName: text("device_name"),
  os: text("os"),
  osVersion: text("os_version"),
  browser: text("browser"),
  browserVersion: text("browser_version"),
  userAgent: text("user_agent"),
  ip: text("ip"),
  loginCount: integer("login_count").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("unknown"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByAdminId: integer("revoked_by_admin_id"),
  revokedReason: text("revoked_reason"),
  isSuspicious: boolean("is_suspicious").notNull().default(false),
  suspiciousReason: text("suspicious_reason"),
});

export const deviceEventsTable = pgTable("device_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  fingerprint: text("fingerprint"),
  deviceType: text("device_type"),
  action: text("action").notNull(),
  adminId: integer("admin_id"),
  reason: text("reason"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  meta: text("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
