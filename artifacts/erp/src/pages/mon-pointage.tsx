import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import jsQR from "jsqr";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = (path: string, opts?: RequestInit) =>
  fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}`, ...(opts?.headers ?? {}) },
  });

function fmtTime(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("fr-DZ", { weekday: "short", day: "2-digit", month: "short" });
}

type ScanState = "idle" | "scanning" | "processing" | "success" | "error";

export default function MonPointagePage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanMsg, setScanMsg] = useState("");
  const [scanType, setScanType] = useState<"IN" | "OUT" | null>(null);
  const [cameraError, setCameraError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["my-records"],
    queryFn: async () => {
      const r = await API("/attendance/my-records");
      if (!r.ok) throw new Error();
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const settings = data?.settings ?? null;
  const records: any[] = data?.records ?? [];

  // Today's records
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Algiers" });
  const todayRecords = records.filter(r => {
    const d = new Date(r.timestamp).toLocaleDateString("en-CA", { timeZone: "Africa/Algiers" });
    return d === todayStr;
  });

  const lastIn = todayRecords.filter(r => r.type === "IN").at(-1);
  const lastOut = todayRecords.filter(r => r.type === "OUT").at(-1);
  const isPresent = lastIn && (!lastOut || new Date(lastIn.timestamp) > new Date(lastOut.timestamp));

  // Stop camera stream
  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  }, []);

  // Process QR data found
  async function handleQrFound(qrData: string) {
    stopCamera();
    setScanState("processing");
    try {
      const r = await API("/attendance/scan", { method: "POST", body: JSON.stringify({ qrData }) });
      const d = await r.json();
      if (r.ok) {
        setScanType(d.type ?? null);
        setScanMsg(d.type === "IN" ? "Entrée enregistrée ✓" : "Sortie enregistrée ✓");
        setScanState("success");
        qc.invalidateQueries({ queryKey: ["my-records"] });
        setTimeout(() => setScanState("idle"), 4000);
      } else {
        setScanMsg(d.error ?? "Erreur lors du pointage");
        setScanState("error");
        setTimeout(() => setScanState("idle"), 4000);
      }
    } catch {
      setScanMsg("Erreur réseau");
      setScanState("error");
      setTimeout(() => setScanState("idle"), 4000);
    }
  }

  // Camera scanning loop
  const scanLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanLoop);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
    if (code?.data) {
      handleQrFound(code.data);
      return;
    }
    rafRef.current = requestAnimationFrame(scanLoop);
  }, [stopCamera]);

  // Start camera
  async function startCamera() {
    setCameraError("");
    setScanState("scanning");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      rafRef.current = requestAnimationFrame(scanLoop);
    } catch {
      setCameraError("Accès à la caméra refusé. Autorisez l'accès dans les paramètres du navigateur.");
      setScanState("idle");
    }
  }

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Group records by day for history
  const byDay: Record<string, any[]> = {};
  for (const r of records) {
    const d = new Date(r.timestamp).toLocaleDateString("en-CA", { timeZone: "Africa/Algiers" });
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(r);
  }
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a)).slice(0, 14);

  const dayNames = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
  const monthNames = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
  const now = new Date();

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif font-bold">Mon Pointage</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {dayNames[now.getDay()]} {now.getDate()} {monthNames[now.getMonth()]} {now.getFullYear()} · {now.toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>

      {/* Status card */}
      <Card>
        <CardContent className="pt-5 pb-4">
          {isLoading ? (
            <div className="h-16 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : settings?.pointageEnabled === false ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <div className="w-3 h-3 rounded-full bg-gray-300" />
              <div>
                <p className="text-sm font-medium text-foreground">Pointage non activé</p>
                <p className="text-xs">L'administrateur doit activer votre compte dans les paramètres Pointage</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${isPresent ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
                <div>
                  <p className="font-semibold">{isPresent ? "Présent" : "Non pointé"}</p>
                  {lastIn && <p className="text-xs text-muted-foreground">Entrée : {fmtTime(lastIn.timestamp)}</p>}
                  {lastOut && <p className="text-xs text-muted-foreground">Sortie : {fmtTime(lastOut.timestamp)}</p>}
                  {!lastIn && <p className="text-xs text-muted-foreground">Aucun pointage aujourd'hui</p>}
                </div>
              </div>
              {todayRecords.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {todayRecords.map((r, i) => (
                    <Badge key={i} variant={r.type === "IN" ? "default" : "outline"} className="text-xs gap-1">
                      {r.type === "IN" ? "↗" : "↙"} {fmtTime(r.timestamp)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR Scanner */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="text-lg">📷</span> Scanner le QR de pointage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {scanState === "idle" && (
            <div className="space-y-3">
              {settings?.pointageEnabled === false && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <span className="text-base leading-none mt-0.5">⚠️</span>
                  <div>
                    <p className="font-medium">Pointage non activé</p>
                    <p className="mt-0.5 text-amber-600">Demandez à votre administrateur d'activer votre compte dans la page "Pointage Employés" → onglet Employés → Modifier.</p>
                  </div>
                </div>
              )}
              {cameraError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{cameraError}</p>
              )}
              <Button
                onClick={startCamera}
                className="w-full gap-2"
                size="lg"
                disabled={settings?.pointageEnabled === false}
              >
                <span>📷</span> Ouvrir la caméra et scanner
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Pointez la caméra vers le QR code affiché sur le kiosk de la boutique
              </p>
            </div>
          )}

          {scanState === "scanning" && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-gray-950" style={{ aspectRatio: "4/3" }}>
                <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover" />
                {/* Scan reticle */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-56 h-56 relative">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-full h-0.5 bg-green-400/70 animate-pulse" />
                    </div>
                  </div>
                </div>
                <p className="absolute bottom-3 left-0 right-0 text-center text-white/70 text-xs">Pointez vers le QR code...</p>
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <Button variant="outline" onClick={() => { stopCamera(); setScanState("idle"); }} className="w-full">
                Annuler
              </Button>
            </div>
          )}

          {scanState === "processing" && (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Enregistrement du pointage...</p>
            </div>
          )}

          {scanState === "success" && (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl ${scanType === "IN" ? "bg-green-100" : "bg-blue-100"}`}>
                {scanType === "IN" ? "✅" : "👋"}
              </div>
              <div>
                <p className={`font-semibold text-lg ${scanType === "IN" ? "text-green-700" : "text-blue-700"}`}>{scanMsg}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{new Date().toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
              </div>
            </div>
          )}

          {scanState === "error" && (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-3xl">❌</div>
              <div>
                <p className="font-semibold text-red-700">Échec du pointage</p>
                <p className="text-sm text-muted-foreground mt-0.5">{scanMsg}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="text-lg">📅</span> Historique récent
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : days.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">Aucun enregistrement</p>
          ) : (
            <div className="space-y-2">
              {days.map(day => {
                const dayRecs = byDay[day].sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                const ins = dayRecs.filter((r: any) => r.type === "IN");
                const outs = dayRecs.filter((r: any) => r.type === "OUT");
                const firstIn = ins[0];
                const lastOut = outs[outs.length - 1];
                const isToday = day === todayStr;

                let workMinutes = 0;
                if (firstIn && lastOut) {
                  workMinutes = Math.round((new Date(lastOut.timestamp).getTime() - new Date(firstIn.timestamp).getTime()) / 60000);
                }

                const dayDate = new Date(day + "T12:00:00");
                const dayLabel = `${dayNames[dayDate.getDay()]} ${dayDate.getDate()} ${monthNames[dayDate.getMonth()]}`;

                return (
                  <div key={day} className={`flex items-center justify-between px-4 py-2.5 rounded-xl ${isToday ? "bg-primary/5 border border-primary/20" : "bg-muted/40"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${firstIn ? "bg-green-500" : "bg-gray-300"}`} />
                      <div>
                        <p className={`text-sm font-medium ${isToday ? "text-primary" : ""}`}>
                          {isToday ? "Aujourd'hui" : dayLabel}
                        </p>
                        <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                          {firstIn && <span>↗ {fmtTime(firstIn.timestamp)}</span>}
                          {lastOut && <span>↙ {fmtTime(lastOut.timestamp)}</span>}
                          {!firstIn && <span className="italic">Non pointé</span>}
                        </div>
                      </div>
                    </div>
                    {workMinutes > 0 && (
                      <p className="text-xs text-muted-foreground font-mono shrink-0">
                        {Math.floor(workMinutes / 60)}h{String(workMinutes % 60).padStart(2, "0")}
                      </p>
                    )}
                    {firstIn && !lastOut && (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-300">En cours</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
