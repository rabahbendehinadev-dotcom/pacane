import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const posSessionsTable = pgTable("pos_sessions", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("open"),
  openingCash: numeric("opening_cash", { precision: 15, scale: 2 }).notNull().default("0"),
  countedCash: numeric("counted_cash", { precision: 15, scale: 2 }),
  expectedCash: numeric("expected_cash", { precision: 15, scale: 2 }),
  variance: numeric("variance", { precision: 15, scale: 2 }),
  totalSales: numeric("total_sales", { precision: 15, scale: 2 }).notNull().default("0"),
  totalCashSales: numeric("total_cash_sales", { precision: 15, scale: 2 }).notNull().default("0"),
  totalCardSales: numeric("total_card_sales", { precision: 15, scale: 2 }).notNull().default("0"),
  salesCount: integer("sales_count").notNull().default(0),
  closureNotes: text("closure_notes"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const insertPOSSessionSchema = createInsertSchema(posSessionsTable).omit({ id: true, openedAt: true });
export type InsertPOSSession = z.infer<typeof insertPOSSessionSchema>;
export type POSSession = typeof posSessionsTable.$inferSelect;
