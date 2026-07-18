import { Router } from "express";
import { db } from "@workspace/db";
import {
  userAttendanceSettingsTable, attendanceRecordsTable, employeeMobileDevicesTable,
  branchDesktopDevicesTable, qrTokensTable, salaryAdjustmentsTable, attendanceAuditLogsTable,
  usersTable, branchesTable,
} from "@workspace/db";
import { eq, and, desc, gte, lte, inArray, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import crypto from "crypto";

const router = Router();

// ── HMAC QR secret (from env or fallback for dev) ────────────────────────────
const QR_SECRET = process.env.QR_HMAC_SECRET ?? "pacane_qr_secret_dev_2024";
const QR_TTL_MS = 10_000; // 10 seconds

function signQrPayload(payload: object): string {
  return crypto.createHmac("sha256", QR_SECRET).update(JSON.stringify(payload)).digest("hex");
}

function writeAuditLog(data: {
  userId?: number; targetUserId?: number; branchId?: number; action: string;
  previousValue?: object; newValue?: object; deviceId?: string; ipAddress?: string;
  userAgent?: string; adminId?: number; reason?: string; notes?: string;
}) {
  return db.insert(attendanceAuditLogsTable).values({
    userId: data.userId,
    targetUserId: data.targetUserId,
    branchId: data.branchId,
    action: data.action,
    previousValue: data.previousValue ?? null,
    newValue: data.newValue ?? null,
    deviceId: data.deviceId,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    adminId: data.adminId,
    reason: data.reason,
    notes: data.notes,
  }).execute();
}

// ── GET /api/attendance/settings/:userId ──────────────────────────────────────
router.get("/attendance/settings/:userId", requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.userId);
  const me = (req as any).user;
  if (!me.adminAccess && me.id !== targetId) return res.status(403).json({ error: "Accès refusé" });

  const [settings] = await db.select().from(userAttendanceSettingsTable)
    .where(eq(userAttendanceSettingsTable.userId, targetId));

  // Also get device info
  let mobileDevice = null;
  if (settings?.approvedMobileDeviceId) {
    const [dev] = await db.select().from(employeeMobileDevicesTable)
      .where(eq(employeeMobileDevicesTable.deviceId, settings.approvedMobileDeviceId));
    mobileDevice = dev ?? null;
  }

  res.json({ settings: settings ?? null, mobileDevice });
});

// ── PUT /api/attendance/settings/:userId ──────────────────────────────────────
router.put("/attendance/settings/:userId", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const targetId = parseInt(req.params.userId);
  const me = (req as any).user;
  const body = req.body;

  const existing = await db.select().from(userAttendanceSettingsTable)
    .where(eq(userAttendanceSettingsTable.userId, targetId));

  const data = {
    userId: targetId,
    branchId: body.branchId ?? null,
    pointageEnabled: body.pointageEnabled ?? false,
    workStartTime: body.workStartTime ?? "08:00",
    workEndTime: body.workEndTime ?? "17:00",
    workDays: body.workDays ?? ["lun","mar","mer","jeu","ven"],
    gracePeriodMinutes: body.gracePeriodMinutes ?? 10,
    baseSalary: body.baseSalary ?? "0",
    salaryType: body.salaryType ?? "monthly",
    lateDeductionType: body.lateDeductionType ?? "per_minute",
    lateDeductionValue: body.lateDeductionValue ?? "0",
    absenceDeductionValue: body.absenceDeductionValue ?? "0",
    earlyLeaveDeductionValue: body.earlyLeaveDeductionValue ?? "0",
    overtimeRateMultiplier: body.overtimeRateMultiplier ?? "1.5",
    maxDeductionPercent: body.maxDeductionPercent ?? 50,
    autoDeductions: body.autoDeductions ?? false,
    adminNotes: body.adminNotes ?? null,
    updatedAt: new Date(),
  };

  if (existing.length === 0) {
    await db.insert(userAttendanceSettingsTable).values(data);
  } else {
    await db.update(userAttendanceSettingsTable).set(data)
      .where(eq(userAttendanceSettingsTable.userId, targetId));
  }

  await writeAuditLog({
    userId: me.id, targetUserId: targetId,
    action: "settings_updated", newValue: data,
    adminId: me.id, ipAddress: req.ip,
  });

  res.json({ success: true });
});

// ── GET /api/attendance/today ─────────────────────────────────────────────────
router.get("/attendance/today", requireAuth, requirePermission("pointage.view"), async (req, res) => {
  const me = (req as any).user;
  const branchFilter = req.query.branchId ? parseInt(req.query.branchId as string) : null;

  const nowAlgeria = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Algiers" }));
  const todayStr = nowAlgeria.toISOString().split("T")[0];
  const dayStart = new Date(`${todayStr}T00:00:00+01:00`);
  const dayEnd = new Date(`${todayStr}T23:59:59+01:00`);

  // Get all users with pointage enabled
  const settings = await db.select({
    userId: userAttendanceSettingsTable.userId,
    branchId: userAttendanceSettingsTable.branchId,
    workStartTime: userAttendanceSettingsTable.workStartTime,
    workEndTime: userAttendanceSettingsTable.workEndTime,
    gracePeriodMinutes: userAttendanceSettingsTable.gracePeriodMinutes,
    pointageEnabled: userAttendanceSettingsTable.pointageEnabled,
    userName: usersTable.name,
    userStatus: usersTable.status,
  })
  .from(userAttendanceSettingsTable)
  .innerJoin(usersTable, eq(usersTable.id, userAttendanceSettingsTable.userId))
  .where(
    and(
      eq(userAttendanceSettingsTable.pointageEnabled, true),
      branchFilter ? eq(userAttendanceSettingsTable.branchId, branchFilter) : undefined,
      me.adminAccess ? undefined : inArray(userAttendanceSettingsTable.branchId, me.branchIds ?? []),
    )
  );

  // Get today's records
  const records = await db.select().from(attendanceRecordsTable)
    .where(and(
      gte(attendanceRecordsTable.timestamp, dayStart),
      lte(attendanceRecordsTable.timestamp, dayEnd),
    ))
    .orderBy(attendanceRecordsTable.userId, attendanceRecordsTable.timestamp);

  // Group by user
  const recordsByUser: Record<number, typeof records> = {};
  for (const r of records) {
    if (!recordsByUser[r.userId]) recordsByUser[r.userId] = [];
    recordsByUser[r.userId].push(r);
  }

  const result = settings.map(s => {
    const userRecords = recordsByUser[s.userId] ?? [];
    const inRecords = userRecords.filter(r => r.type === "IN");
    const outRecords = userRecords.filter(r => r.type === "OUT");
    const firstIn = inRecords[0] ?? null;
    const lastOut = outRecords[outRecords.length - 1] ?? null;
    const isPresent = inRecords.length > 0;
    const hasLeft = lastOut !== null;

    // Compute work minutes
    let workedMinutes = 0;
    let sortedAll = [...userRecords].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let lastInTime: Date | null = null;
    for (const r of sortedAll) {
      if (r.type === "IN") { lastInTime = new Date(r.timestamp); }
      else if (r.type === "OUT" && lastInTime) {
        workedMinutes += Math.floor((new Date(r.timestamp).getTime() - lastInTime.getTime()) / 60000);
        lastInTime = null;
      }
    }
    // Still inside
    if (lastInTime) {
      workedMinutes += Math.floor((Date.now() - lastInTime.getTime()) / 60000);
    }

    // Late minutes
    const lateMin = firstIn ? (firstIn.lateMinutes ?? 0) : 0;

    // Status
    let dayStatus = "absent";
    if (isPresent && hasLeft) dayStatus = "left";
    else if (isPresent) dayStatus = "present";

    return {
      userId: s.userId,
      userName: s.userName,
      branchId: s.branchId,
      workStartTime: s.workStartTime,
      workEndTime: s.workEndTime,
      dayStatus,
      isPresent,
      hasLeft,
      firstIn: firstIn ? { timestamp: firstIn.timestamp, status: firstIn.status, lateMinutes: firstIn.lateMinutes } : null,
      lastOut: lastOut ? { timestamp: lastOut.timestamp } : null,
      workedMinutes,
      lateMinutes: lateMin,
      recordCount: userRecords.length,
    };
  });

  const summary = {
    total: result.length,
    present: result.filter(r => r.isPresent && !r.hasLeft).length,
    left: result.filter(r => r.hasLeft).length,
    absent: result.filter(r => !r.isPresent).length,
    late: result.filter(r => r.firstIn && (r.firstIn.lateMinutes ?? 0) > 0).length,
  };

  res.json({ date: todayStr, summary, employees: result });
});

// ── GET /api/attendance/records ───────────────────────────────────────────────
router.get("/attendance/records", requireAuth, requirePermission("pointage.view"), async (req, res) => {
  const me = (req as any).user;
  const { userId, branchId, dateFrom, dateTo, status, limit = "100", offset = "0" } = req.query as any;

  const conditions: any[] = [];
  if (userId) conditions.push(eq(attendanceRecordsTable.userId, parseInt(userId)));
  if (branchId) conditions.push(eq(attendanceRecordsTable.branchId, parseInt(branchId)));
  if (dateFrom) conditions.push(gte(attendanceRecordsTable.timestamp, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(attendanceRecordsTable.timestamp, new Date(dateTo + "T23:59:59Z")));
  if (status) conditions.push(eq(attendanceRecordsTable.status, status));
  if (!me.adminAccess && me.branchIds?.length) {
    conditions.push(inArray(attendanceRecordsTable.branchId, me.branchIds));
  }

  const records = await db
    .select({
      id: attendanceRecordsTable.id,
      userId: attendanceRecordsTable.userId,
      userName: usersTable.name,
      branchId: attendanceRecordsTable.branchId,
      branchName: branchesTable.name,
      type: attendanceRecordsTable.type,
      timestamp: attendanceRecordsTable.timestamp,
      status: attendanceRecordsTable.status,
      lateMinutes: attendanceRecordsTable.lateMinutes,
      earlyLeaveMinutes: attendanceRecordsTable.earlyLeaveMinutes,
      overtimeMinutes: attendanceRecordsTable.overtimeMinutes,
      isSuspicious: attendanceRecordsTable.isSuspicious,
      suspiciousReason: attendanceRecordsTable.suspiciousReason,
      correctedByAdminId: attendanceRecordsTable.correctedByAdminId,
      correctionReason: attendanceRecordsTable.correctionReason,
      latitude: attendanceRecordsTable.latitude,
      longitude: attendanceRecordsTable.longitude,
      notes: attendanceRecordsTable.notes,
      createdAt: attendanceRecordsTable.createdAt,
    })
    .from(attendanceRecordsTable)
    .leftJoin(usersTable, eq(usersTable.id, attendanceRecordsTable.userId))
    .leftJoin(branchesTable, eq(branchesTable.id, attendanceRecordsTable.branchId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(attendanceRecordsTable.timestamp))
    .limit(parseInt(limit))
    .offset(parseInt(offset));

  res.json(records);
});

// ── POST /api/attendance/records (admin manual entry) ─────────────────────────
router.post("/attendance/records", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const me = (req as any).user;
  const { userId, branchId, type, timestamp, notes, reason } = req.body;
  if (!userId || !branchId || !type || !timestamp) return res.status(400).json({ error: "Champs requis manquants" });

  const ts = new Date(timestamp);
  const [settings] = await db.select().from(userAttendanceSettingsTable)
    .where(eq(userAttendanceSettingsTable.userId, parseInt(userId)));

  let lateMinutes: number | null = null;
  if (type === "IN" && settings?.workStartTime) {
    const [h, m] = settings.workStartTime.split(":").map(Number);
    const expected = new Date(ts);
    expected.setHours(h, m + (settings.gracePeriodMinutes ?? 0), 0, 0);
    if (ts > expected) lateMinutes = Math.floor((ts.getTime() - expected.getTime()) / 60000);
  }

  const [record] = await db.insert(attendanceRecordsTable).values({
    userId: parseInt(userId),
    branchId: parseInt(branchId),
    type,
    timestamp: ts,
    status: "corrected",
    lateMinutes,
    correctedByAdminId: me.id,
    correctionReason: reason ?? "Saisie manuelle",
    notes,
  }).returning();

  await writeAuditLog({
    userId: me.id, targetUserId: parseInt(userId), branchId: parseInt(branchId),
    action: "manual_record_added", newValue: { type, timestamp, reason },
    adminId: me.id, reason, ipAddress: req.ip,
  });

  res.status(201).json(record);
});

// ── PATCH /api/attendance/records/:id (admin correction) ─────────────────────
router.patch("/attendance/records/:id", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const me = (req as any).user;
  const id = parseInt(req.params.id);
  const { timestamp, status, notes, reason } = req.body;

  const [existing] = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Enregistrement introuvable" });

  const updates: any = { updatedAt: new Date(), correctedByAdminId: me.id, correctionReason: reason };
  if (timestamp) { updates.originalTimestamp = existing.timestamp; updates.timestamp = new Date(timestamp); updates.status = "corrected"; }
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;

  const [updated] = await db.update(attendanceRecordsTable).set(updates)
    .where(eq(attendanceRecordsTable.id, id)).returning();

  await writeAuditLog({
    userId: me.id, targetUserId: existing.userId, branchId: existing.branchId,
    action: "record_corrected", previousValue: { timestamp: existing.timestamp, status: existing.status },
    newValue: updates, adminId: me.id, reason, ipAddress: req.ip,
  });

  res.json(updated);
});

// ── DELETE /api/attendance/records/:id ────────────────────────────────────────
router.delete("/attendance/records/:id", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const me = (req as any).user;
  const id = parseInt(req.params.id);
  const { reason } = req.body;

  const [existing] = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
  if (!existing) return res.status(404).json({ error: "Enregistrement introuvable" });

  await writeAuditLog({
    userId: me.id, targetUserId: existing.userId,
    action: "record_deleted", previousValue: existing as any,
    adminId: me.id, reason, ipAddress: req.ip,
  });

  await db.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, id));
  res.json({ success: true });
});

// ── GET /api/attendance/qr-token/:branchId ────────────────────────────────────
// Called by branch kiosk to get a fresh QR token
router.get("/attendance/qr-token/:branchId", async (req, res) => {
  const deviceToken = req.headers["x-device-token"] as string;
  if (!deviceToken) return res.status(401).json({ error: "Token appareil requis" });

  const [device] = await db.select().from(branchDesktopDevicesTable)
    .where(and(
      eq(branchDesktopDevicesTable.deviceToken, deviceToken),
      eq(branchDesktopDevicesTable.branchId, parseInt(req.params.branchId)),
      eq(branchDesktopDevicesTable.isActive, true),
    ));

  if (!device) return res.status(403).json({ error: "Appareil non reconnu ou désactivé" });

  // Update last seen
  await db.update(branchDesktopDevicesTable).set({ lastSeenAt: new Date() })
    .where(eq(branchDesktopDevicesTable.id, device.id));

  const now = new Date();
  const expiresAt = new Date(now.getTime() + QR_TTL_MS);
  const nonce = crypto.randomBytes(16).toString("hex");

  const payload = {
    branchId: device.branchId,
    deviceId: device.id,
    nonce,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const hmac = signQrPayload(payload);

  // Store token
  await db.insert(qrTokensTable).values({
    branchId: device.branchId,
    deviceId: device.id,
    nonce,
    hmac,
    issuedAt: now,
    expiresAt,
  });

  // Clean old expired tokens (keep DB tidy)
  await db.delete(qrTokensTable)
    .where(lte(qrTokensTable.expiresAt, new Date(Date.now() - 60_000)));

  res.json({ qrData: JSON.stringify({ ...payload, hmac }), expiresAt: expiresAt.toISOString() });
});

// ── POST /api/attendance/scan ─────────────────────────────────────────────────
router.post("/attendance/scan", requireAuth, async (req, res) => {
  const me = (req as any).user;
  const { qrData, latitude, longitude, locationAccuracy, selfieData, mobileDeviceId } = req.body;
  if (!qrData) return res.status(400).json({ error: "QR requis" });

  let qrPayload: any;
  try { qrPayload = JSON.parse(qrData); } catch { return res.status(400).json({ error: "QR invalide" }); }

  const now = new Date();

  // 1. Verify HMAC
  const { hmac: receivedHmac, ...payloadWithoutHmac } = qrPayload;
  const expectedHmac = signQrPayload(payloadWithoutHmac);
  if (expectedHmac !== receivedHmac) {
    await writeAuditLog({ userId: me.id, action: "qr_invalid_hmac", ipAddress: req.ip, notes: "HMAC mismatch" });
    return res.status(400).json({ error: "QR invalide ou falsifié", code: "QR_INVALID" });
  }

  // 2. Check expiry (server time)
  if (now > new Date(qrPayload.expiresAt)) {
    await writeAuditLog({ userId: me.id, action: "qr_expired", branchId: qrPayload.branchId, ipAddress: req.ip });
    return res.status(400).json({ error: "QR expiré", code: "QR_EXPIRED" });
  }

  // 3. Check token not already used (single-use)
  const [existingToken] = await db.select().from(qrTokensTable)
    .where(eq(qrTokensTable.nonce, qrPayload.nonce));
  if (!existingToken || existingToken.usedAt) {
    await writeAuditLog({ userId: me.id, action: "qr_already_used", branchId: qrPayload.branchId, ipAddress: req.ip });
    return res.status(400).json({ error: "QR déjà utilisé", code: "QR_USED" });
  }

  // 4. Check device is still active
  const [device] = await db.select().from(branchDesktopDevicesTable)
    .where(and(
      eq(branchDesktopDevicesTable.id, qrPayload.deviceId),
      eq(branchDesktopDevicesTable.isActive, true),
    ));
  if (!device) {
    return res.status(403).json({ error: "Appareil de branche désactivé", code: "DEVICE_INACTIVE" });
  }

  // 5. Get user's attendance settings
  const [settings] = await db.select().from(userAttendanceSettingsTable)
    .where(eq(userAttendanceSettingsTable.userId, me.id));
  if (!settings?.pointageEnabled) {
    return res.status(403).json({ error: "Pointage non activé pour ce compte", code: "POINTAGE_DISABLED" });
  }

  // 6. Branch match: QR branch must match user's branch
  if (settings.branchId !== qrPayload.branchId) {
    await writeAuditLog({
      userId: me.id, branchId: qrPayload.branchId, action: "qr_wrong_branch",
      notes: `User branch: ${settings.branchId}, QR branch: ${qrPayload.branchId}`, ipAddress: req.ip,
    });
    return res.status(403).json({ error: "Ce QR appartient à une autre boutique", code: "WRONG_BRANCH" });
  }

  // 7. Anti-duplicate: no scan in last 60 seconds
  const recentCutoff = new Date(Date.now() - 60_000);
  const [recentRecord] = await db.select().from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, me.id),
      gte(attendanceRecordsTable.timestamp, recentCutoff),
    ))
    .orderBy(desc(attendanceRecordsTable.timestamp))
    .limit(1);
  if (recentRecord) {
    return res.status(429).json({ error: "Pointage trop récent, attendez 1 minute", code: "TOO_SOON" });
  }

  // 8. Determine IN or OUT
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Africa/Algiers" });
  const dayStart = new Date(`${todayStr}T00:00:00+01:00`);
  const todayRecords = await db.select().from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, me.id),
      gte(attendanceRecordsTable.timestamp, dayStart),
    ))
    .orderBy(desc(attendanceRecordsTable.timestamp));

  const lastRecord = todayRecords[0] ?? null;
  let type: "IN" | "OUT";
  if (!lastRecord || lastRecord.type === "OUT") {
    type = "IN";
  } else {
    type = "OUT";
  }

  // 9. Compute late minutes for IN
  let lateMinutes: number | null = null;
  let earlyLeaveMinutes: number | null = null;
  let overtimeMinutes: number | null = null;
  let status = "present";

  if (type === "IN" && settings.workStartTime) {
    const [h, m] = settings.workStartTime.split(":").map(Number);
    const nowAlg = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Algiers" }));
    const gracedStart = new Date(nowAlg);
    gracedStart.setHours(h, m + (settings.gracePeriodMinutes ?? 0), 0, 0);
    if (nowAlg > gracedStart) {
      lateMinutes = Math.floor((nowAlg.getTime() - gracedStart.getTime()) / 60000);
      if (lateMinutes > 0) status = "late";
    }
  }

  if (type === "OUT" && settings.workEndTime) {
    const [h, m] = settings.workEndTime.split(":").map(Number);
    const nowAlg = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Algiers" }));
    const expectedEnd = new Date(nowAlg);
    expectedEnd.setHours(h, m, 0, 0);
    if (nowAlg < expectedEnd) {
      earlyLeaveMinutes = Math.floor((expectedEnd.getTime() - nowAlg.getTime()) / 60000);
      status = "early_leave";
    } else if (nowAlg > expectedEnd) {
      overtimeMinutes = Math.floor((nowAlg.getTime() - expectedEnd.getTime()) / 60000);
      status = "overtime";
    }
  }

  // 10. Mark token as used
  await db.update(qrTokensTable).set({ usedAt: now })
    .where(eq(qrTokensTable.nonce, qrPayload.nonce));

  // 11. Insert record in transaction
  const [record] = await db.insert(attendanceRecordsTable).values({
    userId: me.id,
    branchId: qrPayload.branchId,
    type,
    timestamp: now,
    status,
    qrTokenNonce: qrPayload.nonce,
    mobileDeviceId: mobileDeviceId ?? null,
    latitude: latitude?.toString() ?? null,
    longitude: longitude?.toString() ?? null,
    locationAccuracy: locationAccuracy?.toString() ?? null,
    ipAddress: req.ip,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    selfieData: selfieData ?? null,
    isSuspicious: false,
  }).returning();

  await writeAuditLog({
    userId: me.id, branchId: qrPayload.branchId,
    action: type === "IN" ? "check_in" : "check_out",
    newValue: { type, status, lateMinutes, timestamp: now.toISOString() },
    deviceId: mobileDeviceId, ipAddress: req.ip,
  });

  // Get branch info for response
  const [branch] = await db.select({ name: branchesTable.name }).from(branchesTable)
    .where(eq(branchesTable.id, qrPayload.branchId));

  res.json({
    success: true,
    type,
    status,
    timestamp: now.toISOString(),
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    branchName: branch?.name ?? "",
    userName: me.name,
    recordId: record.id,
  });
});

// ── GET /api/attendance/devices/desktop ───────────────────────────────────────
router.get("/attendance/devices/desktop", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const devices = await db.select({
    id: branchDesktopDevicesTable.id,
    branchId: branchDesktopDevicesTable.branchId,
    branchName: branchesTable.name,
    deviceName: branchDesktopDevicesTable.deviceName,
    isActive: branchDesktopDevicesTable.isActive,
    lastSeenAt: branchDesktopDevicesTable.lastSeenAt,
    createdAt: branchDesktopDevicesTable.createdAt,
  })
  .from(branchDesktopDevicesTable)
  .leftJoin(branchesTable, eq(branchesTable.id, branchDesktopDevicesTable.branchId))
  .orderBy(desc(branchDesktopDevicesTable.createdAt));
  res.json(devices);
});

// ── POST /api/attendance/devices/desktop ──────────────────────────────────────
router.post("/attendance/devices/desktop", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const me = (req as any).user;
  const { branchId, deviceName } = req.body;
  if (!branchId) return res.status(400).json({ error: "branchId requis" });

  const deviceToken = crypto.randomBytes(32).toString("hex");
  const [device] = await db.insert(branchDesktopDevicesTable).values({
    branchId: parseInt(branchId),
    deviceName: deviceName ?? "Kiosk",
    deviceToken,
    isActive: true,
    activatedByAdminId: me.id,
  }).returning();

  await writeAuditLog({
    userId: me.id, branchId: parseInt(branchId), action: "desktop_device_created",
    newValue: { deviceName }, adminId: me.id, ipAddress: req.ip,
  });

  res.status(201).json({ ...device, deviceToken });
});

// ── PATCH /api/attendance/devices/desktop/:id ─────────────────────────────────
router.patch("/attendance/devices/desktop/:id", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const me = (req as any).user;
  const id = parseInt(req.params.id);
  const { isActive, branchId, deviceName } = req.body;

  const updates: any = {};
  if (isActive !== undefined) updates.isActive = isActive;
  if (branchId !== undefined) updates.branchId = parseInt(branchId);
  if (deviceName !== undefined) updates.deviceName = deviceName;

  const [updated] = await db.update(branchDesktopDevicesTable).set(updates)
    .where(eq(branchDesktopDevicesTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Appareil introuvable" });

  await writeAuditLog({
    userId: me.id, action: "desktop_device_updated", newValue: updates,
    adminId: me.id, ipAddress: req.ip,
  });
  res.json(updated);
});

// ── GET /api/attendance/devices/mobile ───────────────────────────────────────
router.get("/attendance/devices/mobile", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const devices = await db.select({
    id: employeeMobileDevicesTable.id,
    userId: employeeMobileDevicesTable.userId,
    userName: usersTable.name,
    deviceId: employeeMobileDevicesTable.deviceId,
    deviceName: employeeMobileDevicesTable.deviceName,
    status: employeeMobileDevicesTable.status,
    lastSeenAt: employeeMobileDevicesTable.lastSeenAt,
    createdAt: employeeMobileDevicesTable.createdAt,
  })
  .from(employeeMobileDevicesTable)
  .leftJoin(usersTable, eq(usersTable.id, employeeMobileDevicesTable.userId))
  .orderBy(desc(employeeMobileDevicesTable.createdAt));
  res.json(devices);
});

// ── PATCH /api/attendance/devices/mobile/:id ──────────────────────────────────
router.patch("/attendance/devices/mobile/:id", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const me = (req as any).user;
  const id = parseInt(req.params.id);
  const { status, reason } = req.body;

  const [device] = await db.select().from(employeeMobileDevicesTable)
    .where(eq(employeeMobileDevicesTable.id, id));
  if (!device) return res.status(404).json({ error: "Appareil introuvable" });

  const updates: any = { status };
  if (status === "approved") {
    updates.approvedByAdminId = me.id;
    updates.approvedAt = new Date();
    // Also update user settings
    await db.update(userAttendanceSettingsTable).set({
      approvedMobileDeviceId: device.deviceId,
      mobileDeviceStatus: "approved",
    }).where(eq(userAttendanceSettingsTable.userId, device.userId));
  }
  if (status === "revoked") {
    updates.revokedAt = new Date();
    await db.update(userAttendanceSettingsTable).set({
      approvedMobileDeviceId: null,
      mobileDeviceStatus: "none",
    }).where(eq(userAttendanceSettingsTable.userId, device.userId));
  }

  const [updated] = await db.update(employeeMobileDevicesTable).set(updates)
    .where(eq(employeeMobileDevicesTable.id, id)).returning();

  await writeAuditLog({
    userId: me.id, targetUserId: device.userId, action: `device_${status}`,
    adminId: me.id, reason, ipAddress: req.ip,
  });
  res.json(updated);
});

// ── POST /api/attendance/devices/mobile/reset/:userId ─────────────────────────
router.post("/attendance/devices/mobile/reset/:userId", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const me = (req as any).user;
  const targetId = parseInt(req.params.userId);
  const { reason } = req.body;

  await db.update(employeeMobileDevicesTable).set({ status: "revoked", revokedAt: new Date() })
    .where(eq(employeeMobileDevicesTable.userId, targetId));
  await db.update(userAttendanceSettingsTable).set({ approvedMobileDeviceId: null, mobileDeviceStatus: "none" })
    .where(eq(userAttendanceSettingsTable.userId, targetId));

  await writeAuditLog({
    userId: me.id, targetUserId: targetId, action: "device_reset",
    adminId: me.id, reason: reason ?? "Reset by admin", ipAddress: req.ip,
  });
  res.json({ success: true });
});

// ── GET /api/attendance/audit-logs ────────────────────────────────────────────
router.get("/attendance/audit-logs", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const { userId, limit = "50" } = req.query as any;
  const cond = userId ? [eq(attendanceAuditLogsTable.targetUserId, parseInt(userId))] : [];
  const logs = await db.select().from(attendanceAuditLogsTable)
    .where(cond.length ? and(...cond) : undefined)
    .orderBy(desc(attendanceAuditLogsTable.createdAt))
    .limit(parseInt(limit));
  res.json(logs);
});

// ── GET /api/attendance/salary-summary/:userId ────────────────────────────────
router.get("/attendance/salary-summary/:userId", requireAuth, requirePermission("pointage.view"), async (req, res) => {
  const me = (req as any).user;
  const targetId = parseInt(req.params.userId);
  if (!me.adminAccess && me.id !== targetId) return res.status(403).json({ error: "Accès refusé" });

  const period = (req.query.period as string) ?? new Date().toISOString().slice(0, 7); // YYYY-MM
  const [settings] = await db.select().from(userAttendanceSettingsTable)
    .where(eq(userAttendanceSettingsTable.userId, targetId));
  if (!settings) return res.json({ salary: 0, deductions: 0, bonuses: 0, net: 0 });

  const periodStart = new Date(`${period}-01T00:00:00+01:00`);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const records = await db.select().from(attendanceRecordsTable)
    .where(and(
      eq(attendanceRecordsTable.userId, targetId),
      gte(attendanceRecordsTable.timestamp, periodStart),
      lte(attendanceRecordsTable.timestamp, periodEnd),
    ));

  const adjustments = await db.select().from(salaryAdjustmentsTable)
    .where(and(
      eq(salaryAdjustmentsTable.userId, targetId),
      eq(salaryAdjustmentsTable.period, period),
    ));

  const baseSalary = parseFloat(settings.baseSalary ?? "0");
  const bonuses = adjustments.filter(a => a.type === "bonus").reduce((s, a) => s + parseFloat(a.amount ?? "0"), 0);
  const deductions = adjustments.filter(a => a.type === "deduction").reduce((s, a) => s + parseFloat(a.amount ?? "0"), 0);
  const inRecords = records.filter(r => r.type === "IN");
  const totalLateMin = inRecords.reduce((s, r) => s + (r.lateMinutes ?? 0), 0);

  res.json({
    period, baseSalary, bonuses, deductions,
    totalLateMinutes: totalLateMin,
    presentDays: new Set(inRecords.map(r => new Date(r.timestamp).toDateString())).size,
    net: baseSalary + bonuses - deductions,
    adjustments,
  });
});

// ── POST /api/attendance/salary-adjustments ───────────────────────────────────
router.post("/attendance/salary-adjustments", requireAuth, requirePermission("pointage.admin"), async (req, res) => {
  const me = (req as any).user;
  const { userId, period, type, amount, reason } = req.body;
  if (!userId || !period || !type || amount == null) return res.status(400).json({ error: "Champs requis manquants" });

  const [adj] = await db.insert(salaryAdjustmentsTable).values({
    userId: parseInt(userId), period, type, amount: amount.toString(), reason,
    createdByAdminId: me.id,
  }).returning();

  await writeAuditLog({
    userId: me.id, targetUserId: parseInt(userId), action: `salary_${type}_added`,
    newValue: { period, type, amount, reason }, adminId: me.id, ipAddress: req.ip,
  });
  res.status(201).json(adj);
});

// ── GET /api/attendance/users (list with pointage enabled) ────────────────────
router.get("/attendance/users", requireAuth, requirePermission("pointage.view"), async (req, res) => {
  const me = (req as any).user;
  const rows = await db.select({
    userId: usersTable.id,
    name: usersTable.name,
    username: usersTable.username,
    email: usersTable.email,
    phone: usersTable.phone,
    status: usersTable.status,
    settingsId: userAttendanceSettingsTable.id,
    branchId: userAttendanceSettingsTable.branchId,
    branchName: branchesTable.name,
    pointageEnabled: userAttendanceSettingsTable.pointageEnabled,
    workStartTime: userAttendanceSettingsTable.workStartTime,
    workEndTime: userAttendanceSettingsTable.workEndTime,
    baseSalary: userAttendanceSettingsTable.baseSalary,
    salaryType: userAttendanceSettingsTable.salaryType,
    mobileDeviceStatus: userAttendanceSettingsTable.mobileDeviceStatus,
  })
  .from(usersTable)
  .leftJoin(userAttendanceSettingsTable, eq(userAttendanceSettingsTable.userId, usersTable.id))
  .leftJoin(branchesTable, eq(branchesTable.id, userAttendanceSettingsTable.branchId))
  .where(eq(usersTable.status, "active"))
  .orderBy(usersTable.name);

  res.json(rows);
});

export default router;
