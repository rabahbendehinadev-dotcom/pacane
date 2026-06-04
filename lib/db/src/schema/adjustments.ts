import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adjustmentsTable = pgTable("adjustments", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  branchId: integer("branch_id").notNull(),
  productId: integer("product_id").notNull(),
  quantityChange: numeric("quantity_change", { precision: 15, scale: 3 }).notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  photoData: text("photo_data"), // base64 compressed JPEG
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdjustmentSchema = createInsertSchema(adjustmentsTable).omit({ id: true, createdAt: true });
export type InsertAdjustment = z.infer<typeof insertAdjustmentSchema>;
export type Adjustment = typeof adjustmentsTable.$inferSelect;
