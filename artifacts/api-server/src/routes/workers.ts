import { Router } from "express";
import { db, workersTable, productsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router = Router();

// GET /workers
router.get("/workers", requireAuth, requirePermission(P.workers.view), async (_req, res): Promise<void> => {
  const workers = await db.select({
    id: workersTable.id,
    name: workersTable.name,
    phone: workersTable.phone,
    isActive: workersTable.isActive,
    productCount: sql<number>`(SELECT COUNT(*) FROM products WHERE products.worker_id = ${workersTable.id})`,
    createdAt: workersTable.createdAt,
  }).from(workersTable).orderBy(workersTable.name);
  res.json(workers);
});

// POST /workers
router.post("/workers", requireAuth, requirePermission(P.workers.create), async (req, res): Promise<void> => {
  const { name, phone } = req.body;
  if (!name || !name.trim()) { res.status(400).json({ error: "Nom requis" }); return; }
  const [worker] = await db.insert(workersTable).values({ name: name.trim(), phone: phone?.trim() || null }).returning();
  res.status(201).json({ ...worker, productCount: 0 });
});

// PATCH /workers/:id
router.patch("/workers/:id", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const { name, phone } = req.body;
  if (!name || !name.trim()) { res.status(400).json({ error: "Nom requis" }); return; }
  const [worker] = await db.update(workersTable).set({ name: name.trim(), phone: phone?.trim() || null }).where(eq(workersTable.id, id)).returning();
  if (!worker) { res.status(404).json({ error: "Ouvrier introuvable" }); return; }
  res.json(worker);
});

// PATCH /workers/:id/deactivate
router.patch("/workers/:id/deactivate", requireAuth, requirePermission(P.workers.deactivate), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [worker] = await db.update(workersTable).set({ isActive: false }).where(eq(workersTable.id, id)).returning();
  if (!worker) { res.status(404).json({ error: "Ouvrier introuvable" }); return; }
  res.json(worker);
});

// PATCH /workers/:id/activate
router.patch("/workers/:id/activate", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [worker] = await db.update(workersTable).set({ isActive: true }).where(eq(workersTable.id, id)).returning();
  if (!worker) { res.status(404).json({ error: "Ouvrier introuvable" }); return; }
  res.json(worker);
});

export default router;
