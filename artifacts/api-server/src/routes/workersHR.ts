import { Router } from "express";
import { db } from "@workspace/db";
import {
  workersTable,
  workerAttendanceTable,
  workerWarningsTable,
  workerBonusesTable,
  workerNotificationsTable,
  workerActivityLogsTable,
} from "@workspace/db/schema";
import { eq, desc, and, gte, lte, sql, count, sum, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helper — compute performance score for one worker
// ─────────────────────────────────────────────────────────────────────────────
async function computePerformanceScore(workerId: number): Promise<{
  score: number;
  label: string;
  attendanceRate: number;
  punctualityRate: number;
  warningsLast90: number;
  bonusesLast90: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  totalDays: number;
}> {
  const now = new Date();
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);

  const d90Str = d90.toISOString().split("T")[0];
  const d30Str = d30.toISOString().split("T")[0];

  const [attendance, warnings, bonuses] = await Promise.all([
    db.select().from(workerAttendanceTable)
      .where(and(eq(workerAttendanceTable.workerId, workerId), gte(workerAttendanceTable.date, d30Str))),
    db.select({ id: workerWarningsTable.id }).from(workerWarningsTable)
      .where(and(eq(workerWarningsTable.workerId, workerId), gte(workerWarningsTable.createdAt, d90))),
    db.select({ id: workerBonusesTable.id }).from(workerBonusesTable)
      .where(and(eq(workerBonusesTable.workerId, workerId), gte(workerBonusesTable.bonusDate, d90Str))),
  ]);

  const presentDays = attendance.filter(a => a.status === "present").length;
  const lateDays = attendance.filter(a => a.status === "late").length;
  const halfDays = attendance.filter(a => a.status === "half_day").length;
  const absentDays = attendance.filter(a => a.status === "absent").length;
  const totalRecorded = attendance.length;
  const workingDays = totalRecorded > 0 ? totalRecorded : 22; // default month estimate

  const attendanceNumerator = presentDays + lateDays + halfDays * 0.5;
  const attendanceRate = Math.min(100, Math.round((attendanceNumerator / workingDays) * 100));

  const punctualityDenom = presentDays + lateDays;
  const punctualityRate = punctualityDenom > 0
    ? Math.round((presentDays / punctualityDenom) * 100)
    : 100;

  const warningsLast90 = warnings.length;
  const bonusesLast90 = bonuses.length;

  // Weighted formula
  const attScore = attendanceRate * 0.40;
  const punctScore = punctualityRate * 0.30;
  const bonusScore = Math.min(bonusesLast90 * 10, 20) * 1.0; // max +20 pts
  const warnPenalty = Math.min(warningsLast90 * 15, 30);     // max -30 pts

  const score = Math.max(0, Math.min(100, Math.round(attScore + punctScore + bonusScore - warnPenalty)));

  let label = "Excellent";
  if (score < 40) label = "Doit s'améliorer";
  else if (score < 55) label = "Moyen";
  else if (score < 70) label = "Bien";
  else if (score < 85) label = "Très bien";

  return {
    score, label, attendanceRate, punctualityRate,
    warningsLast90, bonusesLast90,
    presentDays, lateDays, absentDays, totalDays: workingDays,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────────────────────────────────────
// GET /workers/:id/attendance?month=YYYY-MM
router.get("/workers/:id/attendance", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const monthParam = req.query.month as string | undefined;
  const conds = [eq(workerAttendanceTable.workerId, id)];

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    const from = `${y}-${m}-01`;
    const toDate = new Date(parseInt(y), parseInt(m), 0);
    const to = toDate.toISOString().split("T")[0];
    conds.push(gte(workerAttendanceTable.date, from), lte(workerAttendanceTable.date, to));
  }

  const rows = await db.select().from(workerAttendanceTable)
    .where(and(...conds))
    .orderBy(desc(workerAttendanceTable.date));
  res.json(rows);
});

// POST /workers/:id/attendance — upsert (one per day per worker)
router.post("/workers/:id/attendance", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { date, status, checkIn, checkOut, reason, notes } = req.body;
  if (!date || !status) { res.status(400).json({ error: "date et status requis" }); return; }

  const VALID = ["present", "late", "absent", "vacation", "sick", "half_day"];
  if (!VALID.includes(status)) { res.status(400).json({ error: "Statut invalide" }); return; }

  // Upsert: conflict on (worker_id, date)
  const [row] = await db.insert(workerAttendanceTable)
    .values({ workerId: id, date, status, checkIn: checkIn || null, checkOut: checkOut || null, reason: reason || null, notes: notes || null })
    .onConflictDoUpdate({
      target: [workerAttendanceTable.workerId, workerAttendanceTable.date],
      set: { status, checkIn: checkIn || null, checkOut: checkOut || null, reason: reason || null, notes: notes || null, updatedAt: sql`NOW()` },
    })
    .returning();

  // Activity log
  await db.insert(workerActivityLogsTable).values({
    workerId: id,
    action: `attendance_${status}`,
    field: "date",
    newValue: date,
    performedByUserId: (req as any).user?.id ?? null,
    performedByName: (req as any).user?.username ?? null,
  });

  res.json(row);
});

// PATCH /workers/:id/attendance/:attId
router.patch("/workers/:id/attendance/:attId", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const workerId = parseInt(req.params.id, 10);
  const attId = parseInt(req.params.attId, 10);
  if (isNaN(workerId) || isNaN(attId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { status, checkIn, checkOut, reason, notes } = req.body;
  const [row] = await db.update(workerAttendanceTable)
    .set({
      ...(status && { status }),
      checkIn: checkIn !== undefined ? checkIn : undefined,
      checkOut: checkOut !== undefined ? checkOut : undefined,
      reason: reason !== undefined ? reason : undefined,
      notes: notes !== undefined ? notes : undefined,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(workerAttendanceTable.id, attId), eq(workerAttendanceTable.workerId, workerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Entrée introuvable" }); return; }
  res.json(row);
});

// DELETE /workers/:id/attendance/:attId
router.delete("/workers/:id/attendance/:attId", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const workerId = parseInt(req.params.id, 10);
  const attId = parseInt(req.params.attId, 10);
  if (isNaN(workerId) || isNaN(attId)) { res.status(400).json({ error: "ID invalide" }); return; }
  await db.delete(workerAttendanceTable)
    .where(and(eq(workerAttendanceTable.id, attId), eq(workerAttendanceTable.workerId, workerId)));
  res.json({ ok: true });
});

// GET /workers/attendance-today — all workers + today's status
router.get("/workers/attendance-today", requireAuth, requirePermission(P.workers.view), async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const [workers, attendance] = await Promise.all([
    db.select({ id: workersTable.id, name: workersTable.name, photoUrl: workersTable.photoUrl, position: workersTable.position })
      .from(workersTable).where(eq(workersTable.isActive, true)).orderBy(workersTable.name),
    db.select().from(workerAttendanceTable).where(eq(workerAttendanceTable.date, today)),
  ]);
  const attMap = new Map(attendance.map(a => [a.workerId, a]));
  res.json(workers.map(w => ({ ...w, today: attMap.get(w.id) ?? null })));
});

// POST /workers/attendance-bulk — bulk save for a date
router.post("/workers/attendance-bulk", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const { date, entries } = req.body as { date: string; entries: { workerId: number; status: string; checkIn?: string; checkOut?: string; reason?: string }[] };
  if (!date || !Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: "date et entries requis" }); return;
  }
  const VALID = ["present", "late", "absent", "vacation", "sick", "half_day"];
  const results = [];
  for (const e of entries) {
    if (!VALID.includes(e.status)) continue;
    const [row] = await db.insert(workerAttendanceTable)
      .values({ workerId: e.workerId, date, status: e.status, checkIn: e.checkIn || null, checkOut: e.checkOut || null, reason: e.reason || null })
      .onConflictDoUpdate({
        target: [workerAttendanceTable.workerId, workerAttendanceTable.date],
        set: { status: e.status, checkIn: e.checkIn || null, checkOut: e.checkOut || null, reason: e.reason || null, updatedAt: sql`NOW()` },
      })
      .returning();
    results.push(row);
  }
  res.json(results);
});

// ─────────────────────────────────────────────────────────────────────────────
// WARNINGS
// ─────────────────────────────────────────────────────────────────────────────
// GET /workers/:id/warnings
router.get("/workers/:id/warnings", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const rows = await db.select().from(workerWarningsTable)
    .where(eq(workerWarningsTable.workerId, id))
    .orderBy(desc(workerWarningsTable.createdAt));
  res.json(rows);
});

// POST /workers/:id/warnings
router.post("/workers/:id/warnings", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { title, description, severity } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "Titre requis" }); return; }
  const SEVERITIES = ["low", "medium", "high", "critical"];
  const sev = SEVERITIES.includes(severity) ? severity : "medium";

  const [row] = await db.insert(workerWarningsTable)
    .values({ workerId: id, title: title.trim(), description: description?.trim() || null, severity: sev })
    .returning();

  // Notification
  await db.insert(workerNotificationsTable).values({
    workerId: id,
    type: "warning",
    referenceId: row.id,
    title: `Avertissement : ${title.trim()}`,
    message: description?.trim() || null,
  });

  // Activity log
  await db.insert(workerActivityLogsTable).values({
    workerId: id,
    action: "warning_issued",
    newValue: title.trim(),
    performedByUserId: (req as any).user?.id ?? null,
    performedByName: (req as any).user?.username ?? null,
  });

  res.status(201).json(row);
});

// PATCH /workers/:id/warnings/:warnId — close / reopen / update
router.patch("/workers/:id/warnings/:warnId", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const workerId = parseInt(req.params.id, 10);
  const warnId = parseInt(req.params.warnId, 10);
  if (isNaN(workerId) || isNaN(warnId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { status, title, description, severity } = req.body;
  const patch: Record<string, any> = { updatedAt: sql`NOW()` };
  if (title !== undefined) patch.title = title.trim();
  if (description !== undefined) patch.description = description?.trim() || null;
  if (severity !== undefined) patch.severity = severity;
  if (status !== undefined) {
    patch.status = status;
    patch.closedAt = status === "closed" ? sql`NOW()` : null;
  }

  const [row] = await db.update(workerWarningsTable)
    .set(patch)
    .where(and(eq(workerWarningsTable.id, warnId), eq(workerWarningsTable.workerId, workerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Avertissement introuvable" }); return; }
  res.json(row);
});

// DELETE /workers/:id/warnings/:warnId
router.delete("/workers/:id/warnings/:warnId", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const workerId = parseInt(req.params.id, 10);
  const warnId = parseInt(req.params.warnId, 10);
  if (isNaN(workerId) || isNaN(warnId)) { res.status(400).json({ error: "ID invalide" }); return; }
  await db.delete(workerWarningsTable)
    .where(and(eq(workerWarningsTable.id, warnId), eq(workerWarningsTable.workerId, workerId)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// BONUSES (PRIMES)
// ─────────────────────────────────────────────────────────────────────────────
// GET /workers/:id/bonuses
router.get("/workers/:id/bonuses", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const rows = await db.select().from(workerBonusesTable)
    .where(eq(workerBonusesTable.workerId, id))
    .orderBy(desc(workerBonusesTable.bonusDate));
  res.json(rows);
});

// POST /workers/:id/bonuses
router.post("/workers/:id/bonuses", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { amount, reason, bonusType, bonusDate } = req.body;
  if (!amount || !reason?.trim()) { res.status(400).json({ error: "Montant et raison requis" }); return; }
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "Montant invalide" }); return; }

  const TYPES = ["performance", "attendance", "loyalty", "special", "other"];
  const type = TYPES.includes(bonusType) ? bonusType : "performance";
  const date = bonusDate || new Date().toISOString().split("T")[0];

  const [row] = await db.insert(workerBonusesTable)
    .values({ workerId: id, amount: String(amt), reason: reason.trim(), bonusType: type, bonusDate: date })
    .returning();

  // Notification
  await db.insert(workerNotificationsTable).values({
    workerId: id,
    type: "bonus",
    referenceId: row.id,
    title: `Prime accordée : ${amt.toLocaleString("fr-FR")} DA`,
    message: reason.trim(),
  });

  // Activity log
  await db.insert(workerActivityLogsTable).values({
    workerId: id,
    action: "bonus_granted",
    newValue: `${amt} DA — ${reason.trim()}`,
    performedByUserId: (req as any).user?.id ?? null,
    performedByName: (req as any).user?.username ?? null,
  });

  res.status(201).json(row);
});

// DELETE /workers/:id/bonuses/:bonusId
router.delete("/workers/:id/bonuses/:bonusId", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const workerId = parseInt(req.params.id, 10);
  const bonusId = parseInt(req.params.bonusId, 10);
  if (isNaN(workerId) || isNaN(bonusId)) { res.status(400).json({ error: "ID invalide" }); return; }
  await db.delete(workerBonusesTable)
    .where(and(eq(workerBonusesTable.id, bonusId), eq(workerBonusesTable.workerId, workerId)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
// GET /workers/:id/notifications
router.get("/workers/:id/notifications", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const rows = await db.select().from(workerNotificationsTable)
    .where(eq(workerNotificationsTable.workerId, id))
    .orderBy(desc(workerNotificationsTable.createdAt))
    .limit(50);
  res.json(rows);
});

// PATCH /workers/:id/notifications/read-all
router.patch("/workers/:id/notifications/read-all", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  await db.update(workerNotificationsTable)
    .set({ isRead: true })
    .where(eq(workerNotificationsTable.workerId, id));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE SCORE
// ─────────────────────────────────────────────────────────────────────────────
// GET /workers/:id/performance
router.get("/workers/:id/performance", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const result = await computePerformanceScore(id);
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// HR DASHBOARD STATS
// ─────────────────────────────────────────────────────────────────────────────
// GET /workers/hr-stats
router.get("/workers/hr-stats", requireAuth, requirePermission(P.workers.view), async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const firstOfMonthStr = firstOfMonth.toISOString().split("T")[0];

  const [workerCounts, todayAtt, openWarnings, monthlyBonuses] = await Promise.all([
    db.select({
      total: count(),
      active: sql<number>`COUNT(*) FILTER (WHERE is_active = TRUE)`,
      inactive: sql<number>`COUNT(*) FILTER (WHERE is_active = FALSE)`,
    }).from(workersTable),
    db.select().from(workerAttendanceTable).where(eq(workerAttendanceTable.date, today)),
    db.select({ count: count() }).from(workerWarningsTable).where(eq(workerWarningsTable.status, "open")),
    db.select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
      .from(workerBonusesTable)
      .where(gte(workerBonusesTable.bonusDate, firstOfMonthStr)),
  ]);

  const activeWorkerCount = Number(workerCounts[0]?.active ?? 0);
  const att = todayAtt;
  const present = att.filter(a => a.status === "present").length;
  const late = att.filter(a => a.status === "late").length;
  const absent = att.filter(a => a.status === "absent").length;
  const vacation = att.filter(a => a.status === "vacation" || a.status === "sick").length;
  const halfDay = att.filter(a => a.status === "half_day").length;
  const notRecorded = Math.max(0, activeWorkerCount - att.length);

  // Monthly attendance rate (last 30 days)
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);
  const monthlyAtt = await db.select({
    status: workerAttendanceTable.status,
    cnt: count(),
  })
    .from(workerAttendanceTable)
    .where(gte(workerAttendanceTable.date, d30.toISOString().split("T")[0]))
    .groupBy(workerAttendanceTable.status);

  const mPresent = Number(monthlyAtt.find(r => r.status === "present")?.cnt ?? 0);
  const mLate = Number(monthlyAtt.find(r => r.status === "late")?.cnt ?? 0);
  const mHalf = Number(monthlyAtt.find(r => r.status === "half_day")?.cnt ?? 0);
  const mTotal = monthlyAtt.reduce((acc, r) => acc + Number(r.cnt), 0);
  const monthlyAttRate = mTotal > 0 ? Math.round(((mPresent + mLate + mHalf * 0.5) / mTotal) * 100) : 0;
  const monthlyPunctRate = (mPresent + mLate) > 0 ? Math.round((mPresent / (mPresent + mLate)) * 100) : 100;

  res.json({
    totalWorkers: Number(workerCounts[0]?.total ?? 0),
    activeWorkers: activeWorkerCount,
    inactiveWorkers: Number(workerCounts[0]?.inactive ?? 0),
    today: { present, late, absent, vacation, halfDay, notRecorded },
    openWarnings: Number(openWarnings[0]?.count ?? 0),
    monthlyBonusTotal: parseFloat(monthlyBonuses[0]?.total ?? "0"),
    monthlyAttRate,
    monthlyPunctRate,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKER RANKING (top 10 by performance)
// ─────────────────────────────────────────────────────────────────────────────
// GET /workers/ranking
router.get("/workers/ranking", requireAuth, requirePermission(P.workers.view), async (_req, res): Promise<void> => {
  const workers = await db.select({
    id: workersTable.id,
    name: workersTable.name,
    photoUrl: workersTable.photoUrl,
    position: workersTable.position,
    department: workersTable.department,
  }).from(workersTable).where(eq(workersTable.isActive, true));

  const scored = await Promise.all(
    workers.map(async w => {
      const perf = await computePerformanceScore(w.id);
      return { ...w, ...perf };
    })
  );

  scored.sort((a, b) => b.score - a.score);
  res.json(scored.slice(0, 10));
});

// ─────────────────────────────────────────────────────────────────────────────
// ATTENDANCE REPORT (monthly summary per worker)
// ─────────────────────────────────────────────────────────────────────────────
// GET /workers/hr-report?month=YYYY-MM
router.get("/workers/hr-report", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const monthParam = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const [y, m] = monthParam.split("-");
  const from = `${y}-${m}-01`;
  const toDate = new Date(parseInt(y), parseInt(m), 0);
  const to = toDate.toISOString().split("T")[0];

  const [workers, attendance, warnings, bonuses] = await Promise.all([
    db.select({
      id: workersTable.id,
      name: workersTable.name,
      position: workersTable.position,
      photoUrl: workersTable.photoUrl,
    }).from(workersTable).where(eq(workersTable.isActive, true)).orderBy(workersTable.name),
    db.select().from(workerAttendanceTable)
      .where(and(gte(workerAttendanceTable.date, from), lte(workerAttendanceTable.date, to))),
    db.select({ workerId: workerWarningsTable.workerId, cnt: count() })
      .from(workerWarningsTable)
      .where(and(gte(workerWarningsTable.createdAt, new Date(from)), lte(workerWarningsTable.createdAt, new Date(to + "T23:59:59"))))
      .groupBy(workerWarningsTable.workerId),
    db.select({ workerId: workerBonusesTable.workerId, total: sql<string>`COALESCE(SUM(amount),0)` })
      .from(workerBonusesTable)
      .where(and(gte(workerBonusesTable.bonusDate, from), lte(workerBonusesTable.bonusDate, to)))
      .groupBy(workerBonusesTable.workerId),
  ]);

  const warnMap = new Map(warnings.map(w => [w.workerId, Number(w.cnt)]));
  const bonusMap = new Map(bonuses.map(b => [b.workerId, parseFloat(b.total)]));

  const report = workers.map(w => {
    const wAtt = attendance.filter(a => a.workerId === w.id);
    const present = wAtt.filter(a => a.status === "present").length;
    const late = wAtt.filter(a => a.status === "late").length;
    const absent = wAtt.filter(a => a.status === "absent").length;
    const vacation = wAtt.filter(a => a.status === "vacation").length;
    const sick = wAtt.filter(a => a.status === "sick").length;
    const halfDay = wAtt.filter(a => a.status === "half_day").length;
    const total = wAtt.length;
    const attRate = total > 0 ? Math.round(((present + late + halfDay * 0.5) / total) * 100) : null;

    return {
      ...w,
      present, late, absent, vacation, sick, halfDay, total, attRate,
      warnings: warnMap.get(w.id) ?? 0,
      bonusTotal: bonusMap.get(w.id) ?? 0,
    };
  });

  res.json({ month: monthParam, workers: report });
});

export { router as workersHRRouter };
