import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetAdjustments, useGetBranches, useGetProducts, useGetStockLevels, getGetAdjustmentsQueryKey, getGetStockLevelsQueryKey, useGetCompanySettings } from "@workspace/api-client-react";
import { generateAdjustmentPdf } from "@/lib/pdf-generator";
import { ExportButton } from "@/components/ExportButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, FileDown, Check, Search, X, TrendingDown, PackageMinus, AlertTriangle, BarChart3, CalendarRange, Filter, Trash2, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Eye, CheckCircle2, XCircle, Clock, ShieldCheck, Camera, PackageCheck } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const REASONS = ["Inventaire physique", "DLC", "Labo perte", "Péremption", "Don", "Erreur de saisie", "Autre"];
const PAGE_SIZE = 50;

function fmt(n: number) {
  return new Intl.NumberFormat("fr-DZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  if (status === "en_attente") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
      <Clock className="h-3 w-3" />En attente
    </span>
  );
  if (status === "confirme") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
      <CheckCircle2 className="h-3 w-3" />Confirmé
    </span>
  );
  if (status === "non_confirme") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
      <XCircle className="h-3 w-3" />Non confirmé
    </span>
  );
  return null;
}

interface FormItem { id: string; productId: string; productSearch: string; qty: string; sign: 1 | -1; }

interface AdjDetail {
  id: number; reference: string; branchId: number; branchName: string;
  productId: number | null; productName: string | null;
  quantityChange: number | null; reason: string; notes: string | null;
  photoData: string | null; createdByUserId: number | null; createdByName: string | null;
  workerOneName: string | null; overallStatus: string | null;
  confirmedByUserId: number | null; confirmedAt: string | null;
  createdAt: string;
  items: {
    id: number; adjustmentId: number; productId: number; productNameSnapshot: string;
    skuSnapshot: string | null; quantityChange: number; itemStatus: string;
    rejectionReason: string | null; rejectionPhotoData: string | null;
    confirmedByUserId: number | null; confirmedByName: string | null; confirmedAt: string | null;
  }[];
  auditLogs: {
    id: number; userId: number | null; userName: string | null; action: string;
    details: string | null; createdAt: string;
  }[];
}

export default function Adjustments() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentUserId = (user as any)?.id ?? null;
  const canConfirm = !!(
    (user as any)?.adminAccess ||
    (user as any)?.permissions?.includes("*") ||
    (user as any)?.permissions?.includes("adjustments.*") ||
    (user as any)?.permissions?.includes("adjustments.confirm")
  );

  // ── Filter state ──────────────────────────────────────────────────────────
  const [branchFilters, setBranchFilters] = useState<string[]>([]);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const [reasonFilters, setReasonFilters] = useState<string[]>([]);
  const [reasonDropdownOpen, setReasonDropdownOpen] = useState(false);
  const reasonDropdownRef = useRef<HTMLDivElement>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productFilters, setProductFilters] = useState<string[]>([]);
  const [productInputText, setProductInputText] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const productDropdownRef = useRef<HTMLDivElement>(null);
  const [quantityTypeFilter, setQuantityTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<string>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) setBranchDropdownOpen(false);
      if (reasonDropdownRef.current && !reasonDropdownRef.current.contains(e.target as Node)) setReasonDropdownOpen(false);
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) setProductDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // ── Create dialog state ───────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formBranchId, setFormBranchId] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formItems, setFormItems] = useState<FormItem[]>([{ id: "1", productId: "", productSearch: "", qty: "", sign: -1 }]);
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── View/detail state ─────────────────────────────────────────────────────
  const [viewAdjustmentId, setViewAdjustmentId] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Reject dialog state ───────────────────────────────────────────────────
  const [rejectItemId, setRejectItemId] = useState<number | null>(null);
  const [rejectAdjId, setRejectAdjId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectPhoto, setRejectPhoto] = useState<string | null>(null);
  const [rejectCameraOpen, setRejectCameraOpen] = useState(false);
  const [rejectLoading, setRejectLoading] = useState(false);
  const rejectVideoRef = useRef<HTMLVideoElement>(null);
  const rejectCanvasRef = useRef<HTMLCanvasElement>(null);
  const rejectStreamRef = useRef<MediaStream | null>(null);
  const [confirmingItemId, setConfirmingItemId] = useState<number | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const queryParams = {
    ...(branchFilters.length === 1 ? { branchId: parseInt(branchFilters[0]) } : {}),
    ...(reasonFilters.length === 1 ? { reason: reasonFilters[0] } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };

  const { data: adjustments = [], isLoading } = useGetAdjustments(queryParams);
  const { data: branches = [] } = useGetBranches();
  const { data: products = [] } = useGetProducts({});
  const { data: companySettings } = useGetCompanySettings();

  const { data: branchStockLevels = [] } = useGetStockLevels(
    formBranchId ? { branchId: parseInt(formBranchId) } : undefined,
    { query: { enabled: !!formBranchId } }
  );

  const { data: adjDetail, refetch: refetchDetail } = useQuery<AdjDetail>({
    queryKey: ["adjustment-detail", viewAdjustmentId],
    queryFn: async () => customFetch(`/api/adjustments/${viewAdjustmentId}`),
    enabled: viewAdjustmentId != null,
    staleTime: 0,
  });

  const branchProductIds = formBranchId
    ? new Set(branchStockLevels.map(s => s.productId))
    : null;

  // ── Create form helpers ───────────────────────────────────────────────────
  function filteredProductsForItem(search: string) {
    return products.filter(p => {
      const inBranch = !branchProductIds || branchProductIds.has(p.id);
      const match = !search || p.name.toLowerCase().includes(search.toLowerCase());
      return inBranch && match;
    });
  }

  function addFormItem() {
    setFormItems(prev => [...prev, { id: String(Date.now()), productId: "", productSearch: "", qty: "", sign: -1 }]);
  }

  function removeFormItem(id: string) {
    setFormItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev);
  }

  function updateFormItem(id: string, patch: Partial<FormItem>) {
    setFormItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  }

  function resetCreateDialog() {
    setFormBranchId(""); setFormReason(""); setFormNotes("");
    setFormItems([{ id: "1", productId: "", productSearch: "", qty: "", sign: -1 }]);
    setPhotoData(null); stopCamera();
  }

  const hasNegativeItem = formItems.some(fi => fi.sign === -1 && parseFloat(fi.qty) > 0);
  const createValid = formBranchId && formReason
    && formItems.every(fi => fi.productId && fi.qty && !isNaN(parseFloat(fi.qty)) && parseFloat(fi.qty) > 0)
    && (!hasNegativeItem || photoData);
  const createBlockedReason = !formBranchId
    ? "Choisissez une boutique"
    : !formReason
      ? "Choisissez un motif"
      : !formItems.every(fi => fi.productId && fi.qty && !isNaN(parseFloat(fi.qty)) && parseFloat(fi.qty) > 0)
        ? "Complétez le produit et la quantité de chaque ligne"
        : hasNegativeItem && !photoData
          ? "Ajoutez la photo obligatoire pour enregistrer le déstockage"
          : null;

  async function handleCreate() {
    if (!createValid || creating) return;
    setCreating(true);
    try {
      const items = formItems.map(fi => ({
        productId: parseInt(fi.productId),
        quantityChange: fi.sign * parseFloat(fi.qty),
      }));
      await customFetch("/api/adjustments", {
        method: "POST",
        body: JSON.stringify({
          branchId: parseInt(formBranchId),
          reason: formReason,
          notes: formNotes || null,
          photoData: photoData ?? null,
          items,
        }),
      });
      qc.invalidateQueries({ queryKey: getGetAdjustmentsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() });
      setDialogOpen(false);
      resetCreateDialog();
      toast({ title: "Ajustement créé", description: `${items.length} produit${items.length > 1 ? "s" : ""} enregistré${items.length > 1 ? "s" : ""}` });
    } catch (err: any) {
      toast({ title: "Erreur", description: err?.data?.error ?? "Erreur lors de la création", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await customFetch(`/api/adjustments/${deleteId}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: getGetAdjustmentsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() });
      toast({ title: "Ajustement supprimé", description: "Le stock a été corrigé." });
    } catch (err: any) {
      toast({ title: "Erreur", description: err?.data?.error ?? "Erreur lors de la suppression", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setDeleteId(null);
    }
  }

  async function handleConfirmItem(adjId: number, itemId: number) {
    setConfirmingItemId(itemId);
    try {
      await customFetch(`/api/adjustments/${adjId}/items/${itemId}/confirm`, { method: "POST" });
      await refetchDetail();
      qc.invalidateQueries({ queryKey: getGetAdjustmentsQueryKey() });
      toast({ title: "Article confirmé", description: "L'article a été marqué comme confirmé." });
    } catch (err: any) {
      toast({ title: "Erreur", description: err?.data?.error ?? "Erreur lors de la confirmation", variant: "destructive" });
    } finally {
      setConfirmingItemId(null);
    }
  }

  async function handleRejectSubmit() {
    if (!rejectItemId || !rejectAdjId || !rejectReason || !rejectPhoto) return;
    setRejectLoading(true);
    try {
      await customFetch(`/api/adjustments/${rejectAdjId}/items/${rejectItemId}/reject`, {
        method: "POST",
        body: JSON.stringify({ rejectionReason: rejectReason, rejectionPhotoData: rejectPhoto }),
      });
      await refetchDetail();
      qc.invalidateQueries({ queryKey: getGetAdjustmentsQueryKey() });
      toast({ title: "Article non confirmé", description: "Le refus a été enregistré." });
      setRejectItemId(null); setRejectAdjId(null);
      setRejectReason(""); setRejectPhoto(null);
    } catch (err: any) {
      toast({ title: "Erreur", description: err?.data?.error ?? "Erreur lors du refus", variant: "destructive" });
    } finally {
      setRejectLoading(false);
    }
  }

  // ── Camera helpers ────────────────────────────────────────────────────────
  function compressImage(file: File, maxPx = 900, quality = 0.72): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = ev => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const ratio = Math.min(maxPx / img.width, maxPx / img.height, 1);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = ev.target!.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } }, 50);
    } catch {
      toast({ title: "Caméra inaccessible", variant: "destructive" });
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  function capturePhoto() {
    const video = videoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ratio = Math.min(900 / video.videoWidth, 900 / video.videoHeight, 1);
    canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhotoData(canvas.toDataURL("image/jpeg", 0.72));
    stopCamera();
  }

  async function startRejectCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      rejectStreamRef.current = stream;
      setRejectCameraOpen(true);
      setTimeout(() => { if (rejectVideoRef.current) { rejectVideoRef.current.srcObject = stream; rejectVideoRef.current.play(); } }, 50);
    } catch {
      toast({ title: "Caméra inaccessible", variant: "destructive" });
    }
  }

  function stopRejectCamera() {
    rejectStreamRef.current?.getTracks().forEach(t => t.stop());
    rejectStreamRef.current = null;
    setRejectCameraOpen(false);
  }

  function captureRejectPhoto() {
    const video = rejectVideoRef.current; const canvas = rejectCanvasRef.current;
    if (!video || !canvas) return;
    const ratio = Math.min(900 / video.videoWidth, 900 / video.videoHeight, 1);
    canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setRejectPhoto(canvas.toDataURL("image/jpeg", 0.72));
    stopRejectCamera();
  }

  // ── Filter / sort / paginate ──────────────────────────────────────────────
  const selectedFilterProduct = useMemo(
    () => productFilters.length === 1 ? products.find(p => String(p.id) === productFilters[0]) : undefined,
    [products, productFilters]
  );
  const salesContextParams = useMemo(() => {
    if (productFilters.length === 0) return null;
    const p: Record<string, string> = { productIds: productFilters.join(",") };
    if (branchFilters.length === 1) p.branchId = branchFilters[0];
    else if (branchFilters.length > 1) p.branchIds = branchFilters.join(",");
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    return p;
  }, [productFilters, branchFilters, dateFrom, dateTo]);

  const hasActiveFilters = branchFilters.length > 0 || reasonFilters.length > 0 || !!dateFrom || !!dateTo
    || productFilters.length > 0 || quantityTypeFilter !== "all" || statusFilter !== "all";

  function resetFilters() {
    setBranchFilters([]); setReasonFilters([]); setDateFrom(""); setDateTo("");
    setProductFilters([]); setProductInputText(""); setQuantityTypeFilter("all"); setStatusFilter("all");
    setSortBy("date"); setSortDir("desc");
  }

  function toggleBranch(id: string) { setBranchFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }
  function toggleReason(r: string) { setReasonFilters(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]); }
  function toggleProduct(id: string) { setProductFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }

  const displayedAdjustments = useMemo(() => {
    let list = [...adjustments] as any[];
    if (branchFilters.length > 1) list = list.filter(a => branchFilters.includes(String(a.branchId)));
    if (reasonFilters.length > 0) list = list.filter(a => reasonFilters.includes(a.reason));
    if (productFilters.length > 0) list = list.filter(a => productFilters.includes(String(a.productId)));
    if (quantityTypeFilter === "positive") list = list.filter(a => a.quantityChange != null ? a.quantityChange > 0 : false);
    if (quantityTypeFilter === "negative") list = list.filter(a => a.quantityChange == null || a.quantityChange < 0);
    if (statusFilter === "en_attente") list = list.filter(a => a.overallStatus === "en_attente");
    else if (statusFilter === "confirme") list = list.filter(a => a.overallStatus === "confirme");
    else if (statusFilter === "non_confirme") list = list.filter(a => a.overallStatus === "non_confirme");
    else if (statusFilter === "legacy") list = list.filter(a => !a.overallStatus);
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (sortBy) {
        case "reference":  return dir * a.reference.localeCompare(b.reference);
        case "date":       return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        case "product":    return dir * ((a.productName ?? "").localeCompare(b.productName ?? ""));
        case "branch":     return dir * ((a.branchName ?? "").localeCompare(b.branchName ?? ""));
        case "qty":        return dir * ((a.quantityChange ?? 0) - (b.quantityChange ?? 0));
        case "value": {
          const va = a.quantityChange != null && a.quantityChange < 0 ? Math.abs(a.quantityChange) * (a.costPrice ?? 0) : 0;
          const vb = b.quantityChange != null && b.quantityChange < 0 ? Math.abs(b.quantityChange) * (b.costPrice ?? 0) : 0;
          return dir * (va - vb);
        }
        case "reason":    return dir * ((a.reason ?? "").localeCompare(b.reason ?? ""));
        case "createdBy": return dir * ((a.createdByName ?? "").localeCompare(b.createdByName ?? ""));
        default:          return 0;
      }
    });
    return list;
  }, [adjustments, reasonFilters, productFilters, quantityTypeFilter, statusFilter, sortBy, sortDir]);

  useEffect(() => { setCurrentPage(1); }, [displayedAdjustments]);
  const totalPages = Math.max(1, Math.ceil(displayedAdjustments.length / PAGE_SIZE));
  const paginatedAdjustments = displayedAdjustments.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const uniqueProductIds = useMemo(
    () => [...new Set(displayedAdjustments.map((a: any) => a.productId).filter(Boolean))],
    [displayedAdjustments]
  );
  const soldQtyParams = useMemo(() => {
    if (uniqueProductIds.length === 0) return null;
    const uniqueDates = [...new Set(displayedAdjustments.map((a: any) => format(new Date(a.createdAt), "yyyy-MM-dd")))];
    const p: Record<string, string> = { productIds: uniqueProductIds.join(","), dates: uniqueDates.join(",") };
    if (branchFilters.length === 1) p.branchId = branchFilters[0];
    else if (branchFilters.length > 1) p.branchIds = branchFilters.join(",");
    return p;
  }, [uniqueProductIds, displayedAdjustments, branchFilters]);

  const { data: soldQtyMap = {} } = useQuery<Record<string, number>>({
    queryKey: ["adjustments-sold-qty", soldQtyParams],
    queryFn: async () => {
      if (!soldQtyParams) return {};
      return customFetch(`/api/adjustments/sold-quantities?${new URLSearchParams(soldQtyParams).toString()}`);
    },
    enabled: !!soldQtyParams, staleTime: 60_000,
  });

  const { data: salesCtx } = useQuery<{ soldQty: number; soldValue: number }>({
    queryKey: ["adjustments-sales-ctx", salesContextParams],
    queryFn: async () => {
      if (!salesContextParams) return { soldQty: 0, soldValue: 0 };
      return customFetch(`/api/adjustments/sales-context?${new URLSearchParams(salesContextParams).toString()}`);
    },
    enabled: !!salesContextParams, staleTime: 60_000,
  });

  const computedStats = useMemo(() => {
    const negatives = displayedAdjustments.filter((a: any) => a.quantityChange != null ? a.quantityChange < 0 : a.itemsCount > 0);
    let totalPerteQuantite = 0; let totalPerteValeur = 0;
    const byReasonMap = new Map<string, { count: number; quantite: number; valeur: number }>();
    for (const a of negatives) {
      const qty = a.quantityChange != null ? Math.abs(a.quantityChange) : (a.itemsTotalQty ?? 0);
      const cost = a.costPrice ?? 0;
      const valeur = a.quantityChange != null ? qty * cost : 0;
      totalPerteQuantite += qty; totalPerteValeur += valeur;
      const existing = byReasonMap.get(a.reason) ?? { count: 0, quantite: 0, valeur: 0 };
      byReasonMap.set(a.reason, { count: existing.count + 1, quantite: existing.quantite + qty, valeur: existing.valeur + valeur });
    }
    return {
      totalPerteQuantite: Math.round(totalPerteQuantite * 100) / 100,
      totalPerteValeur: Math.round(totalPerteValeur * 100) / 100,
      countPertes: negatives.length,
      byReason: Array.from(byReasonMap.entries()).map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.valeur - a.valeur),
    };
  }, [displayedAdjustments]);

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
  }

  // Status counts for filter badges
  const statusCounts = useMemo(() => {
    const en_attente = (adjustments as any[]).filter(a => a.overallStatus === "en_attente").length;
    const non_confirme = (adjustments as any[]).filter(a => a.overallStatus === "non_confirme").length;
    return { en_attente, non_confirme };
  }, [adjustments]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Ajustements de stock</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Corrections et régularisations</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            endpoint="export/adjustments"
            label="Exporter"
            variant="outline"
            params={{
              ...(branchFilters.length === 1 ? { branchId: branchFilters[0] } : {}),
              ...(branchFilters.length > 1  ? { branchIds: branchFilters.join(",") } : {}),
              ...(reasonFilters.length === 1 ? { reason: reasonFilters[0] } : {}),
              ...(dateFrom ? { dateFrom } : {}),
              ...(dateTo ? { dateTo } : {}),
              ...(productFilters.length > 0 ? { productIds: productFilters.join(",") } : {}),
            }}
          />
          <Button onClick={() => { resetCreateDialog(); setDialogOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" />Nouvel ajustement
          </Button>
        </div>
      </div>

      {/* ── Status alert badges ── */}
      {(statusCounts.en_attente > 0 || statusCounts.non_confirme > 0) && (
        <div className="flex flex-wrap gap-2">
          {statusCounts.en_attente > 0 && (
            <button
              onClick={() => setStatusFilter(s => s === "en_attente" ? "all" : "en_attente")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                statusFilter === "en_attente"
                  ? "bg-amber-200 text-amber-900 border-amber-300"
                  : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              {statusCounts.en_attente} en attente de confirmation
            </button>
          )}
          {statusCounts.non_confirme > 0 && (
            <button
              onClick={() => setStatusFilter(s => s === "non_confirme" ? "all" : "non_confirme")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
                statusFilter === "non_confirme"
                  ? "bg-red-200 text-red-900 border-red-300"
                  : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {statusCounts.non_confirme} non confirmé{statusCounts.non_confirme > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {/* ── Filtres ── */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Filter className="h-3.5 w-3.5" />Filtres
          {hasActiveFilters && (
            <button onClick={resetFilters} className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-destructive transition-colors">
              <X className="h-3 w-3" />Réinitialiser
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Boutique */}
          <div className="space-y-1 relative" ref={branchDropdownRef}>
            <label className="text-xs font-medium text-muted-foreground">Boutique</label>
            <button type="button" onClick={() => setBranchDropdownOpen(o => !o)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent transition-colors">
              <span className={branchFilters.length === 0 ? "text-muted-foreground" : "font-medium"}>
                {branchFilters.length === 0 ? "Toutes les boutiques"
                  : branchFilters.length === 1 ? branches.find(b => String(b.id) === branchFilters[0])?.name
                  : `${branchFilters.length} boutiques`}
              </span>
              <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", branchDropdownOpen && "rotate-180")} />
            </button>
            {branchDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
                <div className="max-h-56 overflow-y-auto p-1">
                  <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                    <input type="checkbox" checked={branchFilters.length === 0} onChange={() => setBranchFilters([])} className="h-4 w-4 rounded" />
                    <span className="font-medium">Toutes les boutiques</span>
                  </label>
                  <div className="my-1 border-t" />
                  {branches.map(b => (
                    <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                      <input type="checkbox" checked={branchFilters.includes(String(b.id))} onChange={() => toggleBranch(String(b.id))} className="h-4 w-4 rounded" />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Motif */}
          <div className="space-y-1 relative" ref={reasonDropdownRef}>
            <label className="text-xs font-medium text-muted-foreground">Motif</label>
            <button type="button" onClick={() => setReasonDropdownOpen(o => !o)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent transition-colors">
              <span className={reasonFilters.length === 0 ? "text-muted-foreground" : "font-medium"}>
                {reasonFilters.length === 0 ? "Tous les motifs" : reasonFilters.length === 1 ? reasonFilters[0] : `${reasonFilters.length} motifs`}
              </span>
              <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", reasonDropdownOpen && "rotate-180")} />
            </button>
            {reasonDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
                <div className="max-h-56 overflow-y-auto p-1">
                  <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                    <input type="checkbox" checked={reasonFilters.length === 0} onChange={() => setReasonFilters([])} className="h-4 w-4 rounded" />
                    <span className="font-medium">Tous les motifs</span>
                  </label>
                  <div className="my-1 border-t" />
                  {REASONS.map(r => (
                    <label key={r} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                      <input type="checkbox" checked={reasonFilters.includes(r)} onChange={() => toggleReason(r)} className="h-4 w-4 rounded" />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Produit */}
          <div className="space-y-1 relative" ref={productDropdownRef}>
            <label className="text-xs font-medium text-muted-foreground">Produit</label>
            <button type="button" onClick={() => setProductDropdownOpen(o => !o)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-accent transition-colors">
              <span className={productFilters.length === 0 ? "text-muted-foreground" : "font-medium"}>
                {productFilters.length === 0 ? "Tous les produits"
                  : productFilters.length === 1 ? products.find(p => String(p.id) === productFilters[0])?.name ?? "1 produit"
                  : `${productFilters.length} produits`}
              </span>
              <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", productDropdownOpen && "rotate-180")} />
            </button>
            {productDropdownOpen && (
              <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
                <div className="p-2 border-b">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input className="h-8 pl-8 text-sm" placeholder="Rechercher..." value={productInputText}
                      onChange={e => setProductInputText(e.target.value)} onMouseDown={e => e.stopPropagation()} autoFocus />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto p-1">
                  <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                    <input type="checkbox" checked={productFilters.length === 0} onChange={() => { setProductFilters([]); setProductInputText(""); }} className="h-4 w-4 rounded" />
                    <span className="font-medium">Tous les produits</span>
                  </label>
                  <div className="my-1 border-t" />
                  {products.filter(p => !productInputText || p.name.toLowerCase().includes(productInputText.toLowerCase())).slice(0, 40).map(p => (
                    <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent select-none">
                      <input type="checkbox" checked={productFilters.includes(String(p.id))} onChange={() => toggleProduct(String(p.id))} className="h-4 w-4 rounded" />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date début</label>
            <div className="relative">
              <CalendarRange className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="pl-9 h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date fin</label>
            <div className="relative">
              <CalendarRange className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="pl-9 h-9 text-sm" />
            </div>
          </div>

          {/* Statut */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Statut confirmation</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="en_attente">En attente</SelectItem>
                <SelectItem value="confirme">Confirmé</SelectItem>
                <SelectItem value="non_confirme">Non confirmé</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Quantity type */}
        <div className="flex gap-2 flex-wrap">
          {["all", "negative", "positive"].map(v => (
            <button key={v} onClick={() => setQuantityTypeFilter(v)}
              className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                quantityTypeFilter === v ? "bg-primary text-primary-foreground border-primary" : "border-input bg-transparent hover:bg-accent")}>
              {v === "all" ? "Tous" : v === "negative" ? "Déstockage (−)" : "Restockage (+)"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stats card ── */}
      {computedStats.countPertes > 0 && (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-red-800 flex items-center gap-2">
              <PackageMinus className="h-4 w-4" />
              Pertes — vue filtrée ({computedStats.countPertes} opération{computedStats.countPertes !== 1 ? "s" : ""})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-white border border-red-100 p-3 text-center">
                <p className="text-2xl font-bold font-mono text-red-600">{fmt(computedStats.totalPerteQuantite)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Quantité perdue</p>
              </div>
              <div className="rounded-lg bg-white border border-red-100 p-3 text-center">
                <p className="text-2xl font-bold font-mono text-red-600">{fmt(computedStats.totalPerteValeur)} <span className="text-sm">DA</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">Valeur estimée</p>
              </div>
              {salesCtx && salesCtx.soldQty > 0 && (
                <div className="rounded-lg bg-white border border-amber-100 p-3 text-center">
                  <p className="text-2xl font-bold font-mono text-amber-600">
                    {((computedStats.totalPerteQuantite / salesCtx.soldQty) * 100).toFixed(1)} %
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Taux de perte</p>
                </div>
              )}
            </div>
            {salesCtx && (productFilters.length === 1 || productFilters.length > 1) && (
              <div className="rounded-lg bg-white border border-red-100 p-3">
                <div className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2">
                  {productFilters.length === 1 && selectedFilterProduct
                    ? `Comparaison ventes / pertes — ${selectedFilterProduct.name}`
                    : `Comparaison ventes / pertes — ${productFilters.length} produits`}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400" />
                    <span className="text-muted-foreground">Vendu :</span>
                    <span className="font-bold text-blue-700">{fmt(salesCtx.soldQty)} unités</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" />
                    <span className="text-muted-foreground">Perdu :</span>
                    <span className="font-bold text-red-600">{fmt(computedStats.totalPerteQuantite)} unités</span>
                  </div>
                </div>
                {salesCtx.soldQty > 0 && (
                  <div className="mt-2 h-2 w-full rounded-full bg-blue-100 overflow-hidden">
                    <div className="h-full rounded-full bg-red-400 transition-all"
                      style={{ width: `${Math.min(100, (computedStats.totalPerteQuantite / (salesCtx.soldQty + computedStats.totalPerteQuantite)) * 100)}%` }} />
                  </div>
                )}
              </div>
            )}
            {computedStats.byReason.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Détail par motif</div>
                <div className="overflow-x-auto rounded-md border border-red-100 bg-white">
                  <table className="w-full text-sm min-w-[400px]">
                    <thead>
                      <tr className="border-b border-red-100 bg-red-50/50">
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Motif</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Opérations</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Quantité</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Valeur (DA)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computedStats.byReason.map((row, i) => (
                        <tr key={row.reason} className={cn("border-b border-red-50 last:border-0", i % 2 === 1 && "bg-red-50/20")}>
                          <td className="px-3 py-2 font-medium">{row.reason}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{row.count}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{fmt(row.quantite)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-red-600">{fmt(row.valeur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Table ── */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {(["reference","date","product","branch","qty"] as const).map(col => {
                  const labels: Record<string, string> = { reference: "Référence", date: "Date", product: "Produit", branch: "Boutique", qty: "Variation" };
                  return (
                    <TableHead key={col}>
                      <button onClick={() => handleSort(col)} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors">
                        {labels[col]}<SortIcon col={col} />
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead className="text-xs text-right text-blue-600 font-semibold">Vendu</TableHead>
                {(["value","reason","createdBy"] as const).map(col => {
                  const labels: Record<string, string> = { value: "Valeur (DA)", reason: "Motif", createdBy: "Par" };
                  return (
                    <TableHead key={col}>
                      <button onClick={() => handleSort(col)} className="flex items-center gap-1 font-medium hover:text-foreground transition-colors">
                        {labels[col]}<SortIcon col={col} />
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead>Statut</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : displayedAdjustments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    {hasActiveFilters ? "Aucun ajustement pour ces filtres" : "Aucun ajustement"}
                  </TableCell>
                </TableRow>
              ) : paginatedAdjustments.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.reference}</TableCell>
                  <TableCell className="text-sm">
                    <div>{format(new Date(a.createdAt), "dd/MM/yyyy")}</div>
                    <div className="text-xs text-muted-foreground capitalize">{format(new Date(a.createdAt), "EEEE", { locale: fr })}</div>
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {a.productName
                      ? a.productName
                      : a.itemsCount > 0
                        ? <span className="text-muted-foreground italic text-xs">{a.itemsCount} produit{a.itemsCount > 1 ? "s" : ""}</span>
                        : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.branchName}</TableCell>
                  <TableCell className="text-sm">
                    {a.quantityChange != null
                      ? <div className={`font-mono font-medium ${a.quantityChange > 0 ? "text-green-600" : "text-red-600"}`}>{a.quantityChange > 0 ? "+" : ""}{a.quantityChange}</div>
                      : a.itemsTotalQty > 0
                        ? <div className="font-mono font-medium text-red-600">−{fmt(a.itemsTotalQty)}</div>
                        : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {(() => {
                      const dateKey = format(new Date(a.createdAt), "yyyy-MM-dd");
                      const qty = soldQtyMap[`${a.productId}_${dateKey}`];
                      return qty != null ? <span className="font-mono text-blue-600">{fmt(qty)}</span> : <span className="text-muted-foreground/40">—</span>;
                    })()}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    {a.quantityChange != null && a.quantityChange < 0 && a.costPrice != null
                      ? <span className="text-red-600 font-semibold">{fmt(Math.abs(a.quantityChange) * a.costPrice)}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">{a.reason}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.createdByName ?? <span className="text-muted-foreground/40 italic text-xs">—</span>}</TableCell>
                  <TableCell><StatusBadge status={a.overallStatus} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Voir les détails"
                        onClick={() => setViewAdjustmentId(a.id)}>
                        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Télécharger PDF"
                        onClick={() => {
                          if (!companySettings) return;
                          generateAdjustmentPdf({
                            reference: a.reference, branchName: a.branchName,
                            productName: a.productName, quantityChange: a.quantityChange,
                            reason: a.reason, notes: a.notes ?? null,
                            createdByName: a.createdByName ?? null, createdAt: a.createdAt,
                          }, companySettings as any);
                        }}>
                        <FileDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive hover:bg-destructive/10"
                        title="Supprimer" onClick={() => setDeleteId(a.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Pagination ── */}
      {displayedAdjustments.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-muted-foreground">
            {displayedAdjustments.length} opération{displayedAdjustments.length !== 1 ? "s" : ""} — page {currentPage} / {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}>
              <ChevronLeft className="h-3.5 w-3.5" /><ChevronLeft className="h-3.5 w-3.5 -ml-2.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
              const page = start + i;
              return (
                <Button key={page} variant={page === currentPage ? "default" : "outline"} size="icon" className="h-8 w-8 text-xs" onClick={() => setCurrentPage(page)}>
                  {page}
                </Button>
              );
            })}
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)}>
              <ChevronRight className="h-3.5 w-3.5" /><ChevronRight className="h-3.5 w-3.5 -ml-2.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────
          CREATE DIALOG — Multi-item
      ────────────────────────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) { stopCamera(); } setDialogOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Nouvel ajustement de stock</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 pr-1">

            {/* Boutique */}
            <div>
              <Label>Boutique *</Label>
              <Select value={formBranchId} onValueChange={v => { setFormBranchId(v); setFormItems(prev => prev.map(i => ({ ...i, productId: "", productSearch: "" }))); }}>
                <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Motif */}
            <div>
              <Label>Motif *</Label>
              <Select value={formReason} onValueChange={setFormReason}>
                <SelectTrigger><SelectValue placeholder="Choisir un motif" /></SelectTrigger>
                <SelectContent>{REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label>Notes</Label>
              <Input value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Notes optionnelles..." />
            </div>

            {/* Items list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Produits *</Label>
                <div className="text-right">
                  <span className="block text-xs text-muted-foreground">{formItems.length} produit{formItems.length > 1 ? "s" : ""}</span>
                  <span className="block text-[11px] text-primary">Nombre illimité</span>
                </div>
              </div>
              <div className="space-y-3">
                {formItems.map((fi, idx) => {
                  const filtered = filteredProductsForItem(fi.productSearch);
                  const selected = products.find(p => String(p.id) === fi.productId);
                  return (
                    <div key={fi.id} className="rounded-lg border bg-card p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">Produit {idx + 1}</span>
                        {formItems.length > 1 && (
                          <button type="button" onClick={() => removeFormItem(fi.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {!formBranchId ? (
                        <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground">Choisir une boutique d'abord</div>
                      ) : (
                        <div className="rounded-md border border-input bg-background">
                          <div className="flex items-center border-b px-3">
                            <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                            <input type="text" placeholder="Rechercher un produit..."
                              value={fi.productSearch}
                              onChange={e => updateFormItem(fi.id, { productSearch: e.target.value })}
                              className="flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground" />
                            {fi.productSearch && (
                              <button onClick={() => updateFormItem(fi.id, { productSearch: "" })} className="ml-1 text-muted-foreground hover:text-foreground">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="max-h-[140px] overflow-y-auto overscroll-contain">
                            {filtered.length === 0
                              ? <p className="py-4 text-center text-sm text-muted-foreground">Aucun produit</p>
                              : filtered.slice(0, 20).map(p => (
                                <button key={p.id} type="button"
                                  onClick={() => updateFormItem(fi.id, { productId: String(p.id), productSearch: "" })}
                                  className={cn("w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors",
                                    fi.productId === String(p.id) && "bg-accent font-medium")}>
                                  <Check className={cn("h-3.5 w-3.5 shrink-0 text-primary", fi.productId === String(p.id) ? "opacity-100" : "opacity-0")} />
                                  {p.name}
                                </button>
                              ))}
                          </div>
                          {selected && (
                            <div className="border-t px-3 py-1.5 flex items-center justify-between bg-primary/5">
                              <span className="text-xs font-medium text-primary truncate">{selected.name}</span>
                              <button onClick={() => updateFormItem(fi.id, { productId: "" })} className="text-muted-foreground hover:text-destructive ml-2 shrink-0">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Qty */}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => updateFormItem(fi.id, { sign: fi.sign === -1 ? 1 : -1 })}
                          className={`flex items-center justify-center h-9 w-12 shrink-0 rounded-md border text-lg font-bold transition-colors ${fi.sign === -1 ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100" : "border-green-300 bg-green-50 text-green-600 hover:bg-green-100"}`}
                          title="Cliquer pour inverser">
                          {fi.sign === -1 ? "−" : "+"}
                        </button>
                        <Input type="text" inputMode="decimal" value={fi.qty}
                          onChange={e => { const v = e.target.value.replace(",", ".").replace(/^-/, ""); if (/^\d*\.?\d*$/.test(v)) updateFormItem(fi.id, { qty: v }); }}
                          placeholder="Quantité" className="flex-1" />
                      </div>
                      {fi.qty && !isNaN(parseFloat(fi.qty)) && parseFloat(fi.qty) > 0 && (
                        <p className={`text-xs font-medium ${fi.sign === -1 ? "text-red-600" : "text-green-600"}`}>
                          Variation : {fi.sign === -1 ? "−" : "+"}{fi.qty}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={addFormItem}
                className="mt-2 flex items-center gap-1.5 w-full justify-center rounded-md border-2 border-dashed border-primary/30 py-2 text-sm text-primary hover:border-primary/60 hover:bg-primary/5 transition-colors">
                <Plus className="h-4 w-4" />Ajouter un produit
              </button>
            </div>

            {/* Photo */}
            <div>
              <Label className="flex items-center gap-1">
                Photo
                {hasNegativeItem && <span className="text-destructive">*</span>}
                <span className="text-xs text-muted-foreground font-normal ml-1">(caméra uniquement)</span>
              </Label>
              <canvas ref={canvasRef} className="hidden" />
              <div className="mt-1.5">
                {cameraOpen ? (
                  <div className="relative w-full rounded-md overflow-hidden border bg-black">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-56 object-cover" />
                    <div className="flex gap-2 justify-center p-2 bg-black/70">
                      <button type="button" onClick={capturePhoto}
                        className="bg-white text-black font-semibold text-sm px-5 py-1.5 rounded-full hover:bg-gray-100 transition-colors">
                        📸 Capturer
                      </button>
                      <button type="button" onClick={stopCamera}
                        className="bg-white/20 text-white text-sm px-4 py-1.5 rounded-full hover:bg-white/30 transition-colors">
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : photoData ? (
                  <div className="relative w-full">
                    <img src={photoData} alt="Photo" className="w-full max-h-40 object-cover rounded-md border" />
                    <button type="button" onClick={() => setPhotoData(null)}
                      className="absolute top-1.5 right-1.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80">
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <p className="text-xs text-green-600 mt-1 font-medium">✓ Photo capturée</p>
                  </div>
                ) : (
                  <button type="button" onClick={startCamera}
                    className="flex flex-col items-center justify-center gap-2 w-full h-24 border-2 border-dashed rounded-md hover:border-primary/60 hover:bg-primary/5 transition-colors">
                    <span className="text-2xl">📷</span>
                    <span className="text-sm text-muted-foreground">Appuyer pour ouvrir la caméra</span>
                  </button>
                )}
              </div>
              {hasNegativeItem && !photoData && (
                <p className="text-xs text-destructive mt-1">⚠ Photo obligatoire pour tout déstockage (−)</p>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 pt-2 border-t flex-col sm:flex-row">
            {createBlockedReason && (
              <p className="w-full text-xs text-destructive sm:mr-auto sm:w-auto">{createBlockedReason}</p>
            )}
            <div className="flex w-full gap-2 sm:w-auto">
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setDialogOpen(false)}>Annuler</Button>
              <Button className="flex-1 sm:flex-none" onClick={handleCreate} disabled={!createValid || creating}>
                {creating ? "Enregistrement..." : `Enregistrer ${formItems.length > 1 ? `(${formItems.length} produits)` : ""}`}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────
          DETAIL DIALOG — with items and confirmation
      ────────────────────────────────────────────────────────────────────── */}
      <Dialog open={viewAdjustmentId !== null} onOpenChange={open => { if (!open) setViewAdjustmentId(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          {adjDetail && (() => {
            const a = adjDetail;
            const isCreator = a.createdByUserId === currentUserId;
            const canAct = canConfirm && !isCreator;
            const hasItems = a.items && a.items.length > 0;
            const costVal = a.quantityChange != null && a.quantityChange < 0 && a.items.length === 0
              ? null : null;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center justify-between">
                    <DialogTitle className="font-mono text-sm text-muted-foreground">{a.reference}</DialogTitle>
                    <StatusBadge status={a.overallStatus} />
                  </div>
                </DialogHeader>
                <div className="space-y-4">

                  {/* Identity */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Date</p>
                      <p className="font-medium">{format(new Date(a.createdAt), "dd/MM/yyyy HH:mm")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Créé par</p>
                      <p className="font-medium">{a.createdByName ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Boutique</p>
                      <p className="font-medium">{a.branchName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Motif</p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">{a.reason}</span>
                    </div>
                    {a.notes && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Notes</p>
                        <p className="text-sm rounded-md bg-muted/40 border px-3 py-2">{a.notes}</p>
                      </div>
                    )}
                  </div>

                  {/* Guard notice */}
                  {canConfirm && isCreator && a.overallStatus === "en_attente" && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Vous ne pouvez pas confirmer un ajustement que vous avez créé.
                    </div>
                  )}

                  {/* Items table */}
                  {hasItems && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Articles ({a.items.length})</p>
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/50 border-b">
                              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Produit</th>
                              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Qté</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">Statut</th>
                              {canAct && <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">Actions</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {a.items.map(item => (
                              <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20">
                                <td className="px-3 py-2.5 font-medium">{item.productNameSnapshot}</td>
                                <td className={`px-3 py-2.5 text-right font-mono font-semibold ${item.quantityChange < 0 ? "text-red-600" : "text-green-600"}`}>
                                  {item.quantityChange > 0 ? "+" : ""}{item.quantityChange}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <StatusBadge status={item.itemStatus} />
                                </td>
                                {canAct && (
                                  <td className="px-3 py-2.5 text-center">
                                    {item.itemStatus === "en_attente" ? (
                                      <div className="flex items-center justify-center gap-1">
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                                          title="Confirmer" disabled={confirmingItemId === item.id}
                                          onClick={() => handleConfirmItem(a.id, item.id)}>
                                          <CheckCircle2 className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                                          title="Non confirmé"
                                          onClick={() => { setRejectItemId(item.id); setRejectAdjId(a.id); }}>
                                          <XCircle className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-muted-foreground">
                                        {item.confirmedByName && <div>{item.confirmedByName}</div>}
                                        {item.confirmedAt && <div>{format(new Date(item.confirmedAt), "dd/MM HH:mm")}</div>}
                                      </div>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Rejection details for non_confirme items */}
                      {a.items.some(i => i.itemStatus === "non_confirme") && (
                        <div className="mt-3 space-y-2">
                          {a.items.filter(i => i.itemStatus === "non_confirme").map(item => (
                            <div key={item.id} className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                              <p className="text-xs font-semibold text-red-800">{item.productNameSnapshot} — Motif de refus</p>
                              <p className="text-sm text-red-700">{item.rejectionReason}</p>
                              {item.rejectionPhotoData && (
                                <div className="cursor-zoom-in" onClick={() => setLightboxSrc(item.rejectionPhotoData!)}>
                                  <img src={item.rejectionPhotoData} alt="Photo refus" className="w-full max-h-32 object-cover rounded-md border border-red-200" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Main photo */}
                  {a.photoData && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Photo du déstockage</p>
                      <div className="relative group cursor-zoom-in" onClick={() => setLightboxSrc(a.photoData!)}>
                        <img src={a.photoData} alt="Photo" className="w-full rounded-md border object-cover transition-opacity group-hover:opacity-90 max-h-48" />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="bg-black/50 text-white text-xs font-medium px-2.5 py-1 rounded-full backdrop-blur-sm">🔍 Agrandir</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Audit log */}
                  {a.auditLogs && a.auditLogs.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Historique</p>
                      <div className="space-y-1.5">
                        {a.auditLogs.map(log => {
                          const actionLabels: Record<string, string> = {
                            created: "Ajustement créé",
                            item_confirmed: "Article confirmé",
                            item_rejected: "Article non confirmé",
                            deleted: "Ajustement supprimé",
                          };
                          const details = log.details ? (() => { try { return JSON.parse(log.details!); } catch { return {}; } })() : {};
                          return (
                            <div key={log.id} className="flex items-start gap-2 text-xs">
                              <span className={cn("mt-0.5 h-2 w-2 rounded-full shrink-0",
                                log.action === "item_confirmed" ? "bg-green-500"
                                : log.action === "item_rejected" ? "bg-red-500"
                                : log.action === "created" ? "bg-blue-500"
                                : "bg-gray-400")} />
                              <div className="flex-1 min-w-0">
                                <span className="font-medium">{actionLabels[log.action] ?? log.action}</span>
                                {details.productName && <span className="text-muted-foreground ml-1">— {details.productName}</span>}
                                {log.userName && <span className="text-muted-foreground ml-1">par {log.userName}</span>}
                              </div>
                              <span className="text-muted-foreground shrink-0">{format(new Date(log.createdAt), "dd/MM HH:mm")}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
          {!adjDetail && viewAdjustmentId && (
            <div className="py-12 text-center text-muted-foreground">Chargement...</div>
          )}
        </DialogContent>
      </Dialog>

      {/* ──────────────────────────────────────────────────────────────────────
          REJECT DIALOG
      ────────────────────────────────────────────────────────────────────── */}
      <Dialog open={rejectItemId !== null} onOpenChange={open => {
        if (!open) {
          stopRejectCamera();
          setRejectItemId(null); setRejectAdjId(null);
          setRejectReason(""); setRejectPhoto(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="h-4 w-4" />Non confirmé — Motif obligatoire
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Motif du refus *</Label>
              <Input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Ex: Quantité reçue différente..." className="mt-1" />
            </div>
            <div>
              <Label className="flex items-center gap-1">Photo * <span className="text-xs text-muted-foreground font-normal">(caméra uniquement)</span></Label>
              <canvas ref={rejectCanvasRef} className="hidden" />
              <div className="mt-1.5">
                {rejectCameraOpen ? (
                  <div className="relative w-full rounded-md overflow-hidden border bg-black">
                    <video ref={rejectVideoRef} autoPlay playsInline muted className="w-full max-h-48 object-cover" />
                    <div className="flex gap-2 justify-center p-2 bg-black/70">
                      <button type="button" onClick={captureRejectPhoto}
                        className="bg-white text-black font-semibold text-sm px-5 py-1.5 rounded-full hover:bg-gray-100">📸 Capturer</button>
                      <button type="button" onClick={stopRejectCamera}
                        className="bg-white/20 text-white text-sm px-4 py-1.5 rounded-full hover:bg-white/30">Annuler</button>
                    </div>
                  </div>
                ) : rejectPhoto ? (
                  <div className="relative">
                    <img src={rejectPhoto} alt="Photo refus" className="w-full max-h-36 object-cover rounded-md border" />
                    <button type="button" onClick={() => setRejectPhoto(null)}
                      className="absolute top-1.5 right-1.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80">
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <p className="text-xs text-green-600 mt-1 font-medium">✓ Photo capturée</p>
                  </div>
                ) : (
                  <button type="button" onClick={startRejectCamera}
                    className="flex flex-col items-center justify-center gap-2 w-full h-20 border-2 border-dashed rounded-md hover:border-red-400 hover:bg-red-50 transition-colors">
                    <Camera className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Photo obligatoire</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectItemId(null)}>Annuler</Button>
            <Button variant="destructive" disabled={!rejectReason || !rejectPhoto || rejectLoading} onClick={handleRejectSubmit}>
              {rejectLoading ? "Enregistrement..." : "Confirmer le refus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog ── */}
      <Dialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />Supprimer l'ajustement
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Cette action est <strong>irréversible</strong>. Le stock sera corrigé automatiquement.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleteLoading}>Annuler</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteLoading}>
              {deleteLoading ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Lightbox ── */}
      {lightboxSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 cursor-zoom-out" onClick={() => setLightboxSrc(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors" onClick={() => setLightboxSrc(null)}>
            <X className="h-5 w-5" />
          </button>
          <img src={lightboxSrc} alt="Photo agrandie" className="max-w-[92vw] max-h-[92vh] rounded-lg object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
