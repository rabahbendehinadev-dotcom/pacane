import { Router, type IRouter } from "express";
import { db, usersTable, rolesTable } from "@workspace/db";
import { userDevicesTable, deviceEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth";
import { parseUserAgent, fingerprintUA } from "../lib/device-detection";
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
  await db.update(usersTable).set({ lastLogin: new Date() }).where(eq(usersTable.id, user.id));

  const ua = req.headers["user-agent"] ?? "Unknown";
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "";
  const fp = fingerprintUA(ua);
  const deviceInfo = parseUserAgent(ua);

  try {
    const [existing] = await db.select().from(userDevicesTable)
      .where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.fingerprint, fp)));

    if (!existing) {
      // Check if this mobile device is already used by another account
      let isSuspicious = false;
      let suspiciousReason: string | null = null;
      if (deviceInfo.deviceType === "mobile") {
        const [otherUser] = await db.select({ userId: userDevicesTable.userId })
          .from(userDevicesTable)
          .where(and(eq(userDevicesTable.fingerprint, fp), eq(userDevicesTable.status, "approved")));
        if (otherUser && otherUser.userId !== user.id) {
          isSuspicious = true;
          suspiciousReason = `Appareil déjà associé à un autre compte (userId: ${otherUser.userId})`;
        }
      }
      await db.insert(userDevicesTable).values({
        userId: user.id, fingerprint: fp, ...deviceInfo, ip,
        userAgent: ua.slice(0, 500), loginCount: 1,
        isSuspicious, suspiciousReason,
      });
      await db.insert(deviceEventsTable).values({
        userId: user.id, fingerprint: fp, deviceType: deviceInfo.deviceType,
        action: "new_device", ip, userAgent: ua.slice(0, 500),
        meta: isSuspicious ? suspiciousReason : null,
      });
    } else {
      await db.update(userDevicesTable).set({
        lastSeenAt: new Date(), ip, loginCount: (existing.loginCount ?? 0) + 1,
        userAgent: ua.slice(0, 500),
      }).where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.fingerprint, fp)));
      await db.insert(deviceEventsTable).values({
        userId: user.id, fingerprint: fp, deviceType: deviceInfo.deviceType,
        action: "login", ip, userAgent: ua.slice(0, 500),
      });
    }
  } catch (_err) {
    // Device tracking is non-fatal
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
