import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getStoredToken() { return localStorage.getItem("kiosk_device_token") ?? ""; }
function getStoredBranch() { return localStorage.getItem("kiosk_branch_id") ?? ""; }

export default function PointageKiosk() {
  const [deviceToken, setDeviceToken] = useState(getStoredToken);
  const [branchId, setBranchId] = useState(getStoredBranch);
  const [setupMode, setSetupMode] = useState(!getStoredToken() || !getStoredBranch());
  const [setupInput, setSetupInput] = useState({ token: "", branchId: "" });

  const [qrDataUrl, setQrDataUrl] = useState("");
  const [timeLeft, setTimeLeft] = useState(10);
  const [error, setError] = useState("");
  const [branchName, setBranchName] = useState("");
  const [now, setNow] = useState(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const QR_DURATION = 10;

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
    if (!deviceToken || !branchId) return;
    try {
      const r = await fetch(`${API_BASE}/api/attendance/qr-token/${branchId}`, {
        headers: { "X-Device-Token": deviceToken },
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setError(e.error ?? "Erreur de connexion au serveur");
        return;
      }
      const data = await r.json();
      setError("");
      if (data.qrData) {
        const url = await QRCode.toDataURL(data.qrData, { width: 400, margin: 2, color: { dark: "#1a1a1a", light: "#ffffff" } });
        setQrDataUrl(url);
      }
      if (data.branchName) setBranchName(data.branchName);
      startCountdown();
    } catch {
      setError("Impossible de contacter le serveur");
    }
  }

  useEffect(() => {
    if (setupMode || !deviceToken || !branchId) return;
    fetchQR();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchQR, QR_DURATION * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [setupMode, deviceToken, branchId]);

  function activate() {
    if (!setupInput.token || !setupInput.branchId) return;
    localStorage.setItem("kiosk_device_token", setupInput.token);
    localStorage.setItem("kiosk_branch_id", setupInput.branchId);
    setDeviceToken(setupInput.token);
    setBranchId(setupInput.branchId);
    setSetupMode(false);
  }

  function reset() {
    localStorage.removeItem("kiosk_device_token");
    localStorage.removeItem("kiosk_branch_id");
    setDeviceToken("");
    setBranchId("");
    setQrDataUrl("");
    setSetupMode(true);
    setSetupInput({ token: "", branchId: "" });
  }

  const dayNames = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  const monthNames = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  if (setupMode) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md space-y-6">
          <div className="text-center">
            <img src="/logo.png" alt="Pacane" className="h-12 mx-auto mb-3 object-contain" />
            <h1 className="text-xl font-bold">Configuration du Kiosk</h1>
            <p className="text-sm text-gray-500 mt-1">Entrez les informations fournies par l'administrateur</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Token de l'appareil *</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="Coller le token ici..."
                value={setupInput.token}
                onChange={e => setSetupInput(s => ({ ...s, token: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ID de la boutique *</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="Ex: 1, 2, 3..."
                value={setupInput.branchId}
                onChange={e => setSetupInput(s => ({ ...s, branchId: e.target.value }))}
              />
            </div>
            <button
              onClick={activate}
              disabled={!setupInput.token || !setupInput.branchId}
              className="w-full bg-black text-white py-2.5 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Activer le Kiosk
            </button>
          </div>
        </div>
      </div>
    );
  }

  const progress = (timeLeft / 10) * 100;
  const strokeColor = timeLeft > 4 ? "#22c55e" : timeLeft > 2 ? "#f97316" : "#ef4444";

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-between p-8 select-none">
      {/* Header */}
      <div className="w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Pacane" className="h-8 object-contain brightness-200" />
          <div>
            <p className="text-lg font-bold">{branchName || "Boutique"}</p>
            <p className="text-xs text-gray-400 uppercase tracking-widest">Pointage Employés</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono font-bold tabular-nums">
            {now.toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
          <p className="text-sm text-gray-400 capitalize">
            {dayNames[now.getDay()]} {now.getDate()} {monthNames[now.getMonth()]} {now.getFullYear()}
          </p>
        </div>
      </div>

      {/* QR Section */}
      <div className="flex flex-col items-center gap-6">
        {error ? (
          <div className="text-center space-y-3">
            <div className="w-72 h-72 rounded-2xl bg-red-900/20 border border-red-700 flex items-center justify-center">
              <div>
                <p className="text-red-400 font-medium">{error}</p>
                <p className="text-red-500 text-sm mt-1">Reconnexion...</p>
              </div>
            </div>
          </div>
        ) : qrDataUrl ? (
          <div className="relative">
            {/* SVG countdown ring */}
            <div className="relative w-80 h-80">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 320 320">
                <circle cx="160" cy="160" r="155" fill="none" stroke="#374151" strokeWidth="4" />
                <circle
                  cx="160" cy="160" r="155" fill="none"
                  stroke={strokeColor} strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 155}`}
                  strokeDashoffset={`${2 * Math.PI * 155 * (1 - progress / 100)}`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.25s linear, stroke 0.3s ease" }}
                />
              </svg>
              <div className="absolute inset-3 bg-white rounded-full flex items-center justify-center shadow-lg">
                <img src={qrDataUrl} alt="QR Code" className="w-[90%] h-[90%] object-contain rounded-lg" />
              </div>
            </div>
            {/* Countdown */}
            <div className="text-center mt-2">
              <span className="text-4xl font-mono font-bold tabular-nums" style={{ color: strokeColor }}>
                {String(timeLeft).padStart(2, "0")}
              </span>
              <span className="text-gray-400 text-sm ml-1">s</span>
            </div>
          </div>
        ) : (
          <div className="w-80 h-80 rounded-full border-4 border-gray-700 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <div className="text-center space-y-1">
          <p className="text-xl font-semibold">Scannez pour pointer</p>
          <p className="text-gray-400 text-sm">Ouvrez l'application Pacane sur votre téléphone → Pointage</p>
          <p className="text-gray-500 text-xs mt-2">Code QR sécurisé · Se renouvelle automatiquement toutes les 10 secondes</p>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full flex justify-between items-end">
        <p className="text-xs text-gray-600">Pacane ERP · Kiosk v1.0</p>
        <button onClick={reset} className="text-xs text-gray-700 hover:text-gray-500 transition-colors">
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
