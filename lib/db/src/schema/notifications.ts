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
  isRead: boolean("is_read").notNull().default(false),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserNotificationSchema = createInsertSchema(userNotificationsTable).omit({ id: true, createdAt: true });
export type InsertUserNotification = z.infer<typeof insertUserNotificationSchema>;
export type UserNotification = typeof userNotificationsTable.$inferSelect;
