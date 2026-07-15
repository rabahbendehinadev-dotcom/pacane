---
name: Worker Notifications & Tickets system
description: Architecture and key decisions for the admin→worker notification system and support ticket system added to Pacane ERP.
---

## Tables (created via startup migration in api-server/src/index.ts)
- `admin_worker_notifications` — notification content (title, body, type, priority, sender, expires_at, image_url, is_archived)
- `admin_notification_recipients` — per-user delivery tracking (push_sent_at, push_failed, read_at, acknowledged_at, acknowledged_ip, acknowledged_device)
- `support_tickets` — user problem reports (ticket_ref: TICKET-YYYY-NNNN, status, urgency, type, branch info denormalized)
- `ticket_replies` — threaded replies (is_internal flag hides admin notes from workers)

## Backend routes
- `artifacts/api-server/src/routes/worker-notifications.ts` — all notification endpoints
- `artifacts/api-server/src/routes/support-tickets.ts` — ticket CRUD + replies

## Frontend pages (all in artifacts/erp/src/pages/)
- `worker-notifications.tsx` — admin: create/send/monitor notifications (adminOnly)
- `my-notifications.tsx` — worker: personal notifications + urgent ack modal
- `report-problem.tsx` — worker: submit ticket, shows reference number
- `my-tickets.tsx` — worker: track tickets + reply in thread
- `admin-tickets.tsx` — admin: manage all tickets (adminOnly)
- `notification-status.tsx` — admin: push subscription status per user (adminOnly)

## Key design decisions
**Why:** Admin notifications are stored in their own tables, NOT in erp_user_notifications. This gives richer tracking (per-recipient read/ack/push status).

**Push:** Uses webPush directly (not sendPushToUser) in worker-notifications.ts to bypass preference checks — admin notifications are always delivered.

**Unread badge:** Header.tsx fetches /api/worker-notifications/unread-count (separate from existing /api/notifications/badge) and combines both counts.

**Urgent ack modal:** my-notifications.tsx fetches /api/worker-notifications/pending-acknowledgment on mount + every 30s, shows blocking modal for priority=urgent|important until acknowledged.

**Navigation:** "Communications" group added to Sidebar.tsx — admin-only items (إشعارات العمال, بلاغات المستخدمين, حالة الإشعارات) + universal items (إشعاراتي, تبليغ عن مشكلة, بلاغاتي).

**Recipient resolution:** POST /api/worker-notifications/recipient-preview resolves workers → user IDs before sending; shows warning if some users have no push subscription.
