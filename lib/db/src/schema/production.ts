import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productionOrdersTable = pgTable("production_orders", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  recipeId: integer("recipe_id").notNull(),
  productId: integer("product_id"),
  plannedQuantity: numeric("planned_quantity", { precision: 15, scale: 3 }).notNull(),
  actualQuantity: numeric("actual_quantity", { precision: 15, scale: 3 }),
  status: text("status").notNull().default("draft"),
  branchId: integer("branch_id").notNull(),
  theoreticalCost: numeric("theoretical_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  actualCost: numeric("actual_cost", { precision: 15, scale: 2 }),
  notes: text("notes"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const productionOverrideLogsTable = pgTable("production_override_logs", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id").notNull(),
  userId: integer("user_id").notNull(),
  reason: text("reason").notNull(),
  availabilitySnapshot: text("availability_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductionOrderSchema = createInsertSchema(productionOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductionOrder = z.infer<typeof insertProductionOrderSchema>;
export type ProductionOrder = typeof productionOrdersTable.$inferSelect;
export type ProductionOverrideLog = typeof productionOverrideLogsTable.$inferSelect;
