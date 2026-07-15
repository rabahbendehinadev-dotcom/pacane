import { Router } from "express";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { vapidPublicKey } from "../lib/push-service";

const router = Router();

// ── GET /push/vapid-public-key ────────────────────────────────────────────────
router.get("/push/vapid-public-key", (_req, res) => {
  if (!vapidPublicKey) {
    return res.status(503).json({ error: "Push notifications not configured" });
  }
  res.json({ publicKey: vapidPublicKey });
});

// ── GET /push/env-check (public — diagnostic only) ────────────────────────────
// Returns boolean flags so you can verify env vars reach the running process.
// Check this URL directly in a browser: /api/push/env-check
router.get("/push/env-check", (_req, res) => {
  const pub  = process.env["VAPID_PUBLIC_KEY"]  ?? "";
  const priv = process.env["VAPID_PRIVATE_KEY"] ?? "";
  const subj = process.env["VAPID_SUBJECT"]     ?? "";
  res.json({
    VAPID_PUBLIC_KEY_SET:    !!pub,
    VAPID_PRIVATE_KEY_SET:   !!priv,
    VAPID_SUBJECT_SET:       !!subj,
    vapidPublicKey_in_module: !!vapidPublicKey,
    VAPID_PUBLIC_KEY_prefix:  pub  ? pub.slice(0, 8)  + "…" : null,
    VAPID_SUBJECT_value:      subj || null,
    node_env: process.env["NODE_ENV"] ?? null,
  });
});

// ── POST /push/subscribe ──────────────────────────────────────────────────────
router.post("/push/subscribe", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const { endpoint, keys, deviceName, browser, os } = req.body as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    deviceName?: string;
    browser?: string;
    os?: string;
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "endpoint, keys.p256dh and keys.auth are required" });
  }

  try {
    // Upsert: if endpoint already exists update it, else insert
    const existing = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(pushSubscriptionsTable)
        .set({ userId, p256dh: keys.p256dh, auth: keys.auth, deviceName, browser, os, isActive: true, lastActive: new Date() })
        .where(eq(pushSubscriptionsTable.id, existing[0].id));
      return res.json({ ok: true, id: existing[0].id });
    }

    const [inserted] = await db
      .insert(pushSubscriptionsTable)
      .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceName, browser, os })
      .returning({ id: pushSubscriptionsTable.id });

    res.status(201).json({ ok: true, id: inserted.id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

// ── DELETE /push/subscribe/:id ────────────────────────────────────────────────
router.delete("/push/subscribe/:id", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  await db
    .update(pushSubscriptionsTable)
    .set({ isActive: false })
    .where(and(eq(pushSubscriptionsTable.id, id), eq(pushSubscriptionsTable.userId, userId)));

  res.json({ ok: true });
});

// ── DELETE /push/subscribe/by-endpoint ───────────────────────────────────────
router.post("/push/unsubscribe", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;
  const { endpoint } = req.body as { endpoint: string };

  if (!endpoint) return res.status(400).json({ error: "endpoint required" });

  await db
    .update(pushSubscriptionsTable)
    .set({ isActive: false })
    .where(and(eq(pushSubscriptionsTable.endpoint, endpoint), eq(pushSubscriptionsTable.userId, userId)));

  res.json({ ok: true });
});

// ── POST /push/test ───────────────────────────────────────────────────────────
// Sends a REAL push notification to all active subscriptions of the current
// user, bypassing preferences. Returns per-device results so the client can
// display the true delivery status.
router.post("/push/test", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;

  const { sendRawPushToUser } = await import("../lib/push-service");
  const result = await sendRawPushToUser(userId, {
    title: "Test de notification ✓",
    body: "Si vous voyez ceci, les notifications push fonctionnent sur cet appareil.",
    tag: "push-test",
    data: { link: "/settings" },
  });

  if (!result.configured) {
    return res.status(503).json({ error: "Clés VAPID non configurées sur le serveur", sent: 0 });
  }
  if (result.total === 0) {
    return res.json({ sent: 0, total: 0, detail: "Aucun abonnement push actif pour ce compte. Activez d'abord les notifications." });
  }
  res.json({ sent: result.sent, total: result.total, failures: result.failures });
});

// ── GET /push/devices ─────────────────────────────────────────────────────────
router.get("/push/devices", requireAuth, async (req, res) => {
  const userId = (req as any).user.id as number;

  const devices = await db
    .select({
      id: pushSubscriptionsTable.id,
      deviceName: pushSubscriptionsTable.deviceName,
      browser: pushSubscriptionsTable.browser,
      os: pushSubscriptionsTable.os,
      isActive: pushSubscriptionsTable.isActive,
      lastActive: pushSubscriptionsTable.lastActive,
      createdAt: pushSubscriptionsTable.createdAt,
    })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId))
    .orderBy(pushSubscriptionsTable.lastActive);

  res.json(devices);
});

export default router;
