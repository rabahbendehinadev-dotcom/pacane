---
name: PWA + Push notification architecture
description: Full PWA + Web Push system built across 5 phases; VAPID keys, DB tables, service, hooks, settings UI, and triggers.
---

# PWA + Push Notifications Architecture

## Phase 1 — PWA Foundation
- `vite-plugin-pwa@^0.21.1` + `workbox-window` in erp/package.json
- `VitePWA()` plugin in `artifacts/erp/vite.config.ts` — `registerType: "prompt"`, devOptions.enabled: false
- Icons: `artifacts/erp/public/icons/icon-{72..512}.png` (ImageMagick from logo.png)
- iOS splash: `artifacts/erp/public/icons/splash-{size}.png`
- Components: `PWAInstallPrompt.tsx`, `PWAUpdateBanner.tsx` (both in `src/components/`)
- Type decls: `artifacts/erp/src/vite-pwa.d.ts`

## Phase 2 — Push Infrastructure
- DB tables: `push_subscriptions`, `notification_preferences` (in `lib/db/src/schema/notifications.ts`)
- Migrations in `artifacts/api-server/src/index.ts` startup block (CREATE TABLE IF NOT EXISTS)
- VAPID env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (set as shared env vars)
- Central sender: `artifacts/api-server/src/lib/push-service.ts` — `sendPushToUser(userId, payload)` saves in-app notification AND sends push in one call, respects user preferences
- Routes: `/push/vapid-public-key`, `/push/subscribe`, `/push/unsubscribe`, `/push/devices` (push.ts)
- Routes: `/notification-settings` GET/PUT (notification-settings.ts)
- Frontend hook: `artifacts/erp/src/hooks/usePushNotifications.ts`

## Phase 3 — Enhanced NotificationsDrawer
- Added `link` column to `erp_user_notifications` table (ALTER TABLE in startup migration)
- Added DELETE endpoints: `DELETE /notifications/user/:id`, `DELETE /notifications/user/all`
- UserNotifCard has delete button (hover to show), type-based icons (16 types), link navigation using `notif.link` with `notif.meta?.link` fallback

## Phase 4 — Settings Tabs
- Added "Notifs" and "Appareils" tabs to `artifacts/erp/src/pages/settings.tsx` (now 8 tabs, grid-cols-8)
- `NotificationPrefsTab.tsx` — channel toggles + 16 type toggles with save
- `DevicesTab.tsx` — list active/inactive push devices, subscribe/revoke current device

## Phase 5 — Push Triggers
- checklist.ts task assignment → `sendPushToUser()` (type: "updates")
- notifications.ts daily analytics → `sendPushToUser()` (type: "sales")
- sales.ts discounted sale → fire-and-forget `sendPushToUsers()` to all active users (type: "remise")

**Why:** Using `sendPushToUser()` instead of raw `db.insert(userNotificationsTable)` ensures both in-app and push are created atomically from one call, and user preferences are respected automatically.

**How to apply:** For any new event that should notify users, call `sendPushToUser(userId, { title, body, type, link? })`. Use dynamic `await import("../lib/push-service")` to avoid circular dep issues.

## Phase 6 — Forced activation gate (July 2026)
- `PushActivationGate.tsx` (components/notifications) — blocking modal on login until push is enabled; mounted in DashboardLayout.
- iOS: Web Push only works in installed PWA (standalone, iOS 16.4+); gate shows install-to-home-screen steps there. Detection: `matchMedia("(display-mode: standalone)")` + `navigator.standalone`.
- **Lesson — never hard-lock a forced gate:** always render an escape hatch ("continuer sans notifications", sessionStorage flag) whenever activation is impossible (iOS non-installed, permission denied) OR a subscribe attempt errored. Otherwise users get stuck in an error→retry loop.
- **Lesson — dev has no service worker:** VitePWA `devOptions.enabled: false` means no SW in dev, so any push subscribe hangs/times out. The gate is bypassed with `!import.meta.env.DEV`; push can only be tested on the deployed app.
- `serviceWorker.ready` never rejects — always wrap in a Promise.race timeout.
