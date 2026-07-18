import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import QRCode from "qrcode";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type KioskStatus =
  | "loading"
  | "need_password"
  | "authenticating"
  | "active"
  | "bound_other"
  | "disabled"
  | "not_found"
  | "error";

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
  const [deviceName, setDeviceName] = useState("");

  // Password form
  const [password, setPassword] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // QR
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [timeLeft, setTimeLeft] = useState(10);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Clock & network
  const [now, setNow] = useState(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const qrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const QR_DURATION = 10;

  function startCountdown() {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(QR_DURATION);
    let count = QR_DURATION;
    timerRef.current = setInterval(() => {
      count -= 1;
      setTimeLeft(count);
      if (count <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 1000);
  }

  async function fetchQR() {
    try {
      const r = await fetch(`${BASE}/api/kiosk/${encodeURIComponent(slug)}/qr`, { credentials: "include" });
      if (r.status === 401) { setStatus("need_password"); return; }
      if (r.status === 403) { setStatus("disabled"); setErrorMsg("Appareil désactivé"); return; }
      if (!r.ok) { setErrorMsg("Erreur serveur"); return; }
      const data = await r.json();
      if (data.branchName) setBranchName(data.branchName);
      const url = await QRCode.toDataURL(data.qrData, {
        width: 480, margin: 2,
        color: { dark: "#111827", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(url);
      setLastUpdated(new Date());
      startCountdown();
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
      } else if (data.status === "need_password") {
        setBranchName(data.branchName ?? "");
        setDeviceName(data.deviceName ?? "");
        setStatus("need_password");
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

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) { setPwdError("Entrez le mot de passe"); return; }
    setPwdError("");
    setStatus("authenticating");

    const { os, browser } = detectDeviceInfo();

    try {
      const r = await fetch(`${BASE}/api/kiosk/${encodeURIComponent(slug)}/auth`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, deviceOs: os, deviceBrowser: browser }),
      });
      const data = await r.json();

      if (r.ok && data.success) {
        setBranchName(data.branchName ?? branchName);
        setStatus("active");
        setPassword("");
        fetchQR();
        if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
        qrIntervalRef.current = setInterval(fetchQR, 10_000);
      } else if (r.status === 401 && data.code === "WRONG_PASSWORD") {
        setStatus("need_password");
        setPwdError("Mot de passe incorrect. Réessayez.");
      } else if (r.status === 403 && data.code === "ALREADY_BOUND") {
        setStatus("bound_other");
        setErrorMsg(data.error ?? "Kiosk lié à un autre appareil");
      } else if (r.status === 403 && data.code === "DISABLED") {
        setStatus("disabled");
        setErrorMsg("Appareil désactivé par l'administrateur");
      } else {
        setStatus("need_password");
        setPwdError(data.error ?? "Erreur d'authentification");
      }
    } catch {
      setStatus("need_password");
      setPwdError("Erreur réseau — vérifiez la connexion");
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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === "loading" || status === "authenticating") {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">
            {status === "authenticating" ? "Vérification en cours..." : "Chargement..."}
          </p>
        </div>
      </div>
    );
  }

  // ── Password page ──────────────────────────────────────────────────────────
  if (status === "need_password") {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          {/* Logo */}
          <div className="text-center space-y-3">
            <img
              src={`${BASE}/logo.png`}
              alt="Pacane"
              className="h-12 object-contain brightness-200 mx-auto"
            />
            {branchName && (
              <div>
                <p className="text-xl font-bold">{branchName}</p>
                {deviceName && (
                  <p className="text-sm text-gray-400">{deviceName}</p>
                )}
              </div>
            )}
            <p className="text-gray-400 text-sm">Kiosk de pointage employés</p>
          </div>

          {/* Card */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl space-y-6">
            <div className="text-center space-y-1">
              <div className="w-14 h-14 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold">Accès sécurisé</h2>
              <p className="text-gray-400 text-sm">Entrez le mot de passe administrateur pour activer ce kiosk</p>
            </div>

            <form onSubmit={submitPassword} className="space-y-4">
              <div className="space-y-2">
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setPwdError(""); }}
                    placeholder="Mot de passe du kiosk"
                    autoFocus
                    autoComplete="current-password"
                    className={`w-full bg-gray-800 border rounded-xl px-4 py-3.5 text-white placeholder-gray-500 text-sm pr-12 focus:outline-none focus:ring-2 transition-all ${
                      pwdError
                        ? "border-red-500 focus:ring-red-500/30"
                        : "border-gray-700 focus:ring-white/20 focus:border-gray-600"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
                {pwdError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    {pwdError}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!password.trim()}
                className="w-full py-3.5 bg-white text-gray-900 font-semibold rounded-xl hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm"
              >
                Accéder au kiosk
              </button>
            </form>
          </div>

          <p className="text-center text-gray-600 text-xs">
            Pacane ERP · Kiosk <span className="text-gray-500 font-mono">{slug}</span>
          </p>
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
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
          <p className="text-gray-500 text-xs mt-3">
            Ce kiosk est déjà activé sur un autre appareil.<br />
            Seul l'administrateur peut effectuer un Reset ou changer le mot de passe.
          </p>
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
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${isOnline ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            {isOnline ? "En ligne" : "Hors ligne"}
          </div>
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
