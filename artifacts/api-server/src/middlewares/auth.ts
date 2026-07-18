import { Request, Response, NextFunction } from "express";
import { parseToken } from "../lib/auth";
import { db, usersTable, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      user?: typeof usersTable.$inferSelect;
      userPermissions?: string[];
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = parseToken(token);
  if (!payload) {
    res.status(401).json({ error: "Token invalide" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user || user.status !== "active") {
    res.status(401).json({ error: "Utilisateur introuvable ou inactif" });
    return;
  }
  // Validate tokenVersion — if admin did "disconnect all", old tokens are invalid
  const userTv = user.tokenVersion ?? 0;
  if (userTv > 0 && payload.tv < userTv) {
    res.status(401).json({ error: "Session expirée, reconnectez-vous", code: "SESSION_REVOKED" });
    return;
  }
  req.userId = user.id;
  req.user = user;

  let permissions: string[] = [];
  if (user.adminAccess) {
    permissions = ["*"];
  } else if (user.roleId) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, user.roleId));
    permissions = role?.permissions ?? [];
  }
  req.userPermissions = permissions;
  next();
}
