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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Edit2, UserCircle, Trash2, Shield, Monitor, Smartphone, Clock, AlertTriangle, CheckCircle, XCircle, LogOut, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface WorkerOption { id: number; name: string; isActive: boolean; }

interface DeviceRecord {
  id: number;
  userId: number;
  fingerprint: string;
  deviceType: "mobile" | "desktop";
  deviceName: string | null;
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  browserVersion: string | null;
  userAgent: string | null;
  ip: string | null;
  loginCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "unknown" | "approved" | "rejected" | "revoked";
  revokedAt: string | null;
  revokedByAdminId: number | null;
  revokedReason: string | null;
  isSuspicious: boolean;
  suspiciousReason: string | null;
}

interface DeviceEvent {
  id: number;
  userId: number;
  fingerprint: string | null;
  deviceType: string | null;
  action: string;
  adminId: number | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const EMPTY = { name: "", email: "", username: "", password: "", phone: "", status: "active", language: "fr", roleId: "none", workerId: "none", branchIds: [] as number[], posAccess: false, adminAccess: false };

function statusColor(s: string) {
  const m: Record<string, string> = { active: "bg-green-100 text-green-700", suspended: "bg-red-100 text-red-700", archived: "bg-gray-100 text-gray-500", invited: "bg-blue-100 text-blue-700" };
  return m[s] ?? "bg-gray-100";
}

function deviceStatusBadge(status: string, isSuspicious: boolean) {
  if (isSuspicious) return <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200"><AlertTriangle className="h-3 w-3 mr-1" />Suspect</Badge>;
  const m: Record<string, React.ReactNode> = {
    unknown: <Badge variant="outline" className="text-xs text-gray-500">Inconnu</Badge>,
    approved: <Badge className="text-xs bg-green-100 text-green-700 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />Approuvé</Badge>,
    rejected: <Badge className="text-xs bg-red-100 text-red-700 border-red-200"><XCircle className="h-3 w-3 mr-1" />Rejeté</Badge>,
    revoked: <Badge className="text-xs bg-gray-100 text-gray-500 border-gray-200">Révoqué</Badge>,
  };
  return m[status] ?? <Badge variant="outline" className="text-xs">{status}</Badge>;
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function actionLabel(action: string) {
  const m: Record<string, string> = {
    login: "Connexion", new_device: "Nouvel appareil", approved: "Approuvé", rejected: "Rejeté",
    revoked: "Révoqué", reset_mobile: "Reset mobile", reset_desktop: "Reset desktop",
    disconnect_all: "Déconnexion forcée de toutes les sessions",
  };
  return m[action] ?? action;
}

// ── DeviceDialog Component ────────────────────────────────────────────────────

function DeviceDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const token = () => localStorage.getItem("erp_token") ?? "";
  const [confirmAction, setConfirmAction] = useState<null | { label: string; fn: () => void }>(null);

  const { data: devices = [], refetch: refetchDevices, isLoading: devicesLoading } = useQuery<DeviceRecord[]>({
    queryKey: ["user-devices", user.id],
    queryFn: async () => {
      const r = await fetch(`/api/users/${user.id}/devices`, { headers: { Authorization: `Bearer ${token()}` } });
      return r.ok ? r.json() : [];
    },
  });

  const { data: events = [], isLoading: eventsLoading } = useQuery<DeviceEvent[]>({
    queryKey: ["user-device-events", user.id],
    queryFn: async () => {
      const r = await fetch(`/api/users/${user.id}/device-events`, { headers: { Authorization: `Bearer ${token()}` } });
      return r.ok ? r.json() : [];
    },
  });

  const patchDevice = useMutation({
    mutationFn: async ({ fingerprint, status, reason }: { fingerprint: string; status: string; reason?: string }) => {
      const r = await fetch(`/api/users/${user.id}/devices/${fingerprint}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error ?? "Erreur");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-devices", user.id] }); qc.invalidateQueries({ queryKey: ["user-device-events", user.id] }); toast({ title: "Appareil mis à jour" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const resetMobile = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/users/${user.id}/devices/reset-mobile`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Reset par admin" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error ?? "Erreur");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-devices", user.id] }); qc.invalidateQueries({ queryKey: ["user-device-events", user.id] }); toast({ title: "Appareils mobiles réinitialisés" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const resetDesktop = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/users/${user.id}/devices/reset-desktop`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Reset par admin" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error ?? "Erreur");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-devices", user.id] }); qc.invalidateQueries({ queryKey: ["user-device-events", user.id] }); toast({ title: "Appareils desktop réinitialisés" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const disconnectAll = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/users/${user.id}/disconnect-all`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Déconnexion forcée par admin" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error ?? "Erreur");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-device-events", user.id] }); toast({ title: "Toutes les sessions ont été invalidées" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const mobiles = devices.filter(d => d.deviceType === "mobile");
  const desktops = devices.filter(d => d.deviceType === "desktop");

  const anyPending = patchDevice.isPending || resetMobile.isPending || resetDesktop.isPending || disconnectAll.isPending;

  function confirm(label: string, fn: () => void) { setConfirmAction({ label, fn }); }

  return (
    <>
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Appareils et sécurité — <span className="font-normal text-muted-foreground">{user.name}</span>
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="devices">
            <TabsList className="mb-4">
              <TabsTrigger value="devices">Appareils ({devices.length})</TabsTrigger>
              <TabsTrigger value="history">Historique ({events.length})</TabsTrigger>
            </TabsList>

            {/* ── Devices Tab ─────────────────────────────────────────── */}
            <TabsContent value="devices" className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={anyPending || mobiles.length === 0}
                  onClick={() => confirm("Réinitialiser tous les appareils mobiles de cet utilisateur ?", () => resetMobile.mutate())}>
                  <Smartphone className="h-3.5 w-3.5" />Reset mobiles
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={anyPending || desktops.length === 0}
                  onClick={() => confirm("Réinitialiser tous les appareils desktop de cet utilisateur ?", () => resetDesktop.mutate())}>
                  <Monitor className="h-3.5 w-3.5" />Reset desktops
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="destructive" className="gap-1.5 text-xs" disabled={anyPending}
                  onClick={() => confirm("Invalider toutes les sessions actives de cet utilisateur ? Il devra se reconnecter.", () => disconnectAll.mutate())}>
                  <LogOut className="h-3.5 w-3.5" />Déconnecter tout
                </Button>
              </div>

              {devicesLoading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Chargement…</p>
              ) : devices.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Aucun appareil enregistré</p>
                  <p className="text-xs mt-1">Les appareils apparaissent automatiquement à la première connexion</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Mobile devices */}
                  {mobiles.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Smartphone className="h-3.5 w-3.5" />Mobiles ({mobiles.length})
                      </p>
                      <div className="space-y-2">
                        {mobiles.map(d => (
                          <DeviceCard key={d.fingerprint} device={d} onPatch={(status) => patchDevice.mutate({ fingerprint: d.fingerprint, status })} disabled={anyPending} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Desktop devices */}
                  {desktops.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Monitor className="h-3.5 w-3.5" />Desktops ({desktops.length})
                      </p>
                      <div className="space-y-2">
                        {desktops.map(d => (
                          <DeviceCard key={d.fingerprint} device={d} onPatch={(status) => patchDevice.mutate({ fingerprint: d.fingerprint, status })} disabled={anyPending} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── History Tab ─────────────────────────────────────────── */}
            <TabsContent value="history">
              {eventsLoading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Chargement…</p>
              ) : events.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Aucun événement enregistré</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
                  {events.map(ev => (
                    <div key={ev.id} className={`flex items-start gap-3 py-2 px-3 rounded-md text-sm ${ev.action === "new_device" ? "bg-blue-50" : ev.action === "disconnect_all" || ev.action === "revoked" ? "bg-red-50" : ev.action === "approved" ? "bg-green-50" : "hover:bg-muted/40"}`}>
                      <div className="mt-0.5 shrink-0 text-muted-foreground">
                        {ev.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{actionLabel(ev.action)}</p>
                        {ev.reason && <p className="text-xs text-muted-foreground">{ev.reason}</p>}
                        {ev.ip && <p className="text-xs text-muted-foreground font-mono">IP: {ev.ip}</p>}
                        {ev.fingerprint && <p className="text-xs text-muted-foreground font-mono">ID: {ev.fingerprint.slice(0, 12)}…</p>}
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0">{formatDate(ev.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmAction} onOpenChange={open => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer l'action</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.label}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmAction?.fn(); setConfirmAction(null); }}>Confirmer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── DeviceCard Component ──────────────────────────────────────────────────────

function DeviceCard({ device, onPatch, disabled }: { device: DeviceRecord; onPatch: (status: string) => void; disabled: boolean }) {
  return (
    <div className={`border rounded-lg p-3 flex items-start gap-3 ${device.isSuspicious ? "border-orange-200 bg-orange-50/50" : device.status === "revoked" ? "opacity-60 bg-gray-50" : "bg-card"}`}>
      <div className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${device.deviceType === "mobile" ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"}`}>
        {device.deviceType === "mobile" ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">{device.deviceName ?? "Appareil inconnu"}</p>
          {deviceStatusBadge(device.status, device.isSuspicious)}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
          {device.ip && <span className="font-mono">IP: {device.ip}</span>}
          <span>Vu {device.loginCount}x</span>
          <span>Dernière connexion: {formatDate(device.lastSeenAt)}</span>
          <span>Premier accès: {formatDate(device.firstSeenAt)}</span>
        </div>
        {device.isSuspicious && device.suspiciousReason && (
          <p className="text-xs text-orange-600 mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{device.suspiciousReason}</p>
        )}
        {device.status === "revoked" && device.revokedReason && (
          <p className="text-xs text-muted-foreground mt-1">Révoqué : {device.revokedReason}</p>
        )}
      </div>
      <div className="flex gap-1 shrink-0">
        {device.status !== "approved" && device.status !== "revoked" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50" disabled={disabled} onClick={() => onPatch("approved")}>
                  <CheckCircle className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Approuver</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {device.status !== "rejected" && device.status !== "revoked" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" disabled={disabled} onClick={() => onPatch("rejected")}>
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rejeter</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {device.status !== "revoked" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-500 hover:text-gray-700 hover:bg-gray-100" disabled={disabled} onClick={() => onPatch("revoked")}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Révoquer</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {device.status === "revoked" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50" disabled={disabled} onClick={() => onPatch("approved")}>
                  <CheckCircle className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Réapprouver</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

// ── Main Users Page ───────────────────────────────────────────────────────────

export default function Users() {
  const qc = useQueryClient();
  const { user: authUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deviceTarget, setDeviceTarget] = useState<User | null>(null);

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
    <>
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
                  <TableHead className="w-20"></TableHead>
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
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => setDeviceTarget(u)}>
                                <Shield className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Appareils et sécurité</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
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

      {deviceTarget && (
        <DeviceDialog user={deviceTarget} onClose={() => setDeviceTarget(null)} />
      )}
    </>
  );
}
