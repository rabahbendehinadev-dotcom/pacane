import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetCompanySettings, useUpdateCompanySettings, getGetCompanySettingsQueryKey, customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  Save, Globe, Building2, Hash, CreditCard, Banknote, FileText,
  Plus, Pencil, Trash2, CheckCircle2, XCircle, GripVertical,
  Receipt, ShoppingCart, ArrowLeftRight, Factory, Package, Wallet,
  RotateCcw, AlertTriangle
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface CompanySettings {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  website: string | null;
  taxId: string | null;
  currency: string;
  currencySymbol: string;
  defaultLanguage: string;
  taxRate: number;
  taxEnabled: boolean;
  invoicePrefix: string;
  quotePrefix: string;
  orderPrefix: string;
  purchasePrefix: string;
  transferPrefix: string;
  productionPrefix: string;
  expensePrefix: string;
  logoUrl: string | null;
  footerNote: string | null;
}

interface PaymentMethod {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
  sortOrder: number;
}

const PM_TYPES = [
  { value: "cash", label: "Espèces", icon: Banknote },
  { value: "card", label: "Carte bancaire", icon: CreditCard },
  { value: "transfer", label: "Virement", icon: ArrowLeftRight },
  { value: "check", label: "Chèque", icon: FileText },
  { value: "credit", label: "Crédit client", icon: Receipt },
  { value: "other", label: "Autre", icon: Package },
];

const DOC_PREFIXES = [
  { key: "invoicePrefix", label: "Factures", icon: Receipt, example: "FAC-2601-0001" },
  { key: "quotePrefix", label: "Devis", icon: FileText, example: "DEV-2601-0001" },
  { key: "orderPrefix", label: "Commandes", icon: ShoppingCart, example: "CMD-2601-0001" },
  { key: "purchasePrefix", label: "Achats", icon: ShoppingCart, example: "ACH-2601-0001" },
  { key: "transferPrefix", label: "Transferts", icon: ArrowLeftRight, example: "TRF-2601-0001" },
  { key: "productionPrefix", label: "Production", icon: Factory, example: "PRD-2601-0001" },
  { key: "expensePrefix", label: "Dépenses", icon: Wallet, example: "DEP-2601-0001" },
];

const EMPTY_FORM: CompanySettings = {
  id: 0, name: "Pacane", email: null, phone: null, address: null, city: null,
  website: null, taxId: null, currency: "DZD", currencySymbol: "DA",
  defaultLanguage: "fr", taxRate: 0, taxEnabled: false,
  invoicePrefix: "FAC", quotePrefix: "DEV", orderPrefix: "CMD",
  purchasePrefix: "ACH", transferPrefix: "TRF", productionPrefix: "PRD", expensePrefix: "DEP",
  logoUrl: null, footerNote: null,
};

export default function Settings() {
  const qc = useQueryClient();
  const { language, setLanguage } = useI18n();
  const { data: rawSettings, isLoading } = useGetCompanySettings();
  const [form, setForm] = useState<CompanySettings>(EMPTY_FORM);
  const [pmDialog, setPmDialog] = useState(false);
  const [editingPm, setEditingPm] = useState<PaymentMethod | null>(null);
  const [pmForm, setPmForm] = useState({ name: "", type: "cash", isActive: true });
  const [deletePmId, setDeletePmId] = useState<number | null>(null);

  useEffect(() => {
    if (rawSettings) {
      setForm(f => ({ ...f, ...rawSettings, taxRate: rawSettings.taxRate ?? 0 }));
    }
  }, [rawSettings]);

  const { data: paymentMethods = [], isLoading: pmLoading } = useQuery<PaymentMethod[]>({
    queryKey: ["payment-methods"],
    queryFn: () => customFetch("/api/settings/payment-methods"),
  });

  const updateSettings = useUpdateCompanySettings({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetCompanySettingsQueryKey() });
        toast({ title: "Paramètres enregistrés" });
      },
      onError: () => toast({ title: "Erreur de sauvegarde", variant: "destructive" }),
    },
  });

  const createPm = useMutation({
    mutationFn: (data: typeof pmForm) => customFetch("/api/settings/payment-methods", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payment-methods"] }); setPmDialog(false); toast({ title: "Mode de paiement ajouté" }); },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const updatePm = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PaymentMethod> }) =>
      customFetch(`/api/settings/payment-methods/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payment-methods"] }); setPmDialog(false); setEditingPm(null); toast({ title: "Mode de paiement mis à jour" }); },
  });

  const deletePm = useMutation({
    mutationFn: (id: number) => customFetch(`/api/settings/payment-methods/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payment-methods"] }); setDeletePmId(null); toast({ title: "Mode de paiement supprimé" }); },
  });

  const [resetDialog, setResetDialog] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");

  const resetMutation = useMutation({
    mutationFn: () => customFetch("/api/settings/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) }),
    onSuccess: () => {
      setResetDialog(false);
      setResetConfirm("");
      qc.invalidateQueries();
      toast({ title: "Reset effectué", description: "Toutes les données transactionnelles ont été supprimées." });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e?.message, variant: "destructive" }),
  });

  function handleSaveCompany() {
    updateSettings.mutate({
      data: {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        currency: form.currency,
        currencySymbol: form.currencySymbol,
        taxRate: form.taxRate || 0,
        invoicePrefix: form.invoicePrefix,
        orderPrefix: form.orderPrefix,
        defaultLanguage: form.defaultLanguage,
      } as any,
    });
  }

  function handleSaveAll() {
    customFetch("/api/settings/company", {
      method: "PATCH",
      body: JSON.stringify({
        ...form,
        taxRate: form.taxRate || 0,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        city: form.city || null,
        website: form.website || null,
        taxId: form.taxId || null,
        footerNote: form.footerNote || null,
      }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: getGetCompanySettingsQueryKey() });
      toast({ title: "Paramètres enregistrés" });
    }).catch(() => toast({ title: "Erreur de sauvegarde", variant: "destructive" }));
  }

  function openCreatePm() {
    setEditingPm(null);
    setPmForm({ name: "", type: "cash", isActive: true });
    setPmDialog(true);
  }

  function openEditPm(pm: PaymentMethod) {
    setEditingPm(pm);
    setPmForm({ name: pm.name, type: pm.type, isActive: pm.isActive });
    setPmDialog(true);
  }

  function handlePmSubmit() {
    if (!pmForm.name) return;
    if (editingPm) {
      updatePm.mutate({ id: editingPm.id, data: pmForm });
    } else {
      createPm.mutate(pmForm);
    }
  }

  const pmTypeLabel = (t: string) => PM_TYPES.find(m => m.value === t)?.label ?? t;

  if (isLoading) {
    return <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-serif font-bold tracking-tight">Paramètres</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configuration de l'ERP Pacane</p>
      </div>

      <Tabs defaultValue="company" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 h-10">
          <TabsTrigger value="company" className="text-xs">Entreprise</TabsTrigger>
          <TabsTrigger value="numbering" className="text-xs">Numérotation</TabsTrigger>
          <TabsTrigger value="tax" className="text-xs">TVA</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs">Paiements</TabsTrigger>
          <TabsTrigger value="system" className="text-xs">Système</TabsTrigger>
        </TabsList>

        {/* ── TAB: ENTREPRISE ── */}
        <TabsContent value="company" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Informations de l'entreprise
              </CardTitle>
              <CardDescription>Nom commercial, coordonnées et identification fiscale</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Nom de l'entreprise *</Label>
                <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Email</Label>
                  <Input className="mt-1" type="email" value={form.email ?? ""} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <Label>Téléphone</Label>
                  <Input className="mt-1" value={form.phone ?? ""} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+213 5xx xxx xxx" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Adresse</Label>
                  <Input className="mt-1" value={form.address ?? ""} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div>
                  <Label>Ville</Label>
                  <Input className="mt-1" value={form.city ?? ""} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Alger" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Site web</Label>
                  <Input className="mt-1" value={form.website ?? ""} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
                </div>
                <div>
                  <Label>NIF / Identifiant fiscal</Label>
                  <Input className="mt-1" value={form.taxId ?? ""} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} placeholder="000 000 000 000 000" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Devise</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Code devise</Label>
                  <Input className="mt-1" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} placeholder="DZD" />
                </div>
                <div>
                  <Label>Symbole affiché</Label>
                  <Input className="mt-1" value={form.currencySymbol} onChange={e => setForm(f => ({ ...f, currencySymbol: e.target.value }))} placeholder="DA" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pied de page documents</CardTitle>
              <CardDescription>Texte affiché en bas des factures et devis</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                value={form.footerNote ?? ""}
                onChange={e => setForm(f => ({ ...f, footerNote: e.target.value }))}
                placeholder="Merci de votre confiance. RC : 00/00-0000000 — NIF : 000000000000000"
              />
            </CardContent>
          </Card>

          <Button onClick={handleSaveAll} disabled={updateSettings.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {updateSettings.isPending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </TabsContent>

        {/* ── TAB: NUMÉROTATION ── */}
        <TabsContent value="numbering" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Hash className="h-4 w-4" /> Préfixes de numérotation
              </CardTitle>
              <CardDescription>
                Les références de documents sont générées automatiquement selon le format : PRÉFIXE-AAMM-SÉQUENCE
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {DOC_PREFIXES.map(({ key, label, icon: Icon, example }) => (
                  <div key={key} className="flex items-center gap-4">
                    <div className="flex items-center gap-2 w-36 shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <Input
                      value={(form as any)[key] ?? ""}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value.toUpperCase() }))}
                      className="w-28 font-mono text-sm"
                      maxLength={6}
                      placeholder="PREFIX"
                    />
                    <span className="text-xs text-muted-foreground font-mono">
                      → {(form as any)[key] || "PREFIX"}-2601-0001
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-700">
            <strong>Note :</strong> Les préfixes n'affectent que les nouveaux documents. Les références existantes ne sont pas modifiées.
          </div>

          <Button onClick={handleSaveAll} className="gap-2">
            <Save className="h-4 w-4" /> Enregistrer les préfixes
          </Button>
        </TabsContent>

        {/* ── TAB: TVA ── */}
        <TabsContent value="tax" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Paramètres TVA</CardTitle>
              <CardDescription>Configuration de la taxe sur la valeur ajoutée</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">TVA activée</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Applique la TVA sur les factures et les ventes</p>
                </div>
                <Switch
                  checked={form.taxEnabled}
                  onCheckedChange={v => setForm(f => ({ ...f, taxEnabled: v }))}
                />
              </div>
              <Separator />
              <div className={`space-y-4 ${!form.taxEnabled ? "opacity-40 pointer-events-none" : ""}`}>
                <div className="max-w-xs">
                  <Label>Taux TVA standard (%)</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={form.taxRate}
                    onChange={e => setForm(f => ({ ...f, taxRate: parseFloat(e.target.value) || 0 }))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Taux en vigueur en Algérie : 9% (réduit), 19% (normal)</p>
                </div>
                <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Simulation</p>
                    <p className="text-sm text-muted-foreground">
                      Sur 10 000 DA HT → TVA {form.taxRate}% = <strong>{Math.round(10000 * form.taxRate / 100).toLocaleString("fr-DZ")} DA</strong> → Total <strong>{Math.round(10000 * (1 + form.taxRate / 100)).toLocaleString("fr-DZ")} DA TTC</strong>
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSaveAll} className="gap-2">
            <Save className="h-4 w-4" /> Enregistrer les paramètres TVA
          </Button>
        </TabsContent>

        {/* ── TAB: MODES DE PAIEMENT ── */}
        <TabsContent value="payments" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Modes de paiement</p>
              <p className="text-xs text-muted-foreground">Utilisés dans les ventes, achats, caisse et dépenses</p>
            </div>
            <Button size="sm" onClick={openCreatePm} className="gap-2">
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {pmLoading ? (
                <div className="py-12 text-center text-muted-foreground text-sm">Chargement...</div>
              ) : paymentMethods.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">Aucun mode de paiement configuré</div>
              ) : (
                <div className="divide-y">
                  {paymentMethods.map(pm => (
                    <div key={pm.id} className="flex items-center gap-4 px-4 py-3">
                      <GripVertical className="h-4 w-4 text-muted-foreground/30 cursor-grab" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{pm.name}</span>
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{pmTypeLabel(pm.type)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {pm.isActive ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Actif
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <XCircle className="h-3.5 w-3.5" /> Inactif
                          </span>
                        )}
                        <button
                          onClick={() => updatePm.mutate({ id: pm.id, data: { isActive: !pm.isActive } })}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                        >
                          {pm.isActive ? "Désactiver" : "Activer"}
                        </button>
                        <button onClick={() => openEditPm(pm)} className="p-1.5 rounded hover:bg-muted transition-colors">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button onClick={() => setDeletePmId(pm.id)} className="p-1.5 rounded hover:bg-red-50 transition-colors">
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground">
            {paymentMethods.filter(m => m.isActive).length} mode{paymentMethods.filter(m => m.isActive).length !== 1 ? "s" : ""} actif{paymentMethods.filter(m => m.isActive).length !== 1 ? "s" : ""} sur {paymentMethods.length}
          </div>
        </TabsContent>

        {/* ── TAB: SYSTÈME ── */}
        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4" /> Langue et affichage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label>Langue de l'interface (session courante)</Label>
                <Select value={language} onValueChange={v => setLanguage(v as "fr" | "ar")}>
                  <SelectTrigger className="mt-1 max-w-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="ar">العربية (Arabic)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Cette préférence est locale et s'applique uniquement à ce navigateur.</p>
              </div>
              <Separator />
              <div>
                <Label>Langue par défaut du système</Label>
                <Select value={form.defaultLanguage} onValueChange={v => setForm(f => ({ ...f, defaultLanguage: v }))}>
                  <SelectTrigger className="mt-1 max-w-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="ar">العربية (Arabic)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Langue utilisée par défaut pour les nouveaux utilisateurs.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Informations système</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-y-3 text-sm">
                <span className="text-muted-foreground">Application</span>
                <span className="font-medium">Pacane ERP</span>
                <span className="text-muted-foreground">Version</span>
                <span className="font-medium">1.0.0</span>
                <span className="text-muted-foreground">Devise</span>
                <span className="font-medium">{form.currency} ({form.currencySymbol})</span>
                <span className="text-muted-foreground">TVA</span>
                <span className="font-medium">{form.taxEnabled ? `${form.taxRate}%` : "Désactivée"}</span>
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSaveAll} className="gap-2">
            <Save className="h-4 w-4" /> Enregistrer
          </Button>

        </TabsContent>
      </Tabs>

      {/* Payment Method Dialog */}
      <Dialog open={pmDialog} onOpenChange={open => { if (!open) { setPmDialog(false); setEditingPm(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">{editingPm ? "Modifier le mode de paiement" : "Nouveau mode de paiement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nom *</Label>
              <Input className="mt-1" value={pmForm.name} onChange={e => setPmForm(f => ({ ...f, name: e.target.value }))} placeholder="ex: Virement CCP" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={pmForm.type} onValueChange={v => setPmForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={pmForm.isActive} onCheckedChange={v => setPmForm(f => ({ ...f, isActive: v }))} />
              <Label>Actif</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPmDialog(false); setEditingPm(null); }}>Annuler</Button>
            <Button onClick={handlePmSubmit} disabled={!pmForm.name || createPm.isPending || updatePm.isPending}>
              {createPm.isPending || updatePm.isPending ? "..." : editingPm ? "Mettre à jour" : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Payment Method Confirm */}
      <AlertDialog open={deletePmId !== null} onOpenChange={open => { if (!open) setDeletePmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce mode de paiement ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deletePmId && deletePm.mutate(deletePmId)}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={resetDialog} onOpenChange={open => { if (!open) { setResetDialog(false); setResetConfirm(""); } }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" /> Réinitialisation totale des données
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p className="font-medium text-foreground">Cette action supprimera définitivement et irréversiblement :</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Toutes les ventes et paiements</li>
                  <li>Tous les achats et réceptions</li>
                  <li>Tous les transferts inter-boutiques</li>
                  <li>Toutes les dépenses</li>
                  <li>Toutes les productions</li>
                  <li>Tous les niveaux et mouvements de stock</li>
                  <li>Toutes les sessions caisse (POS)</li>
                  <li>Tous les retours et avoirs</li>
                  <li>Tous les ajustements de stock</li>
                </ul>
                <p className="text-muted-foreground">Les boutiques, produits, utilisateurs, contacts et paramètres seront conservés.</p>
                <div className="pt-2">
                  <Label className="text-foreground font-medium">Tapez <span className="font-mono bg-red-100 text-red-700 px-1 rounded">RESET</span> pour confirmer :</Label>
                  <Input
                    className="mt-2 border-red-300 focus-visible:ring-red-400"
                    placeholder="RESET"
                    value={resetConfirm}
                    onChange={e => setResetConfirm(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={resetConfirm !== "RESET" || resetMutation.isPending}
              onClick={e => { e.preventDefault(); resetMutation.mutate(); }}
            >
              {resetMutation.isPending ? "Réinitialisation..." : "Réinitialiser définitivement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
