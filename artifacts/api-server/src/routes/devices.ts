import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userDevicesTable, deviceEventsTable, usersTable, userDeviceSettingsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";

const router: IRouter = Router();
const PERM = "users.edit";

// ── GET /api/users/:id/devices ───────────────────────────────────────────────
router.get("/users/:id/devices", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const devices = await db.select().from(userDevicesTable)
    .where(eq(userDevicesTable.userId, userId))
    .orderBy(desc(userDevicesTable.lastSeenAt));
  res.json(devices);
});

// ── GET /api/users/:id/device-events ────────────────────────────────────────
router.get("/users/:id/device-events", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const events = await db.select().from(deviceEventsTable)
    .where(eq(deviceEventsTable.userId, userId))
    .orderBy(desc(deviceEventsTable.createdAt))
    .limit(200);
  res.json(events);
});

// ── GET /api/users/:id/device-settings ───────────────────────────────────────
router.get("/users/:id/device-settings", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const [s] = await db.select().from(userDeviceSettingsTable)
    .where(eq(userDeviceSettingsTable.userId, userId));
  res.json(s ?? { userId, maxDesktopDevices: 3, requireMobileBinding: true, singleMobileSession: false, enforcementMode: false });
});

// ── PUT /api/users/:id/device-settings ───────────────────────────────────────
router.put("/users/:id/device-settings", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const { maxDesktopDevices, requireMobileBinding, singleMobileSession, enforcementMode } = req.body;

  const [existing] = await db.select().from(userDeviceSettingsTable)
    .where(eq(userDeviceSettingsTable.userId, userId));

  if (existing) {
    await db.update(userDeviceSettingsTable).set({
      maxDesktopDevices: maxDesktopDevices ?? existing.maxDesktopDevices,
      requireMobileBinding: requireMobileBinding ?? existing.requireMobileBinding,
      singleMobileSession: singleMobileSession ?? existing.singleMobileSession,
      enforcementMode: enforcementMode ?? existing.enforcementMode,
    }).where(eq(userDeviceSettingsTable.userId, userId));
  } else {
    await db.insert(userDeviceSettingsTable).values({
      userId,
      maxDesktopDevices: maxDesktopDevices ?? 3,
      requireMobileBinding: requireMobileBinding ?? true,
      singleMobileSession: singleMobileSession ?? false,
      enforcementMode: enforcementMode ?? false,
    });
  }
  res.json({ success: true });
});

// ── PATCH /api/users/:id/devices/:fingerprint ─────────────────────────────────
router.patch("/users/:id/devices/:fingerprint", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const { fingerprint } = req.params;
  const admin = (req as any).user;
  const { status, reason } = req.body;

  if (!["approved", "rejected", "revoked"].includes(status)) {
    return res.status(400).json({ error: "Statut invalide" });
  }
  if ((status === "rejected" || status === "revoked") && !reason?.trim()) {
    return res.status(400).json({ error: "La raison est obligatoire pour rejeter ou révoquer un appareil" });
  }

  const [device] = await db.select().from(userDevicesTable)
    .where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.fingerprint, fingerprint)));
  if (!device) return res.status(404).json({ error: "Appareil introuvable" });

  await db.update(userDevicesTable).set({
    status,
    revokedAt: status !== "approved" ? new Date() : null,
    revokedByAdminId: status !== "approved" ? admin.id : null,
    revokedReason: status !== "approved" ? (reason ?? null) : null,
  }).where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.fingerprint, fingerprint)));

  await db.insert(deviceEventsTable).values({
    userId, fingerprint, deviceType: device.deviceType,
    action: status, adminId: admin.id, reason: reason ?? null,
    ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
  });
  res.json({ success: true });
});

// ── POST /api/users/:id/devices/reset-mobile ──────────────────────────────────
router.post("/users/:id/devices/reset-mobile", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const admin = (req as any).user;
  const { reason } = req.body;

  if (!reason?.trim()) {
    return res.status(400).json({ error: "La raison est obligatoire pour réinitialiser le mobile" });
  }

  await db.update(userDevicesTable).set({
    status: "revoked", revokedAt: new Date(), revokedByAdminId: admin.id, revokedReason: reason,
  }).where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.deviceType, "mobile")));

  const [u] = await db.select({ tokenVersion: usersTable.tokenVersion }).from(usersTable).where(eq(usersTable.id, userId));
  const newVersion = (u?.tokenVersion ?? 0) + 1;
  await db.update(usersTable).set({ tokenVersion: newVersion }).where(eq(usersTable.id, userId));

  await db.insert(deviceEventsTable).values({
    userId, deviceType: "mobile", action: "reset_mobile",
    adminId: admin.id, reason, ip: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
    meta: JSON.stringify({ newTokenVersion: newVersion }),
  });
  res.json({ success: true });
});

// ── POST /api/users/:id/devices/reset-desktop ────────────────────────────────
router.post("/users/:id/devices/reset-desktop", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const admin = (req as any).user;
  const { reason, fingerprint } = req.body;

  if (!reason?.trim()) {
    return res.status(400).json({ error: "La raison est obligatoire pour réinitialiser le desktop" });
  }

  const cond = fingerprint
    ? and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.fingerprint, fingerprint), eq(userDevicesTable.deviceType, "desktop"))
    : and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.deviceType, "desktop"));

  await db.update(userDevicesTable).set({
    status: "revoked", revokedAt: new Date(), revokedByAdminId: admin.id, revokedReason: reason,
  }).where(cond!);

  const [u] = await db.select({ tokenVersion: usersTable.tokenVersion }).from(usersTable).where(eq(usersTable.id, userId));
  const newVersion = (u?.tokenVersion ?? 0) + 1;
  await db.update(usersTable).set({ tokenVersion: newVersion }).where(eq(usersTable.id, userId));

  await db.insert(deviceEventsTable).values({
    userId, fingerprint: fingerprint ?? null, deviceType: "desktop",
    action: "reset_desktop", adminId: admin.id, reason, ip: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
    meta: JSON.stringify({ newTokenVersion: newVersion }),
  });
  res.json({ success: true });
});

// ── POST /api/users/:id/disconnect-all ───────────────────────────────────────
router.post("/users/:id/disconnect-all", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const admin = (req as any).user;
  const { reason } = req.body;

  const [u] = await db.select({ tokenVersion: usersTable.tokenVersion }).from(usersTable).where(eq(usersTable.id, userId));
  if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });

  const newVersion = (u.tokenVersion ?? 0) + 1;
  await db.update(usersTable).set({ tokenVersion: newVersion }).where(eq(usersTable.id, userId));

  await db.insert(deviceEventsTable).values({
    userId, action: "disconnect_all", adminId: admin.id, reason: reason ?? null,
    ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
    meta: JSON.stringify({ newTokenVersion: newVersion }),
  });
  res.json({ success: true });
});

export default router;
