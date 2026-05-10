import { Router, type IRouter } from "express";
import { db, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

router.get("/roles", requireAuth, requirePermission(P.roles.view), async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.name);
  res.json(roles);
});

router.post("/roles", requireAuth, requirePermission(P.roles.edit), async (req, res): Promise<void> => {
  const { name, description, permissions } = req.body;
  if (!name) { res.status(400).json({ error: "Nom requis" }); return; }
  const [role] = await db.insert(rolesTable).values({ name, description, permissions: permissions ?? [], isSystem: false }).returning();
  res.status(201).json(role);
});

router.get("/roles/:id", requireAuth, requirePermission(P.roles.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, id));
  if (!role) { res.status(404).json({ error: "Rôle introuvable" }); return; }
  res.json(role);
});

router.patch("/roles/:id", requireAuth, requirePermission(P.roles.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, description, permissions } = req.body;
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (description != null) updates.description = description;
  if (permissions != null) updates.permissions = permissions;
  const [role] = await db.update(rolesTable).set(updates as any).where(eq(rolesTable.id, id)).returning();
  if (!role) { res.status(404).json({ error: "Rôle introuvable" }); return; }
  res.json(role);
});

export default router;
