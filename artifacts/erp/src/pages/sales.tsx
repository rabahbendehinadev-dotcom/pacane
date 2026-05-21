import { useState, useMemo, useEffect, useRef } from "react";
import {
  useCreateSale, useGetContacts, useGetBranches, useGetProducts, useGetUnits,
  useGetCategories,
  useAddSalePayment, useConvertSaleDocument, useCancelSaleDocument,
  useDuplicateSaleDocument, useUpdateSale,
  Sale
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Plus, Eye, CreditCard, Copy, XCircle, ArrowRight, FileText, FileCheck,
  ShoppingCart, Receipt, Search, AlertCircle, CheckCircle2, Clock, Ban,
  ChevronRight, Package, Truck, RotateCcw, Filter, Calendar, Building2,
  User, Edit3, Check, ChevronsUpDown, X as XIcon, ShieldAlert, ShieldCheck, ShieldOff,
  AlertTriangle, TrendingUp, Info, Wallet, Sparkles,
} from "lucide-react";
import { format, isAfter, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { ExportButton } from "@/components/ExportButton";
import { PdfButton } from "@/components/PdfButton";
import { generateSalePdf, generateSaleTicketPdf } from "@/lib/pdf-generator";
import { useGetCompanySettings } from "@workspace/api-client-react";

type LineItem = { productId: number; productName: string; quantity: string; unitPrice: string; discount: string };
type DocTab = "all" | "draft" | "quotation" | "order" | "sale" | "comptoir";

function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

// ── Metadata ─────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; fem?: boolean; color: string; bg: string; icon: React.ReactNode; desc: string }> = {
  draft:     { label: "Brouillon",        fem: false, color: "bg-slate-100 text-slate-700 border-slate-200",    bg: "bg-slate-50",    icon: <FileText className="h-3.5 w-3.5" />,    desc: "Document temporaire modifiable" },
  quotation: { label: "Devis",            fem: false, color: "bg-violet-100 text-violet-700 border-violet-200", bg: "bg-violet-50",   icon: <FileCheck className="h-3.5 w-3.5" />,   desc: "Offre commerciale envoyée au client" },
  order:     { label: "Commande",         fem: true,  color: "bg-blue-100 text-blue-700 border-blue-200",       bg: "bg-blue-50",     icon: <ShoppingCart className="h-3.5 w-3.5" />, desc: "Commande confirmée à préparer" },
  sale:      { label: "Facture proforma", fem: true,  color: "bg-emerald-100 text-emerald-700 border-emerald-200", bg: "bg-emerald-50", icon: <Receipt className="h-3.5 w-3.5" />, desc: "Vente finalisée avec implications de paiement" },
  comptoir:  { label: "Comptoire",        fem: true,  color: "bg-orange-100 text-orange-700 border-orange-200",  bg: "bg-orange-50",   icon: <ShoppingCart className="h-3.5 w-3.5" />, desc: "Vente directe en caisse POS" },
};

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active:              { label: "Actif",            color: "bg-sky-100 text-sky-700",         icon: <Clock className="h-3 w-3" /> },
  pending:             { label: "En attente",        color: "bg-amber-100 text-amber-700",     icon: <Clock className="h-3 w-3" /> },
  approved:            { label: "Approuvé",          color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected:            { label: "Refusé",            color: "bg-red-100 text-red-700",         icon: <Ban className="h-3 w-3" /> },
  expired:             { label: "Expiré",            color: "bg-gray-100 text-gray-500",       icon: <Clock className="h-3 w-3" /> },
  converted:           { label: "Converti",          color: "bg-indigo-100 text-indigo-700",   icon: <ArrowRight className="h-3 w-3" /> },
  confirmed:           { label: "Confirmée",         color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="h-3 w-3" /> },
  in_preparation:      { label: "En préparation",    color: "bg-amber-100 text-amber-700",     icon: <Package className="h-3 w-3" /> },
  ready:               { label: "Prête",             color: "bg-teal-100 text-teal-700",       icon: <CheckCircle2 className="h-3 w-3" /> },
  delivered:           { label: "Livrée",            color: "bg-emerald-100 text-emerald-700", icon: <Truck className="h-3 w-3" /> },
  partially_fulfilled: { label: "Part. livrée",      color: "bg-orange-100 text-orange-700",   icon: <AlertCircle className="h-3 w-3" /> },
  cancelled:           { label: "Annulé",            color: "bg-red-100 text-red-700",         icon: <Ban className="h-3 w-3" /> },
  refunded:            { label: "Remboursé",         color: "bg-gray-100 text-gray-500",       icon: <RotateCcw className="h-3 w-3" /> },
};

const PAY_STATUS_META: Record<string, { label: string; color: string }> = {
  unpaid:         { label: "Impayée",     color: "bg-red-100 text-red-700" },
  partially_paid: { label: "Part. payée", color: "bg-amber-100 text-amber-700" },
  paid:           { label: "Payée",       color: "bg-emerald-100 text-emerald-700" },
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Espèces", card: "Carte", transfer: "Virement", credit: "Crédit"
};

const STATUS_FILTERS: Record<DocTab, { value: string; label: string }[]> = {
  all:       [],
  draft:     [{ value: "active", label: "Actifs" }, { value: "converted", label: "Convertis" }, { value: "cancelled", label: "Annulés" }],
  quotation: [{ value: "pending", label: "En attente" }, { value: "approved", label: "Approuvés" }, { value: "rejected", label: "Refusés" }, { value: "expired", label: "Expirés" }, { value: "converted", label: "Convertis" }],
  order:     [{ value: "pending", label: "En attente" }, { value: "in_preparation", label: "En préparation" }, { value: "ready", label: "Prêtes" }, { value: "delivered", label: "Livrées" }, { value: "partially_fulfilled", label: "Part. livrées" }, { value: "cancelled", label: "Annulées" }],
  sale:      [{ value: "confirmed", label: "Confirmées" }, { value: "cancelled", label: "Annulées" }],
  comptoir:  [{ value: "confirmed", label: "Confirmées" }, { value: "cancelled", label: "Annulées" }],
};

const CONVERSIONS: Record<string, { targetType: string; label: string; color: string }[]> = {
  draft:     [
    { targetType: "quotation", label: "Publier comme Devis",    color: "border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100" },
    { targetType: "order",     label: "Publier comme Commande", color: "border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100" },
    { targetType: "sale",      label: "Facturer directement",   color: "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100" },
  ],
  quotation: [
    { targetType: "order",     label: "Convertir en Commande", color: "border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100" },
    { targetType: "sale",      label: "Convertir en Facture",  color: "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100" },
  ],
  order:     [
    { targetType: "sale",      label: "Facturer cette commande", color: "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100" },
  ],
  sale: [],
};

// ── Badges ────────────────────────────────────────────────────────────────────

function TypeBadge({ type, fulfillmentType }: { type: string; fulfillmentType?: string }) {
  const key = (type === "sale" && fulfillmentType === "pos") ? "comptoir" : type;
  const m = TYPE_META[key] ?? { label: type, color: "bg-gray-100 text-gray-700", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${m.color}`}>
      {m.icon}{m.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: "bg-gray-100 text-gray-600", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.color}`}>
      {m.icon}{m.label}
    </span>
  );
}

function PayBadge({ status }: { status: string }) {
  const m = PAY_STATUS_META[status] ?? { label: status, color: "bg-gray-100 text-gray-600" };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${m.color}`}>{m.label}</span>;
}

// ── Payment Progress Bar ──────────────────────────────────────────────────────

function PaymentProgress({ paid, total }: { paid: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Payé: {formatDA(paid)}</span>
        <span>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

// ── Credit types ────────────────────────────────────────────────────────────
type CreditState = "no_limit" | "ok" | "warning" | "exceeded";
interface CreditStatus {
  creditLimit: number | null;
  unpaidBalance: number;
  projectedBalance: number;
  remainingCredit: number | null;
  usagePercent: number | null;
  projectedUsagePercent: number | null;
  state: CreditState;
  canOverride: boolean;
}

function creditLabel(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

function CreditStatusPanel({ credit, amount }: { credit: CreditStatus; amount: number }) {
  const { state, creditLimit, unpaidBalance, projectedBalance, remainingCredit, projectedUsagePercent } = credit;

  if (state === "no_limit") return null;

  const pct = Math.min(100, projectedUsagePercent ?? 0);
  const barColor = state === "exceeded" ? "bg-red-500" : state === "warning" ? "bg-amber-500" : "bg-emerald-500";
  const borderColor = state === "exceeded" ? "border-red-200 bg-red-50" : state === "warning" ? "border-amber-200 bg-amber-50" : "border-emerald-100 bg-emerald-50/60";
  const icon =
    state === "exceeded" ? <ShieldOff className="h-4 w-4 text-red-500 shrink-0" /> :
    state === "warning"  ? <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" /> :
                           <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />;
  const label =
    state === "exceeded" ? "Limite de crédit dépassée" :
    state === "warning"  ? "Crédit presque épuisé" :
                           "Crédit disponible";

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${borderColor}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold">{label}</span>
        {state === "exceeded" && !credit.canOverride && (
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-red-600 bg-red-100 px-2 py-0.5 rounded-full">Bloqué</span>
        )}
        {state === "exceeded" && credit.canOverride && (
          <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Autorisation requise</span>
        )}
      </div>

      <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex justify-between col-span-1">
          <span className="text-muted-foreground">Limite accordée</span>
          <span className="font-medium">{creditLabel(creditLimit!)}</span>
        </div>
        <div className="flex justify-between col-span-1">
          <span className="text-muted-foreground">En cours impayé</span>
          <span className="font-medium">{creditLabel(unpaidBalance)}</span>
        </div>
        {amount > 0 && (
          <div className="flex justify-between col-span-1">
            <span className="text-muted-foreground">Cette facture</span>
            <span className="font-medium">{creditLabel(amount)}</span>
          </div>
        )}
        <div className="flex justify-between col-span-1">
          <span className="text-muted-foreground">Solde projeté</span>
          <span className={`font-semibold ${state === "exceeded" ? "text-red-600" : state === "warning" ? "text-amber-700" : "text-emerald-700"}`}>
            {creditLabel(projectedBalance)}
          </span>
        </div>
        <div className="flex justify-between col-span-1">
          <span className="text-muted-foreground">Disponible restant</span>
          <span className={`font-semibold ${(remainingCredit ?? 0) <= 0 ? "text-red-600" : "text-emerald-700"}`}>
            {remainingCredit != null && remainingCredit > 0 ? creditLabel(remainingCredit) : "0 DA"}
          </span>
        </div>
        <div className="flex justify-between col-span-1">
          <span className="text-muted-foreground">Utilisation</span>
          <span className="font-medium">{Math.round(projectedUsagePercent ?? 0)}%</span>
        </div>
      </div>

      {state === "exceeded" && !credit.canOverride && (
        <p className="text-xs text-red-700 bg-red-100 rounded-lg px-3 py-2">
          La création de cette facture est bloquée. Contactez un gérant ou l'administrateur pour débloquer.
        </p>
      )}
      {state === "exceeded" && credit.canOverride && (
        <p className="text-xs text-amber-800 bg-amber-100 rounded-lg px-3 py-2">
          En tant que gérant, vous pouvez autoriser cette facture malgré le dépassement. Une confirmation et un motif seront requis.
        </p>
      )}
      {state === "warning" && (
        <p className="text-xs text-amber-700 bg-amber-100/60 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Le crédit disponible est presque épuisé. La facture peut être créée, mais surveillez ce compte.
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
export default function Sales() {
  const qc = useQueryClient();

  // ── UI state
  const [tab, setTab] = useState<DocTab>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"type" | "form">("type");
  const [detailDoc, setDetailDoc] = useState<Sale | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState<Sale | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  // ── Create form state
  const [form, setForm] = useState({
    type: "draft" as string,
    customerId: "none",
    branchId: "",
    discount: "0",
    tax: "0",
    shippingFee: "0",
    notes: "",
    promisedDate: "",
    promisedTime: "",
    dueDate: "",
    paymentMethod: "cash",
    initialDeposit: "0",
  });
  const [items, setItems] = useState<LineItem[]>([]);
  const [newItem, setNewItem] = useState({ productId: "", quantity: "1", unitPrice: "", discount: "0" });
  const [payForm, setPayForm] = useState({ amount: "", method: "cash", date: format(new Date(), "yyyy-MM-dd"), notes: "" });

  // ── Quick add client state
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClientFirstName, setQuickClientFirstName] = useState("");
  const [quickClientLastName, setQuickClientLastName] = useState("");
  const [quickClientPhone, setQuickClientPhone] = useState("");
  const [quickClientEmail, setQuickClientEmail] = useState("");
  const [quickClientSaving, setQuickClientSaving] = useState(false);

  // ── Combobox open states
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [productComboOpen, setProductComboOpen] = useState(false);
  const [catComboOpen, setCatComboOpen] = useState(false);
  const [productCatFilter, setProductCatFilter] = useState<string>("");

  // ── Credit enforcement state
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [pendingConvertType, setPendingConvertType] = useState<string | null>(null);

  // ── Helper: token header
  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` });

  // ── Paginated sales list (server-side)
  const salesQueryKey = ["sales-paginated", tab, statusFilter, branchFilter, search, page];
  const { data: salesPage, isLoading } = useQuery<{ data: any[]; total: number; page: number; totalPages: number }>({
    queryKey: salesQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (tab !== "all") params.set("type", tab);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (branchFilter !== "all") params.set("branchId", branchFilter);
      if (search.trim()) params.set("search", search.trim());
      const r = await fetch(`/api/sales?${params}`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur chargement ventes");
      return r.json();
    },
    staleTime: 15_000,
  });
  const displayedSales = salesPage?.data ?? [];
  const totalDocs = salesPage?.total ?? 0;
  const totalPages = salesPage?.totalPages ?? 1;

  // ── Tab counts (separate lightweight query)
  const countsQueryKey = ["sales-counts", branchFilter];
  const { data: counts = { all: 0, draft: 0, quotation: 0, order: 0, sale: 0, comptoir: 0 } } = useQuery<Record<string, number>>({
    queryKey: countsQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchFilter !== "all") params.set("branchId", branchFilter);
      const r = await fetch(`/api/sales/counts?${params}`, { headers: authHeader() });
      if (!r.ok) return { all: 0, draft: 0, quotation: 0, order: 0, sale: 0, comptoir: 0 };
      return r.json();
    },
    staleTime: 30_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["sales-paginated"] });
    qc.invalidateQueries({ queryKey: ["sales-counts"] });
  }

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [tab, statusFilter, branchFilter, search]);

  // ── Fetch full sale detail on row click
  const [detailLoading, setDetailLoading] = useState(false);
  async function openDetail(s: any) {
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/sales/${s.id}`, { headers: authHeader() });
      if (r.ok) setDetailDoc(await r.json());
      else setDetailDoc(s);
    } catch { setDetailDoc(s); }
    finally { setDetailLoading(false); }
  }

  const { data: customers = [] } = useGetContacts({ type: "customer" });
  const { data: branches = [] } = useGetBranches();
  const { data: products = [] } = useGetProducts({});
  const { data: units = [] } = useGetUnits();
  const { data: categories = [] } = useGetCategories();
  const unitDecimalsMap = useMemo(() => Object.fromEntries(units.map(u => [u.id, u.allowDecimals])), [units]);
  const selectedProduct = useMemo(() => products.find(p => p.id === parseInt(newItem.productId)), [products, newItem.productId]);
  const qtyAllowsDecimals = selectedProduct ? (unitDecimalsMap[(selectedProduct as any).unitId] ?? true) : true;

  async function createQuickClient() {
    const firstName = quickClientFirstName.trim();
    const lastName = quickClientLastName.trim();
    const phone = quickClientPhone.trim();
    const email = quickClientEmail.trim();
    if (!firstName || !lastName || !phone || !email) return;
    setQuickClientSaving(true);
    try {
      const token = localStorage.getItem("erp_token") ?? "";
      const displayName = `${firstName} ${lastName}`;
      const r = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "customer", displayName, phone, email, status: "active" }),
      });
      const contact = await r.json();
      if (!r.ok) { toast({ title: contact.error ?? "Erreur", variant: "destructive" }); return; }
      qc.invalidateQueries({ queryKey: ["/api/contacts"] });
      setForm(f => ({ ...f, customerId: String(contact.id) }));
      setQuickClientOpen(false);
      setQuickClientFirstName("");
      setQuickClientLastName("");
      setQuickClientPhone("");
      setQuickClientEmail("");
      toast({ title: `Client "${contact.displayName}" ajouté` });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setQuickClientSaving(false);
    }
  }

  // ── Credit status for invoice creation form ──────────────────────────────
  const isInvoiceForm = form.type === "sale" && form.customerId !== "none";
  const createTotal = useMemo(() => {
    const sub = items.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0") - parseFloat(i.discount || "0"), 0);
    return sub - parseFloat(form.discount || "0") + parseFloat(form.tax || "0") + parseFloat(form.shippingFee || "0");
  }, [items, form.discount, form.tax, form.shippingFee]);

  const { data: creditStatus } = useQuery<CreditStatus | null>({
    queryKey: ["credit-status", form.customerId, Math.round(createTotal)],
    queryFn: async () => {
      if (!isInvoiceForm) return null;
      const token = localStorage.getItem("erp_token") ?? "";
      const r = await fetch(`/api/contacts/${form.customerId}/credit-status?amount=${Math.round(createTotal)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: isInvoiceForm,
    staleTime: 5000,
  });

  // Credit status for convert flow (open detail doc)
  const convertAmount = detailDoc ? parseFloat(detailDoc.total as string || "0") : 0;
  const convertCustomerId = detailDoc?.customerId ?? null;
  const { data: convertCreditStatus } = useQuery<CreditStatus | null>({
    queryKey: ["credit-status-convert", convertCustomerId, Math.round(convertAmount)],
    queryFn: async () => {
      if (!convertCustomerId) return null;
      const token = localStorage.getItem("erp_token") ?? "";
      const r = await fetch(`/api/contacts/${convertCustomerId}/credit-status?amount=${Math.round(convertAmount)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!convertCustomerId && !!detailDoc && detailDoc.type !== "sale",
    staleTime: 5000,
  });

  // ── Company settings (for PDF generation)
  const { data: companySettings } = useGetCompanySettings();


  // ── Mutations
  const createMutation = useCreateSale({ mutation: {
    onSuccess: () => { invalidate(); setCreateOpen(false); setItems([]); toast({ title: "Document créé" }); },
    onError: (e: any) => {
      const errData: any = e?.data ?? {};
      if (errData.error === "stock_insufficient") {
        toast({ title: "Rupture de stock", description: errData.message ?? "Stock insuffisant", variant: "destructive" });
        const pid: number | undefined = errData.productId;
        const avail: number = errData.available ?? 0;
        if (pid !== undefined) setItems(c => c.map(i => i.productId === pid ? { ...i, quantity: String(Math.min(parseFloat(i.quantity), avail)) } : i).filter(i => parseFloat(i.quantity) > 0));
      } else if (errData.error === "credit_exceeded") {
        setOverrideOpen(true);
      } else {
        toast({ title: "Erreur création", description: errData.error ?? errData.message ?? e?.message ?? "Erreur inconnue", variant: "destructive" });
      }
    }
  } });
  const updateMutation = useUpdateSale({ mutation: { onSuccess: (data) => { invalidate(); setDetailDoc(data); setEditingNotes(false); } } });
  const payMutation = useAddSalePayment({ mutation: { onSuccess: (data) => { invalidate(); setPayOpen(false); setDetailDoc(data); toast({ title: "Paiement enregistré" }); } } });
  const convertMutation = useConvertSaleDocument({ mutation: { onSuccess: (data) => { invalidate(); setDetailDoc(null); toast({ title: `Converti en ${TYPE_META[data.type]?.label ?? data.type}`, description: data.reference }); } } });
  const cancelMutation = useCancelSaleDocument({ mutation: { onSuccess: (data) => { invalidate(); setCancelConfirm(null); setDetailDoc(data); toast({ title: "Document annulé" }); } } });
  const duplicateMutation = useDuplicateSaleDocument({ mutation: { onSuccess: (data) => { invalidate(); toast({ title: "Copie créée", description: `Brouillon ${data.reference}` }); } } });

  function changeTab(t: DocTab) {
    setTab(t);
    setStatusFilter("all");
    setPage(1);
  }

  function openCreate(type: string) {
    setForm({ type, customerId: "none", branchId: "", discount: "0", tax: "0", shippingFee: "0", notes: "", promisedDate: "", promisedTime: "", dueDate: "", paymentMethod: "cash", initialDeposit: "0" });
    setItems([]);
    setNewItem({ productId: "", quantity: "1", unitPrice: "", discount: "0" });
    setCreateStep("form");
    setCreateOpen(true);
  }

  function selectProduct(id: string) {
    const p = products.find(p => p.id === parseInt(id));
    if (p) {
      const allows = unitDecimalsMap[(p as any).unitId] ?? true;
      setNewItem(n => ({ ...n, productId: id, unitPrice: p.sellingPrice.toString(), quantity: allows ? n.quantity : String(Math.max(1, Math.round(parseFloat(n.quantity) || 1))) }));
    }
  }

  function addItem() {
    if (!newItem.productId || !newItem.quantity || !newItem.unitPrice) return;
    const product = products.find(p => p.id === parseInt(newItem.productId));
    if (!product) return;
    const existing = items.findIndex(i => i.productId === parseInt(newItem.productId));
    if (existing >= 0) {
      const updated = [...items];
      updated[existing] = { ...updated[existing], quantity: (parseFloat(updated[existing].quantity) + parseFloat(newItem.quantity)).toString() };
      setItems(updated);
    } else {
      setItems(i => [...i, { productId: parseInt(newItem.productId), productName: product.name, quantity: newItem.quantity, unitPrice: newItem.unitPrice, discount: newItem.discount }]);
    }
    setNewItem({ productId: "", quantity: "1", unitPrice: "", discount: "0" });
  }

  const subtotal = items.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0") - parseFloat(i.discount || "0"), 0);
  const discountVal = parseFloat(form.discount || "0");
  const taxVal = parseFloat(form.tax || "0");
  const shippingVal = parseFloat(form.shippingFee || "0");
  const total = subtotal - discountVal + taxVal + shippingVal;

  function submitCreate(overrideReasonArg?: string) {
    if (form.type === "sale" && creditStatus?.state === "exceeded") {
      if (!creditStatus.canOverride) {
        toast({ title: "Facture bloquée", description: "La limite de crédit est dépassée. Contactez un gérant.", variant: "destructive" });
        return;
      }
      if (!overrideReasonArg) {
        setOverrideOpen(true);
        return;
      }
    }
    createMutation.mutate({
      data: {
        type: form.type as any,
        customerId: form.customerId && form.customerId !== "none" ? parseInt(form.customerId) : null,
        branchId: parseInt(form.branchId),
        discount: discountVal, tax: taxVal, shippingFee: shippingVal,
        notes: form.notes || null,
        promisedDate: form.promisedDate ? (form.promisedTime ? `${form.promisedDate}T${form.promisedTime}` : form.promisedDate) : null,
        dueDate: form.dueDate || null,
        paymentMethod: form.type === "sale" ? form.paymentMethod : undefined,
        initialDeposit: form.type === "order" ? parseFloat(form.initialDeposit || "0") : undefined,
        items: items.map(i => ({ productId: i.productId, quantity: parseFloat(i.quantity), unitPrice: parseFloat(i.unitPrice), discount: parseFloat(i.discount) })),
        creditOverrideReason: overrideReasonArg ?? null,
      } as any
    });
  }

  function submitOverride() {
    if (!overrideReason.trim()) return;
    submitCreate(overrideReason.trim());
    setOverrideOpen(false);
    setOverrideReason("");
  }

  function doConvert(targetType: string, overrideReasonArg?: string) {
    if (!detailDoc) return;
    if (targetType === "sale" && convertCreditStatus?.state === "exceeded") {
      if (!convertCreditStatus.canOverride) {
        toast({ title: "Conversion bloquée", description: "La limite de crédit est dépassée. Contactez un gérant.", variant: "destructive" });
        return;
      }
      if (!overrideReasonArg) {
        setPendingConvertType(targetType);
        setOverrideOpen(true);
        return;
      }
    }
    convertMutation.mutate({ id: detailDoc.id, data: { targetType, creditOverrideReason: overrideReasonArg ?? null } as any });
  }

  function submitConvertOverride() {
    if (!overrideReason.trim() || !pendingConvertType) return;
    doConvert(pendingConvertType, overrideReason.trim());
    setOverrideOpen(false);
    setOverrideReason("");
    setPendingConvertType(null);
  }

  function updateStatus(newStatus: string) {
    if (!detailDoc) return;
    updateMutation.mutate({ id: detailDoc.id, data: { status: newStatus } });
  }

  function saveNotes() {
    if (!detailDoc) return;
    updateMutation.mutate({ id: detailDoc.id, data: { notes: noteDraft } }, {
      onSuccess: (data) => { setDetailDoc(data); setEditingNotes(false); toast({ title: "Notes mises à jour" }); }
    });
  }

  const canConvert = detailDoc && !["cancelled", "converted"].includes(detailDoc.status);
  const canCancel  = detailDoc && !["cancelled", "converted", "refunded"].includes(detailDoc.status);
  const conversions = detailDoc ? (CONVERSIONS[detailDoc.type] ?? []) : [];
  const statusFilters = STATUS_FILTERS[tab];

  // ── Derived detail values
  const detailPaid = detailDoc ? parseFloat(detailDoc.paid as string || "0") : 0;
  const detailTotal = detailDoc ? parseFloat(detailDoc.total as string || "0") : 0;
  const detailCreditApplied = detailDoc ? parseFloat((detailDoc as any).creditApplied as string || "0") : 0;
  const detailDue = detailTotal - detailPaid - detailCreditApplied;

  // ── Wallet credit for this sale's customer
  const [applyingWalletCredit, setApplyingWalletCredit] = useState(false);
  const [walletCreditInput, setWalletCreditInput] = useState("");
  const { data: saleCustomerWallet, refetch: refetchWallet } = useQuery<{ available: number } | null>({
    queryKey: ["customer-wallet", detailDoc?.customerId],
    queryFn: async () => {
      if (!detailDoc?.customerId) return null;
      const r = await fetch(`/api/customers/${detailDoc.customerId}/credit`, { headers: { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` } });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!detailDoc?.customerId && detailDoc?.type === "sale",
    staleTime: 30_000,
  });

  async function doApplyWalletCredit() {
    if (!detailDoc) return;
    const amt = parseFloat(walletCreditInput) || (saleCustomerWallet?.available ?? 0);
    if (!amt || amt <= 0) return;
    setApplyingWalletCredit(true);
    try {
      const r = await fetch(`/api/sales/${detailDoc.id}/apply-credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` },
        body: JSON.stringify({ amount: amt }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      toast({ title: "Crédit appliqué", description: `${formatDA(data.appliedAmount)} de crédit client appliqué sur la vente.` });
      setWalletCreditInput("");
      invalidate();
      refetchWallet();
      if (detailDoc) {
        const saleR = await fetch(`/api/sales/${detailDoc.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` } });
        if (saleR.ok) setDetailDoc(await saleR.json());
      }
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setApplyingWalletCredit(false); }
  }

  // ── Order status workflow steps
  const ORDER_FLOW = [
    { key: "pending", label: "Reçue", icon: Clock },
    { key: "in_preparation", label: "Préparation", icon: Package },
    { key: "ready", label: "Prête", icon: CheckCircle2 },
    { key: "delivered", label: "Livrée", icon: Truck },
  ];
  const orderFlowIndex = (s: string) => ORDER_FLOW.findIndex(f => f.key === s);

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold">Documents de vente</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Brouillons, devis, commandes et factures</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButton
            endpoint="export/sales"
            params={{
              type: tab !== "all" ? tab : undefined,
              status: statusFilter !== "all" ? statusFilter : undefined,
              branchId: branchFilter !== "all" ? branchFilter : undefined,
            }}
            label="Exporter"
          />
          <Button onClick={() => { setCreateStep("type"); setCreateOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" />Créer une vente
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="space-y-3">
        <Tabs value={tab} onValueChange={v => changeTab(v as DocTab)}>
          <TabsList className="h-9 gap-0.5">
            {([
              ["all", "Tous"],
              ["draft", "Brouillons"],
              ["quotation", "Devis"],
              ["order", "Commandes"],
              ["sale", "Factures proforma"],
              ["comptoir", "Comptoire"],
            ] as const).map(([v, label]) => (
              <TabsTrigger key={v} value={v} className="text-xs px-3 gap-1.5">
                {label}
                <span className={`inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full text-[10px] font-bold ${tab === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {counts[v]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* ── Status sub-filters ── */}
        <div className="flex flex-wrap items-center gap-2">
          {statusFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === "all" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
              >
                Tous
              </button>
              {statusFilters.map(sf => (
                <button
                  key={sf.value}
                  onClick={() => setStatusFilter(sf.value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === sf.value ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"}`}
                >
                  {sf.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {/* Branch filter */}
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="h-8 w-40 text-xs gap-1">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Boutique" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les boutiques</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-8 h-8 w-52 text-xs" placeholder="Réf., client..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{totalDocs} doc{totalDocs !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>

      {/* ── Document Table ── */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-32">Référence</TableHead>
                {tab === "all" && <TableHead>Type</TableHead>}
                <TableHead>Statut</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Boutique</TableHead>
                <TableHead>Créé par</TableHead>
                <TableHead>Date</TableHead>
                {(tab === "order") && <TableHead>Échéance</TableHead>}
                <TableHead className="text-right">Total</TableHead>
                {(tab === "sale" || tab === "all") && <TableHead>Paiement</TableHead>}
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                      <span className="text-sm">Chargement...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : displayedSales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileText className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Aucun document trouvé</p>
                      <Button variant="outline" size="sm" onClick={() => { setCreateStep("type"); setCreateOpen(true); }} className="mt-1 gap-1.5">
                        <Plus className="h-3.5 w-3.5" />Créer une vente
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : displayedSales.map(s => (
                <TableRow
                  key={s.id}
                  className={`cursor-pointer hover:bg-muted/40 transition-colors ${s.status === "cancelled" ? "opacity-50" : ""}`}
                  onClick={() => openDetail(s)}
                >
                  <TableCell className="font-mono text-xs font-semibold tracking-wide">{s.reference}</TableCell>
                  {tab === "all" && <TableCell><TypeBadge type={s.type} fulfillmentType={(s as any).fulfillmentType} /></TableCell>}
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell className="text-sm">
                    {s.customerName ?? <span className="text-muted-foreground italic text-xs">Comptoir</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.branchName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {(s as any).createdByName
                      ? <span className="flex items-center gap-1"><span className="inline-flex h-5 w-5 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold items-center justify-center shrink-0">{((s as any).createdByName as string).charAt(0).toUpperCase()}</span>{(s as any).createdByName}</span>
                      : <span className="italic text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(s.createdAt), "dd MMM yy", { locale: fr })}
                  </TableCell>
                  {tab === "order" && (
                    <TableCell className="text-sm text-muted-foreground">
                      {s.promisedDate
                        ? <span className={isAfter(new Date(), parseISO(s.promisedDate)) && !["delivered","cancelled"].includes(s.status) ? "text-red-600 font-medium" : ""}>
                            {s.promisedDate.includes("T") ? format(parseISO(s.promisedDate), "dd/MM/yy HH:mm") : format(parseISO(s.promisedDate), "dd/MM/yy")}
                          </span>
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right text-sm font-semibold">{formatDA(parseFloat(s.total as string))}</TableCell>
                  {(tab === "sale" || tab === "all") && (
                    <TableCell>
                      {s.type === "sale"
                        ? <PayBadge status={s.paymentStatus} />
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  )}
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex gap-0.5 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetail(s)}>
                        <Eye className="h-3.5 w-3.5" />
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Page {page} / {totalPages} — {totalDocs} documents
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page <= 1} onClick={() => setPage(1)}>«</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Précédent</Button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) p = i + 1;
              else if (page <= 4) p = i + 1;
              else if (page >= totalPages - 3) p = totalPages - 6 + i;
              else p = page - 3 + i;
              return (
                <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className="h-7 w-7 p-0 text-xs"
                  onClick={() => setPage(p)}>{p}</Button>
              );
            })}
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Suivant ›</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</Button>
          </div>
        </div>
      )}

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={v => { setCreateOpen(v); if (!v) setCreateStep("type"); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          {createStep === "type" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-serif">Nouveau document de vente</DialogTitle>
                <DialogDescription>Choisissez le type de document à créer</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-2">
                {(["draft", "quotation", "order", "sale"] as const).map(t => {
                  const m = TYPE_META[t];
                  return (
                    <button key={t} onClick={() => openCreate(t)}
                      className="flex flex-col items-start gap-2.5 p-4 border-2 rounded-xl hover:border-primary/40 hover:bg-muted/40 transition-all text-left group"
                    >
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${m.color}`}>
                        {m.icon}{m.label}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
                      <div className="flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                        Créer <ChevronRight className="h-3 w-3" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <TypeBadge type={form.type} />
                  {TYPE_META[form.type]?.fem ? "Nouvelle" : "Nouveau"} {TYPE_META[form.type]?.label ?? form.type}
                </DialogTitle>
                <DialogDescription>
                  <button className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setCreateStep("type")}>
                    ← Changer de type
                  </button>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium">Client</Label>
                    <div className="flex gap-1 mt-1">
                      <Popover open={clientComboOpen} onOpenChange={setClientComboOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="h-9 flex-1 justify-between font-normal text-sm">
                            <span className="truncate">
                              {form.customerId === "none" || !form.customerId
                                ? "Comptoir (sans client)"
                                : customers.find(c => String(c.id) === form.customerId)?.displayName ?? "Comptoir (sans client)"}
                            </span>
                            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-64" align="start">
                          <Command>
                            <CommandInput placeholder="Rechercher un client..." className="h-9" />
                            <CommandList>
                              <CommandEmpty>Aucun client trouvé.</CommandEmpty>
                              <CommandGroup>
                                <CommandItem value="none" onSelect={() => { setForm(f => ({ ...f, customerId: "none" })); setClientComboOpen(false); }}>
                                  <Check className={`mr-2 h-4 w-4 ${form.customerId === "none" || !form.customerId ? "opacity-100" : "opacity-0"}`} />
                                  Comptoir (sans client)
                                </CommandItem>
                                {customers.map(c => (
                                  <CommandItem key={c.id} value={c.displayName} onSelect={() => { setForm(f => ({ ...f, customerId: String(c.id) })); setClientComboOpen(false); }}>
                                    <Check className={`mr-2 h-4 w-4 ${form.customerId === String(c.id) ? "opacity-100" : "opacity-0"}`} />
                                    {c.displayName}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <Button
                        type="button" variant="outline" size="icon"
                        className="h-9 w-9 shrink-0"
                        title="Nouveau client"
                        onClick={() => { setQuickClientFirstName(""); setQuickClientLastName(""); setQuickClientPhone(""); setQuickClientEmail(""); setQuickClientOpen(true); }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Boutique *</Label>
                    <Select value={form.branchId} onValueChange={v => setForm(f => ({ ...f, branchId: v }))}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Choisir..." /></SelectTrigger>
                      <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Items table */}
                <div className="border rounded-xl overflow-hidden">
                  <div className="bg-muted/40 px-4 py-2.5 border-b flex items-center justify-between">
                    <p className="text-sm font-semibold">Articles</p>
                    <span className="text-xs text-muted-foreground">{items.length} article{items.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="p-3 space-y-2">
                    {items.length > 0 && (
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="text-xs py-1.5">Produit</TableHead>
                            <TableHead className="text-xs py-1.5 w-16 text-right">Qté</TableHead>
                            <TableHead className="text-xs py-1.5 w-28 text-right">Prix unit.</TableHead>
                            <TableHead className="text-xs py-1.5 w-28 text-right">Total</TableHead>
                            <TableHead className="w-8 py-1.5"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item, i) => (
                            <TableRow key={i} className="hover:bg-muted/20">
                              <TableCell className="text-sm py-2">{item.productName}</TableCell>
                              <TableCell className="text-sm py-2 text-right">{item.quantity}</TableCell>
                              <TableCell className="text-sm py-2 text-right">{formatDA(parseFloat(item.unitPrice))}</TableCell>
                              <TableCell className="text-sm py-2 text-right font-semibold">
                                {formatDA(parseFloat(item.quantity) * parseFloat(item.unitPrice) - parseFloat(item.discount))}
                              </TableCell>
                              <TableCell className="py-2">
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                                  <XCircle className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    {/* Category filter — separate row above product */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Catégorie</Label>
                      <Popover open={catComboOpen} onOpenChange={setCatComboOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="w-full h-8 justify-between font-normal text-sm">
                            <span className="truncate">
                              {productCatFilter === ""
                                ? "Toutes les catégories"
                                : productCatFilter === "none"
                                  ? "Sans catégorie"
                                  : categories.find(c => String(c.id) === productCatFilter)?.name ?? "Toutes les catégories"}
                            </span>
                            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50 ml-1" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-80" align="start">
                          <Command>
                            <CommandInput placeholder="Rechercher une catégorie..." className="h-9" />
                            <div style={{ maxHeight: "14rem", overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
                              <CommandList style={{ maxHeight: "none" }}>
                                <CommandEmpty>Aucune catégorie trouvée.</CommandEmpty>
                                <CommandGroup className="overflow-visible">
                                  <CommandItem value="all" onSelect={() => { setProductCatFilter(""); setNewItem(n => ({ ...n, productId: "", unitPrice: "" })); setCatComboOpen(false); }}>
                                    <Check className={`mr-2 h-4 w-4 ${productCatFilter === "" ? "opacity-100" : "opacity-0"}`} />
                                    Toutes les catégories
                                  </CommandItem>
                                  {categories.map(c => (
                                    <CommandItem key={c.id} value={c.name} onSelect={() => { setProductCatFilter(String(c.id)); setNewItem(n => ({ ...n, productId: "", unitPrice: "" })); setCatComboOpen(false); }}>
                                      <Check className={`mr-2 h-4 w-4 ${productCatFilter === String(c.id) ? "opacity-100" : "opacity-0"}`} />
                                      {c.name}
                                    </CommandItem>
                                  ))}
                                  <CommandItem value="none-sans-categorie" onSelect={() => { setProductCatFilter("none"); setNewItem(n => ({ ...n, productId: "", unitPrice: "" })); setCatComboOpen(false); }}>
                                    <Check className={`mr-2 h-4 w-4 ${productCatFilter === "none" ? "opacity-100" : "opacity-0"}`} />
                                    Sans catégorie
                                  </CommandItem>
                                </CommandGroup>
                              </CommandList>
                            </div>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex gap-2">
                      <Popover open={productComboOpen} onOpenChange={setProductComboOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="flex-1 h-8 justify-between font-normal text-sm">
                            <span className="truncate">
                              {newItem.productId
                                ? products.find(p => String(p.id) === newItem.productId)?.name ?? "Ajouter un produit..."
                                : "Ajouter un produit..."}
                            </span>
                            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50 ml-1" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-80" align="start">
                          <Command>
                            <CommandInput placeholder="Rechercher un produit..." className="h-9" />
                            <div style={{ maxHeight: "18rem", overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
                              <CommandList style={{ maxHeight: "none" }}>
                                <CommandEmpty>Aucun produit trouvé.</CommandEmpty>
                                <CommandGroup className="overflow-visible">
                                  {products
                                    .filter(p => p.isSellable && p.type === "finished")
                                    .filter(p => {
                                      if (!productCatFilter || productCatFilter === "all") return true;
                                      if (productCatFilter === "none") return !(p as any).categoryId;
                                      return String((p as any).categoryId) === productCatFilter;
                                    })
                                    .map(p => (
                                      <CommandItem key={p.id} value={p.name} onSelect={() => { selectProduct(String(p.id)); setProductComboOpen(false); }}>
                                        <Check className={`mr-2 h-4 w-4 ${newItem.productId === String(p.id) ? "opacity-100" : "opacity-0"}`} />
                                        <span className="flex-1">{p.name}</span>
                                        <span className="text-xs text-muted-foreground ml-2">{formatDA(parseFloat(p.sellingPrice as string))}</span>
                                      </CommandItem>
                                    ))}
                                </CommandGroup>
                              </CommandList>
                            </div>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <Input type="number" min={qtyAllowsDecimals ? "0.001" : "1"} step={qtyAllowsDecimals ? "0.001" : "1"} className="w-16 h-8 text-sm" placeholder="Qté" value={newItem.quantity} onChange={e => { const v = e.target.value; setNewItem(n => ({ ...n, quantity: qtyAllowsDecimals ? v : String(Math.max(1, Math.round(parseFloat(v) || 1))) })); }} />
                      <Input type="number" className="w-28 h-8 text-sm" placeholder="Prix unit." value={newItem.unitPrice} onChange={e => setNewItem(n => ({ ...n, unitPrice: e.target.value }))} />
                      <Button variant="outline" size="sm" className="h-8 px-3 gap-1" onClick={addItem}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Adjustments */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium">Remise globale (DA)</Label>
                    <Input type="number" className="mt-1 h-9 text-sm" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Livraison (DA)</Label>
                    <Input type="number" className="mt-1 h-9 text-sm" value={form.shippingFee} onChange={e => setForm(f => ({ ...f, shippingFee: e.target.value }))} />
                  </div>
                </div>

                {(form.type === "order" || form.type === "quotation") && (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs font-medium">Date de livraison</Label>
                      <Input type="date" className="mt-1 h-9 text-sm w-full" value={form.promisedDate} onChange={e => setForm(f => ({ ...f, promisedDate: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs font-medium">Heure de livraison</Label>
                      <Input type="time" className="mt-1 h-9 text-sm w-48" value={form.promisedTime} onChange={e => setForm(f => ({ ...f, promisedTime: e.target.value }))} />
                    </div>
                  </div>
                )}

                {form.type === "order" && (
                  <div>
                    <Label className="text-xs font-medium">Versement initial (DA)</Label>
                    <Input
                      type="number"
                      min="0"
                      className="mt-1 h-9 text-sm"
                      placeholder="0"
                      value={form.initialDeposit}
                      onChange={e => setForm(f => ({ ...f, initialDeposit: e.target.value }))}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Montant payé par le client à la commande (acompte)</p>
                  </div>
                )}

                {form.type === "sale" && (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs font-medium">Moyen de paiement</Label>
                      <Select value={form.paymentMethod} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v }))}>
                        <SelectTrigger className="mt-1 h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">💵 Espèces (Cash)</SelectItem>
                          <SelectItem value="card">💳 CIB / DAHABIA</SelectItem>
                          <SelectItem value="check">🧾 Chèque</SelectItem>
                          <SelectItem value="credit">🕐 Crédit (à terme)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.paymentMethod === "credit" && (
                      <div>
                        <Label className="text-xs font-medium">Échéance de paiement</Label>
                        <Input type="date" className="mt-1 h-9 text-sm w-48" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Label className="text-xs font-medium">Notes internes</Label>
                  <Textarea className="mt-1 text-sm min-h-[60px] resize-none" placeholder="Remarques, conditions particulières..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>

                {/* Summary */}
                {items.length > 0 && (
                  <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Sous-total</span><span>{formatDA(subtotal)}</span></div>
                    {discountVal > 0 && <div className="flex justify-between text-sm text-red-600"><span>Remise</span><span>−{formatDA(discountVal)}</span></div>}
                    {taxVal > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Taxes</span><span>+{formatDA(taxVal)}</span></div>}
                    {shippingVal > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Livraison</span><span>+{formatDA(shippingVal)}</span></div>}
                    <Separator />
                    <div className="flex justify-between font-bold"><span>Total</span><span className="text-base">{formatDA(total)}</span></div>
                    {form.type === "order" && parseFloat(form.initialDeposit || "0") > 0 && (() => {
                      const deposit = parseFloat(form.initialDeposit || "0");
                      const remaining = Math.max(0, total - deposit);
                      return (
                        <>
                          <Separator />
                          <div className="flex justify-between text-sm text-green-700"><span>Versement initial</span><span>−{formatDA(deposit)}</span></div>
                          <div className="flex justify-between text-sm font-semibold text-orange-600"><span>Reste à payer</span><span>{formatDA(remaining)}</span></div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Credit status panel — only for invoice type with a selected customer */}
                {isInvoiceForm && creditStatus && creditStatus.state !== "no_limit" && (
                  <CreditStatusPanel credit={creditStatus} amount={createTotal} />
                )}
                {isInvoiceForm && creditStatus?.state === "no_limit" && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    Aucune limite de crédit configurée pour ce client.
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
                <Button
                  onClick={() => submitCreate()}
                  disabled={
                    !form.branchId || items.length === 0 || createMutation.isPending ||
                    (isInvoiceForm && creditStatus?.state === "exceeded" && !creditStatus.canOverride)
                  }
                >
                  {createMutation.isPending ? "Création..." : `Créer ${TYPE_META[form.type]?.fem ? "la" : "le"} ${TYPE_META[form.type]?.label?.toLowerCase() ?? "document"}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Document Detail Sheet ── */}
      <Sheet open={!!detailDoc && !payOpen && !cancelConfirm} onOpenChange={v => { if (!v) { setDetailDoc(null); setEditingNotes(false); } }}>
        <SheetContent className="w-full sm:max-w-xl lg:max-w-2xl overflow-y-auto p-0">
          {detailDoc && (
            <>
              {/* Coloured header */}
              <div className={`p-6 border-b ${TYPE_META[(detailDoc.type === "sale" && (detailDoc as any).fulfillmentType === "pos") ? "comptoir" : detailDoc.type]?.bg ?? "bg-gray-50"}`}>
                <SheetHeader>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeBadge type={detailDoc.type} fulfillmentType={(detailDoc as any).fulfillmentType} />
                      <StatusBadge status={detailDoc.status} />
                      {detailDoc.type === "sale" && <PayBadge status={detailDoc.paymentStatus} />}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <SheetTitle className="font-mono text-2xl">{detailDoc.reference}</SheetTitle>
                      <div className="flex items-center gap-1 shrink-0">
                        <PdfButton
                          onGenerate={() => generateSaleTicketPdf(detailDoc, companySettings as any)}
                          label="Ticket"
                          size="sm"
                          variant="outline"
                        />
                        <PdfButton
                          onGenerate={() => generateSalePdf(detailDoc, companySettings as any)}
                          label="A4"
                          size="sm"
                          variant="outline"
                        />
                      </div>
                    </div>
                    <SheetDescription className="text-sm space-y-0.5">
                      <div>{detailDoc.customerName ?? <span className="italic">Comptoir (sans client)</span>}</div>
                      <div className="text-xs text-muted-foreground">
                        {detailDoc.branchName} · {format(new Date(detailDoc.createdAt), "dd MMMM yyyy", { locale: fr })}
                        {detailDoc.createdByName && ` · ${detailDoc.createdByName}`}
                      </div>
                    </SheetDescription>
                  </div>
                </SheetHeader>
              </div>

              <div className="p-6 space-y-6">

                {/* ── Order status progress bar ── */}
                {detailDoc.type === "order" && !["cancelled", "converted"].includes(detailDoc.status) && (
                  <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Progression commande</p>
                    <div className="flex items-center">
                      {ORDER_FLOW.map((step, i) => {
                        const idx = orderFlowIndex(detailDoc.status);
                        const done = i < idx;
                        const current = i === idx;
                        const StepIcon = step.icon;
                        return (
                          <div key={step.key} className="flex items-center flex-1 last:flex-none">
                            <div className={`flex flex-col items-center gap-1 min-w-[48px]`}>
                              <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 ${done ? "bg-primary border-primary" : current ? "border-primary bg-primary/10" : "border-muted-foreground/30 bg-muted"}`}>
                                <StepIcon className={`h-3.5 w-3.5 ${done ? "text-primary-foreground" : current ? "text-primary" : "text-muted-foreground/40"}`} />
                              </div>
                              <span className={`text-[10px] text-center leading-tight ${current ? "font-semibold text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/50"}`}>{step.label}</span>
                            </div>
                            {i < ORDER_FLOW.length - 1 && (
                              <div className={`flex-1 h-0.5 mb-5 mx-1 ${done ? "bg-primary" : "bg-muted"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Order action buttons */}
                    <div className="flex gap-2 flex-wrap">
                      {detailDoc.status === "pending" && (
                        <Button size="sm" className="gap-1.5 bg-amber-600 hover:bg-amber-700" onClick={() => updateStatus("in_preparation")} disabled={updateMutation.isPending}>
                          <Package className="h-3.5 w-3.5" />Démarrer la préparation
                        </Button>
                      )}
                      {detailDoc.status === "in_preparation" && (
                        <Button size="sm" className="gap-1.5 bg-teal-600 hover:bg-teal-700" onClick={() => updateStatus("ready")} disabled={updateMutation.isPending}>
                          <CheckCircle2 className="h-3.5 w-3.5" />Marquer comme prête
                        </Button>
                      )}
                      {detailDoc.status === "ready" && (
                        <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={() => updateStatus("delivered")} disabled={updateMutation.isPending}>
                          <Truck className="h-3.5 w-3.5" />Confirmer la livraison
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Quotation status actions ── */}
                {detailDoc.type === "quotation" && detailDoc.status === "pending" && (
                  <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Réponse client</p>
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={() => updateStatus("approved")} disabled={updateMutation.isPending}>
                        <Check className="h-3.5 w-3.5" />Devis approuvé
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50" onClick={() => updateStatus("rejected")} disabled={updateMutation.isPending}>
                        <XIcon className="h-3.5 w-3.5" />Devis refusé
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-gray-600" onClick={() => updateStatus("expired")} disabled={updateMutation.isPending}>
                        <Clock className="h-3.5 w-3.5" />Marquer expiré
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Invoice payment progress ── */}
                {detailDoc.type === "sale" && detailDoc.status !== "cancelled" && (
                  <div className="space-y-3">
                    <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Règlement</p>
                        <PayBadge status={detailDoc.paymentStatus} />
                      </div>
                      <PaymentProgress paid={detailPaid + detailCreditApplied} total={detailTotal} />
                      {detailCreditApplied > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground flex items-center gap-1"><Wallet className="h-3.5 w-3.5 text-violet-500" />Crédit portefeuille appliqué</span>
                          <span className="font-semibold text-violet-700">{formatDA(detailCreditApplied)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Reste dû</span>
                        <span className={`font-bold ${detailDue > 0 ? "text-red-600" : "text-emerald-600"}`}>{formatDA(Math.max(0, detailDue))}</span>
                      </div>
                      {detailDoc.paymentStatus !== "paid" && (
                        <Button className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => {
                          setPayOpen(true);
                          setPayForm({ amount: Math.max(0, detailDue).toString(), method: "cash", date: format(new Date(), "yyyy-MM-dd"), notes: "" });
                        }}>
                          <CreditCard className="h-4 w-4" />Enregistrer un paiement
                        </Button>
                      )}
                    </div>

                    {/* Wallet credit apply */}
                    {saleCustomerWallet && saleCustomerWallet.available > 0 && detailDoc.paymentStatus !== "paid" && (
                      <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-violet-800 flex items-center gap-2"><Wallet className="h-4 w-4" />Crédit portefeuille client</h4>
                          <span className="text-xs font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">{formatDA(saleCustomerWallet.available)} dispo.</span>
                        </div>
                        <p className="text-xs text-violet-600">Ce client a du crédit issu d'avoirs. Vous pouvez l'appliquer directement sur cette vente.</p>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            placeholder={`Montant (max ${formatDA(Math.min(saleCustomerWallet.available, Math.max(0, detailDue)))})`}
                            value={walletCreditInput}
                            onChange={e => setWalletCreditInput(e.target.value)}
                            className="flex-1 border-violet-200 focus-visible:ring-violet-400 text-sm"
                          />
                          <Button onClick={doApplyWalletCredit} disabled={applyingWalletCredit} className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white">
                            {applyingWalletCredit ? <AlertCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
                            Appliquer
                          </Button>
                        </div>
                        <p className="text-xs text-violet-500">Laissez vide pour appliquer tout le crédit disponible.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Meta info ── */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
                  {detailDoc.createdByName && (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><User className="h-3 w-3" />Créé par</p>
                      <p className="font-medium text-xs">{detailDoc.createdByName}</p>
                    </div>
                  )}
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="h-3 w-3" />Date création</p>
                    <p className="font-medium text-xs">{format(new Date(detailDoc.createdAt), "dd/MM/yyyy")}</p>
                  </div>
                  {detailDoc.promisedDate && (
                    <div className={`rounded-lg border p-3 ${isAfter(new Date(), parseISO(detailDoc.promisedDate)) && !["delivered","cancelled","converted"].includes(detailDoc.status) ? "border-red-200 bg-red-50" : "bg-muted/30"}`}>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="h-3 w-3" />Livraison prévue</p>
                      <p className="font-medium text-xs">{detailDoc.promisedDate.includes("T") ? format(parseISO(detailDoc.promisedDate), "dd/MM/yyyy HH:mm") : format(parseISO(detailDoc.promisedDate), "dd/MM/yyyy")}</p>
                    </div>
                  )}
                  {(detailDoc as any).dueDate && (
                    <div className={`rounded-lg border p-3 ${isAfter(new Date(), parseISO((detailDoc as any).dueDate)) && !["cancelled","converted"].includes(detailDoc.status) && detailDoc.paymentStatus !== "paid" ? "border-amber-200 bg-amber-50" : "bg-muted/30"}`}>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="h-3 w-3" />Échéance paiement</p>
                      <p className="font-medium text-xs">{format(parseISO((detailDoc as any).dueDate), "dd/MM/yyyy")}</p>
                    </div>
                  )}
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Building2 className="h-3 w-3" />Boutique</p>
                    <p className="font-medium text-xs">{detailDoc.branchName}</p>
                  </div>
                </div>

                {/* ── Items ── */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Articles ({(detailDoc as any).items?.length ?? 0})</h3>
                  <div className="border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent bg-muted/30">
                          <TableHead className="text-xs">Produit</TableHead>
                          <TableHead className="text-xs text-right">Qté</TableHead>
                          <TableHead className="text-xs text-right">Prix unit.</TableHead>
                          {(detailDoc as any).items?.some((i: any) => i.discount > 0) && <TableHead className="text-xs text-right">Remise</TableHead>}
                          <TableHead className="text-xs text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {((detailDoc as any).items ?? []).map((i: any) => (
                          <TableRow key={i.id} className="hover:bg-muted/20">
                            <TableCell className="text-sm py-2">{i.productName}</TableCell>
                            <TableCell className="text-sm py-2 text-right font-mono">{i.quantity}</TableCell>
                            <TableCell className="text-sm py-2 text-right">{formatDA(i.unitPrice)}</TableCell>
                            {(detailDoc as any).items?.some((j: any) => j.discount > 0) && (
                              <TableCell className="text-sm py-2 text-right text-red-600">{i.discount > 0 ? `−${formatDA(i.discount)}` : "—"}</TableCell>
                            )}
                            <TableCell className="text-sm py-2 text-right font-semibold">{formatDA(i.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* ── Totals ── */}
                <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Sous-total</span><span>{formatDA(parseFloat(detailDoc.subtotal as string))}</span></div>
                  {parseFloat(detailDoc.discount as string) > 0 && <div className="flex justify-between text-sm text-red-600"><span>Remise</span><span>−{formatDA(parseFloat(detailDoc.discount as string))}</span></div>}
                  {parseFloat(detailDoc.tax as string) > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Taxes</span><span>+{formatDA(parseFloat(detailDoc.tax as string))}</span></div>}
                  {parseFloat(detailDoc.shippingFee as string) > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Livraison</span><span>+{formatDA(parseFloat(detailDoc.shippingFee as string))}</span></div>}
                  <Separator />
                  <div className="flex justify-between font-bold text-base"><span>Total TTC</span><span>{formatDA(detailTotal)}</span></div>
                  {detailDoc.type === "order" && detailPaid > 0 && (
                    <>
                      <Separator />
                      <div className="flex justify-between text-sm text-green-700 font-medium">
                        <span>Versement payé</span>
                        <span>{formatDA(detailPaid)}</span>
                      </div>
                      {detailTotal - detailPaid > 0 && (
                        <div className="flex justify-between text-sm font-semibold text-orange-600">
                          <span>Reste à payer</span>
                          <span>{formatDA(detailTotal - detailPaid)}</span>
                        </div>
                      )}
                      {detailTotal - detailPaid <= 0 && (
                        <div className="flex justify-between text-sm font-semibold text-emerald-600">
                          <span>Statut paiement</span>
                          <span>✓ Soldé</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* ── Order versement button ── */}
                {detailDoc.type === "order" && detailDoc.status !== "cancelled" && detailDoc.paymentStatus !== "paid" && (
                  <Button
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => {
                      const remaining = Math.max(0, detailTotal - detailPaid);
                      setPayOpen(true);
                      setPayForm({ amount: remaining.toString(), method: "cash", date: format(new Date(), "yyyy-MM-dd"), notes: "" });
                    }}
                  >
                    <CreditCard className="h-4 w-4" />Ajouter un versement
                  </Button>
                )}

                {(detailDoc.type === "sale" || detailDoc.type === "order") && (detailDoc as any).payments?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-3">Historique des paiements</h3>
                    <div className="space-y-2">
                      {(detailDoc as any).payments.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between rounded-lg border px-4 py-2.5 bg-emerald-50/50">
                          <div className="flex items-center gap-3">
                            <div className="h-7 w-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                              <CreditCard className="h-3.5 w-3.5 text-emerald-700" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold">{formatDA(p.amount)}</p>
                              <p className="text-xs text-muted-foreground">{METHOD_LABELS[p.method] ?? p.method} · {format(new Date(p.createdAt || p.date), "dd/MM/yyyy HH:mm")}</p>
                              {p.notes && <p className="text-xs text-muted-foreground italic">{p.notes}</p>}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-200 bg-emerald-50">Encaissé</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Notes ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold">Notes internes</h3>
                    {!editingNotes && (
                      <button onClick={() => { setEditingNotes(true); setNoteDraft(detailDoc.notes ?? ""); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <Edit3 className="h-3 w-3" />Modifier
                      </button>
                    )}
                  </div>
                  {editingNotes ? (
                    <div className="space-y-2">
                      <Textarea className="text-sm min-h-[80px] resize-none" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} />
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1.5" onClick={saveNotes} disabled={updateMutation.isPending}>
                          <Check className="h-3.5 w-3.5" />Enregistrer
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingNotes(false)}>Annuler</Button>
                      </div>
                    </div>
                  ) : detailDoc.notes ? (
                    <div className="rounded-xl border bg-amber-50/50 p-4">
                      <p className="text-sm text-foreground whitespace-pre-wrap">{detailDoc.notes}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-center">
                      <p className="text-xs text-muted-foreground">Aucune note. Cliquez sur Modifier pour en ajouter.</p>
                    </div>
                  )}
                </div>

                {/* ── Conversion actions ── */}
                {canConvert && conversions.length > 0 && (
                  <div className="space-y-2">
                    <Separator />
                    <h3 className="text-sm font-semibold">Convertir ce document</h3>

                    {/* Credit warning for invoice conversions */}
                    {convertCreditStatus && convertCreditStatus.state !== "no_limit" && conversions.some(c => c.targetType === "sale") && (
                      <CreditStatusPanel credit={convertCreditStatus} amount={convertAmount} />
                    )}

                    <div className="grid grid-cols-1 gap-2">
                      {conversions.map(conv => {
                        const isInvoiceConvert = conv.targetType === "sale";
                        const blocked = isInvoiceConvert && convertCreditStatus?.state === "exceeded" && !convertCreditStatus.canOverride;
                        return (
                          <button
                            key={conv.targetType}
                            onClick={() => doConvert(conv.targetType)}
                            disabled={convertMutation.isPending || blocked}
                            className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${blocked ? "border-red-200 text-red-400 bg-red-50/50 cursor-not-allowed opacity-60" : conv.color}`}
                          >
                            <span>{conv.label}</span>
                            {blocked ? <Ban className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Footer actions ── */}
                <div className="flex flex-col gap-2 pt-2">
                  <Button variant="outline" className="w-full gap-2" onClick={() => { duplicateMutation.mutate({ id: detailDoc.id }); }}>
                    <Copy className="h-4 w-4" />Dupliquer en brouillon
                  </Button>
                  {canCancel && (
                    <>
                      <Separator />
                      <Button variant="outline" className="w-full gap-2 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setCancelConfirm(detailDoc)}>
                        <XCircle className="h-4 w-4" />Annuler ce document
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Payment Dialog ── */}
      {detailDoc && payOpen && (
        <Dialog open={payOpen} onOpenChange={v => setPayOpen(v)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Enregistrer un paiement</DialogTitle>
              <DialogDescription>
                {detailDoc.reference} — Reste dû: <strong>{formatDA(detailDue)}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Montant (DA) *</Label>
                <Input type="number" className="mt-1" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>Moyen de paiement</Label>
                <Select value={payForm.method} onValueChange={v => setPayForm(f => ({ ...f, method: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Espèces</SelectItem>
                    <SelectItem value="card">Carte bancaire</SelectItem>
                    <SelectItem value="transfer">Virement bancaire</SelectItem>
                    <SelectItem value="credit">Crédit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" className="mt-1" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <Label>Référence / Notes</Label>
                <Input className="mt-1" placeholder="N° virement, chèque..." value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayOpen(false)}>Annuler</Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => payMutation.mutate({ id: detailDoc.id, data: { amount: parseFloat(payForm.amount), method: payForm.method, date: payForm.date, notes: payForm.notes || null } })}
                disabled={!payForm.amount || payMutation.isPending}
              >
                {payMutation.isPending ? "En cours..." : "Enregistrer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Credit Override Dialog ── */}
      <Dialog open={overrideOpen} onOpenChange={v => { if (!v) { setOverrideOpen(false); setOverrideReason(""); setPendingConvertType(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Autorisation de dépassement de crédit
            </DialogTitle>
            <DialogDescription>
              La limite de crédit du client est dépassée. En tant que gérant, vous pouvez autoriser cette opération exceptionnellement. Un motif est obligatoire.
            </DialogDescription>
          </DialogHeader>

          {(creditStatus || convertCreditStatus) && (() => {
            const cs = creditStatus?.state === "exceeded" ? creditStatus : convertCreditStatus;
            const amt = pendingConvertType ? convertAmount : createTotal;
            return cs ? <CreditStatusPanel credit={cs} amount={amt} /> : null;
          })()}

          <div className="space-y-2 pt-2">
            <Label className="text-sm font-medium">Motif de l'autorisation *</Label>
            <Textarea
              className="min-h-[80px] resize-none text-sm"
              placeholder="Ex: Accord commercial exceptionnel validé par la direction, client en cours de régularisation..."
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Ce motif sera enregistré dans l'historique d'audit du crédit client.</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOverrideOpen(false); setOverrideReason(""); setPendingConvertType(null); }}>
              Annuler
            </Button>
            <Button
              onClick={pendingConvertType ? submitConvertOverride : submitOverride}
              disabled={!overrideReason.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Autoriser et créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Confirm Dialog ── */}
      {cancelConfirm && (
        <Dialog open={!!cancelConfirm} onOpenChange={() => setCancelConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />Annuler le document
              </DialogTitle>
              <DialogDescription>
                Êtes-vous sûr de vouloir annuler <strong>{cancelConfirm.reference}</strong> ? Cette action est irréversible.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelConfirm(null)}>Retour</Button>
              <Button variant="destructive" onClick={() => cancelMutation.mutate({ id: cancelConfirm.id })} disabled={cancelMutation.isPending}>
                {cancelMutation.isPending ? "Annulation..." : "Confirmer l'annulation"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Quick add client dialog ── */}
      <Dialog open={quickClientOpen} onOpenChange={v => { if (!v) setQuickClientOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              Nouveau client
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prénom <span className="text-destructive">*</span></Label>
                <Input
                  className="mt-1"
                  placeholder="Ex: Ahmed"
                  value={quickClientFirstName}
                  onChange={e => setQuickClientFirstName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <Label>Nom <span className="text-destructive">*</span></Label>
                <Input
                  className="mt-1"
                  placeholder="Ex: Benali"
                  value={quickClientLastName}
                  onChange={e => setQuickClientLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Téléphone <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1"
                placeholder="0555 000 000"
                value={quickClientPhone}
                onChange={e => setQuickClientPhone(e.target.value)}
              />
            </div>
            <div>
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1"
                type="email"
                placeholder="exemple@email.com"
                value={quickClientEmail}
                onChange={e => setQuickClientEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && createQuickClient()}
              />
            </div>
            <p className="text-xs text-muted-foreground">Tous les champs sont obligatoires.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickClientOpen(false)}>Annuler</Button>
            <Button
              onClick={createQuickClient}
              disabled={
                !quickClientFirstName.trim() || !quickClientLastName.trim() ||
                !quickClientPhone.trim() || !quickClientEmail.trim() ||
                quickClientSaving
              }
            >
              {quickClientSaving ? "Ajout..." : "Ajouter le client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
