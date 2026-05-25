import { useState } from "react";
import { useGetUsers, useCreateUser, useUpdateUser, useGetRoles, useGetBranches, User, getGetUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit2, UserCircle, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface WorkerOption { id: number; name: string; isActive: boolean; }

const EMPTY = { name: "", email: "", username: "", password: "", phone: "", status: "active", language: "fr", roleId: "none", workerId: "none", branchIds: [] as number[], posAccess: false, adminAccess: false };

function statusColor(s: string) {
  const m: Record<string, string> = { active: "bg-green-100 text-green-700", suspended: "bg-red-100 text-red-700", archived: "bg-gray-100 text-gray-500", invited: "bg-blue-100 text-blue-700" };
  return m[s] ?? "bg-gray-100";
}

export default function Users() {
  const qc = useQueryClient();
  const { user: authUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const { data: users = [], isLoading } = useGetUsers({});
  const { data: roles = [] } = useGetRoles();
  const { data: branches = [] } = useGetBranches();
  const { data: workers = [] } = useQuery<WorkerOption[]>({
    queryKey: ["workers"],
    queryFn: async () => { const r = await fetch("/api/workers", { headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` } }); return r.ok ? r.json() : []; },
  });
  const createMutation = useCreateUser({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetUsersQueryKey() }); setDialogOpen(false); toast({ title: "Utilisateur créé" }); } } });
  const updateMutation = useUpdateUser({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetUsersQueryKey() }); setDialogOpen(false); toast({ title: "Utilisateur mis à jour" }); } } });
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}` } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error ?? "Erreur de suppression");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetUsersQueryKey() }); setDeleteTarget(null); toast({ title: "Utilisateur supprimé" }); },
    onError: (e: any) => { setDeleteTarget(null); toast({ title: e.message, variant: "destructive" }); },
  });

  function openNew() { setEditing(null); setForm({ ...EMPTY }); setDialogOpen(true); }
  function openEdit(u: User) {
    setEditing(u);
    setForm({ name: u.name, email: u.email, username: u.username, password: "", phone: u.phone ?? "", status: u.status, language: u.language, roleId: u.roleId?.toString() ?? "none", workerId: (u as any).workerId?.toString() ?? "none", branchIds: u.branchIds, posAccess: u.posAccess, adminAccess: u.adminAccess });
    setDialogOpen(true);
  }
  function toggleBranch(id: number) { setForm(f => ({ ...f, branchIds: f.branchIds.includes(id) ? f.branchIds.filter(b => b !== id) : [...f.branchIds, id] })); }
  function save() {
    const data = { ...form, roleId: form.roleId && form.roleId !== "none" ? parseInt(form.roleId) : null, workerId: form.workerId && form.workerId !== "none" ? parseInt(form.workerId) : null };
    if (editing) { updateMutation.mutate({ id: editing.id, data }); }
    else { createMutation.mutate({ data: { ...data, status: data.status as any, language: data.language as any } }); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{users.length} utilisateur{users.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Nouvel utilisateur</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Accès</TableHead>
                <TableHead>Langue</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : users.map(u => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <UserCircle className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{u.name}</p>
                        <p className="text-xs text-muted-foreground">@{u.username}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{u.roleName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {u.adminAccess && <Badge variant="secondary" className="text-xs">Admin</Badge>}
                      {u.posAccess && <Badge variant="outline" className="text-xs">POS</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{u.language === "ar" ? "العربية" : "Français"}</TableCell>
                  <TableCell><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(u.status)}`}>{u.status}</span></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                        disabled={(authUser as any)?.id === u.id}
                        onClick={() => setDeleteTarget(u)}
                      >
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Nom complet *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label>Nom d'utilisateur *</Label><Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} disabled={!!editing} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><Label>{editing ? "Nouveau mot de passe" : "Mot de passe *"}</Label><Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Téléphone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
              <div>
                <Label>Langue</Label>
                <Select value={form.language} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="fr">Français</SelectItem><SelectItem value="ar">العربية</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Statut</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="suspended">Suspendu</SelectItem>
                    <SelectItem value="invited">Invité</SelectItem>
                    <SelectItem value="archived">Archivé</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Rôle</Label>
                <Select value={form.roleId} onValueChange={v => setForm(f => ({ ...f, roleId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Aucun rôle" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    {roles.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Lier à un ouvrier (optionnel)</Label>
              <Select value={form.workerId} onValueChange={v => setForm(f => ({ ...f, workerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Aucun ouvrier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {workers.filter(w => w.isActive).map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Permet à cet utilisateur de voir ses ordres de préparation dans "Mes préparations"</p>
            </div>
            <div>
              <Label className="mb-2 block">Boutiques</Label>
              <div className="flex flex-wrap gap-2">
                {branches.map(b => (
                  <label key={b.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={form.branchIds.includes(b.id)} onCheckedChange={() => toggleBranch(b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={form.adminAccess} onCheckedChange={v => setForm(f => ({ ...f, adminAccess: !!v }))} />
                Accès administrateur
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={form.posAccess} onCheckedChange={v => setForm(f => ({ ...f, posAccess: !!v }))} />
                Accès caisse (POS)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={!form.name || !form.username || !form.email}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'utilisateur</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer <strong>{deleteTarget?.name ?? deleteTarget?.username}</strong> ?
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
