import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const EXPENSE_CATEGORIES = [
  "Loyer",
  "Électricité",
  "Eau",
  "Salaires",
  "Matériel",
  "Entretien",
  "Transport",
  "Emballage",
  "Fournitures",
  "Marketing",
  "Charges sociales",
  "Impôts",
  "Divers",
] as const;

export const PAYMENT_METHODS = ["cash", "virement", "cheque", "carte"] as const;
export const EXPENSE_STATUSES = ["draft", "validated", "cancelled"] as const;

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull(),
  branchId: integer("branch_id").notNull(),
  category: text("category").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  date: text("date").notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  status: text("status").notNull().default("validated"),
  notes: text("notes"),
  attachmentUrl: text("attachment_url"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
