import { Router, type IRouter } from "express";
import { db, usersTable, rolesTable } from "@workspace/db";
import { userAttendanceSettingsTable } from "@workspace/db";
import { eq, and, inArray, not, sql } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

function sanitize(user: typeof usersTable.$inferSelect, roleName: string | null = null) {
  const { passwordHash: _, ...safe } = user;
  return { ...safe, roleName };
}

router.get("/users", requireAuth, requirePermission(P.users.view), async (req, res): Promise<void> => {
  const { status, roleId } = req.query as Record<string, string>;
  const conditions = [];
  if (status) conditions.push(eq(usersTable.status, status));
  if (roleId) conditions.push(eq(usersTable.roleId, parseInt(roleId, 10)));
  const users = conditions.length
    ? await db.select().from(usersTable).where(and(...conditions)).orderBy(usersTable.name)
    : await db.select().from(usersTable).orderBy(usersTable.name);
  const roles = await db.select().from(rolesTable);
  const roleMap = Object.fromEntries(roles.map(r => [r.id, r.name]));
  res.json(users.map(u => sanitize(u, u.roleId ? roleMap[u.roleId] ?? null : null)));
});

router.post("/users", requireAuth, requirePermission(P.users.create), async (req, res): Promise<void> => {
  const { name, email, username, password, phone, status, language, roleId, branchIds, posAccess, adminAccess } = req.body;
  if (!name || !email || !username || !password) {
    res.status(400).json({ error: "Champs requis manquants" });
    return;
  }
  const passwordHash = hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name, email, username, passwordHash, phone, status: status ?? "active",
    language: language ?? "fr", roleId, branchIds: branchIds ?? [],
    posAccess: posAccess ?? false, adminAccess: adminAccess ?? false
  }).returning();
  let roleName: string | null = null;
  if (user.roleId) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
    roleName = role?.name ?? null;
  }
  // Auto-create attendance settings (pointageEnabled: false — admin must activate)
  const firstBranch = (branchIds && branchIds.length > 0) ? branchIds[0] : null;
  await db.insert(userAttendanceSettingsTable).values({
    userId: user.id,
    branchId: firstBranch,
    pointageEnabled: false,
    workStartTime: "08:00",
    workEndTime: "17:00",
    workDays: ["lun","mar","mer","jeu","ven"] as string[],
    gracePeriodMinutes: 10,
    baseSalary: "0",
    salaryType: "monthly",
    lateDeductionType: "per_minute",
    lateDeductionValue: "0",
    absenceDeductionValue: "0",
    earlyLeaveDeductionValue: "0",
    overtimeRateMultiplier: "1.5",
    maxDeductionPercent: 50,
    autoDeductions: false,
    updatedAt: new Date(),
  }).onConflictDoNothing();
  res.status(201).json(sanitize(user, roleName));
});

router.get("/users/:id", requireAuth, requirePermission(P.users.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }
  let roleName: string | null = null;
  if (user.roleId) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
    roleName = role?.name ?? null;
  }
  res.json(sanitize(user, roleName));
});

router.patch("/users/:id", requireAuth, requirePermission(P.users.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, email, password, phone, status, language, roleId, workerId, branchIds, posAccess, adminAccess } = req.body;
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (email != null) updates.email = email;
  // An empty password in the edit form means "keep the current password".
  // A non-empty password must replace the stored hash.
  if (typeof password === "string" && password.length > 0) {
    updates.passwordHash = hashPassword(password);
    updates.tokenVersion = sql`COALESCE(${usersTable.tokenVersion}, 0) + 1`;
  }
  if (phone != null) updates.phone = phone;
  if (status != null) updates.status = status;
  if (language != null) updates.language = language;
  if (roleId !== undefined) updates.roleId = roleId;
  if (workerId !== undefined) updates.workerId = workerId;
  if (branchIds != null) updates.branchIds = branchIds;
  if (posAccess != null) updates.posAccess = posAccess;
  if (adminAccess != null) updates.adminAccess = adminAccess;
  const [user] = await db.update(usersTable).set(updates as any).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }
  let roleName: string | null = null;
  if (user.roleId) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
    roleName = role?.name ?? null;
  }
  res.json(sanitize(user, roleName));
});

router.delete("/users/:id", requireAuth, requirePermission(P.users.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (id === req.userId) {
    res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" }); return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }
  if (target.adminAccess) {
    const adminCount = await db.$count(usersTable, and(eq(usersTable.adminAccess, true), not(eq(usersTable.id, id))));
    if (adminCount === 0) {
      res.status(400).json({ error: "Impossible de supprimer le dernier administrateur" }); return;
    }
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ success: true });
});

export default router;
