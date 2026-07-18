import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userDevicesTable, deviceEventsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";

const router: IRouter = Router();

const PERM = "users.edit";

// ── GET /api/users/:id/devices ────────────────────────────────────────────────
router.get("/users/:id/devices", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const devices = await db.select().from(userDevicesTable)
    .where(eq(userDevicesTable.userId, userId))
    .orderBy(desc(userDevicesTable.lastSeenAt));
  res.json(devices);
});

// ── GET /api/users/:id/device-events ─────────────────────────────────────────
router.get("/users/:id/device-events", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const events = await db.select().from(deviceEventsTable)
    .where(eq(deviceEventsTable.userId, userId))
    .orderBy(desc(deviceEventsTable.createdAt))
    .limit(100);
  res.json(events);
});

// ── PATCH /api/users/:id/devices/:fingerprint — approve / reject / revoke ─────
router.patch("/users/:id/devices/:fingerprint", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const { fingerprint } = req.params;
  const admin = (req as any).user;
  const { status, reason } = req.body;

  if (!["approved", "rejected", "revoked"].includes(status)) {
    return res.status(400).json({ error: "Statut invalide" });
  }

  const [device] = await db.select().from(userDevicesTable)
    .where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.fingerprint, fingerprint)));
  if (!device) return res.status(404).json({ error: "Appareil introuvable" });

  await db.update(userDevicesTable).set({
    status,
    revokedAt: status === "revoked" ? new Date() : null,
    revokedByAdminId: status === "revoked" ? admin.id : null,
    revokedReason: status === "revoked" ? (reason ?? null) : null,
  }).where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.fingerprint, fingerprint)));

  await db.insert(deviceEventsTable).values({
    userId, fingerprint, deviceType: device.deviceType,
    action: status, adminId: admin.id, reason: reason ?? null,
    ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ success: true });
});

// ── POST /api/users/:id/devices/reset-mobile ─────────────────────────────────
router.post("/users/:id/devices/reset-mobile", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const admin = (req as any).user;
  const { reason } = req.body;

  await db.update(userDevicesTable).set({
    status: "revoked", revokedAt: new Date(), revokedByAdminId: admin.id, revokedReason: reason ?? "Reset mobile par admin",
  }).where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.deviceType, "mobile")));

  await db.insert(deviceEventsTable).values({
    userId, action: "reset_mobile", adminId: admin.id, reason: reason ?? null,
    ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ success: true });
});

// ── POST /api/users/:id/devices/reset-desktop ────────────────────────────────
router.post("/users/:id/devices/reset-desktop", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const admin = (req as any).user;
  const { reason, fingerprint } = req.body;

  const cond = fingerprint
    ? and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.fingerprint, fingerprint), eq(userDevicesTable.deviceType, "desktop"))
    : and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.deviceType, "desktop"));

  await db.update(userDevicesTable).set({
    status: "revoked", revokedAt: new Date(), revokedByAdminId: admin.id, revokedReason: reason ?? "Reset desktop par admin",
  }).where(cond!);

  await db.insert(deviceEventsTable).values({
    userId, fingerprint: fingerprint ?? null, deviceType: "desktop",
    action: "reset_desktop", adminId: admin.id, reason: reason ?? null,
    ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ success: true });
});

// ── POST /api/users/:id/disconnect-all ───────────────────────────────────────
router.post("/users/:id/disconnect-all", requireAuth, requirePermission(PERM), async (req, res) => {
  const userId = parseInt(req.params.id);
  const admin = (req as any).user;
  const { reason } = req.body;

  const [user] = await db.select({ tokenVersion: usersTable.tokenVersion })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

  const newVersion = (user.tokenVersion ?? 0) + 1;
  await db.update(usersTable).set({ tokenVersion: newVersion }).where(eq(usersTable.id, userId));

  await db.insert(deviceEventsTable).values({
    userId, action: "disconnect_all", adminId: admin.id, reason: reason ?? null,
    ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
    meta: JSON.stringify({ newTokenVersion: newVersion }),
  });

  res.json({ success: true });
});

export default router;
