import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("customer"),
  companyName: text("company_name"),
  displayName: text("display_name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  alternatePhone: text("alternate_phone"),
  email: text("email"),
  taxId: text("tax_id"),
  address: text("address"),
  city: text("city"),
  wilaya: text("wilaya"),
  country: text("country").default("DZ"),
  status: text("status").notNull().default("active"),
  creditLimit: numeric("credit_limit", { precision: 15, scale: 2 }),
  notes: text("notes"),
  groupId: integer("group_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
