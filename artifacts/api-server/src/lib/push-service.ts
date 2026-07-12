/**
 * push-service.ts
 * Centralised Web Push sending utility.
 * Call sendPushToUser(userId, payload) from any route after an event occurs.
 */
import webPush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, notificationPreferencesTable, userNotificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

// ── VAPID setup (once at import time) ────────────────────────────────────────

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     ?? "mailto:admin@pacane.dz";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifType =
  | "sales" | "remise" | "stock_low" | "new_product" | "receivables"
  | "invoices" | "returns" | "expenses" | "customers" | "workers"
  | "absence" | "primes" | "avertissements" | "leaves" | "updates" | "security";

export type PushPayload = {
  title: string;
  body: string;
  type: NotifType;
  link?: string;
  branchName?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

// Map NotifType → preference column name
const PREF_COL_MAP: Record<NotifType, keyof typeof notificationPreferencesTable.$inferSelect> = {
  sales:          "prefSales",
  remise:         "prefRemise",
  stock_low:      "prefStockLow",
  new_product:    "prefNewProduct",
  receivables:    "prefReceivables",
  invoices:       "prefInvoices",
  returns:        "prefReturns",
  expenses:       "prefExpenses",
  customers:      "prefCustomers",
  workers:        "prefWorkers",
  absence:        "prefAbsence",
  primes:         "prefPrimes",
  avertissements: "prefAvertissements",
  leaves:         "prefLeaves",
  updates:        "prefUpdates",
  security:       "prefSecurity",
};

// ── Core sender ───────────────────────────────────────────────────────────────

export async function sendPushToUser(
  userId: number,
  payload: PushPayload,
): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    logger.warn("VAPID keys not configured — push skipped");
    return;
  }

  try {
    // 1. Check user preferences
    const [prefs] = await db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, userId))
      .limit(1);

    const prefCol = PREF_COL_MAP[payload.type];
    if (prefs) {
      if (!prefs.inAppEnabled && !prefs.pushEnabled) return;
      if (prefCol && !(prefs as any)[prefCol]) return;
    }

    // 2. Save in-app notification
    const shouldSaveInApp = !prefs || prefs.inAppEnabled;
    if (shouldSaveInApp) {
      await db.insert(userNotificationsTable).values({
        userId,
        type: payload.type,
        title: payload.title,
        message: payload.body,
        link: payload.link ?? null,
        meta: payload.data ? payload.data : null,
      });
    }

    // 3. Send push to all active subscriptions
    const shouldSendPush = !prefs || prefs.pushEnabled;
    if (!shouldSendPush) return;

    const subs = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(and(
        eq(pushSubscriptionsTable.userId, userId),
        eq(pushSubscriptionsTable.isActive, true),
      ));

    const pushData = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon ?? "/icons/icon-192.png",
      badge: payload.badge ?? "/icons/icon-96.png",
      tag: payload.tag ?? payload.type,
      data: {
        link: payload.link ?? "/",
        branchName: payload.branchName,
        type: payload.type,
        ...(payload.data ?? {}),
      },
    });

    const results = await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webPush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            pushData,
            { TTL: 60 * 60 * 24 },
          );
          // Update lastActive
          await db
            .update(pushSubscriptionsTable)
            .set({ lastActive: new Date() })
            .where(eq(pushSubscriptionsTable.id, sub.id));
        } catch (err: any) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            // Subscription expired — deactivate
            await db
              .update(pushSubscriptionsTable)
              .set({ isActive: false })
              .where(eq(pushSubscriptionsTable.id, sub.id));
            logger.info({ subId: sub.id }, "Push subscription expired — deactivated");
          } else {
            throw err;
          }
        }
      }),
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      logger.warn({ failed: failed.length, total: subs.length }, "Some push sends failed");
    }
  } catch (err) {
    logger.error({ err, userId }, "sendPushToUser error (non-fatal)");
  }
}

/**
 * Send push to multiple users at once (e.g. all managers).
 */
export async function sendPushToUsers(
  userIds: number[],
  payload: PushPayload,
): Promise<void> {
  await Promise.allSettled(userIds.map((uid) => sendPushToUser(uid, payload)));
}

export const vapidPublicKey = VAPID_PUBLIC;
