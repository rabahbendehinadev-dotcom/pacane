import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adjustmentsTable = pgTable("adjustments", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  branchId: integer("branch_id").notNull(),
  productId: integer("product_id"), // nullable for multi-item adjustments
  quantityChange: numeric("quantity_change", { precision: 15, scale: 3 }), // nullable for multi-item
  reason: text("reason").notNull(),
  notes: text("notes"),
  photoData: text("photo_data"), // base64 compressed JPEG
  createdByUserId: integer("created_by_user_id"),
  // Confirmation workflow
  overallStatus: text("overall_status"), // NULL=legacy | 'en_attente' | 'confirme' | 'non_confirme'
  workerOneId: integer("worker_one_id"),  // worker (workers table) who did the déstockage
  confirmedByUserId: integer("confirmed_by_user_id"), // last user who acted on confirmation
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdjustmentSchema = createInsertSchema(adjustmentsTable).omit({ id: true, createdAt: true });
export type InsertAdjustment = z.infer<typeof insertAdjustmentSchema>;
export type Adjustment = typeof adjustmentsTable.$inferSelect;
