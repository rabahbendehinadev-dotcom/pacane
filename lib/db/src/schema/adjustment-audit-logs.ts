import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const adjustmentAuditLogsTable = pgTable("adjustment_audit_logs", {
  id: serial("id").primaryKey(),
  adjustmentId: integer("adjustment_id").notNull(),
  userId: integer("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdjustmentAuditLog = typeof adjustmentAuditLogsTable.$inferSelect;
