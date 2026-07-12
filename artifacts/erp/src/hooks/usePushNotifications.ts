/**
 * usePushNotifications
 * Manages Web Push subscription lifecycle for the current user.
 * - Requests permission on demand
 * - Subscribes/unsubscribes via /api/push/*
 * - Detects browser & OS for device labelling
 */
import { useState, useEffect, useCallback } from "react";

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  return "Unknown";
}

function detectOS(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` });

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch("/api/push/vapid-public-key", { headers: authHeaders() });
  const data = await res.json();
  return data.publicKey as string;
}

async function callPushApi(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: body !== undefined ? "POST" : "GET",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushPermission = "default" | "granted" | "denied";

export interface UsePushNotificationsReturn {
  permission: PushPermission;
  isSubscribed: boolean;
  isLoading: boolean;
  isPushSupported: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const isPushSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  const [permission, setPermission] = useState<PushPermission>(
    isPushSupported ? (Notification.permission as PushPermission) : "denied",
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading]       = useState(false);

  // Check existing subscription on mount
  useEffect(() => {
    if (!isPushSupported) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(!!sub);
      } catch {
        /* ignore */
      }
    })();
  }, [isPushSupported]);

  const subscribe = useCallback(async () => {
    if (!isPushSupported) return;
    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== "granted") return;

      const publicKey = await getVapidPublicKey();
      const reg       = await navigator.serviceWorker.ready;
      const sub       = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };

      await callPushApi("/api/push/subscribe", {
        endpoint:   json.endpoint,
        keys:       json.keys,
        deviceName: `${detectBrowser()} sur ${detectOS()}`,
        browser:    detectBrowser(),
        os:         detectOS(),
      });

      setIsSubscribed(true);
    } catch (err) {
      console.error("Push subscribe error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isPushSupported]);

  const unsubscribe = useCallback(async () => {
    if (!isPushSupported) return;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await callPushApi("/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error("Push unsubscribe error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isPushSupported]);

  return { permission, isSubscribed, isLoading, isPushSupported, subscribe, unsubscribe };
}
