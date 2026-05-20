import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetBranches, useGetCompanySettings } from "@workspace/api-client-react";
import { generateExpensePdf } from "@/lib/pdf-generator";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { ExportButton } from "@/components/ExportButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Search, Filter, TrendingDown, Receipt, Building2, Tag,
  Eye, Pencil, Trash2, CreditCard, Banknote, FileText, Paperclip,
  X, ChevronDown, CheckCircle2, Clock, XCircle, Wallet, FileDown,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";

const CATEGORIES = [
  "Loyer", "Électricité", "Eau", "Salaires", "Matériel",
  "Entretien", "Transport", "Emballage", "Fournitures",
  "Marketing", "Charges sociales", "Impôts", "Divers",
];

const PAYMENT_METHODS = [
  { value: "cash", label: "Espèces", icon: Banknote },
  { value: "virement", label: "Virement", icon: CreditCard },
  { value: "cheque", label: "Chèque", icon: FileText },
  { value: "carte", label: "Carte bancaire", icon: CreditCard },
];

const STATUSES = [
  { value: "validated", label: "Validé", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "draft", label: "Brouillon", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "cancelled", label: "Annulé", color: "bg-red-50 text-red-600 border-red-200" },
];

const CATEGORY_COLORS: Record<string, string> = {
  "Loyer": "bg-blue-50 text-blue-700",
  "Électricité": "bg-yellow-50 text-yellow-700",
  "Eau": "bg-cyan-50 text-cyan-700",
  "Salaires": "bg-purple-50 text-purple-700",
  "Matériel": "bg-orange-50 text-orange-700",
  "Entretien": "bg-teal-50 text-teal-700",
  "Transport": "bg-indigo-50 text-indigo-700",
  "Emballage": "bg-pink-50 text-pink-700",
  "Fournitures": "bg-rose-50 text-rose-700",
  "Marketing": "bg-violet-50 text-violet-700",
  "Charges sociales": "bg-slate-50 text-slate-700",
  "Impôts": "bg-red-50 text-red-700",
  "Divers": "bg-gray-50 text-gray-700",
};

function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

function paymentLabel(v: string) {
  return PAYMENT_METHODS.find(m => m.value === v)?.label ?? v;
}

function statusInfo(v: string) {
  return STATUSES.find(s => s.value === v) ?? STATUSES[0];
}

interface Expense {
  id: number;
  reference: string;
  branchId: number;
  branchName: string;
  category: string;
  amount: number;
  date: string;
  paymentMethod: string;
  status: string;
  notes: string | null;
  attachmentUrl: string | null;
  createdByUserId: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Filters {
  search: string;
  branchId: string;
  category: string;
  paymentMethod: string;
  status: string;
  from: string;
  to: string;
}

const EMPTY_FORM = {
  branchId: "",
  category: "",
  amount: "",
  date: format(new Date(), "yyyy-MM-dd"),
  paymentMethod: "cash",
  status: "validated",
  notes: "",
  attachmentUrl: "",
};

export default function Expenses() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>({
    search: "", branchId: "all", category: "all",
    paymentMethod: "all", status: "all", from: "", to: "",
  });
  const [showFilters, setShowFilters] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data: branches = [] } = useGetBranches();
  const { data: companySettings } = useGetCompanySettings();

  const qParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (filters.branchId !== "all") p.branchId = filters.branchId;
    if (filters.category !== "all") p.category = filters.category;
    if (filters.paymentMethod !== "all") p.paymentMethod = filters.paymentMethod;
    if (filters.status !== "all") p.status = filters.status;
    if (filters.from) p.from = filters.from;
    if (filters.to) p.to = filters.to;
    if (filters.search) p.search = filters.search;
    return p;
  }, [filters]);

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ["expenses", qParams],
    queryFn: () => {
      const qs = new URLSearchParams(qParams).toString();
      return customFetch(`/api/expenses${qs ? "?" + qs : ""}`);
    },
  });

  const { data: detail } = useQuery<Expense>({
    queryKey: ["expense", detailId],
    queryFn: () => customFetch(`/api/expenses/${detailId}`),
    enabled: detailId !== null,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof EMPTY_FORM) =>
      customFetch("/api/expenses", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          branchId: parseInt(data.branchId, 10),
          amount: parseFloat(data.amount),
          notes: data.notes || null,
          attachmentUrl: data.attachmentUrl || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setFormOpen(false);
      toast({ title: "Dépense enregistrée" });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof EMPTY_FORM }) =>
      customFetch(`/api/expenses/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...data,
          branchId: parseInt(data.branchId, 10),
          amount: parseFloat(data.amount),
          notes: data.notes || null,
          attachmentUrl: data.attachmentUrl || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense", editingId] });
      setFormOpen(false);
      setEditingId(null);
      toast({ title: "Dépense mise à jour" });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customFetch(`/api/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setDeleteId(null);
      if (detailId === deleteId) setDetailId(null);
      toast({ title: "Dépense supprimée" });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormOpen(true);
  }

  function openEdit(e: Expense) {
    setEditingId(e.id);
    setForm({
      branchId: String(e.branchId),
      category: e.category,
      amount: String(e.amount),
      date: e.date,
      paymentMethod: e.paymentMethod,
      status: e.status,
      notes: e.notes ?? "",
      attachmentUrl: e.attachmentUrl ?? "",
    });
    setFormOpen(true);
  }

  function handleSubmit() {
    if (!form.branchId || !form.category || !form.amount || !form.date) {
      toast({ title: "Champs requis manquants", variant: "destructive" }); return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
  const validated = expenses.filter(e => e.status === "validated").reduce((s, e) => s + e.amount, 0);
  const draft = expenses.filter(e => e.status === "draft").reduce((s, e) => s + e.amount, 0);

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach(e => { if (e.status !== "cancelled") map[e.category] = (map[e.category] ?? 0) + e.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [expenses]);

  const activeFiltersCount = [
    filters.branchId !== "all", filters.category !== "all",
    filters.paymentMethod !== "all", filters.status !== "all",
    !!filters.from, !!filters.to,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold tracking-tight">Dépenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {expenses.length} dépense{expenses.length !== 1 ? "s" : ""} · Total {formatDA(totalAmount)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButton
            endpoint="export/expenses"
            params={{
              branchId: filters.branchId,
              category: filters.category,
              paymentMethod: filters.paymentMethod,
              status: filters.status,
              from: filters.from || undefined,
              to: filters.to || undefined,
            }}
            label="Exporter"
          />
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Nouvelle dépense
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-50"><TrendingDown className="h-4 w-4 text-red-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Total dépenses</p>
                <p className="text-lg font-bold text-red-600">{formatDA(totalAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Validées</p>
                <p className="text-lg font-bold">{formatDA(validated)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50"><Clock className="h-4 w-4 text-amber-500" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Brouillons</p>
                <p className="text-lg font-bold">{formatDA(draft)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50"><Receipt className="h-4 w-4 text-blue-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Nbre de dépenses</p>
                <p className="text-lg font-bold">{expenses.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top categories */}
      {byCategory.length > 0 && (
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top catégories</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {byCategory.map(([cat, amt]) => (
                <button
                  key={cat}
                  onClick={() => setFilters(f => ({ ...f, category: f.category === cat ? "all" : cat }))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all
                    ${CATEGORY_COLORS[cat] ?? "bg-gray-50 text-gray-700"}
                    ${filters.category === cat ? "ring-2 ring-offset-1 ring-current" : "hover:opacity-80"}`}
                >
                  <span>{cat}</span>
                  <span className="opacity-60">{formatDA(amt)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Référence, catégorie, note..."
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(v => !v)}
            className={`gap-2 ${activeFiltersCount > 0 ? "border-primary text-primary" : ""}`}
          >
            <Filter className="h-4 w-4" />
            Filtres
            {activeFiltersCount > 0 && (
              <Badge className="ml-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                {activeFiltersCount}
              </Badge>
            )}
          </Button>
          {activeFiltersCount > 0 && (
            <Button variant="ghost" size="icon" onClick={() => setFilters({ search: "", branchId: "all", category: "all", paymentMethod: "all", status: "all", from: "", to: "" })}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 p-4 bg-muted/30 rounded-lg border">
            <Select value={filters.branchId} onValueChange={v => setFilters(f => ({ ...f, branchId: v }))}>
              <SelectTrigger><SelectValue placeholder="Boutique" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.category} onValueChange={v => setFilters(f => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue placeholder="Catégorie" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.paymentMethod} onValueChange={v => setFilters(f => ({ ...f, paymentMethod: v }))}>
              <SelectTrigger><SelectValue placeholder="Paiement" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={v => setFilters(f => ({ ...f, status: v }))}>
              <SelectTrigger><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div>
              <Input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} placeholder="Du" />
            </div>
            <div>
              <Input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} placeholder="Au" />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Référence</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Boutique</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead>Paiement</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right pr-4">Montant</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : expenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16">
                    <TrendingDown className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">Aucune dépense trouvée</p>
                    {activeFiltersCount > 0 && (
                      <button onClick={() => setFilters({ search: "", branchId: "all", category: "all", paymentMethod: "all", status: "all", from: "", to: "" })} className="text-xs text-primary mt-1 underline">
                        Effacer les filtres
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ) : expenses.map(e => {
                const st = statusInfo(e.status);
                return (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => setDetailId(e.id)}
                  >
                    <TableCell className="pl-4">
                      <span className="font-mono text-xs text-muted-foreground">{e.reference}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(e.date), "dd MMM yyyy", { locale: fr })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm">
                        <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate max-w-[140px]">{e.branchName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[e.category] ?? "bg-gray-50 text-gray-700"}`}>
                        {e.category}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{paymentLabel(e.paymentMethod)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${st.color}`}>
                        {st.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <span className={`font-semibold text-sm ${e.status === "cancelled" ? "line-through text-muted-foreground" : "text-red-600"}`}>
                        {formatDA(e.amount)}
                      </span>
                    </TableCell>
                    <TableCell onClick={ev => ev.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(e)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Modifier"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(e.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {expenses.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
              <span className="text-xs text-muted-foreground">{expenses.length} dépense{expenses.length !== 1 ? "s" : ""}</span>
              <span className="text-sm font-semibold text-red-600">{formatDA(totalAmount)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Drawer */}
      <Sheet open={detailId !== null} onOpenChange={open => { if (!open) setDetailId(null); }}>
        <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="font-serif text-lg">Détail de la dépense</SheetTitle>
          </SheetHeader>
          {detail ? (
            <div className="space-y-5">
              {/* Reference & status */}
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-muted-foreground">{detail.reference}</span>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo(detail.status).color}`}>
                    {statusInfo(detail.status).label}
                  </span>
                  <Button
                    variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
                    onClick={() => {
                      if (!companySettings) return;
                      generateExpensePdf({
                        reference: detail.reference, branchName: detail.branchName,
                        category: detail.category, amount: detail.amount,
                        date: detail.date, paymentMethod: detail.paymentMethod,
                        status: detail.status, notes: detail.notes ?? null,
                        createdByName: detail.createdByName ?? null, createdAt: detail.createdAt,
                      }, companySettings as any);
                    }}
                  >
                    <FileDown className="h-3 w-3" />PDF
                  </Button>
                </div>
              </div>

              {/* Amount hero */}
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-center">
                <p className="text-xs text-red-400 mb-1">Montant</p>
                <p className="text-3xl font-bold text-red-600">{formatDA(detail.amount)}</p>
              </div>

              <Separator />

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Date</p>
                  <p className="text-sm font-medium">{format(new Date(detail.date), "dd MMMM yyyy", { locale: fr })}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Paiement</p>
                  <p className="text-sm font-medium">{paymentLabel(detail.paymentMethod)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Catégorie</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[detail.category] ?? "bg-gray-50 text-gray-700"}`}>
                    {detail.category}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Boutique</p>
                  <p className="text-sm font-medium flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {detail.branchName}
                  </p>
                </div>
              </div>

              {detail.notes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
                  <p className="text-sm bg-muted/30 rounded-lg px-3 py-2 leading-relaxed">{detail.notes}</p>
                </div>
              )}

              <Separator />

              {/* Real file attachments */}
              <AttachmentPanel
                entityType="expense"
                entityId={detail.id}
                branchId={detail.branchId}
              />

              <Separator />

              <div className="space-y-1.5 text-xs text-muted-foreground">
                {detail.createdByName && (
                  <p>Créé par <span className="font-medium text-foreground">{detail.createdByName}</span></p>
                )}
                <p>Créé le {format(new Date(detail.createdAt), "dd/MM/yyyy à HH:mm", { locale: fr })}</p>
                {detail.updatedAt !== detail.createdAt && (
                  <p>Mis à jour le {format(new Date(detail.updatedAt), "dd/MM/yyyy à HH:mm", { locale: fr })}</p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={() => { setDetailId(null); openEdit(detail); }}>
                  <Pencil className="h-3.5 w-3.5" /> Modifier
                </Button>
                <Button variant="outline" className="gap-2 text-red-600 hover:text-red-700 hover:border-red-300" onClick={() => { setDeleteId(detail.id); setDetailId(null); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={open => { if (!open) { setFormOpen(false); setEditingId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">{editingId ? "Modifier la dépense" : "Nouvelle dépense"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Branch */}
            <div>
              <Label>Boutique *</Label>
              <Select value={form.branchId} onValueChange={v => setForm(f => ({ ...f, branchId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choisir une boutique..." />
                </SelectTrigger>
                <SelectContent>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Category + Payment */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Catégorie *</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Catégorie..." /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Moyen de paiement *</Label>
                <Select value={form.paymentMethod} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Amount + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Montant (DA) *</Label>
                <Input
                  type="number"
                  step="100"
                  min="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            {/* Status */}
            <div>
              <Label>Statut</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="mt-1 resize-none"
                rows={2}
                placeholder="Description, justification..."
              />
            </div>

            {/* Attachment */}
            <div>
              <Label>Lien pièce jointe</Label>
              <Input
                value={form.attachmentUrl}
                onChange={e => setForm(f => ({ ...f, attachmentUrl: e.target.value }))}
                className="mt-1"
                placeholder="https://..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFormOpen(false); setEditingId(null); }}>Annuler</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending || !form.branchId || !form.category || !form.amount}
            >
              {createMutation.isPending || updateMutation.isPending ? "Enregistrement..." : editingId ? "Mettre à jour" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette dépense ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La dépense sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
