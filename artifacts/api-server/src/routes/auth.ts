import { Router, type IRouter } from "express";
import { db, usersTable, rolesTable } from "@workspace/db";
import { userDevicesTable, deviceEventsTable, userDeviceSettingsTable } from "@workspace/db";
import { eq, and, ne, or } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth";
import { parseUserAgent, fingerprintUA, getIpLocation } from "../lib/device-detection";
import { sendPushToUser } from "../lib/push-service";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

async function buildUserResponse(user: typeof import("@workspace/db").usersTable.$inferSelect) {
  let roleName: string | null = null;
  let permissions: string[] = [];
  if (user.roleId) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
    roleName = role?.name ?? null;
    permissions = (role?.permissions as string[]) ?? [];
  }
  if (user.adminAccess) permissions = ["*"];
  const { passwordHash: _, ...safeUser } = user;
  return { ...safeUser, roleName, permissions };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Identifiants invalides" });
    return;
  }
  if (user.status !== "active") {
    res.status(401).json({ error: "Compte inactif" });
    return;
  }
  const ua = req.headers["user-agent"] ?? "Unknown";
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "";
  const fp = fingerprintUA(ua);
  const deviceInfo = parseUserAgent(ua);

  // ── Query existing device record ────────────────────────────────────────────
  const [existingDevice] = await db.select().from(userDevicesTable)
    .where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.fingerprint, fp)));

  // ── Hard enforcement (always active — 1 mobile + 1 desktop per account) ────
  if (existingDevice) {
    if (existingDevice.status === "pending") {
      res.status(403).json({
        error: "Cet appareil est en attente d'approbation de l'administration.",
        code: "DEVICE_PENDING_APPROVAL",
        deviceType: existingDevice.deviceType,
      });
      return;
    }
    if (existingDevice.status === "rejected" || existingDevice.status === "revoked") {
      await db.insert(deviceEventsTable).values({
        userId: user.id, fingerprint: fp, deviceType: deviceInfo.deviceType,
        action: "failed_login", ip, userAgent: ua.slice(0, 500),
        meta: `Accès bloqué — appareil ${existingDevice.status}`,
      }).catch(() => {});
      res.status(403).json({ error: "Accès refusé : cet appareil a été bloqué par l'administration.", code: "DEVICE_BLOCKED" });
      return;
    }
  }

  if (!existingDevice) {
    // New device: check if user already has an active device of this type (1-per-type rule)
    const [activeDevice] = await db.select({ fingerprint: userDevicesTable.fingerprint })
      .from(userDevicesTable)
      .where(and(
        eq(userDevicesTable.userId, user.id),
        eq(userDevicesTable.deviceType, deviceInfo.deviceType),
        or(eq(userDevicesTable.status, "approved"), eq(userDevicesTable.status, "unknown")),
      ));
    if (activeDevice) {
      // Insert new device as pending and block login
      await db.insert(userDevicesTable).values({
        userId: user.id, fingerprint: fp, ...deviceInfo, ip,
        userAgent: ua.slice(0, 500), loginCount: 1, status: "pending",
      }).catch(() => {});
      await db.insert(deviceEventsTable).values({
        userId: user.id, fingerprint: fp, deviceType: deviceInfo.deviceType,
        action: "pending_approval", ip, userAgent: ua.slice(0, 500),
        meta: "Nouvel appareil — en attente d'approbation administrative",
      }).catch(() => {});
      // Notify admins (fire-and-forget)
      const label = deviceInfo.deviceType === "mobile" ? "📱 Nouveau mobile" : "💻 Nouveau desktop";
      db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.adminAccess, true), eq(usersTable.status, "active")))
        .then(admins => {
          for (const admin of admins) {
            if (admin.id !== user.id) {
              sendPushToUser(admin.id, {
                title: `${label} — Approbation requise`,
                body: `${user.name} · ${deviceInfo.deviceName} | IP: ${ip}`,
                type: "security", link: "/users",
              }).catch(() => {});
            }
          }
        }).catch(() => {});
      const typeLabel = deviceInfo.deviceType === "mobile" ? "mobile" : "ordinateur";
      res.status(403).json({
        error: `Un ${typeLabel} est déjà enregistré sur ce compte. Ce nouvel appareil nécessite l'approbation de l'administration.`,
        code: "DEVICE_PENDING_APPROVAL",
        deviceType: deviceInfo.deviceType,
        deviceName: deviceInfo.deviceName,
      });
      return;
    }
  }

  await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));

  // ── Device tracking (non-fatal) ─────────────────────────────────────────────
  let isSuspicious = false;
  let suspiciousReason: string | null = null;
  const isNewDevice = !existingDevice;

  try {
    // Cross-account suspicious detection (even without enforcement mode)
    if (deviceInfo.deviceType === "mobile" && isNewDevice) {
      const [crossAccount] = await db.select({ userId: userDevicesTable.userId })
        .from(userDevicesTable)
        .where(and(
          eq(userDevicesTable.fingerprint, fp),
          ne(userDevicesTable.userId, user.id),
        ));
      if (crossAccount) {
        isSuspicious = true;
        suspiciousReason = "Appareil déjà utilisé par un autre compte";
      }
    }

    if (isNewDevice) {
      await db.insert(userDevicesTable).values({
        userId: user.id, fingerprint: fp, ...deviceInfo, ip,
        userAgent: ua.slice(0, 500), loginCount: 1,
        status: "approved",
        isSuspicious, suspiciousReason,
      });
      await db.insert(deviceEventsTable).values({
        userId: user.id, fingerprint: fp, deviceType: deviceInfo.deviceType,
        action: "new_device", ip, userAgent: ua.slice(0, 500),
        meta: isSuspicious ? suspiciousReason : null,
      });
    } else {
      await db.update(userDevicesTable).set({
        lastSeenAt: new Date(), ip,
        loginCount: (existingDevice.loginCount ?? 0) + 1,
        userAgent: ua.slice(0, 500),
      }).where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.fingerprint, fp)));
      await db.insert(deviceEventsTable).values({
        userId: user.id, fingerprint: fp, deviceType: deviceInfo.deviceType,
        action: "login", ip, userAgent: ua.slice(0, 500),
      });
    }

    // GeoIP lookup (fire-and-forget)
    getIpLocation(ip).then(location => {
      if (location) {
        db.update(userDevicesTable).set({ location })
          .where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.fingerprint, fp)))
          .catch(() => {});
      }
    }).catch(() => {});

    // Notify all admins on new device or suspicious activity
    if (isNewDevice || isSuspicious) {
      db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.adminAccess, true), eq(usersTable.status, "active")))
        .then(admins => {
          const title = isSuspicious ? `🚨 Tentative suspecte — ${user.name}` : `📱 Nouvel appareil — ${user.name}`;
          const body = `${deviceInfo.deviceName} | IP: ${ip}`;
          for (const admin of admins) {
            if (admin.id !== user.id) {
              sendPushToUser(admin.id, { title, body, type: "security", link: "/users" }).catch(() => {});
            }
          }
        }).catch(() => {});
    }
  } catch (_err) {
    // Tracking is non-fatal
  }

  const tv = user.tokenVersion ?? 0;
  const token = generateToken(user.id, tv);
  res.json({ user: await buildUserResponse(user), token });
});

router.patch("/auth/me/default-branch", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { branchId } = req.body;
  if (branchId !== null && typeof branchId !== "number") {
    res.status(400).json({ error: "branchId doit être un entier ou null" });
    return;
  }
  await db.update(usersTable).set({ defaultBranchId: branchId ?? null }).where(eq(usersTable.id, user.id));
  res.json({ success: true });
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!freshUser) { res.status(401).json({ error: "Utilisateur introuvable" }); return; }
  res.json(await buildUserResponse(freshUser));
});

export default router;
