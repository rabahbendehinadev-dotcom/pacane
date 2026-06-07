import { Router, type IRouter } from "express";
import { db, branchesTable, branchSellersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

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

// ── Vendeurs d'une boutique (noms libres) ────────────────────────────────────

router.get("/branches/:id/sellers", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const rows = await db
    .select({ name: branchSellersTable.sellerName })
    .from(branchSellersTable)
    .where(eq(branchSellersTable.branchId, id))
    .orderBy(branchSellersTable.sellerName);
  res.json(rows.map(r => r.name));
});

router.put("/branches/:id/sellers", requireAuth, requirePermission(P.branches.edit), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { names } = req.body;
  if (!Array.isArray(names)) {
    res.status(400).json({ error: "names doit être un tableau" });
    return;
  }
  const cleaned = [...new Set(names.map((n: string) => String(n).trim()).filter(Boolean))];
  await db.delete(branchSellersTable).where(eq(branchSellersTable.branchId, id));
  if (cleaned.length > 0) {
    await db.insert(branchSellersTable).values(
      cleaned.map((name: string) => ({ branchId: id, sellerName: name }))
    );
  }
  res.json(cleaned);
});

export default router;
