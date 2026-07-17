import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";

export const adjustmentItemsTable = pgTable("adjustment_items", {
  id: serial("id").primaryKey(),
  adjustmentId: integer("adjustment_id").notNull(),
  productId: integer("product_id").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  skuSnapshot: text("sku_snapshot"),
  quantityChange: numeric("quantity_change", { precision: 15, scale: 3 }).notNull(),
  itemStatus: text("item_status").notNull().default("en_attente"),
  rejectionReason: text("rejection_reason"),
  rejectionPhotoData: text("rejection_photo_data"),
  confirmedByUserId: integer("confirmed_by_user_id"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdjustmentItem = typeof adjustmentItemsTable.$inferSelect;
