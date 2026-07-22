/**
 * support-tickets.ts
 * Worker submits problem reports; admin manages and responds.
 */
import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { logger } from "../lib/logger";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (!req.user?.adminAccess) { res.status(403).json({ error: "Admin uniquement" }); return; }
  next();
}

async function generateTicketRef(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM support_tickets WHERE ticket_ref LIKE $1`,
    [`TICKET-${year}-%`]
  );
  const seq = parseInt(result.rows[0]?.cnt || "0") + 1;
  return `TICKET-${year}-${String(seq).padStart(4, "0")}`;
}

// ── Worker endpoints ──────────────────────────────────────────────────────────

// GET /api/support-tickets/my
router.get("/support-tickets/my", requireAuth, async (req: any, res: any): Promise<void> => {
  const userId = req.user.id;
  try {
    const rows = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id AND r.is_internal = false) as reply_count,
        (SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id AND r.is_internal = false AND r.user_id != $1) as unread_replies
      FROM support_tickets t
      WHERE t.user_id = $1
      ORDER BY t.updated_at DESC
    `, [userId]);
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/support-tickets — worker creates ticket
router.post("/support-tickets", requireAuth, async (req: any, res: any): Promise<void> => {
  const { title, type, description, urgency, fileUrl } = req.body;
  const userId = req.user.id;
  const userName = req.user.name;

  if (!title || !description) { res.status(400).json({ error: "Titre et description requis" }); return; }

  try {
    // Get worker info from user
    const userResult = await pool.query(
      `SELECT u.worker_id, w.name as worker_name, u.default_branch_id, b.name as branch_name
       FROM users u
       LEFT JOIN workers w ON w.id = u.worker_id
       LEFT JOIN branches b ON b.id = u.default_branch_id
       WHERE u.id = $1`,
      [userId]
    );
    const userRow = userResult.rows[0];
    const ticketRef = await generateTicketRef();

    const result = await pool.query(`
      INSERT INTO support_tickets
        (ticket_ref, user_id, user_name, worker_id, worker_name, branch_id, branch_name, title, type, description, urgency, file_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      ticketRef, userId, userName,
      userRow?.worker_id || null, userRow?.worker_name || null,
      userRow?.default_branch_id || null, userRow?.branch_name || null,
      title, type || "other", description, urgency || "normal", fileUrl || null
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "POST /support-tickets error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/support-tickets/:id — worker OR admin
router.get("/support-tickets/:id", requireAuth, async (req: any, res: any): Promise<void> => {
  const id = parseInt(req.params.id);
  const userId = req.user.id;
  const isAdmin = req.user.adminAccess;

  try {
    const ticketResult = await pool.query(`SELECT * FROM support_tickets WHERE id = $1`, [id]);
    if (!ticketResult.rows.length) { res.status(404).json({ error: "Billet introuvable" }); return; }

    const ticket = ticketResult.rows[0];
    if (!isAdmin && ticket.user_id !== userId) { res.status(403).json({ error: "Accès refusé" }); return; }

    // Get replies — workers don't see internal notes
    const repliesQuery = isAdmin
      ? `SELECT * FROM ticket_replies WHERE ticket_id = $1 ORDER BY created_at ASC`
      : `SELECT * FROM ticket_replies WHERE ticket_id = $1 AND is_internal = false ORDER BY created_at ASC`;
    const replies = await pool.query(repliesQuery, [id]);

    res.json({ ticket, replies: replies.rows });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/support-tickets/:id/replies — create reply (worker or admin)
router.post("/support-tickets/:id/replies", requireAuth, async (req: any, res: any): Promise<void> => {
  const ticketId = parseInt(req.params.id);
  const userId = req.user.id;
  const userName = req.user.name;
  const isAdmin = req.user.adminAccess;
  const { body, isInternal, fileUrl } = req.body;

  if (!body?.trim()) { res.status(400).json({ error: "Contenu requis" }); return; }

  try {
    const ticketResult = await pool.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
    if (!ticketResult.rows.length) { res.status(404).json({ error: "Billet introuvable" }); return; }

    const ticket = ticketResult.rows[0];
    if (!isAdmin && ticket.user_id !== userId) { res.status(403).json({ error: "Accès refusé" }); return; }

    const internal = isAdmin && !!isInternal;

    const replyResult = await pool.query(`
      INSERT INTO ticket_replies (ticket_id, user_id, user_name, body, is_internal, file_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [ticketId, userId, userName, body.trim(), internal, fileUrl || null]);

    // Update ticket updated_at
    await pool.query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId]);

    // If admin replies, move to "processing" if still new/reviewing
    if (isAdmin && !internal && ["new", "reviewing"].includes(ticket.status)) {
      await pool.query(`UPDATE support_tickets SET status = 'processing' WHERE id = $1`, [ticketId]);
    }

    res.status(201).json(replyResult.rows[0]);
  } catch (err) {
    logger.error({ err }, "POST /support-tickets/:id/replies error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

// GET /api/support-tickets — admin list with filters
router.get("/support-tickets", requireAuth, requirePermission(P.adminTickets.view), async (req: any, res: any): Promise<void> => {
  const { status, urgency, type: ticketType, userId: filterUserId, branchId } = req.query;
  const page = parseInt(req.query.page as string) || 1;
  const limit = 25;
  const offset = (page - 1) * limit;

  try {
    let where = "WHERE 1=1";
    const params: any[] = [];

    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    if (urgency) { params.push(urgency); where += ` AND t.urgency = $${params.length}`; }
    if (ticketType) { params.push(ticketType); where += ` AND t.type = $${params.length}`; }
    if (filterUserId) { params.push(parseInt(filterUserId as string)); where += ` AND t.user_id = $${params.length}`; }
    if (branchId) { params.push(parseInt(branchId as string)); where += ` AND t.branch_id = $${params.length}`; }

    params.push(limit);
    params.push(offset);

    const rows = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id) as reply_count
      FROM support_tickets t
      ${where}
      ORDER BY
        CASE t.status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'processing' THEN 2 ELSE 3 END,
        CASE t.urgency WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const countParams = params.slice(0, -2);
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM support_tickets t ${where.replace(`$${params.length - 1}`, "").replace(`$${params.length}`, "")}`,
      countParams
    );

    // Stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as new_count,
        COUNT(*) FILTER (WHERE status = 'processing') as processing_count,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
        COUNT(*) FILTER (WHERE urgency = 'critical') as critical_count
      FROM support_tickets
    `);

    res.json({
      tickets: rows.rows,
      total: parseInt(countResult.rows[0]?.count || "0"),
      page,
      stats: statsResult.rows[0],
    });
  } catch (err) {
    logger.error({ err }, "GET /support-tickets error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /api/support-tickets/:id — admin update
router.patch("/support-tickets/:id", requireAuth, requirePermission(P.adminTickets.edit), async (req: any, res: any): Promise<void> => {
  const id = parseInt(req.params.id);
  const { status, urgency, assigneeUserId, assigneeName, internalNote } = req.body;

  try {
    const fields: string[] = [];
    const params: any[] = [];

    if (status !== undefined) { params.push(status); fields.push(`status = $${params.length}`); }
    if (urgency !== undefined) { params.push(urgency); fields.push(`urgency = $${params.length}`); }
    if (assigneeUserId !== undefined) { params.push(assigneeUserId); fields.push(`assignee_user_id = $${params.length}`); }
    if (assigneeName !== undefined) { params.push(assigneeName); fields.push(`assignee_name = $${params.length}`); }
    if (internalNote !== undefined) { params.push(internalNote); fields.push(`internal_note = $${params.length}`); }

    if (!fields.length) { res.json({ ok: true }); return; }

    fields.push(`updated_at = NOW()`);
    params.push(id);

    await pool.query(
      `UPDATE support_tickets SET ${fields.join(", ")} WHERE id = $${params.length}`,
      params
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
