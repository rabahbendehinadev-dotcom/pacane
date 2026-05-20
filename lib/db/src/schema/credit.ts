import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const creditOverrideLogsTable = pgTable("credit_override_logs", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  saleId: integer("sale_id"),
  userId: integer("user_id").notNull(),
  reason: text("reason").notNull(),
  creditLimit: numeric("credit_limit", { precision: 15, scale: 2 }),
  unpaidBalance: numeric("unpaid_balance", { precision: 15, scale: 2 }).notNull(),
  newAmount: numeric("new_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCreditOverrideLogSchema = createInsertSchema(creditOverrideLogsTable).omit({ id: true, createdAt: true });
export type InsertCreditOverrideLog = z.infer<typeof insertCreditOverrideLogSchema>;
export type CreditOverrideLog = typeof creditOverrideLogsTable.$inferSelect;

// ─── Customer Wallet / Avoir Credit ──────────────────────────────────────────

export const customerWalletMovementsTable = pgTable("customer_wallet_movements", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  customerId: integer("customer_id").notNull(),
  branchId: integer("branch_id").notNull(),
  type: text("type").notNull(), // 'credit_created' | 'credit_used' | 'credit_cancelled'
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  sourceReturnId: integer("source_return_id"),
  usedOnSaleId: integer("used_on_sale_id"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCustomerWalletMovementSchema = createInsertSchema(customerWalletMovementsTable).omit({ id: true, createdAt: true });
export type InsertCustomerWalletMovement = z.infer<typeof insertCustomerWalletMovementSchema>;
export type CustomerWalletMovement = typeof customerWalletMovementsTable.$inferSelect;
