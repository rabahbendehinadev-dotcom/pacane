import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const internalConsumptionsTable = pgTable("internal_consumptions", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  sourceBranchId: integer("source_branch_id").notNull(),
  destinationBranchId: integer("destination_branch_id").notNull(),
  documentDate: timestamp("document_date", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("draft"),
  totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const internalConsumptionItemsTable = pgTable("internal_consumption_items", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  productId: integer("product_id").notNull(),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitId: integer("unit_id"),
  unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInternalConsumptionSchema = createInsertSchema(internalConsumptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInternalConsumption = z.infer<typeof insertInternalConsumptionSchema>;
export type InternalConsumption = typeof internalConsumptionsTable.$inferSelect;
export type InternalConsumptionItem = typeof internalConsumptionItemsTable.$inferSelect;
