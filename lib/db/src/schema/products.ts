import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku"),
  barcode: text("barcode"),
  type: text("type").notNull().default("finished"),
  categoryId: integer("category_id"),
  unitId: integer("unit_id").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  costPrice: numeric("cost_price", { precision: 15, scale: 2 }).notNull().default("0"),
  sellingPrice: numeric("selling_price", { precision: 15, scale: 2 }).notNull().default("0"),
  alertQuantity: numeric("alert_quantity", { precision: 15, scale: 3 }),
  shelfLifeDays: integer("shelf_life_days"),
  isManaged: boolean("is_managed").notNull().default(true),
  isSellable: boolean("is_sellable").notNull().default(true),
  isPurchasable: boolean("is_purchasable").notNull().default(false),
  isFabricated: boolean("is_fabricated").notNull().default(false),
  branchIds: integer("branch_ids").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
