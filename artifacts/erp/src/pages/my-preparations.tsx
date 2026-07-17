import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  ClipboardCheck, Eye, PlayCircle, CheckCircle2, Clock,
  XCircle, Loader2, Building2, Package, RefreshCw, Printer,
  Camera, RotateCcw, Check, AlertTriangle
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAuth } from "@/lib/auth";

const AUTH = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token")}` });
const AUTH_JSON = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` });

type OrderStatus = "new" | "viewed" | "in_progress" | "completed" | "cancelled";

interface MyOrder {
  id: number;
  reference: string;
  branchName: string | null;
  sourceReplenishmentDate: string;
  status: OrderStatus;
  sentAt: string | null;
  viewedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completionPhotoUrl: string | null;
  itemCount: number;
  totalQty: number;
}

interface OrderItem {
  id: number;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  unitSnapshot: string;
  quantityToPrepare: string;
  notes: string | null;
}

interface OrderDetail extends MyOrder {
  items: OrderItem[];
  workerName: string | null;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const cfg: Record<OrderStatus, { label: string; className: string; Icon: any }> = {
    new:        { label: "Nouveau",  className: "bg-blue-100 text-blue-700",       Icon: Clock },
    viewed:     { label: "Vu",       className: "bg-purple-100 text-purple-700",   Icon: Eye },
    in_progress:{ label: "En cours", className: "bg-amber-100 text-amber-700",     Icon: PlayCircle },
    completed:  { label: "Terminé",  className: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
    cancelled:  { label: "Annulé",   className: "bg-red-100 text-red-700",         Icon: XCircle },
  };
  const { label, className, Icon } = cfg[status] ?? cfg.new;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}>
      <Icon className="h-3.5 w-3.5" />{label}
    </span>
  );
}

function fmtQty(n: string | number) {
  const v = parseFloat(String(n));
  return isNaN(v) ? "0" : (v % 1 === 0 ? v.toString() : v.toFixed(3).replace(/\.?0+$/, ""));
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "EEEE dd/MM/yyyy", { locale: fr }); } catch { return d; }
}
function fmtDateTime(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy HH:mm", { locale: fr }); } catch { return d; }
}

type CameraStep = "capture" | "preview" | "uploading";

function CameraDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (photoUrl: string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState<CameraStep>("capture");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      setCameraError("Impossible d'accéder à la caméra. Vérifiez les autorisations.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (open) {
      setStep("capture");
      setPreviewUrl(null);
      setCameraError(null);
      startCamera();
    } else {
      stopCamera();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
    return () => { stopCamera(); };
  }, [open]);

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    // Resize to max 480px wide — keeps base64 under ~25 KB in DB
    const MAX_W = 480;
    const ratio = Math.min(1, MAX_W / (video.videoWidth || 1280));
    canvas.width = Math.round((video.videoWidth || 1280) * ratio);
    canvas.height = Math.round((video.videoHeight || 720) * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Quality 0.5 → ~20–30 KB as base64, sufficient for confirmation proof
    const dataUrl = canvas.toDataURL("image/jpeg", 0.50);
    stopCamera();
    setPreviewUrl(dataUrl);
    setStep("preview");
  }

  function retake() {
    setPreviewUrl(null);
    setStep("capture");
    startCamera();
  }

  async function confirm() {
    if (!previewUrl) { onConfirm(null); return; }
    // Pass base64 data URL directly — saved in DB column, no upload server needed
    onConfirm(previewUrl);
  }

  function skipPhoto() {
    stopCamera();
    onConfirm(null);
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { stopCamera(); onClose(); } }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Camera className="h-4 w-4" />
            Photo de confirmation
          </DialogTitle>
        </DialogHeader>

        {cameraError ? (
          <div className="px-4 pb-4 space-y-3">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">{cameraError}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Annuler</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={skipPhoto}>
                Terminer sans photo
              </Button>
            </div>
          </div>
        ) : step === "capture" ? (
          <div className="space-y-0">
            <div className="relative bg-black aspect-video w-full overflow-hidden">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <div className="flex gap-2 px-4 py-3">
              <Button variant="outline" className="flex-1" onClick={onClose}>Annuler</Button>
              <Button
                className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={capture}
              >
                <Camera className="h-4 w-4" />
                Prendre la photo
              </Button>
            </div>
            <div className="px-4 pb-3 text-center">
              <button onClick={skipPhoto} className="text-xs text-muted-foreground underline underline-offset-2">
                Continuer sans photo
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-0">
            {previewUrl && (
              <div className="bg-black aspect-video w-full overflow-hidden">
                <img src={previewUrl} alt="Aperçu" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex gap-2 px-4 py-3">
              <Button variant="outline" className="flex-1 gap-2" onClick={retake}>
                <RotateCcw className="h-4 w-4" />
                Reprendre
              </Button>
              <Button
                className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={confirm}
              >
                <Check className="h-4 w-4" />
                Confirmer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function MyPreparationsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const hasWorkerId = !!(user as any)?.workerId;
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  const { data: orders = [], isLoading, isError, refetch } = useQuery<MyOrder[]>({
    queryKey: ["my-preparations"],
    enabled: hasWorkerId,
    queryFn: async () => {
      const r = await fetch("/api/my-preparations", { headers: AUTH_JSON() });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Erreur de chargement");
      }
      return r.json();
    },
  });

  async function openDetail(order: MyOrder) {
    const r = await fetch(`/api/my-preparations/${order.id}`, { headers: AUTH_JSON() });
    if (!r.ok) { toast({ title: "Erreur de chargement", variant: "destructive" }); return; }
    const data = await r.json();
    setSelected(data);
    qc.invalidateQueries({ queryKey: ["my-preparations"] });
  }

  async function updateStatus(id: number, status: string, completionPhotoUrl?: string | null) {
    setUpdating(true);
    try {
      const body: Record<string, any> = { status };
      if (completionPhotoUrl) body.completionPhotoUrl = completionPhotoUrl;
      const r = await fetch(`/api/my-preparations/${id}/status`, {
        method: "PATCH",
        headers: AUTH_JSON(),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur");
      const updated = await r.json();
      setSelected(prev => prev ? {
        ...prev,
        status: updated.status,
        startedAt: updated.startedAt,
        completedAt: updated.completedAt,
        completionPhotoUrl: updated.completionPhotoUrl ?? null,
      } : null);
      qc.invalidateQueries({ queryKey: ["my-preparations"] });
      toast({ title: status === "completed" ? "Ordre marqué terminé ✓" : "Ordre démarré" });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  }

  function handleMarkCompleted() {
    setShowCamera(true);
  }

  async function handleCameraConfirm(photoUrl: string | null) {
    setShowCamera(false);
    if (selected) {
      await updateStatus(selected.id, "completed", photoUrl);
    }
  }

  function printOrder(order: OrderDetail) {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("ORDRE DE PRÉPARATION", 14, 20);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Référence : ${order.reference}`, 14, 30);
    doc.text(`Boutique : ${order.branchName ?? "—"}`, 14, 36);
    doc.text(`Ouvrier : ${order.workerName ?? "—"}`, 14, 42);
    doc.text(`Date : ${fmtDate(order.sourceReplenishmentDate)}`, 14, 48);
    autoTable(doc, {
      startY: 58,
      head: [["Produit", "Quantité", "Unité"]],
      body: order.items.map(i => [i.productNameSnapshot, fmtQty(i.quantityToPrepare), i.unitSnapshot]),
      styles: { fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold" },
      columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    });
    const filename = `ORDRE_${order.reference}.pdf`;
    const url = URL.createObjectURL(doc.output("blob"));
    const popup = window.open(url, "_blank");
    if (!popup) doc.save(filename);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const grouped = {
    active: orders.filter(o => ["new", "viewed", "in_progress"].includes(o.status)),
    completed: orders.filter(o => o.status === "completed"),
    cancelled: orders.filter(o => o.status === "cancelled"),
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-4 border-b shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
              Mes préparations
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Ordres de préparation qui vous sont assignés</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {!hasWorkerId ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center mb-3">
              <ClipboardCheck className="h-7 w-7 text-amber-500" />
            </div>
            <p className="text-sm font-medium">Aucun ouvrier lié à votre compte</p>
            <p className="text-xs text-muted-foreground mt-1">Demandez à un administrateur de lier votre compte à un ouvrier</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Chargement…</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
              <ClipboardCheck className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Aucun ordre de préparation pour vous</p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.active.length > 0 && (
              <OrderSection title="En attente / En cours" orders={grouped.active} onOpen={openDetail} />
            )}
            {grouped.completed.length > 0 && (
              <OrderSection title="Terminés" orders={grouped.completed} onOpen={openDetail} />
            )}
            {grouped.cancelled.length > 0 && (
              <OrderSection title="Annulés" orders={grouped.cancelled} onOpen={openDetail} />
            )}
          </div>
        )}
      </div>

      {/* Camera dialog */}
      <CameraDialog
        open={showCamera}
        onClose={() => setShowCamera(false)}
        onConfirm={handleCameraConfirm}
      />

      {/* Detail Dialog */}
      {selected && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-base">{selected.reference}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{selected.branchName}</span>
                  </div>
                  <div className="text-muted-foreground">{fmtDate(selected.sourceReplenishmentDate)}</div>
                </div>
                <StatusBadge status={selected.status} />
              </div>

              <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
                {selected.viewedAt && <span>Vu : {fmtDateTime(selected.viewedAt)}</span>}
                {selected.startedAt && <span>Démarré : {fmtDateTime(selected.startedAt)}</span>}
                {selected.completedAt && <span>Terminé : {fmtDateTime(selected.completedAt)}</span>}
              </div>

              {/* Completion photo */}
              {selected.completionPhotoUrl && (
                <div className="rounded-lg overflow-hidden border">
                  <div className="px-3 py-1.5 bg-emerald-50 border-b flex items-center gap-2">
                    <Camera className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-xs font-medium text-emerald-700">Photo de confirmation</span>
                  </div>
                  <img
                    src={selected.completionPhotoUrl}
                    alt="Photo de confirmation"
                    className="w-full object-cover max-h-56"
                  />
                </div>
              )}

              <Separator />

              <div>
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  À préparer — {selected.items.length} produit{selected.items.length > 1 ? "s" : ""}
                </h4>
                <div className="space-y-2">
                  {selected.items.map(item => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{item.productNameSnapshot}</p>
                        {item.skuSnapshot && <p className="text-xs text-muted-foreground font-mono">{item.skuSnapshot}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-amber-700">{fmtQty(item.quantityToPrepare)}</p>
                        <p className="text-xs text-muted-foreground">{item.unitSnapshot}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              {!["completed", "cancelled"].includes(selected.status) && (
                <div className="flex gap-2 pt-1">
                  {selected.status !== "in_progress" && (
                    <Button onClick={() => updateStatus(selected.id, "in_progress")} disabled={updating} className="flex-1 gap-2" variant="outline">
                      {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                      Marquer en cours
                    </Button>
                  )}
                  <Button
                    onClick={handleMarkCompleted}
                    disabled={updating}
                    className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    Marquer terminé
                  </Button>
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => printOrder(selected)} className="gap-2 text-muted-foreground">
                  <Printer className="h-3.5 w-3.5" />Imprimer
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function OrderSection({ title, orders, onOpen }: { title: string; orders: MyOrder[]; onOpen: (o: MyOrder) => void }) {
  function fmtDate(d: string | null) {
    if (!d) return "—";
    try { return format(new Date(d), "dd/MM/yyyy", { locale: fr }); } catch { return d; }
  }
  function fmtQty(n: string | number) {
    const v = parseFloat(String(n));
    return isNaN(v) ? "0" : (v % 1 === 0 ? v.toString() : v.toFixed(3).replace(/\.?0+$/, ""));
  }
  const cfg: Record<string, { label: string; className: string; Icon: any }> = {
    new:        { label: "Nouveau",  className: "bg-blue-100 text-blue-700",       Icon: Clock },
    viewed:     { label: "Vu",       className: "bg-purple-100 text-purple-700",   Icon: Eye },
    in_progress:{ label: "En cours", className: "bg-amber-100 text-amber-700",     Icon: PlayCircle },
    completed:  { label: "Terminé",  className: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
    cancelled:  { label: "Annulé",   className: "bg-red-100 text-red-700",         Icon: XCircle },
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-2">{title}</h3>
      <div className="space-y-2">
        {orders.map(o => {
          const { label, className, Icon } = cfg[o.status] ?? cfg.new;
          return (
            <Card key={o.id} className="border shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => onOpen(o)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{o.reference}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
                        <Icon className="h-3 w-3" />{label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{o.branchName}</span>
                      <span>{fmtDate(o.sourceReplenishmentDate)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-amber-700">{o.itemCount} <span className="text-xs font-normal text-muted-foreground">produits</span></p>
                    <p className="text-xs text-muted-foreground">Qté: {fmtQty(o.totalQty)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
