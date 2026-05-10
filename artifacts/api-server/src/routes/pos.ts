import { Router, type IRouter } from "express";
import { db, posSessionsTable, branchesTable, usersTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission, assertBranchAccess, visibleBranchIds } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router: IRouter = Router();

async function buildSessionResponse(session: typeof posSessionsTable.$inferSelect) {
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, session.branchId));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  return {
    ...session, branchName: branch?.name ?? "", userName: user?.name ?? "",
    openingCash: parseFloat(session.openingCash as string),
    countedCash: session.countedCash ? parseFloat(session.countedCash as string) : null,
    expectedCash: session.expectedCash ? parseFloat(session.expectedCash as string) : null,
    variance: session.variance ? parseFloat(session.variance as string) : null,
    totalSales: parseFloat(session.totalSales as string),
    totalCashSales: parseFloat(session.totalCashSales as string),
    totalCardSales: parseFloat(session.totalCardSales as string),
    openedAt: session.openedAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null
  };
}

router.get("/pos/sessions", requireAuth, requirePermission(P.pos.view), async (req, res): Promise<void> => {
  const { branchId, status } = req.query as Record<string, string>;
  const scope = visibleBranchIds(req.user!);
  if (scope !== null && scope.length === 0) { res.json([]); return; }

  const conditions: any[] = [];
  if (scope !== null) {
    if (branchId) {
      const bid = parseInt(branchId, 10);
      if (!scope.includes(bid)) { res.status(403).json({ error: "Accès refusé à cette succursale" }); return; }
      conditions.push(eq(posSessionsTable.branchId, bid));
    } else {
      conditions.push(inArray(posSessionsTable.branchId, scope));
    }
  } else if (branchId) {
    conditions.push(eq(posSessionsTable.branchId, parseInt(branchId, 10)));
  }
  if (status) conditions.push(eq(posSessionsTable.status, status));
  const sessions = conditions.length
    ? await db.select().from(posSessionsTable).where(and(...conditions)).orderBy(sql`${posSessionsTable.openedAt} DESC`)
    : await db.select().from(posSessionsTable).orderBy(sql`${posSessionsTable.openedAt} DESC`);
  const result = await Promise.all(sessions.map(buildSessionResponse));
  res.json(result);
});

router.post("/pos/sessions", requireAuth, requirePermission(P.pos.openSession), async (req, res): Promise<void> => {
  const { branchId, openingCash } = req.body;
  if (!branchId) { res.status(400).json({ error: "Branche requise" }); return; }

  // Enforce branch POS settings
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, branchId));
  if (!branch) { res.status(404).json({ error: "Branche introuvable" }); return; }
  if (!branch.isActive) { res.status(403).json({ error: "Cette succursale est inactive", code: "BRANCH_INACTIVE" }); return; }
  if (!branch.salesActive) { res.status(403).json({ error: "Les ventes sont désactivées pour cette succursale", code: "SALES_INACTIVE" }); return; }
  if (!branch.posEnabled) { res.status(403).json({ error: "Le point de vente n'est pas activé pour cette succursale", code: "POS_DISABLED" }); return; }

  const existing = await db.select().from(posSessionsTable)
    .where(and(eq(posSessionsTable.branchId, branchId), eq(posSessionsTable.status, "open")));
  if (existing.length > 0) { res.status(400).json({ error: "Une session est déjà ouverte pour cette branche" }); return; }
  const [session] = await db.insert(posSessionsTable).values({
    branchId, userId: req.userId!, status: "open", openingCash: (openingCash ?? 0).toString()
  }).returning();
  res.status(201).json(await buildSessionResponse(session));
});

router.get("/pos/active-session", requireAuth, requirePermission(P.pos.view), async (req, res): Promise<void> => {
  const user = req.user!;
  const queryBranchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : null;
  const branchId = queryBranchId ?? (user.branchIds?.length ? user.branchIds[0] : null);
  if (!branchId) { res.json({ session: null }); return; }
  const [session] = await db.select().from(posSessionsTable)
    .where(and(eq(posSessionsTable.branchId, branchId), eq(posSessionsTable.status, "open")));
  res.json({ session: session ? await buildSessionResponse(session) : null });
});

router.get("/pos/sessions/:id", requireAuth, requirePermission(P.pos.view), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [session] = await db.select().from(posSessionsTable).where(eq(posSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }
  res.json(await buildSessionResponse(session));
});

router.post("/pos/sessions/:id/close", requireAuth, requirePermission(P.pos.closeSession), async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [session] = await db.select().from(posSessionsTable).where(eq(posSessionsTable.id, id));
  if (!session) { res.status(404).json({ error: "Session introuvable" }); return; }
  const { countedCash, closureNotes } = req.body;
  const expectedCash = parseFloat(session.openingCash as string) + parseFloat(session.totalCashSales as string);
  const variance = parseFloat(countedCash.toString()) - expectedCash;
  const [updated] = await db.update(posSessionsTable).set({
    status: "closed", countedCash: countedCash.toString(),
    expectedCash: expectedCash.toString(), variance: variance.toString(),
    closureNotes, closedAt: new Date()
  }).where(eq(posSessionsTable.id, id)).returning();
  res.json(await buildSessionResponse(updated));
});

export default router;
