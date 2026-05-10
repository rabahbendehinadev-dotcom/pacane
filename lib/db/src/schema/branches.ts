import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const branchesTable = pgTable("branches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  type: text("type").notNull().default("shop"),
  address: text("address"),
  city: text("city"),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  isMain: boolean("is_main").notNull().default(false),
  // POS configuration
  posEnabled: boolean("pos_enabled").notNull().default(true),
  requireOpenSession: boolean("require_open_session").notNull().default(false),
  salesActive: boolean("sales_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBranchSchema = createInsertSchema(branchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type Branch = typeof branchesTable.$inferSelect;
