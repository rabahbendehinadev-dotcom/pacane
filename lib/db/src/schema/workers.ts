import { pgTable, text, serial, timestamp, boolean, integer, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workersTable = pgTable("workers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),

  // Informations personnelles
  lastName: text("last_name"),
  firstName: text("first_name"),
  photoUrl: text("photo_url"),
  birthDate: date("birth_date"),
  gender: text("gender"),             // 'male' | 'female'
  whatsapp: text("whatsapp"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  nationalId: text("national_id"),
  maritalStatus: text("marital_status"), // 'single' | 'married' | 'divorced' | 'widowed'
  childrenCount: integer("children_count"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),

  // Informations professionnelles
  hireDate: date("hire_date"),
  position: text("position"),
  department: text("department"),
  contractType: text("contract_type"),  // 'CDI' | 'CDD' | 'Stage' | 'Freelance' | 'Autre'
  baseSalary: text("base_salary"),
  commissionRate: text("commission_rate"),
  workHours: text("work_hours"),
  restDays: text("rest_days"),

  // Santé
  hasChronicDisease: boolean("has_chronic_disease"),
  chronicDiseaseDetails: text("chronic_disease_details"),
  takesMedication: boolean("takes_medication"),
  allergies: text("allergies"),
  bloodType: text("blood_type"),
  medicalNotes: text("medical_notes"),

  // Notes libres
  notes: text("notes"),

  // Métadonnées extensibles (pour futures fonctionnalités: salaires, congés, etc.)
  meta: jsonb("meta"),
});

// Documents du dossier employé
export const workerDocumentsTable = pgTable("worker_documents", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull(),
  category: text("category").notNull(), // 'id_card' | 'contract' | 'certificate' | 'driving_license' | 'other'
  label: text("label").notNull(),
  fileUrl: text("file_url").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedByUserId: integer("uploaded_by_user_id"),
});

// Compétences
export const workerSkillsTable = pgTable("worker_skills", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull(),
  skill: text("skill").notNull(),
  level: text("level"),            // 'débutant' | 'intermédiaire' | 'avancé' | 'expert'
  yearsExperience: integer("years_experience"),
  certification: text("certification"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Journal d'activité — audit trail extensible pour futures fonctionnalités
export const workerActivityLogsTable = pgTable("worker_activity_logs", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull(),
  action: text("action").notNull(),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  performedByUserId: integer("performed_by_user_id"),
  performedByName: text("performed_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb("meta"),
});

export const insertWorkerSchema = createInsertSchema(workersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorker = z.infer<typeof insertWorkerSchema>;
export type Worker = typeof workersTable.$inferSelect;
export type WorkerDocument = typeof workerDocumentsTable.$inferSelect;
export type WorkerSkill = typeof workerSkillsTable.$inferSelect;
export type WorkerActivityLog = typeof workerActivityLogsTable.$inferSelect;
