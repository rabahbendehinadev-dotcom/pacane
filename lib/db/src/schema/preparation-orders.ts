import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const preparationOrdersTable = pgTable("preparation_orders", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  branchId: integer("branch_id").notNull(),
  workerId: integer("worker_id").notNull(),
  sourceReplenishmentDate: text("source_replenishment_date").notNull(),
  sourceWeekdayGroup: text("source_weekday_group"),
  sourceContext: text("source_context"),
  status: text("status").notNull().default("new"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const preparationOrderItemsTable = pgTable("preparation_order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  productId: integer("product_id").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  skuSnapshot: text("sku_snapshot"),
  unitSnapshot: text("unit_snapshot").notNull().default(""),
  quantityToPrepare: numeric("quantity_to_prepare", { precision: 15, scale: 3 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPreparationOrderSchema = createInsertSchema(preparationOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPreparationOrder = z.infer<typeof insertPreparationOrderSchema>;
export type PreparationOrder = typeof preparationOrdersTable.$inferSelect;

export const insertPreparationOrderItemSchema = createInsertSchema(preparationOrderItemsTable).omit({ id: true, createdAt: true });
export type InsertPreparationOrderItem = z.infer<typeof insertPreparationOrderItemSchema>;
export type PreparationOrderItem = typeof preparationOrderItemsTable.$inferSelect;
