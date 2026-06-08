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
  estimatedCost: numeric("estimated_cost", { precision: 15, scale: 2 }),
  actualCost: numeric("actual_cost", { precision: 15, scale: 2 }),
  costVariance: numeric("cost_variance", { precision: 15, scale: 2 }),
  wastePercentage: numeric("waste_percentage", { precision: 5, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  bomSnapshot: text("bom_snapshot"),
  explodedMaterialsSnapshot: text("exploded_materials_snapshot"),
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

export const productionOrderItemsTable = pgTable("production_order_items", {
  id: serial("id").primaryKey(),
  productionOrderId: integer("production_order_id").notNull(),
  itemType: text("item_type").notNull().default("product"),
  itemId: integer("item_id").notNull(),
  itemName: text("item_name").notNull(),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitAbbreviation: text("unit_abbreviation").notNull().default("u"),
  unitCostPrice: numeric("unit_cost_price", { precision: 15, scale: 4 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  wastageRate: numeric("wastage_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  nestingLevel: integer("nesting_level").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductionOrderSchema = createInsertSchema(productionOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductionOrder = z.infer<typeof insertProductionOrderSchema>;
export type ProductionOrder = typeof productionOrdersTable.$inferSelect;
export type ProductionOverrideLog = typeof productionOverrideLogsTable.$inferSelect;
export type ProductionOrderItem = typeof productionOrderItemsTable.$inferSelect;
