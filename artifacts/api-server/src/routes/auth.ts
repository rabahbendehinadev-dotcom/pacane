import { Router, type IRouter } from "express";
import { db, usersTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth";
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
  const token = generateToken(user.id);
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
