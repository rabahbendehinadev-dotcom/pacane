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
