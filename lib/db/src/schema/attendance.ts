import { pgTable, text, serial, timestamp, boolean, integer, numeric, jsonb } from "drizzle-orm/pg-core";

// Settings per user for pointage
export const userAttendanceSettingsTable = pgTable("user_attendance_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  branchId: integer("branch_id"),
  pointageEnabled: boolean("pointage_enabled").notNull().default(false),
  // Work schedule
  workStartTime: text("work_start_time").notNull().default("08:00"),
  workEndTime: text("work_end_time").notNull().default("17:00"),
  workDays: text("work_days").array().notNull().default(["lun","mar","mer","jeu","ven"]),
  gracePeriodMinutes: integer("grace_period_minutes").notNull().default(10),
  // Salary
  baseSalary: numeric("base_salary", { precision: 15, scale: 2 }).notNull().default("0"),
  salaryType: text("salary_type").notNull().default("monthly"), // monthly | daily | hourly
  // Deductions
  lateDeductionType: text("late_deduction_type").notNull().default("per_minute"), // fixed | per_minute | per_hour
  lateDeductionValue: numeric("late_deduction_value", { precision: 15, scale: 2 }).notNull().default("0"),
  absenceDeductionValue: numeric("absence_deduction_value", { precision: 15, scale: 2 }).notNull().default("0"),
  earlyLeaveDeductionValue: numeric("early_leave_deduction_value", { precision: 15, scale: 2 }).notNull().default("0"),
  overtimeRateMultiplier: numeric("overtime_rate_multiplier", { precision: 5, scale: 2 }).notNull().default("1.5"),
  maxDeductionPercent: integer("max_deduction_percent").notNull().default(50),
  autoDeductions: boolean("auto_deductions").notNull().default(false),
  // Device binding
  approvedMobileDeviceId: text("approved_mobile_device_id"),
  mobileDeviceStatus: text("mobile_device_status").notNull().default("none"), // none | pending | approved | rejected
  // Admin notes
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Attendance records (one per IN or OUT event)
export const attendanceRecordsTable = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  branchId: integer("branch_id").notNull(),
  type: text("type").notNull(), // IN | OUT
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("present"), // present | late | early_leave | overtime | suspicious | corrected | pending_validation
  // QR validation
  qrTokenNonce: text("qr_token_nonce"),
  // Device info
  mobileDeviceId: text("mobile_device_id"),
  // Location
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  locationAccuracy: numeric("location_accuracy", { precision: 10, scale: 2 }),
  ipAddress: text("ip_address"),
  // Computed
  lateMinutes: integer("late_minutes"),
  earlyLeaveMinutes: integer("early_leave_minutes"),
  overtimeMinutes: integer("overtime_minutes"),
  // Selfie
  selfieData: text("selfie_data"),
  // Suspicious
  isSuspicious: boolean("is_suspicious").notNull().default(false),
  suspiciousReason: text("suspicious_reason"),
  // Admin correction
  correctedByAdminId: integer("corrected_by_admin_id"),
  correctionReason: text("correction_reason"),
  originalTimestamp: timestamp("original_timestamp", { withTimezone: true }),
  // Notes
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Mobile device binding requests
export const employeeMobileDevicesTable = pgTable("employee_mobile_devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceId: text("device_id").notNull().unique(), // fingerprint
  deviceName: text("device_name"),
  userAgent: text("user_agent"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | revoked
  approvedByAdminId: integer("approved_by_admin_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Desktop kiosk devices per branch
export const branchDesktopDevicesTable = pgTable("branch_desktop_devices", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull(),
  deviceToken: text("device_token").notNull().unique(), // secret token used by kiosk
  deviceName: text("device_name"),
  isActive: boolean("is_active").notNull().default(true),
  activatedByAdminId: integer("activated_by_admin_id"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Short-lived QR tokens (10s TTL, single-use)
export const qrTokensTable = pgTable("qr_tokens", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").notNull(),
  deviceId: integer("device_id").notNull(), // branch_desktop_devices.id
  nonce: text("nonce").notNull().unique(),
  hmac: text("hmac").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Salary adjustments (bonuses, deductions, manual)
export const salaryAdjustmentsTable = pgTable("salary_adjustments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  period: text("period").notNull(), // YYYY-MM
  type: text("type").notNull(), // bonus | deduction | manual
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  reason: text("reason"),
  createdByAdminId: integer("created_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Immutable audit log
export const attendanceAuditLogsTable = pgTable("attendance_audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  targetUserId: integer("target_user_id"),
  branchId: integer("branch_id"),
  action: text("action").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  deviceId: text("device_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  adminId: integer("admin_id"),
  reason: text("reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserAttendanceSettings = typeof userAttendanceSettingsTable.$inferSelect;
export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
export type EmployeeMobileDevice = typeof employeeMobileDevicesTable.$inferSelect;
export type BranchDesktopDevice = typeof branchDesktopDevicesTable.$inferSelect;
export type QrToken = typeof qrTokensTable.$inferSelect;
export type SalaryAdjustment = typeof salaryAdjustmentsTable.$inferSelect;
export type AttendanceAuditLog = typeof attendanceAuditLogsTable.$inferSelect;
