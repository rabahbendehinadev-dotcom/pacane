import { Router, type IRouter } from "express";
import { db, usersTable, rolesTable } from "@workspace/db";
import { userDevicesTable, deviceEventsTable } from "@workspace/db";
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

// ── Check if user is an admin (exempt from device enforcement) ───────────────
async function isAdminUser(user: typeof usersTable.$inferSelect): Promise<boolean> {
  if (user.adminAccess) return true;
  if (user.roleId) {
    const [role] = await db.select({ name: rolesTable.name })
      .from(rolesTable).where(eq(rolesTable.id, user.roleId));
    const name = role?.name?.toLowerCase() ?? "";
    if (name === "admin" || name === "administrateur") return true;
  }
  return false;
}

// ── Revoke all OTHER approved/unknown mobiles for this user ──────────────────
async function revokeOtherMobiles(userId: number, keepFingerprint: string): Promise<boolean> {
  const others = await db.select({ fingerprint: userDevicesTable.fingerprint })
    .from(userDevicesTable)
    .where(and(
      eq(userDevicesTable.userId, userId),
      eq(userDevicesTable.deviceType, "mobile"),
      ne(userDevicesTable.fingerprint, keepFingerprint),
      or(eq(userDevicesTable.status, "approved"), eq(userDevicesTable.status, "unknown")),
    ));
  if (others.length === 0) return false;
  await db.update(userDevicesTable).set({
    status: "revoked", revokedAt: new Date(),
    revokedReason: "Session exclusive — connexion depuis un autre mobile approuvé",
  }).where(and(
    eq(userDevicesTable.userId, userId),
    eq(userDevicesTable.deviceType, "mobile"),
    ne(userDevicesTable.fingerprint, keepFingerprint),
    or(eq(userDevicesTable.status, "approved"), eq(userDevicesTable.status, "unknown")),
  ));
  for (const d of others) {
    await db.insert(deviceEventsTable).values({
      userId, fingerprint: d.fingerprint, deviceType: "mobile",
      action: "revoked",
      reason: "Session exclusive — connexion depuis un autre mobile approuvé",
    }).catch(() => {});
  }
  return true;
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password, deviceId } = req.body;
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
  const deviceInfo = parseUserAgent(ua);

  // ── Client-provided UUID as fingerprint (stable per browser install) ────────
  const fp = (typeof deviceId === "string" && deviceId.length >= 8)
    ? deviceId.slice(0, 64)
    : fingerprintUA(ua);

  // ── Admin/Administrateur: bypass all device enforcement ──────────────────────
  const isAdmin = await isAdminUser(user);

  if (!isAdmin) {
    // ── MOBILE enforcement: 1 mobile per account, strict ──────────────────────
    if (deviceInfo.deviceType === "mobile") {
      const [existingDevice] = await db.select().from(userDevicesTable)
        .where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.fingerprint, fp)));

      if (existingDevice) {
        if (existingDevice.status === "pending") {
          res.status(403).json({
            error: "Ce compte est déjà lié à un autre appareil. Veuillez contacter l'administration.",
            code: "DEVICE_PENDING_APPROVAL",
            deviceType: "mobile",
            isPending: true,
          });
          return;
        }
        if (existingDevice.status === "rejected" || existingDevice.status === "revoked") {
          await db.insert(deviceEventsTable).values({
            userId: user.id, fingerprint: fp, deviceType: "mobile",
            action: "failed_login", ip, userAgent: ua.slice(0, 500),
            meta: `Accès bloqué — appareil ${existingDevice.status}`,
          }).catch(() => {});
          res.status(403).json({
            error: "Accès refusé : cet appareil a été bloqué par l'administration.",
            code: "DEVICE_BLOCKED",
          });
          return;
        }
        // approved/unknown → cleanup any duplicate approved mobiles
        const hadDuplicates = await revokeOtherMobiles(user.id, fp);
        if (hadDuplicates) {
          await db.update(usersTable)
            .set({ tokenVersion: (user.tokenVersion ?? 0) + 1 })
            .where(eq(usersTable.id, user.id));
        }
      } else {
        // New mobile: check if a mobile is already registered
        const [activeMobile] = await db.select({ fingerprint: userDevicesTable.fingerprint })
          .from(userDevicesTable)
          .where(and(
            eq(userDevicesTable.userId, user.id),
            eq(userDevicesTable.deviceType, "mobile"),
            or(eq(userDevicesTable.status, "approved"), eq(userDevicesTable.status, "unknown")),
          ));

        if (activeMobile) {
          // Block — insert as pending and notify admin
          await db.insert(userDevicesTable).values({
            userId: user.id, fingerprint: fp, ...deviceInfo, ip,
            userAgent: ua.slice(0, 500), loginCount: 1, status: "pending",
          }).catch(() => {});
          await db.insert(deviceEventsTable).values({
            userId: user.id, fingerprint: fp, deviceType: "mobile",
            action: "pending_approval", ip, userAgent: ua.slice(0, 500),
            meta: "Nouveau mobile — en attente d'approbation administrative",
          }).catch(() => {});

          // Notify admins
          db.select({ id: usersTable.id }).from(usersTable)
            .where(and(eq(usersTable.adminAccess, true), eq(usersTable.status, "active")))
            .then(admins => {
              for (const admin of admins) {
                if (admin.id !== user.id) {
                  sendPushToUser(admin.id, {
                    title: `📱 Nouveau mobile — Approbation requise`,
                    body: `${user.name} · ${deviceInfo.deviceName} | IP: ${ip}`,
                    type: "security", link: "/users",
                  }).catch(() => {});
                }
              }
            }).catch(() => {});

          res.status(403).json({
            error: "Ce compte est déjà lié à un autre téléphone. Veuillez contacter l'administration.",
            code: "DEVICE_PENDING_APPROVAL",
            deviceType: "mobile",
            deviceName: deviceInfo.deviceName,
            isPending: false,
          });
          return;
        }
      }
    }
    // ── DESKTOP: no enforcement — free login from any computer ───────────────
    // (no check needed for desktop devices)
  }

  // ── Login allowed ────────────────────────────────────────────────────────────
  await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));

  // ── Device tracking (non-fatal) ──────────────────────────────────────────────
  try {
    const [existingDevice] = await db.select().from(userDevicesTable)
      .where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.fingerprint, fp)));

    const isNewDevice = !existingDevice;
    let isSuspicious = false;
    let suspiciousReason: string | null = null;

    // Cross-account detection for new mobile devices
    if (deviceInfo.deviceType === "mobile" && isNewDevice) {
      const [crossAccount] = await db.select({ userId: userDevicesTable.userId })
        .from(userDevicesTable)
        .where(and(eq(userDevicesTable.fingerprint, fp), ne(userDevicesTable.userId, user.id)));
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
        userId: user.id, fingerprint: fp, deviceType: existingDevice.deviceType,
        action: "login", ip, userAgent: ua.slice(0, 500),
      });
    }

    // GeoIP (fire-and-forget)
    getIpLocation(ip).then(location => {
      if (location) {
        db.update(userDevicesTable).set({ location })
          .where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.fingerprint, fp)))
          .catch(() => {});
      }
    }).catch(() => {});

    // Notify admins on new device or suspicious activity
    if (isNewDevice || isSuspicious) {
      db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.adminAccess, true), eq(usersTable.status, "active")))
        .then(admins => {
          const title = isSuspicious
            ? `🚨 Tentative suspecte — ${user.name}`
            : `📱 Nouvel appareil — ${user.name}`;
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

  // ── Issue token with the LATEST tokenVersion ─────────────────────────────────
  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  const tv = freshUser?.tokenVersion ?? 0;
  const token = generateToken(user.id, tv);
  res.json({ user: await buildUserResponse(freshUser ?? user), token });
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
