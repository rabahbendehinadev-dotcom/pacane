import { Router } from "express";
import { db, checklistTasksTable, checklistCompletionsTable, usersTable, userNotificationsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";

const router = Router();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET /checklist/summary — daily completion summary (manage perm)
router.get("/checklist/summary", requireAuth, requirePermission(P.checklist.manage), async (req, res): Promise<void> => {
  const dateParam = typeof req.query.date === "string" ? req.query.date : todayStr();

  // Get all active tasks with their completion status for the given date
  const rows = await db
    .select({
      userId: checklistTasksTable.assignedToUserId,
      userName: usersTable.name,
      taskId: checklistTasksTable.id,
      isDone: checklistCompletionsTable.isDone,
    })
    .from(checklistTasksTable)
    .leftJoin(usersTable, eq(usersTable.id, checklistTasksTable.assignedToUserId))
    .leftJoin(
      checklistCompletionsTable,
      and(
        eq(checklistCompletionsTable.taskId, checklistTasksTable.id),
        eq(checklistCompletionsTable.userId, checklistTasksTable.assignedToUserId),
        eq(checklistCompletionsTable.completionDate, dateParam)
      )
    )
    .where(eq(checklistTasksTable.isActive, true))
    .orderBy(asc(usersTable.name));

  // Group by worker
  const workerMap = new Map<number, { userId: number; userName: string; total: number; done: number }>();
  for (const row of rows) {
    if (row.userId === null) continue;
    if (!workerMap.has(row.userId)) {
      workerMap.set(row.userId, { userId: row.userId, userName: row.userName ?? "—", total: 0, done: 0 });
    }
    const w = workerMap.get(row.userId)!;
    w.total += 1;
    if (row.isDone) w.done += 1;
  }

  const workers = Array.from(workerMap.values());
  const totalTasks = workers.reduce((s, w) => s + w.total, 0);
  const totalDone = workers.reduce((s, w) => s + w.done, 0);
  const workersCompleted = workers.filter(w => w.total > 0 && w.done === w.total).length;

  res.json({
    date: dateParam,
    totalWorkers: workers.length,
    workersCompleted,
    totalTasks,
    totalDone,
    workers,
  });
});

// GET /checklist/my — مهامي اليوم (any authenticated user)
router.get("/checklist/my", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).user.id;
  const today = todayStr();

  const tasks = await db
    .select({
      id: checklistTasksTable.id,
      title: checklistTasksTable.title,
      description: checklistTasksTable.description,
      sortOrder: checklistTasksTable.sortOrder,
      completionId: checklistCompletionsTable.id,
      isDone: checklistCompletionsTable.isDone,
    })
    .from(checklistTasksTable)
    .leftJoin(
      checklistCompletionsTable,
      and(
        eq(checklistCompletionsTable.taskId, checklistTasksTable.id),
        eq(checklistCompletionsTable.userId, userId),
        eq(checklistCompletionsTable.completionDate, today)
      )
    )
    .where(
      and(
        eq(checklistTasksTable.assignedToUserId, userId),
        eq(checklistTasksTable.isActive, true)
      )
    )
    .orderBy(asc(checklistTasksTable.sortOrder), asc(checklistTasksTable.createdAt));

  res.json(tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    sortOrder: t.sortOrder,
    isDone: t.isDone ?? false,
  })));
});

// GET /checklist/users — list users for assignment (manage perm)
router.get("/checklist/users", requireAuth, requirePermission(P.checklist.manage), async (_req, res): Promise<void> => {
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.status, "active"))
    .orderBy(asc(usersTable.name));
  res.json(users);
});

// GET /checklist — all tasks (admin/manage)
router.get("/checklist", requireAuth, requirePermission(P.checklist.manage), async (req, res): Promise<void> => {
  const filterUserId = req.query.userId ? parseInt(req.query.userId as string, 10) : null;
  const today = todayStr();

  const tasks = await db
    .select({
      id: checklistTasksTable.id,
      title: checklistTasksTable.title,
      description: checklistTasksTable.description,
      assignedToUserId: checklistTasksTable.assignedToUserId,
      assignedToUserName: usersTable.name,
      sortOrder: checklistTasksTable.sortOrder,
      isActive: checklistTasksTable.isActive,
      createdAt: checklistTasksTable.createdAt,
      completionId: checklistCompletionsTable.id,
      isDoneToday: checklistCompletionsTable.isDone,
    })
    .from(checklistTasksTable)
    .leftJoin(usersTable, eq(usersTable.id, checklistTasksTable.assignedToUserId))
    .leftJoin(
      checklistCompletionsTable,
      and(
        eq(checklistCompletionsTable.taskId, checklistTasksTable.id),
        eq(checklistCompletionsTable.userId, checklistTasksTable.assignedToUserId),
        eq(checklistCompletionsTable.completionDate, today)
      )
    )
    .where(filterUserId ? eq(checklistTasksTable.assignedToUserId, filterUserId) : undefined)
    .orderBy(asc(checklistTasksTable.assignedToUserId), asc(checklistTasksTable.sortOrder));

  res.json(tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    assignedToUserId: t.assignedToUserId,
    assignedToUserName: t.assignedToUserName ?? "—",
    sortOrder: t.sortOrder,
    isActive: t.isActive,
    createdAt: t.createdAt,
    isDoneToday: t.isDoneToday ?? false,
  })));
});

// POST /checklist — create task
router.post("/checklist", requireAuth, requirePermission(P.checklist.manage), async (req, res): Promise<void> => {
  const { title, description, assignedToUserId, sortOrder } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "Titre requis" }); return; }
  if (!assignedToUserId) { res.status(400).json({ error: "Utilisateur requis" }); return; }

  const userId = parseInt(String(assignedToUserId), 10);

  const [task] = await db.insert(checklistTasksTable).values({
    title: title.trim(),
    description: description?.trim() || null,
    assignedToUserId: userId,
    createdByUserId: (req as any).user.id,
    sortOrder: sortOrder ?? 0,
  }).returning();

  try {
    await db.insert(userNotificationsTable).values({
      userId,
      type: "task_assigned",
      title: "لديك مهمة جديدة",
      message: `لديك مهمة جديدة: ${title.trim()}`,
      meta: { taskId: task.id },
    });
  } catch (notifErr) {
    req.log.warn({ err: notifErr, taskId: task.id }, "Failed to insert user notification for task assignment");
  }

  res.status(201).json(task);
});

// PATCH /checklist/:id
router.patch("/checklist/:id", requireAuth, requirePermission(P.checklist.manage), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { title, description, sortOrder, isActive } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title != null) updates.title = title.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (sortOrder != null) updates.sortOrder = sortOrder;
  if (isActive != null) updates.isActive = isActive;

  const [task] = await db.update(checklistTasksTable)
    .set(updates as any)
    .where(eq(checklistTasksTable.id, id))
    .returning();
  if (!task) { res.status(404).json({ error: "Tâche introuvable" }); return; }
  res.json(task);
});

// DELETE /checklist/:id
router.delete("/checklist/:id", requireAuth, requirePermission(P.checklist.manage), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  await db.delete(checklistCompletionsTable).where(eq(checklistCompletionsTable.taskId, id));
  const [task] = await db.delete(checklistTasksTable).where(eq(checklistTasksTable.id, id)).returning();
  if (!task) { res.status(404).json({ error: "Tâche introuvable" }); return; }
  res.json({ ok: true });
});

// POST /checklist/:id/complete
router.post("/checklist/:id/complete", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const userId = (req as any).user.id;
  const today = todayStr();

  const [task] = await db.select({ id: checklistTasksTable.id })
    .from(checklistTasksTable)
    .where(and(eq(checklistTasksTable.id, id), eq(checklistTasksTable.assignedToUserId, userId)));
  if (!task) { res.status(404).json({ error: "Tâche introuvable" }); return; }

  await db.delete(checklistCompletionsTable).where(
    and(
      eq(checklistCompletionsTable.taskId, id),
      eq(checklistCompletionsTable.userId, userId),
      eq(checklistCompletionsTable.completionDate, today)
    )
  );
  await db.insert(checklistCompletionsTable).values({
    taskId: id, userId, completionDate: today, isDone: true,
  });

  res.json({ ok: true });
});

// POST /checklist/:id/uncomplete
router.post("/checklist/:id/uncomplete", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const userId = (req as any).user.id;
  const today = todayStr();

  await db.delete(checklistCompletionsTable).where(
    and(
      eq(checklistCompletionsTable.taskId, id),
      eq(checklistCompletionsTable.userId, userId),
      eq(checklistCompletionsTable.completionDate, today)
    )
  );
  res.json({ ok: true });
});

export default router;
