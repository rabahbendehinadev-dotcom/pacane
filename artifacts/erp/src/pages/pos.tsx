import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  useGetProducts, useGetBranches, useCreateSale, useGetContacts,
  useOpenPOSSession, useClosePOSSession,
  useGetPOSSessions, useGetStockLevels,
  getGetSalesQueryKey, getGetStockLevelsQueryKey, getGetPOSSessionsQueryKey, getGetProductsQueryKey,
  getGetContactsQueryKey,
  useGetCompanySettings,
  useCreateContact,
  CreateContactBodyStatus, CreateContactBodyType,
  customFetch,
  type POSSession
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { generatePosReceiptPdf, generateSessionClosurePdf, type SessionClosureData } from "@/lib/pdf-generator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, ShoppingCart, Plus, Minus, Trash2, CreditCard, Banknote, Receipt,
  CheckCircle, Package, Lock, Unlock, Clock, TrendingUp, AlertTriangle, History, X, Ban, Printer, Store,
  UserPlus, ChevronsUpDown, Check, MessageCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { loadTemplates, applyVariables, buildWhatsappUrl } from "@/lib/whatsapp-templates";

type CartItem = { productId: number; name: string; price: number; quantity: number; discount: number };

function formatDA(n: number) {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

function formatTime(iso: string) {
  return format(new Date(iso), "HH:mm", { locale: fr });
}

function formatDate(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: fr });
}

function varianceColor(v: number) {
  if (Math.abs(v) < 100) return "text-green-600";
  if (v < 0) return "text-red-600";
  return "text-amber-600";
}

export default function POS() {
  const qc = useQueryClient();
  const { activeBranchId, user: authUser } = useAuth();

  const [branchId, setBranchId] = useState<string>(activeBranchId?.toString() ?? "");
  const [openSessionOpen, setOpenSessionOpen] = useState(false);
  const [closeSessionOpen, setCloseSessionOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState("0");
  const [countedCash, setCountedCash] = useState("");
  const [closureNotes, setClosureNotes] = useState("");
  const [closureReportOpen, setClosureReportOpen] = useState(false);
  const [closedReport, setClosedReport] = useState<SessionClosureData | null>(null);
  const [tab, setTab] = useState("pos");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [qtyRaw, setQtyRaw] = useState<Record<number, string>>({});

  // ── Cart panel resize (draggable, persisted)
  const [cartWidth, setCartWidth] = useState<number>(() => {
    const saved = localStorage.getItem("pos_cart_width");
    return saved ? Math.max(320, Math.min(650, parseInt(saved))) : 450;
  });
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  useEffect(() => { localStorage.setItem("pos_cart_width", String(cartWidth)); }, [cartWidth]);
  const onResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    isResizing.current = true;
    resizeStartX.current = "touches" in e ? e.touches[0].clientX : e.clientX;
    resizeStartW.current = cartWidth;
    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!isResizing.current) return;
      const cx = ev instanceof TouchEvent ? ev.touches[0].clientX : ev.clientX;
      const newW = Math.max(320, Math.min(650, resizeStartW.current + (resizeStartX.current - cx)));
      setCartWidth(newW);
    };
    const onUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove as any);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove as any);
    document.addEventListener("touchend", onUp);
  }, [cartWidth]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [customerId, setCustomerId] = useState("none");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const [sellerName, setSellerName] = useState<string>("");
  const [creditOverrideReason, setCreditOverrideReason] = useState("");
  const [creditBlockInfo, setCreditBlockInfo] = useState<{ state: string; creditLimit: number | null; unpaidBalance: number; canOverride: boolean } | null>(null);
  const [creditOverrideOpen, setCreditOverrideOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{ ref: string; total: number; change: number; items: CartItem[]; paymentMethod: string; customerName: string | null; branchName: string; branchPhone: string | null; cashierName: string } | null>(null);
  const [clientComboOpen, setClientComboOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [whatsappPopoverOpen, setWhatsappPopoverOpen] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");

  const { data: products = [] } = useGetProducts({});
  const { data: branches = [] } = useGetBranches();
  const { data: customers = [] } = useGetContacts({ type: "customer" });
  const createContactMutation = useCreateContact({
    mutation: {
      onSuccess: (newContact) => {
        qc.invalidateQueries({ queryKey: getGetContactsQueryKey({ type: "customer" }) });
        setCustomerId(String(newContact.id));
        setCreditBlockInfo(null);
        setAddClientOpen(false);
        setNewClientName("");
        setNewClientPhone("");
        toast({ title: "Client ajouté et sélectionné" });
      },
      onError: () => toast({ title: "Erreur", description: "Impossible de créer le client", variant: "destructive" }),
    },
  });
  const { data: companySettings } = useGetCompanySettings();
  const { data: openSessions = [], isLoading: sessionLoading } = useGetPOSSessions(
    branchId ? { branchId: parseInt(branchId), status: "open" } : { status: "open" }
  );
  const { data: allSessions = [] } = useGetPOSSessions(
    branchId ? { branchId: parseInt(branchId) } : undefined
  );

  const effectiveBranchIdNum = branchId ? parseInt(branchId) : (openSessions[0]?.branchId ?? null);
  const { data: branchSellerNames = [] } = useQuery<string[]>({
    queryKey: ["branch-sellers", effectiveBranchIdNum],
    queryFn: () => customFetch<string[]>(`/api/branches/${effectiveBranchIdNum}/sellers`),
    enabled: !!effectiveBranchIdNum,
  });
  const { data: branchStockLevels = [] } = useGetStockLevels(
    effectiveBranchIdNum ? { branchId: effectiveBranchIdNum } : undefined
  );
  const branchStockMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const sl of branchStockLevels) m.set(sl.productId, sl.quantity);
    return m;
  }, [branchStockLevels]);
  const productsWithBranchStock = useMemo(() =>
    effectiveBranchIdNum
      ? products.map(p => ({ ...p, totalStock: p.isManaged ? (branchStockMap.get(p.id) ?? 0) : (p as any).totalStock }))
      : products,
    [products, branchStockMap, effectiveBranchIdNum]
  );

  const creditQueryTotal = Math.max(0, cart.reduce((s, i) => s + i.price * i.quantity - i.discount, 0) - parseFloat(discount || "0"));
  const { data: creditStatus } = useQuery({
    queryKey: ["credit-status", customerId, creditQueryTotal],
    queryFn: async () => {
      const r = await fetch(`/api/contacts/${customerId}/credit-status?amount=${creditQueryTotal}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` }
      });
      if (!r.ok) return null;
      return r.json() as Promise<{ state: string; creditLimit: number | null; unpaidBalance: number; available: number } | null>;
    },
    enabled: !!customerId && customerId !== "none" && creditQueryTotal > 0,
    staleTime: 10000,
  });

  const openMutation = useOpenPOSSession({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPOSSessionsQueryKey() });
        setOpenSessionOpen(false);
        setOpeningCash("0");
        toast({ title: "Caisse ouverte", description: "Vous pouvez maintenant encaisser des ventes." });
      },
      onError: (e: any) => {
        toast({ title: "Erreur", description: (e?.data as any)?.error ?? "Impossible d'ouvrir la session", variant: "destructive" });
      }
    }
  });

  const closeMutation = useClosePOSSession({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getGetPOSSessionsQueryKey() });
        setCloseSessionOpen(false);
        setCountedCash("");
        setClosureNotes("");
        setClosedReport({
          branchName: data.branchName,
          userName: data.userName,
          openedAt: data.openedAt,
          closedAt: data.closedAt ?? new Date().toISOString(),
          openingCash: data.openingCash,
          totalSales: data.totalSales,
          totalCashSales: data.totalCashSales,
          totalCardSales: data.totalCardSales,
          expectedCash: data.expectedCash ?? null,
          countedCash: data.countedCash ?? null,
          variance: data.variance ?? null,
          closureNotes: (data as any).closureNotes ?? null,
        });
        setClosureReportOpen(true);
      }
    }
  });

  const createSale = useCreateSale({
    mutation: {
      onSuccess: (data) => {
        const change = Math.max(0, parseFloat(cashReceived || "0") - total);
        const selBranch = branches.find(b => String(b.id) === (branchId || String(session?.branchId)));
        const selCustomer = customers.find(c => String(c.id) === customerId);
        setLastReceipt({
          ref: data.reference, total, change,
          items: [...cart],
          paymentMethod,
          customerName: selCustomer ? (selCustomer as any).displayName ?? (selCustomer as any).name : null,
          branchName: selBranch?.name ?? "",
          branchPhone: (selBranch as any)?.phone ?? null,
          cashierName: (authUser as any)?.name ?? (authUser as any)?.username ?? "",
        });
        setCart([]); setDiscount("0"); setCustomerId("none"); setCheckoutOpen(false); setSuccessOpen(true);
        setCreditOverrideReason(""); setCreditBlockInfo(null);
        qc.invalidateQueries({ queryKey: getGetSalesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPOSSessionsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetProductsQueryKey() });
        toast({ title: `Vente ${data.reference} enregistrée`, description: `Total: ${formatDA(total)}` });
      },
      onError: (e: any) => {
        const errData = (typeof e?.data === "object" && e.data !== null ? e.data : {}) as any;
        if (errData.error === "credit_exceeded") {
          setCreditBlockInfo({
            state: errData.credit?.state ?? "exceeded",
            creditLimit: errData.credit?.creditLimit ?? null,
            unpaidBalance: errData.credit?.unpaidBalance ?? 0,
            canOverride: errData.credit?.canOverride ?? false,
          });
          setCreditOverrideOpen(true);
        } else if (errData.error === "stock_insufficient") {
          const pid: number | undefined = errData.productId;
          const avail: number = errData.available ?? 0;
          if (pid !== undefined) {
            setCart(c => {
              const updated = c.map(i => i.productId === pid ? { ...i, quantity: Math.min(i.quantity, avail) } : i).filter(i => i.quantity > 0);
              return updated;
            });
          }
          setCheckoutOpen(false);
          toast({ title: "Rupture de stock", description: errData.message ?? "Stock insuffisant pour ce produit", variant: "destructive" });
          qc.invalidateQueries({ queryKey: getGetStockLevelsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetProductsQueryKey() });
        } else {
          const msg = errData.message ?? errData.error ?? e?.message ?? "Impossible d'enregistrer la vente";
          toast({ title: "Erreur", description: msg, variant: "destructive" });
        }
      }
    }
  });

  const session = openSessions[0] as POSSession | undefined;
  const hasOpenSession = !!session;

  const sellableProducts = productsWithBranchStock.filter(p =>
    p.isSellable &&
    (!p.isManaged || (p as any).totalStock > 0) &&
    (search === "" ||
      p.name.trim().toLowerCase().startsWith(search.trim().toLowerCase()) ||
      ((p as any).barcode && (p as any).barcode === search.trim())) &&
    (categoryFilter === "" || p.categoryId?.toString() === categoryFilter)
  );
  const categories = [...new Map(
    productsWithBranchStock.filter(p => p.isSellable && p.categoryId && (!p.isManaged || (p as any).totalStock > 0))
      .map(p => [p.categoryId, { id: p.categoryId!, name: p.categoryName ?? "" }])
  ).values()];

  function getStock(p: typeof productsWithBranchStock[0]) {
    return p.isManaged ? ((p as any).totalStock ?? 0) : Infinity;
  }
  function addToCart(p: typeof productsWithBranchStock[0]) {
    const maxQty = getStock(p);
    if (p.isManaged && maxQty <= 0) {
      toast({ title: "Stock insuffisant", description: `${p.name} est en rupture de stock`, variant: "destructive" });
      return;
    }
    setCart(c => {
      const existing = c.find(i => i.productId === p.id);
      if (existing) {
        if (existing.quantity >= maxQty) return c;
        return c.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...c, { productId: p.id, name: p.name, price: parseFloat(p.sellingPrice?.toString() ?? "0"), quantity: 1, discount: 0 }];
    });
    setSearch("");
  }
  function updateQty(id: number, delta: number) {
    const product = productsWithBranchStock.find(p => p.id === id);
    const maxQty = product ? getStock(product) : Infinity;
    setCart(c => c.map(i => i.productId === id
      ? { ...i, quantity: Math.min(maxQty, Math.max(0, i.quantity + delta)) }
      : i
    ).filter(i => i.quantity > 0));
  }
  function removeItem(id: number) { setCart(c => c.filter(i => i.productId !== id)); }

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity - i.discount, 0);
  const discountAmt = parseFloat(discount || "0");
  const total = Math.max(0, subtotal - discountAmt);
  const change = Math.max(0, parseFloat(cashReceived || "0") - total);

  function confirmSale(overrideReason?: string) {
    createSale.mutate({
      data: {
        type: "sale", customerId: customerId && customerId !== "none" ? parseInt(customerId) : null,
        branchId: parseInt((branchId || session?.branchId?.toString()) ?? "1"),
        status: "confirmed", fulfillmentType: "pos",
        paymentMethod: paymentMethod as any,
        discount: discountAmt, tax: 0, shippingFee: 0, notes: null,
        creditOverrideReason: overrideReason || undefined,
        sellerName: sellerName.trim() || undefined,
        items: cart.map(i => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.price, discount: i.discount }))
      } as any
    });
  }

  const effectiveBranchId = branchId || session?.branchId?.toString() || "";

  // Branch POS status
  const posBranches = branches.filter(b => (b as any).posEnabled !== false && (b as any).salesActive !== false);
  const selectedBranch = branches.find(b => String(b.id) === effectiveBranchId);
  const isLabo = !!(selectedBranch && (
    (selectedBranch as any).type === "labo" ||
    selectedBranch.name.toLowerCase().includes("labo") ||
    selectedBranch.name.toLowerCase().includes("ecole") ||
    selectedBranch.name.toLowerCase().includes("école")
  ));
  const branchPosEnabled = !selectedBranch || (selectedBranch as any).posEnabled !== false;
  const branchSalesActive = !selectedBranch || (selectedBranch as any).salesActive !== false;
  const branchPosBlocked = !!selectedBranch && (!branchPosEnabled || !branchSalesActive);
  const requiresSession = !!selectedBranch && (selectedBranch as any).requireOpenSession === true;

  if (sessionLoading) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center -m-6">
        <div className="text-muted-foreground text-sm">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50">
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col h-full">
        <div className="bg-white border-b px-4 py-2 flex items-center gap-4 shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="pos" className="text-xs gap-1.5"><ShoppingCart className="h-3.5 w-3.5" />Caisse</TabsTrigger>
            <TabsTrigger value="sessions" className="text-xs gap-1.5"><History className="h-3.5 w-3.5" />Sessions</TabsTrigger>
          </TabsList>

          {branches.length > 1 && (
            <Select
              value={branchId}
              onValueChange={(v) => {
                setBranchId(v);
                setCart([]);
                setDiscount("0");
                setCustomerId("none");
                setCategoryFilter("");
                setSearch("");
              }}
            >
              <SelectTrigger className="h-7 text-xs w-[160px] gap-1.5">
                <Store className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Choisir boutique..." />
              </SelectTrigger>
              <SelectContent>
                {branches.map(b => (
                  <SelectItem key={b.id} value={String(b.id)} className="text-xs">
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="ml-auto flex items-center gap-3">
            {hasOpenSession && session ? (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="font-medium text-green-700">Session ouverte</span>
                  <span>·</span>
                  <span>{session.branchName}</span>
                  <span>·</span>
                  <Clock className="h-3 w-3" />
                  <span>{formatTime(session.openedAt)}</span>
                  <span>·</span>
                  <TrendingUp className="h-3 w-3 text-primary" />
                  <span className="font-semibold text-foreground">{formatDA(session.totalSales)}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => { setCountedCash(""); setCloseSessionOpen(true); }}
                >
                  <Lock className="h-3 w-3" />Fermer la caisse
                </Button>
              </>
            ) : branchPosBlocked ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Ban className="h-3.5 w-3.5" />
                {!branchSalesActive ? "Ventes désactivées" : "POS non activé"}
              </span>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => setOpenSessionOpen(true)}
              >
                <Unlock className="h-3 w-3" />Ouvrir la caisse
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="pos" className="flex-1 overflow-hidden m-0">
          {branchPosBlocked ? (
            /* Branch has POS disabled or sales inactive */
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="h-20 w-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <Ban className="h-10 w-10 text-gray-400" />
                </div>
                <h2 className="text-xl font-semibold mb-2">
                  {!branchSalesActive ? "Ventes désactivées" : "POS non activé"}
                </h2>
                <p className="text-muted-foreground text-sm mb-4">
                  {!branchSalesActive
                    ? `La boutique "${selectedBranch?.name}" n'est pas configurée pour les ventes clients. Il s'agit probablement d'un laboratoire ou d'un siège administratif.`
                    : `Le point de vente n'est pas activé pour la boutique "${selectedBranch?.name}". Contactez votre administrateur pour activer le POS.`
                  }
                </p>
                {posBranches.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-2">Changer de boutique :</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {posBranches.map(b => (
                        <Button key={b.id} variant="outline" size="sm" className="text-xs" onClick={() => setBranchId(String(b.id))}>
                          {b.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : requiresSession && !hasOpenSession ? (
            /* Branch requires open session — specific message */
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="h-20 w-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                  <Clock className="h-10 w-10 text-amber-600" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Session de caisse requise</h2>
                <p className="text-muted-foreground text-sm mb-2">
                  La boutique <span className="font-semibold">{selectedBranch?.name}</span> exige l'ouverture d'une session de caisse avant toute vente.
                </p>
                <p className="text-muted-foreground text-xs mb-6">
                  Cette règle garantit le contrôle des espèces et la traçabilité des ventes de la journée.
                </p>
                <Button className="gap-2" onClick={() => setOpenSessionOpen(true)}>
                  <Unlock className="h-4 w-4" />Ouvrir la session de caisse
                </Button>
              </div>
            </div>
          ) : !hasOpenSession ? (
            /* Normal "caisse fermée" screen (no session required, just not open) */
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="h-20 w-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                  <Lock className="h-10 w-10 text-amber-600" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Caisse fermée</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  Ouvrez une session de caisse pour commencer à encaisser des ventes.
                </p>
                <Button className="gap-2" onClick={() => setOpenSessionOpen(true)}>
                  <Unlock className="h-4 w-4" />Ouvrir la caisse
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-full flex gap-0 overflow-hidden">
              <div className="flex-1 hidden sm:flex flex-col min-w-0 bg-white border-r">
                <div className="flex items-center gap-3 p-3 border-b bg-white">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Nom ou code-barres..." className="pl-9 h-9" value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2 px-4 py-2 border-b overflow-x-auto shrink-0">
                  <button
                    className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${categoryFilter === "" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
                    onClick={() => setCategoryFilter("")}
                  >Tous</button>
                  {categories.map(c => (
                    <button
                      key={c.id}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${categoryFilter === String(c.id) ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
                      onClick={() => setCategoryFilter(String(c.id))}
                    >{c.name}</button>
                  ))}
                </div>
                <ScrollArea className="flex-1">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-4">
                    {sellableProducts.map(p => (
                      <button key={p.id} onClick={() => addToCart(p)} className="group rounded-xl border bg-white hover:border-primary hover:shadow-md transition-all text-left overflow-hidden">
                        <div className="w-full aspect-square bg-amber-50 flex items-center justify-center overflow-hidden relative">
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              onError={e => { const el = e.target as HTMLImageElement; el.style.display = "none"; el.parentElement?.querySelector(".pos-fallback-icon")?.classList.remove("hidden"); }}
                            />
                          ) : null}
                          <Package className={`pos-fallback-icon h-8 w-8 text-amber-400 ${p.imageUrl ? "hidden" : ""}`} />
                        </div>
                        <div className="p-2">
                          <p className="text-xs font-semibold leading-tight line-clamp-2">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{p.categoryName ?? ""}</p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-sm font-bold text-primary">{formatDA(parseFloat(p.sellingPrice?.toString() ?? "0"))}</p>
                            {p.isManaged && (
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${(p as any).totalStock <= 3 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}`}>
                                {(p as any).totalStock}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                    {sellableProducts.length === 0 && (
                      <div className="col-span-5 text-center py-16 text-muted-foreground">Aucun produit disponible en stock</div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div
                className="pos-cart-panel flex flex-col bg-white shrink-0 relative border-l"
                style={{ width: cartWidth }}
              >
                {/* Draggable resize handle */}
                <div
                  className="pos-resize-handle absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group select-none"
                  onMouseDown={onResizeStart}
                  onTouchStart={onResizeStart}
                >
                  <div className="absolute inset-y-0 left-0 w-full group-hover:bg-primary/30 group-active:bg-primary/60 transition-colors" />
                </div>
                <div className="flex items-center gap-2 p-4 border-b">
                  <ShoppingCart className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold">Panier</h2>
                  <Badge variant="secondary" className="ml-auto">{cart.reduce((s, i) => s + i.quantity, 0)} art.</Badge>
                </div>

                <div className="px-4 pt-3 pb-0 space-y-2">
                  <div className="flex gap-1.5">
                    <Popover open={clientComboOpen} onOpenChange={setClientComboOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={clientComboOpen}
                          className="flex-1 h-8 text-xs justify-between font-normal overflow-hidden"
                        >
                          <span className="truncate">
                            {customerId === "none"
                              ? "Comptoir"
                              : (customers.find(c => String(c.id) === customerId) as any)?.displayName ?? "Client..."}
                          </span>
                          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Rechercher un client..." className="h-8 text-xs" />
                          <CommandList>
                            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">Aucun client trouvé.</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value="comptoir"
                                onSelect={() => { setCustomerId("none"); setCreditBlockInfo(null); setClientComboOpen(false); }}
                                className="text-xs cursor-pointer"
                              >
                                <Check className={`mr-2 h-3.5 w-3.5 ${customerId === "none" ? "opacity-100" : "opacity-0"}`} />
                                Comptoir
                              </CommandItem>
                              {customers.map(c => {
                                const cAny = c as any;
                                const searchVal = [cAny.displayName, cAny.phone].filter(Boolean).join(" ");
                                return (
                                  <CommandItem
                                    key={c.id}
                                    value={searchVal}
                                    onSelect={() => { setCustomerId(String(c.id)); setCreditBlockInfo(null); setClientComboOpen(false); }}
                                    className="text-xs cursor-pointer"
                                  >
                                    <Check className={`mr-2 h-3.5 w-3.5 ${customerId === String(c.id) ? "opacity-100" : "opacity-0"}`} />
                                    <span className="flex-1 truncate">{cAny.displayName}</span>
                                    {cAny.phone && <span className="ml-2 text-[10px] text-muted-foreground shrink-0">{cAny.phone}</span>}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="Nouveau client"
                      onClick={() => setAddClientOpen(true)}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {customerId !== "none" && creditStatus && (
                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs ${
                      creditStatus.state === "exceeded" ? "bg-red-50 text-red-700 border border-red-200" :
                      creditStatus.state === "warning" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                      "bg-green-50 text-green-700 border border-green-200"
                    }`}>
                      <AlertTriangle className={`h-3 w-3 shrink-0 ${creditStatus.state === "ok" ? "hidden" : ""}`} />
                      {creditStatus.state === "exceeded" ? (
                        <span>⚠ Limite dépassée · Impayé: {formatDA(creditStatus.unpaidBalance)}{creditStatus.creditLimit !== null ? ` / Limite: ${formatDA(creditStatus.creditLimit)}` : ""}</span>
                      ) : creditStatus.state === "warning" ? (
                        <span>Crédit limité · Disponible: {formatDA(creditStatus.available)}</span>
                      ) : (
                        <span>✓ Crédit OK · Disponible: {formatDA(creditStatus.available)}</span>
                      )}
                    </div>
                  )}
                </div>

                <ScrollArea className="flex-1 px-4 py-3">
                  {cart.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">Le panier est vide</div>
                  ) : (
                    <div className="space-y-2">
                      {cart.map(item => (
                        <div key={item.productId} className="py-2 border-b last:border-0" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px", alignItems: "center" }}>
                          <div style={{ minWidth: 0 }}>
                            <p className="text-sm font-medium" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.name}>{item.name}</p>
                            <p className="text-xs text-primary">{formatDA(item.price)}</p>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
                            <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQty(item.productId, -1)}><Minus className="h-3 w-3" /></Button>
                            {isLabo ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                style={{ width: "48px", height: "24px", textAlign: "center", fontSize: "13px", fontWeight: 500, border: "1px solid hsl(var(--border))", borderRadius: "4px", background: "hsl(var(--background))", padding: "0 2px" }}
                                value={qtyRaw[item.productId] ?? String(item.quantity)}
                                onChange={e => {
                                  const val = e.target.value.replace(",", ".");
                                  if (!/^-?\d*\.?\d*$/.test(val)) return;
                                  setQtyRaw(prev => ({ ...prev, [item.productId]: val }));
                                  const parsed = parseFloat(val);
                                  if (!isNaN(parsed) && parsed > 0) {
                                    const p = productsWithBranchStock.find(x => x.id === item.productId);
                                    const maxQty = p?.isManaged ? getStock(p) : Infinity;
                                    setCart(c => c.map(i => i.productId === item.productId ? { ...i, quantity: Math.min(maxQty, parsed) } : i));
                                  }
                                }}
                                onBlur={e => {
                                  setQtyRaw(prev => { const n = { ...prev }; delete n[item.productId]; return n; });
                                  const parsed = parseFloat(e.target.value.replace(",", "."));
                                  if (!parsed || parsed <= 0) removeItem(item.productId);
                                }}
                              />
                            ) : (
                              <span className="w-5 text-center text-sm font-medium">{item.quantity}</span>
                            )}
                            <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQty(item.productId, 1)}
                              disabled={(() => { const p = productsWithBranchStock.find(x => x.id === item.productId); return !!p?.isManaged && item.quantity >= ((p as any).totalStock ?? 0); })()}
                            ><Plus className="h-3 w-3" /></Button>
                            <span className="text-xs font-semibold text-right" style={{ minWidth: "52px" }}>{formatDA(item.price * item.quantity)}</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item.productId)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>

                <div className="border-t p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground w-24">Remise (DA)</Label>
                    <Input type="number" className="h-8 text-sm" value={discount} onChange={e => setDiscount(e.target.value)} />
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Sous-total</span><span>{formatDA(subtotal)}</span></div>
                  {discountAmt > 0 && <div className="flex justify-between text-sm text-green-600"><span>Remise</span><span>-{formatDA(discountAmt)}</span></div>}
                  <div className="flex justify-between text-base font-bold"><span>Total</span><span className="text-primary text-lg">{formatDA(total)}</span></div>
                  <Button
                    className="w-full gap-2 h-12 text-base"
                    disabled={cart.length === 0}
                    onClick={() => { setCashReceived(total.toString()); setCheckoutOpen(true); }}
                  >
                    <CreditCard className="h-5 w-5" />Encaisser
                  </Button>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="sessions" className="flex-1 overflow-auto m-0 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Sessions de caisse</h2>
                <p className="text-sm text-muted-foreground">Historique des ouvertures/fermetures de caisse</p>
              </div>
              {branchId && (
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{posBranches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-3">
              {allSessions.length === 0 && (
                <div className="text-center py-16 text-muted-foreground text-sm">Aucune session trouvée</div>
              )}
              {allSessions.map(s => {
                const isOpen = s.status === "open";
                const variance = s.variance;
                return (
                  <Card key={s.id} className={isOpen ? "border-green-200 bg-green-50/30" : ""}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${isOpen ? "bg-green-100" : "bg-gray-100"}`}>
                          {isOpen ? <Unlock className="h-5 w-5 text-green-600" /> : <Lock className="h-5 w-5 text-gray-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{s.branchName}</span>
                            <Badge variant={isOpen ? "default" : "secondary"} className="text-[10px]">
                              {isOpen ? "Ouverte" : "Fermée"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">par {s.userName}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>Ouverture: <strong className="text-foreground">{formatDate(s.openedAt)}</strong></span>
                            {s.closedAt && <span>Fermeture: <strong className="text-foreground">{formatDate(s.closedAt)}</strong></span>}
                            <span>Fond initial: <strong className="text-foreground">{formatDA(s.openingCash)}</strong></span>
                          </div>
                        </div>
                        <div className="flex gap-6 shrink-0 text-right">
                          <div>
                            <p className="text-xs text-muted-foreground">Total ventes</p>
                            <p className="font-semibold text-sm">{formatDA(s.totalSales)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Espèces</p>
                            <p className="font-semibold text-sm">{formatDA(s.totalCashSales)}</p>
                          </div>
                          {!isOpen && s.variance !== null && (
                            <div>
                              <p className="text-xs text-muted-foreground">Écart</p>
                              <p className={`font-semibold text-sm ${varianceColor(s.variance!)}`}>
                                {s.variance! >= 0 ? "+" : ""}{formatDA(s.variance!)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      {!isOpen && s.expectedCash !== null && s.countedCash !== null && (
                        <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-4 text-xs">
                          <div><span className="text-muted-foreground">Espèces attendues</span><p className="font-medium">{formatDA(s.expectedCash)}</p></div>
                          <div><span className="text-muted-foreground">Espèces comptées</span><p className="font-medium">{formatDA(s.countedCash)}</p></div>
                          <div>
                            <span className="text-muted-foreground">Écart</span>
                            <p className={`font-semibold ${varianceColor(s.variance ?? 0)}`}>
                              {(s.variance ?? 0) >= 0 ? "+" : ""}{formatDA(s.variance ?? 0)}
                              {Math.abs(s.variance ?? 0) > 500 && (
                                <AlertTriangle className="h-3 w-3 inline ml-1" />
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={openSessionOpen} onOpenChange={setOpenSessionOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Unlock className="h-5 w-5 text-primary" />Ouvrir la caisse</DialogTitle>
            <DialogDescription>Définissez le fond de caisse initial (monnaie disponible) avant de commencer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Boutique</Label>
              <Select value={effectiveBranchId} onValueChange={setBranchId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choisir une boutique" /></SelectTrigger>
                <SelectContent>{posBranches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fond de caisse initial (DA)</Label>
              <Input
                type="number"
                className="mt-1 text-lg h-12 font-semibold"
                value={openingCash}
                onChange={e => setOpeningCash(e.target.value)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground mt-1">Montant en espèces présent dans le tiroir au début de la session.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSessionOpen(false)}>Annuler</Button>
            <Button
              className="gap-2"
              disabled={!effectiveBranchId || openMutation.isPending}
              onClick={() => openMutation.mutate({ data: { branchId: parseInt(effectiveBranchId), openingCash: parseFloat(openingCash || "0") } })}
            >
              <Unlock className="h-4 w-4" />{openMutation.isPending ? "Ouverture..." : "Ouvrir la caisse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeSessionOpen} onOpenChange={setCloseSessionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-red-500" />Fermer la caisse</DialogTitle>
            <DialogDescription>Comptez vos espèces et saisissez le montant réel trouvé dans le tiroir.</DialogDescription>
          </DialogHeader>
          {session && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Fond initial</span><span className="font-medium">{formatDA(session.openingCash)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Ventes espèces</span><span className="font-medium text-green-600">+{formatDA(session.totalCashSales)}</span></div>
                <div className="flex justify-between border-t pt-2"><span className="font-medium">Espèces attendues</span><span className="font-bold">{formatDA(session.openingCash + session.totalCashSales)}</span></div>
              </div>

              <div>
                <Label className="font-medium">Espèces comptées dans le tiroir (DA)</Label>
                <Input
                  type="number"
                  className="mt-1 text-lg h-12 font-semibold"
                  value={countedCash}
                  onChange={e => setCountedCash(e.target.value)}
                  placeholder="0"
                />
              </div>

              {countedCash !== "" && (
                <div className={`rounded-lg p-3 text-center ${Math.abs(parseFloat(countedCash) - (session.openingCash + session.totalCashSales)) < 100 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                  <p className="text-xs text-muted-foreground mb-0.5">Écart de caisse</p>
                  {(() => {
                    const expected = session.openingCash + session.totalCashSales;
                    const counted = parseFloat(countedCash || "0");
                    const diff = counted - expected;
                    return (
                      <p className={`text-lg font-bold ${varianceColor(diff)}`}>
                        {diff >= 0 ? "+" : ""}{formatDA(diff)}
                        {Math.abs(diff) > 500 && <AlertTriangle className="h-4 w-4 inline ml-2" />}
                      </p>
                    );
                  })()}
                </div>
              )}

              <div>
                <Label>Notes de fermeture (optionnel)</Label>
                <Input className="mt-1" value={closureNotes} onChange={e => setClosureNotes(e.target.value)} placeholder="Remarques..." />
              </div>

              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground mb-3 font-medium">Résumé de la session</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="text-center p-2 bg-muted/30 rounded-lg">
                    <p className="text-xs text-muted-foreground">Total ventes</p>
                    <p className="font-bold">{formatDA(session.totalSales)}</p>
                  </div>
                  <div className="text-center p-2 bg-muted/30 rounded-lg">
                    <p className="text-xs text-muted-foreground">Espèces</p>
                    <p className="font-bold">{formatDA(session.totalCashSales)}</p>
                  </div>
                  <div className="text-center p-2 bg-muted/30 rounded-lg">
                    <p className="text-xs text-muted-foreground">Carte</p>
                    <p className="font-bold">{formatDA(session.totalCardSales)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseSessionOpen(false)}>Annuler</Button>
            <Button
              variant="destructive"
              className="gap-2"
              disabled={!countedCash || closeMutation.isPending || !session}
              onClick={() => closeMutation.mutate({ id: session!.id, data: { countedCash: parseFloat(countedCash), closureNotes: closureNotes || null } })}
            >
              <Lock className="h-4 w-4" />{closeMutation.isPending ? "Fermeture..." : "Confirmer la fermeture"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rapport de fermeture de caisse ── */}
      <Dialog open={closureReportOpen} onOpenChange={setClosureReportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Printer className="h-5 w-5 text-primary" />
              Rapport de fermeture
            </DialogTitle>
            <DialogDescription>Résumé complet de la session. Imprimez-le pour vos archives.</DialogDescription>
          </DialogHeader>
          {closedReport && (
            <div className="space-y-4 py-1">
              {/* Infos session */}
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Boutique</span><span className="font-medium">{closedReport.branchName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Caissier(ère)</span><span className="font-medium">{closedReport.userName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Ouverture</span><span className="font-medium">{formatDate(closedReport.openedAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fermeture</span><span className="font-medium">{closedReport.closedAt ? formatDate(closedReport.closedAt) : "—"}</span></div>
              </div>

              {/* Ventes */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Résumé des ventes</div>
                <div className="rounded-lg border overflow-hidden text-sm">
                  <div className="flex justify-between px-3 py-2 bg-muted/20">
                    <span className="text-muted-foreground">Espèces (نقداً)</span>
                    <span className="font-medium">{formatDA(closedReport.totalCashSales)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-muted-foreground">Carte bancaire</span>
                    <span className="font-medium">{formatDA(closedReport.totalCardSales)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2.5 bg-primary/10 border-t font-semibold">
                    <span>Total ventes</span>
                    <span className="text-primary">{formatDA(closedReport.totalSales)}</span>
                  </div>
                </div>
              </div>

              {/* État caisse */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">État de la caisse</div>
                <div className="rounded-lg border overflow-hidden text-sm">
                  <div className="flex justify-between px-3 py-2 bg-muted/20">
                    <span className="text-muted-foreground">Fond initial</span>
                    <span className="font-medium">{formatDA(closedReport.openingCash)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-muted-foreground">+ Ventes espèces</span>
                    <span className="font-medium text-green-600">+{formatDA(closedReport.totalCashSales)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-muted/20">
                    <span className="text-muted-foreground">= Attendues dans le tiroir</span>
                    <span className="font-semibold">{formatDA(closedReport.expectedCash ?? 0)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-muted-foreground">Espèces comptées (réel)</span>
                    <span className="font-medium">{formatDA(closedReport.countedCash ?? 0)}</span>
                  </div>
                  <div className={`flex justify-between px-3 py-2.5 border-t font-bold ${Math.abs(closedReport.variance ?? 0) < 100 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                    <span>Écart de caisse</span>
                    <span>{(closedReport.variance ?? 0) >= 0 ? "+" : ""}{formatDA(closedReport.variance ?? 0)}</span>
                  </div>
                </div>
              </div>

              {closedReport.closureNotes && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <div className="text-xs font-semibold text-amber-700 mb-1">Notes de fermeture</div>
                  <div className="text-amber-900">{closedReport.closureNotes}</div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClosureReportOpen(false)}>Fermer</Button>
            <Button
              className="gap-2"
              onClick={() => {
                if (!closedReport || !companySettings) return;
                generateSessionClosurePdf(closedReport, companySettings as any);
              }}
              disabled={!closedReport || !companySettings}
            >
              <Printer className="h-4 w-4" />Imprimer le rapport
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Encaisser</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="text-center py-2 bg-primary/5 rounded-lg">
              <p className="text-sm text-muted-foreground">Total à payer</p>
              <p className="text-3xl font-bold text-primary">{formatDA(total)}</p>
            </div>
            <div className="relative">
              <Label>Vendeur <span className="text-red-500">*</span></Label>
              <Input
                className="mt-1"
                placeholder={branchSellerNames.length > 0 ? "Rechercher un vendeur..." : "Ex: Ahmed, Karim..."}
                value={sellerName}
                onChange={e => setSellerName(e.target.value)}
                autoFocus
                autoComplete="off"
              />
              {branchSellerNames.length > 0 && (() => {
                const q = sellerName.trim().toLowerCase();
                const filtered = branchSellerNames.filter(n => n.toLowerCase().includes(q));
                if (filtered.length === 0) return null;
                return (
                  <div className="mt-1 rounded-md border bg-white shadow-md overflow-hidden">
                    <ScrollArea className="max-h-40">
                      {filtered.map(name => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); setSellerName(name); }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-b last:border-b-0 ${
                            sellerName === name
                              ? "bg-primary text-primary-foreground font-medium"
                              : "hover:bg-muted/60"
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </ScrollArea>
                  </div>
                );
              })()}
            </div>
            <div>
              <Label>Moyen de paiement</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {[{ v: "cash", label: "Espèces", icon: Banknote }, { v: "card", label: "Carte", icon: CreditCard }, { v: "credit", label: "Crédit", icon: Receipt }].map(m => (
                  <button key={m.v} onClick={() => setPaymentMethod(m.v)} className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-sm font-medium transition-colors ${paymentMethod === m.v ? "border-primary bg-primary/5 text-primary" : "border-muted hover:bg-muted/50"}`}>
                    <m.icon className="h-5 w-5" />{m.label}
                  </button>
                ))}
              </div>
            </div>
            {paymentMethod === "cash" && (
              <div>
                <Label>Montant reçu (DA)</Label>
                <Input type="number" className="text-lg font-bold h-12 mt-1" value={cashReceived} onChange={e => setCashReceived(e.target.value)} />
                {parseFloat(cashReceived || "0") >= total && (
                  <div className="mt-2 p-2 bg-green-50 rounded text-center text-sm font-semibold text-green-700">
                    Monnaie à rendre: {formatDA(change)}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)}>Annuler</Button>
            <Button
              className="gap-2"
              onClick={() => confirmSale()}
              disabled={
                createSale.isPending ||
                !sellerName.trim() ||
                (paymentMethod === "cash" && parseFloat(cashReceived || "0") < total)
              }
            >
              <CheckCircle className="h-4 w-4" />{createSale.isPending ? "Enregistrement..." : "Confirmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creditOverrideOpen} onOpenChange={open => { if (!open) { setCreditOverrideOpen(false); setCreditBlockInfo(null); setCreditOverrideReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> Limite de crédit dépassée
            </DialogTitle>
            <DialogDescription>
              {creditBlockInfo && (
                <span>
                  Solde impayé: <strong>{formatDA(creditBlockInfo.unpaidBalance)}</strong>
                  {creditBlockInfo.creditLimit !== null && <> · Limite: <strong>{formatDA(creditBlockInfo.creditLimit)}</strong></>}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {creditBlockInfo?.canOverride ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Vous avez l'autorisation de passer outre. Saisissez le motif :</p>
              <Textarea
                placeholder="Ex: Client autorisé par le gérant..."
                value={creditOverrideReason}
                onChange={e => setCreditOverrideReason(e.target.value)}
                rows={3}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => { setCreditOverrideOpen(false); setCreditBlockInfo(null); }}>Annuler</Button>
                <Button
                  variant="destructive"
                  disabled={!creditOverrideReason.trim() || createSale.isPending}
                  onClick={() => { setCreditOverrideOpen(false); setCheckoutOpen(false); confirmSale(creditOverrideReason); }}
                >
                  Forcer la vente
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-red-700 font-medium">Vente bloquée — Vous n'avez pas l'autorisation de dépasser la limite de crédit.</p>
              <p className="text-xs text-muted-foreground">Contactez un gérant ou administrateur pour débloquer cette vente.</p>
              <DialogFooter>
                <Button onClick={() => { setCreditOverrideOpen(false); setCreditBlockInfo(null); }}>Compris</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {lastReceipt && (
        <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
          <DialogContent className="max-w-sm text-center">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <DialogHeader>
                <DialogTitle className="text-xl">Vente enregistrée!</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground font-mono">{lastReceipt.ref}</p>
              <p className="text-2xl font-bold text-primary">{formatDA(lastReceipt.total)}</p>
              {lastReceipt.change > 0 && (
                <div className="bg-green-50 rounded-lg px-6 py-3">
                  <p className="text-sm text-muted-foreground">Monnaie à rendre</p>
                  <p className="text-xl font-bold text-green-700">{formatDA(lastReceipt.change)}</p>
                </div>
              )}
              <div className="w-full flex flex-col gap-2 mt-2">
                <Button
                  variant="outline" className="w-full gap-2"
                  onClick={() => {
                    if (!lastReceipt || !companySettings) return;
                    generatePosReceiptPdf({
                      reference: lastReceipt.ref,
                      createdAt: new Date().toISOString(),
                      branchName: lastReceipt.branchName,
                      branchPhone: lastReceipt.branchPhone,
                      cashierName: lastReceipt.cashierName || null,
                      customerName: lastReceipt.customerName,
                      items: lastReceipt.items.map(i => ({
                        productName: i.name,
                        quantity: i.quantity,
                        unitPrice: i.price,
                        discount: i.discount,
                        total: i.price * i.quantity - i.discount,
                      })),
                      subtotal: lastReceipt.total,
                      discount: 0,
                      total: lastReceipt.total,
                      paid: lastReceipt.total + lastReceipt.change,
                      change: lastReceipt.change,
                      paymentMethod: lastReceipt.paymentMethod,
                    }, companySettings as any, "ticket");
                  }}
                >
                  <Printer className="h-4 w-4" />Imprimer le reçu
                </Button>
                {(() => {
                  const selectedCustomer = customerId !== "none"
                    ? customers.find(c => String(c.id) === customerId)
                    : null;
                  const phone = selectedCustomer ? (selectedCustomer as any).phone as string | null : null;
                  if (!phone) return null;
                  const templates = loadTemplates();
                  return (
                    <Popover open={whatsappPopoverOpen} onOpenChange={setWhatsappPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full gap-2 border-green-500 text-green-600 hover:bg-green-50 hover:text-green-700">
                          <MessageCircle className="h-4 w-4" />
                          Envoyer WhatsApp
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-2" align="center">
                        <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
                          Choisir un modèle — {phone}
                        </p>
                        {templates.length === 0 ? (
                          <p className="text-xs text-muted-foreground px-2 py-2">
                            Aucun modèle. Créez-en un dans Modèles WhatsApp.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {templates.map(tpl => {
                              const msg = applyVariables(tpl.message, {
                                client: lastReceipt?.customerName ?? (selectedCustomer as any).displayName ?? "",
                                montant: lastReceipt ? String(lastReceipt.total) : "",
                                ref: lastReceipt?.ref ?? "",
                              });
                              return (
                                <button
                                  key={tpl.id}
                                  className="w-full text-left rounded px-3 py-2 hover:bg-muted transition-colors"
                                  onClick={() => {
                                    window.open(buildWhatsappUrl(phone, msg), "_blank");
                                    setWhatsappPopoverOpen(false);
                                  }}
                                >
                                  <p className="text-sm font-medium flex items-center gap-1.5">
                                    <MessageCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                    {tpl.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{msg}</p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  );
                })()}
                <Button className="w-full" onClick={() => setSuccessOpen(false)}>Nouvelle vente</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Quick add client dialog ───────────────────────────────────────── */}
      <Dialog open={addClientOpen} onOpenChange={setAddClientOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Nouveau client
            </DialogTitle>
            <DialogDescription>Ajoutez un client rapide depuis la caisse.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Nom *</Label>
              <Input
                className="h-8 text-sm"
                placeholder="Nom du client"
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newClientName.trim()) {
                    createContactMutation.mutate({ data: { displayName: newClientName.trim(), type: CreateContactBodyType.customer, status: CreateContactBodyStatus.active, phone: newClientPhone.trim() || null } });
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Téléphone *</Label>
              <Input
                className="h-8 text-sm"
                placeholder="0XXX XXX XXX"
                value={newClientPhone}
                onChange={e => setNewClientPhone(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newClientName.trim() && newClientPhone.trim()) {
                    createContactMutation.mutate({ data: { displayName: newClientName.trim(), type: CreateContactBodyType.customer, status: CreateContactBodyStatus.active, phone: newClientPhone.trim() } });
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddClientOpen(false)}>Annuler</Button>
            <Button
              size="sm"
              disabled={!newClientName.trim() || !newClientPhone.trim() || createContactMutation.isPending}
              onClick={() => createContactMutation.mutate({ data: { displayName: newClientName.trim(), type: CreateContactBodyType.customer, status: CreateContactBodyStatus.active, phone: newClientPhone.trim() } })}
            >
              {createContactMutation.isPending ? "Ajout..." : "Ajouter et sélectionner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
