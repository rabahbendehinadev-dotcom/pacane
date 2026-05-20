import { pgTable, text, serial, timestamp, integer, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ATTACHMENT_ENTITY_TYPES = ["expense", "purchase", "sale"] as const;

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const attachmentsTable = pgTable("attachments", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // expense | purchase | sale
  entityId: integer("entity_id").notNull(),
  originalFilename: text("original_filename").notNull(),
  objectPath: text("object_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  uploadedByUserId: integer("uploaded_by_user_id"),
  branchId: integer("branch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAttachmentSchema = createInsertSchema(attachmentsTable).omit({ id: true, createdAt: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachmentsTable.$inferSelect;
