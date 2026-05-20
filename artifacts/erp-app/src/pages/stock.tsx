import { useState } from "react";
import { useGetStockLevels, useGetStockAlerts, useGetStockMovements, useGetBranches } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Package, TrendingDown, Pencil, ArrowRightLeft, Search } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("erp_token") ?? ""}` };
}
async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...authHeaders(), ...opts?.headers } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? `HTTP ${res.status}`); }
  return res.json() as Promise<T>;
}

function statusBadge(status: string) {
  const m: Record<string, { label: string; cls: string }> = {
    ok:       { label: "OK",       cls: "bg-green-100 text-green-800" },
    low:      { label: "Faible",   cls: "bg-amber-100 text-amber-800" },
    critical: { label: "Critique", cls: "bg-red-100 text-red-800" },
    out:      { label: "Épuisé",   cls: "bg-gray-100 text-gray-800" }
  };
  const s = m[status] ?? { label: status, cls: "bg-gray-100" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
function formatDA(n: number) { return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA"; }

type StockLevel = {
  productId: number; productName: string; productType: string;
  branchId: number; branchName: string; quantity: number;
  alertQuantity: number | null; unitName: string; status: string; valueCost: number;
};

export default function Stock() {
  const [branchId, setBranchId] = useState<string>("all");
  const [tab, setTab] = useState("levels");
  const [search, setSearch] = useState("");

  // Edit dialog state
  const [editRow, setEditRow] = useState<StockLevel | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Transfer dialog state
  const [transferRow, setTransferRow] = useState<StockLevel | null>(null);
  const [transferDest, setTransferDest] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [transferring, setTransferring] = useState(false);

  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.adminAccess;

  const { data: branches = [] } = useGetBranches();
  const { data: levels = [], isLoading: loadingLevels, refetch: refetchLevels } = useGetStockLevels(
    branchId !== "all" ? { branchId: parseInt(branchId) } : {}
  );
  const { data: alerts = [] } = useGetStockAlerts();
  const { data: movements = [], isLoading: loadingMov } = useGetStockMovements(
    branchId !== "all" ? { branchId: parseInt(branchId) } : {}
  );

  const alertCount = alerts.length;

  function openEdit(row: StockLevel) {
    setEditRow(row);
    setEditQty(String(row.quantity));
    setEditReason("");
  }

  function openTransfer(row: StockLevel) {
    setTransferRow(row);
    setTransferDest("");
    setTransferQty(String(row.quantity));
    setTransferNotes("");
  }

  async function doTransfer() {
    if (!transferRow) return;
    const qty = parseFloat(transferQty);
    if (!transferDest) { toast({ title: "Choisissez la boutique de destination", variant: "destructive" }); return; }
    if (isNaN(qty) || qty <= 0) { toast({ title: "Quantité invalide", variant: "destructive" }); return; }
    if (qty > transferRow.quantity) { toast({ title: `Maximum disponible : ${transferRow.quantity} ${transferRow.unitName}`, variant: "destructive" }); return; }
    setTransferring(true);
    try {
      await apiFetch("/api/transfers/quick", {
        method: "POST",
        body: JSON.stringify({
          sourceBranchId: transferRow.branchId,
          destinationBranchId: parseInt(transferDest),
          productId: transferRow.productId,
          quantity: qty,
          notes: transferNotes || null,
        }),
      });
      toast({ title: `Transfert effectué : ${qty} ${transferRow.unitName} de ${transferRow.branchName} → ${branches.find(b => b.id === parseInt(transferDest))?.name}` });
      setTransferRow(null);
      refetchLevels();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setTransferring(false);
    }
  }

  async function saveEdit() {
    if (!editRow) return;
    const newQty = parseFloat(editQty);
    if (isNaN(newQty) || newQty < 0) {
      toast({ title: "Quantité invalide", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/stock/${editRow.productId}/${editRow.branchId}`, {
        method: "PATCH",
        body: JSON.stringify({ newQuantity: newQty, reason: editReason || "Correction manuelle" }),
      });
      toast({ title: "Stock mis à jour" });
      setEditRow(null);
      refetchLevels();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Stock</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Niveaux de stock par boutique</p>
        </div>
        <div className="flex gap-2 items-center">
          <ExportButton
            endpoint="export/stock"
            params={{
              branchId: branchId !== "all" ? branchId : undefined,
              alert: tab === "alerts" ? "alert" : undefined,
            }}
            label="Exporter"
          />
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Toutes les boutiques" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9"
          placeholder="Rechercher un produit..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total articles</p><p className="text-2xl font-bold mt-1">{levels.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Valeur stock</p><p className="text-2xl font-bold mt-1">{formatDA(levels.reduce((s, l) => s + l.valueCost, 0))}</p></CardContent></Card>
        <Card className={alertCount > 0 ? "border-red-200 bg-red-50" : ""}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Alertes stock</p><p className={`text-2xl font-bold mt-1 ${alertCount > 0 ? "text-red-600" : ""}`}>{alertCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Produits épuisés</p><p className="text-2xl font-bold mt-1">{levels.filter(l => l.status === "out").length}</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="levels" className="gap-2"><Package className="h-4 w-4" />Niveaux</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <AlertTriangle className="h-4 w-4" />Alertes
            {alertCount > 0 && <Badge variant="destructive" className="text-xs">{alertCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="movements" className="gap-2"><TrendingDown className="h-4 w-4" />Mouvements</TabsTrigger>
        </TabsList>

        <TabsContent value="levels">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead>Boutique</TableHead>
                    <TableHead>Quantité</TableHead>
                    <TableHead>Seuil alerte</TableHead>
                    <TableHead>Valeur</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingLevels ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
                  ) : (() => {
                    const filtered = levels.filter(l => !search || l.productName.toLowerCase().includes(search.toLowerCase()));
                    if (filtered.length === 0) return <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">{search ? `Aucun produit trouvé pour "${search}"` : "Aucun stock"}</TableCell></TableRow>;
                    return filtered.map((l, i) => (
                    <TableRow key={i} className={l.status !== "ok" ? "bg-red-50/30" : ""}>
                      <TableCell className="font-medium text-sm">{l.productName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.branchName}</TableCell>
                      <TableCell className="text-sm font-mono">{l.quantity} {l.unitName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.alertQuantity ? `${l.alertQuantity} ${l.unitName}` : "—"}</TableCell>
                      <TableCell className="text-sm">{formatDA(l.valueCost)}</TableCell>
                      <TableCell>{statusBadge(l.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            title="Transférer vers une autre boutique"
                            onClick={() => openTransfer(l as StockLevel)}
                            disabled={l.quantity <= 0 || branches.filter(b => b.id !== l.branchId).length === 0}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5 text-blue-500" />
                          </Button>
                          {isAdmin && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Modifier le stock" onClick={() => openEdit(l as StockLevel)}>
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ));
                  })()}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead>Boutique</TableHead>
                    <TableHead>Quantité actuelle</TableHead>
                    <TableHead>Seuil alerte</TableHead>
                    <TableHead>Niveau</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12 text-green-600">Aucune alerte — stocks en ordre</TableCell></TableRow>
                  ) : alerts.map((a, i) => (
                    <TableRow key={i} className="bg-amber-50/30">
                      <TableCell className="font-medium text-sm">{a.productName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.branchName}</TableCell>
                      <TableCell className="text-sm font-mono text-red-600">{a.quantity} {a.unitName}</TableCell>
                      <TableCell className="text-sm font-mono">{a.alertQuantity} {a.unitName}</TableCell>
                      <TableCell>{statusBadge(a.alertLevel)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Produit</TableHead>
                    <TableHead>Boutique</TableHead>
                    <TableHead>Quantité</TableHead>
                    <TableHead>Référence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMov ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
                  ) : movements.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(m.createdAt), "dd/MM HH:mm")}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs font-mono">{m.type}</Badge></TableCell>
                      <TableCell className="text-sm">{m.productName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.branchName}</TableCell>
                      <TableCell className={`text-sm font-mono font-medium ${m.quantity < 0 ? "text-red-600" : "text-green-600"}`}>
                        {m.quantity > 0 ? "+" : ""}{m.quantity}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.reference ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Transfer dialog */}
      <Dialog open={!!transferRow} onOpenChange={v => { if (!v) setTransferRow(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-blue-500" />
              Transfert de stock
            </DialogTitle>
          </DialogHeader>
          {transferRow && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm">
                <p className="font-semibold">{transferRow.productName}</p>
                <p className="text-muted-foreground">De : <span className="font-medium text-foreground">{transferRow.branchName}</span></p>
                <p className="mt-1">Stock disponible : <span className="font-mono font-semibold">{transferRow.quantity} {transferRow.unitName}</span></p>
              </div>
              <div>
                <Label>Boutique de destination *</Label>
                <Select value={transferDest} onValueChange={setTransferDest}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choisir une boutique..." /></SelectTrigger>
                  <SelectContent>
                    {branches.filter(b => b.id !== transferRow.branchId).map(b => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Quantité à transférer ({transferRow.unitName}) *</Label>
                <Input
                  type="number"
                  min="0.001"
                  max={transferRow.quantity}
                  step="0.001"
                  value={transferQty}
                  onChange={e => setTransferQty(e.target.value)}
                  className="mt-1"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">Max : {transferRow.quantity} {transferRow.unitName}</p>
              </div>
              <div>
                <Label>Notes (optionnel)</Label>
                <Input
                  value={transferNotes}
                  onChange={e => setTransferNotes(e.target.value)}
                  placeholder="Raison du transfert..."
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferRow(null)}>Annuler</Button>
            <Button onClick={doTransfer} disabled={transferring} className="gap-2">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              {transferring ? "Transfert en cours..." : "Transférer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin edit dialog */}
      <Dialog open={!!editRow} onOpenChange={v => { if (!v) setEditRow(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Modifier le stock</DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <p className="font-semibold">{editRow.productName}</p>
                <p className="text-muted-foreground">{editRow.branchName}</p>
                <p className="mt-1">Quantité actuelle : <span className="font-mono font-semibold">{editRow.quantity} {editRow.unitName}</span></p>
              </div>
              <div>
                <Label>Nouvelle quantité ({editRow.unitName})</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={editQty}
                  onChange={e => setEditQty(e.target.value)}
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div>
                <Label>Raison (optionnel)</Label>
                <Input
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="Ex: Inventaire physique, correction..."
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Annuler</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
