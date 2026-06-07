import { Router, type IRouter } from "express";
import { db, branchesTable, branchSellersTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

// Accessible à tout utilisateur authentifié :
// - adminAccess → toutes les branches
// - branchIds vide → aucune branche (utilisateur sans affectation)
// - branchIds définis → uniquement les branches assignées
router.get("/branches", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  if (user.adminAccess) {
    const branches = await db.select().from(branchesTable).orderBy(branchesTable.name);
    res.json(branches);
    return;
  }
  if (user.branchIds.length === 0) {
    res.json([]);
    return;
  }
  const branches = await db
    .select()
    .from(branchesTable)
    .where(inArray(branchesTable.id, user.branchIds))
    .orderBy(branchesTable.name);
  res.json(branches);
});

router.post("/branches", requireAuth, requirePermission(P.branches.create), async (req, res): Promise<void> => {
  const { name, code, type, address, city, phone, isActive, isMain } = req.body;
  if (!name || !code || !type) {
    res.status(400).json({ error: "Champs requis manquants" });
    return;
  }
  const [branch] = await db
    .insert(branchesTable)
    .values({ name, code, type, address, city, phone, isActive: isActive ?? true, isMain: isMain ?? false, posEnabled: true, requireOpenSession: false, salesActive: true })
    .returning();
  res.status(201).json(branch);
});

router.get("/branches/:id", requireAuth, requirePermission(P.branches.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, id));
  if (!branch) { res.status(404).json({ error: "Branche introuvable" }); return; }
  res.json(branch);
});

router.patch("/branches/:id", requireAuth, requirePermission(P.branches.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const updates: Record<string, unknown> = {};
  const allowed = ["name", "code", "type", "address", "city", "phone", "isActive", "isMain", "posEnabled", "requireOpenSession", "salesActive"];
  for (const key of allowed) {
    if (req.body[key] != null) updates[key] = req.body[key];
  }
  const [branch] = await db.update(branchesTable).set(updates as any).where(eq(branchesTable.id, id)).returning();
  if (!branch) { res.status(404).json({ error: "Branche introuvable" }); return; }
  res.json(branch);
});

router.delete("/branches/:id", requireAuth, requirePermission(P.branches.delete), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, id));
  if (!branch) { res.status(404).json({ error: "Boutique introuvable" }); return; }
  if (branch.isMain) { res.status(400).json({ error: "Impossible de supprimer la boutique principale" }); return; }
  await db.delete(branchesTable).where(eq(branchesTable.id, id));
  res.json({ success: true });
});

// ── Vendeurs d'une boutique ──────────────────────────────────────────────────

router.get("/branches/:id/sellers", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const rows = await db
    .select({ userId: branchSellersTable.userId, name: usersTable.name })
    .from(branchSellersTable)
    .leftJoin(usersTable, eq(branchSellersTable.userId, usersTable.id))
    .where(eq(branchSellersTable.branchId, id));
  res.json(rows);
});

router.put("/branches/:id/sellers", requireAuth, requirePermission(P.branches.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { userIds } = req.body;
  if (!Array.isArray(userIds)) {
    res.status(400).json({ error: "userIds doit être un tableau" });
    return;
  }
  await db.delete(branchSellersTable).where(eq(branchSellersTable.branchId, id));
  if (userIds.length > 0) {
    await db.insert(branchSellersTable).values(
      userIds.map((uid: number) => ({ branchId: id, userId: uid }))
    );
  }
  const rows = await db
    .select({ userId: branchSellersTable.userId, name: usersTable.name })
    .from(branchSellersTable)
    .leftJoin(usersTable, eq(branchSellersTable.userId, usersTable.id))
    .where(eq(branchSellersTable.branchId, id));
  res.json(rows);
});

export default router;
