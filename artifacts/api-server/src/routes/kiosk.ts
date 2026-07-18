import { Router } from "express";
import { db } from "@workspace/db";
import {
  branchDesktopDevicesTable, qrTokensTable, branchesTable, attendanceAuditLogsTable,
} from "@workspace/db";
import { eq, lte } from "drizzle-orm";
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

export function hashKioskPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyKioskPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
  } catch {
    return false;
  }
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
      kioskPasswordHash: branchDesktopDevicesTable.kioskPasswordHash,
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

  if (device.boundDeviceToken) {
    if (cookieToken && cookieToken === device.boundDeviceToken) {
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
    }
    return res.json({
      status: "bound_other",
      error: "Ce kiosk est lié à un autre appareil. Contactez l'administrateur.",
    });
  }

  return res.json({
    status: "need_password",
    branchName: device.branchName,
    deviceName: device.deviceName,
  });
});

// ── POST /api/kiosk/:slug/auth — password-based authentication ─────────────
router.post("/kiosk/:slug/auth", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const { password, deviceOs, deviceBrowser } = req.body;

  if (!password) return res.status(400).json({ error: "Mot de passe requis", code: "NO_PASSWORD" });

  const device = await getDeviceBySlug(slug);
  if (!device) return res.status(404).json({ error: "Kiosk introuvable", code: "NOT_FOUND" });
  if (!device.isActive) return res.status(403).json({ error: "Appareil désactivé", code: "DISABLED" });

  if (!device.kioskPasswordHash || !verifyKioskPassword(password, device.kioskPasswordHash)) {
    return res.status(401).json({ error: "Mot de passe incorrect", code: "WRONG_PASSWORD" });
  }

  const cname = cookieName(slug);
  const cookieToken = (req as any).cookies?.[cname];

  if (device.boundDeviceToken) {
    if (cookieToken === device.boundDeviceToken) {
      await db.update(branchDesktopDevicesTable)
        .set({ lastSeenAt: new Date(), boundDeviceIp: req.ip ?? null })
        .where(eq(branchDesktopDevicesTable.id, device.id));
      res.cookie(cname, cookieToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: COOKIE_MAX_AGE_MS,
        path: "/",
      });
      return res.json({ success: true, branchName: device.branchName, deviceName: device.deviceName });
    }
    return res.status(403).json({
      error: "Ce kiosk est déjà lié à un autre appareil. Demandez un Reset à l'administrateur.",
      code: "ALREADY_BOUND",
    });
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
    action: "kiosk_device_authenticated",
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

  res.json({ success: true, branchName: device.branchName, deviceName: device.deviceName });
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
