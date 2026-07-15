/**
 * usePushNotifications
 * Manages Web Push subscription lifecycle for the current user.
 * - Handles iOS standalone requirement
 * - Handles Android/Chrome permission flow
 * - Surfaces real errors instead of silently failing
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

export function isIOSDevice(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    !!(window.navigator as any).standalone === true
  );
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` });

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch("/api/push/vapid-public-key", { headers: authHeaders() });
  if (!res.ok) throw new Error("Impossible de récupérer la clé VAPID");
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

async function getServiceWorkerWithTimeout(ms = 10000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Service worker timeout — rechargez la page")), ms)
    ),
  ]);
}

export type PushPermission = "default" | "granted" | "denied";

export interface UsePushNotificationsReturn {
  permission: PushPermission;
  isSubscribed: boolean;
  isLoading: boolean;
  isPushSupported: boolean;
  isIOS: boolean;
  needsInstall: boolean;
  subscribeError: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const isIOS = typeof window !== "undefined" && isIOSDevice();
  const standalone = typeof window !== "undefined" && isStandaloneMode();

  const isPushSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  const needsInstall = isIOS && !standalone;

  const [permission, setPermission] = useState<PushPermission>(
    isPushSupported ? (Notification.permission as PushPermission) : "denied",
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported || needsInstall) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(!!sub);
      } catch {
        /* ignore */
      }
    })();
  }, [isPushSupported, needsInstall]);

  const subscribe = useCallback(async () => {
    if (!isPushSupported) return;
    if (needsInstall) {
      setSubscribeError("Sur iPhone, ajoutez d'abord l'application à l'écran d'accueil (bouton Partager → Sur l'écran d'accueil), puis ouvrez-la depuis l'icône.");
      return;
    }
    setIsLoading(true);
    setSubscribeError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);

      if (perm === "denied") {
        setSubscribeError("Vous avez refusé les notifications. Allez dans les réglages du navigateur pour les réautoriser.");
        return;
      }
      if (perm !== "granted") {
        setSubscribeError("Permission non accordée. Réessayez et cliquez sur « Autoriser ».");
        return;
      }

      const publicKey = await getVapidPublicKey();
      const reg = await getServiceWorkerWithTimeout(10000);

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };

      const res = await callPushApi("/api/push/subscribe", {
        endpoint:   json.endpoint,
        keys:       json.keys,
        deviceName: `${detectBrowser()} sur ${detectOS()}`,
        browser:    detectBrowser(),
        os:         detectOS(),
      });

      if (!res.ok) throw new Error("Erreur lors de l'enregistrement sur le serveur");

      setIsSubscribed(true);
    } catch (err: any) {
      console.error("Push subscribe error:", err);
      const msg = err?.message ?? String(err);
      if (msg.includes("timeout")) {
        setSubscribeError("Rechargez la page et réessayez (service worker non prêt).");
      } else if (msg.includes("denied") || msg.includes("permission")) {
        setSubscribeError("Notifications refusées. Autorisez-les dans les réglages de votre navigateur.");
      } else {
        setSubscribeError(`Erreur : ${msg}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isPushSupported, needsInstall]);

  const unsubscribe = useCallback(async () => {
    if (!isPushSupported) return;
    setIsLoading(true);
    setSubscribeError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await callPushApi("/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err: any) {
      console.error("Push unsubscribe error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isPushSupported]);

  return { permission, isSubscribed, isLoading, isPushSupported, isIOS, needsInstall, subscribeError, subscribe, unsubscribe };
}
