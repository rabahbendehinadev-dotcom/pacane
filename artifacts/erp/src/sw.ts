/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { clientsClaim } from "workbox-core";

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//, /^\/uploads\//],
  }),
);

registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({ cacheName: "google-fonts-stylesheets" }),
);
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({ cacheName: "google-fonts-webfonts" }),
);

// ── Push notifications ────────────────────────────────────────────────────────

/** Resolve a possibly root-relative URL against the SW registration scope (base path aware). */
function resolveInScope(url: string): string {
  return new URL(url.replace(/^\//, ""), self.registration.scope).href;
}

self.addEventListener("push", (event: PushEvent) => {
  let payload: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: { link?: string; [k: string]: unknown };
  } = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Pacane ERP", body: event.data?.text() ?? "" };
  }

  const title = payload.title || "Pacane ERP";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: resolveInScope(payload.icon || "/icons/icon-192.png"),
    badge: resolveInScope(payload.badge || "/icons/icon-96.png"),
    tag: payload.tag,
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const link = (event.notification.data?.link as string) || "/";
  const url = resolveInScope(link);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) (client as WindowClient).navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
