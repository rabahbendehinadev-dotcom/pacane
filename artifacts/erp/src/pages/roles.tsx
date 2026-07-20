import { useState } from "react";
import { useGetRoles, useCreateRole, useUpdateRole, Role, getGetRolesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Edit2, Shield, Lock,
  Building2, Users, Key, UserCircle, Package, Warehouse,
  ShoppingCart, ShoppingBag, Monitor, BookOpen, Factory,
  Receipt, BarChart2, Settings, ArrowLeftRight, SlidersHorizontal,
  RotateCcw, Wallet, TrendingUp, LayoutDashboard,
  HardHat, ClipboardList, ClipboardCheck, Repeat2, ScanLine
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ── Permissions organisées par module (clés réelles de la base) ────────────

const MODULES = [
  {
    label: "Tableau de bord", icon: LayoutDashboard,
    permissions: [
      { key: "dashboard.view", label: "Accès au tableau de bord", sub: "Voir les statistiques générales" },
    ],
  },
  {
    label: "Boutiques", icon: Building2,
    permissions: [
      { key: "branches.view",   label: "Consulter",      sub: "Voir la liste des boutiques" },
      { key: "branches.create", label: "Créer",           sub: "Ajouter de nouvelles boutiques" },
      { key: "branches.edit",   label: "Modifier",        sub: "Mettre à jour les informations" },
      { key: "branches.*",      label: "Accès complet",   sub: "Toutes les actions sur les boutiques" },
    ],
  },
  {
    label: "Utilisateurs", icon: Users,
    permissions: [
      { key: "users.view",    label: "Consulter",     sub: "Voir la liste des utilisateurs" },
      { key: "users.create",  label: "Créer",          sub: "Ajouter de nouveaux comptes" },
      { key: "users.edit",    label: "Modifier",       sub: "Mettre à jour les profils" },
      { key: "users.suspend", label: "Suspendre",      sub: "Désactiver des comptes" },
      { key: "users.*",       label: "Accès complet",  sub: "Toutes les actions utilisateurs" },
    ],
  },
  {
    label: "Rôles & accès", icon: Key,
    permissions: [
      { key: "roles.view", label: "Consulter les rôles", sub: "Voir les rôles existants" },
      { key: "roles.edit", label: "Modifier les rôles",  sub: "Créer et modifier les rôles" },
      { key: "roles.*",    label: "Accès complet",        sub: "Toutes les actions sur les rôles" },
    ],
  },
  {
    label: "Contacts (clients & fournisseurs)", icon: UserCircle,
    permissions: [
      { key: "contacts.view",   label: "Consulter",     sub: "Voir la liste des contacts" },
      { key: "contacts.create", label: "Créer",          sub: "Ajouter de nouveaux contacts" },
      { key: "contacts.edit",   label: "Modifier",       sub: "Mettre à jour les fiches" },
      { key: "contacts.delete", label: "Supprimer",      sub: "Archiver ou supprimer des contacts" },
      { key: "contacts.*",      label: "Accès complet",  sub: "Toutes les actions contacts" },
    ],
  },
  {
    label: "Catalogue produits", icon: Package,
    permissions: [
      { key: "products.view",         label: "Consulter",           sub: "Voir les produits et catégories" },
      { key: "products.create",       label: "Créer",                sub: "Ajouter de nouveaux produits" },
      { key: "products.edit",         label: "Modifier",             sub: "Mettre à jour les fiches produit" },
      { key: "products.price_update", label: "Modifier les prix",    sub: "Changer les prix de vente / coût" },
      { key: "products.*",            label: "Accès complet",        sub: "Toutes les actions catalogue" },
    ],
  },
  {
    label: "Stock", icon: Warehouse,
    permissions: [
      { key: "stock.view",     label: "Consulter le stock",   sub: "Voir les niveaux de stock" },
      { key: "stock.adjust",   label: "Ajustements manuels",  sub: "Corriger les quantités en stock" },
      { key: "stock.transfer", label: "Transferts",            sub: "Déplacer des produits entre succursales" },
      { key: "stock.*",        label: "Accès complet",         sub: "Toutes les actions stock" },
    ],
  },
  {
    label: "Achats & fournisseurs", icon: ShoppingCart,
    permissions: [
      { key: "purchases.view",    label: "Consulter",          sub: "Voir les bons de commande" },
      { key: "purchases.create",  label: "Créer",               sub: "Passer des commandes fournisseurs" },
      { key: "purchases.edit",    label: "Modifier",            sub: "Mettre à jour les commandes" },
      { key: "purchases.receive", label: "Réceptionner",        sub: "Enregistrer les livraisons reçues" },
      { key: "purchases.pay",     label: "Payer",               sub: "Enregistrer les paiements fournisseurs" },
      { key: "purchases.cancel",  label: "Annuler",             sub: "Annuler des commandes" },
      { key: "purchases.*",       label: "Accès complet",       sub: "Toutes les actions achats" },
    ],
  },
  {
    label: "Retours fournisseurs", icon: RotateCcw,
    permissions: [
      { key: "purchase_returns.view",    label: "Consulter",    sub: "Voir les retours fournisseurs" },
      { key: "purchase_returns.create",  label: "Créer",         sub: "Créer des retours" },
      { key: "purchase_returns.confirm", label: "Confirmer",     sub: "Valider les retours" },
      { key: "purchase_returns.*",       label: "Accès complet", sub: "Toutes les actions retours fournisseurs" },
    ],
  },
  {
    label: "Recettes", icon: BookOpen,
    permissions: [
      { key: "recipes.view",   label: "Consulter",    sub: "Voir les fiches recettes" },
      { key: "recipes.create", label: "Créer",         sub: "Créer de nouvelles recettes" },
      { key: "recipes.edit",   label: "Modifier",      sub: "Mettre à jour les recettes" },
      { key: "recipes.*",      label: "Accès complet", sub: "Toutes les actions recettes" },
    ],
  },
  {
    label: "Production", icon: Factory,
    permissions: [
      { key: "production.view",     label: "Consulter",                sub: "Voir les ordres de fabrication" },
      { key: "production.create",   label: "Créer",                     sub: "Lancer de nouveaux ordres" },
      { key: "production.launch",   label: "Démarrer la production",    sub: "Passer un ordre en cours" },
      { key: "production.complete", label: "Terminer",                  sub: "Marquer comme produit" },
      { key: "production.*",        label: "Accès complet",             sub: "Toutes les actions production" },
    ],
  },
  {
    label: "Ventes & facturation", icon: ShoppingBag,
    permissions: [
      { key: "sales.view",    label: "Consulter",         sub: "Voir les ventes et factures" },
      { key: "sales.create",  label: "Créer",              sub: "Créer des devis et factures" },
      { key: "sales.edit",    label: "Modifier",           sub: "Mettre à jour les documents" },
      { key: "sales.convert", label: "Convertir",          sub: "Convertir devis → commande → facture" },
      { key: "sales.cancel",  label: "Annuler",            sub: "Annuler des ventes" },
      { key: "sales.*",       label: "Accès complet",      sub: "Toutes les actions ventes" },
    ],
  },
  {
    label: "Point de vente (POS)", icon: Monitor,
    permissions: [
      { key: "pos.view",          label: "Accéder à la caisse",    sub: "Ouvrir l'interface POS" },
      { key: "pos.open_session",  label: "Ouvrir une session",     sub: "Démarrer une session de caisse" },
      { key: "pos.sell",          label: "Vendre",                 sub: "Enregistrer des ventes au comptoir" },
      { key: "pos.refund",        label: "Rembourser",             sub: "Effectuer des remboursements" },
      { key: "pos.close_session", label: "Clôturer la session",    sub: "Fermer et réconcilier la caisse" },
      { key: "pos.*",             label: "Accès complet",          sub: "Toutes les actions POS" },
    ],
  },
  {
    label: "Retours & avoirs clients", icon: RotateCcw,
    permissions: [
      { key: "returns.view",    label: "Consulter",       sub: "Voir les retours clients" },
      { key: "returns.create",  label: "Créer",            sub: "Enregistrer un retour" },
      { key: "returns.confirm", label: "Confirmer",        sub: "Valider le retour" },
      { key: "returns.refund",  label: "Rembourser",       sub: "Émettre un remboursement" },
      { key: "returns.*",       label: "Accès complet",    sub: "Toutes les actions retours clients" },
    ],
  },
  {
    label: "Transferts inter-branches", icon: ArrowLeftRight,
    permissions: [
      { key: "transfers.view",    label: "Consulter",     sub: "Voir les transferts de stock" },
      { key: "transfers.create",  label: "Créer",          sub: "Initier un transfert" },
      { key: "transfers.receive", label: "Réceptionner",   sub: "Confirmer la réception d'un transfert" },
      { key: "transfers.*",       label: "Accès complet",  sub: "Toutes les actions transferts" },
    ],
  },
  {
    label: "Ajustements de stock", icon: SlidersHorizontal,
    permissions: [
      { key: "adjustments.view",   label: "Consulter",    sub: "Voir l'historique des ajustements" },
      { key: "adjustments.create", label: "Créer",         sub: "Effectuer des ajustements manuels" },
      { key: "adjustments.*",      label: "Accès complet", sub: "Toutes les actions ajustements" },
    ],
  },
  {
    label: "Dépenses", icon: Receipt,
    permissions: [
      { key: "expenses.view",   label: "Consulter",    sub: "Voir les dépenses enregistrées" },
      { key: "expenses.create", label: "Saisir",        sub: "Enregistrer de nouvelles dépenses" },
      { key: "expenses.edit",   label: "Modifier",      sub: "Mettre à jour les dépenses" },
      { key: "expenses.*",      label: "Accès complet", sub: "Toutes les actions dépenses" },
    ],
  },
  {
    label: "Rapports & statistiques", icon: BarChart2,
    permissions: [
      { key: "reports.view",   label: "Consulter les rapports", sub: "Voir les statistiques et analyses" },
      { key: "reports.export", label: "Exporter",                sub: "Télécharger les rapports (CSV, PDF)" },
      { key: "reports.*",      label: "Accès complet",           sub: "Consultation et export de rapports" },
    ],
  },
  {
    label: "Analytique avancée", icon: TrendingUp,
    permissions: [
      { key: "analytics.view", label: "Accès analytique", sub: "Tableaux de bord avancés (ventes, achats, production)" },
    ],
  },
  {
    label: "Trésorerie", icon: Wallet,
    permissions: [
      { key: "treasury.view", label: "Consulter la trésorerie", sub: "Voir les flux de trésorerie" },
    ],
  },
  {
    label: "Paramètres système", icon: Settings,
    permissions: [
      { key: "settings.view", label: "Consulter les paramètres", sub: "Voir la configuration" },
      { key: "settings.edit", label: "Modifier les paramètres",  sub: "Changer la configuration de l'entreprise" },
      { key: "settings.*",    label: "Accès complet",             sub: "Toutes les actions paramètres" },
    ],
  },
  {
    label: "Réapprovisionnement automatique", icon: Repeat2,
    permissions: [
      { key: "replenishment.view",   label: "Consulter",       sub: "Voir le bon de commande automatique" },
      { key: "replenishment.create", label: "Créer / Envoyer", sub: "Lancer le calcul et envoyer aux ouvriers" },
      { key: "replenishment.print",  label: "Imprimer",        sub: "Imprimer le bon de commande" },
      { key: "replenishment.export", label: "Exporter",        sub: "Télécharger en CSV / PDF" },
      { key: "replenishment.*",      label: "Accès complet",   sub: "Toutes les actions réapprovisionnement" },
    ],
  },
  {
    label: "Ouvriers", icon: HardHat,
    permissions: [
      { key: "workers.view",       label: "Consulter",   sub: "Voir la liste des ouvriers" },
      { key: "workers.create",     label: "Créer",        sub: "Ajouter de nouveaux ouvriers" },
      { key: "workers.edit",       label: "Modifier",     sub: "Mettre à jour les fiches ouvriers" },
      { key: "workers.deactivate", label: "Désactiver",   sub: "Désactiver un ouvrier" },
      { key: "workers.*",          label: "Accès complet",sub: "Toutes les actions ouvriers" },
    ],
  },
  {
    label: "Ordres de préparation", icon: ClipboardList,
    permissions: [
      { key: "preparation_orders.view",   label: "Consulter",      sub: "Voir tous les ordres de préparation" },
      { key: "preparation_orders.create", label: "Créer",           sub: "Créer des ordres manuellement" },
      { key: "preparation_orders.send",   label: "Envoyer",         sub: "Envoyer des ordres aux ouvriers" },
      { key: "preparation_orders.cancel", label: "Annuler",         sub: "Annuler un ordre de préparation" },
      { key: "preparation_orders.print",  label: "Imprimer",        sub: "Imprimer un ordre de préparation" },
      { key: "preparation_orders.*",      label: "Accès complet",   sub: "Toutes les actions ordres de préparation" },
    ],
  },
  {
    label: "Mes préparations (ouvrier)", icon: ClipboardCheck,
    permissions: [
      { key: "my_preparations.view",          label: "Voir mes tâches",      sub: "L'ouvrier voit ses ordres assignés" },
      { key: "my_preparations.update_status", label: "Mettre à jour statut", sub: "Marquer En cours / Terminé" },
      { key: "my_preparations.*",             label: "Accès complet",        sub: "Consulter et mettre à jour ses préparations" },
    ],
  },
  {
    label: "Consommations internes", icon: ClipboardList,
    permissions: [
      { key: "internal_consumptions.view",    label: "Consulter",    sub: "Voir les consommations enregistrées" },
      { key: "internal_consumptions.create",  label: "Créer",         sub: "Enregistrer une consommation" },
      { key: "internal_consumptions.confirm", label: "Confirmer",     sub: "Valider une consommation" },
      { key: "internal_consumptions.cancel",  label: "Annuler",       sub: "Annuler une consommation" },
      { key: "internal_consumptions.*",       label: "Accès complet", sub: "Toutes les actions consommations" },
    ],
  },
  {
    label: "Pointage", icon: ScanLine,
    permissions: [
      { key: "pointage.view",  label: "Consulter",     sub: "Voir l'historique et les présences du jour" },
      { key: "pointage.admin", label: "Administrer",    sub: "Saisie manuelle, correction, paramètres employés" },
      { key: "pointage.*",     label: "Accès complet", sub: "Toutes les actions pointage" },
    ],
  },
];

const ALL_PERMISSION_KEYS = MODULES.flatMap(m => m.permissions.map(p => p.key));

// Libellé court pour les badges dans les cartes
const PERM_LABEL: Record<string, string> = {};
MODULES.forEach(m => m.permissions.forEach(p => { PERM_LABEL[p.key] = `${m.label} — ${p.label}`; }));

// Résumé compact pour la carte (évite les `*` répétitifs)
function summarizePerms(perms: string[]): string[] {
  if (perms.includes("*")) return ["Accès total"];
  const result: string[] = [];
  const wildcards = perms.filter(p => p.endsWith(".*"));
  for (const w of wildcards) {
    const mod = w.replace(".*", "");
    const modLabel = MODULES.find(m => m.permissions.some(p => p.key === w))?.label;
    result.push(modLabel ? `${modLabel} (complet)` : w);
  }
  for (const p of perms) {
    if (p.endsWith(".*")) continue;
    const mod = p.split(".")[0];
    if (wildcards.some(w => w === `${mod}.*`)) continue;
    const entry = MODULES.flatMap(m => m.permissions).find(x => x.key === p);
    if (entry) result.push(entry.label);
  }
  return result;
}

export default function Roles() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form, setForm] = useState({ name: "", description: "", permissions: [] as string[] });

  const { data: roles = [], isLoading } = useGetRoles();
  const createMutation = useCreateRole({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetRolesQueryKey() }); setDialogOpen(false); toast({ title: "Rôle créé" }); } } });
  const updateMutation = useUpdateRole({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetRolesQueryKey() }); setDialogOpen(false); toast({ title: "Rôle mis à jour" }); } } });

  function openNew() { setEditing(null); setForm({ name: "", description: "", permissions: [] }); setDialogOpen(true); }
  function openEdit(r: Role) { setEditing(r); setForm({ name: r.name, description: r.description ?? "", permissions: r.permissions }); setDialogOpen(true); }

  function togglePerm(key: string) {
    setForm(f => {
      const has = f.permissions.includes(key);
      if (has) return { ...f, permissions: f.permissions.filter(x => x !== key) };
      // Si on coche un wildcard (module.*), supprimer les permissions individuelles du même module
      let next = [...f.permissions];
      if (key.endsWith(".*")) {
        const mod = key.replace(".*", "");
        next = next.filter(p => !p.startsWith(mod + ".") || p === key);
      }
      return { ...f, permissions: [...next, key] };
    });
  }

  function toggleAll() {
    const allSelected = ALL_PERMISSION_KEYS.every(p => form.permissions.includes(p));
    setForm(f => ({ ...f, permissions: allSelected ? [] : ["*"] }));
  }

  function save() {
    if (editing) updateMutation.mutate({ id: editing.id, data: form });
    else createMutation.mutate({ data: form });
  }

  const permCount = form.permissions.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Rôles et permissions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Définissez les niveaux d'accès pour chaque profil utilisateur</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Nouveau rôle</Button>
      </div>

      {/* ── Cartes rôles ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? <p className="text-muted-foreground">Chargement...</p> : roles.map(role => {
          const summary = summarizePerms(role.permissions);
          return (
            <Card key={role.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      {role.isSystem ? <Lock className="h-4 w-4 text-primary" /> : <Shield className="h-4 w-4 text-primary" />}
                    </div>
                    <div>
                      <CardTitle className="text-base leading-tight">{role.name}</CardTitle>
                      {role.isSystem && <Badge variant="secondary" className="text-xs mt-0.5">Système</Badge>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => openEdit(role)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {role.description && <p className="text-sm text-muted-foreground mt-1">{role.description}</p>}
              </CardHeader>
              <CardContent>
                {summary.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucune permission</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {summary.slice(0, 4).map((s, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                    ))}
                    {summary.length > 4 && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">+{summary.length - 4} autres</Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Dialog création / modification ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Modifier : ${editing.name}` : "Nouveau rôle"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nom du rôle *</Label>
                <Input placeholder="ex: Responsable magasin" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input placeholder="Brève description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold">Permissions</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {form.permissions.includes("*") ? "Accès total activé" : permCount === 0 ? "Aucune permission" : `${permCount} permission${permCount > 1 ? "s" : ""} sélectionnée${permCount > 1 ? "s" : ""}`}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="text-xs h-7 gap-1.5" onClick={toggleAll}>
                  {form.permissions.includes("*") ? "Tout désélectionner" : "Tout sélectionner"}
                </Button>
              </div>

              <div className="space-y-2">
                {MODULES.map(module => {
                  const Icon = module.icon;
                  const moduleChecked = module.permissions.filter(p => form.permissions.includes(p.key));
                  const hasAny = moduleChecked.length > 0;
                  return (
                    <div key={module.label} className="rounded-lg border">
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-t-lg border-b">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-semibold">{module.label}</span>
                        {hasAny && <Badge className="text-[10px] h-4 px-1.5 ml-auto">{moduleChecked.length}/{module.permissions.length}</Badge>}
                      </div>
                      <div className="divide-y">
                        {module.permissions.map(perm => (
                          <label key={perm.key} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors">
                            <Checkbox
                              checked={form.permissions.includes("*") || form.permissions.includes(perm.key)}
                              disabled={form.permissions.includes("*")}
                              onCheckedChange={() => togglePerm(perm.key)}
                              className="shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">{perm.label}</p>
                                {perm.key.endsWith(".*") && <Badge variant="secondary" className="text-[10px] h-4 px-1">Tout inclus</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{perm.sub}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={!form.name || createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
