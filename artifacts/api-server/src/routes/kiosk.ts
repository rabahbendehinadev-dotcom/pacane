import { Router } from "express";
import { db } from "@workspace/db";
import {
  branchDesktopDevicesTable, qrTokensTable, branchesTable, attendanceAuditLogsTable,
} from "@workspace/db";
import { eq, and, lte } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

const QR_SECRET = process.env.QR_HMAC_SECRET ?? "pacane_qr_secret_dev_2024";
const QR_TTL_MS = 10_000;
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function signQrPayload(payload: object): string {
  return crypto.createHmac("sha256", QR_SECRET).update(JSON.stringify(payload)).digest("hex");
}

function cookieName(slug: string): string {
  return `kd_${slug.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

function normalizeSlug(s: string): string {
  return s.toUpperCase().trim();
}

async function getDeviceBySlug(slug: string) {
  const [device] = await db
    .select({
      id: branchDesktopDevicesTable.id,
      branchId: branchDesktopDevicesTable.branchId,
      branchName: branchesTable.name,
      deviceName: branchDesktopDevicesTable.deviceName,
      kioskSlug: branchDesktopDevicesTable.kioskSlug,
      isActive: branchDesktopDevicesTable.isActive,
      boundDeviceToken: branchDesktopDevicesTable.boundDeviceToken,
      boundDeviceOs: branchDesktopDevicesTable.boundDeviceOs,
      boundDeviceBrowser: branchDesktopDevicesTable.boundDeviceBrowser,
      boundDeviceIp: branchDesktopDevicesTable.boundDeviceIp,
      boundAt: branchDesktopDevicesTable.boundAt,
    })
    .from(branchDesktopDevicesTable)
    .leftJoin(branchesTable, eq(branchesTable.id, branchDesktopDevicesTable.branchId))
    .where(eq(branchDesktopDevicesTable.kioskSlug, slug));
  return device ?? null;
}

// ── GET /api/kiosk/:slug/status ───────────────────────────────────────────────
router.get("/kiosk/:slug/status", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const device = await getDeviceBySlug(slug);

  if (!device) return res.status(404).json({ status: "not_found", error: "Kiosk introuvable" });
  if (!device.isActive) return res.json({ status: "disabled", error: "Appareil désactivé par l'administrateur" });

  const cname = cookieName(slug);
  const cookieToken = (req as any).cookies?.[cname];

  if (!device.boundDeviceToken) {
    return res.json({ status: "unactivated", branchName: device.branchName, deviceName: device.deviceName });
  }

  if (!cookieToken || cookieToken !== device.boundDeviceToken) {
    return res.json({ status: "bound_other", error: "Ce kiosk est lié à un autre appareil. Contactez l'administrateur." });
  }

  await db.update(branchDesktopDevicesTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(branchDesktopDevicesTable.id, device.id));

  return res.json({
    status: "active",
    branchId: device.branchId,
    branchName: device.branchName,
    deviceName: device.deviceName,
    deviceId: device.id,
    kioskSlug: device.kioskSlug,
  });
});

// ── POST /api/kiosk/:slug/activate ───────────────────────────────────────────
router.post("/kiosk/:slug/activate", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const { deviceOs, deviceBrowser } = req.body;

  const device = await getDeviceBySlug(slug);
  if (!device) return res.status(404).json({ error: "Kiosk introuvable" });
  if (!device.isActive) return res.status(403).json({ error: "Appareil désactivé", code: "DISABLED" });

  const cname = cookieName(slug);
  const cookieToken = (req as any).cookies?.[cname];

  if (device.boundDeviceToken) {
    if (cookieToken && cookieToken === device.boundDeviceToken) {
      await db.update(branchDesktopDevicesTable)
        .set({ lastSeenAt: new Date(), boundDeviceIp: req.ip ?? null })
        .where(eq(branchDesktopDevicesTable.id, device.id));
      return res.json({ success: true, alreadyBound: true, branchName: device.branchName, deviceName: device.deviceName });
    }
    return res.status(403).json({ error: "Ce kiosk est déjà lié à un autre appareil.", code: "ALREADY_BOUND" });
  }

  const newToken = crypto.randomBytes(32).toString("hex");
  const ua = req.headers["user-agent"] ?? "";

  await db.update(branchDesktopDevicesTable).set({
    boundDeviceToken: newToken,
    boundDeviceUa: ua,
    boundDeviceOs: deviceOs ?? null,
    boundDeviceBrowser: deviceBrowser ?? null,
    boundDeviceIp: req.ip ?? null,
    boundAt: new Date(),
    lastSeenAt: new Date(),
  }).where(eq(branchDesktopDevicesTable.id, device.id));

  await db.insert(attendanceAuditLogsTable).values({
    action: "kiosk_device_activated",
    branchId: device.branchId ?? undefined,
    deviceId: String(device.id),
    ipAddress: req.ip ?? null,
    userAgent: ua,
    notes: `Slug: ${slug}, OS: ${deviceOs ?? "?"}, Browser: ${deviceBrowser ?? "?"}`,
  });

  res.cookie(cname, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });

  res.json({ success: true, alreadyBound: false, branchName: device.branchName, deviceName: device.deviceName });
});

// ── GET /api/kiosk/:slug/qr ───────────────────────────────────────────────────
router.get("/kiosk/:slug/qr", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);

  const device = await getDeviceBySlug(slug);
  if (!device) return res.status(404).json({ error: "Kiosk introuvable", code: "NOT_FOUND" });
  if (!device.isActive) return res.status(403).json({ error: "Appareil désactivé", code: "DISABLED" });

  const cname = cookieName(slug);
  const cookieToken = (req as any).cookies?.[cname];

  if (!device.boundDeviceToken || !cookieToken || cookieToken !== device.boundDeviceToken) {
    return res.status(401).json({ error: "Appareil non autorisé", code: "UNAUTHORIZED" });
  }

  await db.update(branchDesktopDevicesTable)
    .set({ lastSeenAt: new Date() })
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

  await db.insert(qrTokensTable).values({
    branchId: device.branchId!,
    deviceId: device.id,
    nonce,
    hmac,
    issuedAt: now,
    expiresAt,
  });

  await db.delete(qrTokensTable).where(lte(qrTokensTable.expiresAt, new Date(Date.now() - 60_000)));

  res.json({
    qrData: JSON.stringify({ ...payload, hmac }),
    expiresAt: expiresAt.toISOString(),
    branchName: device.branchName,
  });
});

export default router;
