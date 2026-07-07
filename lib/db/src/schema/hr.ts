import { pgTable, serial, integer, varchar, text, boolean, decimal, date, time, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workersTable } from "./workers";

export const workerAttendanceTable = pgTable("worker_attendance", {
  id:        serial("id").primaryKey(),
  workerId:  integer("worker_id").notNull().references(() => workersTable.id, { onDelete: "cascade" }),
  date:      date("date").notNull(),
  status:    varchar("status", { length: 30 }).notNull().default("present"),
  checkIn:   time("check_in"),
  checkOut:  time("check_out"),
  reason:    text("reason"),
  notes:     text("notes"),
  createdAt: timestamp("created_at").default(sql`NOW()`),
  updatedAt: timestamp("updated_at").default(sql`NOW()`),
});

export const workerWarningsTable = pgTable("worker_warnings", {
  id:          serial("id").primaryKey(),
  workerId:    integer("worker_id").notNull().references(() => workersTable.id, { onDelete: "cascade" }),
  title:       varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  severity:    varchar("severity", { length: 20 }).default("medium"),
  status:      varchar("status", { length: 20 }).default("open"),
  closedAt:    timestamp("closed_at"),
  createdAt:   timestamp("created_at").default(sql`NOW()`),
  updatedAt:   timestamp("updated_at").default(sql`NOW()`),
});

export const workerBonusesTable = pgTable("worker_bonuses", {
  id:        serial("id").primaryKey(),
  workerId:  integer("worker_id").notNull().references(() => workersTable.id, { onDelete: "cascade" }),
  amount:    decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason:    text("reason").notNull(),
  bonusType: varchar("bonus_type", { length: 50 }).default("performance"),
  bonusDate: date("bonus_date").notNull(),
  createdAt: timestamp("created_at").default(sql`NOW()`),
});

export const workerNotificationsTable = pgTable("worker_notifications", {
  id:          serial("id").primaryKey(),
  workerId:    integer("worker_id").notNull().references(() => workersTable.id, { onDelete: "cascade" }),
  type:        varchar("type", { length: 50 }).notNull(),
  referenceId: integer("reference_id"),
  title:       varchar("title", { length: 200 }).notNull(),
  message:     text("message"),
  isRead:      boolean("is_read").default(false),
  createdAt:   timestamp("created_at").default(sql`NOW()`),
});
