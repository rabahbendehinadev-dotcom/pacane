import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import QRCode from "qrcode";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type KioskStatus = "loading" | "unactivated" | "activating" | "active" | "bound_other" | "disabled" | "not_found" | "error";

function detectDeviceInfo() {
  const ua = navigator.userAgent;
  let os = "Unknown";
  let browser = "Unknown";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad/i.test(ua)) os = "iOS";
  if (/Chrome/i.test(ua) && !/Chromium|Edg/i.test(ua)) browser = "Chrome";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else if (/Edg/i.test(ua)) browser = "Edge";
  return { os, browser };
}

export default function KioskSlugPage() {
  const params = useParams<{ slug: string }>();
  const slug = (params.slug ?? "").toUpperCase();

  const [status, setStatus] = useState<KioskStatus>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [branchName, setBranchName] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState(10);
  const [now, setNow] = useState(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const qrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Countdown ring
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (expiresAt) {
        const r = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
        setTimeLeft(r);
      }
    }, 250);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [expiresAt]);

  async function fetchQR() {
    try {
      const r = await fetch(`${BASE}/api/kiosk/${encodeURIComponent(slug)}/qr`, { credentials: "include" });
      if (r.status === 401) { setStatus("bound_other"); setErrorMsg("Appareil non autorisé"); return; }
      if (r.status === 403) { setStatus("disabled"); setErrorMsg("Appareil désactivé"); return; }
      if (!r.ok) { setErrorMsg("Erreur serveur"); return; }
      const data = await r.json();
      if (data.branchName) setBranchName(data.branchName);
      setExpiresAt(new Date(data.expiresAt));
      const url = await QRCode.toDataURL(data.qrData, {
        width: 480, margin: 2,
        color: { dark: "#111827", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(url);
      setLastUpdated(new Date());
    } catch {
      setErrorMsg("Connexion perdue");
    }
  }

  async function checkStatus() {
    try {
      const r = await fetch(`${BASE}/api/kiosk/${encodeURIComponent(slug)}/status`, { credentials: "include" });
      const data = await r.json();
      if (data.status === "active") {
        setBranchName(data.branchName ?? "");
        setStatus("active");
        fetchQR();
        if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
        qrIntervalRef.current = setInterval(fetchQR, 10_000);
      } else if (data.status === "unactivated") {
        setBranchName(data.branchName ?? "");
        setStatus("activating");
        await activateDevice();
      } else if (data.status === "bound_other") {
        setStatus("bound_other");
        setErrorMsg(data.error ?? "Kiosk lié à un autre appareil");
      } else if (data.status === "disabled") {
        setStatus("disabled");
        setErrorMsg(data.error ?? "Appareil désactivé");
      } else if (data.status === "not_found") {
        setStatus("not_found");
        setErrorMsg("Kiosk introuvable");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Impossible de contacter le serveur");
    }
  }

  async function activateDevice() {
    const { os, browser } = detectDeviceInfo();
    try {
      const r = await fetch(`${BASE}/api/kiosk/${encodeURIComponent(slug)}/activate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceOs: os, deviceBrowser: browser }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setBranchName(data.branchName ?? branchName);
        setStatus("active");
        fetchQR();
        if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
        qrIntervalRef.current = setInterval(fetchQR, 10_000);
      } else if (r.status === 403 && data.code === "ALREADY_BOUND") {
        setStatus("bound_other");
        setErrorMsg(data.error ?? "Kiosk lié à un autre appareil");
      } else {
        setStatus("error");
        setErrorMsg(data.error ?? "Erreur d'activation");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Erreur réseau lors de l'activation");
    }
  }

  useEffect(() => {
    if (!slug) { setStatus("not_found"); setErrorMsg("Slug manquant"); return; }
    checkStatus();
    return () => { if (qrIntervalRef.current) clearInterval(qrIntervalRef.current); };
  }, [slug]);

  const dayNames = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  const monthNames = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  const progress = (timeLeft / 10) * 100;
  const ringColor = timeLeft > 4 ? "#22c55e" : timeLeft > 2 ? "#f97316" : "#ef4444";
  const circumference = 2 * Math.PI * 155;

  // ── Error / loading states ─────────────────────────────────────────────────
  if (status === "loading" || status === "activating") {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">
            {status === "activating" ? "Activation du kiosk en cours..." : "Chargement..."}
          </p>
        </div>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
        <div className="text-center space-y-3 max-w-sm">
          <div className="text-6xl">🔍</div>
          <h1 className="text-2xl font-bold">Kiosk introuvable</h1>
          <p className="text-gray-400 text-sm">Le kiosk <code className="text-yellow-400">/{slug}</code> n'existe pas.</p>
          <p className="text-gray-500 text-xs">Vérifiez l'URL ou contactez l'administrateur.</p>
        </div>
      </div>
    );
  }

  if (status === "disabled") {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
        <div className="text-center space-y-3 max-w-sm">
          <div className="text-6xl">🔒</div>
          <h1 className="text-2xl font-bold">Appareil désactivé</h1>
          <p className="text-gray-400 text-sm">{errorMsg}</p>
          <p className="text-gray-500 text-xs mt-4">Contactez l'administrateur pour réactiver cet appareil.</p>
        </div>
      </div>
    );
  }

  if (status === "bound_other") {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
        <div className="text-center space-y-3 max-w-sm">
          <div className="text-6xl">⛔</div>
          <h1 className="text-xl font-bold">Appareil non autorisé</h1>
          <p className="text-gray-400 text-sm">{errorMsg}</p>
          <p className="text-gray-500 text-xs mt-3">Ce kiosk est déjà activé sur un autre appareil.<br />Seul l'administrateur peut effectuer un Reset Device.</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-6xl">⚠️</div>
          <h1 className="text-xl font-bold">Erreur de connexion</h1>
          <p className="text-gray-400 text-sm">{errorMsg}</p>
          <button
            onClick={() => { setStatus("loading"); setErrorMsg(""); checkStatus(); }}
            className="mt-4 px-6 py-2 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-colors"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  // ── ACTIVE — Main kiosk view ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-between p-8 select-none overflow-hidden">
      {/* Header */}
      <div className="w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={`${BASE}/logo.png`} alt="Pacane" className="h-9 object-contain brightness-200" />
          <div>
            <p className="text-xl font-bold leading-tight">{branchName || "Boutique"}</p>
            <p className="text-xs text-gray-400 uppercase tracking-widest">Pointage Employés</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Online/Offline badge */}
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${isOnline ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            {isOnline ? "En ligne" : "Hors ligne"}
          </div>
          {/* Clock */}
          <div className="text-right">
            <p className="text-3xl font-mono font-bold tabular-nums">
              {now.toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
            <p className="text-xs text-gray-400 capitalize">
              {dayNames[now.getDay()]} {now.getDate()} {monthNames[now.getMonth()]} {now.getFullYear()}
            </p>
          </div>
        </div>
      </div>

      {/* QR Section */}
      <div className="flex flex-col items-center gap-6">
        {qrDataUrl ? (
          <>
            {/* Animated ring around QR */}
            <div className="relative w-96 h-96">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 320 320">
                <circle cx="160" cy="160" r="155" fill="none" stroke="#1f2937" strokeWidth="6" />
                <circle
                  cx="160" cy="160" r="155" fill="none"
                  stroke={ringColor} strokeWidth="6"
                  strokeDasharray={`${circumference}`}
                  strokeDashoffset={`${circumference * (1 - progress / 100)}`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.25s linear, stroke 0.3s ease" }}
                />
              </svg>
              <div className="absolute inset-3 bg-white rounded-full flex items-center justify-center shadow-2xl">
                <img src={qrDataUrl} alt="QR Code" className="w-[88%] h-[88%] object-contain rounded-xl" />
              </div>
            </div>

            {/* Countdown number */}
            <div className="flex items-center gap-2">
              <span className="text-5xl font-mono font-bold tabular-nums" style={{ color: ringColor }}>
                {String(timeLeft).padStart(2, "0")}
              </span>
              <div className="text-left">
                <p className="text-gray-400 text-xs">secondes</p>
                <p className="text-gray-500 text-xs">avant renouvellement</p>
              </div>
            </div>
          </>
        ) : (
          <div className="w-96 h-96 rounded-full border-4 border-gray-800 flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <div className="text-center space-y-1.5">
          <p className="text-2xl font-semibold">Scannez pour pointer</p>
          <p className="text-gray-400 text-sm">Ouvrez l'app Pacane sur votre téléphone → Pointage</p>
          <p className="text-gray-600 text-xs">Code QR sécurisé · Usage unique · Renouvellement automatique</p>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full flex items-end justify-between">
        <div className="text-xs text-gray-700 space-y-0.5">
          <p>Pacane ERP · Kiosk <span className="text-gray-600">{slug}</span></p>
          {lastUpdated && <p>Dernière mise à jour : {lastUpdated.toLocaleTimeString("fr-DZ")}</p>}
        </div>
      </div>
    </div>
  );
}
