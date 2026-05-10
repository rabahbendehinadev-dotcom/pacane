import { pgTable, text, serial, timestamp, integer, numeric, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const customerRfmSnapshotsTable = pgTable("customer_rfm_snapshots", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  branchScope: text("branch_scope").notNull().default("global"),
  period: text("period").notNull().default("365d"),
  recencyDays: integer("recency_days").notNull(),
  frequency: integer("frequency").notNull(),
  monetary: numeric("monetary", { precision: 15, scale: 2 }).notNull(),
  recencyScore: integer("recency_score").notNull(),
  frequencyScore: integer("frequency_score").notNull(),
  monetaryScore: integer("monetary_score").notNull(),
  totalScore: integer("total_score").notNull(),
  segment: text("segment").notNull(),
  lastPurchaseDate: timestamp("last_purchase_date", { withTimezone: true }),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerLoyaltyNotesTable = pgTable("customer_loyalty_notes", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  note: text("note").notNull(),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const savedCustomerAudiencesTable = pgTable("saved_customer_audiences", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default("{}"),
  customerCount: integer("customer_count").notNull().default(0),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCustomerLoyaltyNoteSchema = createInsertSchema(customerLoyaltyNotesTable).omit({ id: true, createdAt: true });
export const insertSavedAudienceSchema = createInsertSchema(savedCustomerAudiencesTable).omit({ id: true, createdAt: true, updatedAt: true });

export type CustomerRfmSnapshot = typeof customerRfmSnapshotsTable.$inferSelect;
export type CustomerLoyaltyNote = typeof customerLoyaltyNotesTable.$inferSelect;
export type SavedCustomerAudience = typeof savedCustomerAudiencesTable.$inferSelect;
