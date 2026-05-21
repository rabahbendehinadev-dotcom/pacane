import { pgTable, text, serial, timestamp, integer, numeric, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productReplenishmentRulesTable = pgTable("product_replenishment_rules", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  branchId: integer("branch_id").notNull(),
  targetSunWed: numeric("target_sun_wed", { precision: 15, scale: 3 }).notNull().default("0"),
  targetThuSat: numeric("target_thu_sat", { precision: 15, scale: 3 }).notNull().default("0"),
  // Per-day targets (0=Dim/Sun, 1=Lun/Mon, 2=Mar/Tue, 3=Mer/Wed, 4=Jeu/Thu, 5=Ven/Fri, 6=Sam/Sat)
  targetDim: numeric("target_dim", { precision: 15, scale: 3 }).notNull().default("0"),
  targetLun: numeric("target_lun", { precision: 15, scale: 3 }).notNull().default("0"),
  targetMar: numeric("target_mar", { precision: 15, scale: 3 }).notNull().default("0"),
  targetMer: numeric("target_mer", { precision: 15, scale: 3 }).notNull().default("0"),
  targetJeu: numeric("target_jeu", { precision: 15, scale: 3 }).notNull().default("0"),
  targetVen: numeric("target_ven", { precision: 15, scale: 3 }).notNull().default("0"),
  targetSat: numeric("target_sat", { precision: 15, scale: 3 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [unique().on(t.productId, t.branchId)]);

export const insertReplenishmentRuleSchema = createInsertSchema(productReplenishmentRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReplenishmentRule = z.infer<typeof insertReplenishmentRuleSchema>;
export type ProductReplenishmentRule = typeof productReplenishmentRulesTable.$inferSelect;
