import { Router, type IRouter } from "express";
import { db, expensesTable, branchesTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, inArray, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

function generateRef(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `DEP-${yy}${mm}-${rand}`;
}

function formatRow(r: { exp: typeof expensesTable.$inferSelect; branchName: string | null; userName: string | null }) {
  return {
    ...r.exp,
    branchName: r.branchName ?? "",
    createdByName: r.userName ?? null,
    amount: parseFloat(r.exp.amount as string),
  };
}

router.get("/expenses", requireAuth, requirePermission(P.expenses.view), async (req, res): Promise<void> => {
  const { branchId, category, paymentMethod, status, from, to, search } = req.query as Record<string, string>;

  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const conds: ReturnType<typeof and>[] = [];

  if (scope !== null) conds.push(inArray(expensesTable.branchId, scope));
  if (branchId) conds.push(eq(expensesTable.branchId, parseInt(branchId, 10)));
  if (category) conds.push(eq(expensesTable.category, category));
  if (paymentMethod) conds.push(eq(expensesTable.paymentMethod, paymentMethod));
  if (status) conds.push(eq(expensesTable.status, status));
  if (from) conds.push(gte(expensesTable.date, from));
  if (to) conds.push(lte(expensesTable.date, to));

  const rows = await db.select({
    exp: expensesTable,
    branchName: branchesTable.name,
    userName: usersTable.name,
  })
    .from(expensesTable)
    .leftJoin(branchesTable, eq(expensesTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(expensesTable.createdByUserId, usersTable.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt));

  let result = rows.map(formatRow);

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(r =>
      r.reference.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      (r.notes ?? "").toLowerCase().includes(q) ||
      (r.branchName ?? "").toLowerCase().includes(q)
    );
  }

  res.json(result);
});

router.get("/expenses/:id", requireAuth, requirePermission(P.expenses.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.select({
    exp: expensesTable,
    branchName: branchesTable.name,
    userName: usersTable.name,
  })
    .from(expensesTable)
    .leftJoin(branchesTable, eq(expensesTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(expensesTable.createdByUserId, usersTable.id))
    .where(eq(expensesTable.id, id));

  if (!row) { res.status(404).json({ error: "Dépense introuvable" }); return; }

  const scope = visibleBranchIds(req.user!);
  if (scope !== null && !scope.includes(row.exp.branchId)) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  res.json(formatRow(row));
});

router.post("/expenses", requireAuth, requirePermission(P.expenses.create), async (req, res): Promise<void> => {
  const { branchId, category, amount, date, paymentMethod, status, notes, attachmentUrl } = req.body;

  if (!branchId || !category || !amount || !date) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }

  if (!assertBranchAccess(req.user!, parseInt(branchId, 10), res)) return;

  const reference = generateRef();

  const [expense] = await db.insert(expensesTable).values({
    reference,
    branchId: parseInt(branchId, 10),
    category,
    amount: parseFloat(amount).toFixed(2),
    date,
    paymentMethod: paymentMethod ?? "cash",
    status: status ?? "validated",
    notes: notes ?? null,
    attachmentUrl: attachmentUrl ?? null,
    createdByUserId: req.userId,
  }).returning();

  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, parseInt(branchId, 10)));

  res.status(201).json({
    ...expense,
    branchName: branch?.name ?? "",
    createdByName: null,
    amount: parseFloat(expense.amount as string),
  });
});

router.put("/expenses/:id", requireAuth, requirePermission(P.expenses.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Dépense introuvable" }); return; }

  if (!assertBranchAccess(req.user!, existing.branchId, res)) return;

  const { category, amount, date, paymentMethod, status, notes, attachmentUrl, branchId } = req.body;

  if (branchId && branchId !== existing.branchId) {
    if (!assertBranchAccess(req.user!, parseInt(branchId, 10), res)) return;
  }

  const [updated] = await db.update(expensesTable).set({
    ...(category && { category }),
    ...(amount !== undefined && { amount: parseFloat(amount).toFixed(2) }),
    ...(date && { date }),
    ...(paymentMethod && { paymentMethod }),
    ...(status && { status }),
    ...(notes !== undefined && { notes }),
    ...(attachmentUrl !== undefined && { attachmentUrl }),
    ...(branchId && { branchId: parseInt(branchId, 10) }),
    updatedAt: new Date(),
  }).where(eq(expensesTable.id, id)).returning();

  const rows = await db.select({
    exp: expensesTable,
    branchName: branchesTable.name,
    userName: usersTable.name,
  })
    .from(expensesTable)
    .leftJoin(branchesTable, eq(expensesTable.branchId, branchesTable.id))
    .leftJoin(usersTable, eq(expensesTable.createdByUserId, usersTable.id))
    .where(eq(expensesTable.id, id));

  res.json(formatRow(rows[0]));
});

router.delete("/expenses/:id", requireAuth, requirePermission(P.expenses.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [existing] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Dépense introuvable" }); return; }

  if (!assertBranchAccess(req.user!, existing.branchId, res)) return;

  await db.delete(expensesTable).where(eq(expensesTable.id, id));
  res.json({ success: true });
});

export default router;
