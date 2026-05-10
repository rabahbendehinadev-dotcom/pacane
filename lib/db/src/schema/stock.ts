import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stockLevelsTable = pgTable("stock_levels", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  branchId: integer("branch_id").notNull(),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  productId: integer("product_id").notNull(),
  branchId: integer("branch_id").notNull(),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  reference: text("reference"),
  referenceId: integer("reference_id"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStockMovementSchema = createInsertSchema(stockMovementsTable).omit({ id: true, createdAt: true });
export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
export type StockLevel = typeof stockLevelsTable.$inferSelect;
