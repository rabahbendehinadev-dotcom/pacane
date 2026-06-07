import { pgTable, integer, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const branchSellersTable = pgTable("branch_sellers", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull(),
  sellerName: text("seller_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.branchId, t.sellerName),
]);

export type BranchSeller = typeof branchSellersTable.$inferSelect;
