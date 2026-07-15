/**
 * worker-notifications.ts
 * Admin → Worker notification system.
 * Admin creates/sends notifications to selected workers.
 * Workers read, acknowledge (for urgent/important) via their own endpoints.
 */
import { Router } from "express";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import webPush from "web-push";
import { logger } from "../lib/logger";

const router = Router();

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     ?? "mailto:admin@pacane.dz";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireAdmin(req: any, res: any, next: any) {
  if (!req.user?.adminAccess) { res.status(403).json({ error: "Admin uniquement" }); return; }
  next();
}

async function resolveRecipientUserIds(criteria: any): Promise<{ userId: number; workerId: number | null; workerName: string | null; userName: string }[]> {
  const { mode, workerIds, branchId, workerStatus, roleId } = criteria;

  let query = `
    SELECT u.id as user_id, u.name as user_name, u.worker_id, w.name as worker_name
    FROM users u
    LEFT JOIN workers w ON w.id = u.worker_id
    WHERE u.status = 'active'
  `;
  const params: any[] = [];

  if (mode === "all_workers") {
    query += ` AND u.worker_id IS NOT NULL`;
  } else if (mode === "all_users") {
    // all active users including those without workers
  } else if (mode === "specific") {
    // Preferred: direct user IDs — send straight to selected user accounts.
    if (criteria.userIds?.length) {
      params.push(criteria.userIds);
      query = `
        SELECT u.id as user_id, u.name as user_name, u.worker_id, w.name as worker_name
        FROM users u
        LEFT JOIN workers w ON w.id = u.worker_id
        WHERE u.status = 'active' AND u.id = ANY($${params.length}::int[])
      `;
    } else if (workerIds?.length) {
      // Legacy: worker IDs — match by linkage or name.
      params.push(workerIds);
      const p = params.length;
      query = `
        SELECT DISTINCT u.id as user_id, u.name as user_name, u.worker_id,
          (SELECT w.name FROM workers w WHERE w.id = u.worker_id) as worker_name
        FROM users u
        WHERE u.status = 'active'
          AND (
            u.worker_id = ANY($${p}::int[])
            OR EXISTS (
              SELECT 1 FROM workers w
              WHERE w.id = ANY($${p}::int[])
                AND lower(trim(w.name)) = lower(trim(u.name))
            )
          )
      `;
    } else {
      return [];
    }
  } else if (mode === "branch") {
    params.push(branchId);
    query += ` AND ($${params.length} = ANY(u.branch_ids) OR u.default_branch_id = $${params.length})`;
  } else if (mode === "worker_status") {
    const active = workerStatus === "active";
    params.push(active);
    query += ` AND u.worker_id IS NOT NULL AND w.is_active = $${params.length}`;
  } else if (mode === "role") {
    params.push(roleId);
    query += ` AND u.role_id = $${params.length}`;
  } else {
    query += ` AND u.worker_id IS NOT NULL`;
  }

  const result = await pool.query(query, params);
  return result.rows.map((r: any) => ({
    userId: r.user_id,
    workerId: r.worker_id ?? null,
    workerName: r.worker_name ?? null,
    userName: r.user_name,
  }));
}

async function sendPushDirect(userId: number, payload: { title: string; body: string; data?: any }): Promise<{ ok: boolean; reason?: string }> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { ok: false, reason: "VAPID not configured" };
  try {
    const subs = await pool.query(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND is_active = true`,
      [userId]
    );
    if (!subs.rows.length) return { ok: false, reason: "no_subscription" };

    let lastError: string | undefined;
    let anyOk = false;
    for (const sub of subs.rows) {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ ...payload, icon: "/logo.png", badge: "/logo.png" })
        );
        anyOk = true;
        await pool.query(`UPDATE push_subscriptions SET last_active = NOW() WHERE id = $1`, [sub.id]);
      } catch (err: any) {
        lastError = err?.statusCode === 404 || err?.statusCode === 410 ? "expired" : (err?.message ?? "unknown");
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await pool.query(`UPDATE push_subscriptions SET is_active = false WHERE id = $1`, [sub.id]);
        }
      }
    }
    return anyOk ? { ok: true } : { ok: false, reason: lastError };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? "unknown" };
  }
}

// ── Worker endpoints (must be before /:id) ────────────────────────────────────

// GET /api/worker-notifications/my — worker's notifications
router.get("/worker-notifications/my", requireAuth, async (req: any, res: any): Promise<void> => {
  const userId = req.user.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = (page - 1) * limit;

  try {
    const rows = await pool.query(`
      SELECT
        r.id as recipient_id,
        r.notification_id,
        r.read_at,
        r.acknowledged_at,
        r.delivered_at,
        n.title,
        n.body,
        n.type,
        n.priority,
        n.sender_name,
        n.image_url,
        n.expires_at,
        n.created_at
      FROM admin_notification_recipients r
      JOIN admin_worker_notifications n ON n.id = r.notification_id
      WHERE r.user_id = $1
        AND n.is_archived = false
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    const countResult = await pool.query(`
      SELECT COUNT(*) as total, SUM(CASE WHEN r.read_at IS NULL THEN 1 ELSE 0 END) as unread
      FROM admin_notification_recipients r
      JOIN admin_worker_notifications n ON n.id = r.notification_id
      WHERE r.user_id = $1 AND n.is_archived = false
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
    `, [userId]);

    // Mark delivered_at for notifications that haven't been delivered yet
    await pool.query(`
      UPDATE admin_notification_recipients
      SET delivered_at = NOW()
      WHERE user_id = $1 AND delivered_at IS NULL
    `, [userId]);

    res.json({
      notifications: rows.rows,
      total: parseInt(countResult.rows[0]?.total || "0"),
      unread: parseInt(countResult.rows[0]?.unread || "0"),
      page,
      limit,
    });
  } catch (err) {
    logger.error({ err }, "worker-notifications/my error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/worker-notifications/pending-acknowledgment — urgent unacknowledged
router.get("/worker-notifications/pending-acknowledgment", requireAuth, async (req: any, res: any): Promise<void> => {
  const userId = req.user.id;
  try {
    const rows = await pool.query(`
      SELECT
        r.id as recipient_id,
        r.notification_id,
        r.acknowledged_at,
        n.title,
        n.body,
        n.type,
        n.priority,
        n.sender_name,
        n.created_at
      FROM admin_notification_recipients r
      JOIN admin_worker_notifications n ON n.id = r.notification_id
      WHERE r.user_id = $1
        AND r.acknowledged_at IS NULL
        AND n.is_archived = false
        AND n.priority IN ('urgent', 'important')
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
      ORDER BY n.created_at DESC
    `, [userId]);
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/worker-notifications/unread-count — for badge
router.get("/worker-notifications/unread-count", requireAuth, async (req: any, res: any): Promise<void> => {
  const userId = req.user.id;
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM admin_notification_recipients r
      JOIN admin_worker_notifications n ON n.id = r.notification_id
      WHERE r.user_id = $1 AND r.read_at IS NULL
        AND n.is_archived = false
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
    `, [userId]);
    res.json({ count: parseInt(result.rows[0]?.count || "0") });
  } catch (err) {
    res.status(500).json({ count: 0 });
  }
});

// PATCH /api/worker-notifications/recipients/:id/read
router.patch("/worker-notifications/recipients/:id/read", requireAuth, async (req: any, res: any): Promise<void> => {
  const recipientId = parseInt(req.params.id);
  const userId = req.user.id;
  try {
    await pool.query(`
      UPDATE admin_notification_recipients
      SET read_at = COALESCE(read_at, NOW())
      WHERE id = $1 AND user_id = $2
    `, [recipientId, userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/worker-notifications/recipients/:id/acknowledge
router.post("/worker-notifications/recipients/:id/acknowledge", requireAuth, async (req: any, res: any): Promise<void> => {
  const recipientId = parseInt(req.params.id);
  const userId = req.user.id;
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ?? req.socket?.remoteAddress ?? "";
  const device = req.headers["user-agent"] ?? "";
  try {
    await pool.query(`
      UPDATE admin_notification_recipients
      SET acknowledged_at = COALESCE(acknowledged_at, NOW()),
          acknowledged_ip = COALESCE(acknowledged_ip, $3),
          acknowledged_device = COALESCE(acknowledged_device, $4),
          read_at = COALESCE(read_at, NOW())
      WHERE id = $1 AND user_id = $2
    `, [recipientId, userId, ip, device]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

// GET /api/worker-notifications/push-status — admin: push subscription status per user
router.get("/worker-notifications/push-status", requireAuth, requireAdmin, async (_req: any, res: any): Promise<void> => {
  try {
    const rows = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.phone,
        u.status,
        u.default_branch_id,
        u.worker_id,
        w.name as worker_name,
        b.name as branch_name,
        u.last_login,
        COUNT(ps.id) FILTER (WHERE ps.is_active = true) as active_subscriptions,
        COUNT(ps.id) as total_subscriptions,
        MAX(ps.last_active) as last_push_active,
        MAX(ps.browser) as browser,
        MAX(ps.os) as os,
        MAX(ps.device_name) as device_name,
        MAX(ps.created_at) as subscription_created_at
      FROM users u
      LEFT JOIN workers w ON w.id = u.worker_id
      LEFT JOIN branches b ON b.id = u.default_branch_id
      LEFT JOIN push_subscriptions ps ON ps.user_id = u.id
      GROUP BY u.id, u.name, u.phone, u.status, u.default_branch_id, u.worker_id, u.last_login, w.name, b.name
      ORDER BY u.name
    `);
    res.json(rows.rows);
  } catch (err) {
    logger.error({ err }, "push-status error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/worker-notifications/recipients — admin: ALL user accounts as potential recipients.
// Every user from the Utilisateurs page can receive a notification, whatever their role.
// Worker linkage is informational only (shows the worker name next to the account).
router.get("/worker-notifications/recipients", requireAuth, requireAdmin, async (_req: any, res: any): Promise<void> => {
  try {
    const rows = await pool.query(`
      SELECT
        u.id, u.name, u.username, u.status,
        r.name as role_name,
        w.name as worker_name
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN workers w ON w.id = u.worker_id
      ORDER BY u.name
    `);
    res.json(rows.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      username: r.username,
      roleName: r.role_name,
      workerName: r.worker_name,
      active: r.status === "active",
    })));
  } catch (err) {
    logger.error({ err }, "recipients directory error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/worker-notifications/recipient-preview — admin: preview recipients before sending
router.post("/worker-notifications/recipient-preview", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  try {
    const recipients = await resolveRecipientUserIds(req.body.criteria || {});
    const userIds = recipients.map(r => r.userId);
    
    let pushCount = 0;
    let noPushCount = 0;
    const noPushNames: string[] = [];

    for (const r of recipients) {
      const sub = await pool.query(
        `SELECT COUNT(*) as c FROM push_subscriptions WHERE user_id = $1 AND is_active = true`,
        [r.userId]
      );
      if (parseInt(sub.rows[0]?.c || "0") > 0) {
        pushCount++;
      } else {
        noPushCount++;
        noPushNames.push(r.userName);
      }
    }

    res.json({
      total: recipients.length,
      pushEnabled: pushCount,
      noPush: noPushCount,
      noPushNames,
      recipients: recipients.slice(0, 50),
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/worker-notifications — admin list
router.get("/worker-notifications", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  try {
    const rows = await pool.query(`
      SELECT
        n.*,
        COUNT(r.id) as total_recipients,
        COUNT(r.read_at) as read_count,
        COUNT(r.acknowledged_at) as ack_count,
        COUNT(r.push_failed::boolean OR NULL) as push_failed_count
      FROM admin_worker_notifications n
      LEFT JOIN admin_notification_recipients r ON r.notification_id = n.id
      WHERE n.is_archived = false
      GROUP BY n.id
      ORDER BY n.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countResult = await pool.query(`SELECT COUNT(*) FROM admin_worker_notifications WHERE is_archived = false`);

    res.json({
      notifications: rows.rows,
      total: parseInt(countResult.rows[0]?.count || "0"),
      page,
    });
  } catch (err) {
    logger.error({ err }, "GET /worker-notifications error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/worker-notifications — admin creates + sends
router.post("/worker-notifications", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  const { title, body, type, priority, expiresAt, imageUrl, criteria } = req.body;
  const senderUserId = req.user.id;
  const senderName = req.user.name;

  if (!title || !body) { res.status(400).json({ error: "Titre et contenu requis" }); return; }

  try {
    // 1. Resolve recipients
    logger.info({ criteria }, "[notif-send] resolving recipients");
    const recipients = await resolveRecipientUserIds(criteria || { mode: "all_workers" });
    logger.info(
      { count: recipients.length, recipients: recipients.map(r => ({ userId: r.userId, userName: r.userName, workerId: r.workerId })) },
      "[notif-send] recipients resolved",
    );

    if (!recipients.length) {
      // Direct user selection: name the inactive accounts explicitly.
      if (criteria?.mode === "specific" && criteria.userIds?.length) {
        const ur = await pool.query(
          `SELECT name, status FROM users WHERE id = ANY($1::int[])`,
          [criteria.userIds],
        );
        const inactive = ur.rows.filter((r: any) => r.status !== "active").map((r: any) => r.name);
        logger.warn({ userIds: criteria.userIds, inactive }, "[notif-send] no recipients — selected users inactive");
        res.status(400).json({
          error: inactive.length
            ? `Ces comptes sont inactifs : ${inactive.join(", ")}. Activez-les dans Utilisateurs pour leur envoyer des notifications.`
            : "Aucun destinataire trouvé",
        });
        return;
      }
      // Build a precise error: which selected workers have no linked account?
      if (criteria?.mode === "specific" && criteria.workerIds?.length) {
        const wr = await pool.query(
          `SELECT w.id, w.name,
             EXISTS (
               SELECT 1 FROM users u
               WHERE u.status = 'active'
                 AND (u.worker_id = w.id OR lower(trim(u.name)) = lower(trim(w.name)))
             ) as has_account
           FROM workers w WHERE w.id = ANY($1::int[])`,
          [criteria.workerIds],
        );
        const noAccount = wr.rows.filter((r: any) => !r.has_account).map((r: any) => r.name);
        logger.warn({ workerIds: criteria.workerIds, noAccount }, "[notif-send] no recipients — workers without linked account");
        if (noAccount.length) {
          res.status(400).json({
            error: `Ces employés n'ont pas de compte utilisateur actif : ${noAccount.join(", ")}. Liez chaque ouvrier à un compte via Utilisateurs → Modifier → « Lier à un ouvrier ».`,
            workersWithoutAccount: noAccount,
          });
          return;
        }
      }
      logger.warn({ criteria }, "[notif-send] no recipients found");
      res.status(400).json({ error: "Aucun destinataire trouvé" });
      return;
    }

    // 2. Insert notification
    const notifResult = await pool.query(`
      INSERT INTO admin_worker_notifications (title, body, type, priority, sender_user_id, sender_name, expires_at, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [title, body, type || "normal", priority || "normal", senderUserId, senderName, expiresAt || null, imageUrl || null]);
    const notifId = notifResult.rows[0].id;

    // 3. Insert recipients
    for (const r of recipients) {
      await pool.query(`
        INSERT INTO admin_notification_recipients (notification_id, user_id, worker_id, worker_name, user_name)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (notification_id, user_id) DO NOTHING
      `, [notifId, r.userId, r.workerId, r.workerName, r.userName]);
    }

    // 4. Send push to each recipient (async, non-blocking)
    const pushResults = await Promise.allSettled(
      recipients.map(async (r) => {
        const result = await sendPushDirect(r.userId, {
          title,
          body,
          data: { type, priority, notifId, url: "/my-notifications" },
        });
        const now = new Date();
        if (result.ok) {
          await pool.query(`
            UPDATE admin_notification_recipients
            SET push_sent_at = $1, push_failed = false
            WHERE notification_id = $2 AND user_id = $3
          `, [now, notifId, r.userId]);
        } else {
          await pool.query(`
            UPDATE admin_notification_recipients
            SET push_failed = true, push_failure_reason = $1
            WHERE notification_id = $2 AND user_id = $3
          `, [result.reason ?? "unknown", notifId, r.userId]);
        }
        return result;
      })
    );

    const pushOk = pushResults.filter(r => r.status === "fulfilled" && (r as any).value?.ok).length;
    const pushFailed = pushResults.length - pushOk;

    res.json({
      ok: true,
      notificationId: notifId,
      totalRecipients: recipients.length,
      pushOk,
      pushFailed,
    });
  } catch (err) {
    logger.error({ err }, "POST /worker-notifications error");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/worker-notifications/:id — admin detail
router.get("/worker-notifications/:id", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  const id = parseInt(req.params.id);
  try {
    const notifResult = await pool.query(
      `SELECT n.*,
        COUNT(r.id) as total_recipients,
        COUNT(r.read_at) as read_count,
        COUNT(CASE WHEN r.read_at IS NULL THEN 1 END) as unread_count,
        COUNT(r.acknowledged_at) as ack_count,
        COUNT(CASE WHEN r.push_failed = true THEN 1 END) as push_failed_count
       FROM admin_worker_notifications n
       LEFT JOIN admin_notification_recipients r ON r.notification_id = n.id
       WHERE n.id = $1
       GROUP BY n.id`,
      [id]
    );
    if (!notifResult.rows.length) { res.status(404).json({ error: "Introuvable" }); return; }

    const recipientsResult = await pool.query(
      `SELECT * FROM admin_notification_recipients WHERE notification_id = $1 ORDER BY user_name`,
      [id]
    );

    res.json({
      notification: notifResult.rows[0],
      recipients: recipientsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /api/worker-notifications/:id — admin edit (before anyone reads it)
router.patch("/worker-notifications/:id", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  const id = parseInt(req.params.id);
  const { title, body, type, priority, expiresAt, imageUrl } = req.body;
  try {
    await pool.query(`
      UPDATE admin_worker_notifications
      SET title = COALESCE($1, title),
          body = COALESCE($2, body),
          type = COALESCE($3, type),
          priority = COALESCE($4, priority),
          expires_at = COALESCE($5, expires_at),
          image_url = COALESCE($6, image_url),
          updated_at = NOW()
      WHERE id = $7
    `, [title, body, type, priority, expiresAt, imageUrl, id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/worker-notifications/:id — admin archive
router.delete("/worker-notifications/:id", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  const id = parseInt(req.params.id);
  try {
    await pool.query(`UPDATE admin_worker_notifications SET is_archived = true WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/worker-notifications/:id/resend — resend push to failed recipients
router.post("/worker-notifications/:id/resend", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  const id = parseInt(req.params.id);
  try {
    const notifResult = await pool.query(`SELECT * FROM admin_worker_notifications WHERE id = $1`, [id]);
    if (!notifResult.rows.length) { res.status(404).json({ error: "Introuvable" }); return; }
    const notif = notifResult.rows[0];

    const failedResult = await pool.query(`
      SELECT * FROM admin_notification_recipients
      WHERE notification_id = $1 AND (push_failed = true OR push_sent_at IS NULL)
    `, [id]);

    let resent = 0;
    for (const r of failedResult.rows) {
      const result = await sendPushDirect(r.user_id, {
        title: notif.title,
        body: notif.body,
        data: { type: notif.type, priority: notif.priority, notifId: id },
      });
      if (result.ok) {
        await pool.query(`
          UPDATE admin_notification_recipients
          SET push_sent_at = NOW(), push_failed = false, push_failure_reason = NULL
          WHERE id = $1
        `, [r.id]);
        resent++;
      }
    }

    res.json({ ok: true, resent, total: failedResult.rows.length });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
