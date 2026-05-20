import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const purchasesTable = pgTable("purchases", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  supplierId: integer("supplier_id").notNull(),
  branchId: integer("branch_id").notNull(),
  status: text("status").notNull().default("draft"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 15, scale: 2 }).notNull().default("0"),
  tax: numeric("tax", { precision: 15, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 15, scale: 2 }).notNull().default("0"),
  paid: numeric("paid", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const purchaseItemsTable = pgTable("purchase_items", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull(),
  productId: integer("product_id").notNull(),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  receivedQuantity: numeric("received_quantity", { precision: 15, scale: 3 }).notNull().default("0"),
  rejectedQuantity: numeric("rejected_quantity", { precision: 15, scale: 3 }).notNull().default("0"),
  unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull(),
  total: numeric("total", { precision: 15, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchasePaymentsTable = pgTable("purchase_payments", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  method: text("method").notNull(),
  date: text("date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseReceptionsTable = pgTable("purchase_receptions", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id").notNull(),
  branchId: integer("branch_id").notNull(),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseReceptionItemsTable = pgTable("purchase_reception_items", {
  id: serial("id").primaryKey(),
  receptionId: integer("reception_id").notNull(),
  purchaseItemId: integer("purchase_item_id").notNull(),
  productId: integer("product_id").notNull(),
  quantityReceived: numeric("quantity_received", { precision: 15, scale: 3 }).notNull(),
  quantityRejected: numeric("quantity_rejected", { precision: 15, scale: 3 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseReturnsTable = pgTable("purchase_returns", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  purchaseId: integer("purchase_id").notNull(),
  branchId: integer("branch_id").notNull(),
  supplierId: integer("supplier_id").notNull(),
  status: text("status").notNull().default("draft"),
  reason: text("reason"),
  notes: text("notes"),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  createdByUserId: integer("created_by_user_id"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const purchaseReturnItemsTable = pgTable("purchase_return_items", {
  id: serial("id").primaryKey(),
  returnId: integer("return_id").notNull(),
  productId: integer("product_id").notNull(),
  purchaseItemId: integer("purchase_item_id"),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type Purchase = typeof purchasesTable.$inferSelect;
export type PurchaseItem = typeof purchaseItemsTable.$inferSelect;
export type PurchaseReception = typeof purchaseReceptionsTable.$inferSelect;
export type PurchaseReceptionItem = typeof purchaseReceptionItemsTable.$inferSelect;
export type PurchaseReturn = typeof purchaseReturnsTable.$inferSelect;
export type PurchaseReturnItem = typeof purchaseReturnItemsTable.$inferSelect;
