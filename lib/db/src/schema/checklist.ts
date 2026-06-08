import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const checklistTasksTable = pgTable("checklist_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  assignedToUserId: integer("assigned_to_user_id").notNull(),
  createdByUserId: integer("created_by_user_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  recurrence: text("recurrence").notNull().default("daily"),
  recurringDays: integer("recurring_days").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const checklistCompletionsTable = pgTable("checklist_completions", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  userId: integer("user_id").notNull(),
  completionDate: text("completion_date").notNull(),
  isDone: boolean("is_done").notNull().default(true),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("checklist_completion_unique_idx").on(t.taskId, t.userId, t.completionDate),
}));

export const insertChecklistTaskSchema = createInsertSchema(checklistTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChecklistTask = z.infer<typeof insertChecklistTaskSchema>;
export type ChecklistTask = typeof checklistTasksTable.$inferSelect;
export type ChecklistCompletion = typeof checklistCompletionsTable.$inferSelect;
