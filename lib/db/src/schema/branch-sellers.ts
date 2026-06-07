import { pgTable, integer, serial, timestamp, unique } from "drizzle-orm/pg-core";

export const branchSellersTable = pgTable("branch_sellers", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.branchId, t.userId),
]);

export type BranchSeller = typeof branchSellersTable.$inferSelect;
