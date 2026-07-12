import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetContacts, useCreateContact, useUpdateContact, Contact, getGetContactsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Search, User, Building2, Phone, Mail, Edit2, MapPin,
  TrendingUp, CreditCard, ShoppingCart, Package, ArrowUpRight,
  CalendarDays, Filter, ChevronRight, FileText, Truck, Receipt,
  AlertCircle, CheckCircle2, Clock, XCircle, StickyNote, Activity,
  Banknote, MoreHorizontal, ShieldAlert, ShieldCheck, ShieldOff,
  Wallet, Sparkles, RotateCcw, ArrowDownLeft, ArrowUpRight as ArrowOut,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ContactRiskBadge, ReceivableAlertCard, ReceivableAlert } from "@/components/ReceivableAlerts";

/* ─── types ─────────────────────────────────────────────────────────────── */
interface ContactDocument {
  id: number; category: "sale" | "purchase";
  docType: string; docTypeLabel: string; reference: string;
  date: string; branchId: number; branchName: string;
  status: string; paymentStatus: string; fulfillmentStatus: string | null;
  subtotal: number; discount: number; tax: number; total: number; paid: number; due: number;
  createdByName: string;
}
interface ContactPayment {
  id: string; category: "sale" | "purchase";
  docReference: string; docId: number;
  date: string; amount: number; method: string; notes: string | null; createdAt: string;
}
interface ContactSummary {
  customer: { totalSales: number; unpaidSales: number; invoiceCount: number; orderCount: number; quoteCount: number; draftCount: number; lastDate: string | null; } | null;
  supplier: { totalPurchases: number; unpaidPurchases: number; purchaseCount: number; draftCount: number; lastDate: string | null; } | null;
  lastTransactionDate: string | null;
}
interface ContactProfile {
  contact: Contact & { unpaidBalance: number };
  summary: ContactSummary;
  documents: ContactDocument[];
  payments: ContactPayment[];
}

/* ─── helpers ────────────────────────────────────────────────────────────── */
function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}
function formatDate(s: string) {
  return new Date(s).toLocaleDateString("fr-DZ", { year: "numeric", month: "short", day: "numeric" });
}
function typeLabel(type: string) {
  const m: Record<string, string> = { customer: "Client", supplier: "Fournisseur", both: "Client & Fournisseur" };
  return m[type] ?? type;
}
function typeBadge(type: string): "default" | "secondary" | "outline" {
  const m: Record<string, "default" | "secondary" | "outline"> = { customer: "default", supplier: "secondary", both: "outline" };
  return m[type] ?? "outline";
}
function statusColor(status: string) {
  const m: Record<string, string> = { active: "bg-green-100 text-green-800", inactive: "bg-gray-100 text-gray-600", blocked: "bg-red-100 text-red-800" };
  return m[status] ?? "bg-gray-100";
}
function docStatusChip(status: string, payStatus: string) {
  if (status === "cancelled") return { label: "Annulé", cls: "bg-red-100 text-red-700" };
  if (payStatus === "paid") return { label: "Payé", cls: "bg-emerald-100 text-emerald-700" };
  if (payStatus === "partially_paid") return { label: "Partiel", cls: "bg-amber-100 text-amber-700" };
  const m: Record<string, { label: string; cls: string }> = {
    draft: { label: "Brouillon", cls: "bg-gray-100 text-gray-600" },
    active: { label: "Actif", cls: "bg-blue-100 text-blue-700" },
    pending: { label: "En attente", cls: "bg-amber-100 text-amber-700" },
    approved: { label: "Approuvé", cls: "bg-green-100 text-green-700" },
    rejected: { label: "Refusé", cls: "bg-red-100 text-red-700" },
    expired: { label: "Expiré", cls: "bg-gray-100 text-gray-600" },
    converted: { label: "Converti", cls: "bg-purple-100 text-purple-700" },
    confirmed: { label: "Confirmé", cls: "bg-blue-100 text-blue-700" },
    in_preparation: { label: "Préparation", cls: "bg-orange-100 text-orange-700" },
    ready: { label: "Prête", cls: "bg-teal-100 text-teal-700" },
    delivered: { label: "Livrée", cls: "bg-green-100 text-green-700" },
    received: { label: "Réceptionné", cls: "bg-green-100 text-green-700" },
    ordered: { label: "Commandé", cls: "bg-blue-100 text-blue-700" },
    unpaid: { label: "Impayé", cls: "bg-red-100 text-red-700" },
  };
  return m[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
}
function docTypeIcon(docType: string) {
  const m: Record<string, any> = {
    draft: FileText, quotation: FileText, order: ShoppingCart, sale: Receipt, purchase: Truck
  };
  return m[docType] ?? FileText;
}
function methodLabel(m: string) {
  const ml: Record<string, string> = { cash: "Espèces", card: "Carte", transfer: "Virement", check: "Chèque", other: "Autre" };
  return ml[m] ?? m;
}
function payMethodIcon(m: string) {
  if (m === "cash") return Banknote;
  if (m === "card") return CreditCard;
  if (m === "transfer" || m === "check") return ArrowUpRight;
  return CreditCard;
}

const EMPTY_FORM = { type: "customer", displayName: "", companyName: "", phone: "", email: "", address: "", city: "", status: "active", creditLimit: "", notes: "" };

/* ─── API hook ───────────────────────────────────────────────────────────── */
function useContactProfile(id: number | null) {
  return useQuery<ContactProfile>({
    queryKey: ["contact-profile", id],
    queryFn: async () => {
      const token = localStorage.getItem("erp_token") ?? "";
      const r = await fetch(`/api/contacts/${id}/transactions`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error("Erreur chargement profil");
      return r.json();
    },
    enabled: id != null,
    staleTime: 30000,
  });
}

/* ─── MetricCard ─────────────────────────────────────────────────────────── */
function MetricCard({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${accent ?? "bg-primary/10"}`}>
        <Icon className={`h-4.5 w-4.5 ${accent ? "text-white" : "text-primary"}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ─── ContactProfile (Sheet body) ────────────────────────────────────────── */
function ContactProfile({ contact, onEdit }: { contact: Contact; onEdit: () => void }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [payFilter, setPayFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");

  const { data: profile, isLoading } = useContactProfile(contact.id);

  const isCustomer = contact.type === "customer" || contact.type === "both";
  const isSupplier = contact.type === "supplier" || contact.type === "both";

  const { data: walletData } = useQuery<{
    customerId: number; customerName: string;
    available: number; totalCreated: number; totalUsed: number; totalCancelled: number;
    movements: Array<{ id: number; reference: string; type: string; amount: number; notes: string | null; sourceReturnRef: string; usedOnSaleRef: string; createdByName: string; branchName: string; createdAt: string }>;
  }>({
    queryKey: ["customer-wallet", contact.id],
    queryFn: async () => {
      const r = await fetch(`/api/customers/${contact.id}/credit`, { headers: { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` } });
      if (!r.ok) throw new Error("Accès refusé ou données non disponibles");
      return r.json();
    },
    enabled: isCustomer,
    staleTime: 30_000,
  });

  // Fetch receivable alert for this specific customer
  const { data: receivableAlerts = [] } = useQuery<ReceivableAlert[]>({
    queryKey: ["receivable-alerts"],
    queryFn: async () => {
      const r = await fetch("/api/receivables/alerts", { headers: { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` } });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60_000,
    enabled: isCustomer,
  });
  const receivableAlert = Array.isArray(receivableAlerts) ? (receivableAlerts.find(a => a.customerId === contact.id) ?? null) : null;

  const docs = profile?.documents ?? [];
  const payments = profile?.payments ?? [];
  const summary = profile?.summary;

  const filtered = docs.filter(d => {
    if (docTypeFilter !== "all") {
      if (docTypeFilter === "purchase" && d.category !== "purchase") return false;
      if (docTypeFilter !== "purchase" && d.docType !== docTypeFilter) return false;
    }
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (payFilter !== "all" && d.paymentStatus !== payFilter) return false;
    if (branchFilter !== "all" && String(d.branchId) !== branchFilter) return false;
    return true;
  });

  const branches = [...new Map(docs.map(d => [d.branchId, d.branchName])).entries()];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-2 pb-4 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              {contact.companyName ? <Building2 className="h-5 w-5 text-primary" /> : <User className="h-5 w-5 text-primary" />}
            </div>
            <div>
              <h2 className="text-lg font-bold leading-tight">{contact.displayName}</h2>
              {contact.companyName && <p className="text-sm text-muted-foreground">{contact.companyName}</p>}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant={typeBadge(contact.type)} className="text-xs">{typeLabel(contact.type)}</Badge>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(contact.status)}`}>{contact.status}</span>
                {isCustomer && <ContactRiskBadge customerId={contact.id} />}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={onEdit}>
            <Edit2 className="h-3.5 w-3.5" />Modifier
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 text-sm">
          {contact.phone && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Phone className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{contact.phone}</span>
            </div>
          )}
          {contact.email && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{contact.email}</span>
            </div>
          )}
          {contact.city && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{contact.city}</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-6 mt-3 w-auto justify-start h-9 rounded-lg bg-muted/60 shrink-0">
          <TabsTrigger value="overview" className="text-xs px-3">Vue d&apos;ensemble</TabsTrigger>
          <TabsTrigger value="transactions" className="text-xs px-3">
            Transactions {docs.length > 0 && <span className="ml-1 rounded-full bg-primary/15 text-primary px-1.5 text-[10px] font-semibold">{docs.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="payments" className="text-xs px-3">
            Paiements {payments.length > 0 && <span className="ml-1 rounded-full bg-primary/15 text-primary px-1.5 text-[10px] font-semibold">{payments.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="notes" className="text-xs px-3">Notes</TabsTrigger>
          {isCustomer && (
            <TabsTrigger value="wallet" className="text-xs px-3 gap-1">
              <Wallet className="h-3 w-3" />Portefeuille
              {walletData && walletData.available > 0 && (
                <span className="rounded-full bg-violet-100 text-violet-700 px-1.5 text-[10px] font-semibold">{walletData.movements.filter(m => m.type === "credit_created").length}</span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="flex-1 overflow-y-auto px-6 pb-6 pt-4 space-y-6 mt-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Chargement...</p>
          ) : (
            <>
              {isCustomer && summary?.customer && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Activité client</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricCard icon={Receipt} label="Total facturé" value={formatDA(summary.customer.totalSales)} sub={`${summary.customer.invoiceCount} facture${summary.customer.invoiceCount !== 1 ? "s" : ""}`} />
                    <MetricCard icon={AlertCircle} label="Solde impayé" value={formatDA(summary.customer.unpaidSales)} sub={summary.customer.unpaidSales > 0 ? "À recouvrer" : "Tout payé"} accent={summary.customer.unpaidSales > 0 ? "bg-red-500" : undefined} />
                    <MetricCard icon={ShoppingCart} label="Commandes" value={String(summary.customer.orderCount)} sub={`+ ${summary.customer.quoteCount} devis`} />
                    <MetricCard icon={CalendarDays} label="Dernière activité" value={summary.customer.lastDate ? formatDate(summary.customer.lastDate) : "—"} />
                  </div>
                </div>
              )}

              {isSupplier && summary?.supplier && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Package className="h-4 w-4 text-amber-600" />Activité fournisseur</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricCard icon={Truck} label="Total acheté" value={formatDA(summary.supplier.totalPurchases)} sub={`${summary.supplier.purchaseCount} bon${summary.supplier.purchaseCount !== 1 ? "s" : ""} reçu${summary.supplier.purchaseCount !== 1 ? "s" : ""}`} />
                    <MetricCard icon={AlertCircle} label="Solde à payer" value={formatDA(summary.supplier.unpaidPurchases)} sub={summary.supplier.unpaidPurchases > 0 ? "À régler" : "Tout payé"} accent={summary.supplier.unpaidPurchases > 0 ? "bg-amber-500" : undefined} />
                    <MetricCard icon={Clock} label="En attente" value={String(summary.supplier.draftCount)} sub="Brouillons" />
                    <MetricCard icon={CalendarDays} label="Dernière livraison" value={summary.supplier.lastDate ? formatDate(summary.supplier.lastDate) : "—"} />
                  </div>
                </div>
              )}

              {contact.creditLimit != null && (contact.type === "customer" || contact.type === "both") && (() => {
                const limit = parseFloat(contact.creditLimit as any);
                const unpaid = summary?.customer?.unpaidSales ?? 0;
                const pct = limit > 0 ? (unpaid / limit) * 100 : 0;
                const remaining = Math.max(0, limit - unpaid);
                const state = unpaid > limit ? "exceeded" : pct >= 80 ? "warning" : "ok";
                const barColor = state === "exceeded" ? "bg-red-500" : state === "warning" ? "bg-amber-500" : "bg-emerald-500";
                const cardColor = state === "exceeded" ? "border-red-200 bg-red-50" : state === "warning" ? "border-amber-200 bg-amber-50/70" : "border-emerald-100 bg-emerald-50/40";
                const icon = state === "exceeded" ? <ShieldOff className="h-4 w-4 text-red-500" /> : state === "warning" ? <ShieldAlert className="h-4 w-4 text-amber-500" /> : <ShieldCheck className="h-4 w-4 text-emerald-500" />;
                const label = state === "exceeded" ? "Limite dépassée" : state === "warning" ? "Crédit presque épuisé" : "Crédit disponible";
                return (
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" />Crédit client</h3>
                    <div className={`rounded-xl border p-4 space-y-3 ${cardColor}`}>
                      <div className="flex items-center gap-2">
                        {icon}
                        <span className="text-sm font-semibold">{label}</span>
                        {state === "exceeded" && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-red-600 bg-red-100 px-2 py-0.5 rounded-full">Dépassé</span>}
                        {state === "warning" && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Attention</span>}
                        {state === "ok" && <span className="ml-auto text-xs text-emerald-700">{Math.round(pct)}%</span>}
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-muted-foreground">Plafond accordé</span><span className="font-medium">{formatDA(limit)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Impayé en cours</span><span className={`font-semibold ${state === "exceeded" ? "text-red-600" : state === "warning" ? "text-amber-700" : ""}`}>{formatDA(unpaid)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Disponible restant</span><span className={`font-semibold ${remaining <= 0 ? "text-red-600" : "text-emerald-700"}`}>{formatDA(remaining)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Utilisation</span><span className="font-medium">{Math.round(pct)}%</span></div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Receivable risk alert block */}
              {isCustomer && receivableAlert && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red-500" />
                    Alerte créances
                  </h3>
                  <ReceivableAlertCard alert={receivableAlert} />
                </div>
              )}

              {docs.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Documents récents</h3>
                  <div className="space-y-2">
                    {docs.slice(0, 5).map(d => {
                      const chip = docStatusChip(d.status, d.paymentStatus);
                      const Icon = docTypeIcon(d.docType);
                      return (
                        <div key={`${d.category}-${d.id}`} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/40 cursor-default">
                          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono font-medium">{d.reference}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{formatDate(d.date)} · {d.branchName}</p>
                          </div>
                          <span className="text-sm font-semibold shrink-0">{formatDA(d.total)}</span>
                        </div>
                      );
                    })}
                    {docs.length > 5 && (
                      <button className="text-xs text-primary hover:underline w-full text-center py-1" onClick={() => setActiveTab("transactions")}>
                        Voir les {docs.length} transactions →
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* TRANSACTIONS */}
        <TabsContent value="transactions" className="flex-1 flex flex-col min-h-0 mt-0">
          {/* Filters */}
          <div className="px-6 py-3 border-b shrink-0">
            <div className="flex flex-wrap gap-2">
              <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
                <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  {isCustomer && <>
                    <SelectItem value="draft">Brouillons</SelectItem>
                    <SelectItem value="quotation">Devis</SelectItem>
                    <SelectItem value="order">Commandes</SelectItem>
                    <SelectItem value="sale">Factures</SelectItem>
                  </>}
                  {isSupplier && <SelectItem value="purchase">Achats</SelectItem>}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue placeholder="Statut" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous statuts</SelectItem>
                  <SelectItem value="draft">Brouillon</SelectItem>
                  <SelectItem value="active">Actif</SelectItem>
                  <SelectItem value="pending">En attente</SelectItem>
                  <SelectItem value="confirmed">Confirmé</SelectItem>
                  <SelectItem value="converted">Converti</SelectItem>
                  <SelectItem value="delivered">Livré</SelectItem>
                  <SelectItem value="received">Réceptionné</SelectItem>
                  <SelectItem value="cancelled">Annulé</SelectItem>
                </SelectContent>
              </Select>
              <Select value={payFilter} onValueChange={setPayFilter}>
                <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue placeholder="Paiement" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tout paiement</SelectItem>
                  <SelectItem value="paid">Payé</SelectItem>
                  <SelectItem value="partially_paid">Partiel</SelectItem>
                  <SelectItem value="unpaid">Impayé</SelectItem>
                </SelectContent>
              </Select>
              {branches.length > 1 && (
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="Agence" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes agences</SelectItem>
                    {branches.map(([bid, bname]) => <SelectItem key={bid} value={String(bid)}>{bname}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {(docTypeFilter !== "all" || statusFilter !== "all" || payFilter !== "all" || branchFilter !== "all") && (
                <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => { setDocTypeFilter("all"); setStatusFilter("all"); setPayFilter("all"); setBranchFilter("all"); }}>
                  Réinitialiser
                </Button>
              )}
            </div>
          </div>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground text-center py-12">Chargement...</p>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <FileText className="h-8 w-8 opacity-30" />
                <p className="text-sm">Aucun document trouvé</p>
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map(d => {
                  const chip = docStatusChip(d.status, d.paymentStatus);
                  const Icon = docTypeIcon(d.docType);
                  const paidPct = d.total > 0 ? (d.paid / d.total) * 100 : 0;
                  return (
                    <div key={`${d.category}-${d.id}`} className="px-6 py-3.5 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-mono font-semibold">{d.reference}</span>
                            <span className="text-xs text-muted-foreground">{d.docTypeLabel}</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <span>{formatDate(d.date)}</span>
                            <span>·</span>
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{d.branchName}</span>
                            <span>·</span>
                            <span>{d.createdByName}</span>
                          </div>
                          {d.paymentStatus !== "unpaid" && d.total > 0 && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-[120px]">
                                <div className={`h-full rounded-full ${d.paymentStatus === "paid" ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${paidPct}%` }} />
                              </div>
                              <span className="text-[10px] text-muted-foreground">{Math.round(paidPct)}% payé</span>
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold">{formatDA(d.total)}</p>
                          {d.due > 0 && <p className="text-xs text-red-600 font-medium">–{formatDA(d.due)} dû</p>}
                          {d.due === 0 && d.total > 0 && <p className="text-xs text-emerald-600 font-medium">Soldé</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* PAYMENTS */}
        <TabsContent value="payments" className="flex-1 overflow-y-auto px-6 pb-6 pt-4 mt-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-12">Chargement...</p>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <CreditCard className="h-8 w-8 opacity-30" />
              <p className="text-sm">Aucun paiement enregistré</p>
            </div>
          ) : (
            <div className="space-y-3">
              {payments.map(p => {
                const PMI = payMethodIcon(p.method);
                return (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl border px-4 py-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${p.category === "sale" ? "bg-emerald-50" : "bg-amber-50"}`}>
                      <PMI className={`h-4.5 w-4.5 ${p.category === "sale" ? "text-emerald-600" : "text-amber-600"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{methodLabel(p.method)}</span>
                        <span className="text-xs text-muted-foreground">→ {p.docReference}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                          {p.category === "sale" ? "Encaissement" : "Décaissement"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" />
                        <span>{formatDate(p.date)}</span>
                        {p.notes && <><span>·</span><span className="truncate">{p.notes}</span></>}
                      </div>
                    </div>
                    <p className={`text-sm font-bold shrink-0 ${p.category === "sale" ? "text-emerald-700" : "text-amber-700"}`}>
                      {p.category === "sale" ? "+" : "–"}{formatDA(p.amount)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* WALLET */}
        <TabsContent value="wallet" className="flex-1 overflow-y-auto px-6 pb-6 pt-4 mt-0">
          {!walletData || !Array.isArray(walletData.movements) ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              {walletData && !Array.isArray(walletData.movements) ? "Accès non autorisé à ce module." : "Chargement..."}
            </p>
          ) : (
            <div className="space-y-5">
              {/* Balance cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-4 text-center">
                  <div className="text-xs text-violet-600 font-medium mb-1 flex items-center justify-center gap-1"><Wallet className="h-3.5 w-3.5" />Crédit disponible</div>
                  <div className={`text-2xl font-bold ${walletData.available > 0 ? "text-violet-700" : "text-muted-foreground"}`}>{formatDA(walletData.available)}</div>
                  {walletData.available > 0 && <div className="text-xs text-violet-500 mt-1">Utilisable sur la prochaine vente</div>}
                </div>
                <div className="grid grid-rows-3 gap-1.5">
                  <div className="rounded-lg border bg-muted/30 px-3 py-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3 text-violet-500" />Créé</span>
                    <span className="text-sm font-semibold">{formatDA(walletData.totalCreated)}</span>
                  </div>
                  <div className="rounded-lg border bg-muted/30 px-3 py-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><ArrowOut className="h-3 w-3 text-orange-500" />Utilisé</span>
                    <span className="text-sm font-semibold text-orange-700">{formatDA(walletData.totalUsed)}</span>
                  </div>
                  <div className="rounded-lg border bg-muted/30 px-3 py-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><XCircle className="h-3 w-3 text-gray-400" />Annulé</span>
                    <span className="text-sm font-semibold text-muted-foreground">{formatDA(walletData.totalCancelled)}</span>
                  </div>
                </div>
              </div>

              {walletData.movements.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                  <Wallet className="h-8 w-8 opacity-20" />
                  <p className="text-sm">Aucun mouvement de portefeuille</p>
                  <p className="text-xs opacity-70">Le crédit se crée à partir des avoirs confirmés dans le module Retours.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Historique des mouvements</h3>
                  {walletData.movements.map(m => {
                    const isCredit = m.type === "credit_created";
                    const isUsed = m.type === "credit_used";
                    const isCancelled = m.type === "credit_cancelled";
                    return (
                      <div key={m.id} className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${isCredit ? "bg-violet-50/50 border-violet-100" : isUsed ? "bg-orange-50/50 border-orange-100" : "bg-gray-50 border-gray-100"}`}>
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${isCredit ? "bg-violet-100" : isUsed ? "bg-orange-100" : "bg-gray-100"}`}>
                          {isCredit && <Sparkles className="h-4 w-4 text-violet-600" />}
                          {isUsed && <ArrowOut className="h-4 w-4 text-orange-600" />}
                          {isCancelled && <XCircle className="h-4 w-4 text-gray-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-semibold text-muted-foreground">{m.reference}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${isCredit ? "bg-violet-100 text-violet-700" : isUsed ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"}`}>
                              {isCredit ? "Crédit émis" : isUsed ? "Crédit utilisé" : "Annulé"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{m.notes}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                            {m.sourceReturnRef && <span className="flex items-center gap-1"><RotateCcw className="h-3 w-3" />Retour : {m.sourceReturnRef}</span>}
                            {m.usedOnSaleRef && <span className="flex items-center gap-1"><ArrowDownLeft className="h-3 w-3" />Vente : {m.usedOnSaleRef}</span>}
                            <span>{m.branchName}</span>
                            <span>·</span>
                            <span>{new Date(m.createdAt).toLocaleDateString("fr-DZ", { day: "numeric", month: "short", year: "numeric" })}</span>
                            <span>·</span>
                            <span>{m.createdByName}</span>
                          </div>
                        </div>
                        <div className={`text-sm font-bold shrink-0 ${isCredit ? "text-violet-700" : isUsed ? "text-orange-700" : "text-muted-foreground"}`}>
                          {isCredit ? "+" : ""}{formatDA(Math.abs(m.amount))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* NOTES */}
        <TabsContent value="notes" className="flex-1 overflow-y-auto px-6 pb-6 pt-4 mt-0 space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><StickyNote className="h-4 w-4" />Notes internes</h3>
            {contact.notes ? (
              <div className="rounded-xl border bg-amber-50/50 p-4 text-sm">{contact.notes}</div>
            ) : (
              <p className="text-sm text-muted-foreground italic">Aucune note pour ce contact.</p>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Activity className="h-4 w-4" />Activité récente</h3>
            <div className="space-y-3">
              {docs.slice(0, 8).map(d => {
                const Icon = docTypeIcon(d.docType);
                return (
                  <div key={`act-${d.category}-${d.id}`} className="flex items-start gap-3">
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{d.docTypeLabel}</span>
                        {" "}<span className="font-mono text-xs">{d.reference}</span>
                        {" "}créé — {formatDA(d.total)}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(d.date)} · {d.branchName}</p>
                    </div>
                  </div>
                );
              })}
              {docs.length === 0 && (
                <p className="text-sm text-muted-foreground italic">Aucune activité enregistrée.</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
export default function Contacts() {
  const queryClient = useQueryClient();
  const searchStr = useSearch();
  const [search, setSearch] = useState(() => new URLSearchParams(searchStr).get("q") ?? "");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data: contacts = [], isLoading } = useGetContacts(
    { search: search || undefined, type: typeFilter !== "all" ? typeFilter : undefined }
  );
  const createMutation = useCreateContact({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey() }); setDialogOpen(false); toast({ title: "Contact créé" }); } } });
  const updateMutation = useUpdateContact({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetContactsQueryKey() }); queryClient.invalidateQueries({ queryKey: ["contact-profile", editing?.id] }); setDialogOpen(false); toast({ title: "Contact mis à jour" }); } } });

  function openNew() { setEditing(null); setForm({ ...EMPTY_FORM }); setDialogOpen(true); }
  function openEdit(c: Contact) {
    setEditing(c);
    setForm({ type: c.type, displayName: c.displayName, companyName: c.companyName ?? "", phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", city: c.city ?? "", status: c.status, creditLimit: (c as any).creditLimit?.toString() ?? "", notes: (c as any).notes ?? "" });
    setDialogOpen(true);
  }
  function openProfile(c: Contact) { setSelectedContact(c); setProfileOpen(true); }
  function save() {
    const data = { ...form, creditLimit: form.creditLimit ? parseFloat(form.creditLimit) : null };
    if (editing) { updateMutation.mutate({ id: editing.id, data }); }
    else { createMutation.mutate({ data: { ...data, status: data.status as any, type: data.type as any } }); }
  }

  const counts = { all: contacts.length, customer: contacts.filter(c => c.type === "customer" || c.type === "both").length, supplier: contacts.filter(c => c.type === "supplier" || c.type === "both").length };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Clients, fournisseurs et partenaires</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Nouveau contact</Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher par nom, entreprise ou téléphone..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={typeFilter} onValueChange={v => setTypeFilter(v as typeof typeFilter)}>
              <SelectTrigger className="h-9 text-xs w-[160px]"><SelectValue placeholder="Tous" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="supplier">Fournisseurs</SelectItem>
                <SelectItem value="customer">Clients</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Ville</TableHead>
                <TableHead>Solde impayé</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : contacts.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Aucun contact trouvé</TableCell></TableRow>
              ) : contacts.map(c => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openProfile(c)}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        {c.companyName ? <Building2 className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 text-primary" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{c.displayName}</p>
                        {c.companyName && <p className="text-xs text-muted-foreground">{c.companyName}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={typeBadge(c.type)} className="text-xs">{typeLabel(c.type)}</Badge></TableCell>
                  <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm">{c.city ?? "—"}</TableCell>
                  <TableCell className="text-sm font-medium">{c.unpaidBalance > 0 ? <span className="text-red-600">{formatDA(c.unpaidBalance)}</span> : <span className="text-muted-foreground">0 DA</span>}</TableCell>
                  <TableCell><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(c.status)}`}>{c.status}</span></TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { openProfile(c); }}>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Profile Sheet */}
      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
          {selectedContact && (
            <ContactProfile
              contact={selectedContact}
              onEdit={() => { openEdit(selectedContact); }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Edit/Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le contact" : "Nouveau contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Client</SelectItem>
                    <SelectItem value="supplier">Fournisseur</SelectItem>
                    <SelectItem value="both">Les deux</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Statut *</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="inactive">Inactif</SelectItem>
                    <SelectItem value="blocked">Bloqué</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Nom affiché *</Label>
              <Input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} placeholder="Nom complet ou entreprise" />
            </div>
            <div>
              <Label>Raison sociale</Label>
              <Input value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Téléphone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Ville</Label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <Label>Plafond crédit (DA)</Label>
                <Input type="number" value={form.creditLimit} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={!form.displayName || createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
