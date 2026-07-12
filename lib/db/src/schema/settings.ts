import { pgTable, text, serial, timestamp, boolean, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companySettingsTable = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Ma Pâtisserie"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  website: text("website"),
  taxId: text("tax_id"),
  currency: text("currency").notNull().default("DZD"),
  currencySymbol: text("currency_symbol").notNull().default("DA"),
  defaultLanguage: text("default_language").notNull().default("fr"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  taxEnabled: boolean("tax_enabled").notNull().default(false),
  invoicePrefix: text("invoice_prefix").notNull().default("FAC"),
  quotePrefix: text("quote_prefix").notNull().default("DEV"),
  orderPrefix: text("order_prefix").notNull().default("CMD"),
  purchasePrefix: text("purchase_prefix").notNull().default("ACH"),
  transferPrefix: text("transfer_prefix").notNull().default("TRF"),
  productionPrefix: text("production_prefix").notNull().default("PRD"),
  expensePrefix: text("expense_prefix").notNull().default("DEP"),
  logoUrl: text("logo_url"),
  footerNote: text("footer_note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const paymentMethodsTable = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("cash"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const discountReasonsTable = pgTable("discount_reasons", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  requiresNote: boolean("requires_note").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanySettingsSchema = createInsertSchema(companySettingsTable).omit({ id: true, updatedAt: true });
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettingsTable.$inferSelect;
export type PaymentMethod = typeof paymentMethodsTable.$inferSelect;
export type DiscountReason = typeof discountReasonsTable.$inferSelect;
